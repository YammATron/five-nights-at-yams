/* The recordings remain byte-identical to the files supplied by the player. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.YamsAudio = factory();
})(typeof window !== 'undefined' ? window : this, function () {
  'use strict';
  function reset(media) { if (!media) return; try { media.pause(); media.currentTime = 0; } catch (_) {} }
  function GameAudio(options) {
    options = options || {};
    this.env = options.env || window;
    this.onStatus = options.onStatus || function () {};
    this.track = null;
    this.kind = '';
    this.generation = 0;
    this.attempt = 0;
    this.muted = false;
    this.paused = false;
    this.context = null;
    this.output = null;
    this.voices = [];
  }
  GameAudio.prototype.setMuted = function (muted) {
    this.muted = Boolean(muted);
    if (this.track) this.track.muted = this.muted;
    if (this.output && this.context) this.output.gain.setTargetAtTime(this.muted ? 0 : .12, this.context.currentTime, .02);
    if (this.track) this.onStatus(this.paused ? 'paused' : this.muted ? 'muted' : this.kind + '-playing');
  };
  GameAudio.prototype.playTrack = function (source, kind, volume, loop) {
    this.stop();
    this.paused = false;
    this.kind = kind;
    var generation = this.generation;
    var self = this;
    try {
      var media = new this.env.Audio(source);
      media.preload = 'auto'; media.loop = loop; media.volume = volume; media.muted = this.muted;
      this.track = media;
      media.addEventListener('error', function () {
        reset(media);
        if (self.track === media && generation === self.generation) { self.track = null; self.onStatus('unavailable'); }
      });
      return this.playCurrent();
    } catch (_) { this.onStatus('unavailable'); return Promise.resolve(false); }
  };
  GameAudio.prototype.playCurrent = function () {
    var media = this.track;
    if (!media) return Promise.resolve(false);
    var self = this, generation = this.generation, attempt = ++this.attempt;
    this.onStatus('starting');
    try {
      return Promise.resolve(media.play()).then(function () {
        if (self.track !== media || generation !== self.generation) { reset(media); return false; }
        if (self.paused) { media.pause(); self.onStatus('paused'); return false; }
        if (attempt !== self.attempt) return false;
        self.onStatus(self.muted ? 'muted' : self.kind + '-playing'); return true;
      }, function () {
        if (self.track !== media || generation !== self.generation) { reset(media); return false; }
        if (attempt === self.attempt) self.onStatus(self.paused ? 'paused' : 'unavailable');
        return false;
      });
    } catch (_) { this.onStatus('unavailable'); return Promise.resolve(false); }
  };
  GameAudio.prototype.start = function () { this.prepareContext(); return this.playTrack('assets/audio/office.mp3', 'ambience', .22, true); };
  GameAudio.prototype.jumpscare = function () { return this.playTrack('assets/audio/jumpscare.mp3', 'jump', .58, false); };
  GameAudio.prototype.stopVoices = function () {
    this.voices.forEach(function (voice) { try { voice.source.stop(); } catch (_) {} voice.nodes.forEach(function (node) { try { node.disconnect(); } catch (_) {} }); });
    this.voices = [];
  };
  GameAudio.prototype.stop = function () { this.generation += 1; this.attempt += 1; reset(this.track); this.track = null; this.stopVoices(); this.onStatus('stopped'); };
  GameAudio.prototype.pause = function () { this.paused = true; if (this.track) this.track.pause(); this.stopVoices(); this.onStatus('paused'); };
  GameAudio.prototype.resume = function () { this.paused = false; this.prepareContext(); return this.playCurrent(); };
  GameAudio.prototype.prepareContext = function () {
    try {
      var Context = this.env.AudioContext || this.env.webkitAudioContext;
      if (!Context) return;
      if (!this.context) { this.context = new Context(); this.output = this.context.createGain(); this.output.gain.value = this.muted ? 0 : .12; this.output.connect(this.context.destination); }
      if (this.context.state !== 'running') Promise.resolve(this.context.resume()).catch(function () {});
    } catch (_) { /* Recordings work independently of optional cue synthesis. */ }
  };
  GameAudio.prototype.cue = function (type, side) {
    if (this.muted || this.paused || !this.context || this.context.state !== 'running') return;
    var self = this, ctx = this.context, now = ctx.currentTime;
    var frequencies = type === 'win' ? [392, 523, 659] : type === 'rush' ? [67, 59, 51] : type === 'blackout' ? [43] : type === 'door-block' ? [52] : type === 'shadow-warning' ? [91, 83] : [75];
    frequencies.forEach(function (frequency, index) {
      try {
        var oscillator = ctx.createOscillator(), gain = ctx.createGain(), pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
        oscillator.type = type === 'win' ? 'sine' : 'triangle'; oscillator.frequency.value = frequency;
        var start = now + index * .16, length = type === 'win' ? .38 : .14;
        gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(type === 'win' ? .35 : .55, start + .018); gain.gain.exponentialRampToValueAtTime(.0001, start + length);
        oscillator.connect(gain); var nodes = [oscillator, gain];
        if (pan) { pan.pan.value = side === 'left' ? -.75 : side === 'right' ? .75 : 0; gain.connect(pan); pan.connect(self.output); nodes.push(pan); } else gain.connect(self.output);
        var voice = { source: oscillator, nodes: nodes }; self.voices.push(voice);
        oscillator.onended = function () { nodes.forEach(function (node) { try { node.disconnect(); } catch (_) {} }); var i = self.voices.indexOf(voice); if (i >= 0) self.voices.splice(i, 1); };
        oscillator.start(start); oscillator.stop(start + length);
      } catch (_) {}
    });
  };
  return GameAudio;
});
