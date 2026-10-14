/*
 * Coin Sweeper: original hidden-hazard logic puzzle for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original implementation of the genre (no code,
 * names, art or sounds taken from any existing game).
 *
 * Rules: a grid of coin tiles hides "rugs". Tap a tile to reveal it; a number
 * tells how many rugs touch it (8 neighbours), a zero opens its whole area.
 * The board is generated after the first tap, so the first tap and its
 * neighbours are always safe. Long-press (or ALT) plants a flag. Tapping a
 * revealed number whose flags match it reveals the rest of its neighbours.
 * A run is a ladder of three boards (9x9/10, 12x16/30, 16x20/60); clear one
 * to climb, step on a rug and the run is over.
 * Score: points per tile revealed, a bonus per cleared board, and a time bonus
 * for clearing a board under par.
 *
 * Input: FIRE is held while the pointer is down (host). A short press reveals
 * on release; holding FIRE for LONG_PRESS frames flags instead. ALT flags.
 * Arrows move a keyboard cursor.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const FIELD_W = 360;
export const FIELD_H = 600;
/** Board area inside the field. */
const AREA_X = 8;
const AREA_Y = 108;
const AREA_W = 344;
const AREA_H = 464;

export const LADDER = [
  { cols: 9, rows: 9, rugs: 10, par: 60, bonus: 250 },
  { cols: 12, rows: 16, rugs: 30, par: 180, bonus: 600 },
  { cols: 16, rows: 20, rugs: 60, par: 360, bonus: 1200 },
] as const;

/** Cell states in `vis`. 0..8 = revealed with that many adjacent rugs. */
export const HIDDEN = -1;
export const FLAG = -2;
export const RUG_HIT = 9; // the rug that ended the run
export const RUG_SHOWN = 10; // other rugs shown after the run ended
export const BAD_FLAG = 11; // a flag that wasn't on a rug

export const POINTS_PER_TILE = 5;
export const TIME_POINTS_PER_SEC = 5;
export const LONG_PRESS = 24; // frames (0.4 s)
export const CLEAR_FRAMES = 110;
export const DEAD_FRAMES = 100;
/** Frames between flood rings, for the reveal ripple. */
export const RIPPLE = 2;
const MAX_FRAMES = 30 * 60 * 60;

export interface Layout {
  cols: number;
  rows: number;
  cell: number;
  x0: number;
  y0: number;
}

export function layoutFor(board: number): Layout {
  const { cols, rows } = LADDER[board];
  const cell = Math.min(Math.floor(AREA_W / cols), Math.floor(AREA_H / rows));
  return {
    cols,
    rows,
    cell,
    x0: AREA_X + ((AREA_W - cols * cell) >> 1),
    y0: AREA_Y + ((AREA_H - rows * cell) >> 1),
  };
}

export type Phase = "play" | "clear" | "dead" | "over" | "won";

export interface SweeperView {
  frame: number;
  board: number; // 0-based
  boards: number;
  layout: Layout;
  /** Per cell: HIDDEN, FLAG, 0..8 revealed, RUG_HIT, RUG_SHOWN, BAD_FLAG. */
  vis: Int8Array;
  /** Frame at which each revealed cell's flip animation starts. */
  revAt: Int32Array;
  generated: boolean;
  cursor: number;
  keyCursor: boolean;
  /** Cell being pressed and how long (for the long-press ring), -1 if none. */
  holdCell: number;
  hold: number;
  phase: Phase;
  phaseT: number;
  rugs: number;
  flags: number;
  /** Seconds on this board's clock. */
  seconds: number;
  score: number;
  revealed: number;
  lastBonus: number;
  lastTimeBonus: number;
}

class SweeperEngine implements GameEngine<SweeperView> {
  private rng: Rng;
  private board = 0;
  private lay: Layout = layoutFor(0);
  private rug = new Uint8Array(0);
  private adj = new Uint8Array(0);
  private vis = new Int8Array(0);
  private revAt = new Int32Array(0);
  private generated = false;
  private revealedCount = 0;
  private flags = 0;
  private boardFrames = 0;
  private cursor = 0;
  private keyCursor = false;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private holdCell = -1;
  private hold = 0;
  private holdDone = false;
  private phase: Phase = "play";
  private phaseT = 0;
  private score = 0;
  private cleared = 0;
  private lastBonus = 0;
  private lastTimeBonus = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.setupBoard(0);
  }

  private setupBoard(b: number) {
    this.board = b;
    this.lay = layoutFor(b);
    const n = this.lay.cols * this.lay.rows;
    this.rug = new Uint8Array(n);
    this.adj = new Uint8Array(n);
    this.vis = new Int8Array(n).fill(HIDDEN);
    this.revAt = new Int32Array(n);
    this.generated = false;
    this.revealedCount = 0;
    this.flags = 0;
    this.boardFrames = 0;
    this.cursor = (this.lay.rows >> 1) * this.lay.cols + (this.lay.cols >> 1);
    this.holdCell = -1;
    this.hold = 0;
    this.holdDone = false;
    this.phase = "play";
    this.phaseT = 0;
  }

  private neighbours(i: number): number[] {
    const { cols, rows } = this.lay;
    const c = i % cols, r = (i / cols) | 0;
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dr && !dc) continue;
        const cc = c + dc, rr = r + dr;
        if (cc >= 0 && cc < cols && rr >= 0 && rr < rows) out.push(rr * cols + cc);
      }
    }
    return out;
  }

  private centre(i: number) {
    const { cols, cell, x0, y0 } = this.lay;
    return { x: x0 + (i % cols) * cell + (cell >> 1), y: y0 + ((i / cols) | 0) * cell + (cell >> 1) };
  }

  cellAt(x: number, y: number): number {
    const { cols, rows, cell, x0, y0 } = this.lay;
    if (x < x0 || y < y0) return -1;
    const c = ((x - x0) / cell) | 0, r = ((y - y0) / cell) | 0;
    return c < cols && r < rows ? r * cols + c : -1;
  }

  /** Place rugs avoiding the first tapped cell and its neighbours. */
  private generate(safe: number) {
    const n = this.rug.length;
    const banned = new Uint8Array(n);
    banned[safe] = 1;
    for (const k of this.neighbours(safe)) banned[k] = 1;
    const pool: number[] = [];
    for (let i = 0; i < n; i++) if (!banned[i]) pool.push(i);
    const want = Math.min(LADDER[this.board].rugs, pool.length);
    for (let k = 0; k < want; k++) {
      const j = k + this.rng.int(pool.length - k);
      const t = pool[k];
      pool[k] = pool[j];
      pool[j] = t;
      this.rug[pool[k]] = 1;
    }
    for (let i = 0; i < n; i++) {
      let a = 0;
      for (const k of this.neighbours(i)) a += this.rug[k];
      this.adj[i] = a;
    }
    this.generated = true;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over" || this.phase === "won") return;
    if (this.frame >= MAX_FRAMES) {
      this.phase = "over";
      this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
      return;
    }
    if (this.phase === "clear") {
      this.prevB = inp.b;
      if (++this.phaseT >= CLEAR_FRAMES) {
        if (this.board + 1 < LADDER.length) {
          this.setupBoard(this.board + 1);
          this.events.push({ t: "board", board: this.board, sfx: "launch" });
        } else {
          this.phase = "won";
          this.events.push({ t: "won", sfx: "won", mood: "happy", score: this.score });
        }
      }
      return;
    }
    if (this.phase === "dead") {
      this.prevB = inp.b;
      if (++this.phaseT >= DEAD_FRAMES) {
        this.phase = "over";
        this.events.push({ t: "gameover", sfx: "gameover", score: this.score });
      }
      return;
    }
    if (this.generated) this.boardFrames++;
    this.handleInput(inp);
  }

  private handleInput(inp: Input) {
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    const moved = inp.x !== this.px || inp.y !== this.py;
    this.px = inp.x;
    this.py = inp.y;
    const here = this.cellAt(inp.x, inp.y);
    if (moved && here >= 0) {
      this.cursor = here;
      this.keyCursor = false;
    }

    const { cols, rows } = this.lay;
    const dirs = [
      [BTN.UP, 0, -1],
      [BTN.DOWN, 0, 1],
      [BTN.LEFT, -1, 0],
      [BTN.RIGHT, 1, 0],
    ];
    for (const [bit, dx, dy] of dirs) {
      if (!(pressed & bit)) continue;
      this.keyCursor = true;
      const c = Math.max(0, Math.min(cols - 1, (this.cursor % cols) + dx));
      const r = Math.max(0, Math.min(rows - 1, ((this.cursor / cols) | 0) + dy));
      this.cursor = r * cols + c;
    }

    // Target for a press: the tile under the pointer, or the keyboard cursor.
    const target = here >= 0 && !this.keyCursor ? here : this.keyCursor ? this.cursor : -1;

    if (pressed & BTN.ALT && target >= 0) this.toggleFlag(target);

    if (pressed & BTN.FIRE) {
      this.holdCell = target;
      this.hold = 0;
      this.holdDone = false;
    }
    if (inp.b & BTN.FIRE && this.holdCell >= 0 && !this.holdDone) {
      if (++this.hold >= LONG_PRESS) {
        this.holdDone = true;
        if (this.vis[this.holdCell] === HIDDEN || this.vis[this.holdCell] === FLAG) this.toggleFlag(this.holdCell);
      }
    }
    if (released & BTN.FIRE) {
      const cell = this.holdCell;
      const tap = !this.holdDone;
      this.holdCell = -1;
      this.hold = 0;
      this.holdDone = false;
      if (cell >= 0 && tap) this.act(cell);
    }
  }

  private toggleFlag(i: number) {
    if (!this.generated) return; // nothing to flag before the first reveal
    const at = this.centre(i);
    if (this.vis[i] === HIDDEN) {
      this.vis[i] = FLAG;
      this.flags++;
      this.events.push({ t: "flag", cell: i, sfx: "paddle", x: at.x, y: at.y });
    } else if (this.vis[i] === FLAG) {
      this.vis[i] = HIDDEN;
      this.flags--;
      this.events.push({ t: "unflag", cell: i, sfx: "wall", x: at.x, y: at.y });
    }
  }

  private act(i: number) {
    if (!this.generated) this.generate(i);
    const v = this.vis[i];
    if (v === FLAG) {
      const at = this.centre(i);
      this.events.push({ t: "bump", cell: i, sfx: "wall", x: at.x, y: at.y });
      return;
    }
    if (v === HIDDEN) {
      if (this.rug[i]) this.explode(i);
      else this.flood([i], i);
    } else if (v > 0 && v <= 8) {
      this.chord(i);
    }
    this.checkClear();
  }

  private chord(i: number) {
    const nb = this.neighbours(i);
    let flags = 0;
    const hidden: number[] = [];
    for (const k of nb) {
      if (this.vis[k] === FLAG) flags++;
      else if (this.vis[k] === HIDDEN) hidden.push(k);
    }
    if (!hidden.length) return;
    const at = this.centre(i);
    if (flags !== this.vis[i]) {
      this.events.push({ t: "nochord", cell: i, sfx: "wall", x: at.x, y: at.y });
      return;
    }
    for (const k of hidden) {
      if (this.rug[k]) {
        this.explode(k);
        return;
      }
    }
    this.flood(hidden, i);
  }

  /** Reveal the start cells; zeros spread outward ring by ring. */
  private flood(starts: number[], origin: number) {
    let ring = starts.filter((k) => this.vis[k] === HIDDEN);
    let depth = 0;
    let count = 0;
    for (const k of ring) this.vis[k] = -3; // mark queued
    while (ring.length) {
      const next: number[] = [];
      for (const k of ring) {
        this.vis[k] = this.adj[k];
        this.revAt[k] = this.frame + depth * RIPPLE;
        count++;
        if (this.adj[k] === 0) {
          for (const m of this.neighbours(k)) {
            if (this.vis[m] === HIDDEN && !this.rug[m]) {
              this.vis[m] = -3;
              next.push(m);
            }
          }
        }
      }
      ring = next;
      depth++;
    }
    if (!count) return;
    this.revealedCount += count;
    const pts = count * POINTS_PER_TILE;
    this.score += pts;
    const at = this.centre(origin);
    this.events.push({ t: "reveal", cell: origin, count, pts, depth, sfx: count > 1 ? "brickgone" : "brick", x: at.x, y: at.y });
  }

  private explode(i: number) {
    this.vis[i] = RUG_HIT;
    this.revAt[i] = this.frame;
    let d = 1;
    for (let k = 0; k < this.vis.length; k++) {
      if (k === i) continue;
      if (this.rug[k] && this.vis[k] === HIDDEN) {
        this.vis[k] = RUG_SHOWN;
        this.revAt[k] = this.frame + 10 + d++ * 3;
      } else if (!this.rug[k] && this.vis[k] === FLAG) {
        this.vis[k] = BAD_FLAG;
        this.revAt[k] = this.frame + 10;
      }
    }
    this.phase = "dead";
    this.phaseT = 0;
    this.holdCell = -1;
    const at = this.centre(i);
    this.events.push({ t: "boom", cell: i, sfx: "explode", mood: "sad", toast: "lifeLost", shake: 10, x: at.x, y: at.y });
  }

  private checkClear() {
    if (this.phase !== "play") return;
    if (this.revealedCount < this.vis.length - LADDER[this.board].rugs) return;
    const step = LADDER[this.board];
    const parFrames = step.par * 60;
    this.lastBonus = step.bonus;
    this.lastTimeBonus = Math.floor(Math.max(0, parFrames - this.boardFrames) / 60) * TIME_POINTS_PER_SEC;
    this.score += this.lastBonus + this.lastTimeBonus;
    this.cleared++;
    for (let k = 0; k < this.vis.length; k++) {
      if (this.rug[k] && this.vis[k] !== FLAG) {
        this.vis[k] = FLAG;
        this.flags++;
      }
    }
    this.phase = "clear";
    this.phaseT = 0;
    this.holdCell = -1;
    this.events.push({
      t: "clear",
      board: this.board,
      bonus: this.lastBonus,
      timeBonus: this.lastTimeBonus,
      sfx: "levelclear",
      toast: "levelClear",
      mood: "happy",
      x: FIELD_W >> 1,
      y: this.lay.y0 + ((this.lay.rows * this.lay.cell) >> 1),
    });
  }

  view(): SweeperView {
    return {
      frame: this.frame,
      board: this.board,
      boards: LADDER.length,
      layout: this.lay,
      vis: this.vis,
      revAt: this.revAt,
      generated: this.generated,
      cursor: this.cursor,
      keyCursor: this.keyCursor,
      holdCell: this.holdDone ? -1 : this.holdCell,
      hold: this.hold,
      phase: this.phase,
      phaseT: this.phaseT,
      rugs: LADDER[this.board].rugs,
      flags: this.flags,
      seconds: Math.floor(this.boardFrames / 60),
      score: this.score,
      revealed: this.revealedCount,
      lastBonus: this.lastBonus,
      lastTimeBonus: this.lastTimeBonus,
    };
  }

  hud(): Hud {
    return { score: this.score, level: this.board + 1, label: `Rugs ${LADDER[this.board].rugs - this.flags}` };
  }

  result(): GameResult {
    return {
      score: this.score,
      level: this.board,
      levelsCleared: this.cleared,
      frames: this.frame,
      status: this.phase === "won" ? "won" : this.phase === "over" ? "over" : "playing",
    };
  }

  get done() {
    return this.phase === "over" || this.phase === "won";
  }
}

export { SweeperEngine };

// ---------- Bot ----------

const BOT_PERIOD = 24;

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

interface BotMove {
  cell: number;
  flag: boolean;
}

function neighboursOf(i: number, cols: number, rows: number): number[] {
  const c = i % cols, r = (i / cols) | 0;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
    if (!dr && !dc) continue;
    const cc = c + dc, rr = r + dr;
    if (cc >= 0 && cc < cols && rr >= 0 && rr < rows) out.push(rr * cols + cc);
  }
  return out;
}

/** Simple single-cell deduction plus random guesses (and the odd careless guess). */
export function botMove(v: SweeperView, k: number): BotMove {
  const { cols, rows } = v.layout;
  const n = cols * rows;
  if (!v.generated) return { cell: (rows >> 1) * cols + (cols >> 1), flag: false };
  const h = hash(k * 7919 + v.board);
  const careless = h % 14 === 0;
  if (!careless) {
    const start = h % n;
    for (let s = 0; s < n; s++) {
      const i = (start + s) % n;
      const num = v.vis[i];
      if (num < 1 || num > 8) continue;
      let flags = 0;
      const hidden: number[] = [];
      for (const m of neighboursOf(i, cols, rows)) {
        if (v.vis[m] === FLAG) flags++;
        else if (v.vis[m] === HIDDEN) hidden.push(m);
      }
      if (!hidden.length) continue;
      if (flags === num) return { cell: i, flag: false }; // chord
      if (num - flags === hidden.length) return { cell: hidden[0], flag: true };
    }
  }
  // Guess: a random hidden tile.
  const hidden: number[] = [];
  for (let i = 0; i < n; i++) if (v.vis[i] === HIDDEN) hidden.push(i);
  if (!hidden.length) return { cell: -1, flag: false };
  return { cell: hidden[(h >>> 8) % hidden.length], flag: false };
}

export const sweeper: GameDef<SweeperView> = {
  id: "sweeper",
  name: "Coin Sweeper",
  tagline: "Flip the coins, dodge the rugs. Three boards, one shot.",
  genre: "Logic puzzle",
  session: "2–10 min",
  controls: "Tap a tile to reveal, hold (or X / Shift) to flag, tap a number to open around it. Keys: arrows move, Space reveals.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the hidden-hazard logic puzzle genre: rules, board ladder, scoring and all art written for ArcadePad. No code, names, art or sounds from any existing game.",
  },
  create: (seed) => new SweeperEngine(seed),
  bot(v, frame) {
    if (v.phase !== "play") return { x: FIELD_W >> 1, y: 40, b: 0 };
    const k = Math.floor(frame / BOT_PERIOD);
    const slot = frame % BOT_PERIOD;
    const mv = botMove(v, k);
    if (mv.cell < 0) return { x: FIELD_W >> 1, y: 40, b: 0 };
    const { cols, cell, x0, y0 } = v.layout;
    const x = x0 + (mv.cell % cols) * cell + (cell >> 1);
    const y = y0 + ((mv.cell / cols) | 0) * cell + (cell >> 1);
    const b = slot === BOT_PERIOD - 2 ? (mv.flag ? BTN.ALT : BTN.FIRE) : 0;
    return { x, y, b };
  },
};
