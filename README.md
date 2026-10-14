# ArcadePad

Classic open-source games, ported to the browser and re-skinned for memecoin communities: their mascot, colours, ticker and sounds, with wallet-signed high scores and shareable score cards.

**Games:** classic arcade games, each a deterministic TypeScript engine (so the server can replay every score) with a canvas renderer driven by the coin's theme pack. See `src/games/` and the authoring guide in `src/games/README.md`. Each game's origin and licence is listed under "Licences" below and on the site's /licenses page.

**Self-serve:** `/create` lets a community upload mascot art (pixelated in the browser, never uploaded), pick colours and a sound style, play every game in that skin as a practice run, and send the finished theme pack with an order request.

> High scores are for fun and bragging rights. No cash prizes, no wagering, no entry fees, no token rewards. Wallet sign-in signs a text message only, never a transaction.

## Run it

```bash
npm install
npm run dev            # http://localhost:4155
npm run test:engine    # Breakout engine: determinism, replay, physics
npm run test:games     # every game: bot scores, replay == live run, rule tests
npm run test:themes    # theme packs are complete and valid
npm run build && npm start
```

Environment (`.env.local`, never committed):

| Var | Needed | What |
|---|---|---|
| `SESSION_SECRET` | production | 32+ random chars; signs session cookies, sign-in nonces |
| `NEXT_PUBLIC_SITE_URL` | production | absolute site URL for OG images |
| `DATABASE_URL` | production | Postgres connection string (Neon); without it a local JSON file is used |
| `DATA_DIR` | optional | where the local JSON store lives (default `./data`) |

## How it fits together

```
src/games/core/       Game contract, generic input recording + replay, deterministic trig, render kit
src/games/<id>/       One folder per game: engine + GameDef (index.ts), renderer (render.ts), tests
src/games/registry.ts All games (server-safe); src/games/client.ts lazy-loads renderers
src/engine/           Breakout engine (port of LBreakout2) used by src/games/breakout
src/themes/           Theme packs (one JSON per coin), validator, pixel sprites, self-serve theme builder
src/game/             Breakout renderer + WebAudio synth
src/components/       GameHost (any game), attract demo, live thumbnails, wallet button, mascot
src/app/              Pages: /, /play/[game]/[theme], /create, /leaderboard, /order, /s/[id], /licenses, /fair-play
src/app/api/          auth (nonce, verify, me, logout), run (start, submit), leaderboard, card/[id], orders
src/lib/              store (Postgres or JSON file), HMAC tokens, sessions, wallet signature checks
scripts/              new-skin, register-game, e2e-api
```

### Deterministic engine and anti-cheat
- The engine has a fixed 60 Hz step and a seeded integer PRNG. It uses only `+ - * /` and `Math.sqrt` (no `sin`/`cos`/`atan2`, which can differ between browsers), so a run replays bit-for-bit on the server.
- `POST /api/run/start`: the server picks the seed and records who is playing.
- The browser records one input per step: the paddle target x (an integer) and the fire button. The inputs are delta- and run-length-encoded.
- `POST /api/run/submit`: the server replays the inputs with its own seed and stores **the replay's score**. Runs are rejected if the replay doesn't match the claimed score, the run finished faster than wall-clock time, the run was already submitted, it's older than 30 minutes, or the signed-in wallet changed.
- Limits: a perfect bot can still play legitimately. Rate limiting and bot heuristics (input entropy, reaction-time analysis) are future work.

### Wallet sign-in
- Solana (Phantom, Solflare, Backpack) and EVM (any `window.ethereum` wallet) through the injected providers, with no wallet SDKs.
- The server writes a SIWE/SIWS-style message (domain, address, nonce, time). The wallet signs it, and the server verifies it (ed25519 via `@noble/curves`, EIP-191 via `viem`) and sets an HMAC-signed, httpOnly session cookie. Nonces are single-use and expire after 5 minutes.
- In development only, a "Dev test wallet" (random ed25519 key in `sessionStorage`) tests the whole flow without an extension.

### Re-skin system (theme packs)
A skin is one JSON file in `src/themes/packs/`:
- `coin`: name, ticker, chain, `fictional` flag
- `palette`: background, text, primary/secondary/accent, wall, brick colours
- `pixels` + `mascot`: 16×16 pixel-grid frames (idle, blink, happy, sad) and a 12×12 head used as the ball
- `sfx`: synth recipes for 13 game sounds; `music`: 16-step chiptune (lead and bass)
- `copy`: title-screen, level-clear, life-lost and game-over lines
- Level 1 of every run spells the ticker in bricks (`tickerLevel()`), and the share card and title screen use the pack too.

```bash
npm run skin:new -- --id otter --name "Moon Otter" --ticker OTTER --chain solana --from wobbl --hue 140
```
This copies a pack, rotates its colours and registers it. Then draw the mascot grids and run `npm run test:themes`.
Only use a real coin's brand with the owner's written permission.

### Storage
`src/lib/store.ts` uses Postgres when `DATABASE_URL` is set (production: Neon via the Vercel Marketplace; tables are created on first use) and a JSON file in `./data` otherwise (local development).

## Licences

ArcadePad is GPL-3.0-or-later (`LICENSE`). Ported game logic keeps its original notices in `THIRD_PARTY_NOTICES.md`:

| Game | Based on | Licence of the original |
|---|---|---|
| Breakout | LBreakout2 2.6.5 (Michael Speck and contributors) | GPL-2.0-or-later |
| Snake | worm, BSD games (The Regents of the University of California) | BSD-3-Clause |
| Candle Run | Chromium network-error runner game (The Chromium Authors) | BSD-3-Clause |
| Merge to Moon | 2048 (Gabriele Cirulli) | MIT |
| Rock Blaster | HTML5 canvas rock shooter (Doug McInnes) | MIT |
| Moon Flap | floppybird (nebez and contributors), constants only | Apache-2.0 |
| Block Drop, Maze Dash, FUD Defense, Moon Stack, Moon Pinball, Moon Slope, Moon Solitaire, Coin Sweeper, Moon Putt, Hoop Flick, Air Puck, Moon Towers, Drift Circuit, Coin Chain, Moon Tiles, Moon Helix, Color Hop, Moon Match, Pulse Run, Blob Grow, Turf Paint, Hill Rider, Grid Fit, Ball Barrage, Moon Sling, Moon Dash 3, Moon Jumper, Coin Crossing, Coin Slash, Coin Toss, Bubble Pop, Paddle Duel, Moon Tunnel | Original ArcadePad designs | GPL-3.0-or-later |

Only game logic is ever ported. No artwork, sounds, levels, maps or fonts from those projects are used; all of that is original here. Trademarked game names, characters and recognisable trade dress are never used: genre mechanics are, their look is not.

Fonts: Bricolage Grotesque and Silkscreen (SIL OFL 1.1, texts in `assets/fonts/`). npm libraries: MIT.

**GPL:** the games run in players' browsers, so every deployment offers its complete source: https://github.com/onchaindevelopment/arcadepad (linked on /licenses).
