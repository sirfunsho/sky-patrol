# Sky Patrol

A forward-flying arcade aircraft shooter for [start.ng](https://start.ng). You pick an
aircraft, your start.ng character sits in the cockpit, and you fly through a scrolling sky:
dodge meteors and enemy jets, grab weapon upgrades, and see how far you get.

**There is no finish line.** Waves keep coming and keep getting harder, and the run ends
when your hull does. Every fifth wave brings a Dreadnought — beat it, score the bonus, and
wave six starts exactly where you left off. The Dreadnoughts get bigger, tougher and
angrier each time; the run never does.

Plain HTML, CSS and JavaScript. **No build step, no dependencies, no server, no secrets.**
Open `index.html` and it plays.

## Play

| Input | Action |
| --- | --- |
| Arrow keys or `WASD` | Fly |
| — | Weapons fire on their own |
| `P` or `Esc` | Pause / resume |
| `M` | Mute |
| Touch anywhere | A floating stick appears under your thumb; push it to fly |
| ❙❚ button | Pause (touch) |

The stick is **velocity based**, so the aircraft keeps its own place on screen. You never
have to put a finger on the aircraft to steer it, and your thumb can rest low in the
frame while the aircraft flies clear above it.

Five aircraft — Pink Comet, Rust Jaw, Falcon 4, Old Piston, Volt Runner. They are
cosmetics only: every one of them flies, shoots and dodges identically.

## Weapons

**Pulse is the default and never expires.** Every run starts on it, and you drop back to
it when a temporary weapon runs out.

The other three are picked up as pods, each with its own colour and icon:

| Weapon | Pod colour | What it does | Level 1 → 2 → 3 |
| --- | --- | --- | --- |
| Spread | orange | a fan of bolts | 3 → 5 → 7 bolts |
| Rapid | green | a stream of shots | fires every 0.075s → 0.058s → 0.045s |
| Laser | magenta | a bright beam that pierces everything in its line | 2.4 → 3.2 → 4.2 damage, and a thicker beam |

- Taking the pod for the weapon you are **already holding** makes it stronger, up to
  level 3.
- Taking a **different** pod switches to it at level 1.
- Either way the clock resets to a full 18 seconds, and a pod at maximum strength just
  refreshes it.
- The HUD shows the active weapon, its strength and the time left, and a `WEAPON OFFLINE`
  banner appears when one expires.

Balance: the first Dreadnought has 240 HP, which is about 12 seconds of a maxed Spread or
Rapid, or roughly 8 of a maxed Laser held in its line. Later ones are bigger and tougher.

Weapons never carry between runs.

## How the endless ramp works

`wavePlan(n)` in `js/game.js` builds each wave from a ramp value that climbs towards 1 but
never reaches it, so difficulty keeps rising without ever becoming arithmetically
impossible:

| | wave 1 | wave 10 | wave 30 | wave 50+ |
| --- | --- | --- | --- | --- |
| enemies per wave | 9 | 24 | 44 (capped) | 44 (capped) |
| gap between them | 1.5–2.1s | 0.8–1.3s | 0.42–0.7s (floored) | floored |
| jets in the mix | 10% | 28% | 47% | 55% (capped) |
| rock size | 14–26 | 20–40 | 26–48 (capped) | capped |
| speed / durability | 1.0 / 1× | 1.5 / 2× | 1.9 / 4× | capped |

Dreadnought `n` gets `240 + (n-1) × 95` HP, a wider hull, faster movement and tighter
volleys, and pays `2000 × n`.

## Run it locally

```bash
cd sky-patrol
npm start          # http://localhost:8080  (development server, not needed by start.ng)
```

`npm start` runs a 40-line static file server from `.dev/serve.mjs`. Opening
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

`startng.json` declares four columns, in ranking order. There is no "boss defeated" column
any more — the run is endless, so there is nothing to win:

| # | Key | Label | Order |
| --- | --- | --- | --- |
| 1 | `score` | Score | highest |
| 2 | `waves` | Best wave | highest |
| 3 | `kills` | Shootdowns | highest |
| 4 | `time` | Run time | highest, shown as `m:ss` |

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