/* Sky Patrol — all artwork, drawn with plain Canvas 2D paths.
 *
 * Nothing here loads an image, so the whole game stays a handful of text files.
 * Aircraft skins and the Start.ng character are both drawn here, in a local
 * space where the ship is ~104 units long, nose up.
 */
window.SP = window.SP || {};

(function (SP) {
  'use strict';

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */

  function hex(value, fallback) {
    if (typeof value !== 'string') return fallback;
    var v = value.trim();
    return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : fallback;
  }

  function toRgb(color) {
    var c = hex(color, '#888888').slice(1);
    if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
    var n = parseInt(c, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }

  function rgba(color, alpha) {
    var c = toRgb(color);
    return 'rgba(' + c.r + ',' + c.g + ',' + c.b + ',' + alpha + ')';
  }

  function mix(a, b, t) {
    var x = toRgb(a), y = toRgb(b);
    var r = Math.round(x.r + (y.r - x.r) * t);
    var g = Math.round(x.g + (y.g - x.g) * t);
    var bl = Math.round(x.b + (y.b - x.b) * t);
    return 'rgb(' + r + ',' + g + ',' + bl + ')';
  }

  function lighten(color, t) { return mix(color, '#ffffff', t); }
  function darken(color, t) { return mix(color, '#05060f', t); }

  function roundRect(ctx, x, y, w, h, r) {
    var rr = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  function poly(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (var i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.closePath();
  }

  function starPath(ctx, x, y, outer, inner, points) {
    var n = points || 5;
    ctx.beginPath();
    for (var i = 0; i < n * 2; i++) {
      var r = i % 2 ? inner : outer;
      var a = -Math.PI / 2 + (i * Math.PI) / n;
      var px = x + Math.cos(a) * r;
      var py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function heartPath(ctx, x, y, size) {
    ctx.beginPath();
    ctx.moveTo(x, y + size * 0.75);
    ctx.bezierCurveTo(x - size * 1.3, y - size * 0.15, x - size * 0.45, y - size, x, y - size * 0.35);
    ctx.bezierCurveTo(x + size * 0.45, y - size, x + size * 1.3, y - size * 0.15, x, y + size * 0.75);
    ctx.closePath();
  }

  function ellipse(ctx, x, y, rx, ry, rot) {
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, rot || 0, 0, Math.PI * 2);
  }

  function makeCanvas(w, h) {
    var c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    return c;
  }

  /* Tiny deterministic PRNG so the sky looks the same on every load. */
  function rng(seed) {
    var s = seed >>> 0;
    return function () {
      s += 0x6d2b79f5;
      var t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * Start.ng character
   * ------------------------------------------------------------------ */

  var HAIR = ['short', 'afro', 'braids', 'bun', 'ponytail', 'dreads', 'bald'];
  var HATS = ['none', 'cap', 'beanie', 'tophat', 'crown'];
  var KITS = ['none', 'glasses', 'earrings', 'beard', 'scarf', 'backpack'];
  var BODIES = ['female', 'male'];

  /* Start.ng's documented guest look, used when we cannot ask. */
  var GUEST_STYLE = {
    body: 'female',
    primaryColor: '#a55eea',
    secondaryColor: '#0c6e5a',
    skinColor: '#8d5524',
    hairColor: '#17120f',
    hair: 'braids',
    hat: 'crown',
    accessory: 'earrings'
  };

  function normaliseStyle(style) {
    var s = style && typeof style === 'object' ? style : {};
    return {
      body: BODIES.indexOf(s.body) >= 0 ? s.body : GUEST_STYLE.body,
      primaryColor: hex(s.primaryColor, GUEST_STYLE.primaryColor),
      secondaryColor: hex(s.secondaryColor, GUEST_STYLE.secondaryColor),
      skinColor: hex(s.skinColor, GUEST_STYLE.skinColor),
      hairColor: hex(s.hairColor, GUEST_STYLE.hairColor),
      hair: HAIR.indexOf(s.hair) >= 0 ? s.hair : GUEST_STYLE.hair,
      hat: HATS.indexOf(s.hat) >= 0 ? s.hat : GUEST_STYLE.hat,
      accessory: KITS.indexOf(s.accessory) >= 0 ? s.accessory : GUEST_STYLE.accessory
    };
  }

  /* Draws a character bust in a 100 unit box centred on the origin.
     opts: { x, y, scale, blink, look } */
  function drawCharacter(ctx, style, opts) {
    var o = opts || {};
    var s = normaliseStyle(style);
    var x = o.x || 0;
    var y = o.y || 0;
    var scale = o.scale == null ? 1 : o.scale;
    var skin = s.skinColor;
    var hair = s.hairColor;
    var shirt = s.primaryColor;
    var pants = s.secondaryColor;
    var ink = '#1a1c2e';
    var shoulder = s.body === 'male' ? 19 : 17;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    /* ---- hair behind the head ---- */
    ctx.fillStyle = darken(hair, 0.25);
    if (s.hair === 'afro') {
      ellipse(ctx, 0, -34, 31, 30);
      ctx.fill();
    } else if (s.hair === 'dreads') {
      for (var d = 0; d < 9; d++) {
        var a = Math.PI + (d / 8) * Math.PI;
        ellipse(ctx, Math.cos(a) * 25, -28 + Math.sin(a) * 23, 6, 7);
        ctx.fill();
      }
    } else if (s.hair === 'braids') {
      [-1, 1].forEach(function (side) {
        roundRect(ctx, side * 25 - 5, -34, 10, 54, 5);
        ctx.fill();
        ctx.fillStyle = lighten(hair, 0.25);
        for (var b = 0; b < 3; b++) {
          roundRect(ctx, side * 25 - 5.5, -26 + b * 15, 11, 4, 2);
          ctx.fill();
          ctx.fillStyle = darken(hair, 0.25);
        }
      });
    } else if (s.hair === 'bun') {
      ellipse(ctx, 0, -50, 13, 12);
      ctx.fill();
    } else if (s.hair === 'ponytail') {
      ellipse(ctx, 20, -12, 11, 22, -0.5);
      ctx.fill();
      ellipse(ctx, 16, -34, 12, 12);
      ctx.fill();
    }

    /* ---- backpack sits behind the body ---- */
    if (s.accessory === 'backpack') {
      ctx.fillStyle = darken(pants, 0.1);
      roundRect(ctx, -16, -2, 32, 34, 9);
      ctx.fill();
    }

    /* ---- body ---- */
    ctx.fillStyle = shirt;
    poly(ctx, [
      [-shoulder, 4], [-shoulder + 2, -6], [shoulder - 2, -6], [shoulder, 4],
      [shoulder - 1, 26], [-shoulder + 1, 26]
    ]);
    ctx.fill();

    /* arms */
    ctx.fillStyle = darken(shirt, 0.12);
    [-1, 1].forEach(function (side) {
      roundRect(ctx, side * (shoulder - 4) - 5.5, 2, 11, 26, 5.5);
      ctx.fill();
      ctx.fillStyle = skin;
      ellipse(ctx, side * (shoulder - 4), 29, 5.5, 5.5);
      ctx.fill();
      ctx.fillStyle = darken(shirt, 0.12);
    });

    /* trousers */
    ctx.fillStyle = pants;
    roundRect(ctx, -shoulder + 2, 24, (shoulder - 2) * 2, 20, 6);
    ctx.fill();

    /* ---- scarf ---- */
    if (s.accessory === 'scarf') {
      ctx.fillStyle = '#ef476f';
      roundRect(ctx, -shoulder - 1, -8, (shoulder + 1) * 2, 11, 5);
      ctx.fill();
      poly(ctx, [[6, 0], [18, 4], [14, 26], [5, 22]]);
      ctx.fill();
    }

    /* ---- head ---- */
    ctx.fillStyle = skin;
    [-1, 1].forEach(function (side) { ellipse(ctx, side * 22, -26, 5, 6); ctx.fill(); });
    ellipse(ctx, 0, -28, 23, 24);
    ctx.fill();

    /* hair front */
    if (s.hair !== 'bald') {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, -30, 24, Math.PI * 1.04, Math.PI * 2.0);
      ctx.lineTo(24, -30);
      ctx.quadraticCurveTo(10, -36, 0, -33);
      ctx.quadraticCurveTo(-12, -36, -24, -28);
      ctx.closePath();
      ctx.fill();
      if (s.hair === 'ponytail' || s.hair === 'bun') {
        ctx.beginPath();
        ctx.arc(0, -30, 24, Math.PI * 1.12, Math.PI * 1.9);
        ctx.quadraticCurveTo(0, -22, -22, -28);
        ctx.closePath();
        ctx.fill();
      }
    }

    /* face */
    ctx.fillStyle = ink;
    var blink = o.blink ? 0.12 : 1;
    ellipse(ctx, -8, -25, 3, 3.6 * blink);
    ctx.fill();
    ellipse(ctx, 8, -25, 3, 3.6 * blink);
    ctx.fill();
    if (!o.blink) {
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ellipse(ctx, -7, -26.5, 1, 1);
      ctx.fill();
      ellipse(ctx, 9, -26.5, 1, 1);
      ctx.fill();
    }
    ctx.strokeStyle = darken(skin, 0.45);
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.arc(0, -17, 5, 0.25 * Math.PI, 0.75 * Math.PI);
    ctx.stroke();

    /* beard sits over the mouth */
    if (s.accessory === 'beard') {
      ctx.fillStyle = hair;
      ctx.beginPath();
      ctx.arc(0, -14, 14, 0.08 * Math.PI, 0.92 * Math.PI);
      ctx.lineTo(14, -18);
      ctx.quadraticCurveTo(0, -26, -14, -18);
      ctx.closePath();
      ctx.fill();
    }

    /* glasses */
    if (s.accessory === 'glasses') {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 2;
      roundRect(ctx, -14, -31, 12, 11, 3);
      ctx.stroke();
      roundRect(ctx, 2, -31, 12, 11, 3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-2, -27);
      ctx.lineTo(2, -27);
      ctx.stroke();
    }

    /* earrings */
    if (s.accessory === 'earrings') {
      ctx.fillStyle = '#ffd23f';
      ellipse(ctx, -24, -20, 3, 3);
      ctx.fill();
      ellipse(ctx, 24, -20, 3, 3);
      ctx.fill();
    }

    /* ---- hat ---- */
    if (s.hat === 'cap') {
      ctx.fillStyle = shirt;
      ctx.beginPath();
      ctx.arc(0, -32, 25, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = darken(shirt, 0.3);
      ellipse(ctx, -22, -32, 13, 4.5, -0.12);
      ctx.fill();
    } else if (s.hat === 'beanie') {
      ctx.fillStyle = lighten(shirt, 0.1);
      ctx.beginPath();
      ctx.arc(0, -32, 26, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = darken(shirt, 0.2);
      roundRect(ctx, -26, -34, 52, 10, 4);
      ctx.fill();
      ellipse(ctx, 0, -60, 7, 7);
      ctx.fill();
    } else if (s.hat === 'tophat') {
      ctx.fillStyle = '#22243a';
      ellipse(ctx, 0, -50, 27, 6);
      ctx.fill();
      roundRect(ctx, -16, -78, 32, 30, 4);
      ctx.fill();
      ctx.fillStyle = '#ffd23f';
      roundRect(ctx, -16, -58, 32, 8, 3);
      ctx.fill();
    } else if (s.hat === 'crown') {
      ctx.fillStyle = '#ffd23f';
      poly(ctx, [[-21, -44], [21, -44], [21, -54], [13, -46], [7, -60], [0, -47], [-7, -60], [-13, -46], [-21, -54]]);
      ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      ellipse(ctx, 0, -52, 2.6, 2.6);
      ctx.fill();
    }

    ctx.restore();
  }

  /* The character, sized and clipped to sit inside a cockpit. */
  function drawPilot(ctx, style, cx, cy, radius, clipPath) {
    ctx.save();
    if (clipPath) {
      ctx.beginPath();
      clipPath(ctx);
      ctx.clip();
    }
    drawCharacter(ctx, style, { x: cx, y: cy + radius * 0.12, scale: radius / 26 });
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * aircraft
   * ------------------------------------------------------------------ */

  var SHIPS = [
    {
      id: 'pink',
      name: 'Pink Comet',
      blurb: 'Sleek and shiny',
      body: '#ff8fc7', trim: '#fff0f7', dark: '#c2437f', glow: '#ff5fae'
    },
    {
      id: 'rugged',
      name: 'Rust Jaw',
      blurb: 'Armoured and riveted',
      body: '#9c7d50', trim: '#d8bf93', dark: '#5b4527', glow: '#ffb347'
    },
    {
      id: 'military',
      name: 'Falcon 4',
      blurb: 'Stealth delta wing',
      body: '#6f7f5c', trim: '#9db088', dark: '#3a452f', glow: '#b6e26a'
    },
    {
      id: 'classic',
      name: 'Old Piston',
      blurb: 'Propeller and chivalry',
      body: '#dccaa6', trim: '#8a5a34', dark: '#5b3a20', glow: '#ffd58a'
    },
    {
      id: 'neon',
      name: 'Volt Runner',
      blurb: 'Glowing edges',
      body: '#2c3160', trim: '#6ff3ff', dark: '#141832', glow: '#ff5cf0'
    }
  ];

  function shipById(id) {
    for (var i = 0; i < SHIPS.length; i++) if (SHIPS[i].id === id) return SHIPS[i];
    return SHIPS[0];
  }

  function thruster(ctx, x, y, w, h, color, amount) {
    if (!amount) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, amount);
    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, rgba(lighten(color, 0.65), 0.95));
    g.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = g;
    poly(ctx, [[x - w, y], [x + w, y], [x + w * 0.45, y + h], [x - w * 0.45, y + h]]);
    ctx.fill();
    ctx.restore();
  }

  function drawPink(ctx, o, pilotStyle) {
    var body = '#ff8fc7', trim = '#fff0f7', dark = '#c2437f', glow = '#ff5fae';
    thruster(ctx, 0, 42, 9, 34 + o.thrust * 16, glow, 0.35 + o.thrust);

    /* swept wings */
    var g = ctx.createLinearGradient(-46, 0, 46, 0);
    g.addColorStop(0, darken(body, 0.18));
    g.addColorStop(0.5, body);
    g.addColorStop(1, darken(body, 0.18));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(-5, -12);
    ctx.quadraticCurveTo(-34, 6, -46, 30);
    ctx.quadraticCurveTo(-40, 38, -26, 34);
    ctx.lineTo(-6, 16);
    ctx.closePath();
    ctx.moveTo(5, -12);
    ctx.quadraticCurveTo(34, 6, 46, 30);
    ctx.quadraticCurveTo(40, 38, 26, 34);
    ctx.lineTo(6, 16);
    ctx.closePath();
    ctx.fill();

    /* tail fins */
    ctx.fillStyle = dark;
    poly(ctx, [[-8, 24], [-16, 44], [-6, 42]]);
    ctx.fill();
    poly(ctx, [[8, 24], [16, 44], [6, 42]]);
    ctx.fill();

    /* fuselage */
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.bezierCurveTo(11, -40, 14, -4, 12, 40);
    ctx.lineTo(-12, 40);
    ctx.bezierCurveTo(-14, -4, -11, -40, 0, -52);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = trim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.lineTo(0, 40);
    ctx.stroke();

    ctx.fillStyle = rgba('#ffffff', 0.85);
    heartPath(ctx, 0, 8, 9);
    ctx.fill();

    /* canopy + pilot */
    ellipse(ctx, 0, -26, 13, 16);
    ctx.fillStyle = rgba('#20305c', 0.55);
    ctx.fill();
    drawPilot(ctx, pilotStyle, 0, -26, 12, function (c) { ellipse(c, 0, -26, 13, 16); });
    ctx.strokeStyle = trim;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.arc(0, -26, 13, Math.PI * 0.75, Math.PI * 1.75);
    ctx.stroke();
  }

  function drawRugged(ctx, o, pilotStyle) {
    var body = '#9c7d50', trim = '#d8bf93', dark = '#5b4527', glow = '#ffb347';
    thruster(ctx, -8, 44, 8, 30 + o.thrust * 14, glow, 0.35 + o.thrust);
    thruster(ctx, 8, 44, 8, 30 + o.thrust * 14, glow, 0.35 + o.thrust);

    /* thick straight wings */
    ctx.fillStyle = dark;
    poly(ctx, [[-16, -4], [-48, 12], [-48, 30], [-14, 28]]);
    ctx.fill();
    poly(ctx, [[16, -4], [48, 12], [48, 30], [14, 28]]);
    ctx.fill();

    ctx.fillStyle = body;
    poly(ctx, [[-18, -8], [-48, 10], [-48, 24], [-16, 22]]);
    ctx.fill();
    poly(ctx, [[18, -8], [48, 10], [48, 24], [16, 22]]);
    ctx.fill();

    /* rivets */
    ctx.fillStyle = lighten(dark, 0.25);
    [-1, 1].forEach(function (side) {
      for (var i = 0; i < 4; i++) {
        ellipse(ctx, side * (22 + i * 7), 17 + i * 1.5, 1.6, 1.6);
        ctx.fill();
      }
    });

    /* armoured hull */
    var g = ctx.createLinearGradient(0, -50, 0, 48);
    g.addColorStop(0, lighten(body, 0.22));
    g.addColorStop(0.55, body);
    g.addColorStop(1, darken(body, 0.25));
    ctx.fillStyle = g;
    poly(ctx, [
      [-20, -34], [-14, -48], [14, -48], [20, -34],
      [22, 22], [18, 46], [-18, 46], [-22, 22]
    ]);
    ctx.fill();

    /* armour plates */
    ctx.fillStyle = rgba(dark, 0.55);
    roundRect(ctx, -17, -6, 34, 14, 4);
    ctx.fill();
    roundRect(ctx, -13, 14, 26, 20, 4);
    ctx.fill();
    ctx.fillStyle = rgba(trim, 0.35);
    roundRect(ctx, -17, -6, 34, 5, 2);
    ctx.fill();

    /* cockpit frame + pilot */
    drawPilot(ctx, pilotStyle, 0, -30, 14, function (c) { roundRect(c, -14, -42, 28, 26, 7); });
    ctx.fillStyle = rgba('#1d2748', 0.4);
    roundRect(ctx, -14, -42, 28, 26, 7);
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 3;
    roundRect(ctx, -14, -42, 28, 26, 7);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0, -42);
    ctx.lineTo(0, -16);
    ctx.stroke();
  }

  function drawMilitary(ctx, o, pilotStyle) {
    var body = '#6f7f5c', trim = '#9db088', dark = '#3a452f', glow = '#b6e26a';
    thruster(ctx, -7, 44, 7, 32 + o.thrust * 16, glow, 0.35 + o.thrust);
    thruster(ctx, 7, 44, 7, 32 + o.thrust * 16, glow, 0.35 + o.thrust);

    /* delta wing */
    ctx.fillStyle = body;
    poly(ctx, [[-4, -18], [-50, 22], [-44, 34], [0, 20]]);
    ctx.fill();
    poly(ctx, [[4, -18], [50, 22], [44, 34], [0, 20]]);
    ctx.fill();

    /* camo bands */
    ctx.fillStyle = rgba(dark, 0.75);
    poly(ctx, [[-18, 4], [-34, 18], [-30, 26], [-14, 16]]);
    ctx.fill();
    poly(ctx, [[18, 4], [34, 18], [30, 26], [14, 16]]);
    ctx.fill();

    /* vertical fins */
    ctx.fillStyle = darken(body, 0.3);
    poly(ctx, [[-8, 20], [-14, 44], [-5, 42]]);
    ctx.fill();
    poly(ctx, [[8, 20], [14, 44], [5, 42]]);
    ctx.fill();

    /* fuselage */
    var g = ctx.createLinearGradient(-14, 0, 14, 0);
    g.addColorStop(0, darken(body, 0.3));
    g.addColorStop(0.45, lighten(body, 0.12));
    g.addColorStop(1, darken(body, 0.3));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, -54);
    ctx.lineTo(9, -34);
    ctx.lineTo(12, 30);
    ctx.lineTo(-12, 30);
    ctx.lineTo(-9, -34);
    ctx.closePath();
    ctx.fill();

    /* missile pods */
    ctx.fillStyle = dark;
    roundRect(ctx, -42, 20, 14, 7, 3);
    ctx.fill();
    roundRect(ctx, 28, 20, 14, 7, 3);
    ctx.fill();
    ctx.fillStyle = rgba('#ffd23f', 0.9);
    roundRect(ctx, -42, 20, 14, 3, 1.5);
    ctx.fill();
    roundRect(ctx, 28, 20, 14, 3, 1.5);
    ctx.fill();

    /* canopy + pilot */
    drawPilot(ctx, pilotStyle, 0, -30, 13, function (c) {
      c.beginPath();
      c.moveTo(-12, -16);
      c.lineTo(-9, -42);
      c.lineTo(9, -42);
      c.lineTo(12, -16);
      c.closePath();
    });
    ctx.fillStyle = rgba('#20305c', 0.45);
    poly(ctx, [[-12, -16], [-9, -42], [9, -42], [12, -16]]);
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 2.2;
    poly(ctx, [[-12, -16], [-9, -42], [9, -42], [12, -16]]);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-11, -30);
    ctx.lineTo(11, -30);
    ctx.stroke();

    ctx.fillStyle = rgba('#ffffff', 0.5);
    poly(ctx, [[-6, -40], [0, -40], [-4, -20], [-9, -20]]);
    ctx.fill();
  }

  function drawClassic(ctx, o, pilotStyle) {
    var body = '#dccaa6', trim = '#8a5a34', dark = '#5b3a20', glow = '#ffd58a';
    thruster(ctx, 0, 40, 6, 16, glow, 0.2 + o.thrust * 0.6);

    /* straight wings + tailplane */
    ctx.fillStyle = trim;
    roundRect(ctx, -48, 0, 96, 12, 6);
    ctx.fill();
    roundRect(ctx, -22, 34, 44, 8, 4);
    ctx.fill();
    ctx.fillStyle = darken(trim, 0.2);
    roundRect(ctx, -48, 7, 96, 5, 2.5);
    ctx.fill();
    roundRect(ctx, -22, 38, 44, 4, 2);
    ctx.fill();

    /* fuselage */
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.bezierCurveTo(9, -40, 11, -6, 8, 42);
    ctx.lineTo(-8, 42);
    ctx.bezierCurveTo(-11, -6, -9, -40, 0, -48);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(0, -48);
    ctx.bezierCurveTo(9, -40, 11, -30, 11, -26);
    ctx.lineTo(-11, -26);
    ctx.bezierCurveTo(-11, -30, -9, -40, 0, -48);
    ctx.closePath();
    ctx.fill();

    /* roundels */
    [-1, 1].forEach(function (side) {
      ctx.fillStyle = '#2f5fd0';
      ellipse(ctx, side * 30, 6, 7, 7);
      ctx.fill();
      ctx.fillStyle = '#f4f1e6';
      ellipse(ctx, side * 30, 6, 3.4, 3.4);
      ctx.fill();
    });

    /* fin */
    ctx.fillStyle = trim;
    poly(ctx, [[0, 30], [8, 44], [-8, 44]]);
    ctx.fill();

    /* open cockpit + pilot */
    ctx.fillStyle = '#2a2140';
    ellipse(ctx, 0, -12, 11, 14);
    ctx.fill();
    drawPilot(ctx, pilotStyle, 0, -14, 11, function (c) { ellipse(c, 0, -12, 11, 14); });
    ctx.strokeStyle = dark;
    ctx.lineWidth = 2.4;
    ellipse(ctx, 0, -12, 11, 14);
    ctx.stroke();
    ctx.fillStyle = trim;
    roundRect(ctx, -12, -2, 24, 7, 3);
    ctx.fill();

    /* propeller */
    ctx.save();
    ctx.translate(0, -44);
    ctx.rotate((o.time || 0) * 26);
    ctx.globalAlpha = 0.26;
    ctx.fillStyle = '#e9eef7';
    ellipse(ctx, 0, 0, 23, 4);
    ctx.fill();
    ctx.rotate(Math.PI / 2);
    ellipse(ctx, 0, 0, 23, 4);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = trim;
    ellipse(ctx, 0, 0, 5, 5);
    ctx.fill();
    ctx.restore();
  }

  function drawNeon(ctx, o, pilotStyle) {
    var body = '#2c3160', trim = '#6ff3ff', dark = '#141832', glow = '#ff5cf0';
    thruster(ctx, -9, 40, 8, 34 + o.thrust * 20, trim, 0.4 + o.thrust);
    thruster(ctx, 9, 40, 8, 34 + o.thrust * 20, glow, 0.4 + o.thrust);

    ctx.save();
    ctx.shadowColor = trim;
    ctx.shadowBlur = 14;

    /* long thin wings */
    ctx.fillStyle = body;
    poly(ctx, [[-4, -14], [-52, 20], [-46, 30], [0, 18]]);
    ctx.fill();
    poly(ctx, [[4, -14], [52, 20], [46, 30], [0, 18]]);
    ctx.fill();

    ctx.strokeStyle = trim;
    ctx.lineWidth = 2;
    poly(ctx, [[-4, -14], [-52, 20], [-46, 30]]);
    ctx.stroke();
    poly(ctx, [[4, -14], [52, 20], [46, 30]]);
    ctx.stroke();

    /* fuselage */
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.moveTo(0, -54);
    ctx.bezierCurveTo(12, -34, 13, 4, 10, 42);
    ctx.lineTo(-10, 42);
    ctx.bezierCurveTo(-13, 4, -12, -34, 0, -54);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = glow;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    /* canopy + pilot */
    ctx.save();
    ctx.shadowColor = glow;
    ctx.shadowBlur = 12;
    drawPilot(ctx, pilotStyle, 0, -26, 13, function (c) { ellipse(c, 0, -26, 13, 15); });
    ctx.fillStyle = rgba('#5ad8ff', 0.3);
    ellipse(ctx, 0, -26, 13, 15);
    ctx.fill();
    ctx.strokeStyle = trim;
    ctx.lineWidth = 2.2;
    ellipse(ctx, 0, -26, 13, 15);
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = rgba('#ffffff', 0.55);
    ellipse(ctx, -5, -32, 3, 6, -0.5);
    ctx.fill();
  }

  var SHIP_PAINTERS = {
    pink: drawPink,
    rugged: drawRugged,
    military: drawMilitary,
    classic: drawClassic,
    neon: drawNeon
  };

  /* opts: { x, y, size, tilt, thrust, alpha, time, pilotStyle, shield } */
  function drawShip(ctx, shipId, opts) {
    var o = opts || {};
    var painter = SHIP_PAINTERS[shipId] || drawPink;
    ctx.save();
    ctx.translate(o.x || 0, o.y || 0);
    if (o.tilt) ctx.rotate(o.tilt);
    var scale = (o.size || 104) / 104;
    ctx.scale(scale, scale);
    if (o.alpha != null) ctx.globalAlpha = o.alpha;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetY = 5;
    painter(ctx, o, o.pilotStyle || GUEST_STYLE);
    ctx.restore();

    if (o.shield) {
      ctx.save();
      ctx.strokeStyle = 'rgba(90,216,255,0.85)';
      ctx.lineWidth = 3;
      ctx.shadowColor = '#5ad8ff';
      ctx.shadowBlur = 16;
      ellipse(ctx, 0, -6, 42, 50);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * hazards and pickups
   * ------------------------------------------------------------------ */

  function drawMeteor(ctx, m) {
    var seed = m.seed || 1;
    var rand = rng(seed * 2654435761);
    var base = m.rock || '#7b6a5d';
    var r = m.r;

    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate(m.rot || 0);

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 5;
    ctx.fillStyle = base;
    ctx.beginPath();
    var pts = 9;
    for (var i = 0; i < pts; i++) {
      var a = (i / pts) * Math.PI * 2;
      var rr = r * (0.86 + rand() * 0.24);
      var x = Math.cos(a) * rr;
      var y = Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    /* craters */
    ctx.fillStyle = rgba('#000000', 0.22);
    for (var c = 0; c < 4; c++) {
      var ca = rand() * Math.PI * 2;
      var cd = rand() * r * 0.6;
      ellipse(ctx, Math.cos(ca) * cd, Math.sin(ca) * cd, r * (0.1 + rand() * 0.12), r * (0.08 + rand() * 0.1));
      ctx.fill();
    }
    ctx.fillStyle = rgba('#ffffff', 0.16);
    ellipse(ctx, -r * 0.25, -r * 0.3, r * 0.3, r * 0.2, -0.6);
    ctx.fill();

    /* heat glow on the leading edge */
    if (m.hot) {
      ctx.strokeStyle = 'rgba(255,140,60,0.5)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, r + 2, 0, Math.PI * 2);
      ctx.stroke();
    }

    /* white flash when a shot lands */
    if (m.flash > 0) {
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.95, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawFighter(ctx, f) {
    var scale = (f.scale || 1);
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.tilt || 0);
    ctx.scale(scale, scale);

    ctx.fillStyle = '#4a5570';
    poly(ctx, [[-4, -26], [-26, 16], [-20, 26], [0, 18], [20, 26], [26, 16], [4, -26]]);
    ctx.fill();

    ctx.fillStyle = '#78859f';
    poly(ctx, [[-3, -22], [-22, 14], [-17, 20], [0, 13], [17, 20], [22, 14], [3, -22]]);
    ctx.fill();

    ctx.fillStyle = '#c8453c';
    poly(ctx, [[-6, -14], [6, -14], [4, 2], [-4, 2]]);
    ctx.fill();

    ctx.fillStyle = '#2b3350';
    ellipse(ctx, 0, -16, 6, 8);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ellipse(ctx, -2, -18, 2, 3);
    ctx.fill();
    ctx.restore();
  }

  function drawBoss(ctx, boss) {
    var flash = boss.hitFlash > 0;
    ctx.save();
    ctx.translate(boss.x, boss.y);
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 18;
    ctx.shadowOffsetY = 8;

    /* side pods */
    ctx.fillStyle = '#3c4a63';
    roundRect(ctx, -boss.w / 2 - 12, -18, 40, 46, 10);
    ctx.fill();
    roundRect(ctx, boss.w / 2 - 28, -18, 40, 46, 10);
    ctx.fill();

    /* hull */
    var g = ctx.createLinearGradient(0, -40, 0, 40);
    g.addColorStop(0, flash ? '#ffd9d0' : '#6d7c96');
    g.addColorStop(0.5, flash ? '#ffb3a3' : '#4a5670');
    g.addColorStop(1, '#2b3350');
    ctx.fillStyle = g;
    poly(ctx, [
      [-boss.w / 2, -26], [-boss.w / 2 + 26, -42], [boss.w / 2 - 26, -42], [boss.w / 2, -26],
      [boss.w / 2 - 8, 28], [-boss.w / 2 + 8, 28]
    ]);
    ctx.fill();
    ctx.shadowBlur = 0;

    /* armour stripes */
    ctx.fillStyle = 'rgba(200,69,60,0.85)';
    roundRect(ctx, -boss.w / 2 + 14, -14, boss.w - 28, 12, 4);
    ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    roundRect(ctx, -boss.w / 2 + 22, 6, boss.w - 44, 16, 5);
    ctx.fill();

    /* core */
    var pulse = 0.6 + 0.4 * Math.sin((boss.t || 0) * 5);
    ctx.fillStyle = 'rgba(255,90,90,' + (0.35 + pulse * 0.4) + ')';
    ellipse(ctx, 0, 12, 34, 18);
    ctx.fill();
    ctx.fillStyle = flash ? '#ffffff' : '#ff5a5a';
    ellipse(ctx, 0, 12, 16, 9);
    ctx.fill();

    /* turrets */
    [-1, 1].forEach(function (side) {
      ctx.fillStyle = '#9fb0cc';
      roundRect(ctx, side * boss.w * 0.28 - 10, 26, 20, 22, 6);
      ctx.fill();
      ctx.fillStyle = '#ff8c42';
      ellipse(ctx, side * boss.w * 0.28, 46, 5, 3);
      ctx.fill();
    });
    ctx.restore();
  }

  var PICKUPS = {
    weapon: { label: 'WEAPON', color: '#ff9f43' },
    shield: { label: 'SHIELD', color: '#5ad8ff' },
    repair: { label: 'REPAIR', color: '#7cf07c' },
    emp: { label: 'EMP', color: '#c58cff' },
    star: { label: 'STAR', color: '#ffd93d' }
  };

  function drawPickup(ctx, p) {
    var def = PICKUPS[p.kind] || PICKUPS.star;
    var pulse = 0.85 + 0.15 * Math.sin((p.t || 0) * 5);
    ctx.save();
    ctx.translate(p.x, p.y);

    ctx.save();
    ctx.shadowColor = def.color;
    ctx.shadowBlur = 16 * pulse;
    ctx.fillStyle = rgba('#0b1024', 0.85);
    roundRect(ctx, -14, -14, 28, 28, 9);
    ctx.fill();
    ctx.strokeStyle = def.color;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    ctx.restore();

    ctx.fillStyle = def.color;
    if (p.kind === 'star') {
      starPath(ctx, 0, 0, 10, 4.5, 5);
      ctx.fill();
    } else if (p.kind === 'shield') {
      poly(ctx, [[0, -11], [10, -6], [8, 5], [0, 12], [-8, 5], [-10, -6]]);
      ctx.fill();
    } else if (p.kind === 'repair') {
      roundRect(ctx, -3, -10, 6, 20, 2);
      ctx.fill();
      roundRect(ctx, -10, -3, 20, 6, 2);
      ctx.fill();
    } else if (p.kind === 'emp') {
      ctx.lineWidth = 3;
      ctx.strokeStyle = def.color;
      ellipse(ctx, 0, 0, 10, 10);
      ctx.stroke();
      ellipse(ctx, 0, 0, 4.5, 4.5);
      ctx.stroke();
    } else {
      starPath(ctx, 0, 2, 9, 4, 4);
      ctx.fill();
      ctx.fillStyle = '#0b1024';
      roundRect(ctx, -3, -11, 6, 10, 2);
      ctx.fill();
    }
    ctx.restore();
  }

  /* ------------------------------------------------------------------ *
   * scrolling background
   * ------------------------------------------------------------------ */

  function makeSky(w, h) {
    var c = makeCanvas(w, h);
    var x = c.getContext('2d');
    var g = x.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#070c22');
    g.addColorStop(0.35, '#16205a');
    g.addColorStop(0.68, '#3a3a86');
    g.addColorStop(0.86, '#8a4f83');
    g.addColorStop(1, '#d97a5c');
    x.fillStyle = g;
    x.fillRect(0, 0, w, h);

    /* stars up top */
    var rand = rng(9137);
    for (var i = 0; i < 150; i++) {
      var sx = rand() * w;
      var sy = rand() * h * 0.55;
      var a = 0.15 + rand() * 0.55 * (1 - sy / (h * 0.55));
      x.fillStyle = 'rgba(255,255,255,' + a.toFixed(3) + ')';
      x.fillRect(sx, sy, 1.6, 1.6);
    }

    /* sun glow near the horizon */
    var sg = x.createRadialGradient(w * 0.5, h * 0.88, 10, w * 0.5, h * 0.88, h * 0.3);
    sg.addColorStop(0, 'rgba(255,214,150,0.55)');
    sg.addColorStop(1, 'rgba(255,214,150,0)');
    x.fillStyle = sg;
    x.fillRect(0, h * 0.55, w, h * 0.45);
    return c;
  }

  function puff(x, cx, cy, r, color, alpha) {
    var g = x.createRadialGradient(cx, cy, r * 0.15, cx, cy, r);
    g.addColorStop(0, rgba(color, alpha));
    g.addColorStop(1, rgba(color, 0));
    x.fillStyle = g;
    x.beginPath();
    x.arc(cx, cy, r, 0, Math.PI * 2);
    x.fill();
  }

  function makeClouds(w, h, seed) {
    var c = makeCanvas(w, h);
    var x = c.getContext('2d');
    var rand = rng(seed);
    for (var i = 0; i < 12; i++) {
      var cx = rand() * w;
      var cy = rand() * h;
      var r = 26 + rand() * 46;
      var tint = rand() < 0.3 ? '#ffd6e6' : '#e8f1ff';
      var puffs = 4 + Math.floor(rand() * 4);
      for (var p = 0; p < puffs; p++) {
        puff(x, cx + (rand() - 0.5) * r * 2, cy + (rand() - 0.5) * r * 0.7, r * (0.5 + rand() * 0.6), tint, 0.3);
      }
    }
    return c;
  }

  /* A mountain range that tiles left-to-right without a seam: the silhouette
     starts and ends at the same height, so it can be repeated horizontally. */
  function makeRidge(w, h, seed, color, height) {
    var c = makeCanvas(w, h);
    var x = c.getContext('2d');
    var rand = rng(seed);
    var peaks = 7;
    var edges = [];
    var i;
    for (i = 0; i < peaks; i++) edges.push(rand());

    x.fillStyle = color;
    x.beginPath();
    x.moveTo(0, h - height * (0.2 + edges[0] * 0.35));
    for (i = 0; i < peaks; i++) {
      var x0 = (i / peaks) * w;
      var x1 = ((i + 1) / peaks) * w;
      x.lineTo(x0, h - height * (0.2 + edges[i] * 0.35));
      x.lineTo((x0 + x1) / 2, h - height * (0.45 + rand() * 0.5));
    }
    x.lineTo(w, h - height * (0.2 + edges[0] * 0.35));
    x.lineTo(w, h);
    x.lineTo(0, h);
    x.closePath();
    x.fill();
    return c;
  }

  function background(w, h) {
    return {
      sky: makeSky(w, h),
      clouds: makeClouds(w, h, 2024),
      clouds2: makeClouds(w, h, 8821),
      ridgeFar: makeRidge(w, 170, 77, 'rgba(38,31,84,0.72)', 110),
      ridgeNear: makeRidge(w, 230, 441, 'rgba(16,12,40,0.92)', 150)
    };
  }

  SP.Art = {
    SHIPS: SHIPS,
    GUEST_STYLE: GUEST_STYLE,
    PICKUPS: PICKUPS,
    shipById: shipById,
    normaliseStyle: normaliseStyle,
    drawCharacter: drawCharacter,
    drawShip: drawShip,
    drawMeteor: drawMeteor,
    drawFighter: drawFighter,
    drawBoss: drawBoss,
    drawPickup: drawPickup,
    background: background,
    helpers: { rgba: rgba, lighten: lighten, darken: darken, roundRect: roundRect, poly: poly, starPath: starPath }
  };
})(window.SP);