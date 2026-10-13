# ArcadePad

Classic open-source games, ported to the browser and re-skinned for memecoin communities: their mascot, colours, ticker and sounds, with wallet-signed high scores and shareable score cards.

**v1 game:** Breakout, with its engine ported from **LBreakout2** to deterministic TypeScript. It ships with three demo skins for fictional coins: `$GLORP`, `$NUBBIN` and `$WOBBL`.

> High scores are for fun and bragging rights. No cash prizes, no wagering, no entry fees, no token rewards. Wallet sign-in signs a text message only, never a transaction.

## Run it

```bash
npm install
npm run dev            # http://localhost:4155
npm run test:engine    # engine: determinism, replay, physics
npm run test:themes    # theme packs are complete and valid
npm run build && npm start
```

Environment (`.env.local`, never committed):

| Var | Needed | What |
|---|---|---|
| `SESSION_SECRET` | production | 32+ random chars; signs session cookies, sign-in nonces |
| `NEXT_PUBLIC_SITE_URL` | production | absolute site URL for OG images |
| `DATA_DIR` | optional | where the JSON store lives (default `./data`) |

## How it fits together

```
src/engine/        Deterministic Breakout engine (port of LBreakout2) + replay encoder
src/themes/        Theme packs (one JSON per coin), validator, pixel-sprite helpers
src/game/          Canvas renderer + WebAudio synth (purely visual/audio)
src/components/    Game client, attract-mode demo, wallet button, mascot
src/app/           Pages: /, /play/[theme], /leaderboard, /order, /s/[id], /licenses, /fair-play
src/app/api/       auth (nonce, verify, me, logout), run (start, submit), leaderboard, card/[id], orders
src/lib/           store (JSON file), HMAC tokens, sessions, wallet signature checks
scripts/new-skin.mjs  Scaffold a new coin skin
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

### Production storage
`src/lib/store.ts` keeps scores, runs, nonces and order requests in one JSON file. That works locally or on a single always-on server. A serverless deploy needs a database: re-implement the same async functions on Postgres (tables `runs`, `scores`, `orders`, `used_nonces`).

## Licences

| Component | Source | Licence |
|---|---|---|
| Breakout engine (`src/engine/game.ts`, `level.ts`, physics tables) | Port of LBreakout2 2.6.5, © 2001–2015 Michael Speck and contributors (Zooko, Mark Tomich, Michal Cihar, Sammy Mannaert, Jochen Striepe, Lee Read, Claudio Chimera, Trevor Spiteri, Dante, Patrick Hohmeyer) | GPL-2.0-or-later upstream; this port GPL-3.0-or-later |
| Everything else in this repo: levels, mascots and pixel art, sound recipes, music, renderer, site | Original work | GPL-3.0-or-later |
| Bricolage Grotesque, Silkscreen (`assets/fonts`, Google Fonts) | Their font projects | SIL OFL 1.1 (texts in `assets/fonts/`) |
| Next.js, React, Tailwind, @noble/*, @scure/base, viem | npm | MIT |

**Not used from LBreakout2:** its graphics, its sounds (they come from a third-party commercial sound collection) and its bundled level sets (many contributors, unclear terms). Only the game logic was ported. Every level, sprite and sound here is new.

**GPL obligations:** the game runs in the player's browser, so anyone who plays receives the program. Each public deployment must offer the complete corresponding source (this repository) under GPL-3.0-or-later. Set `BRAND.sourceUrl` in `src/brand.ts` and it appears on `/licenses`.

Game selection rule for future ports: only games whose **code and assets** both have open licences that allow commercial use and modification (e.g. GPL/MIT/BSD/zlib code with CC0/CC-BY/GPL assets), or explicit written permission. Check every asset and record it in this table. Never use trademarked game names or characters.

See `LICENSE` (GNU GPL v3).
