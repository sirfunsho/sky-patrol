/* Sky Patrol — game loop, hazards, endless waves and Start.ng wiring.
 *
 * Classic script on purpose: no build step, no modules, so the game also runs
 * when the folder is opened straight from disk. Everything lives in one
 * requestAnimationFrame loop with a clamped delta.
 */
window.SP = window.SP || {};

(function (SP) {
  'use strict';

  var Art = SP.Art;
  var Audio = SP.Audio;
  var StartNG = SP.StartNG;

  /* ------------------------------------------------------------------ *
   * tuning
   * ------------------------------------------------------------------ */

  var W = 540;
  var H = 900;
  var HULL_START = 4;
  var HULL_MAX = 6;
  var INVULN_TIME = 1.9;
  var WEAPON_MAX_LEVEL = 3;
  var PLAYER_MIN_Y = 96;
  var PLAYER_MAX_Y = H - 60;
  var PLAYER_SPEED = 430;
  var MAX_PARTICLES = 320;
  var REDUCED_MOTION = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  var STORE_SHIP = 'sky-patrol:ship';

  /* Virtual stick: the further you push from where your thumb first landed,
     the faster the aircraft goes. Steering never depends on touching the
     aircraft, so a thumb resting low in the frame leaves it in plain sight. */
  var STICK_MAX = 120;
  var STICK_DEAD = 12;
  var TOUCH_HINT_TIME = 5;

  /* `shots` is a fan of [angle, xOffset] pairs; `levels` are indexed by
     strength, so a weapon reads clearly: what it is, and what it does at 1, 2
     and 3. Pulse is the one permanent weapon and has a single level. */
  function fan(count, spread) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var t = count === 1 ? 0 : i / (count - 1) - 0.5;
      out.push([t * 2 * spread, 0]);
    }
    return out;
  }

  /* Every weapon carries how long it lasts. The beam is the riskiest, so it
     runs for less time than the rest. */
  var WEAPONS = {
    pulse: {
      name: 'Pulse',
      color: '#7ef7ff',
      permanent: true,
      duration: 0,
      speed: 940,
      levels: [
        { rate: 0.15, dmg: 1, shots: [[0, 0]], size: 4, beam: false, pierce: false }
      ]
    },
    spread: {
      name: 'Spread',
      color: '#ff8a3d',
      duration: 18,
      speed: 880,
      levels: [
        { rate: 0.19, dmg: 1, shots: fan(3, 0.3), size: 4, beam: false, pierce: false },
        { rate: 0.21, dmg: 1, shots: fan(5, 0.36), size: 4, beam: false, pierce: false },
        { rate: 0.23, dmg: 1, shots: fan(7, 0.42), size: 4, beam: false, pierce: false }
      ]
    },
    rapid: {
      name: 'Rapid',
      color: '#a6ff7e',
      duration: 18,
      speed: 1000,
      levels: [
        { rate: 0.075, dmg: 1, shots: [[0, 0]], size: 3, beam: false, pierce: false },
        { rate: 0.058, dmg: 1, shots: [[0, 0]], size: 3, beam: false, pierce: false },
        { rate: 0.045, dmg: 1, shots: [[0, 0]], size: 4, beam: false, pierce: false }
      ]
    },
    laser: {
      name: 'Laser',
      color: '#ff5cf0',
      duration: 12,
      speed: 1500,
      levels: [
        { rate: 0.12, dmg: 2.4, shots: [[0, 0]], size: 6, beam: true, pierce: true },
        { rate: 0.12, dmg: 3.2, shots: [[0, 0]], size: 8, beam: true, pierce: true },
        { rate: 0.12, dmg: 4.2, shots: [[0, 0]], size: 10, beam: true, pierce: true }
      ]
    }
  };
  var WEAPON_KEYS = ['spread', 'rapid', 'laser'];

  /* The stats for the weapon currently equipped, at its current strength. */
  function weaponStats(id, level) {
    var def = WEAPONS[id] || WEAPONS.pulse;
    var stats = def.levels[clamp(level, 1, def.levels.length) - 1];
    return {
      name: def.name,
      color: def.color,
      speed: def.speed,
      duration: def.duration,
      rate: stats.rate,
      dmg: stats.dmg,
      shots: stats.shots,
      size: stats.size,
      beam: stats.beam,
      pierce: stats.pierce
    };
  }

  /* A Dreadnought turns up every BOSS_EVERY cleared waves. Beating one is not
     the end of anything — the next wave starts as soon as it goes down, and
     the one after it is meaner than the last. */
  var BOSS_EVERY = 5;

  function bossPlan(wave) {
    var n = Math.max(1, Math.round(wave / BOSS_EVERY));
    var ramp = (n - 1) / (n - 1 + 6);
    return {
      name: 'Dreadnought',
      hp: Math.round(240 + (n - 1) * 95),
      w: 236 + Math.min(60, (n - 1) * 12),
      h: 86,
      y: 232,
      speed: 105 + ramp * 70,
      fireEvery: 1.9 - ramp * 0.6,
      minionEvery: 7 - ramp * 2.2,
      reward: 2000 * n
    };
  }

  /* There is no finish line. Waves keep coming and keep getting harder; the
     run ends when the hull does. `ramp` climbs towards 1 but never reaches it,
     so the sky gets meaner and meaner without ever becoming impossible. */
  var WAVE_NAMES = [
    'Calm skies', 'Rubble field', 'Jet traffic', 'Heavy metals', 'Storm front',
    'Night runners', 'Deep space', 'Blackout', 'Red alert', 'Nothing left'
  ];

  function wavePlan(n) {
    var t = n - 1;
    var ramp = t / (t + 9);
    return {
      label: n <= WAVE_NAMES.length ? WAVE_NAMES[n - 1] : 'Beyond ' + (n - WAVE_NAMES.length),
      count: Math.min(44, 9 + Math.round(t * 1.7)),
      gap: [Math.max(0.42, 1.5 - t * 0.085), Math.max(0.7, 2.1 - t * 0.115)],
      fighter: Math.min(0.55, 0.1 + ramp * 0.45),
      size: [Math.min(26, 14 + t * 0.7), Math.min(48, 26 + t * 1.7)],
      speed: 1 + ramp * 0.95,
      hp: 1 + Math.floor(ramp * 4)
    };
  }

  /* ------------------------------------------------------------------ *
   * dom
   * ------------------------------------------------------------------ */

  var canvas = document.getElementById('game');
  var ctx = canvas.getContext('2d');

  var el = {
    stage: document.getElementById('stage'),
    hud: document.getElementById('hud'),
    hudScore: document.getElementById('hud-score'),
    hudWave: document.getElementById('hud-wave'),
    hudHull: document.getElementById('hud-hull'),
    hudTime: document.getElementById('hud-time'),
    hudGear: document.getElementById('hud-gear'),
    hudWeaponName: document.getElementById('hud-weapon-name'),
    hudWeaponLevel: document.getElementById('hud-weapon-level'),
    hudWeaponTime: document.getElementById('hud-weapon-time'),
    hudWeaponBar: document.getElementById('hud-weapon-bar'),
    hudWeaponFill: document.getElementById('hud-weapon-fill'),
    hudShield: document.getElementById('hud-shield'),
    hudShieldTime: document.getElementById('hud-shield-time'),
    hudBoss: document.getElementById('hud-boss'),
    hudBossFill: document.getElementById('hud-boss-fill'),
    btnPause: document.getElementById('btn-pause'),
    screens: {
      menu: document.getElementById('screen-start'),
      pause: document.getElementById('screen-pause'),
      end: document.getElementById('screen-end')
    },
    btnStart: document.getElementById('btn-start'),
    btnResume: document.getElementById('btn-resume'),
    btnRestartPause: document.getElementById('btn-restart-pause'),
    btnQuit: document.getElementById('btn-quit'),
    btnAgain: document.getElementById('btn-again'),
    btnHangar: document.getElementById('btn-hangar'),
    shipGrid: document.getElementById('ship-grid'),
    pilotPreview: document.getElementById('pilot-preview'),
    pilotName: document.getElementById('pilot-name'),
    pilotAccount: document.getElementById('pilot-account'),
    pilotNote: document.getElementById('pilot-note'),
    endEyebrow: document.getElementById('end-eyebrow'),
    titleEnd: document.getElementById('title-end'),
    endSub: document.getElementById('end-sub'),
    endScore: document.getElementById('end-score'),
    endWaves: document.getElementById('end-waves'),
    endTime: document.getElementById('end-time'),
    endBosses: document.getElementById('end-bosses'),
    endKills: document.getElementById('end-kills'),
    endSave: document.getElementById('end-save'),
    playerCard: document.getElementById('player-card'),
    playerFace: document.getElementById('player-face'),
    playerInitial: document.getElementById('player-initial'),
    playerName: document.getElementById('player-name'),
    playerAccount: document.getElementById('player-account'),
    playerSignin: document.getElementById('player-signin'),
    boardRows: document.getElementById('board-rows'),
    boardNote: document.getElementById('board-note'),
    btnBoardRefresh: document.getElementById('btn-board-refresh'),
    btnSound: document.getElementById('btn-sound'),
    announcer: document.getElementById('announcer')
  };

  var view = { dpr: 1, scale: 1, offX: 0, offY: 0, bg: null };

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }

  function formatNumber(n) {
    return Math.round(n).toLocaleString('en-US');
  }

  function formatTime(seconds) {
    var s = Math.max(0, Math.floor(seconds));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }

  function setText(node, value) {
    if (node && node.textContent !== value) node.textContent = value;
  }

  function announce(message) { setText(el.announcer, message); }

  function store(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (err) { /* private mode: the game still runs */ }
  }

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (err) { return null; }
  }

  function dist(ax, ay, bx, by) {
    var dx = ax - bx;
    var dy = ay - by;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */

  var g = {
    state: 'menu',
    phase: 'wave',
    time: 0,
    runTime: 0,
    score: 0,
    kills: 0,
    wave: 1,
    wavesCleared: 0,
    shake: 0,
    banner: null,
    bannerTimer: 0,
    spawnLeft: 0,
    spawnTimer: 0,
    pickupTimer: 8,
    gapTimer: 0,
    bossIntroTimer: 0,
    bossDeathTimer: 0,
    bossNumber: 0,
    bossesBeaten: 0,
    hudTimer: 0,
    touchHint: TOUCH_HINT_TIME,
    player: {
      x: W / 2, y: H * 0.72, vx: 0, vy: 0, tilt: 0,
      hp: HULL_START, weapon: 'pulse', weaponLevel: 1, weaponTime: 0, shield: 0,
      invuln: 0, fireTimer: 0, thrust: 0.6
    },
    enemies: [],
    bullets: [],
    shots: [],
    pickups: [],
    parts: [],
    pops: [],
    boss: null,
    nextId: 1
  };

  var input = {
    keys: {},
    pointer: { active: false, id: null, type: 'mouse', x: W / 2, y: H * 0.72, originX: W / 2, originY: H * 0.72 }
  };
  var TOUCH_DEVICE = window.matchMedia ? window.matchMedia('(pointer: coarse)').matches : false;

  var savedShip = readStore(STORE_SHIP);
  var chosenShip = Art.SHIPS.filter(function (s) { return s.id === savedShip; }).length
    ? savedShip
    : Art.SHIPS[0].id;

  function pilotStyle() { return Art.normaliseStyle(StartNG.identity.style); }

  /* ------------------------------------------------------------------ *
   * effects
   * ------------------------------------------------------------------ */

  function shake(amount) {
    if (REDUCED_MOTION) return;
    g.shake = Math.min(22, g.shake + amount);
  }

  function addScore(points, x, y) {
    g.score += points;
    if (x != null) g.pops.push({ x: x, y: y, text: '+' + points, t: 0, color: '#ffe9a8' });
  }

  function burst(x, y, count, color, speed, size) {
    var n = Math.min(count, MAX_PARTICLES - g.parts.length);
    for (var i = 0; i < n; i++) {
      var a = Math.random() * Math.PI * 2;
      var v = rand(speed * 0.35, speed);
      g.parts.push({
        x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        life: rand(0.25, 0.7), max: 0.7, size: rand(size * 0.5, size), color: color
      });
    }
  }

  function explode(x, y, r, color) {
    burst(x, y, Math.round(10 + r * 0.9), color || '#ffb347', 120 + r * 4, 2 + r * 0.14);
    shake(Math.min(12, r * 0.4));
  }

  function showBanner(text, sub) {
    g.banner = { text: text, sub: sub || '' };
    g.bannerTimer = 2.2;
  }

  /* ------------------------------------------------------------------ *
   * player
   * ------------------------------------------------------------------ */

  function resetPlayer() {
    var p = g.player;
    p.x = W / 2;
    p.y = H * 0.72;
    p.vx = 0;
    p.vy = 0;
    p.tilt = 0;
    p.hp = HULL_START;
    p.weapon = 'pulse';
    p.weaponLevel = 1;
    p.weaponTime = 0;
    p.shield = 0;
    p.invuln = 0;
    p.fireTimer = 0;
    p.thrust = 0.6;
  }

  function isDown(dir) {
    var k = input.keys;
    if (dir === 'left') return !!(k.ArrowLeft || k.KeyA);
    if (dir === 'right') return !!(k.ArrowRight || k.KeyD);
    if (dir === 'up') return !!(k.ArrowUp || k.KeyW);
    return !!(k.ArrowDown || k.KeyS);
  }

  function updatePlayer(dt) {
    var p = g.player;
    var prevX = p.x;

    if (input.pointer.active) {
      /* Virtual stick: deflection from where the thumb first landed, mapped
         to speed. The aircraft keeps its own place on screen, so it never has
         to sit under a finger to be steered. */
      var sx = input.pointer.x - input.pointer.originX;
      var sy = input.pointer.y - input.pointer.originY;
      var len = Math.sqrt(sx * sx + sy * sy);
      var strength = len <= STICK_DEAD ? 0 : Math.min(1, (len - STICK_DEAD) / (STICK_MAX - STICK_DEAD));
      if (strength > 0) {
        p.vx = (sx / len) * strength * PLAYER_SPEED;
        p.vy = (sy / len) * strength * PLAYER_SPEED;
      } else {
        var stickDamp = Math.max(0, 1 - 9 * dt);
        p.vx *= stickDamp;
        p.vy *= stickDamp;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    } else {
      var ax = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
      var ay = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
      if (ax || ay) {
        var len2 = Math.sqrt(ax * ax + ay * ay);
        p.vx = (ax / len2) * PLAYER_SPEED;
        p.vy = (ay / len2) * PLAYER_SPEED;
      } else {
        var damp = Math.max(0, 1 - 9 * dt);
        p.vx *= damp;
        p.vy *= damp;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }

    p.x = clamp(p.x, 26, W - 26);
    p.y = clamp(p.y, PLAYER_MIN_Y, PLAYER_MAX_Y);
    p.tilt += (clamp((p.x - prevX) / Math.max(dt, 0.001) / 1400, -1, 1) * 0.32 - p.tilt) * Math.min(1, 8 * dt);

    if (p.invuln > 0) p.invuln = Math.max(0, p.invuln - dt);
    if (p.shield > 0) p.shield = Math.max(0, p.shield - dt);
    if (p.weaponTime > 0) {
      p.weaponTime = Math.max(0, p.weaponTime - dt);
      if (p.weaponTime === 0) {
        var lost = WEAPONS[p.weapon].name;
        p.weapon = 'pulse';
        p.weaponLevel = 1;
        showBanner('WEAPON OFFLINE', lost.toUpperCase() + ' expired - back to pulse');
        announce(lost + ' expired. Back to Pulse.');
      }
    }
    p.thrust = 0.65 + 0.35 * Math.sin(g.time * 30) + (isDown('up') ? 0.2 : 0);

    /* weapons fire on their own */
    p.fireTimer -= dt;
    if (p.fireTimer <= 0) {
      var w = weaponStats(p.weapon, p.weaponLevel);
      for (var i = 0; i < w.shots.length; i++) {
        var s = w.shots[i];
        g.bullets.push({
          id: g.nextId++, x: p.x + s[1], y: p.y - 24,
          vx: Math.sin(s[0]) * w.speed, vy: -Math.cos(s[0]) * w.speed,
          dmg: w.dmg, size: w.size, color: w.color, pierce: w.pierce,
          beam: w.beam, weapon: p.weapon, hits: []
        });
      }
      p.fireTimer = w.rate;
      Audio.play(w.beam ? 'laser' : 'shoot');
    }
  }

  function damagePlayer() {
    var p = g.player;
    if (p.invuln > 0 || g.state !== 'playing') return false;

    if (p.shield > 0) {
      p.shield = 0;
      p.invuln = 1.2;
      Audio.play('shield');
      g.pops.push({ x: p.x, y: p.y - 40, text: 'SHIELD!', t: 0, color: '#5ad8ff' });
      burst(p.x, p.y, 16, '#5ad8ff', 160, 3);
      shake(8);
      return true;
    }

    p.hp -= 1;
    p.invuln = INVULN_TIME;
    Audio.play('hurt');
    burst(p.x, p.y, 18, '#ff7a7a', 190, 3);
    shake(14);
    announce('Hit. ' + Math.max(0, p.hp) + ' hull left.');

    if (p.hp <= 0) {
      explode(p.x, p.y, 42, '#ff9f43');
      Audio.play('bigExplode');
      endRun(false);
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * waves
   * ------------------------------------------------------------------ */

  function startRun() {
    g.score = 0;
    g.kills = 0;
    g.wave = 1;
    g.wavesCleared = 0;
    g.runTime = 0;
    g.shake = 0;
    g.banner = null;
    g.touchHint = TOUCH_HINT_TIME;
    lastWeaponPod = null;
    g.bossNumber = 0;
    g.bossesBeaten = 0;
    g.boss = null;
    g.enemies.length = 0;
    g.bullets.length = 0;
    g.shots.length = 0;
    g.pickups.length = 0;
    g.parts.length = 0;
    g.pops.length = 0;
    resetPlayer();
    startWave(1);
    setState('playing');
    announce('Run started. Wave 1. The sky never ends.');
  }

  function startWave(n) {
    g.wave = n;
    g.phase = 'wave';
    var plan = wavePlan(n);
    g.spawnLeft = plan.count;
    g.spawnTimer = 0.9;
    g.pickupTimer = rand(6, 10);
    showBanner('WAVE ' + n, plan.label);
    Audio.play('wave');
  }

  function spawnMeteor(plan) {
    var big = Math.random() < 0.35 + g.wave * 0.05;
    var r = big ? rand(plan.size[0] + 12, plan.size[1]) : rand(plan.size[0], plan.size[0] + 12);
    g.enemies.push({
      id: g.nextId++, kind: 'meteor', x: rand(40, W - 40), y: -r - 24, r: r,
      vx: rand(-24, 24), vy: rand(85, 140) * plan.speed * (0.8 + r / 110),
      rot: Math.random() * 6.28, spin: rand(-1.4, 1.4),
      hp: Math.max(1, Math.ceil(r / 16)) * plan.hp,
      flash: 0, hot: r > 30, points: Math.round(r * 2.4), seed: randInt(1, 9999)
    });
  }

  function spawnFighter(plan) {
    var x = rand(50, W - 50);
    g.enemies.push({
      id: g.nextId++, kind: 'fighter', x: x, y: H + 40,
      vx: 0, vy: -(rand(105, 150) * plan.speed),
      hp: 3 * plan.hp, flash: 0, tilt: 0,
      amp: rand(30, 90), freq: rand(0.7, 1.5), phase: rand(0, 6.28), origin: x,
      fire: rand(1.4, 2.8), points: 150
    });
  }

  function spawnEnemy() {
    var plan = wavePlan(g.wave);
    if (Math.random() < plan.fighter) spawnFighter(plan);
    else spawnMeteor(plan);
    g.spawnLeft -= 1;
  }

  /* Weapon pods arrive in runs: after one shows up, the next weapon pod is
     usually the same one. That is what makes a level-3 weapon reachable —
     three identical pods in a row by chance is only about one in nine. */
  var POD_REPEAT_CHANCE = 0.6;
  var lastWeaponPod = null;

  function spawnPickup(kind, x, y) {
    if (!kind) {
      var roll = Math.random();
      if (roll < 0.32) {
        kind = lastWeaponPod && Math.random() < POD_REPEAT_CHANCE
          ? lastWeaponPod
          : WEAPON_KEYS[randInt(0, 2)];
        lastWeaponPod = kind;
      } else {
        kind = roll < 0.58 ? 'shield' : roll < 0.76 ? 'repair' : roll < 0.88 ? 'emp' : 'star';
      }
    }
    g.pickups.push({ kind: kind, x: clamp(x, 40, W - 40), y: y, vy: rand(70, 110), t: 0, life: 16 });
  }

  /* A weapon pickup is that exact weapon. Taking the one you are already
     holding makes it stronger and restarts its clock; taking a different one
     switches to it at level 1. Either way you get the full 18 seconds. */
  function collectWeapon(kind, x, y) {
    var pl = g.player;
    var same = pl.weapon === kind;
    var def = WEAPONS[kind];

    pl.weapon = kind;
    pl.weaponLevel = same ? Math.min(WEAPON_MAX_LEVEL, pl.weaponLevel + 1) : 1;
    pl.weaponTime = WEAPONS[kind].duration;

    var label = def.name.toUpperCase() + (pl.weaponLevel > 1 ? ' LV' + pl.weaponLevel : '');
    g.pops.push({ x: x, y: y, text: label, t: 0, color: def.color });
    burst(x, y, 10, def.color, 130, 2.5);
    Audio.play('pickup');
    announce(label + ' equipped for ' + pl.weaponTime + ' seconds. Strength ' + pl.weaponLevel + ' of ' + WEAPON_MAX_LEVEL + '.');
  }

  function collectPickup(p) {
    var pl = g.player;
    if (WEAPONS[p.kind] && !WEAPONS[p.kind].permanent) {
      collectWeapon(p.kind, p.x, p.y);
    } else if (p.kind === 'shield') {
      pl.shield = 15;
      g.pops.push({ x: p.x, y: p.y, text: 'SHIELD', t: 0, color: '#5ad8ff' });
      Audio.play('pickup');
    } else if (p.kind === 'repair') {
      if (pl.hp < HULL_MAX) {
        pl.hp = Math.min(HULL_MAX, pl.hp + 1);
        g.pops.push({ x: p.x, y: p.y, text: '+1 HULL', t: 0, color: '#7cf07c' });
      } else {
        addScore(300, p.x, p.y);
      }
      Audio.play('pickup');
    } else if (p.kind === 'emp') {
      g.shots.length = 0;
      for (var i = 0; i < g.enemies.length; i++) {
        var e = g.enemies[i];
        e.hp -= 3;
        e.flash = 0.12;
        if (e.hp <= 0) killEnemy(e, false);
      }
      if (g.boss) g.boss.hp -= 14;
      g.pops.push({ x: p.x, y: p.y, text: 'EMP!', t: 0, color: '#c58cff' });
      shake(10);
      Audio.play('emp');
    } else {
      addScore(150, p.x, p.y);
      Audio.play('pickup');
    }
  }

  function killEnemy(e, withPoints) {
    e.dead = true;
    if (withPoints !== false) {
      addScore(e.points, e.x, e.y);
      g.kills += 1;
      Audio.play('explode');
      explode(e.x, e.y, Math.min(26, e.r || 14), e.kind === 'fighter' ? '#ff9f43' : '#c9a887');
      if (Math.random() < 0.12) spawnPickup(null, e.x, e.y);
    } else {
      Audio.play('explode');
      explode(e.x, e.y, 16, '#c58cff');
    }

    /* big rocks break into smaller ones */
    if (e.kind === 'meteor' && e.r > 26) {
      for (var i = 0; i < 2; i++) {
        var r = e.r * rand(0.5, 0.62);
        g.enemies.push({
          id: g.nextId++, kind: 'meteor',
          x: e.x + rand(-12, 12), y: e.y + rand(-8, 8), r: r,
          vx: rand(-70, 70), vy: rand(120, 190), rot: Math.random() * 6.28, spin: rand(-2, 2),
          hp: 1, flash: 0, hot: false, points: Math.round(r * 2.4), seed: randInt(1, 9999)
        });
      }
    }
  }

  function updateWaves(dt) {
    /* supplies keep drifting in for as long as you are airborne */
    g.pickupTimer -= dt;
    if (g.pickupTimer <= 0) {
      g.pickupTimer = rand(8, 13);
      spawnPickup(null, rand(70, W - 70), rand(120, 320));
    }

    if (g.phase === 'wave') {
      if (g.spawnLeft > 0) {
        g.spawnTimer -= dt;
        if (g.spawnTimer <= 0) {
          spawnEnemy();
          var plan = wavePlan(g.wave);
          g.spawnTimer = rand(plan.gap[0], plan.gap[1]);
        }
      } else if (g.enemies.length === 0) {
        /* cleared one, straight into the next — except every fifth wave,
           which brings a Dreadnought with it */
        g.wavesCleared = g.wave;
        var bonus = 150 * g.wave;
        addScore(bonus);
        Audio.play('wave');
        showBanner('WAVE ' + g.wave + ' CLEAR', '+' + bonus + ' points');
        announce('Wave ' + g.wave + ' cleared. Best so far: wave ' + g.wavesCleared + '.');

        if (g.wave % BOSS_EVERY === 0) {
          g.phase = 'bossIntro';
          g.bossIntroTimer = 2.6;
          showBanner('WARNING', 'Dreadnought inbound');
        } else {
          g.phase = 'gap';
          g.gapTimer = 2.2;
        }
      }
    } else if (g.phase === 'gap') {
      g.gapTimer -= dt;
      if (g.gapTimer <= 0) startWave(g.wave + 1);
    } else if (g.phase === 'bossIntro') {
      g.bossIntroTimer -= dt;
      if (g.bossIntroTimer <= 0) startBoss();
    } else if (g.phase === 'bossDying') {
      g.bossDeathTimer -= dt;
      if (g.bossDeathTimer <= 0) {
        g.phase = 'gap';
        g.gapTimer = 2;
      }
    }
  }

  /* ------------------------------------------------------------------ *
   * the Dreadnought
   * ------------------------------------------------------------------ */

  function startBoss() {
    g.phase = 'boss';
    var plan = bossPlan(g.wave);
    g.bossNumber += 1;
    g.boss = {
      id: g.nextId++, x: W / 2, y: -90, w: plan.w, h: plan.h,
      hp: plan.hp, maxHp: plan.hp, t: 0, dir: 1, speed: plan.speed,
      fire: 2, fireEvery: plan.fireEvery, volley: 0,
      minion: plan.minionEvery, reward: plan.reward, hitFlash: 0, entering: true
    };
    showBanner(plan.name.toUpperCase() + ' ' + g.bossNumber, 'Break it. Then keep going.');
    Audio.play('boss');
    announce('Boss ' + g.bossNumber + '. The Dreadnought has arrived.');
  }

  function bossShot(x, y, angle, speed) {
    g.shots.push({ x: x, y: y, vx: Math.sin(angle) * speed, vy: Math.cos(angle) * speed, r: 6, color: '#ff8c42' });
  }

  function updateBoss(dt) {
    var b = g.boss;
    if (!b) return;
    b.t += dt;
    b.hitFlash = Math.max(0, b.hitFlash - dt);

    if (b.entering) {
      b.y += 95 * dt;
      if (b.y >= bossPlan(g.wave).y) { b.y = bossPlan(g.wave).y; b.entering = false; }
      return;
    }

    b.x += b.dir * b.speed * dt;
    if (b.x < b.w / 2 + 16) { b.x = b.w / 2 + 16; b.dir = 1; }
    if (b.x > W - b.w / 2 - 16) { b.x = W - b.w / 2 - 16; b.dir = -1; }

    var phase2 = b.hp < b.maxHp * 0.55;
    b.fire -= dt;
    if (b.fire <= 0) {
      b.volley += 1;
      var count = phase2 ? 5 : 3;
      var spread = phase2 ? 0.34 : 0.28;
      for (var i = 0; i < count; i++) {
        var a = (i - (count - 1) / 2) * spread;
        bossShot(b.x - 48, b.y + 34, a - 0.12, 230);
        bossShot(b.x + 48, b.y + 34, a + 0.12, 230);
      }
      if (b.volley % 2 === 0) {
        /* aimed shot: angle 0 is straight down, so atan2(dx, dy) */
        var aim = Math.atan2(g.player.x - b.x, g.player.y - b.y || 1);
        bossShot(b.x, b.y + 36, aim, 330);
      }
      b.fire = b.fireEvery * (phase2 ? 0.7 : 1);
      Audio.play('enemyShoot');
    }

    b.minion -= dt;
    if (b.minion <= 0) {
      b.minion = b.minionEvery * (phase2 ? 0.75 : 1);
      [-1, 1].forEach(function (side) {
        spawnFighter(wavePlan(g.wave));
        var m = g.enemies[g.enemies.length - 1];
        m.y = b.y + 30;
        m.x = clamp(b.x + side * (b.w / 2 + 30), 40, W - 40);
        m.origin = m.x;
      });
    }

    /* ramming it hurts */
    if (Math.abs(g.player.x - b.x) < b.w / 2 + 10 && Math.abs(g.player.y - b.y) < b.h / 2 + 12) {
      if (damagePlayer()) g.player.y += 34;
    }

    if (b.hp <= 0 && g.phase === 'boss') {
      g.phase = 'bossDying';
      g.bossDeathTimer = 1.8;
      g.bossesBeaten += 1;
      addScore(b.reward);
      showBanner('DREADNOUGHT DOWN', '+' + formatNumber(b.reward) + ' · wave ' + (g.wave + 1) + ' next');
      Audio.play('bigExplode');
      shake(20);
      announce('Dreadnought ' + g.bossNumber + ' destroyed. Next wave coming.');
    }
  }

  /* ------------------------------------------------------------------ *
   * world update
   * ------------------------------------------------------------------ */

  function update(dt) {
    g.time += dt;
    updateBackground(dt);

    if (g.state !== 'playing') {
      updateParticles(dt);
      return;
    }

    g.runTime += dt;
    if (g.touchHint > 0) g.touchHint -= dt;
    if (g.bannerTimer > 0) {
      g.bannerTimer -= dt;
      if (g.bannerTimer <= 0) g.banner = null;
    }

    updatePlayer(dt);
    updateWaves(dt);
    if (g.boss) updateBoss(dt);

    updateBullets(dt);
    updateEnemies(dt);
    updateShots(dt);
    updatePickups(dt);
    updateParticles(dt);
    updatePops(dt);

    g.shake = Math.max(0, g.shake - g.shake * 6 * dt - 6 * dt);

    g.hudTimer -= dt;
    if (g.hudTimer <= 0) {
      g.hudTimer = 0.08;
      updateHud();
    }
  }

  function updateBullets(dt) {
    for (var i = g.bullets.length - 1; i >= 0; i--) {
      var b = g.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y < -30 || b.x < -30 || b.x > W + 30) { g.bullets.splice(i, 1); continue; }

      if (g.boss && !g.boss.entering &&
          Math.abs(b.x - g.boss.x) < g.boss.w / 2 && Math.abs(b.y - g.boss.y) < g.boss.h / 2) {
        /* a piercing beam must hit the hull once, not once per frame it
           overlaps — the hull is 86px tall and the beam moves 25px a frame */
        if (!b.pierce || b.hits.indexOf(g.boss.id) < 0) {
          g.boss.hp -= b.dmg;
          g.boss.hitFlash = 0.09;
          b.hits.push(g.boss.id);
          burst(b.x, b.y, b.beam ? 10 : 3, b.beam ? b.color : '#ffd93d', b.beam ? 150 : 90, b.beam ? 3 : 2);
        }
        if (!b.pierce) g.bullets.splice(i, 1);
        continue;
      }

      for (var j = 0; j < g.enemies.length; j++) {
        var e = g.enemies[j];
        if (e.dead) continue;
        if (b.pierce && b.hits.indexOf(e.id) >= 0) continue;
        var reach = (e.kind === 'meteor' ? e.r * 0.88 : 20) + b.size;
        if (dist(b.x, b.y, e.x, e.y) > reach) continue;

        e.hp -= b.dmg;
        e.flash = b.beam ? 0.16 : 0.1;
        /* a beam lights up what it burns through */
        burst(b.x, b.y, b.beam ? 9 : 3, b.beam ? b.color : b.color, b.beam ? 150 : 80, b.beam ? 3 : 2);
        if (b.pierce) { b.hits.push(e.id); continue; }
        g.bullets.splice(i, 1);
        if (e.hp <= 0) killEnemy(e);
        break;
      }
    }
  }

  function updateEnemies(dt) {
    for (var i = g.enemies.length - 1; i >= 0; i--) {
      var e = g.enemies[i];
      e.flash = Math.max(0, e.flash - dt);

      if (e.kind === 'meteor') {
        e.x += e.vx * dt;
        e.y += e.vy * dt;
        e.rot += e.spin * dt;
        if (e.x < e.r * 0.5) { e.x = e.r * 0.5; e.vx = Math.abs(e.vx); }
        if (e.x > W - e.r * 0.5) { e.x = W - e.r * 0.5; e.vx = -Math.abs(e.vx); }
        if (e.y > H + e.r * 2) { g.enemies.splice(i, 1); continue; }
      } else {
        e.y += e.vy * dt;
        e.phase += e.freq * dt;
        var target = e.origin + Math.sin(e.phase) * e.amp;
        e.x += (target - e.x) * Math.min(1, 5 * dt);
        e.tilt = clamp((target - e.x) * 0.02, -0.5, 0.5);

        if (e.y < H - 80 && e.y > 0) {
          e.fire -= dt;
          if (e.fire <= 0) {
            e.fire = rand(2, 3.4);
            /* angle 0 is straight down for enemy shots */
            var aim = Math.atan2(g.player.x - e.x, g.player.y - e.y || 1);
            g.shots.push({ x: e.x, y: e.y + 20, vx: Math.sin(aim) * 210, vy: Math.cos(aim) * 210, r: 5, color: '#ff5a5a' });
            Audio.play('enemyShoot');
          }
        }
        if (e.y < -60) { g.enemies.splice(i, 1); continue; }
      }

      if (e.dead) { g.enemies.splice(i, 1); continue; }
    }

    /* ramming */
    var p = g.player;
    for (var k = g.enemies.length - 1; k >= 0; k--) {
      var en = g.enemies[k];
      if (en.dead) continue;
      var reach = (en.kind === 'meteor' ? en.r * 0.82 : 22) + 9;
      if (dist(p.x, p.y, en.x, en.y) <= reach) {
        damagePlayer();
        en.hp = 0;
        killEnemy(en, false);
      }
    }
  }

  function updateShots(dt) {
    var p = g.player;
    for (var i = g.shots.length - 1; i >= 0; i--) {
      var s = g.shots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > H + 20 || s.y < -20 || s.x < -20 || s.x > W + 20) { g.shots.splice(i, 1); continue; }
      if (dist(s.x, s.y, p.x, p.y) < s.r + 8) {
        g.shots.splice(i, 1);
        damagePlayer();
      }
    }
  }

  function updatePickups(dt) {
    var p = g.player;
    for (var i = g.pickups.length - 1; i >= 0; i--) {
      var k = g.pickups[i];
      k.t += dt;
      k.y += k.vy * dt;
      k.x += Math.sin(k.t * 2) * 12 * dt;
      k.life -= dt;
      if (k.life <= 0 || k.y > H + 30) { g.pickups.splice(i, 1); continue; }
      if (dist(k.x, k.y, p.x, p.y) < 26) {
        g.pickups.splice(i, 1);
        collectPickup(k);
      }
    }
  }

  function updateParticles(dt) {
    for (var i = g.parts.length - 1; i >= 0; i--) {
      var p = g.parts[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 1 - 1.6 * dt;
      p.vy *= 1 - 1.6 * dt;
      p.life -= dt;
      if (p.life <= 0) g.parts.splice(i, 1);
    }
  }

  function updatePops(dt) {
    for (var i = g.pops.length - 1; i >= 0; i--) {
      var p = g.pops[i];
      p.t += dt;
      p.y -= 26 * dt;
      if (p.t > 1.1) g.pops.splice(i, 1);
    }
  }

  /* ------------------------------------------------------------------ *
   * background
   * ------------------------------------------------------------------ */

  var scroll = { clouds: 0, clouds2: 0, ridgeFar: 0, ridgeNear: 0, streak: 0 };

  function buildBackground() {
    view.bg = Art.background(W, H);
  }

  function updateBackground(dt) {
    var fast = g.state === 'playing';
    scroll.clouds += dt * (fast ? 120 : 45);
    scroll.clouds2 += dt * (fast ? 200 : 80);
    scroll.ridgeFar += dt * (fast ? 26 : 12);
    scroll.ridgeNear += dt * (fast ? 58 : 24);
    scroll.streak += dt * (fast ? 900 : 260);
  }

  function drawTiled(img, offset, tileH, alpha) {
    ctx.globalAlpha = alpha;
    var start = -(((offset % tileH) + tileH) % tileH);
    for (var y = start; y < H; y += tileH) ctx.drawImage(img, 0, y, W, tileH);
    ctx.globalAlpha = 1;
  }

  /* The horizon sits at the bottom of the screen and slides sideways, so there
     is no seam to give the game away. */
  function drawHorizon(img, offsetX, alpha) {
    var w = img.width;
    var h = img.height;
    var x = -(((offsetX % w) + w) % w);
    ctx.globalAlpha = alpha;
    ctx.drawImage(img, x, H - h, w, h);
    ctx.drawImage(img, x + w, H - h, w, h);
    ctx.globalAlpha = 1;
  }

  function drawBackground() {
    var bg = view.bg;
    ctx.drawImage(bg.sky, 0, 0, W, H);

    /* speed streaks while flying */
    if (g.state === 'playing') {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = 2;
      var offset = scroll.streak % 120;
      for (var i = 0; i < 16; i++) {
        var x = ((i * 137) % W);
        var y = ((i * 211 + offset * (1 + (i % 3) * 0.4)) % (H + 120)) - 60;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + 26 + (i % 4) * 12);
        ctx.stroke();
      }
    }

    drawTiled(bg.clouds, scroll.clouds, H, 0.7);
    drawTiled(bg.clouds2, scroll.clouds2, H, 0.42);
    drawHorizon(bg.ridgeFar, scroll.ridgeFar, 0.75);
    drawHorizon(bg.ridgeNear, scroll.ridgeNear, 0.9);
  }

  /* ------------------------------------------------------------------ *
   * drawing
   * ------------------------------------------------------------------ */

  function render() {
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.offX * view.dpr, view.offY * view.dpr);
    ctx.clearRect(-W, -H, W * 3, H * 3);

    ctx.save();
    if (g.shake > 0.2) ctx.translate(rand(-g.shake, g.shake), rand(-g.shake, g.shake));

    drawBackground();

    var i;
    for (i = 0; i < g.pickups.length; i++) {
      var pod = g.pickups[i];
      /* a pod of the weapon already in your hands is an upgrade */
      Art.drawPickup(ctx, pod, { upgrade: pod.kind === g.player.weapon });
    }
    for (i = 0; i < g.enemies.length; i++) {
      var e = g.enemies[i];
      if (e.dead) continue;
      if (e.kind === 'meteor') Art.drawMeteor(ctx, e);
      else Art.drawFighter(ctx, e);
    }
    if (g.boss && g.phase !== 'menu') Art.drawBoss(ctx, g.boss);

    if (g.state !== 'menu') drawPlayer();

    for (i = 0; i < g.bullets.length; i++) {
      var b = g.bullets[i];
      if (b.beam) drawBeamShot(b);
      else {
        ctx.fillStyle = b.color;
        ctx.shadowColor = b.color;
        ctx.shadowBlur = 10;
        Art.helpers.starPath(ctx, b.x, b.y, b.size + 1.6, b.size * 0.4, 4);
        ctx.fill();
        ctx.shadowBlur = 0;
      }
    }

    for (i = 0; i < g.shots.length; i++) {
      var s = g.shots[i];
      ctx.fillStyle = s.color;
      ctx.shadowColor = s.color;
      ctx.shadowBlur = 12;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, 6.2832);
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    for (i = 0; i < g.parts.length; i++) {
      var p = g.parts[i];
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / p.max));
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    for (i = 0; i < g.pops.length; i++) {
      var pop = g.pops[i];
      ctx.globalAlpha = Math.max(0, 1 - pop.t / 1.1);
      ctx.fillStyle = pop.color;
      ctx.font = '700 20px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.strokeStyle = 'rgba(6,9,24,0.8)';
      ctx.lineWidth = 4;
      ctx.strokeText(pop.text, pop.x, pop.y);
      ctx.fillText(pop.text, pop.x, pop.y);
      ctx.globalAlpha = 1;
    }

    if (g.banner) drawBanner();

    /* the stick sits above the sky but below the banners, so it never hides a
       hazard the player needs to see */
    if (g.state === 'playing' && input.pointer.active) drawStick();
    drawTouchHint();

    ctx.restore();

    /* edge vignette so the HUD stays readable */
    ctx.setTransform(view.dpr * view.scale, 0, 0, view.dpr * view.scale, view.offX * view.dpr, view.offY * view.dpr);
    var vg = ctx.createLinearGradient(0, 0, 0, H);
    vg.addColorStop(0, 'rgba(4,6,18,0.45)');
    vg.addColorStop(0.25, 'rgba(4,6,18,0)');
    vg.addColorStop(1, 'rgba(4,6,18,0.25)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPlayer() {
    var p = g.player;
    if (p.invuln > 0 && Math.floor(p.invuln * 12) % 2 === 0 && p.hp > 0) return;
    Art.drawShip(ctx, chosenShip, {
      x: p.x, y: p.y, size: 74, tilt: p.tilt,
      thrust: clamp(p.thrust, 0, 1),
      pilotStyle: pilotStyle(),
      shield: p.shield > 0,
      time: g.time
    });
  }

  /* A laser round is a streak of light: a hard white core inside a coloured
     glow, tapering to nothing at the tail, with a bright head where it is
     burning through whatever is in front of it. */
  function drawBeamShot(b) {
    var head = b.y;
    var tail = b.y + 190;
    var w = b.size;

    ctx.save();
    ctx.lineCap = 'butt';

    /* soft outer glow */
    ctx.globalAlpha = 0.3;
    ctx.strokeStyle = b.color;
    ctx.lineWidth = w * 1.5;
    ctx.beginPath();
    ctx.moveTo(b.x, tail);
    ctx.lineTo(b.x, head);
    ctx.stroke();

    /* the streak itself, fading out behind the head */
    var grad = ctx.createLinearGradient(b.x, head, b.x, tail);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.18, b.color);
    grad.addColorStop(1, rgbaFade(b.color));
    ctx.globalAlpha = 1;
    ctx.shadowColor = b.color;
    ctx.shadowBlur = 14;
    ctx.strokeStyle = grad;
    ctx.lineWidth = Math.max(2, w * 0.5);
    ctx.beginPath();
    ctx.moveTo(b.x, head);
    ctx.lineTo(b.x, tail);
    ctx.stroke();

    /* hot core */
    ctx.shadowBlur = 6;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1.2, w * 0.16);
    ctx.beginPath();
    ctx.moveTo(b.x, head + 2);
    ctx.lineTo(b.x, tail * 0.5 + head * 0.5);
    ctx.stroke();

    /* the burning tip */
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(b.x, head - w * 1.1);
    ctx.lineTo(b.x + w * 0.42, head + w * 0.5);
    ctx.lineTo(b.x, head + w * 1.2);
    ctx.lineTo(b.x - w * 0.42, head + w * 0.5);
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }

  /* a transparent version of a hex colour, for streak tails */
  function rgbaFade(color) {
    var c = toRgb(color);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',0)';
  }

  function toRgb(color) {
    var v = parseInt(String(color).replace('#', ''), 16);
    return { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255 };
  }

  /* The floating stick, drawn where the thumb first landed. Mouse players get
     no stick drawn — on a desktop it is just a green disc in the way. */
  function drawStick() {
    var o = input.pointer;
    if (!o.active || o.type === 'mouse') return;
    var dx = clamp(o.x - o.originX, -STICK_MAX, STICK_MAX);
    var dy = clamp(o.y - o.originY, -STICK_MAX, STICK_MAX);

    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = '#d8fd71';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(o.originX, o.originY, STICK_MAX, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = '#d8fd71';
    ctx.beginPath();
    ctx.arc(o.originX, o.originY, STICK_MAX, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.85;
    ctx.shadowColor = '#d8fd71';
    ctx.shadowBlur = 14;
    ctx.fillStyle = '#d8fd71';
    ctx.beginPath();
    ctx.arc(o.originX + dx, o.originY + dy, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* A quiet prompt on touch screens so the stick is discoverable. */
  function drawTouchHint() {
    if (!TOUCH_DEVICE || g.touchHint <= 0 || g.state !== 'playing') return;
    var pulse = 0.5 + 0.5 * Math.sin(g.time * 4);
    var cx = W / 2;
    var cy = H * 0.82;

    ctx.save();
    ctx.globalAlpha = 0.25 + pulse * 0.25;
    ctx.strokeStyle = '#d8fd71';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, 54, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = 0.5 + pulse * 0.3;
    ctx.fillStyle = '#d8fd71';
    ctx.beginPath();
    ctx.arc(cx, cy, 14 + pulse * 4, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = 0.75;
    ctx.fillStyle = '#ffffff';
    ctx.font = '700 20px ui-sans-serif, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.strokeStyle = 'rgba(6,9,24,0.85)';
    ctx.lineWidth = 5;
    ctx.strokeText('Drag anywhere to steer', cx, cy + 96);
    ctx.fillText('Drag anywhere to steer', cx, cy + 96);
    ctx.restore();
  }

  function drawBanner() {
    var alpha = clamp(Math.min(g.bannerTimer, 2.2 - g.bannerTimer) / 0.35, 0, 1);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(6,9,24,0.55)';
    Art.helpers.roundRect(ctx, W / 2 - 200, H / 2 - 78, 400, 120, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(216,253,113,0.6)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 44px ui-sans-serif, system-ui, sans-serif';
    ctx.fillText(g.banner.text, W / 2, H / 2 - 18);
    if (g.banner.sub) {
      ctx.fillStyle = '#d8fd71';
      ctx.font = '600 20px ui-sans-serif, system-ui, sans-serif';
      ctx.fillText(g.banner.sub, W / 2, H / 2 + 16);
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * hud
   * ------------------------------------------------------------------ */

  function updateHud() {
    var p = g.player;
    var w = weaponStats(p.weapon, p.weaponLevel);
    var permanent = WEAPONS[p.weapon].permanent;

    setText(el.hudScore, formatNumber(g.score));
    setText(el.hudWave, 'Wave ' + g.wave);
    setText(el.hudTime, formatTime(g.runTime));
    setText(el.hudHull, '♥'.repeat(Math.max(0, p.hp)) + '·'.repeat(HULL_MAX - clamp(p.hp, 0, HULL_MAX)));
    el.hudHull.setAttribute('aria-label', 'Hull ' + Math.max(0, p.hp) + ' of ' + HULL_MAX);

    /* active weapon, its strength and how long is left of it */
    el.hudGear.hidden = false;
    el.hudGear.dataset.weapon = p.weapon;
    el.hudGear.dataset.levelled = String(!permanent);
    el.hudGear.style.setProperty('--weapon', w.color);
    setText(el.hudWeaponName, w.name.toUpperCase());

    if (permanent) {
      setText(el.hudWeaponLevel, 'default');
      setText(el.hudWeaponTime, '');
      el.hudWeaponBar.hidden = true;
      el.hudGear.setAttribute('aria-label', 'Pulse, the default weapon. Always available.');
    } else {
      setText(el.hudWeaponLevel, 'LV ' + p.weaponLevel);
      setText(el.hudWeaponTime, Math.ceil(p.weaponTime) + 's');
      el.hudWeaponBar.hidden = false;
      el.hudWeaponFill.style.width = clamp((p.weaponTime / Math.max(1, w.duration)) * 100, 0, 100) + '%';
      el.hudGear.setAttribute('aria-label',
        w.name + ' at level ' + p.weaponLevel + ' of ' + WEAPON_MAX_LEVEL + ', ' + Math.ceil(p.weaponTime) + ' seconds left.');
    }

    if (p.shield > 0) {
      el.hudShield.hidden = false;
      setText(el.hudShieldTime, Math.ceil(p.shield) + 's');
    } else {
      el.hudShield.hidden = true;
    }

    if (g.boss && g.phase !== 'menu') {
      el.hudBoss.hidden = false;
      el.hudBossFill.style.width = clamp((g.boss.hp / g.boss.maxHp) * 100, 0, 100) + '%';
    } else {
      el.hudBoss.hidden = true;
    }
  }

  /* ------------------------------------------------------------------ *
   * screens
   * ------------------------------------------------------------------ */

  function setState(next) {
    g.state = next;
    var playing = next === 'playing';
    el.screens.menu.hidden = next !== 'menu';
    el.screens.pause.hidden = next !== 'paused';
    el.screens.end.hidden = next !== 'gameover';
    el.hud.hidden = !(playing || next === 'paused');
    el.btnPause.hidden = !playing;
    document.body.dataset.state = next;

    if (playing) {
      canvas.focus({ preventScroll: true });
    } else if (next === 'paused') {
      el.btnResume.focus({ preventScroll: true });
    } else if (next === 'menu') {
      el.btnStart.focus({ preventScroll: true });
    } else {
      el.btnAgain.focus({ preventScroll: true });
    }
  }

  /* Let go of the stick completely. The captured pointer id has to go too, or
     the next touch — which always has a new id — would be ignored. */
  function resetStick() {
    input.pointer.active = false;
    input.pointer.id = null;
    input.pointer.type = 'mouse';
  }

  function pause() {
    if (g.state !== 'playing') return;
    input.keys = {};
    resetStick();
    setState('paused');
    announce('Paused.');
  }

  function resume() {
    if (g.state !== 'paused') return;
    setState('playing');
    announce('Back in the sky.');
  }

  /* There is no winning. A run ends when the hull does, and the only question
     is how far you got. */
  function endRun() {
    if (g.state !== 'playing') return;
    input.keys = {};
    resetStick();

    var deep = g.wavesCleared;
    setText(el.endEyebrow, deep >= 10 ? 'Deep run' : 'Run over');
    setText(el.titleEnd, 'Shot down');
    setText(el.endSub, deep === 0
      ? 'You did not clear a wave. Tighten up and go again.'
      : 'You cleared wave ' + deep + ' and took down ' + g.bossesBeaten +
        ' Dreadnought' + (g.bossesBeaten === 1 ? '' : 's') + '. The sky only gets harder.');
    setText(el.endScore, formatNumber(g.score));
    setText(el.endWaves, String(deep));
    setText(el.endBosses, String(g.bossesBeaten));
    setText(el.endTime, formatTime(g.runTime));
    setText(el.endKills, formatNumber(g.kills));
    el.endSave.textContent = StartNG.identity.status === 'loading' ? 'Checking your start.ng account…' : 'Saving this run…';
    el.endSave.removeAttribute('data-tone');

    setState('gameover');
    Audio.play('gameover');
    announce('Run over. Score ' + formatNumber(g.score) + ', ' + deep + ' waves cleared.');
    saveRun();
  }

  /* ------------------------------------------------------------------ *
   * start.ng: save the run, read the board, draw the character
   * ------------------------------------------------------------------ */

  function saveRun() {
    /* Whole numbers only, and exactly the declared columns. */
    var stats = {
      score: Math.max(0, Math.round(g.score)),
      waves: Math.max(0, Math.round(g.wavesCleared)),
      kills: Math.max(0, Math.round(g.kills)),
      time: Math.max(1, Math.round(g.runTime))
    };

    StartNG.saveRun(stats).then(function (res) {
      if (res.ok) {
        var r = res.result || {};
        var rank = r.rank ? ' — you are #' + r.rank : '';
        el.endSave.dataset.tone = r.improved ? '' : 'warn';
        el.endSave.textContent = r.improved
          ? 'New best run saved to start.ng' + rank + '.'
          : 'Run saved to start.ng' + rank + '. Your best still stands.';
      } else {
        el.endSave.dataset.tone = res.reason === 'guest' ? 'warn' : 'bad';
        el.endSave.textContent = res.error;
      }
      loadBoard();
    });
  }

  function loadBoard() {
    StartNG.leaderboard(10).then(function (res) {
      if (!res.ok) {
        el.boardRows.replaceChildren(rowMessage('No scores yet — the board opens up once the game is live on start.ng.'));
        el.boardNote.textContent = StartNG.identity.status === 'offline'
          ? 'You are playing away from start.ng, so the board is unavailable.'
          : 'Waiting for start.ng…';
        return;
      }
      el.boardNote.textContent = res.entries.length
        ? 'Best runs on start.ng — score first, then waves, shootdowns and time.'
        : 'No signed-in runs yet. Be the first.';

      el.boardRows.replaceChildren.apply(el.boardRows, res.entries.map(boardRow));
    });
  }

  function rowMessage(text) {
    var tr = document.createElement('tr');
    var td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'board-empty';
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  }

  function boardRow(entry) {
    var tr = document.createElement('tr');
    var s = entry.stats || {};
    var cells = [
      entry.rank,
      entry.name || 'Pilot',
      formatNumber(s.score || entry.score || 0),
      String(s.waves == null ? '—' : s.waves),
      formatNumber(s.kills == null ? 0 : s.kills),
      s.time == null ? '—' : formatTime(s.time)
    ];

    cells.forEach(function (value, index) {
      var cell = document.createElement(index === 0 ? 'th' : 'td');
      if (index === 0) cell.setAttribute('scope', 'row');
      cell.textContent = String(value);
      tr.appendChild(cell);
    });

    var idCell = tr.children[1];
    if (entry.color) {
      var dot = document.createElement('span');
      dot.style.cssText = 'display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;background:' + entry.color;
      idCell.insertBefore(dot, idCell.firstChild);
    }
    if (StartNG.identity.signedIn && entry.player_id === StartNG.identity.id) tr.className = 'is-you';
    return tr;
  }

  function renderIdentity() {
    var id = StartNG.identity;
    el.playerCard.dataset.state = id.status;
    el.playerName.textContent = id.name || 'Guest';
    el.playerSignin.href = StartNG.signInUrl();

    if (id.status === 'loading') {
      el.playerAccount.textContent = 'Connecting to start.ng…';
      el.playerSignin.hidden = true;
      setText(el.pilotName, 'Pilot');
      setText(el.pilotAccount, 'Looking up your start.ng character…');
      setText(el.pilotNote, 'Guests and offline players still get the default look.');
    } else if (id.status === 'signed-in') {
      el.playerAccount.textContent = id.account ? '@' + id.account : 'Signed in';
      el.playerSignin.hidden = true;
      setText(el.pilotName, id.name || 'Pilot');
      setText(el.pilotAccount, (id.account ? '@' + id.account + ' · ' : '') + 'signed in with start.ng');
      setText(el.pilotNote, id.style ? 'This is your start.ng character, flying as the pilot.' : 'Your character looks like this: make one on start.ng.');
    } else if (id.status === 'guest') {
      el.playerAccount.textContent = id.account ? '@' + id.account : 'Playing as guest';
      el.playerSignin.hidden = StartNG.guestMode;
      setText(el.pilotName, id.name || 'Guest');
      setText(el.pilotAccount, 'Guest look from start.ng');
      setText(el.pilotNote, 'Guests can play and see the board. Sign in to save runs.');
    } else {
      el.playerAccount.textContent = 'Not on start.ng';
      el.playerSignin.hidden = false;
      setText(el.pilotName, id.name || 'Guest');
      setText(el.pilotAccount, 'Playing offline as the default guest');
      setText(el.pilotNote, 'Open this game on start.ng to fly as your own character.');
    }

    if (id.face) {
      el.playerFace.src = id.face;
      el.playerCard.dataset.hasFace = 'true';
    } else {
      el.playerFace.removeAttribute('src');
      el.playerCard.dataset.hasFace = 'false';
      setText(el.playerInitial, (id.name || 'G').charAt(0).toUpperCase());
    }

    drawPilotPreview();
    drawAllShipPreviews();
  }

  function drawPilotPreview() {
    var c = el.pilotPreview;
    if (!c) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var size = 220;
    if (c.width !== size * dpr) {
      c.width = size * dpr;
      c.height = size * dpr;
    }
    var x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, size, size);
    Art.drawCharacter(x, pilotStyle(), { x: size / 2, y: size / 2 + 8, scale: 1.12 });
  }

  function drawShipPreview(canvasEl) {
    var shipId = canvasEl.dataset.ship || chosenShip;
    var x = canvasEl.getContext('2d');
    x.clearRect(0, 0, canvasEl.width, canvasEl.height);
    var size = canvasEl.width;
    var glow = x.createRadialGradient(size / 2, size * 0.45, 4, size / 2, size * 0.5, size * 0.52);
    glow.addColorStop(0, 'rgba(126,200,255,0.28)');
    glow.addColorStop(1, 'rgba(126,200,255,0)');
    x.fillStyle = glow;
    x.fillRect(0, 0, size, size);
    Art.drawShip(x, shipId, {
      x: size / 2, y: size * 0.56, size: size * 0.78, thrust: 0.7,
      pilotStyle: pilotStyle(), time: 0
    });
  }

  function drawAllShipPreviews() {
    var cards = el.shipGrid.querySelectorAll('.ship canvas');
    for (var i = 0; i < cards.length; i++) drawShipPreview(cards[i]);
  }

  function chooseShip(id) {
    var known = Art.SHIPS.some(function (s) { return s.id === id; });
    if (!known) return;
    chosenShip = id;
    store(STORE_SHIP, id);
    Audio.play('ui');
  }

  function buildShipPicker() {
    el.shipGrid.replaceChildren();
    Art.SHIPS.forEach(function (ship) {
      var label = document.createElement('label');
      label.className = 'ship';

      var input = document.createElement('input');
      input.type = 'radio';
      input.name = 'ship';
      input.value = ship.id;
      if (ship.id === chosenShip) input.checked = true;
      input.addEventListener('change', function () { chooseShip(ship.id); });

      var art = document.createElement('canvas');
      art.width = 240;
      art.height = 240;
      art.dataset.ship = ship.id;
      art.setAttribute('aria-hidden', 'true');

      var name = document.createElement('span');
      name.className = 'ship__name';
      name.textContent = ship.name;

      var blurb = document.createElement('span');
      blurb.className = 'ship__blurb';
      blurb.textContent = ship.blurb;

      label.append(input, art, name, blurb);
      el.shipGrid.appendChild(label);
      drawShipPreview(art);
    });
  }

  /* ------------------------------------------------------------------ *
   * input
   * ------------------------------------------------------------------ */

  function pointerToGame(e) {
    var rect = canvas.getBoundingClientRect();
    input.pointer.x = clamp((e.clientX - rect.left - view.offX) / view.scale, 0, W);
    input.pointer.y = clamp((e.clientY - rect.top - view.offY) / view.scale, 0, H);
  }

  /* Where the thumb lands becomes the centre of a floating stick, so players
     can rest it low in the frame and still steer the aircraft above it. */
  function onPointerDown(e) {
    Audio.unlock();
    if (g.state !== 'playing') return;
    if (input.pointer.id !== null && input.pointer.id !== e.pointerId) return;

    pointerToGame(e);
    input.pointer.active = true;
    input.pointer.id = e.pointerId;
    input.pointer.type = e.pointerType || 'mouse';
    input.pointer.originX = clamp(input.pointer.x, 56, W - 56);
    input.pointer.originY = clamp(input.pointer.y, H * 0.3, H - 56);
    input.pointer.x = input.pointer.originX;
    input.pointer.y = input.pointer.originY;
    if (input.pointer.type !== 'mouse') g.touchHint = 0;

    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!input.pointer.active || (input.pointer.id !== null && input.pointer.id !== e.pointerId)) return;
    pointerToGame(e);
    e.preventDefault();
  }

  function onPointerUp(e) {
    if (input.pointer.id !== null && e.pointerId !== undefined && e.pointerId !== input.pointer.id) return;
    var wasTouch = e.pointerType !== 'mouse';
    resetStick();
    if (wasTouch) {
      input.pointer.x = input.pointer.originX;
      input.pointer.y = input.pointer.originY;
    }
  }

  function onKeyDown(e) {
    Audio.unlock();
    var tag = e.target && e.target.tagName;
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (e.code === 'KeyM' && !typing) {
      toggleSound();
      return;
    }

    if (g.state === 'playing') {
      if (e.code === 'KeyP' || e.code === 'Escape') {
        e.preventDefault();
        pause();
        return;
      }
      if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Space'].indexOf(e.code) >= 0) e.preventDefault();
      input.keys[e.code] = true;
      return;
    }

    if (typing) return;

    if (g.state === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) {
      e.preventDefault();
      resume();
      return;
    }

    if ((e.code === 'Enter' || e.code === 'Space') && !e.repeat) {
      if (g.state === 'menu') { e.preventDefault(); Audio.play('ui'); startRun(); }
      else if (g.state === 'paused') { e.preventDefault(); resume(); }
      else if (g.state === 'gameover') { e.preventDefault(); startRun(); }
    }
    if (e.code === 'KeyR' && g.state === 'gameover') startRun();
  }

  function onKeyUp(e) { input.keys[e.code] = false; }

  function toggleSound() {
    var muted = Audio.toggle();
    el.btnSound.textContent = 'Sound: ' + (muted ? 'off' : 'on');
    el.btnSound.setAttribute('aria-pressed', String(!muted));
    if (!muted) Audio.play('ui');
  }

  function resize() {
    var rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    view.dpr = dpr;
    view.scale = Math.min(rect.width / W, rect.height / H);
    view.offX = (rect.width - W * view.scale) / 2;
    view.offY = (rect.height - H * view.scale) / 2;
  }

  /* ------------------------------------------------------------------ *
   * boot
   * ------------------------------------------------------------------ */

  function wireUp() {
    el.btnStart.addEventListener('click', function () { Audio.play('ui'); startRun(); });
    el.btnAgain.addEventListener('click', function () { Audio.play('ui'); startRun(); });
    el.btnHangar.addEventListener('click', function () { Audio.play('ui'); setState('menu'); });
    el.btnQuit.addEventListener('click', function () { Audio.play('ui'); setState('menu'); });
    el.btnResume.addEventListener('click', function () { Audio.play('ui'); resume(); });
    el.btnRestartPause.addEventListener('click', function () { Audio.play('ui'); startRun(); });
    el.btnPause.addEventListener('click', function () { Audio.play('ui'); pause(); });
    el.btnBoardRefresh.addEventListener('click', function () { Audio.play('ui'); loadBoard(); });
    el.btnSound.addEventListener('click', toggleSound);

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', function () { input.keys = {}; resetStick(); });
    window.addEventListener('resize', resize);
    if (window.matchMedia) {
      var mq = window.matchMedia('(min-width: 1024px)');
      if (mq.addEventListener) mq.addEventListener('change', resize);
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && g.state === 'playing') pause();
    });

    el.btnSound.textContent = 'Sound: ' + (Audio.isMuted() ? 'off' : 'on');
    el.btnSound.setAttribute('aria-pressed', String(!Audio.isMuted()));
  }

  function frame(now) {
    var dt = (now - frame.last) / 1000;
    frame.last = now;
    if (!isFinite(dt) || dt < 0) dt = 0;
    update(Math.min(0.05, dt));
    render();
    requestAnimationFrame(frame);
  }

  /* A small seam for automated smoke tests: it lets a test step the world
     without waiting on requestAnimationFrame, which browsers pause in
     background tabs. Nothing in the game depends on it. */
  SP.debug = {
    game: g,
    input: input,
    view: view,
    update: update,
    render: render,
    start: startRun,
    setShip: chooseShip,
    finish: endRun
  };

  function boot() {
    buildBackground();
    buildShipPicker();
    wireUp();
    resize();
    setState('menu');
    requestAnimationFrame(function (now) {
      frame.last = now;
      requestAnimationFrame(frame);
    });

    StartNG.onChange(renderIdentity);
    renderIdentity();
    loadBoard();

    /* Ask who is playing. Never block the game on it: guests and offline
       players get the default guest look and keep playing. */
    StartNG.refresh().then(function () {
      renderIdentity();
      loadBoard();
    });

    /* They may have signed in on start.ng while the tab was in the background. */
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) StartNG.refresh().then(renderIdentity);
    });
    window.addEventListener('focus', function () {
      StartNG.refresh().then(renderIdentity);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})(window.SP);
