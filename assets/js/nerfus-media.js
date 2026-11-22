(function () {
  'use strict';

  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var hasIO = 'IntersectionObserver' in window;

  function svg(d) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="' + d + '"/></svg>';
  }

  var ICON = {
    play: svg('M8 5v14l11-7z'),
    pause: svg('M6 19h4V5H6v14zm8-14v14h4V5h-4z'),
    prev: svg('M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z'),
    next: svg('M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z')
  };

  function h(tag, cls, html) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (html != null) node.innerHTML = html;
    return node;
  }

  function button(cls, html, label) {
    var b = h('button', cls, html);
    b.type = 'button';
    if (label) b.setAttribute('aria-label', label);
    return b;
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function clock(t) {
    t = Math.max(0, Math.floor(t || 0));
    return Math.floor(t / 60) + ':' + String(t % 60).padStart(2, '0');
  }

  function whenNear(node, margin, fn) {
    if (!hasIO) return fn();
    var io = new IntersectionObserver(function (entries) {
      if (entries.some(function (e) { return e.isIntersecting; })) {
        io.disconnect();
        fn();
      }
    }, { rootMargin: margin });
    io.observe(node);
  }

  function ClipPlayer(opts) {
    var self = this;
    this.opts = opts || {};
    this.item = null;
    this.duration = 0;
    this.near = !hasIO;
    this.visible = false;
    this.userPaused = false;
    this.consent = false;
    this.raf = 0;

    this.el = h('div', 'nv-player');
    this.stage = h('div', 'nv-stage is-paused');
    var v = this.video = document.createElement('video');
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    v.setAttribute('muted', '');
    v.setAttribute('playsinline', '');
    v.setAttribute('disablepictureinpicture', '');
    v.preload = 'none';

    this.big = button('nv-bigplay', ICON.play, 'Play');
    this.stage.append(v, this.big);

    this.bar = h('div', 'nv-timeline');
    this.playBtn = button('nv-play', ICON.play, 'Play');
    this.track = h('div', 'nv-track');
    this.track.tabIndex = 0;
    this.track.setAttribute('role', 'slider');
    this.track.setAttribute('aria-label', 'Seek');
    this.track.setAttribute('aria-valuemin', '0');
    this.fill = h('div', 'nv-fill');
    this.knob = h('div', 'nv-knob');
    this.track.append(this.fill, this.knob);
    this.time = h('span', 'nv-time');
    this.bar.append(this.playBtn, this.track, this.time);
    this.el.append(this.stage, this.bar);

    v.addEventListener('playing', function () {
      self.stage.classList.remove('is-paused', 'is-loading');
      self.setButton(true);
      self.tickLoop();
      if (self.opts.onPlaying) self.opts.onPlaying();
    });
    v.addEventListener('play', function () {
      self.stage.classList.remove('is-paused');
      self.setButton(true);
    });
    v.addEventListener('pause', function () {
      if (!v.ended) self.stage.classList.add('is-paused');
      self.setButton(false);
      self.render(v.currentTime);
    });
    v.addEventListener('waiting', function () { self.stage.classList.add('is-loading'); });
    v.addEventListener('canplay', function () { self.stage.classList.remove('is-loading'); });
    v.addEventListener('loadedmetadata', function () {
      if (isFinite(v.duration) && v.duration > 0) self.duration = v.duration;
      self.track.setAttribute('aria-valuemax', self.duration.toFixed(1));
      self.render(v.currentTime);
    });
    v.addEventListener('timeupdate', function () { if (v.paused) self.render(v.currentTime); });
    v.addEventListener('ended', function () {
      self.render(self.duration);
      if (self.opts.onEnded) self.opts.onEnded();
    });

    v.addEventListener('click', function () { self.toggle(); });
    this.big.addEventListener('click', function () { self.userPlay(); });
    this.playBtn.addEventListener('click', function () { self.toggle(); });

    var dragging = false;
    function seekFromPointer(e) {
      var r = self.track.getBoundingClientRect();
      var f = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      self.seek(f * (self.duration || 0));
    }
    this.track.addEventListener('pointerdown', function (e) {
      dragging = true;
      self.track.classList.add('is-dragging');
      if (self.track.setPointerCapture) self.track.setPointerCapture(e.pointerId);
      seekFromPointer(e);
    });
    this.track.addEventListener('pointermove', function (e) { if (dragging) seekFromPointer(e); });
    ['pointerup', 'pointercancel'].forEach(function (type) {
      self.track.addEventListener(type, function () {
        dragging = false;
        self.track.classList.remove('is-dragging');
      });
    });
    this.track.addEventListener('keydown', function (e) {
      var step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1 }[e.key];
      if (step) {
        e.preventDefault();
        self.seek(v.currentTime + step);
      } else if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        self.seek(e.key === 'Home' ? 0 : self.duration);
      } else if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        self.toggle();
      }
    });
  }

  ClipPlayer.prototype.load = function (item) {
    this.item = item;
    this.duration = item.duration || 0;
    this.video.setAttribute('aria-label', item.label || item.title);
    this.track.setAttribute('aria-valuemax', this.duration.toFixed(1));
    this.render(0);
    if (this.near) this.apply();
  };

  ClipPlayer.prototype.apply = function () {
    var v = this.video;
    var item = this.item;
    if (!item || v.getAttribute('src') === item.src) return;
    v.poster = item.poster;
    v.preload = 'none';
    v.src = item.src;
    if (this.shouldPlay()) this.play();
  };

  ClipPlayer.prototype.setNear = function () {
    this.near = true;
    this.apply();
  };

  ClipPlayer.prototype.shouldPlay = function () {
    return this.near && this.visible && !this.userPaused && !document.hidden && (!reduceMotion || this.consent);
  };

  ClipPlayer.prototype.userPlay = function () {
    this.consent = true;
    this.userPaused = false;
    this.near = true;
    this.apply();
    this.play();
  };

  ClipPlayer.prototype.play = function () {
    var self = this;
    var v = this.video;
    if (v.preload !== 'auto') v.preload = 'auto';
    var p = v.play();
    if (p && p.catch) {
      p.catch(function () {
        if (v.paused) self.stage.classList.add('is-paused');
      });
    }
  };

  ClipPlayer.prototype.toggle = function () {
    if (this.video.paused) {
      this.userPlay();
    } else {
      this.userPaused = true;
      this.video.pause();
    }
  };

  ClipPlayer.prototype.restart = function () {
    this.seek(0);
    if (this.shouldPlay()) this.play();
  };

  ClipPlayer.prototype.seek = function (t) {
    var d = this.duration || 0;
    t = Math.min(Math.max(0, t), d);
    try {
      this.video.currentTime = t;
    } catch (e) { /* not seekable yet */ }
    this.render(t);
  };

  ClipPlayer.prototype.setVisible = function (on) {
    this.visible = on;
    if (on && this.shouldPlay()) {
      if (this.video.paused && !this.video.ended) this.play();
    } else if (!on && !this.video.paused) {
      this.video.pause();
    }
  };

  ClipPlayer.prototype.setButton = function (playing) {
    var label = playing ? 'Pause' : 'Play';
    this.playBtn.innerHTML = playing ? ICON.pause : ICON.play;
    this.playBtn.setAttribute('aria-label', label);
  };

  ClipPlayer.prototype.render = function (t) {
    var d = this.duration || 0;
    t = Math.min(Math.max(0, t || 0), d);
    var pct = d ? (100 * t / d) + '%' : '0';
    this.fill.style.width = pct;
    this.knob.style.left = pct;
    this.time.textContent = clock(t) + ' / ' + clock(d);
    this.track.setAttribute('aria-valuenow', t.toFixed(1));
    this.track.setAttribute('aria-valuetext', clock(t) + ' of ' + clock(d));
    if (this.opts.onTick) this.opts.onTick(t, d);
  };

  ClipPlayer.prototype.tickLoop = function () {
    var self = this;
    cancelAnimationFrame(this.raf);
    function step() {
      self.render(self.video.currentTime);
      if (!self.video.paused && !self.video.ended) self.raf = requestAnimationFrame(step);
    }
    this.raf = requestAnimationFrame(step);
  };

  function observeVisibility(player, target, threshold) {
    var inView = !hasIO;
    function sync() { player.setVisible(inView && !document.hidden); }
    if (hasIO) {
      new IntersectionObserver(function (entries) {
        var e = entries[entries.length - 1];
        inView = e.isIntersecting && e.intersectionRatio >= threshold - 0.01;
        sync();
      }, { threshold: [0, threshold] }).observe(target);
    } else {
      sync();
    }
    document.addEventListener('visibilitychange', sync);
  }

  function Gallery(root) {
    var data = JSON.parse(root.querySelector('script[type="application/json"]').textContent);
    this.root = root;
    this.data = data;
    this.items = data.clips || [];
    this.items.forEach(function (it) { it.label = it.label || data.chip + ': ' + it.title; });
    this.index = -1;
    this.auto = true;
    this.hold = 0;
    if (data.aspect) root.style.setProperty('--nv-aspect', data.aspect);
    this.build();
  }

  Gallery.prototype.build = function () {
    var self = this;
    var items = this.items;
    var n = items.length;

    this.player = new ClipPlayer({
      onTick: function (t, d) { self.tick(t, d); },
      onEnded: function () { self.ended(); },
      onPlaying: function () { self.warmNext(); }
    });

    var panel = h('div', 'nv-panel');
    this.meta = h('div', 'nv-meta', '<span class="nv-chip">' + esc(this.data.chip) + '</span><span class="nv-count"></span>');
    this.title = h('div', 'nv-title');
    this.text = h('p', 'nv-text');
    var tags = h('ul', 'nv-tags');
    (this.data.tags || []).forEach(function (t) { tags.append(h('li', null, esc(t))); });
    panel.append(this.meta, this.title, this.text, tags);

    var strip = h('div', 'nv-strip');
    var head = h('div', 'nv-strip-head', '<span class="nv-strip-label">' + esc(this.data.label) + '</span>');
    this.autoBtn = button('nv-auto', '<span class="nv-auto-track" aria-hidden="true"></span><span>Auto-advance</span>');
    this.autoBtn.setAttribute('role', 'switch');
    this.autoBtn.setAttribute('aria-checked', 'true');
    this.autoBtn.addEventListener('click', function () { self.setAuto(!self.auto); });
    head.append(this.autoBtn);

    var row = h('div', 'nv-strip-row');
    var prev = button('nv-nav', ICON.prev, 'Previous clip');
    var next = button('nv-nav', ICON.next, 'Next clip');
    prev.addEventListener('click', function () { self.pick(self.index - 1); });
    next.addEventListener('click', function () { self.pick(self.index + 1); });
    this.thumbs = h('div', 'nv-thumbs');
    this.thumbs.setAttribute('role', 'group');
    this.thumbs.setAttribute('aria-label', this.data.label);
    items.forEach(function (it, i) {
      var b = button('nv-thumb', null, 'Play clip ' + (i + 1) + ' of ' + n + ': ' + it.title);
      b.innerHTML = '<span class="nv-thumb-img"><img src="' + esc(it.thumb) + '" alt="" width="220" height="250" loading="lazy" decoding="async">' +
        '<span class="nv-thumb-n">' + (i + 1) + '</span><span class="nv-thumb-bar"></span></span>' +
        '<span class="nv-thumb-label">' + esc(it.title) + '</span>';
      b.addEventListener('click', function () { self.pick(i); });
      self.thumbs.append(b);
    });
    row.append(prev, this.thumbs, next);
    strip.append(head, row);

    var layout = h('div', 'nv-layout');
    layout.append(this.player.el, panel, strip);
    var body = this.root.querySelector('.nv-body');
    body.innerHTML = '';
    body.append(layout);
    this.root.classList.add('is-ready');

    this.root.addEventListener('keydown', function (e) {
      if (e.target === self.player.track || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault();
        var onThumb = e.target.parentNode === self.thumbs;
        var from = onThumb ? [].indexOf.call(self.thumbs.children, e.target) : self.index;
        self.pick(from + (e.key === 'ArrowRight' ? 1 : -1));
        if (onThumb) self.thumbs.children[self.index].focus();
      }
    });

    this.select(0);
    whenNear(this.root, '400px 0px', function () {
      self.player.setNear();
      self.warmNext();
    });
    observeVisibility(this.player, this.player.stage, 0.4);
  };

  Gallery.prototype.select = function (i) {
    var n = this.items.length;
    i = ((i % n) + n) % n;
    clearTimeout(this.hold);
    var old = this.thumbs.children[this.index];
    if (old) {
      old.removeAttribute('aria-current');
      old.querySelector('.nv-thumb-bar').style.width = '0';
    }
    this.index = i;
    var it = this.items[i];
    var cur = this.thumbs.children[i];
    cur.setAttribute('aria-current', 'true');
    this.meta.lastChild.textContent = (i + 1) + ' / ' + n;
    this.title.textContent = it.title;
    this.text.textContent = it.text;
    this.scrollThumb(cur);
    this.player.load(it);
    if (this.player.near) this.warmNext();
  };

  Gallery.prototype.warmNext = function () {
    var nx = this.items[(this.index + 1) % this.items.length];
    if (nx && !nx.warm) {
      nx.warm = true;
      new Image().src = nx.poster;
    }
  };

  Gallery.prototype.tick = function (t, d) {
    var cur = this.thumbs.children[this.index];
    if (cur && d) cur.querySelector('.nv-thumb-bar').style.width = (100 * t / d) + '%';
  };

  Gallery.prototype.pick = function (i) {
    var p = this.player;
    p.consent = true;
    p.userPaused = false;
    clearTimeout(this.hold);
    if (i === this.index) p.seek(0);
    else this.select(i);
    p.setNear();
    p.play();
  };

  Gallery.prototype.ended = function () {
    var self = this;
    clearTimeout(this.hold);
    if (this.player.userPaused) return;
    if (this.auto) {
      this.hold = setTimeout(function () { self.select(self.index + 1); }, 700);
    } else {
      this.hold = setTimeout(function () { self.player.restart(); }, 400);
    }
  };

  Gallery.prototype.setAuto = function (on) {
    var p = this.player;
    this.auto = on;
    this.autoBtn.setAttribute('aria-checked', String(on));
    if (on) {
      p.consent = true;
      p.userPaused = false;
    }
    if (p.video.ended) this.ended();
    else if (on && p.video.paused && p.shouldPlay()) p.play();
  };

  Gallery.prototype.scrollThumb = function (b) {
    var s = this.thumbs;
    if (s.scrollWidth <= s.clientWidth) return;
    var left = b.offsetLeft - (s.clientWidth - b.offsetWidth) / 2;
    if (s.scrollTo) s.scrollTo({ left: Math.max(0, left), behavior: reduceMotion ? 'auto' : 'smooth' });
    else s.scrollLeft = left;
  };

  [].forEach.call(document.querySelectorAll('.nv-viewer'), function (el) {
    try {
      new Gallery(el);
    } catch (err) {
      el.classList.add('is-failed');
    }
  });
})();
