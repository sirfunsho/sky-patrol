/* Sky Patrol — game loop, hazards, waves, boss and Start.ng wiring.
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
  var TOTAL_WAVES = 5;
  var HULL_START = 4;
  var HULL_MAX = 6;
  var INVULN_TIME = 1.9;
  var WEAPON_TIME = 18;
  var PLAYER_MIN_Y = 96;
  var PLAYER_MAX_Y = H - 60;
  var PLAYER_SPEED = 430;
  var MAX_PARTICLES = 320;
  var REDUCED_MOTION = window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
    : false;

  var STORE_SHIP = 'sky-patrol:ship';

  var WEAPONS = {
    pulse: { name: 'Pulse', rate: 0.15, dmg: 1, shots: [[0, 0]], speed: 940, size: 4, color: '#7ef7ff', pierce: false },
    spread: { name: 'Spread', rate: 0.19, dmg: 1, shots: [[-0.3, 0], [0, 0], [0.3, 0]], speed: 880, size: 4, color: '#ffd93d', pierce: false },
    rapid: { name: 'Rapid', rate: 0.075, dmg: 1, shots: [[0, 0]], speed: 1000, size: 3, color: '#a6ff7e', pierce: false },
    laser: { name: 'Laser', rate: 0.12, dmg: 2.4, shots: [[0, 0]], speed: 1500, size: 6, color: '#ff5cf0', pierce: true }
  };
  var WEAPON_KEYS = ['spread', 'rapid', 'laser'];

  var WAVES = [
    { label: 'Calm skies', count: 10, gap: [1.5, 2.1], fighter: 0.1, size: [14, 26], speed: 1, hp: 1 },
    { label: 'Rubble field', count: 14, gap: [1.25, 1.75], fighter: 0.2, size: [16, 32], speed: 1.06, hp: 1 },
    { label: 'Jet traffic', count: 19, gap: [1.05, 1.5], fighter: 0.32, size: [18, 38], speed: 1.12, hp: 2 },
    { label: 'Heavy metals', count: 23, gap: [0.95, 1.35], fighter: 0.4, size: [18, 42], speed: 1.2, hp: 2 },
    { label: 'Last call', count: 27, gap: [0.85, 1.15], fighter: 0.48, size: [20, 46], speed: 1.28, hp: 3 }
  ];

  var BOSS = {
    name: 'Dreadnought',
    hp: 220,
    w: 236,
    h: 86,
    y: 232
  };

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
    endBoss: document.getElementById('end-boss'),
    endTime: document.getElementById('end-time'),
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
    won: false,
    shake: 0,
    banner: null,
    bannerTimer: 0,
    spawnLeft: 0,
    spawnTimer: 0,
    pickupTimer: 8,
    gapTimer: 0,
    bossIntroTimer: 0,
    bossDeathTimer: 0,
    hudTimer: 0,
    player: {
      x: W / 2, y: H * 0.72, vx: 0, vy: 0, tilt: 0,
      hp: HULL_START, weapon: 'pulse', weaponTime: 0, shield: 0,
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

  var input = { keys: {}, pointer: { active: false, x: W / 2, y: H * 0.72 } };

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
      var k = Math.min(1, 15 * dt);
      p.x += (input.pointer.x - p.x) * k;
      p.y += (input.pointer.y - p.y) * k;
      p.vx = 0;
      p.vy = 0;
    } else {
      var ax = (isDown('right') ? 1 : 0) - (isDown('left') ? 1 : 0);
      var ay = (isDown('down') ? 1 : 0) - (isDown('up') ? 1 : 0);
      if (ax || ay) {
        var len = Math.sqrt(ax * ax + ay * ay);
        p.vx = (ax / len) * PLAYER_SPEED;
        p.vy = (ay / len) * PLAYER_SPEED;
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
        p.weapon = 'pulse';
        showBanner('WEAPON OFFLINE', 'Back to pulse fire');
      }
    }
    p.thrust = 0.65 + 0.35 * Math.sin(g.time * 30) + (isDown('up') ? 0.2 : 0);

    /* weapons fire on their own */
    p.fireTimer -= dt;
    if (p.fireTimer <= 0) {
      var w = WEAPONS[p.weapon];
      for (var i = 0; i < w.shots.length; i++) {
        var s = w.shots[i];
        g.bullets.push({
          id: g.nextId++, x: p.x + s[1], y: p.y - 24,
          vx: Math.sin(s[0]) * w.speed, vy: -Math.cos(s[0]) * w.speed,
          dmg: w.dmg, size: w.size, color: w.color, pierce: w.pierce, hits: []
        });
      }
      p.fireTimer = w.rate;
      Audio.play(p.weapon === 'laser' ? 'laser' : 'shoot');
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
    g.won = false;
    g.runTime = 0;
    g.shake = 0;
    g.banner = null;
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
    announce('Run started. Wave 1 of ' + TOTAL_WAVES + '.');
  }

  function startWave(n) {
    g.wave = n;
    g.phase = 'wave';
    var plan = WAVES[n - 1];
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
    var plan = WAVES[g.wave - 1];
    if (Math.random() < plan.fighter) spawnFighter(plan);
    else spawnMeteor(plan);
    g.spawnLeft -= 1;
  }

  function spawnPickup(kind, x, y) {
    if (!kind) {
      var roll = Math.random();
      kind = roll < 0.34 ? 'weapon' : roll < 0.56 ? 'shield' : roll < 0.74 ? 'repair' : roll < 0.86 ? 'emp' : 'star';
    }
    g.pickups.push({ kind: kind, x: clamp(x, 40, W - 40), y: y, vy: rand(70, 110), t: 0, life: 16 });
  }

  function collectPickup(p) {
    var pl = g.player;
    if (p.kind === 'weapon') {
      var options = WEAPON_KEYS.filter(function (key) { return key !== pl.weapon; });
      var pick = options[randInt(0, options.length - 1)];
      pl.weapon = pick;
      pl.weaponTime = WEAPON_TIME;
      g.pops.push({ x: p.x, y: p.y, text: WEAPONS[pick].name.toUpperCase(), t: 0, color: '#ff9f43' });
      Audio.play('pickup');
    } else if (p.kind === 'shield') {
      pl.shield = 15;
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
    /* supplies keep drifting in, including during the boss fight */
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
          var plan = WAVES[g.wave - 1];
          g.spawnTimer = rand(plan.gap[0], plan.gap[1]);
        }
      } else if (g.enemies.length === 0) {
        g.wavesCleared = g.wave;
        var bonus = 150 * g.wave;
        addScore(bonus);
        Audio.play('wave');
        showBanner('WAVE ' + g.wave + ' CLEAR', '+' + bonus + ' points');
        announce('Wave ' + g.wave + ' cleared. ' + g.wavesCleared + ' of ' + TOTAL_WAVES + '.');
        if (g.wave >= TOTAL_WAVES) {
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
      if (g.bossDeathTimer <= 0) endRun(true);
    }
  }

  /* ------------------------------------------------------------------ *
   * boss
   * ------------------------------------------------------------------ */

  function startBoss() {
    g.phase = 'boss';
    g.boss = {
      id: g.nextId++, x: W / 2, y: -90, w: BOSS.w, h: BOSS.h,
      hp: BOSS.hp, maxHp: BOSS.hp, t: 0, dir: 1, speed: 105,
      fire: 2, volley: 0, minion: 5.5, hitFlash: 0, entering: true
    };
    showBanner(BOSS.name.toUpperCase(), 'Break it and the sky is yours');
    Audio.play('boss');
    announce('Boss fight. The Dreadnought has arrived.');
  }

  function bossShot(x, y, angle, speed) {
    g.shots.push({
      x: x, y: y,
      vx: Math.sin(angle) * speed,
      vy: Math.cos(angle) * speed,
      r: 6, color: '#ff8c42'
    });
  }

  function updateBoss(dt) {
    var b = g.boss;
    if (!b) return;
    b.t += dt;
    b.hitFlash = Math.max(0, b.hitFlash - dt);

    if (b.entering) {
      b.y += 95 * dt;
      if (b.y >= BOSS.y) { b.y = BOSS.y; b.entering = false; }
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
      b.fire = phase2 ? 1.25 : 1.8;
      Audio.play('enemyShoot');
    }

    b.minion -= dt;
    if (b.minion <= 0) {
      b.minion = phase2 ? 5.5 : 7.5;
      [-1, 1].forEach(function (side) {
        spawnFighter(WAVES[TOTAL_WAVES - 1]);
        var m = g.enemies[g.enemies.length - 1];
        m.y = b.y + 30;
        m.x = clamp(b.x + side * (b.w / 2 + 30), 40, W - 40);
        m.origin = m.x;
      });
    }

    /* ramming the boss hurts */
    if (Math.abs(g.player.x - b.x) < b.w / 2 + 10 && Math.abs(g.player.y - b.y) < b.h / 2 + 12) {
      if (damagePlayer()) g.player.y += 34;
    }

    if (b.hp <= 0 && g.phase === 'boss') {
      g.phase = 'bossDying';
      g.bossDeathTimer = 1.8;
      addScore(3000);
      Audio.play('bigExplode');
      shake(20);
      announce('The Dreadnought is going down!');
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

      if (g.boss && !g.boss.entering && Math.abs(b.x - g.boss.x) < g.boss.w / 2 && Math.abs(b.y - g.boss.y) < g.boss.h / 2) {
        g.boss.hp -= b.dmg;
        g.boss.hitFlash = 0.09;
        burst(b.x, b.y, 3, '#ffd93d', 90, 2);
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
        e.flash = 0.1;
        burst(b.x, b.y, 3, b.color, 80, 2);
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
    for (i = 0; i < g.pickups.length; i++) Art.drawPickup(ctx, g.pickups[i]);
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
      ctx.fillStyle = b.color;
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 10;
      Art.helpers.starPath(ctx, b.x, b.y, b.size + 1.6, b.size * 0.4, 4);
      ctx.fill();
      ctx.shadowBlur = 0;
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
    setText(el.hudScore, formatNumber(g.score));
    setText(el.hudWave, g.wave + '/' + TOTAL_WAVES);
    setText(el.hudTime, formatTime(g.runTime));
    setText(el.hudHull, '♥'.repeat(Math.max(0, p.hp)) + '·'.repeat(HULL_MAX - clamp(p.hp, 0, HULL_MAX)));
    el.hudHull.setAttribute('aria-label', 'Hull ' + Math.max(0, p.hp) + ' of ' + HULL_MAX);

    if (p.weaponTime > 0) {
      el.hudGear.hidden = false;
      setText(el.hudGear, WEAPONS[p.weapon].name + ' weapon · ' + Math.ceil(p.weaponTime) + 's' +
        (p.shield > 0 ? ' · shield ' + Math.ceil(p.shield) + 's' : ''));
    } else if (p.shield > 0) {
      el.hudGear.hidden = false;
      setText(el.hudGear, 'Shield ' + Math.ceil(p.shield) + 's');
    } else {
      el.hudGear.hidden = true;
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
    el.screens.end.hidden = next !== 'gameover' && next !== 'victory';
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

  function pause() {
    if (g.state !== 'playing') return;
    input.keys = {};
    input.pointer.active = false;
    setState('paused');
    announce('Paused.');
  }

  function resume() {
    if (g.state !== 'paused') return;
    setState('playing');
    announce('Back in the sky.');
  }

  function endRun(won) {
    if (g.state !== 'playing') return;
    g.won = won;
    input.keys = {};
    input.pointer.active = false;

    setText(el.endEyebrow, won ? 'Victory' : 'Run over');
    setText(el.titleEnd, won ? 'Boss defeated' : 'Shot down');
    setText(el.endSub, won
      ? 'The Dreadnought is scrap. That is every wave handled.'
      : 'You got to wave ' + g.wave + ' of ' + TOTAL_WAVES + '. Tighten up and go again.');
    setText(el.endScore, formatNumber(g.score));
    setText(el.endWaves, g.wavesCleared + ' / ' + TOTAL_WAVES);
    setText(el.endBoss, won ? 'Yes' : 'No');
    setText(el.endTime, formatTime(g.runTime));
    setText(el.endKills, formatNumber(g.kills));
    el.endSave.textContent = StartNG.identity.status === 'loading' ? 'Checking your start.ng account…' : 'Saving this run…';
    el.endSave.removeAttribute('data-tone');

    setState(won ? 'victory' : 'gameover');
    Audio.play(won ? 'victory' : 'gameover');
    announce(won ? 'Victory! You beat the Dreadnought.' : 'Run over. Score ' + formatNumber(g.score) + '.');
    saveRun();
  }

  /* ------------------------------------------------------------------ *
   * start.ng: save the run, read the board, draw the character
   * ------------------------------------------------------------------ */

  function saveRun() {
    /* Whole numbers only, and exactly the four declared columns. */
    var stats = {
      boss: g.won ? 1 : 0,
      score: Math.max(0, Math.round(g.score)),
      waves: Math.max(0, Math.round(g.wavesCleared)),
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
        ? 'Best runs on start.ng — boss first, then score, waves and time.'
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
      s.boss ? '✓' : '—',
      formatNumber(s.score || entry.score || 0),
      String(s.waves == null ? '—' : s.waves),
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
    input.pointer.x = clamp((e.clientX - rect.left - view.offX) / view.scale, 10, W - 10);
    input.pointer.y = clamp((e.clientY - rect.top - view.offY) / view.scale, PLAYER_MIN_Y, H - 20);
  }

  function onPointerDown(e) {
    Audio.unlock();
    if (g.state !== 'playing') return;
    input.pointer.active = true;
    pointerToGame(e);
    if (canvas.setPointerCapture) {
      try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    }
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!input.pointer.active) return;
    pointerToGame(e);
    e.preventDefault();
  }

  function onPointerUp() { input.pointer.active = false; }

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
      else if (g.state === 'gameover' || g.state === 'victory') { e.preventDefault(); startRun(); }
    }
    if (e.code === 'KeyR' && (g.state === 'gameover' || g.state === 'victory')) startRun();
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
    window.addEventListener('blur', function () { input.keys = {}; input.pointer.active = false; });
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