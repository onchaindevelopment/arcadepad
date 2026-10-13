/*
 * Merge to Moon: sliding-tile merge puzzle, ported from 2048 by Gabriele
 * Cirulli (https://github.com/gabrielecirulli/2048), js/game_manager.js,
 * js/grid.js and js/tile.js.
 *
 *   The MIT License (MIT)
 *   Copyright (c) 2014 Gabriele Cirulli
 *
 *   Permission is hereby granted, free of charge, to any person obtaining a copy
 *   of this software and associated documentation files (the "Software"), to deal
 *   in the Software without restriction, including without limitation the rights
 *   to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 *   copies of the Software, and to permit persons to whom the Software is
 *   furnished to do so, subject to the following conditions:
 *
 *   The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 *
 *   THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 *   IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 *   FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 *   AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 *   LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 *   OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
 *   THE SOFTWARE.
 *
 * Port: ArcadePad, GPL-3.0-or-later.
 *
 * Kept from the original: 4x4 grid, two start tiles, a new tile (2 at 90%,
 * 4 at 10%) after every move that changes the board, traversal from the
 * farthest cell in the move direction, each tile merges at most once per
 * move, score += merged value, the 2048 tile wins and play may continue,
 * game over when no empty cell and no adjacent equal pair remain.
 * Changed: Math.random replaced by the seeded Rng (same draw order: value,
 * then cell), frame-stepped input with a short move lock and a one-deep
 * buffer, no saved games / restart / "keep playing" button (play always
 * continues after the win). All visuals are new (see render.ts).
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const SIZE = 4;
export const FIELD_W = 400;
export const FIELD_H = 448;
export const HEADER = 48;
export const GAP = 8;
export const CELL = 88;
export const BOARD = SIZE * CELL + (SIZE + 1) * GAP; // 392
export const BOARD_X = (FIELD_W - BOARD) / 2; // 4
export const BOARD_Y = HEADER;
export const WIN_VALUE = 2048;
/** Frames after a move during which new presses are buffered (1 deep). */
export const LOCK_FRAMES = 6;
const START_TILES = 2;
const MAX_FRAMES = 45 * 60 * 60;

/** Direction index as in the original: 0 up, 1 right, 2 down, 3 left. */
export const DIRS = [
  { b: BTN.UP, x: 0, y: -1 },
  { b: BTN.RIGHT, x: 1, y: 0 },
  { b: BTN.DOWN, x: 0, y: 1 },
  { b: BTN.LEFT, x: -1, y: 0 },
];

/** Cell centre in field units. */
export function cellCenter(x: number, y: number): { x: number; y: number } {
  return { x: BOARD_X + GAP + x * (CELL + GAP) + CELL / 2, y: BOARD_Y + GAP + y * (CELL + GAP) + CELL / 2 };
}

/** log2 of a tile value (2 -> 1, 2048 -> 11), integer-only. */
export function tierOf(value: number): number {
  let t = 0;
  while (value > 1) {
    value = Math.floor(value / 2);
    t++;
  }
  return t;
}

// ---------- Core rules (pure, shared by engine, bot and tests) ----------

interface Tile {
  id: number;
  value: number;
  x: number;
  y: number;
  px: number; // previous position (savePosition)
  py: number;
  merged: boolean; // mergedFrom != null
  isNew: boolean;
}

/** Grid as a flat array, index y * SIZE + x. */
type Grid = (Tile | null)[];

export interface Consumed {
  id: number;
  value: number;
  /** Position before the move. */
  fx: number;
  fy: number;
  /** Merge target. */
  x: number;
  y: number;
}

interface MoveOutcome {
  moved: boolean;
  gained: number;
  merges: Tile[];
  consumed: Consumed[];
}

const within = (x: number, y: number) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;

/** GameManager.prototype.move without the actuator: slides and merges in place. */
function moveGrid(grid: Grid, dir: number, nextId: () => number): MoveOutcome {
  const v = DIRS[dir];
  const out: MoveOutcome = { moved: false, gained: 0, merges: [], consumed: [] };
  // prepareTiles
  for (const t of grid) {
    if (!t) continue;
    t.merged = false;
    t.isNew = false;
    t.px = t.x;
    t.py = t.y;
  }
  // buildTraversals: always from the farthest cell in the move direction
  const tx = [0, 1, 2, 3];
  const ty = [0, 1, 2, 3];
  if (v.x === 1) tx.reverse();
  if (v.y === 1) ty.reverse();
  for (const x of tx) {
    for (const y of ty) {
      const tile = grid[y * SIZE + x];
      if (!tile) continue;
      // findFarthestPosition
      let fx = x, fy = y;
      let nx = x + v.x, ny = y + v.y;
      while (within(nx, ny) && !grid[ny * SIZE + nx]) {
        fx = nx; fy = ny;
        nx += v.x; ny += v.y;
      }
      const next = within(nx, ny) ? grid[ny * SIZE + nx] : null;
      if (next && next.value === tile.value && !next.merged) {
        const value = tile.value * 2;
        const merged: Tile = { id: nextId(), value, x: nx, y: ny, px: nx, py: ny, merged: true, isNew: false };
        out.consumed.push({ id: next.id, value: next.value, fx: next.px, fy: next.py, x: nx, y: ny });
        out.consumed.push({ id: tile.id, value: tile.value, fx: tile.px, fy: tile.py, x: nx, y: ny });
        grid[ny * SIZE + nx] = merged;
        grid[y * SIZE + x] = null;
        tile.x = nx; tile.y = ny;
        out.gained += value;
        out.merges.push(merged);
      } else {
        grid[y * SIZE + x] = null;
        grid[fy * SIZE + fx] = tile;
        tile.x = fx; tile.y = fy;
      }
      if (tile.x !== x || tile.y !== y) out.moved = true;
    }
  }
  return out;
}

/** movesAvailable: an empty cell or two equal neighbours. */
function movesAvailable(values: readonly number[]): boolean {
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const v = values[y * SIZE + x];
      if (!v) return true;
      if (x + 1 < SIZE && values[y * SIZE + x + 1] === v) return true;
      if (y + 1 < SIZE && values[(y + 1) * SIZE + x] === v) return true;
    }
  }
  return false;
}

/**
 * Pure helper: slide a board of values (index y * 4 + x, 0 = empty) in a
 * direction (0 up, 1 right, 2 down, 3 left). No random tile is added.
 */
export function slideValues(values: readonly number[], dir: number): { values: number[]; moved: boolean; gained: number } {
  let id = 0;
  const grid: Grid = values.map((v, i) => (v ? { id: ++id, value: v, x: i % SIZE, y: Math.floor(i / SIZE), px: 0, py: 0, merged: false, isNew: false } : null));
  const r = moveGrid(grid, dir, () => ++id);
  return { values: grid.map((t) => (t ? t.value : 0)), moved: r.moved, gained: r.gained };
}

// ---------- Engine ----------

export interface TileView {
  id: number;
  value: number;
  x: number;
  y: number;
  /** Position before the last move (equal to x/y for new and merged tiles). */
  fx: number;
  fy: number;
  /** Created by a merge in the last move (pop). */
  merged: boolean;
  /** Spawned after the last move (grow in). */
  isNew: boolean;
}

export interface MergeView {
  frame: number;
  /** Increments on every move that changed the board; renderers restart the slide animation when it changes. */
  moveId: number;
  moves: number;
  /** Direction of the last attempted move, -1 before the first. */
  lastDir: number;
  /** Frames left in the move lock (0 = ready for input). */
  lock: number;
  tiles: TileView[];
  /** Tiles swallowed by merges in the last move: slide from f to x/y, then vanish. */
  consumed: Consumed[];
  score: number;
  best: number;
  reached: boolean; // 2048 reached at least once
  over: boolean;
}

export class MergeEngine implements GameEngine<MergeView> {
  private rng: Rng;
  private grid: Grid = new Array(SIZE * SIZE).fill(null);
  private ids = 0;
  private prevB = 0;
  private lock = 0;
  private buffered = -1;
  private score = 0;
  private best = 0;
  private reached = false;
  private over = false;
  private moveId = 0;
  private moves = 0;
  private lastDir = -1;
  private consumed: Consumed[] = [];
  frame = 0;
  events: GameEvent[] = [];

  /** `board` (values, index y * 4 + x) is for tests; normal games start with two random tiles. */
  constructor(seed: number, board?: readonly number[]) {
    this.rng = new Rng(seed);
    if (board) {
      board.forEach((v, i) => {
        if (v) this.grid[i] = this.tile(v, i % SIZE, Math.floor(i / SIZE));
      });
    } else {
      for (let i = 0; i < START_TILES; i++) this.addRandomTile();
    }
    for (const t of this.grid) if (t) t.isNew = true;
    this.best = this.maxValue();
  }

  private tile(value: number, x: number, y: number): Tile {
    return { id: ++this.ids, value, x, y, px: x, py: y, merged: false, isNew: false };
  }

  private maxValue() {
    let m = 0;
    for (const t of this.grid) if (t && t.value > m) m = t.value;
    return m;
  }

  /** addRandomTile: value first, then a free cell in x-major order, like grid.availableCells(). */
  private addRandomTile(): Tile | null {
    const free: number[] = [];
    for (let x = 0; x < SIZE; x++) for (let y = 0; y < SIZE; y++) if (!this.grid[y * SIZE + x]) free.push(y * SIZE + x);
    if (!free.length) return null;
    const value = this.rng.int(10) < 9 ? 2 : 4;
    const cell = free[this.rng.int(free.length)];
    const t = this.tile(value, cell % SIZE, Math.floor(cell / SIZE));
    t.isNew = true;
    this.grid[cell] = t;
    return t;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    let dir = -1;
    for (let d = 0; d < 4; d++) if (pressed & DIRS[d].b) { dir = d; break; }

    if (this.lock > 0) {
      this.lock--;
      if (dir >= 0) this.buffered = dir;
    } else {
      if (dir < 0) dir = this.buffered;
      this.buffered = -1;
      if (dir >= 0) this.move(dir);
    }

    if (!this.over && this.frame >= MAX_FRAMES) this.end();
  }

  private move(dir: number) {
    this.lastDir = dir;
    const r = moveGrid(this.grid, dir, () => ++this.ids);
    if (!r.moved) {
      this.events.push({ t: "bump", dir });
      return;
    }
    this.moves++;
    this.moveId++;
    this.lock = LOCK_FRAMES;
    this.consumed = r.consumed;
    this.score += r.gained;

    if (r.merges.length) {
      // One sound per move, from the biggest merge.
      let top = r.merges[0];
      for (const m of r.merges) if (m.value > top.value) top = m;
      for (const m of r.merges) {
        const c = cellCenter(m.x, m.y);
        const e: GameEvent = { t: "merge", value: m.value, tier: tierOf(m.value), x: c.x, y: c.y };
        if (m === top) e.sfx = m.value >= 64 ? "brickgone" : "brick";
        this.events.push(e);
      }
      let hitWin = false;
      if (!this.reached && top.value >= WIN_VALUE) {
        this.reached = true;
        hitWin = true;
      }
      if (top.value > this.best) {
        this.best = top.value;
        if (top.value >= 128) {
          const c = cellCenter(top.x, top.y);
          this.events.push({ t: "maxTile", value: top.value, tier: tierOf(top.value), x: c.x, y: c.y, sfx: hitWin ? undefined : "extraGood", mood: "happy" });
        }
      }
      if (hitWin) {
        const c = cellCenter(top.x, top.y);
        this.events.push({ t: "moon", value: top.value, x: c.x, y: c.y, sfx: "levelclear", toast: "levelClear", mood: "happy" });
      }
    } else {
      this.events.push({ t: "move", dir, sfx: "paddle" });
    }

    const spawned = this.addRandomTile();
    if (spawned) {
      const c = cellCenter(spawned.x, spawned.y);
      this.events.push({ t: "spawn", value: spawned.value, x: c.x, y: c.y });
    }

    if (!movesAvailable(this.values())) this.end();
  }

  private end() {
    this.over = true;
    this.events.push({ t: "gameover", sfx: "gameover", mood: "sad", shake: 6, reached: this.reached });
  }

  private values(): number[] {
    return this.grid.map((t) => (t ? t.value : 0));
  }

  view(): MergeView {
    const tiles: TileView[] = [];
    for (const t of this.grid) {
      if (t) tiles.push({ id: t.id, value: t.value, x: t.x, y: t.y, fx: t.px, fy: t.py, merged: t.merged, isNew: t.isNew });
    }
    return {
      frame: this.frame,
      moveId: this.moveId,
      moves: this.moves,
      lastDir: this.lastDir,
      lock: this.lock,
      tiles,
      consumed: this.consumed,
      score: this.score,
      best: this.best,
      reached: this.reached,
      over: this.over,
    };
  }
  hud(): Hud {
    return { score: this.score, label: `Top tile ${this.best}` };
  }
  result(): GameResult {
    return {
      score: this.score,
      level: 0,
      levelsCleared: this.reached ? 1 : 0,
      frames: this.frame,
      status: this.over ? (this.reached ? "won" : "over") : "playing",
    };
  }
  get done() {
    return this.over;
  }
}

/** Board values from a view (index y * 4 + x). */
export function viewValues(v: MergeView): number[] {
  const out = new Array(SIZE * SIZE).fill(0);
  for (const t of v.tiles) out[t.y * SIZE + t.x] = t.value;
  return out;
}

const NONE: Input = { x: 0, y: 0, b: 0 };

export const merge: GameDef<MergeView> = {
  id: "merge",
  name: "Merge to Moon",
  tagline: "Slide, merge, evolve. Two of a kind become one bigger coin. Ride it all the way to the moon.",
  genre: "Sliding-tile merge puzzle",
  session: "3–15 min",
  controls: "Arrow keys / WASD or swipe to slide every tile.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "2048 by Gabriele Cirulli",
    url: "https://github.com/gabrielecirulli/2048",
    authors: "Gabriele Cirulli (2014)",
    licence: "MIT",
    notes:
      "Game logic ported from js/game_manager.js, js/grid.js and js/tile.js (grid, traversal order, one merge per tile per move, 2/4 spawn odds, scoring, win tile, game-over check). Seeded RNG instead of Math.random, frame-stepped input. No CSS, colours, fonts or layout copied; mascot-evolution tiles and all art are new.",
  },
  create: (seed) => new MergeEngine(seed),
  bot(v, frame) {
    // Corner strategy: prefer down/left (keep big tiles bottom-left), right if
    // neither works, up only when forced. One press every other frame.
    if (v.over || v.lock > 0 || frame & 1) return NONE;
    const vals = viewValues(v);
    const empty = (a: number[]) => a.reduce((n, x) => n + (x ? 0 : 1), 0);
    let pick = -1;
    let bestScore = -1;
    for (const d of [2, 3]) {
      const r = slideValues(vals, d);
      if (!r.moved) continue;
      const s = r.gained * 4 + empty(r.values);
      if (s > bestScore) {
        bestScore = s;
        pick = d;
      }
    }
    if (pick < 0) pick = slideValues(vals, 1).moved ? 1 : 0;
    return { x: 0, y: 0, b: DIRS[pick].b };
  },
};
