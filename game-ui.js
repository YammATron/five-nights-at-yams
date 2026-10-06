(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var Engine = window.YamsEngine, Intro = window.YamsIntro;
  var gamePanel = $('game'), opening = $('experience'), monitorPanel = $('monitor-panel');
  var brief = $('night-brief'), pauseDialog = $('pause-dialog'), helpDialog = $('instructions-dialog');
  var result = $('night-result'), jump = $('jumpscare');
  var cameraButtons = Array.from(document.querySelectorAll('[data-camera]'));
  var portraits = { long:'assets/long-yam.png', wide:'assets/wide-yam.png', bulb:'assets/bulb-yam.png', shadow:'assets/shadow-yam.png' };
  var names = { long:'Long Yam', wide:'Wide Yam', bulb:'Bulb Yam', shadow:'Shadow Yam' };
  var flavor = [
    'First shift. The doors work. The faces look familiar. That should be reassuring.',
    'Second shift. They know you now. Check the doorway lights before you get comfortable.',
    'Third shift. Shadow has started wandering. Follow his route through the cameras.',
    'Fourth shift. Bulb is impatient. A quick camera check can save a very long night.',
    'Last shift. Every nose is awake. Keep your checks quick and your doors purposeful.'
  ];
  var lossHints = {
    long:'Check the left light. Close the left door while Long Yam is waiting, then recheck before reopening.',
    wide:'Wide Yam uses the right doorway. He lingers; keep that door closed until he retreats.',
    bulb:'Regular camera use calms Bulb Yam. If his rush begins, close the left door immediately.',
    shadow:'Follow Shadow on the cameras. Watching his room slows him. His final approach needs the right door.'
  };
  var active = null, frame = 0, previousFrame = 0, run = 0, resultTimer = 0;
  var selectedNight = 1, newCampaign = false, ready = false, terminal = false;
  var cues = [];
  var storageAvailable = true, SAVE_KEY = 'five-nights-at-yams-save-v1';
  var save = { version:1, unlocked:1, completed:0, started:false };
  var audio = new window.YamsAudio({ onStatus:function (status) { gamePanel.dataset.audioState = status; } });

  function text(element, value) { if (element.textContent !== value) element.textContent = value; }
  function closeDialog(dialog) { if (dialog.open) dialog.close(); }
  function readSave() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        if (data.version === 1) save = { version:1, unlocked:Math.max(1,Math.min(5,Math.floor(Number(data.unlocked)||1))), completed:Math.max(0,Math.min(5,Math.floor(Number(data.completed)||0))), started:Boolean(data.started) };
      }
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (_) { storageAvailable = false; }
  }
  function writeSave() { try { window.localStorage.setItem(SAVE_KEY,JSON.stringify(save)); } catch (_) { storageAvailable = false; } updateMenu(); }
  function updateMenu() {
    $('new-game').disabled = !ready;
    $('continue-game').disabled = !ready || !save.started;
    text($('continue-game'), save.completed === 5 ? 'Replay Night 5' : 'Continue · Night ' + save.unlocked);
    $('continue-game').dataset.night = String(save.unlocked);
    $('save-status').dataset.completed = String(save.completed);
    $('save-status').dataset.unlocked = String(save.unlocked);
    if (ready) text($('save-status'), save.completed === 5 ? 'Five nights survived. Your paycheck is in the mail. Probably.' : storageAvailable ? 'Five shifts. Four faces. Progress saves on this browser.' : 'Five shifts. Four faces. Progress stays in this session.');
  }
  function syncMute() {
    var muted = Intro.getMuted(); audio.setMuted(muted);
    ['game-mute','pause-mute'].forEach(function (id) { text($(id),muted ? 'Sound off' : 'Sound on'); $(id).setAttribute('aria-pressed',String(muted)); $(id).setAttribute('aria-label',muted ? 'Unmute sound' : 'Mute sound'); });
  }
  function toggleMute() {
    Intro.setMuted(!Intro.getMuted());
    if (!Intro.getMuted() && active && active.snapshot().status === 'playing') audio.resume();
  }
  function cleanUp() {
    run += 1;
    cancelAnimationFrame(frame); frame = 0;
    window.clearTimeout(resultTimer); resultTimer = 0;
    audio.stop(); active = null; terminal = false;
    gamePanel.inert = false;
    jump.hidden = true; result.hidden = true;
    closeDialog(pauseDialog); closeDialog(brief);
  }
  function mainMenu() {
    cleanUp(); gamePanel.hidden = true; opening.hidden = false;
    gamePanel.dataset.status = 'idle'; Intro.showMenu(); updateMenu();
    (save.started ? $('continue-game') : $('new-game')).focus({preventScroll:true});
  }
  function showBrief(night, isNew) {
    selectedNight = night; newCampaign = Boolean(isNew);
    text($('brief-title'),'Night ' + night);
    text($('brief-flavor'),flavor[night - 1]);
    text($('start-shift'),'Start Night ' + night + ' →');
    brief.showModal(); $('start-shift').focus();
  }
  function startNight(night, resetCampaign) {
    cleanUp();
    if (resetCampaign) save = { version:1, unlocked:1, completed:0, started:true };
    save.started = true; writeSave();
    active = Engine.createGame({night:night});
    selectedNight = night; cues = []; previousFrame = performance.now();
    opening.hidden = true; gamePanel.hidden = false; terminal = false;
    text($('game-status-reader'),'Night ' + night + ' started. Survive until 6 AM.');
    gamePanel.dataset.night = String(night);
    $('office-scene').style.setProperty('--look-x','0%');
    text($('sound-cue'),'');
    syncMute(); audio.start();
    render(active.snapshot());
    $('monitor-button').focus({preventScroll:true});
    var currentRun = run;
    function tick(now) {
      if (!active || currentRun !== run) return;
      var state = active.tick(Math.min(.25,Math.max(0,(now-previousFrame)/1000)));
      previousFrame = now;
      processEvents(active.drainEvents()); render(state);
      if (state.status === 'won' || state.status === 'lost') { finish(state); return; }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
  }
  function action(type, argument) {
    if (!active || terminal) return;
    if (active.act(type,argument)) {
      if (type === 'door') audio.cue('door-block',argument.side);
      render(active.snapshot());
    }
  }
  function cue(message, seconds, priority, enemy) {
    var now = active ? active.snapshot().elapsed : 0;
    if (priority >= 4) cues = [];
    cues = cues.filter(function (item) { return item.until > now && item.message !== message; });
    cues.push({ message:message, until:now + (seconds || 3.5), priority:priority || 0, enemy:enemy });
  }
  function processEvents(events) {
    events.forEach(function (event) {
      if (event.type === 'rush') { audio.cue('rush','left'); cue('Fast footsteps. Left hallway.',event.grace || 4,3,event.enemy); }
      else if (event.type === 'shadow-warning') { audio.cue('shadow-warning','right'); cue(event.room === 'right-corner' ? 'A low sniff. Shadow is at the right corner.' : 'A low sniff. Just outside the right entrance.',event.grace || 4,2,event.enemy); }
      else if (event.type === 'door-warning') { audio.cue('step',event.side); cue('Something stopped outside the ' + event.side + ' doorway.',event.grace || 3,2,event.enemy); }
      else if (event.type === 'door-block') { if (event.enemy === 'bulb') cues = cues.filter(function (item) { return item.enemy !== 'bulb'; }); audio.cue('door-block',event.side); cue(event.enemy === 'bulb' ? 'A heavy knock. Yam Power lost.' : 'The shutter held. Keep checking.',3); }
      else if (event.type === 'retreat') { cues = cues.filter(function (item) { return item.enemy !== event.enemy; }); audio.cue('step',event.side); cue('Footsteps moving away on the ' + event.side + '.',2.8); }
      else if (event.type === 'step') { audio.cue('step',event.side); if (event.side && event.to && event.to.indexOf('hall') >= 0) cue('Distant footsteps on the ' + event.side + '.',2.2); }
      else if (event.type === 'blackout') { audio.stop(); audio.cue('blackout'); cue('Power out. Keep very still.',20,4); }
    });
  }
  function render(state) {
    gamePanel.dataset.status = state.status;
    gamePanel.dataset.view = state.monitor ? 'camera' : 'office';
    gamePanel.dataset.elapsed = state.elapsed.toFixed(2);
    gamePanel.dataset.power = state.power.toFixed(2);
    text($('night-number'),'Night ' + state.night);
    text($('night-clock'),(state.hour === 0 ? 12 : state.hour) + ' AM');
    text($('power-value'),Math.ceil(state.power) + '%');
    $('power-fill').style.width = state.power + '%';
    document.querySelector('.power-panel').dataset.low = String(state.power < 20);
    Array.from($('usage-meter').children).forEach(function (bar,index) { bar.classList.toggle('on',index < state.usage); });
    var operational = state.status === 'playing';
    ['left','right'].forEach(function (side) {
      $(side + '-door').setAttribute('aria-pressed',String(state.doors[side]));
      $(side + '-door').setAttribute('aria-label',(side === 'left' ? 'Left' : 'Right') + ' door');
      $(side + '-light').setAttribute('aria-pressed',String(state.lights[side]));
      $(side + '-light').setAttribute('aria-label',(side === 'left' ? 'Left' : 'Right') + ' light');
      $(side + '-door').disabled = !operational;
      $(side + '-light').disabled = !operational || state.monitor;
      var doorway = document.querySelector('.doorway-' + side);
      doorway.dataset.closed = String(state.doors[side]);
      doorway.dataset.lit = String(state.lights[side]);
      doorway.dataset.visitor = String(state.visibleAtDoor[side].length > 0);
      $(side + '-visitor').dataset.visible = String(state.visibleAtDoor[side].length > 0);
    });
    monitorPanel.hidden = !state.monitor;
    $('monitor-button').disabled = !operational;
    $('monitor-button').setAttribute('aria-pressed',String(state.monitor));
    text($('monitor-label'),state.monitor ? 'Lower NoseCam' : 'Raise NoseCam');
    var room = Engine.ROOMS[state.camera];
    if ($('camera-background').dataset.room !== room.id) {
      $('camera-background').style.backgroundImage = "url('assets/rooms/" + room.asset + "')";
      $('camera-background').dataset.room = room.id;
    }
    text($('camera-code'),room.camera); text($('camera-room-name'),room.name);
    $('camera-occupants').dataset.room = room.id;
    var occupants = [];
    Array.from($('camera-occupants').children).forEach(function (image) {
      var id = image.dataset.enemy, enemy = state.enemies[id];
      var visible = enemy.room === state.camera && (id !== 'bulb' || enemy.stage > 0 || enemy.phase === 'rushing');
      image.style.display = visible ? 'block' : 'none';
      image.dataset.visible = String(visible && state.monitor);
      if (id === 'bulb') image.style.opacity = String(.45 + Math.min(3,enemy.stage) * .16);
      if (visible) occupants.push(names[id]);
    });
    text($('camera-description'),occupants.length ? occupants.join(' · ') : state.camera === 'cove' ? 'The curtains are still. For now.' : 'No faces in this feed.');
    var bulb = state.enemies.bulb;
    $('cove-stage').hidden = state.camera !== 'cove';
    text($('cove-stage'),bulb.phase === 'rushing' ? 'COVE EMPTY / HE IS RUNNING.' : ['Curtain closed.','A nose behind the curtain.','He is leaning out.','He is ready to run.'][Math.min(3,bulb.stage)]);
    cameraButtons.forEach(function (button) { button.setAttribute('aria-pressed',String(button.dataset.camera === state.camera)); button.disabled = !operational; });
    $('blackout-face').style.opacity = state.status === 'blackout' && state.blackoutRemaining < 4 ? '.65' : '0';
    text($('night-tip'),state.status === 'blackout' ? 'Cameras and shutters are offline.' : state.elapsed < 16 ? 'Quick checks. Open doors. You only need to make it to morning.' : state.power < 20 ? 'Low power. Keep your checks short.' : '');
    cues = cues.filter(function (item) { return item.until > state.elapsed; });
    var warning = cues.filter(function (item) { return item.priority >= 2; });
    var shown = warning.length ? warning.sort(function (a,b) { return b.priority - a.priority || a.until - b.until; }).slice(0,3) : cues.slice(-1);
    text($('sound-cue'),shown.map(function (item) { return item.message; }).join(' · '));
  }
  function finish(state) {
    if (terminal) return; terminal = true; cancelAnimationFrame(frame); frame = 0;
    gamePanel.inert = true;
    $('pause-game').disabled = true;
    $('game-status-reader').textContent = state.status === 'won' ? '6 AM. Night ' + state.night + ' survived.' : names[state.lossEnemy] + ' caught you.';
    if (state.status === 'won') {
      audio.stop(); audio.cue('win');
      save.completed = Math.max(save.completed,state.night);
      save.unlocked = Math.max(save.unlocked,Math.min(5,state.night + 1));
      save.started = true; writeSave(); showResult(state);
    } else {
      $('jumpscare-image').src = portraits[state.lossEnemy] || portraits.shadow;
      $('jumpscare-image').alt = (names[state.lossEnemy] || 'Shadow Yam') + ' lunges toward you.';
      jump.hidden = false;
      jump.dataset.enemy = state.lossEnemy;
      audio.jumpscare();
      var currentRun = run;
      resultTimer = window.setTimeout(function () { if (currentRun !== run || !active) return; jump.hidden = true; showResult(state); },1400);
    }
  }
  function showResult(state) {
    var won = state.status === 'won', completed = won && state.night === 5;
    result.dataset.outcome = state.status;
    text($('result-eyebrow'),won ? completed ? 'FIVE SHIFTS. FOUR FACES. ONE SURVIVOR.' : 'NOSE DUTY COMPLETE' : 'SHIFT TERMINATED');
    text($('result-title'),won ? '6 AM' : 'Too close.');
    text($('result-message'),won ? completed ? 'You survived Five Nights at Yams.' : 'Night ' + state.night + ' survived. See you tomorrow.' : (names[state.lossEnemy] || 'Shadow Yam') + ' caught you.');
    text($('result-hint'),won ? completed ? 'Your paycheck: one yam. Please do not spend it all at once.' : 'Your progress has been saved' + (storageAvailable ? '.' : ' for this session.') : state.lossReason === 'blackout' ? 'Power ran out. Use doors only when needed and keep camera checks brief.' : lossHints[state.lossEnemy]);
    $('next-night').hidden = !won || completed;
    text($('next-night'),'Night ' + (state.night + 1) + ' →');
    $('retry-night').hidden = won;
    result.hidden = false; $('result-title').focus({preventScroll:true});
  }
  function pauseGame(automatic) {
    if (!active || terminal || !active.act('pause')) return;
    audio.pause(); render(active.snapshot());
    text($('pause-note'),automatic ? 'You left the tab. Time, power, and every Yam are paused.' : 'Time, power, and every Yam are paused.');
    if (!pauseDialog.open) pauseDialog.showModal();
    $('resume-game').focus();
  }
  function resumeGame() {
    if (!active || terminal || document.hidden) return;
    closeDialog(pauseDialog); active.act('resume'); previousFrame = performance.now();
    audio.resume(); render(active.snapshot()); $('monitor-button').focus({preventScroll:true});
  }

  $('new-game').addEventListener('click',function () { showBrief(1,true); });
  $('continue-game').addEventListener('click',function () { showBrief(save.unlocked,false); });
  $('start-shift').addEventListener('click',function () { $('pause-game').disabled = false; startNight(selectedNight,newCampaign); });
  $('cancel-shift').addEventListener('click',mainMenu);
  brief.addEventListener('cancel',function (event) { event.preventDefault(); mainMenu(); });
  $('instructions-button').addEventListener('click',function () { helpDialog.showModal(); $('close-instructions').focus(); });
  $('close-instructions').addEventListener('click',function () { helpDialog.close(); });
  helpDialog.addEventListener('close',function () { $('instructions-button').focus({preventScroll:true}); });
  ['left','right'].forEach(function (side) {
    $(side + '-door').addEventListener('click',function () { action('door',{side:side}); });
    $(side + '-light').addEventListener('click',function () { action('light',{side:side}); });
  });
  $('monitor-button').addEventListener('click',function () { action('monitor'); });
  cameraButtons.forEach(function (button) { button.addEventListener('click',function () { action('camera',button.dataset.camera); }); });
  Array.from(document.querySelectorAll('[data-look]')).forEach(function (button) { button.addEventListener('click',function () { look(button.dataset.look); }); });
  function look(direction) { $('office-scene').style.setProperty('--look-x',direction === 'left' ? '3.4%' : direction === 'right' ? '-3.4%' : '0%'); }
  $('pause-game').addEventListener('click',function () { pauseGame(false); });
  $('resume-game').addEventListener('click',resumeGame);
  $('quit-game').addEventListener('click',mainMenu);
  pauseDialog.addEventListener('cancel',function (event) { event.preventDefault(); resumeGame(); });
  ['game-mute','pause-mute'].forEach(function (id) { $(id).addEventListener('click',toggleMute); });
  window.addEventListener('yams:mute-change',syncMute);
  $('retry-night').addEventListener('click',function () { $('pause-game').disabled = false; startNight(selectedNight,false); });
  $('next-night').addEventListener('click',function () { result.hidden = true; showBrief(Math.min(5,selectedNight + 1),false); });
  $('result-menu').addEventListener('click',mainMenu);
  document.addEventListener('visibilitychange',function () { if (document.hidden) pauseGame(true); });
  window.addEventListener('pagehide',cleanUp);
  window.addEventListener('pageshow',function (event) { if (event.persisted) mainMenu(); });
  document.addEventListener('keydown',function (event) {
    if (!active || terminal || event.repeat || active.snapshot().status === 'paused') return;
    var key = event.key.toLowerCase(), handled = true;
    if (key === ' ' && event.target && event.target.tagName === 'BUTTON' && event.target.id !== 'monitor-button') return;
    if (key === 'escape') pauseGame(false);
    else if (key === 'q' || key === 'e') action('door',{side:key === 'q' ? 'left' : 'right'});
    else if (key === 'a' || key === 'd') action('light',{side:key === 'a' ? 'left' : 'right'});
    else if (key === ' ' || key === 'c') action('monitor');
    else if (/^[1-7]$/.test(key)) { action('monitor',true); action('camera',Engine.CAMERA_IDS[Number(key)-1]); }
    else if (key === 'arrowleft' || key === 'arrowright' || key === 'arrowup') look(key === 'arrowleft' ? 'left' : key === 'arrowright' ? 'right' : 'center');
    else handled = false;
    if (handled) event.preventDefault();
  });

  readSave(); syncMute(); updateMenu();
  var required = Object.keys(portraits).map(function (id) { return portraits[id]; }).concat(['assets/rooms/office.png']).concat(Engine.CAMERA_IDS.map(function (id) { return 'assets/rooms/' + Engine.ROOMS[id].asset; }));
  Promise.all(required.map(function (source) {
    return new Promise(function (resolve,reject) { var image = new Image(); image.onload = resolve; image.onerror = function () { reject(new Error(source)); }; image.src = source; });
  })).then(function () { ready = true; updateMenu(); },function () { text($('save-status'),'A room could not load. Keep the complete assets folder with the game, then reopen.'); });
})();
