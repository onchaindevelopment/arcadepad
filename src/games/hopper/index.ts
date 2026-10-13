/*
 * Coin Crossing: an original endless road-and-river hopper.
 * ArcadePad, GPL-3.0-or-later. No code, art, names or layouts from any
 * commercial game; the genre mechanics (hop a grid forward across moving
 * lanes) are implemented from scratch.
 *
 * World: a 9-tile-wide strip of rows, row 0 at the bottom, growing upward.
 * Rows are grass (candle stumps block tiles, coins to grab), roads (vans,
 * scooters and pump trucks in lanes), rivers (logs and lily-coin pads you
 * must ride) and rails (a fast bullet tram announced by warning lights).
 * The camera creeps forward on its own, so idling too long gets you caught.
 *
 * Lanes are analytic: every object's x is a pure function of the frame
 * (offset + speed * frame, wrapped over the lane period), so rendering,
 * bots and replays all agree exactly. Row generation is seeded and fair by
 * construction (minimum car gaps, maximum log gaps, alternating river
 * directions, connected grass blocks, long tram-free windows).
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- field
export const COLS = 9;
export const VIS_ROWS = 15;
export const TILE = 40;
export const FIELD_W = COLS * TILE; // 360
export const FIELD_H = VIS_ROWS * TILE; // 600
/** Frames per hop. */
export const HOP = 8;
/** Lane objects wrap over [-MARGIN, period - MARGIN); MARGIN >= the widest object. */
export const MARGIN = 4 * TILE;
const MIN_PERIOD = FIELD_W + 2 * MARGIN; // 680
export const START_ROW = 2;
const SAFE_ROWS = 5; // rows 0..4: plain grass
export const COIN_VALUE = 5;
const MILESTONE = 25;
/** Half-width of the player's hitbox against vehicles. */
export const PLAYER_HALF = 13;
const CAR_INSET = 3;
/** A rider must stand at least this far inside a log/pad edge. */
const FOOT_INSET = 6;
const AUTO_START = 240; // camera starts on its own after 4 s
const MAX_FRAMES = 20 * 60 * 60;

export const TRAM_LEN = 6 * TILE;
export const TRAM_SPEED = 16;
export const TRAM_PASS = Math.ceil((FIELD_W + TRAM_LEN) / TRAM_SPEED); // frames on screen
export const TRAM_WARN = 60; // warning lights before it arrives

/** Vehicle kinds (roads) and float kinds (rivers). */
export const SCOOTER = 0, VAN = 1, PUMP_TRUCK = 2;
export const LOG = 0, LILY = 1;
const VEHICLE_TILES = [1, 2, 3];

export const DIR_UP = 0, DIR_DOWN = 1, DIR_LEFT = 2, DIR_RIGHT = 3;

// ---------------------------------------------------------------- rows
export type RowKind = "grass" | "road" | "river" | "rail";

export interface LaneObj {
  off: number; // px, phase in the lane loop
  w: number; // px
  kind: number;
}

export interface Tram {
  period: number; // frames between trams
  off: number;
  dir: 1 | -1;
}

export interface Row {
  r: number;
  kind: RowKind;
  /** Bitmask of columns blocked by candle stumps (grass only). */
  stumps: number;
  /** Bitmask of columns holding a coin (mutated when collected). */
  coins: number;
  /** Lane speed in px per frame, signed (+ = right). */
  speed: number;
  /** Lane loop length in px (>= FIELD_W + 2 * MARGIN). */
  period: number;
  objs: LaneObj[];
  tram: Tram | null;
}

export interface PlacedObj {
  x: number;
  w: number;
  kind: number;
}

function wrap(v: number, m: number): number {
  const r = v % m;
  return r < 0 ? r + m : r;
}

/** Lane objects at a frame, x in [-MARGIN, period - MARGIN). Off-range copies are never visible. */
export function laneObjects(row: Row, frame: number): PlacedObj[] {
  const out: PlacedObj[] = [];
  for (const o of row.objs) out.push({ x: wrap(o.off + row.speed * frame, row.period) - MARGIN, w: o.w, kind: o.kind });
  return out;
}

export interface TramState {
  active: boolean;
  warn: boolean;
  x: number; // left edge
  w: number;
  dir: 1 | -1;
}

export function tramState(row: Row, frame: number): TramState {
  const tr = row.tram!;
  const ph = wrap(frame + tr.off, tr.period);
  const active = ph < TRAM_PASS;
  const x = tr.dir > 0 ? -TRAM_LEN + ph * TRAM_SPEED : FIELD_W - ph * TRAM_SPEED;
  return { active, warn: active || ph >= tr.period - TRAM_WARN, x, w: TRAM_LEN, dir: tr.dir };
}

/** Is a standing player (centre x) hit on this row at this frame? Rivers are handled by riding. */
export function hitAt(row: Row, x: number, frame: number): boolean {
  if (row.kind === "road") {
    for (const o of laneObjects(row, frame)) {
      if (x + PLAYER_HALF > o.x + CAR_INSET && x - PLAYER_HALF < o.x + o.w - CAR_INSET) return true;
    }
  } else if (row.kind === "rail") {
    const s = tramState(row, frame);
    if (s.active && x + PLAYER_HALF > s.x && x - PLAYER_HALF < s.x + s.w) return true;
  }
  return false;
}

/** The float (log or lily pad group) under x, if any. */
export function floatAt(row: Row, x: number, frame: number): PlacedObj | null {
  for (const o of laneObjects(row, frame)) if (x >= o.x + FOOT_INSET && x <= o.x + o.w - FOOT_INSET) return o;
  return null;
}

/** Where a hop would land, or null if blocked (edge, stump, missing row). */
export function planHop(getRow: (r: number) => Row | undefined, x: number, row: number, dir: number): { row: number; x: number } | null {
  let tr = row, tx = x;
  if (dir === DIR_UP) tr++;
  else if (dir === DIR_DOWN) tr--;
  else tx += dir === DIR_LEFT ? -TILE : TILE;
  const target = getRow(tr);
  if (!target) return null;
  if (target.kind === "river") {
    if (tx < 8 || tx > FIELD_W - 8) return null;
    return { row: tr, x: tx };
  }
  const col = Math.round((tx - TILE / 2) / TILE);
  if (col < 0 || col >= COLS) return null;
  if (target.stumps & (1 << col)) return null;
  return { row: tr, x: col * TILE + TILE / 2 };
}

const q16 = (v: number) => Math.round(v * 16) / 16;

/** Grass block check: from every free tile of the bottom row, the top row is reachable. */
export function grassBlockOk(block: readonly { stumps: number }[]): boolean {
  const n = block.length;
  if (!n) return true;
  for (const row of block) if ((row.stumps & ((1 << COLS) - 1)) === (1 << COLS) - 1) return false;
  for (let c0 = 0; c0 < COLS; c0++) {
    if (block[0].stumps & (1 << c0)) continue;
    const seen = new Uint8Array(n * COLS);
    const stack = [c0];
    seen[c0] = 1;
    let ok = false;
    while (stack.length) {
      const k = stack.pop()!;
      const r = Math.floor(k / COLS), c = k % COLS;
      if (r === n - 1) { ok = true; break; }
      const nb = [[r + 1, c], [r - 1, c], [r, c - 1], [r, c + 1]];
      for (const [nr, nc] of nb) {
        if (nr < 0 || nr >= n || nc < 0 || nc >= COLS) continue;
        if (block[nr].stumps & (1 << nc)) continue;
        const kk = nr * COLS + nc;
        if (!seen[kk]) { seen[kk] = 1; stack.push(kk); }
      }
    }
    if (!ok) return false;
  }
  return true;
}

/** Seeded, fair row generator. Rows come out in order r = 0, 1, 2, ... */
export class RowGen {
  private rng: Rng;
  private r = 0;
  private plan: RowKind[] = [];
  private lastBlockGrass = true;
  private grassBlock: Row[] = [];
  private prevRiverDir = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed1e55);
  }

  next(): Row {
    if (!this.plan.length) this.planBlock();
    const kind = this.plan.shift()!;
    const r = this.r++;
    const d = Math.min(1, r / 250);
    let row: Row;
    if (kind === "grass") row = this.grass(r, d);
    else if (kind === "road") row = this.road(r, d);
    else if (kind === "river") row = this.river(r, d);
    else row = this.rail(r, d);
    if (kind === "grass") this.grassBlock.push(row);
    else this.grassBlock = [];
    if (kind !== "river") this.prevRiverDir = 0;
    return row;
  }

  private planBlock() {
    const rng = this.rng;
    if (this.r < SAFE_ROWS) {
      for (let i = this.r; i < SAFE_ROWS; i++) this.plan.push("grass");
      this.lastBlockGrass = true;
      return;
    }
    const d = Math.min(1, this.r / 250);
    if (!this.lastBlockGrass) {
      const n = rng.range(1, d < 0.5 ? 3 : 2);
      for (let i = 0; i < n; i++) this.plan.push("grass");
      this.lastBlockGrass = true;
      return;
    }
    const roll = rng.int(100);
    let kind: RowKind;
    let n: number;
    if (roll < 45 || (roll >= 80 && this.r < 15)) {
      kind = "road";
      n = rng.range(1, Math.min(5, 2 + Math.floor(d * 3)));
    } else if (roll < 80) {
      kind = "river";
      n = rng.range(1, Math.min(3, 2 + Math.floor(d * 2)));
    } else {
      kind = "rail";
      n = rng.range(1, 2);
    }
    for (let i = 0; i < n; i++) this.plan.push(kind);
    this.lastBlockGrass = false;
  }

  private base(r: number, kind: RowKind): Row {
    return { r, kind, stumps: 0, coins: 0, speed: 0, period: MIN_PERIOD, objs: [], tram: null };
  }

  private grass(r: number, d: number): Row {
    const rng = this.rng;
    const row = this.base(r, "grass");
    if (r >= SAFE_ROWS) {
      const max = 1 + Math.round(1 + d * 2); // 2..4 stumps
      for (let attempt = 0; attempt < 6; attempt++) {
        const count = Math.max(0, rng.int(max + 1) - attempt);
        let m = 0;
        for (let i = 0; i < count; i++) m |= 1 << rng.int(COLS);
        row.stumps = m;
        if (grassBlockOk([...this.grassBlock, row])) break;
        row.stumps = 0;
      }
      if (rng.int(4) === 0) {
        const free: number[] = [];
        for (let c = 0; c < COLS; c++) if (!(row.stumps & (1 << c))) free.push(c);
        if (free.length) row.coins = 1 << free[rng.int(free.length)];
      }
    }
    return row;
  }

  private road(r: number, d: number): Row {
    const rng = this.rng;
    const row = this.base(r, "road");
    const dir = rng.int(2) ? 1 : -1;
    const sp = q16(0.6 + (rng.int(101) / 100) * (0.8 + 1.3 * d)); // 0.6 .. 2.7
    row.speed = dir * sp;
    const minGap = sp > 1.6 ? 3 : 2;
    const maxGap = minGap + 4 - Math.round(2 * d);
    let cursor = 0;
    while (cursor < MIN_PERIOD) {
      const roll = rng.int(10);
      const kind = sp > 1.8 ? (roll < 6 ? SCOOTER : VAN) : roll < 3 ? SCOOTER : roll < 7 ? VAN : PUMP_TRUCK;
      const w = VEHICLE_TILES[kind] * TILE;
      row.objs.push({ off: cursor, w, kind });
      cursor += w + rng.range(minGap, maxGap) * TILE;
    }
    row.period = cursor;
    const phase = rng.int(cursor);
    for (const o of row.objs) o.off += phase;
    if (rng.int(6) === 0) row.coins = 1 << rng.int(COLS);
    return row;
  }

  private river(r: number, d: number): Row {
    const rng = this.rng;
    const row = this.base(r, "river");
    const dir = this.prevRiverDir ? -this.prevRiverDir : rng.int(2) ? 1 : -1;
    this.prevRiverDir = dir;
    const lily = rng.int(10) < 3;
    let sp = q16(0.5 + (rng.int(101) / 100) * (0.5 + 0.6 * d)); // 0.5 .. 1.6
    if (lily) sp = Math.max(0.4, q16(sp * 0.75));
    row.speed = dir * sp;
    const maxLog = d > 0.6 ? 3 : 4;
    const maxGap = d > 0.5 ? 3 : 2;
    let cursor = 0;
    while (cursor < MIN_PERIOD) {
      const tiles = lily ? rng.range(2, 3) : rng.range(2, maxLog);
      row.objs.push({ off: cursor, w: tiles * TILE, kind: lily ? LILY : LOG });
      cursor += tiles * TILE + rng.range(1, maxGap) * TILE;
    }
    row.period = cursor;
    const phase = rng.int(cursor);
    for (const o of row.objs) o.off += phase;
    return row;
  }

  private rail(r: number, d: number): Row {
    const rng = this.rng;
    const row = this.base(r, "rail");
    const period = rng.range(240, 360) - Math.round(40 * d); // >= 100 frames free between warnings
    row.tram = { period, off: rng.int(period), dir: rng.int(2) ? 1 : -1 };
    return row;
  }
}

// ---------------------------------------------------------------- engine
export type DeathCause = "car" | "tram" | "water" | "swept" | "edge";

export interface PlayerView {
  /** Centre x in px (interpolated during a hop). */
  x: number;
  /** Row as a float (interpolated during a hop). */
  y: number;
  /** Logical (target) position. */
  tx: number;
  row: number;
  fromRow: number;
  hopping: boolean;
  /** 0..1 progress of the current hop. */
  hopT: number;
  /** Frames since the last landing (for squash). */
  landT: number;
  dir: number;
  riding: boolean;
  dead: boolean;
  cause: DeathCause | null;
}

export interface HopperView {
  frame: number;
  started: boolean;
  /** World px of the bottom screen edge. Screen y of a world px wy is FIELD_H - (wy - camY). */
  camY: number;
  autoSpeed: number;
  rows: Row[];
  player: PlayerView;
  score: number;
  best: number;
  coins: number;
}

/** Screen y of the top of a (fractional) row. */
export function rowTopY(r: number, camY: number): number {
  return FIELD_H - ((r + 1) * TILE - camY);
}

export class HopperEngine implements GameEngine<HopperView> {
  gen: RowGen;
  rows: Row[] = [];
  base = 0;
  x = 4 * TILE + TILE / 2;
  row = START_ROW;
  fromX = this.x;
  fromRow = START_ROW;
  hopT = 0;
  hopping = false;
  buffer = -1;
  riding = false;
  facing = DIR_UP;
  landT = 99;
  camY = 0;
  started = false;
  best = 0;
  coins = 0;
  dead = false;
  cause: DeathCause | null = null;
  prevB = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.gen = new RowGen(seed);
    this.ensureRows();
  }

  getRow = (r: number): Row | undefined => this.rows[r - this.base];

  private ensureRows() {
    const camRow = Math.floor(this.camY / TILE);
    const top = camRow + VIS_ROWS + 3;
    while (this.base + this.rows.length <= top) this.rows.push(this.gen.next());
    while (this.rows.length && this.rows[0].r < camRow - 4) {
      this.rows.shift();
      this.base++;
    }
  }

  get autoSpeed(): number {
    return Math.min(0.6, 0.25 + this.best * 0.002);
  }

  private interp(): { x: number; y: number } {
    if (!this.hopping) return { x: this.x, y: this.row };
    const k = this.hopT / HOP;
    return { x: this.fromX + (this.x - this.fromX) * k, y: this.fromRow + (this.row - this.fromRow) * k };
  }

  private sx(x: number) {
    return x;
  }
  private sy(rowF: number) {
    return rowTopY(rowF, this.camY) + TILE / 2;
  }

  private tryHop(dir: number) {
    const t = planHop(this.getRow, this.x, this.row, dir);
    this.facing = dir;
    if (!t) {
      this.events.push({ t: "bump", sfx: "wall", x: this.sx(this.x), y: this.sy(this.row) });
      return;
    }
    this.started = true;
    this.fromX = this.x;
    this.fromRow = this.row;
    this.x = t.x;
    this.row = t.row;
    this.hopping = true;
    this.hopT = 0;
    this.events.push({ t: "hop", sfx: "paddle", dir, x: this.sx(this.fromX), y: this.sy(this.fromRow) });
  }

  private land() {
    this.hopping = false;
    this.hopT = 0;
    this.landT = 0;
    const row = this.getRow(this.row)!;
    if (row.kind === "river") {
      if (!floatAt(row, this.x, this.frame)) {
        this.die("water");
        return;
      }
      this.riding = true;
    } else {
      this.riding = false;
      const col = Math.round((this.x - TILE / 2) / TILE);
      if (row.coins & (1 << col)) {
        row.coins &= ~(1 << col);
        this.coins++;
        this.events.push({ t: "coin", sfx: "brick", value: COIN_VALUE, x: this.sx(this.x), y: this.sy(this.row) });
      }
    }
    this.events.push({ t: "land", kind: row.kind, x: this.sx(this.x), y: this.sy(this.row) });
    const dist = this.row - START_ROW;
    if (dist > this.best) {
      const before = Math.floor(this.best / MILESTONE);
      this.best = dist;
      if (Math.floor(dist / MILESTONE) > before) {
        this.events.push({ t: "milestone", sfx: "extraGood", mood: "happy", row: dist, x: this.sx(this.x), y: this.sy(this.row) - 20 });
      }
    }
  }

  private die(cause: DeathCause) {
    if (this.dead) return;
    const p = this.interp();
    this.dead = true;
    this.cause = cause;
    this.hopping = false;
    this.events.push({ t: "die", cause, sfx: "lost", mood: "sad", shake: cause === "water" ? 5 : 9, x: this.sx(p.x), y: this.sy(p.y) });
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;
    if (this.frame >= MAX_FRAMES) {
      this.dead = true;
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    let dir = -1;
    if (pressed & (BTN.UP | BTN.FIRE)) dir = DIR_UP;
    else if (pressed & BTN.LEFT) dir = DIR_LEFT;
    else if (pressed & BTN.RIGHT) dir = DIR_RIGHT;
    else if (pressed & BTN.DOWN) dir = DIR_DOWN;
    if (dir >= 0) {
      if (this.hopping) this.buffer = dir;
      else this.tryHop(dir);
    }

    if (this.hopping) {
      // Lateral hop on a river: the float keeps carrying you mid-air.
      if (this.fromRow === this.row && this.riding) {
        const sp = this.getRow(this.row)!.speed;
        this.fromX += sp;
        this.x += sp;
      }
      this.hopT++;
      if (this.hopT >= HOP) {
        this.land();
        if (this.dead) return;
        if (this.buffer >= 0) {
          const b = this.buffer;
          this.buffer = -1;
          this.tryHop(b);
        }
      }
    } else {
      this.landT++;
      if (this.riding) this.x += this.getRow(this.row)!.speed;
    }
    if (!this.hopping && this.riding && (this.x < 0 || this.x > FIELD_W)) {
      this.die("swept");
      return;
    }

    // Camera: creeps forward on its own, and catches up when you run ahead.
    if (!this.started && this.frame >= AUTO_START) this.started = true;
    if (this.started) this.camY += this.autoSpeed;
    const lead = this.row * TILE - this.camY;
    if (lead > 7 * TILE) this.camY += (lead - 7 * TILE) * 0.1;

    // Collisions.
    const p = this.interp();
    const cr = this.hopping && this.hopT < HOP / 2 ? this.fromRow : this.row;
    const crow = this.getRow(cr);
    if (crow && hitAt(crow, p.x, this.frame)) {
      this.die(crow.kind === "rail" ? "tram" : "car");
      return;
    }
    if (p.y * TILE + TILE / 2 < this.camY) {
      this.die("edge");
      return;
    }
    this.ensureRows();
  }

  view(): HopperView {
    const camRow = Math.floor(this.camY / TILE);
    const rows: Row[] = [];
    for (let r = camRow - 1; r <= camRow + VIS_ROWS + 1; r++) {
      const row = this.getRow(r);
      if (row) rows.push(row);
    }
    const p = this.interp();
    return {
      frame: this.frame,
      started: this.started,
      camY: this.camY,
      autoSpeed: this.started ? this.autoSpeed : 0,
      rows,
      player: {
        x: p.x,
        y: p.y,
        tx: this.x,
        row: this.row,
        fromRow: this.fromRow,
        hopping: this.hopping,
        hopT: this.hopping ? this.hopT / HOP : 0,
        landT: this.landT,
        dir: this.facing,
        riding: this.riding,
        dead: this.dead,
        cause: this.cause,
      },
      score: this.score,
      best: this.best,
      coins: this.coins,
    };
  }

  get score(): number {
    return this.best + this.coins * COIN_VALUE;
  }

  hud(): Hud {
    return { score: this.score, label: `Row ${this.best}` };
  }

  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.dead ? "over" : "playing" };
  }

  get done() {
    return this.dead;
  }
}

// ---------------------------------------------------------------- bot
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const DIR_BTN = [BTN.UP, BTN.DOWN, BTN.LEFT, BTN.RIGHT];
const IDLE: Input = { x: 0, y: 0, b: 0 };

/** Would this move (or waiting, dir = -1) survive the next HOP + hold frames? */
function moveSafe(v: HopperView, getRow: (r: number) => Row | undefined, dir: number, hold: number): boolean {
  const p = v.player;
  const cur = getRow(p.row);
  if (!cur) return false;
  const edgeAt = (k: number) => v.camY + Math.max(v.autoSpeed, 0.25) * k + 6;
  if (dir < 0) {
    const sp = p.riding ? cur.speed : 0;
    for (let k = 1; k <= hold; k++) {
      const x = p.x + sp * k;
      if (p.riding && (x < 18 || x > FIELD_W - 18)) return false;
      if (hitAt(cur, x, v.frame + k)) return false;
      if (p.row * TILE + TILE / 2 < edgeAt(k)) return false;
    }
    return true;
  }
  const t = planHop(getRow, p.x, p.row, dir);
  if (!t) return false;
  const to = getRow(t.row)!;
  const lateralRide = t.row === p.row && p.riding;
  const drift = lateralRide ? cur.speed : 0;
  for (let k = 1; k <= HOP + hold; k++) {
    const f = v.frame + k;
    const h = Math.min(k, HOP);
    const frac = h / HOP;
    let x = p.x + (t.x - p.x) * frac + drift * h;
    if (k > HOP && to.kind === "river") x = t.x + drift * HOP + to.speed * (k - HOP);
    const rowF = p.row + (t.row - p.row) * frac;
    const cr = h < HOP / 2 ? getRow(p.row)! : to;
    if (k === HOP && to.kind === "river" && !floatAt(to, x, f)) return false;
    if (to.kind === "river" && k > HOP && (x < 18 || x > FIELD_W - 18)) return false;
    if (hitAt(cr, x, f)) return false;
    // A tram that is about to arrive counts as danger too.
    if (cr.kind === "rail" && k >= HOP / 2) {
      const s = tramState(cr, f);
      if (s.warn && !s.active && k > HOP) return false;
    }
    if (rowF * TILE + TILE / 2 < edgeAt(k)) return false;
  }
  return true;
}

function botInput(v: HopperView, frame: number): Input {
  const p = v.player;
  if (p.dead || p.hopping) return IDLE;
  const h = hash(frame);
  if (h % 100 < 7) return IDLE; // hesitation
  const sloppy = (h >>> 8) % 100 < 4;
  const near = p.row * TILE + TILE / 2 - v.camY < 1.6 * TILE;
  const hold = sloppy ? 3 : near ? 8 : 22;
  const byR = new Map<number, Row>();
  for (const r of v.rows) byR.set(r.r, r);
  const getRow = (r: number) => byR.get(r);
  const press = (d: number): Input => ({ x: 0, y: 0, b: DIR_BTN[d] });
  const ok = (d: number, k = hold) => moveSafe(v, getRow, d, k);

  if (ok(DIR_UP)) return press(DIR_UP);
  const cur = getRow(p.row);
  const next = getRow(p.row + 1);
  const waitOk = ok(-1, 12);
  // Blocked by a stump: walk toward the nearest column that is open above.
  if (cur && next && cur.kind !== "river" && next.kind !== "river" && !planHop(getRow, p.x, p.row, DIR_UP)) {
    const col = Math.round((p.x - TILE / 2) / TILE);
    let bestD = 99, bestDir = -1;
    for (let c = 0; c < COLS; c++) {
      if (next.stumps & (1 << c)) continue;
      const dd = Math.abs(c - col);
      const step = c < col ? DIR_LEFT : DIR_RIGHT;
      let clear = true;
      for (let cc = Math.min(c, col); cc <= Math.max(c, col); cc++) if (cur.stumps & (1 << cc)) clear = false;
      if (clear && dd < bestD) { bestD = dd; bestDir = step; }
    }
    if (bestDir >= 0 && ok(bestDir, 10)) return press(bestDir);
  }
  if (waitOk) {
    // About to enter a river from land: line up away from the edge it flows toward.
    if (cur && next && next.kind === "river" && !p.riding) {
      const want = next.speed < 0 ? DIR_RIGHT : DIR_LEFT;
      const tooClose = next.speed < 0 ? p.x < 3.5 * TILE : p.x > FIELD_W - 3.5 * TILE;
      if (tooClose && ok(want, 10)) return press(want);
    }
    // Drifting toward an edge on a float: step against the current.
    if (p.riding && cur) {
      const ahead = p.x + cur.speed * 50;
      if (ahead < 40 || ahead > FIELD_W - 40) {
        const against = cur.speed > 0 ? DIR_LEFT : DIR_RIGHT;
        if (ok(against, 10)) return press(against);
      }
    }
    return IDLE;
  }
  for (const d of [DIR_LEFT, DIR_RIGHT]) if (ok(d, 10)) return press(d);
  if (ok(DIR_DOWN, 10)) return press(DIR_DOWN);
  if (ok(DIR_UP, 2)) return press(DIR_UP);
  return IDLE;
}

export const hopper: GameDef<HopperView> = {
  id: "hopper",
  name: "Coin Crossing",
  tagline: "Hop the roads, ride the river, outrun the pump trucks. How far can you go?",
  genre: "Endless road crossing",
  session: "1–5 min",
  controls: "Arrow keys / WASD or swipe to hop. Tap hops forward.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true, touchMap: { tap: BTN.UP } },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the road-crossing hopper genre. No code, art, names, sounds or layouts taken from any existing game; all art is drawn with the kit in the coin's palette.",
  },
  create: (seed) => new HopperEngine(seed),
  bot: botInput,
};
