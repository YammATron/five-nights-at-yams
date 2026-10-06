/* Five Nights at Yams: deterministic, DOM-free survival simulation. */
(function (root, factory) {
  'use strict';
  var engine = factory();
  if (typeof module === 'object' && module.exports) module.exports = engine;
  else root.YamsEngine = engine;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DURATION = 240;
  var STEP = .05;
  var EPSILON = 1e-8;
  var POWER_RATES = Object.freeze({ idle: .18, door: .22, light: .10, monitor: .075 });
  var ROOMS = Object.freeze({
    stage: Object.freeze({ id: 'stage', name: 'Sniff Stage', camera: 'CAM 01', asset: 'stage.png' }),
    dining: Object.freeze({ id: 'dining', name: 'Sniff & Slice Dining', camera: 'CAM 02', asset: 'dining.png' }),
    storage: Object.freeze({ id: 'storage', name: 'Schnoz Storage', camera: 'CAM 03', asset: 'storage.png' }),
    cove: Object.freeze({ id: 'cove', name: 'Yam Cove', camera: 'CAM 04', asset: 'cove.png' }),
    'left-hall': Object.freeze({ id: 'left-hall', name: 'Left Nose Hall', camera: 'CAM 05', asset: 'left-hall.png' }),
    'right-hall': Object.freeze({ id: 'right-hall', name: 'Right Nose Hall', camera: 'CAM 06', asset: 'right-hall.png' }),
    'right-corner': Object.freeze({ id: 'right-corner', name: 'Right Nose Corner', camera: 'CAM 07', asset: 'right-corner.png' })
  });
  var CAMERA_IDS = Object.freeze(Object.keys(ROOMS));
  var SHADOW_ROUTE = Object.freeze(['stage', 'dining', 'right-hall', 'right-corner', 'door-right']);
  var NIGHT_CONFIGS = {};
  for (var nightNumber = 1; nightNumber <= 5; nightNumber += 1) {
    var level = nightNumber - 1;
    NIGHT_CONFIGS[nightNumber] = Object.freeze({
      long: Object.freeze({ interval: Object.freeze([6 - level * .65, 10 - level]), chance: .58 + level * .06, grace: 7 - level * .7, retreat: 3.6 - level * .2, initial: Object.freeze([14 - level * 2, 24 - level * 3.5]) }),
      wide: Object.freeze({ interval: Object.freeze([8 - level * .875, 13 - level * 1.25]), chance: .55 + level * .0575, grace: 8 - level * .8, retreat: 7 - level * .125, initial: Object.freeze([19 - level * 3, 29 - level * 4]) }),
      bulb: Object.freeze({ thresholds: Object.freeze([20 - level * 2, 32 - level * 3, 44 - level * 4, 56 - level * 5]), calmRate: 5, rushGrace: 5.5 - level * .5, penalty: 5 + level * .75 }),
      shadow: Object.freeze({ interval: Object.freeze([17 - level * 2, 25 - level * 3]), chance: .60 + level * .08, grace: 6.5 - level * .7, retreat: 6.5 - level * .25, initial: Object.freeze([45 - level * 6, 60 - level * 8]) }),
      blackoutDelay: 12 - level
    });
  }
  Object.freeze(NIGHT_CONFIGS);

  function copy(value) { return JSON.parse(JSON.stringify(value)); }
  function clamp(value, low, high) { return Math.max(low, Math.min(high, value)); }
  function hasRoom(room) { return Object.prototype.hasOwnProperty.call(ROOMS, room); }
  function Game(options) {
    options = options || {};
    var requestedNight = options.night == null ? 1 : Number(options.night);
    if (!Number.isInteger(requestedNight) || requestedNight < 1 || requestedNight > 5) throw new RangeError('Night must be an integer from 1 to 5.');
    if (options.rng != null && typeof options.rng !== 'function') throw new TypeError('rng must be a function returning a number between 0 and 1.');
    this.night = requestedNight;
    this.config = NIGHT_CONFIGS[requestedNight];
    this.rng = options.rng || Math.random;
    this.status = 'playing';
    this.elapsed = 0;
    this.power = 100;
    this.doors = { left: false, right: false };
    this.lights = { left: false, right: false };
    this.monitor = false;
    this.camera = 'stage';
    this.lossEnemy = null;
    this.lossReason = null;
    this.blackoutRemaining = null;
    this.enemies = {};
    this._events = [];
    this._sequence = 0;
    this._accumulator = 0;
    this._pausedFrom = null;
    this._bulbNeglect = 0;
    this._retreats = {};
    this._makeWanderer('long', 'Long Yam', 'left');
    this._makeWanderer('wide', 'Wide Yam', 'right');
    this.enemies.bulb = { id: 'bulb', name: 'Bulb Yam', room: 'cove', phase: 'resting', stage: 0, nextMoveIn: null, attackIn: null, rushIn: null, side: 'left', blocked: false, retreatIn: null };
    this.enemies.shadow = { id: 'shadow', name: 'Shadow Yam', room: 'stage', phase: 'wandering', stage: 0, nextMoveIn: this._range(this.config.shadow.initial), attackIn: null, rushIn: null, side: 'right', blocked: false, retreatIn: null, routeIndex: 0 };
  }
  Game.prototype._random = function () {
    var value = Number(this.rng());
    if (!Number.isFinite(value)) throw new TypeError('rng must return a finite number.');
    return clamp(value, 0, 1 - Number.EPSILON);
  };
  Game.prototype._range = function (bounds) { return bounds[0] + this._random() * (bounds[1] - bounds[0]); };
  Game.prototype._makeWanderer = function (id, name, side) {
    this.enemies[id] = { id: id, name: name, room: 'stage', phase: 'wandering', stage: 0, nextMoveIn: this._range(this.config[id].initial), attackIn: null, rushIn: null, side: side, blocked: false, retreatIn: null };
  };
  Game.prototype._event = function (type, details) {
    var event = { seq: ++this._sequence, type: type, time: this.elapsed };
    Object.keys(details || {}).forEach(function (key) { event[key] = details[key]; });
    this._events.push(event);
  };
  Game.prototype.drainEvents = function () { var events = this._events; this._events = []; return copy(events); };
  Game.prototype._drainRate = function () {
    if (this.status === 'blackout' || (this.status === 'paused' && this._pausedFrom === 'blackout')) return 0;
    return POWER_RATES.idle + POWER_RATES.door * (Number(this.doors.left) + Number(this.doors.right)) + POWER_RATES.light * (Number(this.lights.left) + Number(this.lights.right)) + POWER_RATES.monitor * Number(this.monitor);
  };
  Game.prototype.snapshot = function () {
    var visible = { left: [], right: [] };
    var operational = this.status === 'playing' || (this.status === 'paused' && this._pausedFrom === 'playing');
    if (!this.monitor && operational) {
      ['long', 'wide'].forEach(function (id) {
        var enemy = this.enemies[id];
        if (this.lights[enemy.side] && enemy.phase === 'atDoor') visible[enemy.side].push(id);
      }, this);
    }
    return {
      status: this.status, night: this.night, elapsed: this.elapsed, duration: DURATION,
      hour: Math.min(6, Math.floor((this.elapsed + EPSILON) / (DURATION / 6))), power: this.power,
      usage: operational ? 1 + Number(this.doors.left) + Number(this.doors.right) + Number(this.lights.left) + Number(this.lights.right) + Number(this.monitor) : 0,
      drainRate: this.status === 'playing' ? this._drainRate() : 0,
      doors: copy(this.doors), lights: copy(this.lights), monitor: this.monitor, camera: this.camera,
      enemies: copy(this.enemies), visibleAtDoor: visible, events: copy(this._events),
      lossEnemy: this.lossEnemy, lossReason: this.lossReason, blackoutRemaining: this.blackoutRemaining
    };
  };
  Game.prototype.act = function (type, argument) {
    if (type === 'pause') {
      if (this.status === 'paused') return true;
      if (this.status !== 'playing' && this.status !== 'blackout') return false;
      this._pausedFrom = this.status;
      this.status = 'paused';
      return true;
    }
    if (type === 'resume') {
      if (this.status !== 'paused') return false;
      this.status = this._pausedFrom;
      this._pausedFrom = null;
      return true;
    }
    if (this.status !== 'playing' || this.power <= 0) return false;
    if (type === 'door' || type === 'light') {
      var options = typeof argument === 'string' ? { side: argument } : argument || {};
      if (options.side !== 'left' && options.side !== 'right') return false;
      if (type === 'light' && this.monitor) return false;
      var store = type === 'door' ? this.doors : this.lights;
      var key = type === 'door' ? 'closed' : 'on';
      if (options[key] != null && typeof options[key] !== 'boolean') return false;
      store[options.side] = options[key] == null ? !store[options.side] : options[key];
      return true;
    }
    if (type === 'monitor') {
      var desired;
      if (argument == null) desired = !this.monitor;
      else if (typeof argument === 'boolean') desired = argument;
      else if (typeof argument === 'object' && !Array.isArray(argument) && typeof argument.on === 'boolean') desired = argument.on;
      else return false;
      this.monitor = desired;
      if (this.monitor) this.lights = { left: false, right: false };
      return true;
    }
    if (type === 'camera') {
      var room = typeof argument === 'string' ? argument : argument && argument.room;
      if (!hasRoom(room)) return false;
      this.camera = room;
      return true;
    }
    return false;
  };
  Game.prototype._lose = function (enemy, reason) {
    if (this.status !== 'playing' && this.status !== 'blackout') return;
    this.status = 'lost';
    this.lossEnemy = enemy;
    this.lossReason = reason;
    this.monitor = false;
    this.lights = { left: false, right: false };
    this._event('loss', { enemy: enemy, reason: reason });
  };
  Game.prototype._win = function () {
    if (this.status !== 'playing' && this.status !== 'blackout') return;
    this.elapsed = DURATION;
    this.status = 'won';
    this._event('win', { night: this.night });
  };
  Game.prototype._blackout = function () {
    if (this.status !== 'playing') return;
    this.power = 0;
    this.doors = { left: false, right: false };
    this.lights = { left: false, right: false };
    this.monitor = false;
    this.status = 'blackout';
    this.blackoutRemaining = this.config.blackoutDelay;
    this._event('blackout', { enemy: 'shadow', grace: this.blackoutRemaining });
  };
  Game.prototype._move = function (enemy, room) {
    var previous = enemy.room;
    enemy.room = room;
    this._event('step', { enemy: enemy.id, side: enemy.side, from: previous, to: room });
    if (room === 'door-' + enemy.side) {
      enemy.phase = 'atDoor';
      enemy.nextMoveIn = null;
      enemy.attackIn = this.config[enemy.id].grace;
      enemy.retreatIn = this.config[enemy.id].retreat;
      enemy.blocked = false;
      this._event(enemy.id === 'shadow' ? 'shadow-warning' : 'door-warning', { enemy: enemy.id, side: enemy.side, grace: enemy.attackIn });
    }
  };
  Game.prototype._atDoor = function (enemy, dt) {
    enemy.attackIn = Math.max(0, enemy.attackIn - dt);
    if (this.doors[enemy.side]) {
      if (!enemy.blocked) {
        enemy.blocked = true;
        this._event('door-block', { enemy: enemy.id, side: enemy.side, penalty: 0 });
      }
      enemy.retreatIn -= dt;
      if (enemy.retreatIn <= EPSILON) {
        enemy.phase = 'retreating';
        enemy.attackIn = null;
        enemy.retreatIn = null;
        enemy.blocked = false;
        this._retreats[enemy.id] = enemy.id === 'long' ? ['left-hall', 'dining', 'storage'] : ['right-corner', 'right-hall', 'dining', 'stage'];
        this._move(enemy, this._retreats[enemy.id].shift());
        enemy.nextMoveIn = .65;
        this._event('retreat', { enemy: enemy.id, side: enemy.side });
      }
    } else if (enemy.attackIn <= EPSILON) this._lose(enemy.id, 'door');
  };
  Game.prototype._retreat = function (enemy, dt) {
    enemy.nextMoveIn -= dt;
    if (enemy.nextMoveIn > EPSILON) return;
    var path = this._retreats[enemy.id];
    if (path && path.length) this._move(enemy, path.shift());
    if (!path || !path.length) {
      enemy.phase = 'wandering';
      if (enemy.id === 'shadow') enemy.routeIndex = 0;
      delete this._retreats[enemy.id];
      enemy.nextMoveIn = this._range(this.config[enemy.id].interval);
    } else enemy.nextMoveIn += .65;
  };
  Game.prototype._wander = function (enemy, dt) {
    if (enemy.phase === 'retreating') { this._retreat(enemy, dt); return; }
    if (enemy.phase === 'atDoor') { this._atDoor(enemy, dt); return; }
    enemy.nextMoveIn -= dt;
    if (enemy.nextMoveIn > EPSILON) return;
    var config = this.config[enemy.id];
    enemy.nextMoveIn += this._range(config.interval);
    if (this._random() >= config.chance) return;
    var next;
    if (enemy.id === 'long') {
      if (enemy.room === 'stage') next = this._random() < .30 ? 'storage' : 'dining';
      else if (enemy.room === 'storage') next = this._random() < .20 ? 'stage' : 'dining';
      else if (enemy.room === 'dining') next = this._random() < .15 ? 'storage' : 'left-hall';
      else next = this._random() < .12 ? 'dining' : 'door-left';
    } else {
      var route = ['stage', 'dining', 'right-hall', 'right-corner', 'door-right'];
      var index = route.indexOf(enemy.room);
      next = index > 0 && this._random() < .14 ? route[index - 1] : route[index + 1];
    }
    this._move(enemy, next);
  };
  Game.prototype._bulb = function (dt) {
    var enemy = this.enemies.bulb;
    var config = this.config.bulb;
    if (enemy.phase === 'rushing') {
      enemy.rushIn = Math.max(0, enemy.rushIn - dt);
      if (enemy.rushIn > EPSILON) return;
      if (!this.doors.left) { this._lose('bulb', 'rush'); return; }
      this._event('door-block', { enemy: 'bulb', side: 'left', penalty: config.penalty });
      this.power = Math.max(0, this.power - config.penalty);
      enemy.phase = 'resting';
      enemy.stage = 0;
      enemy.rushIn = null;
      this._bulbNeglect = 0;
      this._move(enemy, 'cove');
      this._event('retreat', { enemy: 'bulb', side: 'left' });
      if (this.power <= EPSILON) this._blackout();
      return;
    }
    this._bulbNeglect = this.monitor ? Math.max(0, this._bulbNeglect - dt * config.calmRate) : this._bulbNeglect + dt;
    enemy.stage = config.thresholds.slice(0, 3).filter(function (threshold) { return this._bulbNeglect + EPSILON >= threshold; }, this).length;
    enemy.phase = enemy.stage ? 'preparing' : 'resting';
    if (this._bulbNeglect + EPSILON >= config.thresholds[3]) {
      enemy.phase = 'rushing';
      enemy.stage = 3;
      enemy.rushIn = config.rushGrace;
      this._move(enemy, 'left-hall');
      this._event('rush', { enemy: 'bulb', side: 'left', grace: enemy.rushIn });
    }
  };
  Game.prototype._shadow = function (dt) {
    var enemy = this.enemies.shadow;
    if (enemy.phase === 'retreating') { this._retreat(enemy, dt); return; }
    if (enemy.phase === 'atDoor') { this._atDoor(enemy, dt); return; }
    if (this.monitor && this.camera === enemy.room) return;
    enemy.nextMoveIn -= dt;
    if (enemy.nextMoveIn > EPSILON) return;
    enemy.nextMoveIn += this._range(this.config.shadow.interval);
    if (this._random() >= this.config.shadow.chance) return;
    enemy.routeIndex += 1;
    this._move(enemy, SHADOW_ROUTE[enemy.routeIndex]);
    if (enemy.room === 'right-corner') this._event('shadow-warning', { enemy: 'shadow', side: 'right', room: 'right-corner', grace: null });
  };
  Game.prototype._step = function (dt) {
    this.elapsed += dt;
    // Morning resolves first whenever an attack or blackout expires on 6 AM.
    if (this.elapsed + EPSILON >= DURATION) { this._win(); return; }
    if (this.status === 'blackout') {
      this.blackoutRemaining = Math.max(0, this.blackoutRemaining - dt);
      if (this.blackoutRemaining <= EPSILON) {
        this.blackoutRemaining = 0;
        this._lose('shadow', 'blackout');
      }
      return;
    }
    this.power = Math.max(0, this.power - this._drainRate() * dt);
    if (this.power <= EPSILON) { this._blackout(); return; }
    this._wander(this.enemies.long, dt);
    if (this.status !== 'playing') return;
    this._wander(this.enemies.wide, dt);
    if (this.status !== 'playing') return;
    this._bulb(dt);
    if (this.status !== 'playing') return;
    this._shadow(dt);
  };
  Game.prototype.tick = function (dt) {
    if (typeof dt !== 'number' || !Number.isFinite(dt) || dt < 0) throw new RangeError('tick requires a finite, nonnegative number of seconds.');
    if (this.status !== 'playing' && this.status !== 'blackout') return this.snapshot();
    this._accumulator += Math.min(dt, DURATION);
    while (this._accumulator + EPSILON >= STEP && (this.status === 'playing' || this.status === 'blackout')) {
      this._accumulator = Math.max(0, this._accumulator - STEP);
      this._step(STEP);
    }
    if (this.status === 'won' || this.status === 'lost') this._accumulator = 0;
    return this.snapshot();
  };

  return Object.freeze({
    createGame: function (options) { return new Game(options); },
    Game: Game, ROOMS: ROOMS, CAMERA_IDS: CAMERA_IDS,
    NIGHT_CONFIGS: NIGHT_CONFIGS, POWER_RATES: POWER_RATES,
    DURATION: DURATION, STEP: STEP
  });
});
