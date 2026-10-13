/*
 * Snake: real-time port of BSD worm(6).
 * Original: worm.c, Copyright (c) 1980, 1993 The Regents of the University of
 * California. All rights reserved. BSD-3-Clause (see /licenses).
 * Port: ArcadePad, GPL-3.0-or-later.
 *
 * Kept from worm: start length 7, food is a digit 1-9 that adds that many
 * segments of pending growth, score grows by the pending growth after each
 * meal, walls and your own body kill, filling the board wins.
 * Changed: real-time movement that speeds up with score (worm moved once per
 * second unless you ran), coin-shaped food, mascot head.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const COLS = 24;
export const ROWS = 18;
export const CELL = 20;
const START_LEN = 7;
const AUTO_START = 120; // frames before the worm starts on its own

const DIRS = [
  { b: BTN.UP, dx: 0, dy: -1 },
  { b: BTN.RIGHT, dx: 1, dy: 0 },
  { b: BTN.DOWN, dx: 0, dy: 1 },
  { b: BTN.LEFT, dx: -1, dy: 0 },
];

export interface SnakeView {
  frame: number;
  started: boolean;
  /** Cells head first, as [col, row]. */
  body: [number, number][];
  dir: number; // index into DIRS
  food: { c: number; r: number; value: number };
  pending: number;
  score: number;
  /** 0..1 progress to the next move, for smooth interpolation. */
  t: number;
  dead: boolean;
  won: boolean;
}

class SnakeEngine implements GameEngine<SnakeView> {
  private rng: Rng;
  private body: number[] = []; // cell index = r * COLS + c, head first
  private occupied = new Uint8Array(COLS * ROWS);
  private dir = 1;
  private queue: number[] = [];
  private prevB = 0;
  private pending = 0;
  private score = 0;
  private food = { cell: 0, value: 1 };
  private counter = 0;
  private started = false;
  private dead = false;
  private won = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const r = ROWS >> 1;
    for (let i = 0; i < START_LEN; i++) {
      const cell = r * COLS + (COLS >> 1) - i;
      this.body.push(cell);
      this.occupied[cell] = 1;
    }
    this.placeFood();
  }

  private interval() {
    // Starts at ~6.7 moves/s and gets faster as the score climbs.
    return Math.max(4, 9 - Math.floor(this.score / 60));
  }

  private placeFood() {
    const free = COLS * ROWS - this.body.length;
    if (free <= 0) return;
    let k = this.rng.int(free);
    for (let cell = 0; cell < COLS * ROWS; cell++) {
      if (this.occupied[cell]) continue;
      if (k-- === 0) {
        this.food = { cell, value: 1 + this.rng.int(9) };
        return;
      }
    }
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead || this.won) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    for (let d = 0; d < 4; d++) {
      if (!(pressed & DIRS[d].b)) continue;
      const last = this.queue.length ? this.queue[this.queue.length - 1] : this.dir;
      if (d !== last && d !== (last + 2) % 4 && this.queue.length < 3) this.queue.push(d);
      this.started = true;
    }
    if (!this.started) {
      if (this.frame < AUTO_START) return;
      this.started = true;
    }
    if (++this.counter < this.interval()) return;
    this.counter = 0;
    this.move();
  }

  private move() {
    if (this.queue.length) this.dir = this.queue.shift()!;
    const head = this.body[0];
    const c = (head % COLS) + DIRS[this.dir].dx;
    const r = Math.floor(head / COLS) + DIRS[this.dir].dy;
    const next = r * COLS + c;
    const tail = this.body[this.body.length - 1];
    const hitsBody = this.occupied[next] && !(next === tail && this.pending === 0);
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS || hitsBody) {
      this.dead = true;
      this.events.push({ t: "die", sfx: "lost", mood: "sad", shake: 8, x: (c + 0.5) * CELL, y: (r + 0.5) * CELL });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    if (this.pending > 0) this.pending--;
    else {
      this.body.pop();
      this.occupied[tail] = 0;
    }
    this.body.unshift(next);
    this.occupied[next] = 1;
    if (next === this.food.cell) {
      const v = this.food.value;
      this.pending += v;
      this.score += this.pending; // worm's scoring: add the pending growth
      this.events.push({ t: "eat", value: v, sfx: v >= 7 ? "extraGood" : "brickgone", mood: v >= 7 ? "happy" : undefined, x: (c + 0.5) * CELL, y: (r + 0.5) * CELL });
      if (this.body.length + this.pending >= COLS * ROWS) {
        this.won = true;
        this.events.push({ t: "won", sfx: "won", mood: "happy" });
        return;
      }
      this.placeFood();
    }
  }

  view(): SnakeView {
    return {
      frame: this.frame,
      started: this.started,
      body: this.body.map((cell) => [cell % COLS, Math.floor(cell / COLS)]),
      dir: this.dir,
      food: { c: this.food.cell % COLS, r: Math.floor(this.food.cell / COLS), value: this.food.value },
      pending: this.pending,
      score: this.score,
      t: this.counter / this.interval(),
      dead: this.dead,
      won: this.won,
    };
  }
  hud(): Hud {
    return { score: this.score, label: `Length ${this.body.length + this.pending}` };
  }
  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.won ? "won" : this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead || this.won;
  }
}

export const snake: GameDef<SnakeView> = {
  id: "snake",
  name: "Snake",
  tagline: "Eat coins, grow long, don't bite yourself. Bigger coins, bigger growth.",
  genre: "Classic snake",
  session: "1–4 min",
  controls: "Arrow keys / WASD or swipe.",
  field: { w: COLS * CELL, h: ROWS * CELL },
  input: { pointer: false, swipe: true, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "worm (BSD games)",
    url: "https://github.com/NetBSD/src/blob/trunk/games/worm/worm.c",
    authors: "The Regents of the University of California (1980, 1993)",
    licence: "BSD-3-Clause",
    notes: "Rules ported (digit food, pending growth, scoring, win by filling the board); made real-time. Terminal UI not used; all art is new.",
  },
  create: (seed) => new SnakeEngine(seed),
  bot(v) {
    // Greedy: step toward the food, avoiding walls and body when possible.
    const [hc, hr] = v.body[0];
    const blocked = new Set(v.body.slice(0, -1).map(([c, r]) => r * COLS + c));
    const opts = DIRS.map((d, i) => ({ i, c: hc + d.dx, r: hr + d.dy })).filter(
      (o) => o.i !== (v.dir + 2) % 4 && o.c >= 0 && o.c < COLS && o.r >= 0 && o.r < ROWS && !blocked.has(o.r * COLS + o.c),
    );
    opts.sort((a, b) => Math.abs(a.c - v.food.c) + Math.abs(a.r - v.food.r) - (Math.abs(b.c - v.food.c) + Math.abs(b.r - v.food.r)));
    const pick = opts[0];
    return { x: 0, y: 0, b: pick && pick.i !== v.dir ? DIRS[pick.i].b : 0 };
  },
};
