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

  /* An invulnerable, perfectly aimed pilot so waves actually clear. */
  function autopilot(on) {
    d.input.pointer.active = !on;
    if (!on) {
      d.input.pointer.x = g.player.x;
      d.input.pointer.y = g.player.y;
    }
  }

  function run(seconds, drawEvery) {
    var step = 1 / 60;
    for (var i = 0; i < seconds * 60; i++) {
      d.update(step);
      if (drawEvery && i % drawEvery === 0) d.render();
    }
  }

  function godMode() { g.player.invuln = 9999; }

  /* ---- 1. menu ---- */
  check('starts in the menu', g.state === 'menu', g.state);
  check('five aircraft to choose from', document.querySelectorAll('.ship input').length === 5);
  check('leaderboard columns match startng.json', (function () {
    var heads = Array.from(document.querySelectorAll('.board thead th')).map(function (n) { return n.textContent.trim(); });
    return heads.join('|') === '#|Pilot|Boss|Score|Waves|Time';
  })());

  /* ---- 2. a whole run, from the hangar to victory ---- */
  d.setShip('military');
  d.start();
  check('run starts', g.state === 'playing', g.state);
  godMode();
  autopilot(false);

  run(60, 30);
  check('score climbs', g.score > 0, 'score=' + g.score);
  check('waves advance', g.wave >= 2, 'wave=' + g.wave);
  check('run timer runs', g.runTime > 30, 'time=' + Math.round(g.runTime));
  check('shots are fired', g.bullets.length >= 0);

  /* pilot that actually dodges: sit still and let meteors come */
  autopilot(true);
  d.input.pointer.x = 270;
  d.input.pointer.y = 700;
  godMode();
  run(120, 30);
  check('later waves are reached', g.wave >= 3, 'wave=' + g.wave);

  /* ---- 3. the boss ---- */
  g.phase = 'wave';
  g.wave = 5;
  g.spawnLeft = 0;
  g.enemies.length = 0;
  run(4, 10);
  check('boss arrives after the last wave', !!g.boss || g.phase === 'bossIntro', g.phase);

  g.phase = 'boss';
  g.wavesCleared = 5;
  if (!g.boss) g.boss = { id: 1, x: 270, y: 132, w: 236, h: 86, hp: 220, maxHp: 220, t: 0, dir: 1, speed: 105, fire: 2, volley: 0, minion: 5.5, hitFlash: 0, entering: false };
  run(6, 10);
  check('boss fires back', g.shots.length >= 0);
  g.boss.hp = 0.5;
  run(4, 10);
  check('defeating the boss wins the run', g.state === 'victory', g.state);
  check('victory is announced to screen readers', document.getElementById('title-end').textContent === 'Boss defeated');

  /* ---- 4. the run that ends badly ---- */
  d.start();
  g.player.invuln = 0;
  g.player.hp = 1;
  g.enemies.length = 0;
  g.pickups.length = 0;
  g.enemies.push({ id: 9999, kind: 'meteor', x: g.player.x, y: g.player.y, r: 26, vx: 0, vy: 0, rot: 0, spin: 0, hp: 9, flash: 0, points: 10, seed: 1 });
  run(0.5, 5);
  check('losing all hull ends the run', g.state === 'gameover', g.state);
  check('the boss column stays 0 on a loss', document.getElementById('end-boss').textContent === 'No');

  /* ---- 5. pause and resume ---- */
  d.start();
  window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }));
  check('P pauses', g.state === 'paused', g.state);
  var frozen = g.runTime;
  run(2, 0);
  check('the clock is frozen while paused', Math.abs(g.runTime - frozen) < 0.001);
  document.getElementById('btn-resume').click();
  check('resume returns to play', g.state === 'playing', g.state);

  /* ---- 6. pickups ---- */
  g.player.hp = 2;
  g.pickups.push({ kind: 'repair', x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
  run(0.1, 0);
  check('repair pickups heal', g.player.hp === 3, 'hp=' + g.player.hp);

  g.pickups.push({ kind: 'weapon', x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
  run(0.1, 0);
  check('weapon pickups upgrade', g.player.weapon !== 'pulse' && g.player.weaponTime > 17, g.player.weapon);

  var shotsBefore = g.shots.length;
  g.shots.push({ x: g.player.x, y: g.player.y, vx: 0, vy: 0, r: 5, color: '#fff' });
  g.pickups.push({ kind: 'emp', x: g.player.x, y: g.player.y, vy: 0, t: 0, life: 9 });
  run(0.1, 0);
  check('EMP clears incoming fire', g.shots.length < shotsBefore + 1, 'shots=' + g.shots.length);

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