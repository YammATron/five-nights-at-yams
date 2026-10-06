/* Local, dependency-free opening film. The only integration event is
   window: yams:intro-complete, with detail { skipped: boolean }. */
(function () {
  'use strict';

  var DURATION = 20;
  var experience = document.getElementById('experience');
  var portrait = document.getElementById('shadow-portrait');
  var titlePanel = document.getElementById('title-panel');
  var title = document.getElementById('game-title');
  var beginButton = document.getElementById('begin-button');
  var skipButton = document.getElementById('skip-button');
  var muteButton = document.getElementById('mute-button');
  var soundLabel = document.getElementById('sound-label');
  var readyActions = document.getElementById('ready-actions');
  var menuActions = document.getElementById('menu-actions');
  var replayButton = document.getElementById('replay-button');
  var galleryButton = document.getElementById('gallery-button');
  var gallery = document.getElementById('character-gallery');
  var closeGallery = document.getElementById('close-gallery');
  var loadingStatus = document.getElementById('loading-status');
  var filmCounter = document.getElementById('film-counter');
  var readerStatus = document.getElementById('screen-reader-status');
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  var state = { mode: 'ready', muted: false, raf: 0, run: 0, start: 0, completionSent: false };

  function clamp(value, low, high) { return Math.min(high, Math.max(low, value)); }
  function smooth(value) { value = clamp(value, 0, 1); return value * value * (3 - 2 * value); }

  // Kept pure so exact boundaries and reduced-motion behavior can be verified.
  function timelineAt(seconds, reduce) {
    var time = clamp(seconds, 0, DURATION);
    var opacity = time < 3 || time >= 15 ? 0 : smooth((time - 3) / 5) * .95;
    if (!reduce && time >= 8 && time < 13) {
      [[8.8, 10.4], [11.1, 12.9]].forEach(function (dip) {
        if (time > dip[0] && time < dip[1]) {
          opacity *= 1 - .34 * Math.pow(Math.sin(Math.PI * (time - dip[0]) / (dip[1] - dip[0])), 2);
        }
      });
    }
    return {
      phase: time < 3 ? 'black' : time < 8 ? 'emerge' : time < 13 ? 'approach' : time < 15 ? 'stare' : time < 16 ? 'blackout' : 'title-reveal',
      portraitOpacity: opacity,
      portraitScale: reduce ? 1 : 1 + .085 * smooth((time - 8) / 5),
      titleOpacity: time < 16 ? 0 : smooth((time - 16) / 3.6),
      progress: time / DURATION,
      second: Math.floor(time)
    };
  }

  function renderFrame(seconds) {
    var frame = timelineAt(seconds, reducedMotion.matches);
    experience.dataset.phase = frame.phase;
    experience.style.setProperty('--portrait-opacity', frame.portraitOpacity.toFixed(4));
    experience.style.setProperty('--portrait-scale', frame.portraitScale.toFixed(4));
    experience.style.setProperty('--title-opacity', frame.titleOpacity.toFixed(4));
    experience.style.setProperty('--film-progress', (frame.progress * 100).toFixed(3) + '%');
    filmCounter.textContent = '00 : ' + String(frame.second).padStart(2, '0');
  }

  // Each playback owns its own local Office.mp3 player and optional soft breath.
  // Cleanup always targets that player's instance, including stale play promises.
  function FilmAudio() {
    this.context = null;
    this.output = null;
    this.ambience = null;
    this.elapsed = 0;
    this.timer = 0;
    this.sources = [];
    this.nodes = [];
    this.token = 0;
    this.muted = false;
  }
  FilmAudio.prototype.setMuted = function (muted) {
    this.muted = muted;
    this.update(this.elapsed);
    if (this.context && this.output) {
      this.output.gain.cancelScheduledValues(this.context.currentTime);
      this.output.gain.setTargetAtTime(muted ? 0 : .7, this.context.currentTime, .025);
    }
  };
  function resetMedia(media) {
    if (!media) return;
    try { media.pause(); } catch (_) { /* Unavailable player. */ }
    try { media.currentTime = 0; } catch (_) { /* Metadata is not ready. */ }
  }
  FilmAudio.prototype.update = function (seconds) {
    this.elapsed = seconds;
    if (!this.ambience) return;
    var level = seconds < 3 ? smooth(seconds / 3) : seconds < 15 ? 1 : 1 - smooth(seconds - 15);
    this.ambience.muted = this.muted;
    this.ambience.volume = this.muted ? 0 : .18 * level;
    if (seconds >= 16) {
      resetMedia(this.ambience);
      this.ambience = null;
    }
  };
  FilmAudio.prototype.stopSynthetic = function () {
    this.sources.forEach(function (source) { try { source.stop(); } catch (_) { /* Already stopped. */ } source.disconnect(); });
    this.nodes.forEach(function (node) { node.disconnect(); });
    this.sources = [];
    this.nodes = [];
  };
  FilmAudio.prototype.stop = function () {
    this.token += 1;
    window.clearTimeout(this.timer);
    this.timer = 0;
    resetMedia(this.ambience);
    this.ambience = null;
    this.stopSynthetic();
  };
  FilmAudio.prototype.start = function (getElapsed, isCurrent) {
    this.stop();
    var token = this.token;
    var self = this;
    var media;
    var failed = false;
    var playback;
    try {
      media = new window.Audio('assets/audio/office.mp3');
      media.preload = 'auto';
      media.loop = true;
      this.ambience = media;
      this.update(getElapsed());
      media.addEventListener('error', function () {
        failed = true;
        resetMedia(media);
        if (self.ambience === media) self.ambience = null;
        if (token === self.token && isCurrent() && getElapsed() < 16) experience.dataset.audioState = 'unavailable';
      });
      // Called directly in the Begin/Replay gesture for local-file autoplay rules.
      playback = Promise.resolve(media.play()).then(function () {
        if (failed || token !== self.token || !isCurrent() || getElapsed() >= 16) {
          resetMedia(media);
          return false;
        }
        self.update(getElapsed());
        return true;
      }, function () {
        resetMedia(media);
        if (self.ambience === media) self.ambience = null;
        return false;
      });
    } catch (_) {
      resetMedia(media);
      if (this.ambience === media) this.ambience = null;
      playback = Promise.resolve(false);
    }
    // A timer also advances the ambience envelope when background tabs suspend
    // visual animation frames. Every scheduled callback belongs to this run.
    function audioTick() {
      if (token !== self.token || !isCurrent()) return;
      self.timer = 0;
      var seconds = getElapsed();
      self.update(seconds);
      if (seconds >= 16) experience.dataset.audioState = 'silent';
      else if (self.ambience) self.timer = window.setTimeout(audioTick, 50);
    }
    if (this.ambience) this.timer = window.setTimeout(audioTick, 50);
    this.startBreath(token, getElapsed, isCurrent);
    return playback;
  };
  FilmAudio.prototype.startBreath = async function (token, getElapsed, isCurrent) {
    var Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return false;
    try {
      if (!this.context) {
        this.context = new Context();
        this.output = this.context.createGain();
        this.output.gain.value = this.muted ? 0 : .7;
        this.output.connect(this.context.destination);
      }
      if (this.context.state !== 'running') await this.context.resume();
      if (token !== this.token || !isCurrent()) return false;
      var elapsed = getElapsed();
      if (elapsed >= 15) return false;
      var ctx = this.context;
      var now = ctx.currentTime;
      var origin = now - elapsed;
      var envelope = ctx.createGain();
      envelope.gain.setValueAtTime(.34, now);
      envelope.gain.setValueAtTime(.34, origin + 15);
      envelope.gain.linearRampToValueAtTime(0, origin + 16);
      envelope.connect(this.output);
      this.nodes.push(envelope);
      // Filtered, locally generated noise gives two soft breaths at 13–15 s.
      var buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      var samples = buffer.getChannelData(0);
      for (var i = 0; i < samples.length; i += 1) samples[i] = Math.random() * 2 - 1;
      var breath = ctx.createBufferSource();
      breath.buffer = buffer;
      breath.loop = true;
      var highpass = ctx.createBiquadFilter();
      highpass.type = 'highpass';
      highpass.frequency.value = 300;
      var lowpass = ctx.createBiquadFilter();
      lowpass.type = 'lowpass';
      lowpass.frequency.value = 1500;
      var breathLevel = ctx.createGain();
      breathLevel.gain.setValueAtTime(0, now);
      [[13, 0], [13.55, .12], [14.15, 0], [14.55, .07], [15, 0]].forEach(function (point) {
        if (point[0] >= elapsed) breathLevel.gain.linearRampToValueAtTime(point[1], origin + point[0]);
      });
      breath.connect(highpass);
      highpass.connect(lowpass);
      lowpass.connect(breathLevel);
      breathLevel.connect(envelope);
      breath.start(now);
      breath.stop(origin + 16);
      this.sources.push(breath);
      this.nodes.push(highpass, lowpass, breathLevel);
      return true;
    } catch (_) {
      // Supplied ambience and the visual film continue without Web Audio.
      if (token === this.token) this.stopSynthetic();
      return false;
    }
  };
  var audio = new FilmAudio();

  function updateMuted(muted) {
    state.muted = Boolean(muted);
    audio.setMuted(state.muted);
    soundLabel.textContent = state.muted ? 'Sound off' : 'Sound on';
    muteButton.setAttribute('aria-pressed', String(state.muted));
    muteButton.setAttribute('aria-label', state.muted ? 'Unmute sound' : 'Mute sound');
    if (state.mode === 'playing' && ['running', 'muted'].indexOf(experience.dataset.audioState) !== -1) experience.dataset.audioState = state.muted ? 'muted' : 'running';
    window.dispatchEvent(new CustomEvent('yams:mute-change', { detail: { muted: state.muted } }));
  }

  function setMode(mode) {
    state.mode = mode;
    experience.dataset.mode = mode;
    readyActions.hidden = mode !== 'ready';
    menuActions.hidden = mode !== 'title';
    skipButton.hidden = mode !== 'playing';
    titlePanel.setAttribute('aria-hidden', mode === 'playing' ? 'true' : 'false');
  }

  function finishPlayback(skipped) {
    if (state.mode !== 'playing') return;
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    state.run += 1;
    audio.stop();
    experience.style.setProperty('--portrait-opacity', '.38');
    experience.style.setProperty('--portrait-scale', '1');
    experience.style.setProperty('--title-opacity', '1');
    experience.style.setProperty('--film-progress', '100%');
    setMode('title');
    experience.dataset.phase = 'title';
    experience.dataset.audioState = 'stopped';
    readerStatus.textContent = skipped ? 'Intro skipped. Five Nights at Yams title screen.' : 'Five Nights at Yams. Intro complete.';
    title.focus({ preventScroll: true });
    if (!state.completionSent) {
      state.completionSent = true;
      window.dispatchEvent(new CustomEvent('yams:intro-complete', { detail: { skipped: Boolean(skipped) } }));
    }
  }

  function startPlayback() {
    cancelAnimationFrame(state.raf);
    audio.stop();
    state.run += 1;
    var run = state.run;
    state.completionSent = false;
    state.start = performance.now();
    setMode('playing');
    renderFrame(0);
    readerStatus.textContent = 'Opening film playing. Use Skip intro or Escape to skip.';
    skipButton.focus({ preventScroll: true });
    function elapsed() { return (performance.now() - state.start) / 1000; }
    function isCurrent() { return run === state.run && state.mode === 'playing'; }
    experience.dataset.audioState = 'starting';
    audio.start(elapsed, isCurrent).then(function (started) {
      if (isCurrent()) experience.dataset.audioState = elapsed() >= 16 ? 'silent' : started ? (state.muted ? 'muted' : 'running') : 'unavailable';
    });
    function tick() {
      if (!isCurrent()) return;
      var seconds = elapsed();
      renderFrame(seconds);
      audio.update(seconds);
      if (seconds >= 16) experience.dataset.audioState = 'silent';
      if (seconds >= DURATION) finishPlayback(false);
      else state.raf = requestAnimationFrame(tick);
    }
    state.raf = requestAnimationFrame(tick);
  }

  beginButton.addEventListener('click', startPlayback);
  replayButton.addEventListener('click', startPlayback);
  skipButton.addEventListener('click', function () { finishPlayback(true); });
  muteButton.addEventListener('click', function () {
    updateMuted(!state.muted);
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape' && state.mode === 'playing') {
      event.preventDefault();
      finishPlayback(true);
    }
  });
  galleryButton.addEventListener('click', function () { gallery.showModal(); closeGallery.focus(); });
  closeGallery.addEventListener('click', function () { gallery.close(); });
  gallery.addEventListener('click', function (event) {
    if (event.target === gallery) {
      var bounds = gallery.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) gallery.close();
    }
  });
  gallery.addEventListener('close', function () { galleryButton.focus({ preventScroll: true }); });
  window.addEventListener('pagehide', function () {
    state.run += 1;
    audio.stop();
    cancelAnimationFrame(state.raf);
    state.raf = 0;
    experience.dataset.audioState = 'stopped';
  });
  window.addEventListener('pageshow', function (event) { if (event.persisted && state.mode === 'playing') finishPlayback(true); });

  function portraitReady() {
    beginButton.disabled = false;
    loadingStatus.textContent = '20 seconds · Headphones recommended';
  }
  function portraitFailed() {
    beginButton.disabled = true;
    loadingStatus.textContent = 'The portrait could not load. Keep the assets folder beside index.html, then reopen the page.';
  }
  portrait.addEventListener('load', portraitReady);
  portrait.addEventListener('error', portraitFailed);
  if (portrait.complete) {
    if (portrait.naturalWidth > 0) portraitReady();
    else portraitFailed();
  }

  function showMenu() {
    if (state.mode === 'playing') { finishPlayback(true); return; }
    audio.stop();
    state.run += 1;
    experience.style.setProperty('--portrait-opacity', '.38');
    experience.style.setProperty('--portrait-scale', '1');
    experience.style.setProperty('--title-opacity', '1');
    experience.style.setProperty('--film-progress', '100%');
    setMode('title');
    experience.dataset.phase = 'title';
    experience.dataset.audioState = 'stopped';
    title.focus({ preventScroll: true });
  }
  document.getElementById('skip-opening').addEventListener('click', showMenu);
  window.YamsIntro = { showMenu: showMenu, setMuted: updateMuted, getMuted: function () { return state.muted; } };
})();
