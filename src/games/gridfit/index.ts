/*
 * Grid Fit: place-the-pieces puzzle on a 9x9 board. Original design for
 * ArcadePad (GPL-3.0-or-later); no code, names or art from any other game.
 *
 * Rules:
 * - Three pieces are offered at a time from a fixed set of original
 *   polyomino shapes (no rotation). Drag one onto the board; it snaps to the
 *   cells. A drop that does not fit sends the piece back to the tray.
 * - Any full row, full column or full 3x3 box clears (sudoku twist). Several
 *   groups at once score more, and consecutive clearing placements build a
 *   combo multiplier (two misses in a row are forgiven, the third resets it).
 * - When all three are placed, three new ones are dealt from the seeded Rng.
 *   Fairness: if none of the three fits but some shape would, one slot is
 *   swapped for a random shape that fits.
 * - Game over when no offered piece fits anywhere.
 *
 * Input: pointer drag (press on a tray piece, move, release over the board),
 * or tap a piece then tap a board cell. Keyboard: LEFT/RIGHT choose a tray
 * piece, FIRE (or UP) lifts it as a ghost on the board, arrows move the
 * ghost, FIRE drops it, ALT puts it back.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const N = 9;
export const FIELD_W = 360;
export const FIELD_H = 600;
export const CELL = 36;
export const BOARD = N * CELL; // 324
export const BOARD_X = (FIELD_W - BOARD) / 2; // 18
export const BOARD_Y = 80;
/** Tray: three slots side by side under the board. */
export const TRAY_Y = 424;
export const TRAY_H = 128;
export const SLOT_W = FIELD_W / 3; // 120
/** Cell size of pieces drawn in the tray. */
export const TRAY_CELL = 20;
/** A dragged piece floats this far above the pointer so a finger doesn't hide it. */
export const LIFT = 48;
/** Pointer travel (px) under which a press+release on a tray piece counts as a tap (select). */
const TAP_DIST = 10;
const MAX_FRAMES = 40 * 60 * 60;
export const COLORS = 6;

// ---------- Shapes ----------

export interface Shape {
  cells: [number, number][]; // [col, row]
  w: number;
  h: number;
  weight: number;
}

function shape(pattern: string, weight: number): Shape {
  const rows = pattern.split("/");
  const cells: [number, number][] = [];
  rows.forEach((row, r) => [...row].forEach((ch, c) => ch === "#" && cells.push([c, r])));
  return { cells, w: Math.max(...rows.map((r) => r.length)), h: rows.length, weight };
}

/** The piece set. Rotations are separate shapes (pieces never rotate). */
export const SHAPES: readonly Shape[] = [
  shape("#", 2),
  shape("##", 3), shape("#/#", 3),
  shape("#./.#", 1), shape(".#/#.", 1), // diagonal pairs
  shape("###", 3), shape("#/#/#", 3),
  shape("##/#.", 2), shape("##/.#", 2), shape("#./##", 2), shape(".#/##", 2),
  shape("####", 2), shape("#/#/#/#", 2),
  shape("##/##", 3),
  shape("###/.#.", 2), shape(".#./###", 2), shape("#./##/#.", 2), shape(".#/##/.#", 2),
  shape("##./.##", 1), shape(".##/##.", 1), shape("#./##/.#", 1), shape(".#/##/#.", 1),
  shape("#####", 1), shape("#/#/#/#/#", 1),
  shape("###/#../#..", 1), shape("###/..#/..#", 1), shape("#../#../###", 1), shape("..#/..#/###", 1),
  shape(".#./###/.#.", 1),
  shape("#.#/###", 1), shape("###/#.#", 1),
  shape("###/###", 1), shape("##/##/##", 1),
];
const TOTAL_WEIGHT = SHAPES.reduce((s, x) => s + x.weight, 0);

// ---------- Pure rules (shared by engine, bot and tests) ----------

/** Board: 81 cells, 0 = empty, else colour + 1. Index r * N + c. */
export type Board = number[];

export function fits(board: readonly number[], s: Shape, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c + s.w > N || r + s.h > N) return false;
  for (const [dc, dr] of s.cells) if (board[(r + dr) * N + c + dc]) return false;
  return true;
}

export function canPlaceAnywhere(board: readonly number[], s: Shape): boolean {
  for (let r = 0; r + s.h <= N; r++) for (let c = 0; c + s.w <= N; c++) if (fits(board, s, c, r)) return true;
  return false;
}

/** Cell indices of group g: 0-8 rows, 9-17 columns, 18-26 boxes. */
export function groupCells(g: number): number[] {
  const out: number[] = [];
  if (g < 9) for (let c = 0; c < N; c++) out.push(g * N + c);
  else if (g < 18) for (let r = 0; r < N; r++) out.push(r * N + (g - 9));
  else {
    const b = g - 18;
    const r0 = Math.floor(b / 3) * 3, c0 = (b % 3) * 3;
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push((r0 + r) * N + c0 + c);
  }
  return out;
}
const GROUPS: number[][] = Array.from({ length: 27 }, (_, g) => groupCells(g));

export function fullGroups(board: readonly number[]): number[] {
  const out: number[] = [];
  for (let g = 0; g < 27; g++) if (GROUPS[g].every((i) => board[i] !== 0)) out.push(g);
  return out;
}

/** Points for clearing n groups at once with combo streak s (s >= 1). */
export function clearPoints(n: number, streak: number): number {
  const base = 20 * n + 10 * n * (n - 1);
  return base * Math.min(10, Math.max(1, streak));
}

// ---------- Engine ----------

export interface TrayPiece {
  shape: number;
  color: number;
  cells: [number, number][];
  w: number;
  h: number;
}

export interface Preview {
  slot: number;
  c: number;
  r: number;
  ok: boolean;
  /** Groups that would clear if dropped here. */
  clears: number[];
}

export interface GridFitView {
  frame: number;
  board: number[];
  tray: (TrayPiece | null)[];
  /** Selected tray slot (keyboard or tap), -1 for none. */
  sel: number;
  /** Keyboard ghost active. */
  placing: boolean;
  /** Pointer drag in progress. */
  drag: { slot: number; x: number; y: number } | null;
  preview: Preview | null;
  /** Last pointer position (field units). */
  px: number;
  py: number;
  /** Keyboard is the current input source. */
  kb: boolean;
  score: number;
  streak: number;
  clears: number;
  moves: number;
  dealId: number;
  lastPlaceFrame: number;
  over: boolean;
}

export function slotAt(x: number, y: number): number {
  if (y < TRAY_Y || y >= TRAY_Y + TRAY_H || x < 0 || x >= FIELD_W) return -1;
  return Math.min(2, Math.floor(x / SLOT_W));
}

export function overBoard(x: number, y: number): boolean {
  return x >= BOARD_X && x < BOARD_X + BOARD && y >= BOARD_Y && y < BOARD_Y + BOARD;
}

/** Board anchor (top-left cell) for a dragged piece whose pointer is at (x, y). */
export function dragAnchor(s: { w: number; h: number }, x: number, y: number): { c: number; r: number } {
  return {
    c: Math.round((x - BOARD_X) / CELL - s.w / 2),
    r: Math.round((y - LIFT - BOARD_Y) / CELL - s.h / 2),
  };
}

/** Pointer position that drops piece s at anchor (c, r) (inverse of dragAnchor). */
export function dropPoint(s: { w: number; h: number }, c: number, r: number): { x: number; y: number } {
  return { x: BOARD_X + (c * 2 + s.w) * (CELL / 2), y: BOARD_Y + (r * 2 + s.h) * (CELL / 2) + LIFT };
}

export function slotCenter(slot: number): { x: number; y: number } {
  return { x: slot * SLOT_W + SLOT_W / 2, y: TRAY_Y + TRAY_H / 2 };
}

const ARROWS = BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT;

export class GridFitEngine implements GameEngine<GridFitView> {
  private rng: Rng;
  board: Board = new Array(N * N).fill(0);
  tray: (TrayPiece | null)[] = [null, null, null];
  private sel = -1;
  private placing = false;
  private gc = 0;
  private gr = 0;
  private drag: { slot: number; sx: number; sy: number } | null = null;
  private prevB = 0;
  private px = 0;
  private py = 0;
  private kb = false;
  private score = 0;
  private streak = 0;
  private misses = 0;
  private clears = 0;
  private moves = 0;
  private dealId = 0;
  private lastPlaceFrame = 0;
  private over = false;
  frame = 0;
  events: GameEvent[] = [];

  /** Tests may pass a start board and/or the first tray's shape indices. */
  constructor(seed: number, board?: number[], trayShapes?: number[]) {
    this.rng = new Rng(seed);
    if (board) this.board = board.slice();
    if (trayShapes) {
      this.tray = [0, 1, 2].map((i) => (trayShapes[i] === undefined ? null : this.piece(trayShapes[i], i % COLORS)));
      this.dealId = 1;
    } else this.deal();
    this.checkOver();
  }

  private piece(shapeIdx: number, color: number): TrayPiece {
    const s = SHAPES[shapeIdx];
    return { shape: shapeIdx, color, cells: s.cells, w: s.w, h: s.h };
  }

  private drawShape(): number {
    let k = this.rng.int(TOTAL_WEIGHT);
    for (let i = 0; i < SHAPES.length; i++) {
      k -= SHAPES[i].weight;
      if (k < 0) return i;
    }
    return 0;
  }

  private deal() {
    const picks = [this.drawShape(), this.drawShape(), this.drawShape()];
    const colors = [this.rng.int(COLORS), this.rng.int(COLORS), this.rng.int(COLORS)];
    // Fairness: at least one placeable piece if any shape can be placed at all.
    if (!picks.some((i) => canPlaceAnywhere(this.board, SHAPES[i]))) {
      const ok: number[] = [];
      for (let i = 0; i < SHAPES.length; i++) if (canPlaceAnywhere(this.board, SHAPES[i])) ok.push(i);
      if (ok.length) picks[this.rng.int(3)] = ok[this.rng.int(ok.length)];
    }
    this.tray = picks.map((s, i) => this.piece(s, colors[i]));
    this.dealId++;
    this.events.push({ t: "deal", sfx: "launch", dealId: this.dealId });
  }

  private checkOver() {
    if (this.tray.some((p) => p && canPlaceAnywhere(this.board, SHAPES[p.shape]))) return;
    this.over = true;
    this.placing = false;
    this.drag = null;
    this.events.push({ t: "gameover", sfx: "gameover", mood: "sad", shake: 6 });
  }

  private firstSlot(from = 0, dir = 1): number {
    for (let k = 0; k < 3; k++) {
      const i = (((from + dir * k) % 3) + 3) % 3;
      if (this.tray[i]) return i;
    }
    return -1;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const b = inp.b;
    const pressed = b & ~this.prevB;
    this.prevB = b;
    if (inp.x !== this.px || inp.y !== this.py) this.kb = false;
    this.px = inp.x;
    this.py = inp.y;
    if (pressed & ARROWS) this.kb = true;

    if (this.drag) {
      if (!(b & BTN.FIRE)) this.drop(inp.x, inp.y);
      return;
    }
    if (pressed & BTN.ALT) {
      if (this.placing) this.placing = false;
      else this.sel = -1;
      return;
    }
    if (pressed & BTN.FIRE) {
      if (this.kb) this.kbFire();
      else this.pointerPress(inp.x, inp.y);
      return;
    }
    if (pressed & ARROWS) this.kbArrows(pressed);
  }

  private kbArrows(pressed: number) {
    if (!this.placing) {
      if (this.sel < 0 || !this.tray[this.sel]) this.sel = this.firstSlot();
      else if (pressed & BTN.LEFT) this.sel = this.firstSlot(this.sel - 1, -1);
      else if (pressed & BTN.RIGHT) this.sel = this.firstSlot(this.sel + 1, 1);
      else if (pressed & BTN.UP) this.lift();
      return;
    }
    const p = this.tray[this.sel];
    if (!p) return;
    if (pressed & BTN.LEFT) this.gc--;
    if (pressed & BTN.RIGHT) this.gc++;
    if (pressed & BTN.UP) this.gr--;
    if (pressed & BTN.DOWN) this.gr++;
    this.gc = Math.max(0, Math.min(N - p.w, this.gc));
    this.gr = Math.max(0, Math.min(N - p.h, this.gr));
  }

  private lift() {
    if (this.sel < 0 || !this.tray[this.sel]) this.sel = this.firstSlot();
    const p = this.tray[this.sel];
    if (!p) return;
    this.placing = true;
    this.gc = (N - p.w) >> 1;
    this.gr = (N - p.h) >> 1;
    this.events.push({ t: "lift", slot: this.sel });
  }

  private kbFire() {
    if (!this.placing) {
      this.lift();
      return;
    }
    const slot = this.sel;
    if (this.tryPlace(slot, this.gc, this.gr)) {
      this.placing = false;
      if (!this.over) this.sel = this.firstSlot(slot + 1, 1);
    }
  }

  private pointerPress(x: number, y: number) {
    const slot = slotAt(x, y);
    if (slot >= 0 && this.tray[slot]) {
      this.drag = { slot, sx: x, sy: y };
      this.placing = false;
      this.sel = slot;
      this.events.push({ t: "lift", slot });
      return;
    }
    // Tap-to-place with a selected piece: centre it on the tapped point.
    const p = this.sel >= 0 ? this.tray[this.sel] : null;
    if (p && overBoard(x, y)) {
      const c = Math.max(0, Math.min(N - p.w, Math.round((x - BOARD_X) / CELL - p.w / 2)));
      const r = Math.max(0, Math.min(N - p.h, Math.round((y - BOARD_Y) / CELL - p.h / 2)));
      if (this.tryPlace(this.sel, c, r)) this.sel = -1;
    }
  }

  private drop(x: number, y: number) {
    const d = this.drag!;
    this.drag = null;
    const p = this.tray[d.slot]!;
    const { c, r } = dragAnchor(p, x, y);
    if (fits(this.board, SHAPES[p.shape], c, r)) {
      this.tryPlace(d.slot, c, r);
      this.sel = -1;
      return;
    }
    if (Math.abs(x - d.sx) + Math.abs(y - d.sy) < TAP_DIST) {
      this.sel = d.slot; // tap: piece stays selected for tap-to-place
      return;
    }
    this.sel = -1;
    this.events.push({ t: "return", slot: d.slot, sfx: "wall", x, y: y - LIFT });
  }

  /** Place tray[slot] at (c, r). Returns false (and bumps) if it does not fit. */
  private tryPlace(slot: number, c: number, r: number): boolean {
    const p = this.tray[slot];
    if (!p) return false;
    const s = SHAPES[p.shape];
    if (!fits(this.board, s, c, r)) {
      this.events.push({ t: "bump", sfx: "wall", x: BOARD_X + (c + s.w / 2) * CELL, y: BOARD_Y + (r + s.h / 2) * CELL });
      return false;
    }
    const placed: number[] = [];
    for (const [dc, dr] of s.cells) {
      const i = (r + dr) * N + c + dc;
      this.board[i] = p.color + 1;
      placed.push(i);
    }
    this.tray[slot] = null;
    this.moves++;
    this.lastPlaceFrame = this.frame;
    this.score += s.cells.length;
    const cx = BOARD_X + (c + s.w / 2) * CELL, cy = BOARD_Y + (r + s.h / 2) * CELL;
    this.events.push({ t: "place", sfx: "paddle", cells: placed, color: p.color, gain: s.cells.length, x: cx, y: cy });

    const groups = fullGroups(this.board);
    if (groups.length) {
      this.streak++;
      this.misses = 0;
      const set = new Set<number>();
      for (const g of groups) for (const i of GROUPS[g]) set.add(i);
      const cells = [...set].sort((a, b) => a - b);
      const colors = cells.map((i) => this.board[i] - 1);
      for (const i of cells) this.board[i] = 0;
      const gain = clearPoints(groups.length, this.streak);
      this.score += gain;
      this.clears += groups.length;
      const n = groups.length;
      this.events.push({
        t: "clear", sfx: n >= 2 ? "explode" : "brickgone", mood: n >= 2 || this.streak >= 3 ? "happy" : undefined,
        shake: 2 + n * 2, groups, cells, colors, gain, streak: this.streak, n, x: cx, y: cy,
        toast: n >= 3 ? "levelClear" : undefined,
      });
      if (this.streak >= 2) this.events.push({ t: "combo", sfx: "extraGood", streak: this.streak, x: cx, y: cy - 20 });
      if (this.board.every((v) => v === 0)) {
        this.score += 300;
        this.events.push({ t: "allclear", sfx: "levelclear", mood: "happy", toast: "levelClear", gain: 300, shake: 8 });
      }
    } else if (++this.misses >= 3) {
      if (this.streak > 0) this.events.push({ t: "comboEnd", streak: this.streak });
      this.streak = 0;
      this.misses = 0;
    }

    if (this.tray.every((t) => !t)) this.deal();
    this.checkOver();
    return true;
  }

  private previewAt(slot: number, c: number, r: number): Preview {
    const p = this.tray[slot]!;
    const s = SHAPES[p.shape];
    const ok = fits(this.board, s, c, r);
    let clears: number[] = [];
    if (ok) {
      const b = this.board.slice();
      for (const [dc, dr] of s.cells) b[(r + dr) * N + c + dc] = 1;
      clears = fullGroups(b);
    }
    return { slot, c, r, ok, clears };
  }

  view(): GridFitView {
    let preview: Preview | null = null;
    if (this.drag) {
      const p = this.tray[this.drag.slot]!;
      const { c, r } = dragAnchor(p, this.px, this.py);
      if (c >= 0 && r >= 0 && c + p.w <= N && r + p.h <= N) preview = this.previewAt(this.drag.slot, c, r);
    } else if (this.placing && this.sel >= 0 && this.tray[this.sel]) {
      preview = this.previewAt(this.sel, this.gc, this.gr);
    }
    return {
      frame: this.frame,
      board: this.board.slice(),
      tray: this.tray.slice(),
      sel: this.sel,
      placing: this.placing,
      drag: this.drag ? { slot: this.drag.slot, x: this.px, y: this.py } : null,
      preview,
      px: this.px,
      py: this.py,
      kb: this.kb,
      score: this.score,
      streak: this.streak,
      clears: this.clears,
      moves: this.moves,
      dealId: this.dealId,
      lastPlaceFrame: this.lastPlaceFrame,
      over: this.over,
    };
  }
  hud(): Hud {
    return { score: this.score, label: this.streak >= 2 ? `Combo x${this.streak}` : `Clears ${this.clears}` };
  }
  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

// ---------- Bot ----------

const hash = (a: number, b: number, c: number, d: number) => {
  let h = Math.imul(a + 0x9e37, 0x85ebca6b) ^ Math.imul(b + 0x7f4a, 0xc2b2ae35);
  h = Math.imul(h ^ (c * 31 + d * 977), 0x27d4eb2f);
  return (h ^ (h >>> 15)) >>> 0;
};

/** Bot choice: best (slot, c, r) by clears, adjacency and some noise. */
export function botPlan(v: GridFitView, onlySlot = -1): { slot: number; c: number; r: number } | null {
  let best: { slot: number; c: number; r: number } | null = null;
  let bestScore = -Infinity;
  for (let slot = 0; slot < 3; slot++) {
    const p = v.tray[slot];
    if (!p || (onlySlot >= 0 && slot !== onlySlot)) continue;
    const s = SHAPES[p.shape];
    for (let r = 0; r + s.h <= N; r++) {
      for (let c = 0; c + s.w <= N; c++) {
        if (!fits(v.board, s, c, r)) continue;
        const b = v.board.slice();
        for (const [dc, dr] of s.cells) b[(r + dr) * N + c + dc] = 1;
        const cl = fullGroups(b).length;
        // Touching filled cells or walls keeps the board tidy.
        let touch = 0;
        for (const [dc, dr] of s.cells) {
          const cc = c + dc, rr = r + dr;
          for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const x = cc + ox, y = rr + oy;
            if (x < 0 || y < 0 || x >= N || y >= N || b[y * N + x]) touch++;
          }
        }
        const sc = cl * 30 + touch * 2 + s.cells.length + (hash(v.moves, slot, c, r) % 22);
        if (sc > bestScore) {
          bestScore = sc;
          best = { slot, c, r };
        }
      }
    }
  }
  return best;
}

const toward = (from: number, to: number, max: number) => from + Math.max(-max, Math.min(max, to - from));
const BOT_SPEED = 14;

export const gridfit: GameDef<GridFitView> = {
  id: "gridfit",
  name: "Grid Fit",
  tagline: "Drop coin blocks on a 9x9 grid. Fill a row, a column or a 3x3 box to cash it out. Chain clears for combos.",
  genre: "Block placement puzzle",
  session: "3–10 min",
  controls:
    "Drag a piece from the tray onto the grid (or tap a piece, then tap a cell). Keys: Left/Right pick a piece, Space lifts it, arrows move it, Space drops, X puts it back.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the block-placement puzzle genre on a 9x9 board with sudoku-style box clears. Own shape set, scoring and art; nothing ported.",
  },
  create: (seed) => new GridFitEngine(seed),
  bot(v, frame) {
    const idle = { x: v.px, y: v.py, b: 0 };
    if (v.over) return idle;
    if (v.drag) {
      const p = v.tray[v.drag.slot]!;
      const plan = botPlan(v, v.drag.slot);
      if (!plan) return { x: v.px, y: v.py, b: 0 }; // nowhere: let go
      const t = dropPoint(p, plan.c, plan.r);
      if (v.px === t.x && v.py === t.y) return { x: t.x, y: t.y, b: 0 }; // release
      return { x: toward(v.px, t.x, BOT_SPEED), y: toward(v.py, t.y, BOT_SPEED), b: BTN.FIRE };
    }
    // Think a moment between moves (longer after a fresh deal).
    if (frame - v.lastPlaceFrame < 18) return idle;
    const plan = botPlan(v);
    if (!plan) return idle;
    const sc = slotCenter(plan.slot);
    if (v.px === sc.x && v.py === sc.y) return { x: sc.x, y: sc.y, b: BTN.FIRE };
    return { x: toward(v.px, sc.x, BOT_SPEED), y: toward(v.py, sc.y, BOT_SPEED), b: 0 };
  },
};
