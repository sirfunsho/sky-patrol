/* Builds cover.png (1600x1000, 16:10) for the Start.ng game card.
 *
 * The cover is a repo asset, so it is generated once and committed. The game
 * itself never runs this. Run: npm run cover
 */
import { deflateSync } from 'node:zlib';
import { writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const W = 1600;
const H = 1000;

/* ------------------------------------------------------------------ *
 * tiny raster canvas
 * ------------------------------------------------------------------ */

const px = new Uint8Array(W * H * 3);

function blend(x, y, r, g, b, a = 1) {
  x |= 0; y |= 0;
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  if (a >= 1) {
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
    return;
  }
  px[i] += (r - px[i]) * a;
  px[i + 1] += (g - px[i + 1]) * a;
  px[i + 2] += (b - px[i + 2]) * a;
}

function hex(color) {
  const v = parseInt(color.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

function rect(x, y, w, h, color, a = 1) {
  const [r, g, b] = hex(color);
  for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) blend(xx, yy, r, g, b, a);
}

function disc(cx, cy, radius, color, a = 1, soft = 0) {
  const [r, g, b] = hex(color);
  for (let yy = Math.floor(cy - radius); yy <= cy + radius; yy++) {
    for (let xx = Math.floor(cx - radius); xx <= cx + radius; xx++) {
      const d = Math.hypot(xx - cx, yy - cy);
      if (d > radius) continue;
      const edge = soft ? Math.min(1, (radius - d) / soft) : 1;
      blend(xx, yy, r, g, b, a * edge);
    }
  }
}

function polygon(points, color, a = 1) {
  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p[1]))));
  const maxY = Math.min(H - 1, Math.ceil(Math.max(...points.map((p) => p[1]))));
  const [r, g, b] = hex(color);
  for (let y = minY; y <= maxY; y++) {
    const xs = [];
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [xi, yi] = points[i];
      const [xj, yj] = points[j];
      if ((yi > y) !== (yj > y)) xs.push(xi + ((y - yi) / (yj - yi)) * (xj - xi));
    }
    xs.sort((m, n) => m - n);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.round(xs[i]); x <= Math.round(xs[i + 1]); x++) blend(x, y, r, g, b, a);
    }
  }
}

function gradient(stops) {
  for (let y = 0; y < H; y++) {
    const t = y / (H - 1);
    let from = stops[0];
    let to = stops[stops.length - 1];
    for (let i = 0; i < stops.length - 1; i++) {
      if (t >= stops[i][0] && t <= stops[i + 1][0]) { from = stops[i]; to = stops[i + 1]; break; }
    }
    const span = (to[0] - from[0]) || 1;
    const k = (t - from[0]) / span;
    const a = hex(from[1]);
    const b = hex(to[1]);
    const row = [];
    for (let x = 0; x < W; x++) {
      row.push([a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]);
    }
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 3;
      px[i] = row[x][0]; px[i + 1] = row[x][1]; px[i + 2] = row[x][2];
    }
  }
}

function rand(seed) {
  let s = seed >>> 0;
  return () => {
    s += 0x6d2b79f5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * 5x7 pixel font
 * ------------------------------------------------------------------ */

const FONT = {
  A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
  C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
  D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
  E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
  F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
  G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
  H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
  I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
  J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
  K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
  L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
  M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
  N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
  O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
  Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
  R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
  S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
  T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
  U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
  W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
  X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
  Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
  Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
  0: ['.###.', '#...#', '#..##', '#.#.#', '##..#', '#...#', '.###.'],
  1: ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  3: ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  6: ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  9: ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
  ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  '.': ['.....', '.....', '.....', '.....', '.....', '.##..', '.##..'],
  '-': ['.....', '.....', '.....', '#####', '.....', '.....', '.....'],
  ':': ['.....', '..#..', '..#..', '.....', '..#..', '..#..', '.....'],
  '/': ['....#', '....#', '...#.', '..#..', '.#...', '#....', '#....'],
  '!': ['..#..', '..#..', '..#..', '..#..', '..#..', '.....', '..#..']
};

function textWidth(text, scale) {
  return text.length * 6 * scale - scale;
}

function text(text, x, y, scale, fill, outline, outlinePad = 3) {
  const top = String(text).toUpperCase();
  const lit = [];
  for (let c = 0; c < top.length; c++) {
    const glyph = FONT[top[c]] || FONT[' '];
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row][col] === '#') lit.push([x + c * 6 * scale + col * scale, y + row * scale]);
      }
    }
  }
  if (outline) {
    for (const [lx, ly] of lit) {
      rect(lx - outlinePad, ly - outlinePad, scale + outlinePad * 2, scale + outlinePad * 2, outline);
    }
  }
  for (const [lx, ly] of lit) rect(lx, ly, scale, scale, fill);
}

/* ------------------------------------------------------------------ *
 * scene
 * ------------------------------------------------------------------ */

// sky
gradient([
  [0, '#05081a'], [0.32, '#141f57'], [0.62, '#3a3a86'],
  [0.82, '#8a4f83'], [1, '#e08a5f']
]);

// stars
const r1 = rand(4242);
for (let i = 0; i < 420; i++) {
  const x = r1() * W;
  const y = r1() * H * 0.6;
  const s = r1() < 0.12 ? 4 : 2;
  rect(x, y, s, s, '#ffffff', 0.15 + r1() * 0.6 * (1 - y / (H * 0.6)));
}

// sun
disc(800, 905, 300, '#ffcf8a', 0.16, 220);
disc(800, 905, 170, '#ffe6b0', 0.22, 140);

// clouds
const r2 = rand(99);
for (let i = 0; i < 26; i++) {
  const cx = r2() * W;
  const cy = 300 + r2() * 620;
  const rad = 40 + r2() * 90;
  const tint = r2() < 0.3 ? '#ffd6e6' : '#dfe9ff';
  for (let p = 0; p < 5; p++) {
    disc(cx + (r2() - 0.5) * rad * 2, cy + (r2() - 0.5) * rad * 0.7, rad * (0.5 + r2() * 0.5), tint, 0.10);
  }
}

// ridges
polygon([[0, H], [0, 880], [140, 800], [260, 858], [400, 770], [560, 852], [720, 792], [880, 860],
  [1040, 782], [1200, 856], [1360, 800], [1500, 862], [1600, 820], [1600, H]], '#231c4d');
polygon([[0, H], [0, 940], [180, 890], [340, 930], [520, 866], [700, 924], [900, 880],
  [1100, 936], [1280, 892], [1460, 938], [1600, 900], [1600, H]], '#120f2e');

// speed streaks
const r3 = rand(7);
for (let i = 0; i < 60; i++) {
  const x = r3() * W;
  const y = r3() * H;
  const len = 30 + r3() * 120;
  rect(x, y, 2, len, '#ffffff', 0.05 + r3() * 0.12);
}

// the aircraft, nose up
const cx = 1180;
const cy = 655;
const plane = (points, color, a = 1) => polygon(points.map(([x, y]) => [cx + x, cy + y]), color, a);

// engine flame
plane([[-16, 210], [16, 210], [9, 272], [-9, 272]], '#ff9f43', 0.85);
plane([[-9, 210], [9, 210], [5, 252], [-5, 252]], '#ffe9a8', 0.9);
// wings
plane([[-14, -40], [-240, 130], [-210, 186], [-16, 90]], '#ff8fc7');
plane([[14, -40], [240, 130], [210, 186], [16, 90]], '#c2437f');
// fuselage
plane([[0, -230], [34, -120], [40, 120], [24, 210], [-24, 210], [-40, 120], [-34, -120]], '#ff8fc7');
plane([[0, -210], [20, -110], [26, 110], [16, 200], [-16, 200], [-26, 110], [-20, -110]], '#ffd0e6');
// tail fins
plane([[-24, 110], [-54, 200], [-22, 196]], '#c2437f');
plane([[24, 110], [54, 200], [22, 196]], '#c2437f');
// canopy with the pilot's shirt colour
disc(cx, cy - 96, 40, '#2a1f44');
disc(cx, cy - 96, 32, '#d8fd71');
disc(cx, cy - 104, 18, '#8d5524');

// a couple of meteors for flavour, kept clear of the title
disc(268, 566, 44, '#7b6a5d');
disc(254, 554, 13, '#000000', 0.18, 8);
disc(284, 580, 9, '#000000', 0.18, 6);
disc(168, 736, 24, '#8a7668');
disc(160, 730, 7, '#000000', 0.18, 5);
disc(1476, 496, 20, '#8a7668');

// the three weapon pods, so the card shows what the game is about
function pod(cx, cy, color, icon) {
  disc(cx, cy, 30, '#0b1024', 0.9);
  disc(cx, cy, 30, color, 0.18, 16);
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    disc(cx + Math.cos(a) * 31, cy + Math.sin(a) * 31, 1.6, color, 0.9);
  }
  if (icon === 'fan') {
    for (const dx of [-14, -7, 0, 7, 14]) {
      for (let t = -16; t <= 16; t += 8) disc(cx + dx * 0.6 + dx * t * 0.06, cy + t, 2.4, color, 0.95);
    }
  } else if (icon === 'stream') {
    for (const dy of [-12, 0, 12]) for (let t = -15; t <= 15; t += 7.5) disc(cx + t, cy + dy, 2.6, color, 0.95);
  } else {
    rect(cx - 4, cy - 20, 8, 40, color, 0.35);
    rect(cx - 2, cy - 20, 4, 40, color, 1);
    rect(cx - 1, cy - 20, 2, 40, '#ffffff', 1);
  }
}
pod(214, 512, '#ff8a3d', 'fan');
pod(384, 452, '#a6ff7e', 'stream');
pod(554, 512, '#ff5cf0', 'beam');

// what each weapon looks like in flight
for (const dx of [-96, -72, -48, -24, 0, 24, 48, 72, 96]) {
  disc(1180 + dx, 528 - Math.abs(dx) * 0.18, 7, '#ff8a3d', 0.95);
  disc(1180 + dx, 528 - Math.abs(dx) * 0.18, 3, '#ffffff', 0.9);
}
for (let i = 0; i < 5; i++) disc(1180, 574 - i * 42, 6, '#a6ff7e', 0.95);
rect(1174, 452, 12, 150, '#ff5cf0', 0.3);
rect(1177, 452, 6, 150, '#ff5cf0', 0.95);
rect(1179, 452, 2, 150, '#ffffff', 1);

// title
const titleScale = 20;
text('SKY PATROL', (W - textWidth('SKY PATROL', titleScale)) / 2, 180, titleScale, '#ffffff', '#0a0e22', 4);
const subScale = 6;
text('START.NG ARCADE SHOOTER', (W - textWidth('START.NG ARCADE SHOOTER', subScale)) / 2, 340, subScale, '#d8fd71', '#0a0e22', 3);
const tagScale = 5;
text('ENDLESS SKY - HOW FAR CAN YOU GET', (W - textWidth('ENDLESS SKY - HOW FAR CAN YOU GET', tagScale)) / 2, 402, tagScale, '#a9b4d8', '#0a0e22', 2);

/* ------------------------------------------------------------------ *
 * png encoding
 * ------------------------------------------------------------------ */

function crc32(buf) {
  let c;
  const table = crc32.table || (crc32.table = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c;
    }
    return t;
  })());
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  return (crc ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

const raw = Buffer.alloc((W * 3 + 1) * H);
for (let y = 0; y < H; y++) {
  raw[y * (W * 3 + 1)] = 0; // filter: none
  Buffer.from(px.buffer, y * W * 3, W * 3).copy(raw, y * (W * 3 + 1) + 1);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;   // bit depth
ihdr[9] = 2;   // colour type: truecolour
ihdr[10] = 0;
ihdr[11] = 0;
ihdr[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0))
]);

await writeFile(join(ROOT, 'cover.png'), png);
console.log(`cover.png written — ${W}x${H}, ${(png.length / 1024).toFixed(1)} KB`);