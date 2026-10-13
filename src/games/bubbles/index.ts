/*
 * Bubble Pop: an original bubble-shooter for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. No code, levels or assets from any other game.
 *
 * Rules: a hex-packed cluster (offset rows) hangs from a ceiling. The coin's
 * mascot runs a launcher at the bottom; aim (pointer or LEFT/RIGHT), FIRE to
 * shoot. Bubbles bounce off the side walls and snap to the nearest free cell
 * on contact. 3+ connected of one colour pop; bubbles no longer connected to
 * the ceiling drop for a doubling bonus. Every N shots without a pop the
 * ceiling comes down one row; a bubble below the line ends the run. Clearing
 * the board starts the next level with more rows and colours.
 *
 * Determinism: aim is an integer angle in 1/1024 turns (interpolated from the
 * 256-step trig table), flight uses fixed velocity components and only + - *
 * and comparisons, colours come from the seeded Rng.
 */
import { Rng } from "../core/rng.ts";
import { SIN256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const R = 15; // bubble radius
export const COLS = 12; // even rows; odd rows have COLS - 1 and sit R to the right
export const ROW_H = 26; // ~ R * sqrt(3)
export const MAX_ROWS = 22;
export const CEIL_Y0 = 34; // ceiling bar bottom at level start
export const DEATH_Y = 498; // a bubble reaching below this line ends the run
export const LX = W / 2; // launcher
export const LY = 548;
export const AIM_MIN = 29; // ~10 degrees in 1/1024 turns
export const AIM_MAX = 483; // ~170 degrees
export const AIM_UP = 256;
const SUBSTEP = 3; // px per sub-step
const SUBSTEPS = 4; // sub-steps per frame (12 px/frame)
const COLLIDE = 26; // centre distance that counts as contact (a little forgiving)
const KEY_AIM = 3; // aim units per frame while an arrow is held
const RELOAD = 8; // frames after a bubble sticks before the next can fire
const CLEAR_PAUSE = 90;
const MAX_COLOURS = 6;

export type Grid = Int8Array; // MAX_ROWS * COLS, -1 = empty, else colour index

// ---------------------------------------------------------------- geometry

export function rowCols(r: number): number {
  return r & 1 ? COLS - 1 : COLS;
}
export function cellX(r: number, c: number): number {
  return (r & 1 ? 2 * R : R) + c * 2 * R;
}
export function ceilY(ceil: number): number {
  return CEIL_Y0 + ceil * ROW_H;
}
export function cellY(r: number, ceil: number): number {
  return ceilY(ceil) + R + r * ROW_H;
}
export function newGrid(): Grid {
  return new Int8Array(MAX_ROWS * COLS).fill(-1);
}
export function getCell(g: Grid, r: number, c: number): number {
  if (r < 0 || r >= MAX_ROWS || c < 0 || c >= rowCols(r)) return -1;
  return g[r * COLS + c];
}
export function setCell(g: Grid, r: number, c: number, v: number) {
  g[r * COLS + c] = v;
}

/** The six hex neighbours of (r, c) that lie on the board. */
export function neighbours(r: number, c: number): [number, number][] {
  const out: [number, number][] = [];
  const side = r & 1 ? 1 : -1; // odd rows are shifted right
  const cand: [number, number][] = [
    [r, c - 1], [r, c + 1],
    [r - 1, c], [r - 1, c + side],
    [r + 1, c], [r + 1, c + side],
  ];
  for (const [rr, cc] of cand) if (rr >= 0 && rr < MAX_ROWS && cc >= 0 && cc < rowCols(rr)) out.push([rr, cc]);
  return out;
}

/** Interpolated trig for 1/1024-turn angles: index = a/4 in the 256 table. */
function sin1024(a: number): number {
  const i = (a >> 2) & 255;
  const f = (a & 3) / 4;
  return SIN256[i] + (SIN256[(i + 1) & 255] - SIN256[i]) * f;
}
function cos1024(a: number): number {
  return sin1024(a + 256);
}
/** Direction for an aim angle (0 = right, 256 = up, 512 = left); screen y grows down. */
export function aimDir(a: number): { dx: number; dy: number } {
  return { dx: cos1024(a), dy: -sin1024(a) };
}
export function clampAim(a: number): number {
  return a < AIM_MIN ? AIM_MIN : a > AIM_MAX ? AIM_MAX : a;
}

/** Aim angle pointing from the launcher toward a field point (binary search, no atan). */
export function aimFromPointer(px: number, py: number): number {
  const vx = px - LX;
  let vy = LY - py; // up is positive
  if (vy < 1) vy = 1;
  // cross(dir(a), v) = cos(a)*vy - sin(a)*vx decreases as a grows over [0, 512].
  let lo = AIM_MIN, hi = AIM_MAX;
  const f = (a: number) => cos1024(a) * vy - sin1024(a) * vx;
  if (f(lo) <= 0) return lo;
  if (f(hi) >= 0) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (f(mid) >= 0) lo = mid;
    else hi = mid;
  }
  return Math.abs(f(lo)) <= Math.abs(f(hi)) ? lo : hi;
}

// ---------------------------------------------------------------- flight

export interface Flight {
  x: number;
  y: number;
  vx: number; // px per sub-step
  vy: number;
}

export function launch(a: number): Flight {
  const d = aimDir(a);
  return { x: LX, y: LY, vx: d.dx * SUBSTEP, vy: d.dy * SUBSTEP };
}

/** Row/col guesses near a point. */
function nearRow(y: number, ceil: number): number {
  return Math.round((y - ceilY(ceil) - R) / ROW_H);
}
function nearCol(x: number, r: number): number {
  return Math.round((x - (r & 1 ? 2 * R : R)) / (2 * R));
}

/**
 * Advance one sub-step: move, reflect off the side walls, then test the
 * ceiling and nearby bubbles. Returns "wall", "hit" or null.
 */
export function moveFlight(f: Flight, g: Grid, ceil: number): "wall" | "hit" | null {
  f.x += f.vx;
  f.y += f.vy;
  let ev: "wall" | null = null;
  if (f.x < R) {
    f.x = 2 * R - f.x;
    f.vx = -f.vx;
    ev = "wall";
  } else if (f.x > W - R) {
    f.x = 2 * (W - R) - f.x;
    f.vx = -f.vx;
    ev = "wall";
  }
  if (f.y - R <= ceilY(ceil)) return "hit";
  const r0 = nearRow(f.y, ceil);
  for (let r = r0 - 1; r <= r0 + 1; r++) {
    if (r < 0 || r >= MAX_ROWS) continue;
    const c0 = nearCol(f.x, r);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (getCell(g, r, c) < 0) continue;
      const dx = f.x - cellX(r, c);
      const dy = f.y - cellY(r, ceil);
      if (dx * dx + dy * dy < COLLIDE * COLLIDE) return "hit";
    }
  }
  return ev;
}

/** Nearest free cell to a stopped bubble. */
export function snapCell(g: Grid, x: number, y: number, ceil: number): [number, number] {
  const r0 = Math.max(0, nearRow(y, ceil));
  let best: [number, number] = [r0, 0];
  let bestD = Infinity;
  for (let r = Math.max(0, r0 - 1); r <= Math.min(MAX_ROWS - 1, r0 + 1); r++) {
    const c0 = nearCol(x, r);
    for (let c = c0 - 1; c <= c0 + 1; c++) {
      if (c < 0 || c >= rowCols(r) || getCell(g, r, c) >= 0) continue;
      // Below row 0 a cell must touch something, so bubbles never float.
      if (r > 0 && !neighbours(r, c).some(([rr, cc]) => getCell(g, rr, cc) >= 0)) continue;
      const dx = x - cellX(r, c);
      const dy = y - cellY(r, ceil);
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = [r, c];
      }
    }
  }
  if (bestD === Infinity) {
    // Fallback: scan everything (should not happen).
    for (let r = 0; r < MAX_ROWS; r++)
      for (let c = 0; c < rowCols(r); c++) {
        if (getCell(g, r, c) >= 0) continue;
        const dx = x - cellX(r, c);
        const dy = y - cellY(r, ceil);
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = [r, c]; }
      }
  }
  return best;
}

export interface ShotSim {
  r: number;
  c: number;
  /** Polyline: launcher, each wall bounce, end point. */
  path: { x: number; y: number }[];
  bounces: number;
}

/** Fly a shot to where it would stick (does not modify the grid). */
export function simulateShot(g: Grid, ceil: number, a: number): ShotSim {
  const f = launch(a);
  const path = [{ x: f.x, y: f.y }];
  let bounces = 0;
  for (let i = 0; i < 4000; i++) {
    const ev = moveFlight(f, g, ceil);
    if (ev === "wall") {
      bounces++;
      path.push({ x: f.vx > 0 ? R : W - R, y: f.y });
    } else if (ev === "hit") break;
  }
  path.push({ x: f.x, y: f.y });
  const [r, c] = snapCell(g, f.x, f.y, ceil);
  return { r, c, path, bounces };
}

/** Connected cells of the same colour as (r, c), including it. */
export function findMatches(g: Grid, r: number, c: number): [number, number][] {
  const col = getCell(g, r, c);
  if (col < 0) return [];
  const seen = new Uint8Array(MAX_ROWS * COLS);
  const out: [number, number][] = [];
  const stack: [number, number][] = [[r, c]];
  seen[r * COLS + c] = 1;
  while (stack.length) {
    const [rr, cc] = stack.pop()!;
    out.push([rr, cc]);
    for (const [nr, nc] of neighbours(rr, cc)) {
      if (seen[nr * COLS + nc] || getCell(g, nr, nc) !== col) continue;
      seen[nr * COLS + nc] = 1;
      stack.push([nr, nc]);
    }
  }
  return out;
}

/** Bubbles not connected to the ceiling (row 0) through other bubbles. */
export function findOrphans(g: Grid): [number, number][] {
  const seen = new Uint8Array(MAX_ROWS * COLS);
  const stack: [number, number][] = [];
  for (let c = 0; c < COLS; c++) if (getCell(g, 0, c) >= 0) { seen[c] = 1; stack.push([0, c]); }
  while (stack.length) {
    const [r, c] = stack.pop()!;
    for (const [nr, nc] of neighbours(r, c)) {
      if (seen[nr * COLS + nc] || getCell(g, nr, nc) < 0) continue;
      seen[nr * COLS + nc] = 1;
      stack.push([nr, nc]);
    }
  }
  const out: [number, number][] = [];
  for (let r = 0; r < MAX_ROWS; r++) for (let c = 0; c < rowCols(r); c++) if (getCell(g, r, c) >= 0 && !seen[r * COLS + c]) out.push([r, c]);
  return out;
}

/** Score for dropping n orphans: 20, 40, 80 ... each (doubling, capped at 640 each). */
export function dropScore(n: number): number {
  let s = 0;
  for (let i = 0; i < n; i++) s += 20 << Math.min(i, 5);
  return s;
}

/** Outcome of placing colour col at (r, c): popped and dropped counts (grid untouched). */
export function evaluatePlacement(g: Grid, r: number, c: number, col: number): { pop: number; drop: number; same: number } {
  const t = new Int8Array(g);
  setCell(t, r, c, col);
  const m = findMatches(t, r, c);
  if (m.length < 3) return { pop: 0, drop: 0, same: m.length - 1 };
  for (const [rr, cc] of m) setCell(t, rr, cc, -1);
  return { pop: m.length, drop: findOrphans(t).length, same: m.length - 1 };
}

// ---------------------------------------------------------------- engine

export interface Cell { r: number; c: number; x: number; y: number; col: number }

export interface BubblesView {
  frame: number;
  grid: Grid;
  ceil: number;
  aim: number;
  cur: number;
  next: number;
  flight: { x: number; y: number; col: number } | null;
  /** True when FIRE would shoot now. */
  ready: boolean;
  shotsLeft: number; // shots until the ceiling drops
  shotsPerDrop: number;
  colours: number;
  level: number;
  score: number;
  over: boolean;
  clearing: boolean;
}

class BubblesEngine implements GameEngine<BubblesView> {
  private rng: Rng;
  private grid = newGrid();
  private ceil = 0;
  private aim = AIM_UP;
  private cur = 0;
  private next = 0;
  private flight: (Flight & { col: number }) | null = null;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private reload = 0;
  private miss = 0; // shots since the last pop
  private level = 0;
  private cleared = 0;
  private colours = 4;
  private score = 0;
  private over = false;
  private clearT = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.buildLevel();
  }

  private shotsPerDrop() {
    return Math.max(3, 8 - this.level);
  }

  private buildLevel() {
    const L = this.level;
    this.colours = Math.min(MAX_COLOURS, L === 0 ? 4 : L < 4 ? 5 : 6);
    const rows = Math.min(10, 5 + L);
    this.grid = newGrid();
    this.ceil = 0;
    this.miss = 0;
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < rowCols(r); c++) {
        let col = this.rng.int(this.colours);
        // Clump: copy a neighbour above or to the left; less clumpy each level.
        const roll = this.rng.int(100);
        const clump = Math.max(12, 50 - 4 * L);
        if (roll < clump >> 1 && c > 0) col = getCell(this.grid, r, c - 1);
        else if (roll < clump && r > 0) {
          const up = getCell(this.grid, r - 1, c);
          if (up >= 0) col = up;
        }
        setCell(this.grid, r, c, col);
      }
    this.cur = this.pickColour();
    this.next = this.pickColour();
  }

  private present(): number[] {
    const seen = new Array(MAX_COLOURS).fill(false);
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i] >= 0) seen[this.grid[i]] = true;
    const out: number[] = [];
    for (let k = 0; k < MAX_COLOURS; k++) if (seen[k]) out.push(k);
    return out;
  }
  private pickColour(): number {
    const p = this.present();
    if (!p.length) return this.rng.int(this.colours);
    return p[this.rng.int(p.length)];
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    if (this.clearT > 0) {
      if (--this.clearT === 0) this.buildLevel();
      this.px = inp.x; this.py = inp.y;
      return;
    }

    // Aim: arrows rotate; otherwise follow the pointer when it moves.
    if (inp.b & BTN.LEFT) this.aim = clampAim(this.aim + KEY_AIM);
    if (inp.b & BTN.RIGHT) this.aim = clampAim(this.aim - KEY_AIM);
    const moved = this.frame > 1 && (inp.x !== this.px || inp.y !== this.py);
    if (!(inp.b & (BTN.LEFT | BTN.RIGHT)) && moved && inp.y < LY - 4) this.aim = aimFromPointer(inp.x, inp.y);
    this.px = inp.x; this.py = inp.y;

    if (pressed & (BTN.ALT | BTN.DOWN) && !this.flight) {
      const t = this.cur; this.cur = this.next; this.next = t;
      this.events.push({ t: "swap" });
    }

    if (this.reload > 0) this.reload--;
    if (pressed & (BTN.FIRE | BTN.UP) && !this.flight && this.reload === 0) {
      this.flight = { ...launch(this.aim), col: this.cur };
      this.cur = this.next;
      this.next = this.pickColour();
      this.events.push({ t: "shot", sfx: "shot", x: LX, y: LY });
    }

    if (this.flight) this.fly();
  }

  private fly() {
    const f = this.flight!;
    for (let i = 0; i < SUBSTEPS; i++) {
      const ev = moveFlight(f, this.grid, this.ceil);
      if (ev === "wall") this.events.push({ t: "wall", sfx: "wall", x: f.x, y: f.y });
      else if (ev === "hit") {
        this.stick(f);
        return;
      }
    }
  }

  private cellInfo(r: number, c: number): Cell {
    return { r, c, x: cellX(r, c), y: cellY(r, this.ceil), col: getCell(this.grid, r, c) };
  }

  private stick(f: Flight & { col: number }) {
    this.flight = null;
    this.reload = RELOAD;
    const [r, c] = snapCell(this.grid, f.x, f.y, this.ceil);
    setCell(this.grid, r, c, f.col);
    this.events.push({ t: "stick", sfx: "paddle", x: cellX(r, c), y: cellY(r, this.ceil), r, c, col: f.col });

    const m = findMatches(this.grid, r, c);
    if (m.length >= 3) {
      this.miss = 0;
      const cells = m.map(([rr, cc]) => this.cellInfo(rr, cc));
      for (const [rr, cc] of m) setCell(this.grid, rr, cc, -1);
      const pts = 10 * m.length;
      this.score += pts;
      this.events.push({ t: "pop", sfx: "brickgone", cells, n: m.length, pts, x: cellX(r, c), y: cellY(r, this.ceil) });
      if (m.length >= 6) this.events.push({ t: "bigpop", sfx: "extraGood", mood: "happy", x: cellX(r, c), y: cellY(r, this.ceil) });
      const orphans = findOrphans(this.grid);
      if (orphans.length) {
        const dcells = orphans.map(([rr, cc]) => this.cellInfo(rr, cc));
        for (const [rr, cc] of orphans) setCell(this.grid, rr, cc, -1);
        const bonus = dropScore(orphans.length);
        this.score += bonus;
        let sx = 0, sy = 0;
        for (const d of dcells) { sx += d.x; sy += d.y; }
        this.events.push({
          t: "drop", sfx: orphans.length >= 4 ? "explode" : "brick", shake: Math.min(6, orphans.length),
          cells: dcells, n: orphans.length, bonus, x: Math.round(sx / dcells.length), y: Math.round(sy / dcells.length),
        });
      }
      if (this.present().length === 0) {
        const bonus = 500 + 250 * this.level;
        this.score += bonus;
        this.cleared++;
        this.level++;
        this.clearT = CLEAR_PAUSE;
        this.events.push({ t: "levelclear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus, x: W / 2, y: H / 2 });
        return;
      }
    } else {
      this.miss++;
      if (this.miss >= this.shotsPerDrop()) {
        this.miss = 0;
        this.ceil++;
        this.events.push({ t: "ceiling", sfx: "extraBad", shake: 4, y: ceilY(this.ceil) });
      }
    }
    // Keep the loaded bubbles to colours still on the board.
    const p = this.present();
    if (!p.includes(this.cur)) this.cur = this.pickColour();
    if (!p.includes(this.next)) this.next = this.pickColour();
    if (this.lowest() + R > DEATH_Y) {
      this.over = true;
      this.events.push({ t: "lost", sfx: "lost", mood: "sad", shake: 8, x: W / 2, y: DEATH_Y });
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  private lowest(): number {
    for (let r = MAX_ROWS - 1; r >= 0; r--)
      for (let c = 0; c < rowCols(r); c++) if (getCell(this.grid, r, c) >= 0) return cellY(r, this.ceil);
    return 0;
  }

  view(): BubblesView {
    return {
      frame: this.frame,
      grid: this.grid,
      ceil: this.ceil,
      aim: this.aim,
      cur: this.cur,
      next: this.next,
      flight: this.flight ? { x: this.flight.x, y: this.flight.y, col: this.flight.col } : null,
      ready: !this.flight && this.reload === 0 && this.clearT === 0 && !this.over,
      shotsLeft: this.shotsPerDrop() - this.miss,
      shotsPerDrop: this.shotsPerDrop(),
      colours: this.colours,
      level: this.level,
      score: this.score,
      over: this.over,
      clearing: this.clearT > 0,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level + 1, label: `Drop in ${this.shotsPerDrop() - this.miss}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.cleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

// ---------------------------------------------------------------- bot

/** Pointer point the bot uses for an angle (and the angle the engine derives from it). */
function pointFor(a: number): { x: number; y: number; a: number } {
  const d = aimDir(a);
  const x = Math.round(LX + d.dx * 300);
  const y = Math.round(LY + d.dy * 300);
  return { x, y, a: aimFromPointer(x, y) };
}

/** Best shot for the loaded colour: simulate a fan of angles and score the landing. */
export function planShot(v: BubblesView): { x: number; y: number; a: number } {
  let best = pointFor(AIM_UP);
  let bestS = -Infinity;
  for (let a = AIM_MIN; a <= AIM_MAX; a += 6) {
    const p = pointFor(a);
    const sim = simulateShot(v.grid, v.ceil, p.a);
    const e = evaluatePlacement(v.grid, sim.r, sim.c, v.cur);
    let s = e.pop ? 100 + e.pop * 10 + dropScore(e.drop) : e.same * 15;
    s -= sim.r * 2 + sim.bounces * 3; // prefer high, simple shots
    if (s > bestS) {
      bestS = s;
      best = p;
    }
  }
  return best;
}

export const bubbles: GameDef<BubblesView> = {
  id: "bubbles",
  name: "Bubble Pop",
  tagline: "Aim, bank, pop three. Cut the cluster loose before the ceiling comes down.",
  genre: "Bubble shooter",
  session: "3–10 min",
  controls: "Aim with mouse/touch or Left/Right, click/tap/Space to shoot, Down or X to swap.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 15 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the bubble-shooter genre (hex grid, wall bounces, match-3 pops, orphan drops, dropping ceiling). No code, levels, art or sounds from any commercial or open-source game.",
  },
  create: (seed) => new BubblesEngine(seed),
  bot(v, frame) {
    if (!v.ready) return { x: LX, y: 200, b: 0 };
    const p = planShot(v);
    return { x: p.x, y: p.y, b: frame & 1 ? 0 : BTN.FIRE };
  },
};
