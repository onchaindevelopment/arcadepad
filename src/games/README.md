# Writing an ArcadePad game

Every game lives in `src/games/<id>/` and has four files:

| File | What |
|---|---|
| `index.ts` | Deterministic engine + `export const <id>: GameDef` (metadata, credits, `create`, `bot`). Server-safe: no DOM. |
| `render.ts` | `export default function createRenderer(canvas, theme): GameRenderer` (client only). |
| `<id>.test.ts` | `node --test` tests: bot scores, replay(encode(inputs)) equals the live result, a rule test. |
| (optional) data files | Levels/mazes as TS constants. |

`src/games/snake/` is the reference implementation: copy its structure.

## Contract (`core/types.ts`)
- `create(seed, { ticker })` returns a `GameEngine`. The host calls `step(input)` 60 times a second, then reads `events`, `hud()`, `view()`, `done`, and `result()` when done.
- `Input = { x, y, b }`. `x`/`y` are the pointer position in field units (integers inside the field). `b` holds the button bits from `BTN` (FIRE, UP, DOWN, LEFT, RIGHT, ALT). Buttons are *levels*; detect presses yourself with `pressed = b & ~prevB`.
- `meta.input.swipe`: touch swipes arrive as short UP/DOWN/LEFT/RIGHT pulses, and a tap arrives as FIRE.
- Events: `{ t, sfx?, mood?, toast?, shake?, x?, y?, ...own fields }`.
  - `sfx` names: paddle, wall, brick, brickgone, explode, extraGood, extraBad, shot, launch, lost, levelclear, gameover, won. Each coin skin supplies its own synth sound for each name.
  - `mood` makes the mascot react ("happy" or "sad").
  - `toast` shows a skin line: "levelClear" or "lifeLost".
- `result()`: `{ score, level, levelsCleared, frames, status: "playing" | "over" | "won" }`. The server stores the score from *its* replay of the inputs.

## Determinism rules (hard)
The server replays recorded inputs to verify scores, so engines must give bit-identical results everywhere:
- No `Math.random`, `Date`, `performance`, DOM, timers or global mutable state. Everything lives on the engine instance.
- No `Math.sin/cos/tan/atan/atan2/pow/exp/log/hypot/cbrt`. Use `core/trig.ts` (`sin256`, `cos256`, `angle256`, with 256 steps per turn) and `+ - * /`, `Math.sqrt`, `floor/ceil/round/trunc/abs/min/max/sign`, `Math.imul` and bitwise ops.
- Randomness only from `core/rng.ts` (`new Rng(seed)`: `next()`, `int(n)`, `range(lo, hi)`).
- Fixed step: 1 step = 1/60 s. Keep runs short (`maxFrames`).
- Only erasable TypeScript (no enums, namespaces or parameter properties), with relative imports that include the `.ts` extension, so `node --test` runs the files directly.

## Look and feel
- Use `core/render-kit.ts`: `makeKit(canvas, theme, w, h)` gives you the themed background, `kit.block()` for chunky outlined blocks, `kit.text()` for pixel text, mascot sprites (`kit.sprites.idle/happy/sad/mini`) and `kit.fx` for particles, popups, shake and flash.
- The coin's mascot is the hero (player, head or ship) wherever it fits, and the coin's palette (`theme.palette`) colours everything. No hard-coded colours except ink and white.
- Chunky, bright and readable at phone size; juice on every hit.

## Licences and names (hard)
- Port logic only from code under MIT, BSD, ISC, zlib, Apache-2.0, GPL-2.0-or-later, GPL-3.0(-or-later) or LGPL. Verify the actual LICENSE file and the file headers. Never copy assets (sprites, sounds, levels, maps, fonts): draw everything with the kit and the theme.
- If no suitable open-source code exists, write an original implementation of the genre and set `credits.basedOn = "Original"`.
- Never use trademarked names, characters or the recognisable look of commercial games (no Tetris, Pac-Man, Space Invaders, Flappy Bird, Chrome dino, etc. in names, art, mazes, sounds or UI). Mechanics are fine; trade dress is not.
- Fill `credits` honestly: what was ported, from where, under which licence, and what wasn't.
