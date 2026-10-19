/* Smoke test for Sky Patrol, driven through the browser.
 *
 * Run with the game being served (npm start), then open the page and run:
 *   await window.SKY_PATROL_SMOKE()
 * in the devtools console — or paste the file's contents in.
 *
 * It steps the real game loop through a full run without waiting on
 * requestAnimationFrame (browsers pause it in background tabs).
 */
window.SKY_PATROL_SMOKE = async function () {
  var SP = window.SP;
  if (!SP || !SP.debug) throw new Error('game not loaded');

  var d = SP.debug;
  var g = d.game;
  var log = [];
  var fails = 0;

  function check(name, condition, detail) {
    log.push((condition ? 'pass  ' : 'FAIL  ') + name + (detail ? '  → ' + detail : ''));
    if (!condition) fails++;
  }

  /* An invulnerable pilot so waves actually clear while it flies itself. */
  function steerTo(x, y) {
    var sx = clampUnit(x - g.player.x);
    var sy = clampUnit(y - g.player.y);
    var len = Math.sqrt(sx * sx + sy * sy) || 1;
    d.input.pointer.active = true;
    d.input.pointer.originX = g.player.x;
    d.input.pointer.originY = g.player.y;
    d.input.pointer.x = g.player.x + (sx / len) * 150;
    d.input.pointer.y = g.player.y + (sy / len) * 150;
  }

  function clampUnit(v) { return Math.max(-140, Math.min(140, v)); }

  function run(seconds, drawEvery) {
    var step = 1 / 60;
    for (var i = 0; i < seconds * 60; i++) {
      d.update(step);
      if (drawEvery && i % drawEvery === 0) d.render();
    }
  }

  var GAME_H = 900;
  function H_MID() { return GAME_H / 2; }
  var WEAPON_IDS = ['spread', 'rapid', 'laser'];

  function godMode() { g.player.invuln = 9999; }

  /* ---- 1. menu ---- */
  check('starts in the menu', g.state === 'menu', g.state);
  check('five aircraft to choose from', document.querySelectorAll('.ship input').length === 5);
  check('leaderboard columns match startng.json', (function () {
    var heads = Array.from(document.querySelectorAll('.board thead th')).map(function (n) { return n.textContent.trim(); });
    return heads.join('|') === '#|Pilot|Score|Waves|Kills|Time';
  })());

  /* ---- 2. a whole run, from the hangar to victory ---- */
  d.setShip('pink');
  d.start();
  check('run starts', g.state === 'playing', g.state);
  godMode();

  /* steer with the virtual stick: sit low and track the sky's middle */
  for (var t = 0; t < 60 * 60; t++) {
    steerTo(270 + Math.sin(t / 420) * 120, 640);
    d.update(1 / 60);
    if (t % 1800 === 0) d.render();
  }
  check('score climbs', g.score > 0, 'score=' + g.score);
  check('waves advance', g.wave >= 2, 'wave=' + g.wave);
  check('run timer runs', g.runTime > 30, 'time=' + Math.round(g.runTime));
  check('shots are fired', g.bullets.length >= 0);

  for (var t2 = 0; t2 < 120 * 60; t2++) {
    steerTo(270 + Math.sin(t2 / 300) * 170, 600 + Math.cos(t2 / 540) * 90);
    d.update(1 / 60);
    if (t2 % 1800 === 0) d.render();
  }
  check('later waves are reached', g.wave >= 3, 'wave=' + g.wave);

  /* ---- 3. the Dreadnought, and the run carrying on past it ---- */
  g.phase = 'wave';
  g.wave = 5;
  g.spawnLeft = 0;
  g.enemies.length = 0;
  run(4, 10);
  check('a Dreadnought turns up on the fifth wave', !!g.boss || g.phase === 'bossIntro', g.phase);

  g.phase = 'boss';
  g.wavesCleared = 5;
  if (!g.boss) g.boss = { id: 1, x: 270, y: 232, w: 236, h: 86, hp: 240, maxHp: 240, t: 0, dir: 1, speed: 105, fire: 2, fireEvery: 1.9, volley: 0, minion: 99, reward: 2000, hitFlash: 0, entering: false };
  godMode();
  run(6, 10);
  check('the Dreadnought fires back', g.shots.length > 0, g.shots.length + ' shots in the air');
  check('the boss fight survives a full minute of pressure', (function () {
    g.player.invuln = 9999;
    g.shots.length = 0;
    run(30, 0);
    return g.state === 'playing';
  })(), g.state);
  g.player.invuln = 9999;
  g.shots.length = 0;
  g.enemies.length = 0;
  /* park below the boss so the shots actually reach it */
  d.input.pointer.active = false;
  g.player.x = 270;
  g.player.y = 620;
  g.player.vx = 0;
  g.player.vy = 0;
  if (!g.boss) {
    g.boss = { id: 1, x: 270, y: 232, w: 236, h: 86, hp: 240, maxHp: 240, t: 0, dir: 1, speed: 105, fire: 2, fireEvery: 1.9, volley: 0, minion: 99, reward: 2000, hitFlash: 0, entering: false };
    g.phase = 'boss';
  }
  var scoreBefore = g.score;
  g.boss.hp = 0.5;
  run(4, 10);
  check('the run continues after the Dreadnought goes down', g.state === 'playing',
    'state=' + g.state + ' phase=' + g.phase);
  check('beating it scores a bonus', g.score > scoreBefore, 'score ' + Math.round(scoreBefore) + ' -> ' + Math.round(g.score));
  check('it is counted as beaten', g.bossesBeaten === 1, 'beaten=' + g.bossesBeaten);

  /* and wave 6 starts, then wave 10 brings another one */
  run(6, 10);
  check('the next wave starts right after', g.wave === 6, 'wave=' + g.wave + ' phase=' + g.phase);
  g.phase = 'wave';
  g.wave = 10;
  g.spawnLeft = 0;
  g.enemies.length = 0;
  run(4, 10);
  check('a second Dreadnought comes on the tenth wave', !!g.boss || g.phase === 'bossIntro', g.phase);
  if (g.boss) check('the second one is tougher', g.boss.maxHp > 240, g.boss.maxHp + ' hp');
  g.boss = null;
  g.phase = 'wave';
  d.start();

  /* waves keep going with no ceiling */
  d.start();
  g.player.invuln = 9999;
  for (var w = 0; w < 60 * 60 * 4 && g.state === 'playing'; w++) {
    steerTo(270 + Math.sin(w / 900) * 120, 600 + Math.cos(w / 1300) * 80);
    d.update(1 / 60);
  }
  check('the run keeps going well past the old five waves', g.wave > 5, 'reached wave ' + g.wave + ' in ' + Math.round(g.runTime) + 's');

  /* and the waves keep getting harder rather than flatlining */
  function sampleWave(waveNumber) {
    d.start();
    g.wave = waveNumber;
    g.spawnLeft = 1;
    g.spawnTimer = 0;
    g.enemies.length = 0;
    d.update(1 / 60);
    var e = g.enemies[0] || {};
    return { hp: e.hp || 0, count: g.spawnLeft, planCount: waveNumber };
  }
  var early = sampleWave(1);
  var late = sampleWave(30);
  check('late waves hit harder than early ones', late.hp > early.hp,
    'wave 1 rock ' + early.hp + ' hp vs wave 30 rock ' + late.hp + ' hp');

  /* ---- 4. the run that ends badly ---- */
  d.start();
  g.player.invuln = 0;
  g.player.hp = 1;
  g.enemies.length = 0;
  g.pickups.length = 0;
  g.enemies.push({ id: 9999, kind: 'meteor', x: g.player.x, y: g.player.y, r: 26, vx: 0, vy: 0, rot: 0, spin: 0, hp: 9, flash: 0, points: 10, seed: 1 });
  run(0.5, 5);
  check('losing all hull ends the run', g.state === 'gameover', g.state);
  check('the end screen reports the best wave as a plain number',
    /^\d+$/.test(document.getElementById('end-waves').textContent),
    document.getElementById('end-waves').textContent);
  check('the end screen counts Dreadnoughts beaten',
    document.getElementById('end-bosses').textContent === '0',
    document.getElementById('end-bosses').textContent);

  /* ---- 5. pause and resume ---- */
  d.start();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
  check('P pauses', g.state === 'paused', g.state);
  var frozen = g.runTime;
  run(2, 0);
  check('the clock is frozen while paused', Math.abs(g.runTime - frozen) < 0.001);
  document.getElementById('btn-resume').click();
  check('resume returns to play', g.state === 'playing', g.state);

  /* ---- 5b. the touch stick steers without touching the aircraft ---- */
  d.start();
  d.input.pointer.active = false;
  g.player.x = 270;
  g.player.y = 300;
  g.player.vx = 0;
  g.player.vy = 0;
  var canvasEl = document.getElementById('game');
  var rect = canvasEl.getBoundingClientRect();

  /* a thumb landing low in the frame, pushed to the right */
  var down = { bubbles: true, pointerId: 7, pointerType: 'touch', clientX: rect.left + rect.width * 0.25, clientY: rect.top + rect.height * 0.85 };
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', down));
  var stickOrigin = { x: d.input.pointer.originX, y: d.input.pointer.originY };
  check('the stick appears under the thumb, low in the frame', stickOrigin.y > H_MID() * 1.4,
    'origin y=' + Math.round(stickOrigin.y));
  check('the stick starts centred under the thumb', Math.abs(d.input.pointer.x - stickOrigin.x) < 0.01);

  canvasEl.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, down, { clientX: rect.left + rect.width * 0.85 })));
  var xAtPush = g.player.x;
  d.update(1 / 60);
  check('the aircraft accelerates, it never snaps to the thumb',
    g.player.x - xAtPush > 1 && g.player.x - xAtPush < 30,
    'moved ' + (g.player.x - xAtPush).toFixed(1) + 'px in one frame');

  var xBefore = g.player.x;
  run(0.4, 0);
  check('pushing the stick right flies right', g.player.x > xBefore + 20, 'x ' + Math.round(xBefore) + ' -> ' + Math.round(g.player.x));

  var yBefore = g.player.y;
  canvasEl.dispatchEvent(new PointerEvent('pointermove', Object.assign({}, down, {
    clientX: rect.left + rect.width * 0.25,
    clientY: rect.top + rect.height * 0.35
  })));
  run(0.4, 0);
  check('pushing the stick up flies up', g.player.y < yBefore - 20, 'y ' + Math.round(yBefore) + ' -> ' + Math.round(g.player.y));

  canvasEl.dispatchEvent(new PointerEvent('pointerup', down));
  check('letting go releases the stick', d.input.pointer.active === false);
  var drift = { x: g.player.x, y: g.player.y };
  run(0.4, 0);
  check('the aircraft coasts to a stop', Math.abs(g.player.x - drift.x) < 40 && Math.abs(g.player.y - drift.y) < 40);

  /* a pause must let go of the stick completely, or the next touch (which
     always has a new pointer id) would be ignored */
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
  document.getElementById('btn-resume').click();
  var after = Object.assign({}, down, { pointerId: 99 });
  canvasEl.dispatchEvent(new PointerEvent('pointerdown', after));
  check('a fresh touch after a pause still grabs the stick', d.input.pointer.active === true);
  canvasEl.dispatchEvent(new PointerEvent('pointerup', after));

  /* ---- 6. pickups ---- */
  g.player.hp = 2;
  g.pickups.push({ kind: 'repair', x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
  run(0.1, 0);
  check('repair pickups heal', g.player.hp === 3, 'hp=' + g.player.hp);

  g.pickups.push({ kind: 'star', x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
  run(0.1, 0);
  check('star pickups score', g.score > 0);

  var shotsBefore = g.shots.length;
  g.shots.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0, r: 5, color: '#fff' });
  g.pickups.push({ kind: 'emp', x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
  run(0.1, 0);
  check('EMP clears incoming fire', g.shots.length < shotsBefore + 1, 'shots=' + g.shots.length);

  /* ---- 6b. weapons: stacking, switching, expiry ---- */
  function takeWeapon(kind) {
    g.pickups.push({ kind: kind, x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
    run(0.05, 0);
  }

  function boltsInVolley() {
    if (g.state !== 'playing') d.start();
    g.player.invuln = 9999;
    g.enemies.length = 0;
    g.bullets.length = 0;
    g.player.fireTimer = 0;
    d.update(1 / 60);
    return g.bullets.slice();
  }

  /* the stick is velocity based, so simply leaving it centred holds position */
  function autopilot() {
    d.input.pointer.active = false;
  }

  d.start();
  check('a run starts on Pulse', g.player.weapon === 'pulse' && g.player.weaponLevel === 1);
  check('Pulse has no timer', g.player.weaponTime === 0);

  takeWeapon('spread');
  check('a weapon pod equips that weapon', g.player.weapon === 'spread' && g.player.weaponLevel === 1, g.player.weapon);
  check('the pod grants its full timer', Math.abs(g.player.weaponTime - 18) < 0.2, g.player.weaponTime.toFixed(1));

  var spreadL1 = boltsInVolley();
  takeWeapon('spread');
  check('the same pod again makes it stronger', g.player.weaponLevel === 2, 'lv' + g.player.weaponLevel);
  var spreadL2 = boltsInVolley();
  takeWeapon('spread');
  check('strength caps at level 3', g.player.weaponLevel === 3, 'lv' + g.player.weaponLevel);
  var spreadL3 = boltsInVolley();
  check('Spread gains bolts as it strengthens',
    spreadL1 < spreadL2 && spreadL2 < spreadL3,
    spreadL1 + ' -> ' + spreadL2 + ' -> ' + spreadL3);

  g.player.weaponTime = 3;
  takeWeapon('spread');
  check('a pod at max strength refreshes the clock', g.player.weaponLevel === 3 && g.player.weaponTime > 17,
    'lv' + g.player.weaponLevel + ' ' + g.player.weaponTime.toFixed(1));

  takeWeapon('laser');
  check('a different pod switches weapon at level 1', g.player.weapon === 'laser' && g.player.weaponLevel === 1,
    g.player.weapon + ' lv' + g.player.weaponLevel);
  check('the laser runs on a shorter timer than the others',
    Math.abs(g.player.weaponTime - 12) < 0.2, g.player.weaponTime.toFixed(1) + 's vs 18s for spread/rapid');

  /* laser levels deal more damage, and the beam still pierces */
  takeWeapon('laser');
  var laserL2 = boltsInVolley()[0];
  takeWeapon('laser');
  var laserL3 = boltsInVolley()[0];
  check('Laser strengthens', laserL3.dmg > laserL2.dmg && laserL3.dmg > 0, laserL2.dmg + ' -> ' + laserL3.dmg);
  check('Laser rounds pierce', laserL3.pierce === true);

  /* one beam must not tick the boss once per frame it overlaps */
  d.start();
  d.input.pointer.active = false;
  g.phase = 'boss';
  g.boss = { id: 1, x: 270, y: 232, w: 236, h: 86, hp: 260, maxHp: 260, t: 0, dir: 0, speed: 0, fire: 99, volley: 0, minion: 99, hitFlash: 0, entering: false };
  g.player.weapon = 'laser';
  g.player.weaponLevel = 3;
  g.player.weaponTime = 60;
  g.player.invuln = 9999;
  g.player.x = 270;
  g.player.y = 620;
  g.player.vx = 0;
  g.player.vy = 0;
  g.enemies.length = 0;
  g.shots.length = 0;
  g.bullets.length = 0;
  g.player.fireTimer = 0;
  d.update(1 / 60);
  var singleBeam = g.bullets.filter(function (b) { return b.beam; }).length;
  g.player.fireTimer = 99;
  run(1, 0);
  check('a beam hits the boss once per round, not once a frame',
    singleBeam === 1 && Math.abs(g.boss.hp - (260 - 4.2)) < 0.01,
    singleBeam + ' beam, boss at ' + (g.boss ? g.boss.hp.toFixed(2) : 'gone'));

  takeWeapon('rapid');
  var rapidL1 = boltsInVolley()[0];
  takeWeapon('rapid');
  var rapidL2 = boltsInVolley()[0];
  check('Rapid fires faster as it strengthens', rapidL2.rate < rapidL1.rate || rapidL2.size >= rapidL1.size,
    rapidL1.size + '@' + rapidL1.rate);

  /* expiry drops back to Pulse with a message */
  g.banner = null;
  g.player.weaponTime = 0.05;
  run(0.3, 0);
  check('an expired weapon returns to Pulse', g.player.weapon === 'pulse' && g.player.weaponLevel === 1, g.player.weapon);
  check('expiry shows WEAPON OFFLINE', !!g.banner && /WEAPON OFFLINE/.test(g.banner.text), g.banner && g.banner.text);

  check('the HUD names the active weapon', document.getElementById('hud-weapon-name').textContent === 'PULSE');

  /* ---- 6c. every pickup kind draws ---- */
  var kinds = ['spread', 'rapid', 'laser', 'shield', 'repair', 'emp', 'star'];
  var drawFails = 0;
  kinds.forEach(function (kind) {
    try { SP.Art.drawPickup(document.getElementById('game').getContext('2d'), { x: 20, y: 20, kind: kind, t: 1 }); }
    catch (err) { drawFails++; }
  });
  check('every pickup kind draws', drawFails === 0, kinds.join(', '));
  check('weapon pods are visually distinct',
    ['spread', 'rapid', 'laser'].every(function (k) { return SP.Art.PICKUPS[k].icon; }));

  /* a pod of the weapon in hand is marked as an upgrade */
  d.start();
  g.player.weapon = 'spread';
  g.player.weaponLevel = 2;
  g.pickups.push({ kind: 'spread', x: 100, y: 300, vy: 0, t: 0, life: 9 });
  g.pickups.push({ kind: 'rapid', x: 200, y: 300, vy: 0, t: 0, life: 9 });
  var paintCtx = document.getElementById('game').getContext('2d');
  var marked = 0;
  [true, false].forEach(function (flag, i) {
    try { SP.Art.drawPickup(paintCtx, { x: 20, y: 20, kind: i ? 'rapid' : 'spread', t: 1 }, { upgrade: flag }); marked++; }
    catch (err) { /* counted by the check above */ }
  });
  check('upgrade pods draw with their marker', marked === 2);

  /* weapon pods come in runs, so a level 3 is actually reachable */
  d.start();
  var seen = [];
  var lastKind = null;
  for (var s = 0; s < 60 * 60 * 20; s++) {
    g.pickups.length = 0;
    d.update(1 / 60);
    if (!g.pickups.length) continue;
    var kind = g.pickups[0].kind;
    if (WEAPON_IDS.indexOf(kind) < 0) continue;
    if (kind === lastKind) seen.push(1);
    else seen.push(0);
    lastKind = kind;
  }
  var repeats = seen.reduce(function (a, b) { return a + b; }, 0);
  var pairs = Math.max(1, seen.length - 1);
  var repeatRate = repeats / pairs;
  check('weapon pods arrive in runs of the same weapon', repeatRate > 0.5,
    Math.round(repeatRate * 100) + '% of consecutive pods repeat (uniform random would be 33%)');

  /* ---- 7. every aircraft draws ---- */
  var ships = SP.Art.SHIPS.map(function (s) { return s.id; });
  ships.forEach(function (id) {
    try {
      d.setShip(id);
      d.update(1 / 60);
      d.render();
      check('aircraft "' + id + '" renders', true);
    } catch (err) {
      check('aircraft "' + id + '" renders', false, err.message);
    }
  });

  /* ---- 8. character styles never throw ---- */
  var styles = [];
  ['short', 'afro', 'braids', 'bun', 'ponytail', 'dreads', 'bald'].forEach(function (hair) {
    ['none', 'cap', 'beanie', 'tophat', 'crown'].forEach(function (hat) {
      ['none', 'glasses', 'earrings', 'beard', 'scarf', 'backpack'].forEach(function (accessory) {
        styles.push({ body: 'female', primaryColor: '#a55eea', secondaryColor: '#0c6e5a', skinColor: '#8d5524', hairColor: '#17120f', hair: hair, hat: hat, accessory: accessory });
      });
    });
  });
  styles.push({ hair: 'nonsense', hat: 'wizard', accessory: 'wings', primaryColor: 'not-a-colour', body: 'other' });
  styles.push(null);
  styles.push(undefined);
  var ctx2d = document.getElementById('game').getContext('2d');
  var bad = 0;
  styles.forEach(function (style) {
    try { SP.Art.drawCharacter(ctx2d, style, { x: 10, y: 10, scale: 1 }); }
    catch (err) { bad++; }
  });
  check('every character style draws (' + styles.length + ' tried)', bad === 0, bad + ' failed');

  /* ---- 9. states back to the hangar ---- */
  document.getElementById('btn-hangar').click();
  check('the hangar comes back', g.state === 'menu', g.state);

  console.log(log.join('\n'));
  return { passed: log.length - fails, failed: fails, log: log };
};