/*
 * Moon Slope: an original endless downhill rolling-ball game in pseudo-3D.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Original design (credits.basedOn = "Original"): no code, names or art from
 * any existing rolling-ball game. The engine works in "world units": the
 * track is COLS tiles wide (1 unit each, x in [-HALF, HALF]) and made of rows
 * ROW_LEN units long along z. Each row stores one cell kind per column
 * (hole, floor, ramp, block), its start/end elevation and side-wall flags.
 *
 * Physics (only + - * / and Math.sqrt): the ball (radius R, y = contact point)
 * rolls downhill, accelerating continuously; steering changes vx with a
 * limited acceleration (inertia). A grounded ball follows the surface until
 * the surface drops away faster than gravity would pull it (crests and ramp
 * lips launch it); an airborne ball lands on floor cells and falls through
 * holes. Running into the front of a block or falling below the track ends
 * the run; grazing a block's side or a side wall bounces.
 *
 * Fairness: the generator walks a "safe path" column with a lateral rate
 * limit tied to speed and keeps every cell within a window of that path
 * open, so a passable line always exists. Ramp gaps are sized from the
 * launch arc at the current speed with full-width landing zones.
 * Score = floor(distance) + coins x 10.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- field / world
export const FIELD_W = 360;
export const FIELD_H = 600;
export const COLS = 7;
export const HALF = COLS / 2;
export const ROW_LEN = 2;
export const R = 0.35; // ball radius

export const HOLE = 0;
export const FLOOR = 1;
export const RAMP = 2;
export const BLOCK = 3;

export const RAMP_H = 0.5;
export const BLOCK_H = 0.9;
export const BLOCK_HW = 0.42;
/** Block z extent inside its row. */
export const BLOCK_Z0 = 0.5;
export const BLOCK_Z1 = 1.5;
/** Baseline downhill slope (elevation change per unit of z). */
export const BASE_SLOPE = -0.08;

// ---------------------------------------------------------------- physics (per 1/60 s frame)
export const G = 0.01;
export const LAUNCH_V = 0.17;
export const MAX_VX = 0.12;
export const STEER_ACC = 0.012;
const AIR_ACC = 0.006;
const FRICTION = 0.93;
const SIDE_HIT = R * 0.8; // forgiving horizontal radius against blocks
const LAND_TOL = 0.3;
const FALL_DEPTH = 0.7;

export const START_SPEED = 0.2;
const ACCEL = 0.00004;
export const MAX_SPEED = 0.55;

// ---------------------------------------------------------------- track
export const SPAWN_AHEAD = 160;
const KEEP_BEHIND = 12;
const MILESTONE = 500;
const MAX_FRAMES = 15 * 60 * 60;
const Z0 = 1;
/** Frames the generator budgets for the ball to move one column sideways. */
export const SHIFT_FRAMES = 24;

export interface Row {
  i: number; // global row index; covers z in [i*ROW_LEN, (i+1)*ROW_LEN)
  cells: number[]; // COLS cell kinds
  e0: number; // elevation at the row start
  e1: number; // elevation at the row end
  wallL: boolean;
  wallR: boolean;
}
export interface Coin { id: number; x: number; z: number; h: number }
export interface Chunk { kind: string; rows: Row[]; coins: Coin[] }

export const colX = (c: number) => c - HALF + 0.5;
export const isSafe = (k: number) => k === FLOOR || k === RAMP;
export function difficulty(speed: number): number {
  return Math.min(1, Math.max(0, (speed - START_SPEED) / (MAX_SPEED - START_SPEED)));
}
/** Rows the generator allows per one-column path shift at this speed. */
export function shiftRows(speed: number, frames = SHIFT_FRAMES): number {
  return Math.max(1, Math.ceil((frames * speed) / ROW_LEN));
}
/** Airtime (frames) of a ramp launch landing `drop` below the ramp lip. */
export function flightFrames(drop: number): number {
  return (LAUNCH_V + Math.sqrt(LAUNCH_V * LAUNCH_V + 2 * G * drop)) / G;
}
/** Shortest flight (flat landing) and a generous longest one (downhill landing). */
export const FLIGHT_MIN = flightFrames(RAMP_H);
export const FLIGHT_MAX = flightFrames(RAMP_H + 2.5);
/** Ground elevation of a row at z (no ramp). */
export function rowElev(row: Row, z: number): number {
  const f = (z - row.i * ROW_LEN) / ROW_LEN;
  return row.e0 + (row.e1 - row.e0) * f;
}

/**
 * Deterministic track generator: chunks of rows built around a rate-limited
 * safe path. Every cell in the path's +-K row window stays floor, so the path
 * column and the column it shifts to are both open for 2K rows around a shift.
 */
export class TrackGen {
  rng: Rng;
  row = 0;
  e = 0;
  pc = 3;
  chunks = 0;
  private coinId = 1;

  constructor(seed: number) {
    this.rng = new Rng((seed ^ 0x51a9e0b7) >>> 0);
  }

  private push(c: Chunk, cells: number[], slope: number, walls = false) {
    const e0 = this.e;
    const e1 = e0 + slope * ROW_LEN;
    this.e = e1;
    c.rows.push({ i: this.row++, cells, e0, e1, wallL: walls && cells[0] !== HOLE, wallR: walls && cells[COLS - 1] !== HOLE });
  }

  private full(kind = FLOOR): number[] {
    return new Array(COLS).fill(kind);
  }

  /** Path columns for n rows; shifts by one column at most once per 2K rows, never within K of the ends. */
  private path(n: number, K: number, shiftP: number): number[] {
    const p: number[] = [];
    let c = this.pc;
    let last = -Infinity;
    for (let i = 0; i < n; i++) {
      if (i >= K && i <= n - K && i - last >= 2 * K && this.rng.int(100) < shiftP) {
        let d = this.rng.int(2) ? 1 : -1;
        if (c + d < 0 || c + d >= COLS) d = -d;
        c += d;
        last = i;
      }
      p.push(c);
    }
    this.pc = c;
    return p;
  }

  private keep(p: number[], K: number): number[][] {
    const out: number[][] = [];
    for (let i = 0; i < p.length; i++) {
      const s: number[] = [];
      for (let j = Math.max(0, i - K); j <= Math.min(p.length - 1, i + K); j++) if (!s.includes(p[j])) s.push(p[j]);
      out.push(s);
    }
    return out;
  }

  private coinRun(c: Chunk, rowIdx: number, col: number, n: number) {
    for (let k = 0; k < n; k++) c.coins.push({ id: this.coinId++, x: colX(col), z: (rowIdx + k) * ROW_LEN + 1, h: 0.45 + R });
  }

  /** Generate the next chunk for the current speed. */
  chunk(speed: number): Chunk {
    const d = difficulty(speed);
    const K = shiftRows(speed);
    const c: Chunk = { kind: "plain", rows: [], coins: [] };
    let kind = "plain";
    if (this.chunks >= 2) {
      const w = [18, 20, 20, 12 + 10 * d, 14, 10 + 12 * d];
      const names = ["plain", "holes", "blocks", "bridge", "ramp", "gates"];
      let roll = this.rng.int(Math.floor(w.reduce((a, b) => a + b, 0)));
      for (let i = 0; i < w.length; i++) {
        roll -= Math.floor(w[i]);
        if (roll < 0) {
          kind = names[i];
          break;
        }
      }
    }
    c.kind = kind;
    const startRow = this.row;
    if (kind === "plain") this.plain(c, d);
    else if (kind === "ramp") this.ramp(c, speed);
    else {
      const n = Math.max(2 * K + 4, 8 + this.rng.int(8) + Math.floor(6 * d));
      const p = this.path(n, K, kind === "bridge" || kind === "gates" ? 75 : 55);
      const keep = this.keep(p, K);
      if (kind === "holes") this.holes(c, n, keep, d);
      else if (kind === "blocks") this.blocks(c, n, keep, d);
      else if (kind === "bridge") this.bridge(c, n, keep, d);
      else this.gates(c, n, keep, d);
      // Coins along the safe path.
      if (this.rng.int(2)) {
        const at = this.rng.int(Math.max(1, n - 5));
        for (let k = at; k < Math.min(n, at + 4); k++) {
          if (keep[k].length === 1) this.coinRun(c, startRow + k, keep[k][0], 1);
        }
      }
    }
    this.chunks++;
    return c;
  }

  private plain(c: Chunk, d: number) {
    const walls = this.chunks === 0 || this.rng.int(2) === 0;
    const v = this.chunks < 2 ? 0 : this.rng.int(3); // 0 flat, 1 dip, 2 bump
    const slopes: number[] = [];
    if (v === 0) for (let i = 0; i < (this.chunks === 0 ? 16 : 6 + this.rng.int(5)); i++) slopes.push(BASE_SLOPE);
    else if (v === 1) {
      slopes.push(BASE_SLOPE, BASE_SLOPE);
      const n = 3 + this.rng.int(3);
      for (let i = 0; i < n; i++) slopes.push(BASE_SLOPE - 0.14);
      for (let i = 0; i < 6; i++) slopes.push(BASE_SLOPE);
    } else {
      slopes.push(BASE_SLOPE, BASE_SLOPE);
      for (let i = 0; i < 3; i++) slopes.push(BASE_SLOPE + 0.18);
      for (let i = 0; i < 3; i++) slopes.push(BASE_SLOPE - 0.1);
      for (let i = 0; i < 10; i++) slopes.push(BASE_SLOPE);
    }
    const first = this.row;
    for (const s of slopes) this.push(c, this.full(), s, walls);
    if (this.chunks > 0 && this.rng.int(3)) {
      const col = Math.max(1, Math.min(COLS - 2, this.pc + this.rng.int(3) - 1));
      this.coinRun(c, first + 1, col, Math.min(5, slopes.length - 2));
    }
    void d;
  }

  private holes(c: Chunk, n: number, keep: number[][], d: number) {
    const cols: number[][] = [];
    for (let col = 0; col < COLS; col++) {
      const run: number[] = [];
      let hole = this.rng.int(2) === 0;
      while (run.length < n) {
        const len = hole ? 1 + this.rng.int(2 + Math.floor(3 * d)) : 1 + this.rng.int(3);
        for (let k = 0; k < len && run.length < n; k++) run.push(hole ? HOLE : FLOOR);
        hole = !hole;
      }
      cols.push(run);
    }
    const walls = this.rng.int(3) === 0;
    for (let i = 0; i < n; i++) {
      const cells = cols.map((r) => r[i]);
      for (const k of keep[i]) cells[k] = FLOOR;
      this.push(c, cells, BASE_SLOPE, walls);
    }
  }

  private blocks(c: Chunk, n: number, keep: number[][], d: number) {
    const walls = this.rng.int(2) === 0;
    const every = 2 + this.rng.int(2);
    for (let i = 0; i < n; i++) {
      const cells = this.full();
      if (i % every === 1) {
        const m = 1 + this.rng.int(2 + Math.floor(3 * d));
        for (let k = 0; k < m; k++) cells[this.rng.int(COLS)] = BLOCK;
        if (d > 0.3 && this.rng.int(4) === 0) cells[this.rng.int(COLS)] = HOLE;
      }
      for (const k of keep[i]) cells[k] = FLOOR;
      this.push(c, cells, BASE_SLOPE, walls);
    }
  }

  private bridge(c: Chunk, n: number, keep: number[][], d: number) {
    const width = d > 0.5 || this.rng.int(2) ? 2 : 3;
    let side = this.rng.int(2) ? 1 : -1;
    // Edge railing blocks every few rows on wide bridges, for flavour.
    for (let i = 0; i < n; i++) {
      const cells = this.full(HOLE);
      const ks = keep[i];
      let lo = Math.min(...ks), hi = Math.max(...ks);
      while (hi - lo + 1 < width) {
        if (side > 0 ? hi + 1 < COLS : lo - 1 < 0) hi++;
        else lo--;
        side = -side;
      }
      for (let k = lo; k <= hi; k++) cells[k] = FLOOR;
      this.push(c, cells, BASE_SLOPE, false);
    }
  }

  private gates(c: Chunk, n: number, keep: number[][], d: number) {
    const every = 3 + this.rng.int(2);
    for (let i = 0; i < n; i++) {
      const cells = this.full();
      if (i % every === 2) {
        cells.fill(BLOCK);
        const ks = keep[i];
        for (const k of ks) cells[k] = FLOOR;
        if (ks.length === 1) {
          const k = ks[0];
          const nb = k === 0 ? 1 : k === COLS - 1 ? COLS - 2 : k + (this.rng.int(2) ? 1 : -1);
          cells[nb] = FLOOR;
          const other = k + (nb > k ? -1 : 1);
          if (d < 0.3 && other >= 0 && other < COLS) cells[other] = FLOOR;
        }
      }
      this.push(c, cells, BASE_SLOPE, true);
    }
  }

  private ramp(c: Chunk, speed: number) {
    for (let i = 0; i < 3; i++) this.push(c, this.full(), BASE_SLOPE);
    const rampRow = this.row;
    this.push(c, this.full(RAMP), BASE_SLOPE);
    const zEnd = (rampRow + 1) * ROW_LEN;
    const gap = Math.max(1, Math.floor((FLIGHT_MIN * speed - 1) / ROW_LEN));
    for (let i = 0; i < gap; i++) this.push(c, this.full(HOLE), BASE_SLOPE);
    const zMax = zEnd + FLIGHT_MAX * (speed + 0.03) + 3;
    while (this.row * ROW_LEN < zMax) this.push(c, this.full(), BASE_SLOPE);
    // Coins along the launch arc above the path column.
    const x = colX(this.pc);
    const steps = 5;
    for (let k = 1; k <= steps; k++) {
      const t = (FLIGHT_MIN * k) / (steps + 1);
      const h = RAMP_H + LAUNCH_V * t - (G * t * t) / 2 - BASE_SLOPE * speed * t + R;
      c.coins.push({ id: this.coinId++, x, z: zEnd + speed * t, h });
    }
  }
}

// ---------------------------------------------------------------- view
export interface SlopeView {
  frame: number;
  dist: number; // distance travelled
  z: number; // ball centre z
  x: number;
  y: number; // ball contact point height (centre = y + R)
  vx: number;
  vy: number;
  speed: number;
  grounded: boolean;
  /** Elevation of the track under the ball's z (ignoring ramps/holes). */
  elev: number;
  rows: Row[];
  coins: Coin[];
  score: number;
  coinCount: number;
  dead: boolean;
  crash: { kind: "block" | "fall"; x: number; z: number } | null;
}

export interface SlopeOptions {
  /** Tests: a fixed track instead of generated chunks (row index -> Row). */
  track?: (i: number) => Row;
}

export class SlopeEngine implements GameEngine<SlopeView> {
  readonly gen: TrackGen;
  private custom?: (i: number) => Row;
  rows: Row[] = [];
  private rowBase = 0;
  private nextRow = 0;
  coins: Coin[] = [];
  x = 0;
  z = Z0;
  y = 0;
  vx = 0;
  vy = 0;
  speed = START_SPEED;
  grounded = true;
  private onRamp = false;
  private pointerMode = false;
  private prevX = FIELD_W / 2;
  coinCount = 0;
  private nextMilestone = MILESTONE;
  private dead = false;
  private timeUp = false;
  private crash: SlopeView["crash"] = null;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, opts: SlopeOptions = {}) {
    this.gen = new TrackGen(seed);
    this.custom = opts.track;
    this.fill();
    this.y = this.groundAt(this.x, this.z);
  }

  get dist() {
    return this.z - Z0;
  }
  private get score() {
    return Math.floor(this.dist) + this.coinCount * 10;
  }

  private fill() {
    const need = this.z + SPAWN_AHEAD;
    if (this.custom) {
      while (this.nextRow * ROW_LEN < need) this.rows.push(this.custom(this.nextRow++));
      return;
    }
    while (this.gen.row * ROW_LEN < need) {
      const c = this.gen.chunk(this.speed);
      for (const r of c.rows) this.rows.push(r);
      for (const k of c.coins) this.coins.push(k);
    }
  }

  rowAt(z: number): Row | undefined {
    return this.rows[Math.floor(z / ROW_LEN) - this.rowBase];
  }
  private cellAt(x: number, row: Row | undefined): number {
    if (!row) return HOLE;
    const col = Math.floor(x + HALF);
    return col < 0 || col >= COLS ? HOLE : row.cells[col];
  }
  elevAt(z: number): number {
    const row = this.rowAt(z);
    return row ? rowElev(row, z) : 0;
  }
  /** Surface height under (x, z); -Infinity over a hole or off the edge. */
  groundAt(x: number, z: number): number {
    const row = this.rowAt(z);
    const k = this.cellAt(x, row);
    if (k === HOLE || !row) return -Infinity;
    const g = rowElev(row, z);
    return k === RAMP ? g + (RAMP_H * (z - row.i * ROW_LEN)) / ROW_LEN : g;
  }
  private slopeAt(x: number, z: number): number {
    const row = this.rowAt(z);
    if (!row) return 0;
    const s = (row.e1 - row.e0) / ROW_LEN;
    return this.cellAt(x, row) === RAMP ? s + RAMP_H / ROW_LEN : s;
  }

  private die(kind: "block" | "fall") {
    this.dead = true;
    this.crash = { kind, x: this.x, z: this.z };
    this.events.push({ t: kind === "block" ? "crash" : "fall", sfx: "lost", mood: "sad", shake: kind === "block" ? 12 : 8, toast: "lifeLost", kind });
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.done) return;

    // ---- steering
    if (inp.x !== this.prevX) this.pointerMode = true;
    this.prevX = inp.x;
    const arrows = inp.b & (BTN.LEFT | BTN.RIGHT);
    let want: number | null = null;
    if (arrows) {
      this.pointerMode = false;
      const dir = (arrows & BTN.RIGHT ? 1 : 0) - (arrows & BTN.LEFT ? 1 : 0);
      want = dir * MAX_VX;
    } else if (this.pointerMode) {
      const tx = ((inp.x - FIELD_W / 2) * (2 * HALF + 0.6)) / FIELD_W;
      want = Math.max(-MAX_VX, Math.min(MAX_VX, (tx - this.x) * 0.12));
    }
    const acc = this.grounded ? STEER_ACC : AIR_ACC;
    if (want === null) this.vx *= this.grounded ? FRICTION : 0.98;
    else this.vx += Math.max(-acc, Math.min(acc, want - this.vx));

    // ---- motion
    if (this.speed < MAX_SPEED) this.speed = Math.min(MAX_SPEED, this.speed + ACCEL);
    const prevZ = this.z;
    this.z += this.speed;
    this.x += this.vx;
    this.fill();

    // Side walls bounce.
    const row = this.rowAt(this.z);
    if (row) {
      if (row.wallL && this.x - R < -HALF) {
        this.x = -HALF + R;
        if (this.vx < -0.02) this.events.push({ t: "wall", sfx: "wall", side: -1, shake: 2 });
        if (this.vx < 0) this.vx = -this.vx * 0.5;
      } else if (row.wallR && this.x + R > HALF) {
        this.x = HALF - R;
        if (this.vx > 0.02) this.events.push({ t: "wall", sfx: "wall", side: 1, shake: 2 });
        if (this.vx > 0) this.vx = -this.vx * 0.5;
      }
    }

    // ---- vertical
    const g = this.groundAt(this.x, this.z);
    if (this.grounded) {
      const yFree = this.y + this.vy - G;
      if (g === -Infinity || yFree > g + 0.02) {
        this.grounded = false;
        this.vy -= G;
        if (this.onRamp) {
          this.vy = Math.max(this.vy, LAUNCH_V);
          this.events.push({ t: "launch", sfx: "launch" });
        }
        this.y += this.vy;
      } else {
        this.y = g;
        this.vy = this.slopeAt(this.x, this.z) * this.speed;
      }
    } else {
      this.vy -= G;
      this.y += this.vy;
      if (g !== -Infinity && this.y <= g && this.y >= g - LAND_TOL) {
        this.y = g;
        this.vy = this.slopeAt(this.x, this.z) * this.speed;
        this.grounded = true;
        this.events.push({ t: "land" });
      }
    }
    this.onRamp = this.grounded && this.cellAt(this.x, this.rowAt(this.z)) === RAMP;

    // ---- blocks
    if (this.hitBlocks(prevZ)) return;
    if (!this.grounded && this.y < this.elevAt(this.z) - FALL_DEPTH) {
      this.die("fall");
      return;
    }

    // ---- coins
    let got = 0;
    const cy = this.y + R;
    this.coins = this.coins.filter((c) => {
      if (c.z < this.z - 2) return false;
      if (Math.abs(c.z - this.z) > 0.6 || Math.abs(c.x - this.x) > 0.55) return true;
      if (Math.abs(this.elevAt(c.z) + c.h - cy) > 0.75) return true;
      got++;
      return false;
    });
    if (got) {
      this.coinCount += got;
      this.events.push({ t: "coin", sfx: "brick", n: got });
    }

    // ---- housekeeping
    const drop = Math.floor((this.z - KEEP_BEHIND) / ROW_LEN) - this.rowBase;
    if (drop > 16) {
      this.rows.splice(0, drop);
      this.rowBase += drop;
    }
    while (this.dist >= this.nextMilestone) {
      this.events.push({ t: "milestone", sfx: "extraGood", mood: "happy", value: this.nextMilestone });
      this.nextMilestone += MILESTONE;
    }
    if (this.frame >= MAX_FRAMES) {
      this.timeUp = true;
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  /** Blocks: head-on contact ends the run, side contact bounces. Returns true on death. */
  private hitBlocks(prevZ: number): boolean {
    const r0 = Math.floor((this.z - R) / ROW_LEN), r1 = Math.floor((this.z + R) / ROW_LEN);
    for (let ri = r0; ri <= r1; ri++) {
      const row = this.rows[ri - this.rowBase];
      if (!row) continue;
      for (let col = 0; col < COLS; col++) {
        if (row.cells[col] !== BLOCK) continue;
        const bx = colX(col);
        const bz0 = ri * ROW_LEN + BLOCK_Z0, bz1 = ri * ROW_LEN + BLOCK_Z1;
        const reach = BLOCK_HW + SIDE_HIT;
        if (Math.abs(this.x - bx) >= reach || this.z + R <= bz0 || this.z - R >= bz1) continue;
        if (this.y >= rowElev(row, bz0) + BLOCK_H) continue;
        if (prevZ + R <= bz0 + 1e-9) {
          this.die("block");
          return true;
        }
        const s = this.x < bx ? -1 : 1;
        this.x = bx + s * (reach + 0.001);
        this.vx = s * Math.max(0.03, Math.abs(this.vx) * 0.5);
        this.events.push({ t: "wall", sfx: "wall", side: -s, shake: 3 });
      }
    }
    return false;
  }

  view(): SlopeView {
    const from = Math.max(0, Math.floor((this.z - 8) / ROW_LEN) - this.rowBase);
    const far = this.z + SPAWN_AHEAD;
    return {
      frame: this.frame,
      dist: this.dist,
      z: this.z,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      speed: this.speed,
      grounded: this.grounded,
      elev: this.elevAt(this.z),
      rows: this.rows.slice(from),
      coins: this.coins.filter((c) => c.z < far),
      score: this.score,
      coinCount: this.coinCount,
      dead: this.dead,
      crash: this.crash,
    };
  }
  hud(): Hud {
    return { score: this.score, label: `${this.coinCount} COINS` };
  }
  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.done ? "over" : "playing" };
  }
  get done() {
    return this.dead || this.timeUp;
  }
}

// ---------------------------------------------------------------- bot
function hash32(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Target x for the bot: plan over the rows ahead (survivable rows per column). */
export function botTarget(v: SlopeView): number {
  const rows = v.rows;
  if (!rows.length) return v.x;
  const base = rows[0].i;
  const get = (i: number) => rows[i - base];
  let zs = v.z;
  if (!v.grounded) {
    const drop = Math.max(0, v.y - v.elev);
    const t = (v.vy + Math.sqrt(v.vy * v.vy + 2 * G * drop)) / G;
    zs = v.z + t * v.speed;
  }
  const rStart = Math.floor(zs / ROW_LEN);
  const horizon = Math.ceil((v.speed * 100) / ROW_LEN) + 6;
  const rEnd = Math.min(base + rows.length - 1, rStart + horizon);
  if (rEnd <= rStart) return v.x;
  const k = Math.max(1, Math.ceil((14 * v.speed) / ROW_LEN));
  const flight = Math.ceil((FLIGHT_MIN * v.speed + 1) / ROW_LEN);
  const NEG = -1e9;
  const S: number[][] = [];
  const safe = (r: number, c: number) => {
    const row = get(r);
    return !!row && c >= 0 && c < COLS && isSafe(row.cells[c]);
  };
  const coinAt = new Set<number>();
  for (const c of v.coins) coinAt.add(Math.floor(c.z / ROW_LEN) * 8 + Math.floor(c.x + HALF));
  const val = (r: number, c: number) => (r >= rEnd ? (safe(Math.min(r, rEnd), c) ? 0 : NEG) : S[r - rStart][c]);
  for (let r = rEnd; r >= rStart; r--) {
    const out: number[] = [];
    for (let c = 0; c < COLS; c++) {
      if (r === rEnd) {
        out.push(safe(r, c) ? 0 : NEG);
        continue;
      }
      if (!safe(r, c)) {
        out.push(NEG);
        continue;
      }
      const row = get(r)!;
      if (row.cells[c] === RAMP && !safe(r + 1, c)) {
        const rl = r + flight;
        out.push(rl >= rEnd ? rEnd - r : flight + val(rl, c));
        continue;
      }
      let best = 1 + (S[r + 1 - rStart] ? S[r + 1 - rStart][c] : NEG);
      for (const d of [-1, 1]) {
        const c2 = c + d;
        let ok = c2 >= 0 && c2 < COLS;
        for (let j = 0; ok && j <= k; j++) if (r + j <= rEnd && (!safe(r + j, c) || !safe(r + j, c2))) ok = false;
        if (!ok) continue;
        const cand = k - 0.3 + val(r + k, c2);
        if (cand > best) best = cand;
      }
      if (coinAt.has(r * 8 + c)) best += 0.6;
      out.push(best);
    }
    S[r - rStart] = out;
  }
  const c0 = Math.max(0, Math.min(COLS - 1, Math.floor(v.x + HALF)));
  const first = S[0];
  // Pick the best column, penalising distance from where we are.
  let bestC = c0, bestV = -Infinity;
  for (let c = 0; c < COLS; c++) {
    let ok = true;
    const lo = Math.min(c, c0), hi = Math.max(c, c0);
    for (let q = lo; q <= hi; q++) if (!safe(rStart, q) && v.grounded) ok = false;
    const score = first[c] - Math.abs(c - c0) * (0.6 + v.speed * 2) + (ok ? 0 : -50);
    if (score > bestV) {
      bestV = score;
      bestC = c;
    }
  }
  return colX(bestC);
}

export const slope: GameDef<SlopeView> = {
  id: "slope",
  name: "Moon Slope",
  tagline: "One coin, one endless neon hill. Steer around the holes, hit the ramps, never stop rolling.",
  genre: "Endless downhill roller",
  session: "1–4 min",
  controls: "Left / Right arrows, or drag / move the pointer to steer. Ramps launch you over gaps.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes:
      "Original downhill rolling-ball game written for ArcadePad: tile-row track, inertia steering, ramp/crest ballistics, fair chunked generator and pseudo-3D neon renderer are all ours. No code, names or art from any existing rolling-ball game.",
  },
  create: (seed) => new SlopeEngine(seed),
  bot(v, frame) {
    const idle = { x: FIELD_W / 2, y: FIELD_H / 2, b: 0 };
    if (v.dead) return idle;
    // Imperfection: now and then the bot zones out for a moment.
    if (frame > 1500 && hash32(Math.floor(frame / 40)) % 37 === 0) return idle;
    let tx = botTarget(v);
    if (hash32(Math.floor(frame / 25) + 77) % 9 === 0) tx += ((hash32(frame >> 3) % 3) - 1) * 0.35;
    const brake = (v.vx * Math.abs(v.vx)) / (2 * STEER_ACC);
    const pred = v.x + brake + v.vx * 2;
    let b = 0;
    if (tx - pred > 0.08) b = BTN.RIGHT;
    else if (tx - pred < -0.08) b = BTN.LEFT;
    return { x: FIELD_W / 2, y: FIELD_H / 2, b };
  },
};
