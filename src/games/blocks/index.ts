/*
 * Block Drop: an original falling-coin line-clearing puzzle.
 * Written from scratch for ArcadePad, GPL-3.0-or-later. No code, rotation
 * tables, art or UI taken from any commercial falling-block game.
 *
 * Rules: a 12 x 18 jar; clusters of round coins (seven 4-coin shapes plus two
 * 3-coin shapes, dealt from a shuffled 9-cluster bag) fall in. Fill a row to
 * pop it. Simple matrix rotation with sideways nudges (0, -1, +1, -2, +2).
 * Gravity speeds up every 8 rows. No drop preview.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const COLS = 12;
export const ROWS = 18;
export const CELL = 20;
/** Jar position inside the field. */
export const WELL_X = 12;
export const WELL_Y = 10;
export const FIELD_W = 380;
export const FIELD_H = ROWS * CELL + 2 * WELL_Y; // 380

const DAS_DELAY = 10; // frames before left/right auto-repeat
const DAS_REPEAT = 3; // frames between repeats
const LOCK_DELAY = 30; // frames on the ground before a cluster sets
const MAX_LOCK_RESETS = 15; // moves/turns that may restart the lock timer
const SOFT_INTERVAL = 2; // frames per row while DOWN is held
const CLEAR_FRAMES = 18; // pop animation pause before rows collapse
const LINES_PER_LEVEL = 8;
const LINE_SCORE = [0, 100, 300, 500, 800];
// Frames per row by level (1-based index - 1); last value repeats.
const GRAVITY = [48, 40, 33, 27, 22, 18, 14, 11, 9, 7, 6, 5, 4, 3, 2];
const KICKS = [0, -1, 1, -2, 2];

/** Cluster shapes as square matrices. 0-6: four coins, 7-8: three coins. */
const SHAPES: string[][] = [
  ["....", "####", "....", "...."], // 0 straight four
  ["##", "##"], // 1 square
  [".#.", "###", "..."], // 2 tee
  [".##", "##.", "..."], // 3 step right
  ["##.", ".##", "..."], // 4 step left
  ["#..", "###", "..."], // 5 hook left
  ["..#", "###", "..."], // 6 hook right
  ["#.", "##"], // 7 corner three
  ["...", "###", "..."], // 8 straight three
];
export const KINDS = SHAPES.length;

/** ROT[kind][rot] = list of [col, row] offsets inside the matrix. */
const ROT: [number, number][][][] = SHAPES.map((rows) => {
  const n = rows.length;
  let cells: [number, number][] = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (rows[r][c] === "#") cells.push([c, r]);
  const out: [number, number][][] = [];
  for (let k = 0; k < 4; k++) {
    out.push(cells);
    // Clockwise: (c, r) -> (n - 1 - r, c)
    cells = cells.map(([c, r]) => [n - 1 - r, c] as [number, number]);
  }
  return out;
});
const SIZE = SHAPES.map((s) => s.length);

export interface BlocksPiece {
  kind: number;
  rot: number;
  x: number; // matrix left column
  y: number; // matrix top row
  cells: [number, number][]; // absolute [col, row]
}

export interface BlocksView {
  frame: number;
  /** COLS * ROWS, 0 = empty, else kind + 1. */
  board: number[];
  /** COLS * ROWS cluster serial per coin (for drawing jelly bridges); 0 = empty. */
  ids: number[];
  piece: BlocksPiece | null;
  pieceId: number;
  /** Next two cluster kinds. */
  next: number[];
  score: number;
  level: number; // 1-based
  lines: number;
  /** Rows currently popping (before they collapse), and 0..1 progress. */
  clearing: number[];
  clearT: number;
  /** 0..1 progress to the next gravity row (0 when resting), for smooth falling. */
  fallT: number;
  /** 0..1 lock timer progress while resting. */
  lockT: number;
  over: boolean;
  ticker: string;
}

function fits(board: Uint8Array, kind: number, rot: number, x: number, y: number): boolean {
  for (const [c, r] of ROT[kind][rot]) {
    const cc = x + c, rr = y + r;
    if (cc < 0 || cc >= COLS || rr >= ROWS) return false;
    if (rr >= 0 && board[rr * COLS + cc]) return false;
  }
  return true;
}

class BlocksEngine implements GameEngine<BlocksView> {
  private rng: Rng;
  private board = new Uint8Array(COLS * ROWS);
  private ids = new Int32Array(COLS * ROWS);
  private bag: number[] = [];
  private queue: number[] = [];
  private kind = 0;
  private rot = 0;
  private px = 0;
  private py = 0;
  private active = false;
  private serial = 0;
  private prevB = 0;
  private dasDir = 0;
  private dasT = 0;
  private fallC = 0;
  private lockC = 0;
  private lockResets = 0;
  private clearRows: number[] = [];
  private clearC = 0;
  private score = 0;
  private lines = 0;
  private level = 1;
  private over = false;
  private ticker: string;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, ticker: string) {
    this.rng = new Rng(seed);
    this.ticker = ticker || "X";
    this.queue.push(this.draw(), this.draw());
    this.spawn();
  }

  private draw(): number {
    if (!this.bag.length) {
      const b = Array.from({ length: KINDS }, (_, i) => i);
      for (let i = b.length - 1; i > 0; i--) {
        const j = this.rng.int(i + 1);
        const t = b[i]; b[i] = b[j]; b[j] = t;
      }
      this.bag = b;
    }
    return this.bag.shift()!;
  }

  private spawn() {
    const kind = this.queue.shift()!;
    this.queue.push(this.draw());
    this.kind = kind;
    this.rot = 0;
    this.px = (COLS - SIZE[kind]) >> 1;
    let top = 99;
    for (const [, r] of ROT[kind][0]) top = Math.min(top, r);
    this.py = -top;
    this.fallC = 0;
    this.lockC = 0;
    this.lockResets = 0;
    this.serial++;
    if (!fits(this.board, kind, 0, this.px, this.py)) {
      this.active = false;
      this.over = true;
      this.events.push({ t: "gameover", sfx: "gameover", mood: "sad", shake: 6 });
      return;
    }
    this.active = true;
  }

  private gravity() {
    return GRAVITY[Math.min(this.level - 1, GRAVITY.length - 1)];
  }
  private grounded() {
    return !fits(this.board, this.kind, this.rot, this.px, this.py + 1);
  }
  private touched() {
    // A successful move/turn while resting buys a little more time.
    if (this.grounded() && this.lockResets < MAX_LOCK_RESETS) {
      this.lockResets++;
      this.lockC = 0;
    }
  }

  private shift(dx: number, quietBump: boolean) {
    if (fits(this.board, this.kind, this.rot, this.px + dx, this.py)) {
      this.px += dx;
      this.touched();
      this.events.push({ t: "move", dx });
    } else if (quietBump) {
      this.events.push({ t: "bump", sfx: "wall", dx, x: this.cx(), y: this.cy() });
    }
  }

  private turn(dir: number) {
    const nr = (this.rot + dir + 4) & 3;
    for (const k of KICKS) {
      if (fits(this.board, this.kind, nr, this.px + k, this.py)) {
        this.rot = nr;
        this.px += k;
        this.touched();
        this.events.push({ t: "turn", dir });
        return;
      }
    }
    this.events.push({ t: "turnBlocked", dir });
  }

  private cx() {
    let s = 0;
    for (const [c] of ROT[this.kind][this.rot]) s += this.px + c;
    return WELL_X + (s / ROT[this.kind][this.rot].length + 0.5) * CELL;
  }
  private cy() {
    let s = 0;
    for (const [, r] of ROT[this.kind][this.rot]) s += this.py + r;
    return WELL_Y + (s / ROT[this.kind][this.rot].length + 0.5) * CELL;
  }

  private lock() {
    const cells: [number, number][] = [];
    for (const [c, r] of ROT[this.kind][this.rot]) {
      const cc = this.px + c, rr = this.py + r;
      if (rr < 0) continue;
      this.board[rr * COLS + cc] = this.kind + 1;
      this.ids[rr * COLS + cc] = this.serial;
      cells.push([cc, rr]);
    }
    this.active = false;
    this.events.push({ t: "lock", sfx: "paddle", kind: this.kind, id: this.serial, cells, x: this.cx(), y: this.cy() });
    const full: number[] = [];
    for (let r = 0; r < ROWS; r++) {
      let n = 0;
      for (let c = 0; c < COLS; c++) if (this.board[r * COLS + c]) n++;
      if (n === COLS) full.push(r);
    }
    if (!full.length) {
      this.spawn();
      return;
    }
    const n = full.length;
    const gained = LINE_SCORE[n] * this.level;
    this.score += gained;
    const kinds = full.map((r) => Array.from(this.board.subarray(r * COLS, r * COLS + COLS)));
    const big = n >= 4;
    this.events.push({
      t: "clear",
      rows: full,
      kinds,
      count: n,
      points: gained,
      sfx: big ? "levelclear" : "brickgone",
      mood: big ? "happy" : undefined,
      shake: big ? 8 : 2 + n,
      x: WELL_X + (COLS * CELL) / 2,
      y: WELL_Y + (full[0] + 0.5) * CELL,
    });
    this.lines += n;
    const lvl = 1 + Math.floor(this.lines / LINES_PER_LEVEL);
    if (lvl > this.level) {
      this.level = lvl;
      this.events.push({ t: "levelup", level: lvl, sfx: "extraGood", toast: "levelClear", mood: "happy" });
    }
    this.clearRows = full;
    this.clearC = CLEAR_FRAMES;
  }

  private collapse() {
    const rows = new Set(this.clearRows);
    let w = ROWS - 1;
    for (let r = ROWS - 1; r >= 0; r--) {
      if (rows.has(r)) continue;
      if (w !== r) {
        for (let c = 0; c < COLS; c++) {
          this.board[w * COLS + c] = this.board[r * COLS + c];
          this.ids[w * COLS + c] = this.ids[r * COLS + c];
        }
      }
      w--;
    }
    for (; w >= 0; w--) {
      for (let c = 0; c < COLS; c++) {
        this.board[w * COLS + c] = 0;
        this.ids[w * COLS + c] = 0;
      }
    }
    this.events.push({ t: "collapse", rows: this.clearRows });
    this.clearRows = [];
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const b = inp.b;
    const pressed = b & ~this.prevB;
    this.prevB = b;

    // Left/right auto-repeat is charged even while rows pop.
    const held = (b & BTN.LEFT ? -1 : 0) + (b & BTN.RIGHT ? 1 : 0);
    const fresh = (held < 0 && pressed & BTN.LEFT) || (held > 0 && pressed & BTN.RIGHT);
    let move = 0;
    let bump = false;
    if (held === 0) {
      this.dasDir = 0;
      this.dasT = 0;
    } else if (fresh || held !== this.dasDir) {
      this.dasDir = held;
      this.dasT = 0;
      move = held;
      bump = true;
    } else {
      this.dasT++;
      if (this.dasT >= DAS_DELAY && (this.dasT - DAS_DELAY) % DAS_REPEAT === 0) move = held;
    }

    if (this.clearC > 0) {
      if (--this.clearC === 0) {
        this.collapse();
        this.spawn();
      }
      return;
    }
    if (!this.active) return;

    if (pressed & BTN.UP) this.turn(1);
    if (pressed & BTN.ALT) this.turn(-1);
    if (move) this.shift(move, bump);

    if (pressed & BTN.FIRE) {
      let d = 0;
      while (fits(this.board, this.kind, this.rot, this.px, this.py + 1)) {
        this.py++;
        d++;
      }
      this.score += 2 * d;
      this.events.push({ t: "harddrop", dist: d, points: 2 * d, kind: this.kind, x: this.cx(), y: this.cy(), shake: d > 4 ? 3 : 1 });
      this.lock();
      return;
    }

    const soft = (b & BTN.DOWN) !== 0;
    const interval = soft ? Math.min(SOFT_INTERVAL, this.gravity()) : this.gravity();
    if (this.grounded()) {
      this.fallC = 0;
      if (++this.lockC >= LOCK_DELAY) this.lock();
      return;
    }
    if (++this.fallC >= interval) {
      this.fallC = 0;
      this.py++;
      if (soft) this.score += 1;
      this.lockC = 0;
      if (this.grounded()) this.events.push({ t: "land" });
    }
  }

  view(): BlocksView {
    const piece = this.active
      ? {
          kind: this.kind,
          rot: this.rot,
          x: this.px,
          y: this.py,
          cells: ROT[this.kind][this.rot].map(([c, r]) => [this.px + c, this.py + r] as [number, number]),
        }
      : null;
    const resting = this.active && this.grounded();
    const interval = (this.prevB & BTN.DOWN) ? Math.min(SOFT_INTERVAL, this.gravity()) : this.gravity();
    return {
      frame: this.frame,
      board: Array.from(this.board),
      ids: Array.from(this.ids),
      piece,
      pieceId: this.serial,
      next: this.queue.slice(0, 2),
      score: this.score,
      level: this.level,
      lines: this.lines,
      clearing: this.clearRows.slice(),
      clearT: this.clearRows.length ? 1 - this.clearC / CLEAR_FRAMES : 0,
      fallT: resting || !this.active ? 0 : Math.min(1, this.fallC / interval),
      lockT: resting ? this.lockC / LOCK_DELAY : 0,
      over: this.over,
      ticker: this.ticker,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level, label: `Rows ${this.lines}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level - 1, levelsCleared: this.level - 1, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

/** Cells of a cluster kind in a rotation (matrix-relative), for renderers. */
export function shapeCells(kind: number, rot = 0): [number, number][] {
  return ROT[kind][rot & 3];
}

// ---- Bot: try every turn and column, keep the flattest stack. ----

interface Plan { rot: number; x: number }

function planFor(board: number[], kind: number): Plan {
  const b = Uint8Array.from(board);
  let best: Plan = { rot: 0, x: (COLS - SIZE[kind]) >> 1 };
  let bestScore = -Infinity;
  for (let rot = 0; rot < 4; rot++) {
    for (let x = -3; x < COLS; x++) {
      if (!fits(b, kind, rot, x, -2)) continue;
      let y = -2;
      while (fits(b, kind, rot, x, y + 1)) y++;
      const t = Uint8Array.from(b);
      let above = false;
      for (const [c, r] of ROT[kind][rot]) {
        if (y + r < 0) above = true;
        else t[(y + r) * COLS + x + c] = 1;
      }
      if (above) continue;
      // Clear rows.
      let cleared = 0;
      const rowsLeft: Uint8Array[] = [];
      for (let r = 0; r < ROWS; r++) {
        const row = t.subarray(r * COLS, r * COLS + COLS);
        if (row.every((v) => v)) cleared++;
        else rowsLeft.push(row);
      }
      const g = new Uint8Array(COLS * ROWS);
      const off = ROWS - rowsLeft.length;
      rowsLeft.forEach((row, i) => g.set(row, (i + off) * COLS));
      // Features.
      let agg = 0, holes = 0, bump = 0, prevH = -1, maxH = 0;
      for (let c = 0; c < COLS; c++) {
        let h = 0;
        let seen = false;
        for (let r = 0; r < ROWS; r++) {
          if (g[r * COLS + c]) {
            if (!seen) { h = ROWS - r; seen = true; }
          } else if (seen) holes++;
        }
        agg += h;
        maxH = Math.max(maxH, h);
        if (prevH >= 0) bump += Math.abs(h - prevH);
        prevH = h;
      }
      const s = -0.51 * agg + 0.76 * cleared - 0.36 * holes * 2 - 0.18 * bump - (maxH > ROWS - 5 ? 2 * maxH : 0);
      // Small preference for nearby columns and fewer turns keeps play tidy.
      const score = s - 0.001 * rot;
      if (score > bestScore) {
        bestScore = score;
        best = { rot, x };
      }
    }
  }
  return best;
}

export const blocks: GameDef<BlocksView> = {
  id: "blocks",
  name: "Block Drop",
  tagline: "Stack the coin clusters, fill a row, watch the coins pop.",
  genre: "Falling-block puzzle",
  session: "2–10 min",
  controls: "Left/Right move, Up turns, X/Shift turns back, Down falls faster, Space drops. Swipe to move, swipe up to turn.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true, touchMap: { tap: BTN.UP, up: BTN.UP, down: BTN.FIRE } },
  maxFrames: 30 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the falling-block genre, written from scratch: own 12x18 jar, round coin clusters including two 3-coin shapes, simple matrix rotation with sideways nudges, no drop preview, own scoring presentation. No code, rotation tables, art, sounds or UI from any commercial game.",
  },
  create: (seed, ctx) => new BlocksEngine(seed, ctx.ticker),
  bot(v, frame) {
    const p = v.piece;
    if (!p || v.over) return { x: 0, y: 0, b: 0 };
    if ((frame & 3) !== 0) return { x: 0, y: 0, b: 0 }; // one press every 4 frames, released in between
    const plan = planFor(v.board, p.kind);
    if (p.rot !== plan.rot) return { x: 0, y: 0, b: ((plan.rot - p.rot + 4) & 3) === 3 ? BTN.ALT : BTN.UP };
    if (p.x < plan.x) return { x: 0, y: 0, b: BTN.RIGHT };
    if (p.x > plan.x) return { x: 0, y: 0, b: BTN.LEFT };
    return { x: 0, y: 0, b: BTN.FIRE };
  },
};
