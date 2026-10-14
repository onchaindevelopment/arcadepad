/*
 * Moon Match: original swap-and-match-3 puzzle for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original implementation of the genre (no code,
 * names or art taken from any commercial game).
 *
 * Rules: 8x8 board of coin tokens in 6 colours. Swap two neighbours; only a
 * swap that makes a line of 3+ is kept (otherwise it swaps back). Lines clear,
 * tokens fall, new ones drop in and cascades raise the combo multiplier.
 *   - a line of 4 leaves a LINE token (clears its row or column when cleared)
 *   - an L/T shape leaves a BLAST token (clears the 3x3 around it)
 *   - a line of 5+ leaves a MOON token (colour bomb: swap it with any
 *     neighbour to clear every token of that colour)
 *   - CLOCK tokens add 5 seconds when cleared
 * Timed run: 60 seconds plus clock bonuses (capped). Cascades running when the
 * clock hits zero still finish and score. A board with no moves reshuffles.
 *
 * Input: pointer drag, tap-tap, or arrows move a cursor + FIRE selects + arrow
 * swaps. Everything is integer frame logic; randomness only from Rng.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const N = 8;
export const COLORS = 6;
export const FIELD_W = 360;
export const FIELD_H = 600;
export const CELL = 42;
export const BOARD_X = (FIELD_W - N * CELL) / 2; // 12
export const BOARD_Y = 124;
export const BOARD_PX = N * CELL; // 336

export const KIND = { NORMAL: 0, LINE_H: 1, LINE_V: 2, BLAST: 3, BOMB: 4 } as const;

export const START_TIME = 60 * 60; // frames
export const CLOCK_BONUS = 5 * 60;
export const BONUS_CAP = 60 * 60; // at most +60 s from clocks per run
export const SWAP_FRAMES = 9;
export const CLEAR_FRAMES = 14;
export const LAND_FRAMES = 4;
export const SHUFFLE_FRAMES = 36;
export const HINT_AFTER = 5 * 60;
const MAX_FRAMES = 150 * 60;
const DRAG_PX = 18;

/** Cells covered after `e` frames of falling (shared with the renderer). */
export function fallCovered(e: number): number {
  return (e * (e + 6)) / 48;
}
/** Frames needed to fall `d` cells. */
export function fallFrames(d: number): number {
  let e = 0;
  while (fallCovered(e) < d) e++;
  return e;
}

export const cellX = (c: number) => BOARD_X + c * CELL;
export const cellY = (r: number) => BOARD_Y + r * CELL;

export interface Tile {
  id: number;
  color: number; // 0..5, -1 for the MOON bomb
  kind: number;
  clock: boolean;
  born: number; // frame the tile appeared (for pop-in of specials)
}

export type Grid = (Tile | null)[];

export interface Move {
  a: number;
  b: number;
  gain: number;
}

export type Phase = "idle" | "swap" | "clear" | "fall" | "shuffle" | "over";

export interface Match3View {
  frame: number;
  phase: Phase;
  /** Frames elapsed in the current phase and its length. */
  pf: number;
  plen: number;
  cells: (Tile | null)[];
  /** Fall start row per cell during "fall" (may be negative). */
  fallFrom: number[];
  /** Cells being cleared during "clear". */
  clearing: number[];
  swap: { a: number; b: number; back: boolean } | null;
  cursor: number;
  selected: number;
  /** True once a key was used: show the keyboard cursor. */
  keyCursor: boolean;
  hint: Move | null;
  moves: Move[];
  timeLeft: number;
  score: number;
  combo: number;
  bestCombo: number;
  over: boolean;
}

// ---------- Pure rules (engine, bot and tests) ----------

interface Run {
  cells: number[];
  horiz: boolean;
}

/** All horizontal/vertical runs of 3+ same-coloured tokens (MOON tokens never match). */
export function findRuns(g: Grid): Run[] {
  const runs: Run[] = [];
  for (let horiz = 1; horiz >= 0; horiz--) {
    for (let a = 0; a < N; a++) {
      let start = 0;
      for (let i = 1; i <= N; i++) {
        const idx = (k: number) => (horiz ? a * N + k : k * N + a);
        const cur = i < N ? g[idx(i)] : null;
        const first = g[idx(start)];
        const same = cur && first && first.color >= 0 && cur.color === first.color;
        if (!same) {
          if (i - start >= 3 && first && first.color >= 0) {
            const cells: number[] = [];
            for (let k = start; k < i; k++) cells.push(idx(k));
            runs.push({ cells, horiz: horiz === 1 });
          }
          start = i;
        }
      }
    }
  }
  return runs;
}

export interface Group {
  cells: number[];
  color: number;
  longest: number;
  longestHoriz: boolean;
  cross: number; // a cell in both a horizontal and a vertical run, or -1
  middle: number; // middle cell of the longest run
}

/** Runs that share cells joined into groups (L/T shapes become one group). */
export function findGroups(g: Grid): Group[] {
  const runs = findRuns(g);
  const owner = new Int16Array(N * N).fill(-1);
  const parent = runs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  runs.forEach((run, i) => {
    for (const c of run.cells) {
      if (owner[c] >= 0) parent[find(i)] = find(owner[c]);
      else owner[c] = i;
    }
  });
  const byRoot = new Map<number, Run[]>();
  runs.forEach((run, i) => {
    const r = find(i);
    const list = byRoot.get(r);
    if (list) list.push(run);
    else byRoot.set(r, [run]);
  });
  const groups: Group[] = [];
  for (const list of byRoot.values()) {
    const set = new Set<number>();
    let longest = list[0];
    const hCells = new Set<number>();
    const vCells = new Set<number>();
    for (const run of list) {
      for (const c of run.cells) {
        set.add(c);
        (run.horiz ? hCells : vCells).add(c);
      }
      if (run.cells.length > longest.cells.length) longest = run;
    }
    let cross = -1;
    for (const c of hCells) if (vCells.has(c)) { cross = c; break; }
    const cells = [...set].sort((a, b) => a - b);
    groups.push({
      cells,
      color: g[cells[0]]!.color,
      longest: longest.cells.length,
      longestHoriz: longest.horiz,
      cross,
      middle: longest.cells[longest.cells.length >> 1],
    });
  }
  groups.sort((a, b) => a.cells[0] - b.cells[0]);
  return groups;
}

export function adjacent(a: number, b: number): boolean {
  const ar = Math.floor(a / N), ac = a % N, br = Math.floor(b / N), bc = b % N;
  return Math.abs(ar - br) + Math.abs(ac - bc) === 1;
}

function countColor(g: Grid, color: number): number {
  let n = 0;
  for (const t of g) if (t && t.color === color) n++;
  return n;
}

/** Every swap that would be kept, with a rough gain (cells cleared before cascades). */
export function findMoves(g: Grid): Move[] {
  const moves: Move[] = [];
  for (let a = 0; a < N * N; a++) {
    const nbrs = [];
    if (a % N < N - 1) nbrs.push(a + 1);
    if (a < N * (N - 1)) nbrs.push(a + N);
    for (const b of nbrs) {
      const ta = g[a], tb = g[b];
      if (!ta || !tb) continue;
      if (ta.kind === KIND.BOMB || tb.kind === KIND.BOMB) {
        const other = ta.kind === KIND.BOMB ? tb : ta;
        moves.push({ a, b, gain: other.kind === KIND.BOMB ? N * N : countColor(g, other.color) + 2 });
        continue;
      }
      if (ta.color === tb.color) continue;
      g[a] = tb;
      g[b] = ta;
      const groups = findGroups(g);
      g[a] = ta;
      g[b] = tb;
      if (!groups.length) continue;
      let gain = 0;
      for (const gr of groups) gain += gr.cells.length + (gr.longest >= 5 ? 6 : gr.cross >= 0 ? 4 : gr.longest === 4 ? 3 : 0);
      moves.push({ a, b, gain });
    }
  }
  return moves;
}

// ---------- Engine ----------

export class Match3Engine implements GameEngine<Match3View> {
  private rng: Rng;
  private grid: Grid = new Array(N * N).fill(null);
  private ids = 0;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private phase: Phase = "idle";
  private pf = 0;
  private plen = 0;
  private fallFrom: number[] = new Array(N * N).fill(0);
  private clearSet: number[] = [];
  private placements: { cell: number; tile: Tile }[] = [];
  private swapInfo: { a: number; b: number; back: boolean } | null = null;
  private swapCells: number[] = [];
  private pending: { a: number; b: number } | null = null;
  private cursor = 3 * N + 3;
  private selected = -1;
  private keyCursor = false;
  private dragging = false;
  private dragX = 0;
  private dragY = 0;
  private idleFrames = 0;
  private moves: Move[] = [];
  private timeLeft = START_TIME;
  private bonusUsed = 0;
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private over = false;
  frame = 0;
  events: GameEvent[] = [];

  /** `layout` (64 colours, -1 = MOON bomb) is for tests; normal runs get a random board without matches. */
  constructor(seed: number, layout?: readonly number[]) {
    this.rng = new Rng(seed);
    if (layout) {
      layout.forEach((c, i) => {
        this.grid[i] = this.tile(c, c < 0 ? KIND.BOMB : KIND.NORMAL, false);
      });
    } else {
      this.fillFresh();
      this.ensureMoves(false);
    }
    this.moves = findMoves(this.grid);
  }

  private tile(color: number, kind: number, clock: boolean): Tile {
    return { id: ++this.ids, color, kind, clock, born: this.frame };
  }

  /** Random board without any ready-made line. */
  private fillFresh() {
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N), c = i % N;
      let color = 0;
      for (let tries = 0; tries < 20; tries++) {
        color = this.rng.int(COLORS);
        const h = c >= 2 && this.grid[i - 1]!.color === color && this.grid[i - 2]!.color === color;
        const v = r >= 2 && this.grid[i - N]!.color === color && this.grid[i - 2 * N]!.color === color;
        if (!h && !v) break;
      }
      this.grid[i] = this.tile(color, KIND.NORMAL, false);
    }
  }

  /** Reshuffle normal tokens until the board has a move and no ready lines. */
  private ensureMoves(announce: boolean): boolean {
    if (findMoves(this.grid).length > 0) return false;
    for (let attempt = 0; attempt < 200; attempt++) {
      if (attempt < 100) {
        const spots: number[] = [];
        for (let i = 0; i < N * N; i++) if (this.grid[i]!.kind === KIND.NORMAL) spots.push(i);
        for (let k = spots.length - 1; k > 0; k--) {
          const j = this.rng.int(k + 1);
          const t = this.grid[spots[k]];
          this.grid[spots[k]] = this.grid[spots[j]];
          this.grid[spots[j]] = t;
        }
      } else {
        this.fillFresh();
      }
      if (findRuns(this.grid).length === 0 && findMoves(this.grid).length > 0) break;
    }
    if (announce) this.events.push({ t: "shuffle", sfx: "launch", x: BOARD_X + BOARD_PX / 2, y: BOARD_Y + BOARD_PX / 2 });
    return true;
  }

  private cellAt(x: number, y: number): number {
    const c = Math.floor((x - BOARD_X) / CELL);
    const r = Math.floor((y - BOARD_Y) / CELL);
    if (c < 0 || c >= N || r < 0 || r >= N) return -1;
    return r * N + c;
  }

  private setPhase(p: Phase, len: number) {
    this.phase = p;
    this.pf = 0;
    this.plen = len;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    this.handleInput(inp);

    if (this.timeLeft > 0) {
      this.timeLeft--;
      if (this.timeLeft > 0 && this.timeLeft <= 5 * 60 && this.timeLeft % 60 === 0) this.events.push({ t: "tick", sfx: "wall", sec: this.timeLeft / 60 });
      if (this.timeLeft === 0) this.events.push({ t: "timeup", sfx: "lost", mood: "sad", shake: 4 });
    }

    if (this.phase === "idle") {
      this.idleFrames++;
      if (this.timeLeft <= 0 || this.frame >= MAX_FRAMES) {
        this.finish();
        return;
      }
      if (this.pending) {
        const { a, b } = this.pending;
        this.pending = null;
        this.trySwap(a, b);
      }
      return;
    }

    this.pf++;
    if (this.pf < this.plen) return;
    if (this.phase === "swap") this.afterSwap();
    else if (this.phase === "clear") this.afterClear();
    else if (this.phase === "fall") this.afterFall();
    else if (this.phase === "shuffle") this.toIdle();
    if (this.frame >= MAX_FRAMES && !this.over) this.finish();
  }

  private finish() {
    this.over = true;
    this.phase = "over";
    this.selected = -1;
    this.events.push({ t: "gameover", sfx: this.score > 0 ? "levelclear" : "gameover", mood: this.score > 0 ? "happy" : "sad", score: this.score });
  }

  private handleInput(inp: Input) {
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    const moved = inp.x !== this.px || inp.y !== this.py;
    this.px = inp.x;
    this.py = inp.y;
    const here = this.cellAt(inp.x, inp.y);
    if (moved && here >= 0 && !this.dragging) {
      this.cursor = here;
      this.keyCursor = false;
    }
    if (this.timeLeft <= 0) {
      this.selected = -1;
      this.dragging = false;
      return;
    }

    // Arrows: swap the selected token, or move the cursor.
    const dirs = [
      [BTN.UP, 0, -1],
      [BTN.DOWN, 0, 1],
      [BTN.LEFT, -1, 0],
      [BTN.RIGHT, 1, 0],
    ];
    for (const [bit, dx, dy] of dirs) {
      if (!(pressed & bit)) continue;
      this.keyCursor = true;
      const from = this.selected >= 0 ? this.selected : this.cursor;
      const c = (from % N) + dx, r = Math.floor(from / N) + dy;
      if (c < 0 || c >= N || r < 0 || r >= N) continue;
      const to = r * N + c;
      if (this.selected >= 0) {
        this.requestSwap(this.selected, to);
        this.selected = -1;
        this.dragging = false;
      } else {
        this.cursor = to;
      }
      break;
    }

    // FIRE (click / tap / Space): select, tap-tap swap, start a drag.
    if (pressed & BTN.FIRE) {
      const target = this.cursor;
      if (this.selected >= 0 && adjacent(this.selected, target)) {
        this.requestSwap(this.selected, target);
        this.selected = -1;
      } else if (this.selected === target) {
        this.selected = -1;
      } else {
        this.selected = target;
        this.events.push({ t: "select", cell: target });
        if (here === target) {
          this.dragging = true;
          this.dragX = inp.x;
          this.dragY = inp.y;
        }
      }
    } else if (!(inp.b & BTN.FIRE)) {
      this.dragging = false;
    } else if (this.dragging && this.selected >= 0 && moved) {
      const dx = inp.x - this.dragX, dy = inp.y - this.dragY;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= DRAG_PX) {
        const horiz = Math.abs(dx) >= Math.abs(dy);
        const c = (this.selected % N) + (horiz ? Math.sign(dx) : 0);
        const r = Math.floor(this.selected / N) + (horiz ? 0 : Math.sign(dy));
        if (c >= 0 && c < N && r >= 0 && r < N) this.requestSwap(this.selected, r * N + c);
        this.selected = -1;
        this.dragging = false;
      }
    }
  }

  private requestSwap(a: number, b: number) {
    if (this.phase === "idle") this.trySwap(a, b);
    else this.pending = { a, b };
  }

  private trySwap(a: number, b: number) {
    const ta = this.grid[a], tb = this.grid[b];
    if (!ta || !tb || !adjacent(a, b)) return;
    this.idleFrames = 0;
    this.grid[a] = tb;
    this.grid[b] = ta;
    const bomb = ta.kind === KIND.BOMB || tb.kind === KIND.BOMB;
    const ok = bomb || findRuns(this.grid).length > 0;
    if (!ok) {
      this.grid[a] = ta;
      this.grid[b] = tb;
      this.swapInfo = { a, b, back: true };
      this.setPhase("swap", SWAP_FRAMES * 2);
      this.events.push({ t: "badswap", sfx: "wall", a, b });
      return;
    }
    // Tokens now sit in their new cells; the view animates from the old ones.
    this.swapInfo = { a, b, back: false };
    this.swapCells = [a, b];
    this.setPhase("swap", SWAP_FRAMES);
    this.events.push({ t: "swap", sfx: "paddle", a, b });
  }

  private afterSwap() {
    const info = this.swapInfo!;
    this.swapInfo = null;
    if (info.back) {
      this.toIdle();
      return;
    }
    this.combo = 1;
    const ta = this.grid[info.a]!, tb = this.grid[info.b]!;
    if (ta.kind === KIND.BOMB || tb.kind === KIND.BOMB) {
      // ta is the token that moved into a; the bomb blows up the other one's colour.
      const bombCell = tb.kind === KIND.BOMB ? info.b : info.a;
      const other = bombCell === info.a ? tb : ta;
      const otherCell = bombCell === info.a ? info.b : info.a;
      const color = other.kind === KIND.BOMB ? -2 : other.color;
      this.startClear([], [{ cell: bombCell, color }], [otherCell]);
    } else {
      this.startClear(findGroups(this.grid), [], []);
    }
  }

  /** Compute the full clear (matches + chained specials), score it and enter "clear". */
  private startClear(groups: Group[], bombs: { cell: number; color: number }[], extra: number[]) {
    const g = this.grid;
    const inSet = new Uint8Array(N * N);
    const set: number[] = [];
    const add = (c: number) => {
      if (!inSet[c] && g[c]) {
        inSet[c] = 1;
        set.push(c);
      }
    };
    this.placements = [];
    const reserved = new Set<number>();
    let bonus = 0;
    for (const gr of groups) {
      for (const c of gr.cells) add(c);
      let kind: number = KIND.NORMAL;
      if (gr.longest >= 5) kind = KIND.BOMB;
      else if (gr.cross >= 0) kind = KIND.BLAST;
      else if (gr.longest === 4) kind = gr.longestHoriz ? KIND.LINE_H : KIND.LINE_V;
      if (kind === KIND.NORMAL) continue;
      let spot = gr.cells.find((c) => this.swapCells.includes(c) && !reserved.has(c)) ?? -1;
      if (spot < 0) spot = kind === KIND.BLAST ? gr.cross : gr.middle;
      if (reserved.has(spot)) spot = gr.cells.find((c) => !reserved.has(c)) ?? -1;
      if (spot < 0) continue;
      reserved.add(spot);
      this.placements.push({ cell: spot, tile: this.tile(kind === KIND.BOMB ? -1 : gr.color, kind, false) });
      bonus += kind === KIND.BOMB ? 150 : kind === KIND.BLAST ? 80 : 50;
      this.events.push({ t: "special", sfx: "extraGood", kind, x: cellX(spot % N) + CELL / 2, y: cellY(Math.floor(spot / N)) + CELL / 2 });
    }
    for (const c of extra) add(c);

    // Chain specials.
    const triggered = new Uint8Array(N * N);
    const fire = (cell: number, forcedColor: number | null) => {
      const t = g[cell];
      if (!t || triggered[cell]) return;
      triggered[cell] = 1;
      add(cell);
      const r = Math.floor(cell / N), c = cell % N;
      const x = cellX(c) + CELL / 2, y = cellY(r) + CELL / 2;
      if (t.kind === KIND.LINE_H) {
        for (let k = 0; k < N; k++) add(r * N + k);
        this.events.push({ t: "line", sfx: "shot", horiz: true, row: r, col: c, x, y, shake: 3 });
      } else if (t.kind === KIND.LINE_V) {
        for (let k = 0; k < N; k++) add(k * N + c);
        this.events.push({ t: "line", sfx: "shot", horiz: false, row: r, col: c, x, y, shake: 3 });
      } else if (t.kind === KIND.BLAST) {
        for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
          const rr = r + dr, cc = c + dc;
          if (rr >= 0 && rr < N && cc >= 0 && cc < N) add(rr * N + cc);
        }
        this.events.push({ t: "blast", sfx: "explode", x, y, shake: 6 });
      } else if (t.kind === KIND.BOMB) {
        const color = forcedColor ?? this.commonColor();
        if (color === -2) {
          for (let k = 0; k < N * N; k++) add(k);
        } else {
          for (let k = 0; k < N * N; k++) if (g[k] && g[k]!.color === color) add(k);
        }
        this.events.push({ t: "bomb", sfx: "explode", mood: "happy", color, x, y, shake: 8 });
      }
    };
    for (const b of bombs) fire(b.cell, b.color);
    for (let i = 0; i < set.length; i++) {
      const t = g[set[i]];
      if (t && t.kind !== KIND.NORMAL) fire(set[i], null);
    }

    // Score.
    let clocks = 0;
    const cleared: { x: number; y: number; color: number; kind: number }[] = [];
    for (const c of set) {
      const t = g[c]!;
      if (t.clock) clocks++;
      cleared.push({ x: cellX(c % N) + CELL / 2, y: cellY(Math.floor(c / N)) + CELL / 2, color: t.color, kind: t.kind });
    }
    const points = (set.length * 10 + bonus) * this.combo;
    this.score += points;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    let cx = 0, cy = 0;
    for (const q of cleared) { cx += q.x; cy += q.y; }
    cx = Math.round(cx / Math.max(1, cleared.length));
    cy = Math.round(cy / Math.max(1, cleared.length));
    this.events.push({
      t: "clear",
      sfx: this.combo >= 3 ? "extraGood" : this.combo === 2 ? "brick" : "brickgone",
      mood: this.combo >= 3 ? "happy" : undefined,
      cells: cleared,
      points,
      combo: this.combo,
      x: cx,
      y: cy,
    });
    if (clocks > 0) {
      const add = Math.min(clocks * CLOCK_BONUS, BONUS_CAP - this.bonusUsed);
      if (add > 0 && this.timeLeft > 0) {
        this.bonusUsed += add;
        this.timeLeft += add;
        this.events.push({ t: "time", sfx: "extraGood", mood: "happy", sec: add / 60, x: cx, y: cy });
      }
    }
    this.clearSet = set;
    this.swapCells = [];
    this.setPhase("clear", CLEAR_FRAMES);
  }

  private commonColor(): number {
    const counts = new Array(COLORS).fill(0);
    for (const t of this.grid) if (t && t.color >= 0) counts[t.color]++;
    let best = 0;
    for (let k = 1; k < COLORS; k++) if (counts[k] > counts[best]) best = k;
    return best;
  }

  private afterClear() {
    const g = this.grid;
    for (const c of this.clearSet) g[c] = null;
    for (const p of this.placements) {
      p.tile.born = this.frame;
      g[p.cell] = p.tile;
    }
    this.clearSet = [];
    this.placements = [];
    // Gravity + refill.
    let maxDist = 0;
    let clocksOnBoard = 0;
    for (const t of g) if (t && t.clock) clocksOnBoard++;
    for (let c = 0; c < N; c++) {
      let w = N - 1;
      for (let r = N - 1; r >= 0; r--) {
        const t = g[r * N + c];
        if (!t) continue;
        g[r * N + c] = null;
        g[w * N + c] = t;
        this.fallFrom[w * N + c] = r;
        if (w - r > maxDist) maxDist = w - r;
        w--;
      }
      const missing = w + 1;
      for (let r = w; r >= 0; r--) {
        const color = this.rng.int(COLORS);
        let clock = false;
        if (clocksOnBoard === 0 && this.bonusUsed < BONUS_CAP && this.timeLeft > 0 && this.rng.int(70) === 0) {
          clock = true;
          clocksOnBoard++;
        }
        g[r * N + c] = this.tile(color, KIND.NORMAL, clock);
        this.fallFrom[r * N + c] = r - missing;
        if (missing > maxDist) maxDist = missing;
      }
    }
    this.setPhase("fall", fallFrames(maxDist) + LAND_FRAMES);
    this.events.push({ t: "fall" });
  }

  private afterFall() {
    this.fallFrom.fill(0);
    for (let i = 0; i < N * N; i++) this.fallFrom[i] = Math.floor(i / N);
    const groups = findGroups(this.grid);
    if (groups.length) {
      this.combo++;
      if (this.combo >= 2) this.events.push({ t: "combo", combo: this.combo, x: BOARD_X + BOARD_PX / 2, y: BOARD_Y - 12 });
      this.startClear(groups, [], []);
      return;
    }
    this.combo = 0;
    if (this.ensureMoves(true)) {
      this.setPhase("shuffle", SHUFFLE_FRAMES);
      return;
    }
    this.toIdle();
  }

  private toIdle() {
    this.phase = "idle";
    this.pf = 0;
    this.plen = 0;
    this.idleFrames = 0;
    this.moves = findMoves(this.grid);
  }

  view(): Match3View {
    return {
      frame: this.frame,
      phase: this.phase,
      pf: this.pf,
      plen: this.plen,
      cells: this.grid.slice(),
      fallFrom: this.fallFrom.slice(),
      clearing: this.clearSet.slice(),
      swap: this.swapInfo,
      cursor: this.cursor,
      selected: this.selected,
      keyCursor: this.keyCursor,
      hint: this.phase === "idle" && this.idleFrames > HINT_AFTER && this.moves.length ? this.moves[0] : null,
      moves: this.phase === "idle" ? this.moves : [],
      timeLeft: this.timeLeft,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      over: this.over,
    };
  }

  hud(): Hud {
    const s = Math.ceil(this.timeLeft / 60);
    return { score: this.score, label: this.combo >= 2 ? `${s}s  x${this.combo}` : `${s}s` };
  }

  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.over ? "over" : "playing" };
  }

  get done() {
    return this.over;
  }
}

const NONE: Input = { x: 0, y: 0, b: 0 };
const centre = (cell: number) => ({ x: cellX(cell % N) + (CELL >> 1), y: cellY(Math.floor(cell / N)) + (CELL >> 1) });

export const match3: GameDef<Match3View> = {
  id: "match3",
  name: "Moon Match",
  tagline: "Swap coins, line up three, chain the cascades. Sixty seconds on the clock.",
  genre: "Swap-and-match puzzle",
  session: "1–2 min",
  controls: "Drag a coin onto a neighbour, or tap two neighbours. Keys: arrows move, Space picks, arrow swaps.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the swap-and-match genre: rules, specials, timing and all art written for ArcadePad. No code, names, art or sounds from any existing game.",
  },
  create: (seed) => new Match3Engine(seed),
  bot(v, frame) {
    // Taps two neighbours. Thinks for a moment, prefers bigger matches but
    // picks semi-randomly among the top few, so it's decent, not perfect.
    if (v.over || v.timeLeft <= 0) return NONE;
    const sel = v.selected;
    if (frame % 3 !== 0) {
      const at = centre(sel >= 0 ? sel : v.cursor);
      return { x: at.x, y: at.y, b: 0 };
    }
    if (v.phase !== "idle" || !v.moves.length) {
      const at = centre(sel >= 0 ? sel : v.cursor);
      return { x: at.x, y: at.y, b: 0 };
    }
    if (sel >= 0) {
      const m = v.moves.find((mv) => mv.a === sel || mv.b === sel);
      const target = m ? (m.a === sel ? m.b : m.a) : sel;
      const at = centre(target);
      return { x: at.x, y: at.y, b: BTN.FIRE };
    }
    if ((frame / 3) % 10 !== 0) return { ...centre(v.cursor), b: 0 };
    const ranked = v.moves.slice().sort((a, b) => b.gain - a.gain || a.a - b.a);
    const pick = ranked[Math.floor(frame / 30) % Math.min(3, ranked.length)];
    const at = centre(pick.a);
    return { x: at.x, y: at.y, b: BTN.FIRE };
  },
};
