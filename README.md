# Sky Patrol

A forward-flying arcade aircraft shooter for [start.ng](https://start.ng). You pick an
aircraft, your start.ng character sits in the cockpit, and you fly through a scrolling sky:
dodge meteors and enemy jets, grab weapon upgrades, clear five waves, then bring down the
Dreadnought boss.

Plain HTML, CSS and JavaScript. **No build step, no dependencies, no server, no secrets.**
Open `index.html` and it plays.

## Play

| Input | Action |
| --- | --- |
| Arrow keys or `WASD` | Fly |
| — | Weapons fire on their own |
| `P` or `Esc` | Pause / resume |
| `M` | Mute |
| Drag on the sky | Steer (touch) |
| ❙❚ button | Pause (touch) |

Five aircraft — Pink Comet, Rust Jaw, Falcon 4, Old Piston, Volt Runner. They are
cosmetics only: every one of them flies, shoots and dodges identically.

## Run it locally

```bash
cd sky-patrol
npm start          # http://localhost:8080  (development server, not needed by start.ng)
```

`npm start` runs a 40-line static file server from `scripts/serve.mjs`. Opening
`index.html` straight from disk works too — the scripts are plain classic scripts on
purpose, so there is no module/CORS problem.

## Checks

```bash
npm run check      # local stand-in for start.ng's pre-publish checks
```

`.dev/check.mjs` verifies the same rules start.ng applies to a published repo:
`index.html` at the root, only served file types, the size limits, relative paths only,
no password fields, no remote scripts, a valid `startng.json` whose columns match what the
game actually sends, and a 16:10 `cover.png` next to `index.html`.

```bash
npm run cover      # regenerate cover.png (1600x1000) — only needed if you change the art
```

The development scripts live in `.dev/`, a dot-folder. start.ng leaves dot-folders alone,
which keeps these local tools out of what players are served — and, as we found the hard
way, keeps them out of start.ng's malware scan too.

### Smoke test

With the game served, open the page and load `.dev/smoke-test.js`, then run:

```js
await window.SKY_PATROL_SMOKE()
```

It drives the real game loop — menu, a full run, the boss, a loss, pause/resume, every
pickup, all five aircraft and all 213 character-style combinations — and returns a
pass/fail list. It steps the world directly instead of waiting on `requestAnimationFrame`,
which browsers pause in background tabs.

## How it is put together

```
index.html         markup for the canvas, HUD, hangar, pause and results screens
styles.css         layout and theme; container queries so the in-game screens scale
js/startng.js      start.ng connect-page integration (identity, scores, leaderboard)
js/art.js          all artwork, drawn with Canvas 2D paths — aircraft, characters, sky
js/audio.js        a small Web Audio synth, so there are no sound files
js/game.js         game loop, waves, boss, HUD, screens
startng.json       the leaderboard columns
cover.png          16:10 card picture for start.ng
.dev/              local development tools, never served to players
```

### The character

`js/startng.js` asks the hidden start.ng connect page who is playing with
`startng:whoami`, checking `e.origin` and `e.source` on every reply. `js/art.js` draws the
returned `style` — body, skin, hair, hat and accessory, in their start.ng colours — as the
pilot in the cockpit and on the hangar card. Unknown or missing values fall back to
start.ng's guest look, so a new option on start.ng can never break the game.

Guests play with the guest look and see the leaderboard; signed-in players save runs.
If start.ng cannot be reached (opened from disk, offline, or on localhost) the game says so
in the side panel and carries on.

### The leaderboard

`startng.json` declares four columns, in ranking order:

| # | Key | Label | Order |
| --- | --- | --- | --- |
| 1 | `boss` | Boss defeated | highest |
| 2 | `score` | Score | highest |
| 3 | `waves` | Waves cleared | highest |
| 4 | `time` | Run time | lowest, shown as `m:ss` |

`saveRun()` sends exactly those four keys, whole numbers only, 0 to 1,000,000,000. Nothing
else about a run is sent. Weapons and upgrades reset every run, so nothing carries over.

## Put it live

The game has to live in a **public GitHub repository** with a ready-to-play `index.html` at
the top (that is the case here). Then, from a machine that can reach the API:

```bash
# 1. check the repo without publishing anything
curl -X POST https://api.start.ng/games/check \
  -H "Content-Type: application/json" \
  -d '{"repo_url":"https://github.com/<owner>/sky-patrol"}'

# 2. publish it
curl -X POST https://api.start.ng/games/publish \
  -H "Content-Type: application/json" \
  -d '{"repo_url":"https://github.com/<owner>/sky-patrol","name":"sky-patrol"}'
```

The first time, start.ng replies `202` with an `approve_url`. Open it, sign in, and the
game goes live at `https://sky-patrol.start.ng`. After that, every push to the published
branch updates the game by itself.

Sign-in, scores and the leaderboard only work once the game is live on a `*.start.ng`
address. Before that, the game runs offline with the guest look.

More detail: <https://start.ng/docs.md>