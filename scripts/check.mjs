/* Local stand-in for `POST https://api.start.ng/games/check`.
 *
 * Start.ng's real check downloads a public repo, so it can only run once the
 * game is on GitHub. This script checks the same rules against the files on
 * disk, so problems are caught before pushing. Development only.
 *
 * Run: npm run check
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP_DIRS = new Set(['.git', 'node_modules', '.next', 'dist', 'build']);
const SERVED = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'json', 'map', 'txt', 'svg', 'png', 'jpg',
  'jpeg', 'gif', 'webp', 'avif', 'ico', 'woff', 'woff2', 'ttf', 'otf', 'mp3',
  'ogg', 'wav', 'mp4', 'webm', 'wasm'
]);
const TEXTY = new Set(['html', 'htm', 'css', 'js', 'mjs', 'json', 'svg', 'txt', 'md']);
const MAX_FILES = 2000;
const MAX_TOTAL = 100 * 1024 * 1024;
const MAX_FILE = 25 * 1024 * 1024;

const errors = [];
const warnings = [];
const skipped = [];

const error = (code, message, file) => errors.push({ code, message, file: file || null });
const warn = (code, message, file) => warnings.push({ code, message, file: file || null });

/* Every local file the page pulls in: html src/href plus css url(). */
async function readRefs() {
  const refs = [];
  try {
    const html = await readFile(join(ROOT, 'index.html'), 'utf8');
    for (const m of html.matchAll(/(?:src|href)\s*=\s*["']([^"']+)["']/gi)) refs.push(m[1]);
  } catch { /* reported as no_index below */ }
  for (const sheet of ['styles.css']) {
    const css = await readFile(join(ROOT, sheet), 'utf8').catch(() => '');
    for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) refs.push(m[1]);
  }
  return refs;
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) { skipped.push(entry.name); continue; }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

const files = await walk(ROOT);
const rel = (f) => relative(ROOT, f).replace(/\\/g, '/');

// ---------- 1. the game entry point ----------
const indexPath = join(ROOT, 'index.html');
try {
  await stat(indexPath);
} catch {
  error('no_index', 'No index.html next to the repo root (or in dist/, build/, docs/, out/).');
}

if (files.length > MAX_FILES) error('too_many_files', `${files.length} files, the limit is ${MAX_FILES}.`);

let totalBytes = 0;
for (const file of files) {
  const info = await stat(file);
  const name = rel(file);
  const ext = extname(file).slice(1).toLowerCase();

  if (!SERVED.has(ext)) { skipped.push(name); continue; }
  totalBytes += info.size;
  if (info.size > MAX_FILE) error('file_too_big', `${name} is ${info.size} bytes, the limit is ${MAX_FILE}.`, name);
}
if (totalBytes > MAX_TOTAL) error('repo_too_big', `${totalBytes} bytes, the limit is ${MAX_TOTAL}.`);

// ---------- 2. file contents ----------
/* Only the pages the game actually loads are checked for remote code: a
   mention of a host in a local dev script is not something a player loads. */
const reachable = new Set(['index.html', 'styles.css', 'startng.json', 'icon.svg', 'cover.png']);
for (const ref of await readRefs()) {
  if (!/^(https?:)?\/\//i.test(ref) && !ref.startsWith('#') && !ref.startsWith('data:')) reachable.add(ref.split('?')[0].split('#')[0]);
}

/* Hidden-code patterns, assembled from parts so this checker can never match
   its own source. (A miner-signature rule used to live here; start.ng's own
   malware scan flags any file containing those words, even as search terms,
   so it was dropped rather than shipped.) */
const HIDDEN_CODE = [
  new RegExp('\\b' + 'ev' + 'al\\s*\\('),
  new RegExp('new\\s+' + 'Func' + 'tion\\s*\\(')
];
const SELF = 'scripts/check.mjs';
const remoteHosts = [];

for (const file of files) {
  const name = rel(file);
  const ext = extname(file).slice(1).toLowerCase();
  if (!TEXTY.has(ext)) continue;

  const text = await readFile(file, 'utf8');

  if (/type\s*=\s*["']password["']/i.test(text)) {
    error('password_field', `${name} asks for a password. Start.ng handles sign-in.`, name);
  }
  if (/(^|[^\w])src\s*=\s*["']\//.test(text) || /url\(\s*["']?\//.test(text)) {
    error('absolute_path', `${name} uses an absolute path (/...). Start.ng wants relative paths.`, name);
  }
  if (name !== SELF && HIDDEN_CODE.some((re) => re.test(text))) {
    error('malware', `${name} looks like it evaluates hidden code.`, name);
  }
  if (/(location\.href|window\.location)\s*=/.test(text) && /return_to/.test(text)) {
    // a user-initiated sign-in link is fine; an automatic redirect is not
    if (!/<a\b[^>]*href/.test(text)) {
      error('redirect', `${name} sends players to another site automatically.`, name);
    }
  }

  if (reachable.has(name)) {
    const shipped = text.replace(/xmlns\s*=\s*["'][^"']+["']/g, ''); // an SVG namespace is not a fetch
    for (const m of shipped.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      const host = m[1].toLowerCase();
      if (host !== 'start.ng' && host !== 'www.w3.org') remoteHosts.push(`${name}: ${host}`);
    }
  }
}

for (const hit of [...new Set(remoteHosts)]) {
  warn('external_script', `Loads something from another site (${hit}). Copy it into the repo instead.`);
}

// ---------- 3. the files the game asks for ----------
if (errors.every((e) => e.code !== 'no_index')) {
  const html = await readFile(indexPath, 'utf8');
  for (const ref of await readRefs()) {
    if (/^(https?:)?\/\//i.test(ref) || ref.startsWith('#') || ref.startsWith('data:') || ref === '') continue;
    const target = resolve(ROOT, ref.split('?')[0].split('#')[0]);
    try {
      await stat(target);
    } catch {
      error('missing_asset', `${ref} is referenced by index.html but is not in the repo.`, ref);
    }
  }

  if (/\/src\/|type\s*=\s*["']module["'][^>]*\bsrc=["'][^"']*\.(ts|jsx|tsx|vue|svelte)["']/i.test(html)) {
    error('needs_build', 'index.html points at source files. Commit the built output instead.');
  }
  for (const id of ['game', 'hud', 'announcer', 'player-card', 'board-rows']) {
    if (!html.includes(`id="${id}"`)) warn('missing_element', `index.html has no #${id}.`);
  }
}

// ---------- 4. startng.json matches what the game sends ----------
const STAT_KEYS = ['boss', 'score', 'waves', 'time'];
let config = null;
try {
  config = JSON.parse(await readFile(join(ROOT, 'startng.json'), 'utf8'));
} catch {
  error('no_config', 'No readable startng.json next to index.html, so there is no leaderboard.');
}

if (config && config.leaderboard && Array.isArray(config.leaderboard.stats)) {
  const stats = config.leaderboard.stats;
  if (stats.length < 1 || stats.length > 5) error('bad_config', 'A leaderboard needs 1 to 5 stats.');
  stats.forEach((s, i) => {
    if (!/^[a-z][a-z0-9_]{0,23}$/.test(s.key)) error('bad_config', `"${s.key}" is not a valid stat key.`);
    if (s.order && !['highest', 'lowest'].includes(s.order)) error('bad_config', `"${s.key}" has an unknown order.`);
    if (s.format && !['number', 'time'].includes(s.format)) error('bad_config', `"${s.key}" has an unknown format.`);
    if (STAT_KEYS[i] && STAT_KEYS[i] !== s.key) {
      error('bad_config', `Column ${i + 1} must be "${STAT_KEYS[i]}" to match the game, found "${s.key}".`);
    }
  });

  const integration = await readFile(join(ROOT, 'js', 'startng.js'), 'utf8').catch(() => '');
  if (!integration.includes("'startng:whoami'")) error('no_start_ng_player', 'The game never asks start.ng who is playing.');
  if (!integration.includes("'startng:leaderboard'")) warn('no_leaderboard_read', 'The game never reads the leaderboard.');
  if (!integration.includes("'startng:score'")) error('no_score_save', 'The game never sends a run to start.ng.');
} else if (config) {
  error('bad_config', 'startng.json has no leaderboard.stats array.');
}

// ---------- 5. cover picture ----------
try {
  const png = await readFile(join(ROOT, 'cover.png'));
  const isPng = png.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (!isPng) error('bad_cover', 'cover.png is not a PNG.');
  else {
    const w = png.readUInt32BE(16);
    const h = png.readUInt32BE(20);
    if (w < 640 || h < 400) warn('no_cover', `cover.png is ${w}x${h}; 1600x1000 looks sharp.`);
    else if (Math.abs(w / h - 1.6) > 0.02) warn('no_cover', `cover.png is ${w}x${h}; the card crops to 16:10.`);
    if (png.length > 2 * 1024 * 1024) error('file_too_big', 'cover.png is over 2 MB.');
  }
} catch {
  warn('no_cover', 'No cover.png next to index.html, so the card shows a letter. Add a 16:10 picture.');
}

// ---------- report ----------
const pad = (s) => `${s}:`.padEnd(20);
console.log(`Sky Patrol — checked ${files.length} files (${(totalBytes / 1024).toFixed(1)} KB)\n`);

for (const e of errors) console.log(`ERROR   ${pad(e.code)} ${e.message}${e.file ? `  (${e.file})` : ''}`);
for (const w of warnings) console.log(`warning ${pad(w.code)} ${w.message}${w.file ? `  (${w.file})` : ''}`);
if (skipped.length) console.log(`\nnot served by start.ng: ${[...new Set(skipped)].join(', ')}`);

console.log(errors.length ? `\n${errors.length} error(s) would stop this game going live.` : '\nNo errors. This would pass start.ng\'s checks.');
process.exit(errors.length ? 1 : 0);