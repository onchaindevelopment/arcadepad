/*
 * Moon Dash 3: an original three-lane endless runner seen from behind in
 * pseudo-3D. ArcadePad, GPL-3.0-or-later.
 *
 * Original design (credits.basedOn = "Original"): no code, names, characters
 * or art from any commercial lane runner. The engine is 2D logically: a lane
 * index 0..2, a forward distance z and a height y, all in "world units"
 * (1 unit ~ one lane width). Obstacles come in deterministic chunks from one
 * seeded Rng with fairness rules: every obstacle row leaves at least one lane
 * that is not a solid wall, rows are spaced by a reaction time at the current
 * speed, and every chunk is followed by an empty gap so the player can reach
 * any lane before the next one.
 *
 * Obstacles:
 *   low   hurdle, solid between y 0.5 and 0.95: jump over or roll under.
 *   high  hanging sign, solid between y 0.6 and 2.0: roll under.
 *   wall  long "candle wall", solid up to y 1.6: change lane around it.
 *   ramp  candle wall with a ramp in front: run up and along the top.
 * Power-ups: magnet, 2x coins, hover (jetpack ride above everything) and a
 * one-hit shield. Score = floor(distance) + coins x 10.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- field / world
export const FIELD_W = 360;
export const FIELD_H = 600;
export const LANES = 3;

/** Half depth of the player along z. */
export const PLAYER_HALF = 0.3;
export const PLAYER_H = 1.0;
export const ROLL_H = 0.45;

export const LOW_Y0 = 0.5;
export const LOW_Y1 = 0.95;
export const HIGH_Y0 = 0.6;
export const HIGH_Y1 = 2.0;
/** Depth (z) of hurdles and signs. */
export const BAR_DEPTH = 0.4;
export const WALL_H = 1.6;
export const RAMP_LEN = 4.5;
/** How far below a wall surface (at the player's front) counts as hitting it. */
const WALL_STEP = 0.12;
const RAMP_STEP = 0.4;

// ---------------------------------------------------------------- physics (per 1/60 s frame)
export const GRAVITY = 0.0095;
export const JUMP_V = 0.165; // peak ~1.43, ~35 frames in the air
const FAST_FALL_V = -0.3;
export const ROLL_FRAMES = 38;
export const LANE_SLIDE = 0.2; // lanes per frame for the visual slide

export const START_SPEED = 0.22; // units per frame (~13 u/s)
const ACCEL = 0.000035;
export const MAX_SPEED = 0.48;
const LATE_ACCEL = 0.00001;
const LATE_MAX_SPEED = 0.6;

// ---------------------------------------------------------------- power-ups
export const MAGNET_FRAMES = 600;
export const DOUBLE_FRAMES = 600;
export const HOVER_FRAMES = 330;
export const HOVER_Y = 3.0;
const HOVER_GRACE = 100;
const SHIELD_GRACE = 50;
const MAGNET_REACH = 7;

// ---------------------------------------------------------------- track
const SAFE_START = 40;
const SPAWN_AHEAD = 110;
const MILESTONE = 1000;
const MAX_FRAMES = 15 * 60 * 60;

export type Kind = "low" | "high" | "wall" | "ramp";
export type PowerKind = "magnet" | "double" | "hover" | "shield";
export interface Obstacle { id: number; lane: number; z: number; z1: number; kind: Kind }
export interface Coin { lane: number; z: number; y: number }
export interface PowerUp { lane: number; z: number; kind: PowerKind }
/** One obstacle row as seen by the fairness rules: what each lane holds at z. */
export interface Row { z: number; cells: (Kind | "")[] }
export interface Chunk { obstacles: Obstacle[]; coins: Coin[]; powers: PowerUp[]; rows: Row[] }

const isWall = (k: Kind) => k === "wall" || k === "ramp";

/** Height of a wall's walkable surface at z (0 outside it). */
export function surface(o: Obstacle, z: number): number {
  if (!isWall(o.kind) || z < o.z || z > o.z1) return 0;
  if (o.kind === "ramp" && z < o.z + RAMP_LEN) return (WALL_H * (z - o.z)) / RAMP_LEN;
  return WALL_H;
}

/** Minimum distance between obstacle rows at a given speed (reaction + action time). */
export function rowGap(speed: number): number {
  return speed * (54 - 14 * difficulty(speed));
}
function chunkGap(speed: number): number {
  return Math.max(10, speed * (58 - 12 * difficulty(speed)));
}
function difficulty(speed: number): number {
  return Math.min(1, Math.max(0, (speed - START_SPEED) / (MAX_SPEED - START_SPEED)));
}

/**
 * Deterministic track generator. Each chunk is a single row, a double row or
 * a corridor of long walls, followed by an empty gap.
 */
export class TrackGen {
  rng: Rng;
  z = SAFE_START;
  private id = 1;
  private chunks = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed1a7e);
  }

  private shuffledLanes(): number[] {
    const a = [0, 1, 2];
    for (let i = 2; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  private coinLine(out: Coin[], lane: number, z0: number, n: number, y = 0.35) {
    for (let i = 0; i < n; i++) out.push({ lane, z: z0 + i * 2, y });
  }

  /** Coins in a jump arc centred on z (over a hurdle). */
  private coinArc(out: Coin[], lane: number, z: number) {
    for (let i = -3; i <= 3; i++) {
      const f = i / 3.5;
      out.push({ lane, z: z + i * 1.4, y: 0.35 + 1.25 * (1 - f * f) });
    }
  }

  private obstacle(lane: number, z: number, kind: Kind, len = BAR_DEPTH): Obstacle {
    return { id: this.id++, lane, z, z1: z + len, kind };
  }

  /** Place one row of hurdles/signs at z; returns the row. */
  private barRow(c: Chunk, z: number, lanes: number[], d: number, wallCells: (Kind | "")[]) {
    const cells = wallCells.slice();
    const r = this.rng.int(10);
    const n = Math.min(lanes.length, r < 3 + 4 * d ? (this.rng.int(3) === 0 ? 3 : 2) : 1);
    const order = this.shuffledLanes().filter((l) => lanes.includes(l));
    for (let i = 0; i < n; i++) {
      const lane = order[i];
      const kind: Kind = this.rng.int(2) ? "low" : "high";
      cells[lane] = kind;
      c.obstacles.push(this.obstacle(lane, z, kind));
    }
    // Coins: a line through a free lane, or an arc over a hurdle.
    const free = order.filter((l) => cells[l] === "");
    const lows = order.filter((l) => cells[l] === "low");
    if (free.length && this.rng.int(3)) this.coinLine(c.coins, free[0], z - 4, 5);
    else if (lows.length) this.coinArc(c.coins, lows[0], z + BAR_DEPTH / 2);
    c.rows.push({ z, cells });
  }

  /** Generate the next chunk at this.z for the given speed. */
  chunk(speed: number, powerOk: boolean): Chunk {
    const c: Chunk = { obstacles: [], coins: [], powers: [], rows: [] };
    const d = difficulty(speed);
    const gap = rowGap(speed);
    const z0 = this.z;
    let end = z0;
    const pick = this.rng.int(100);
    const corridorP = this.chunks < 2 ? 0 : 38 + Math.floor(12 * d);
    const empty: (Kind | "")[] = ["", "", ""];
    if (pick < corridorP) {
      // Corridor: 1 or 2 long walls starting together; open lanes stay open.
      const nWalls = this.rng.int(100) < 35 + 25 * d ? 2 : 1;
      const order = this.shuffledLanes();
      const wallLanes = order.slice(0, nWalls);
      const open = order.slice(nWalls);
      const len = Math.round(18 + this.rng.int(22) + 30 * d);
      const cells: (Kind | "")[] = ["", "", ""];
      for (const l of wallLanes) {
        const kind: Kind = this.rng.int(100) < 35 ? "ramp" : "wall";
        cells[l] = kind;
        c.obstacles.push(this.obstacle(l, z0, kind, len));
        if (kind === "ramp") this.coinLine(c.coins, l, z0 + RAMP_LEN + 1, Math.floor((len - RAMP_LEN - 2) / 2), WALL_H + 0.35);
      }
      c.rows.push({ z: z0, cells });
      const innerP = 40 + 25 * d;
      let zz = z0 + gap;
      const coinLane = open[this.rng.int(open.length)];
      let placedCoins = false;
      for (; zz < z0 + len - 2; zz += gap) {
        if (this.rng.int(100) < innerP) this.barRow(c, zz, open, d, cells);
        else if (!placedCoins) {
          this.coinLine(c.coins, coinLane, zz - 3, 4);
          placedCoins = true;
        }
      }
      end = z0 + len;
    } else if (pick < corridorP + 25) {
      this.barRow(c, z0, [0, 1, 2], d, empty);
      this.barRow(c, z0 + gap, [0, 1, 2], d, empty);
      end = z0 + gap + BAR_DEPTH;
    } else {
      this.barRow(c, z0, [0, 1, 2], d, empty);
      end = z0 + BAR_DEPTH;
    }
    // Empty gap after the chunk: room to reach any lane; maybe a power-up or coins.
    const g = chunkGap(speed);
    if (powerOk && this.chunks > 3 && this.rng.int(6) === 0) {
      const kinds: PowerKind[] = ["magnet", "double", "hover", "shield"];
      c.powers.push({ lane: this.rng.int(3), z: end + g / 2, kind: kinds[this.rng.int(4)] });
    } else if (this.rng.int(3) === 0) {
      this.coinLine(c.coins, this.rng.int(3), end + 3, Math.max(2, Math.floor((g - 6) / 2)));
    }
    this.z = end + g;
    this.chunks++;
    return c;
  }
}

// ---------------------------------------------------------------- view
export interface LanesView {
  frame: number;
  dist: number;
  speed: number;
  lane: number;
  /** Visual lane position (slides toward lane). */
  laneX: number;
  y: number;
  vy: number;
  airborne: boolean;
  /** Frames of roll left (0 = upright). */
  roll: number;
  hover: number;
  magnet: number;
  double: number;
  shield: boolean;
  invuln: number;
  obstacles: Obstacle[];
  coins: Coin[];
  powers: PowerUp[];
  score: number;
  coinCount: number;
  dead: boolean;
  crash: { lane: number; z: number; kind: Kind } | null;
}

export interface LanesOptions {
  /** Tests: a fixed track instead of generated chunks. */
  track?: { obstacles?: Obstacle[]; coins?: Coin[]; powers?: PowerUp[] };
}

export class LanesEngine implements GameEngine<LanesView> {
  readonly gen: TrackGen;
  private scripted: boolean;
  obstacles: Obstacle[] = [];
  coins: Coin[] = [];
  powers: PowerUp[] = [];
  private prevB = 0;
  dist = 0;
  speed = START_SPEED;
  lane = 1;
  private laneX = 1;
  y = 0;
  vy = 0;
  private grounded = true;
  roll = 0;
  private rollQueued = false;
  magnet = 0;
  double = 0;
  hover = 0;
  shield = false;
  invuln = 0;
  coinCount = 0;
  private coinPoints = 0;
  private nextMilestone = MILESTONE;
  private dead = false;
  private timeUp = false;
  private crash: LanesView["crash"] = null;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, opts: LanesOptions = {}) {
    this.gen = new TrackGen(seed);
    this.scripted = !!opts.track;
    if (opts.track) {
      this.obstacles = (opts.track.obstacles ?? []).map((o) => ({ ...o }));
      this.coins = (opts.track.coins ?? []).map((o) => ({ ...o }));
      this.powers = (opts.track.powers ?? []).map((o) => ({ ...o }));
    }
    this.fill();
  }

  private get score() {
    return Math.floor(this.dist) + this.coinPoints * 10;
  }

  private fill() {
    if (this.scripted) return;
    while (this.gen.z < this.dist + SPAWN_AHEAD) {
      const powerOk = this.magnet === 0 && this.double === 0 && this.hover === 0 && this.powers.length === 0;
      const c = this.gen.chunk(this.speed, powerOk);
      for (const o of c.obstacles) this.obstacles.push(o);
      for (const o of c.coins) this.coins.push(o);
      for (const o of c.powers) this.powers.push(o);
    }
  }

  private height() {
    return this.roll > 0 ? ROLL_H : PLAYER_H;
  }

  /** Walkable floor under the player in a lane (max over the player's z extent). */
  private floorAt(lane: number): number {
    const zA = this.dist - PLAYER_HALF, zB = this.dist + PLAYER_HALF;
    let f = 0;
    for (const o of this.obstacles) {
      if (o.lane !== lane || !isWall(o.kind) || o.z > zB || o.z1 < zA) continue;
      f = Math.max(f, surface(o, zA), surface(o, this.dist), surface(o, zB));
    }
    return f;
  }

  /** First obstacle the player body would hit in a lane at height y. */
  private hitTest(lane: number, y: number, h: number): Obstacle | null {
    const zA = this.dist - PLAYER_HALF, zB = this.dist + PLAYER_HALF;
    for (const o of this.obstacles) {
      if (o.lane !== lane || o.z > zB || o.z1 < zA) continue;
      if (o.kind === "low" || o.kind === "high") {
        const y0 = o.kind === "low" ? LOW_Y0 : HIGH_Y0;
        const y1 = o.kind === "low" ? LOW_Y1 : HIGH_Y1;
        if (y < y1 && y + h > y0) return o;
      } else {
        const step = o.kind === "ramp" ? RAMP_STEP : WALL_STEP;
        const s = Math.max(surface(o, Math.min(zB, o.z1)), surface(o, this.dist));
        if (s > 0 && y < s - step) return o;
      }
    }
    return null;
  }

  private canEnter(lane: number): boolean {
    if (this.invuln === 0 && this.hitTest(lane, this.y, this.height())) return false;
    return this.floorAt(lane) <= this.y + 0.05;
  }

  private switchLane(dir: number) {
    const target = this.lane + dir;
    if (target < 0 || target >= LANES) return;
    if (!this.canEnter(target)) {
      this.events.push({ t: "bump", sfx: "wall", shake: 3, dir });
      return;
    }
    this.lane = target;
    this.events.push({ t: "lane", dir });
  }

  private jump() {
    if (this.hover > 0 || !this.grounded) return;
    this.vy = JUMP_V;
    this.grounded = false;
    this.roll = 0;
    this.rollQueued = false;
    this.events.push({ t: "jump", sfx: "launch" });
  }

  private duck() {
    if (this.hover > 0) return;
    if (this.grounded) {
      this.roll = ROLL_FRAMES;
      this.events.push({ t: "roll" });
    } else {
      this.vy = Math.min(this.vy, FAST_FALL_V);
      this.rollQueued = true;
      this.events.push({ t: "dive" });
    }
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.done) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    if (this.invuln > 0) this.invuln--;
    if (this.magnet > 0) this.magnet--;
    if (this.double > 0) this.double--;
    if (this.hover > 0 && --this.hover === 0) {
      this.invuln = HOVER_GRACE;
      this.vy = 0;
      this.events.push({ t: "hoverEnd" });
    }

    if (pressed & BTN.LEFT) this.switchLane(-1);
    if (pressed & BTN.RIGHT) this.switchLane(1);
    if (pressed & (BTN.UP | BTN.FIRE)) this.jump();
    if (pressed & BTN.DOWN) this.duck();

    if (this.speed < MAX_SPEED) this.speed = Math.min(MAX_SPEED, this.speed + ACCEL);
    else if (this.speed < LATE_MAX_SPEED) this.speed = Math.min(LATE_MAX_SPEED, this.speed + LATE_ACCEL);
    this.dist += this.speed;
    if (this.laneX < this.lane) this.laneX = Math.min(this.lane, this.laneX + LANE_SLIDE);
    else if (this.laneX > this.lane) this.laneX = Math.max(this.lane, this.laneX - LANE_SLIDE);
    this.fill();

    // Collisions (before the floor snaps the player onto anything).
    if (this.invuln === 0) {
      const o = this.hitTest(this.lane, this.y, this.height());
      if (o) {
        if (this.shield) {
          this.shield = false;
          this.invuln = SHIELD_GRACE;
          this.obstacles = this.obstacles.filter((q) => q !== o);
          this.events.push({ t: "smash", sfx: "explode", shake: 6, lane: o.lane, z: this.dist + PLAYER_HALF, kind: o.kind });
        } else {
          this.dead = true;
          this.crash = { lane: this.lane, z: this.dist + PLAYER_HALF, kind: o.kind };
          this.events.push({ t: "crash", sfx: "lost", mood: "sad", shake: 12, toast: "lifeLost", kind: o.kind });
          this.events.push({ t: "gameover", sfx: "gameover" });
          return;
        }
      }
    }

    this.physics();
    this.pickups();

    const behind = this.dist - 10;
    if (this.obstacles.length && this.obstacles[0].z1 < behind) this.obstacles = this.obstacles.filter((o) => o.z1 >= behind);
    if (this.coins.length && this.coins[0].z < this.dist - 2) this.coins = this.coins.filter((c) => c.z >= this.dist - 2);
    if (this.powers.length && this.powers[0].z < this.dist - 2) this.powers = this.powers.filter((c) => c.z >= this.dist - 2);

    if (this.score >= this.nextMilestone) {
      this.events.push({ t: "milestone", sfx: "extraGood", mood: "happy", value: this.nextMilestone });
      this.nextMilestone += MILESTONE;
    }
    if (this.frame >= MAX_FRAMES) {
      this.timeUp = true;
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  private physics() {
    const floor = this.floorAt(this.lane);
    if (this.hover > 0) {
      this.y += (HOVER_Y - this.y) * 0.1;
      if (this.y < floor) this.y = floor;
      this.vy = 0;
      this.grounded = false;
      this.roll = 0;
      return;
    }
    if (!this.grounded || this.y > floor) {
      this.vy -= GRAVITY;
      this.y += this.vy;
    }
    if (this.y <= floor) {
      const wasAir = !this.grounded;
      this.y = floor;
      this.vy = 0;
      this.grounded = true;
      if (wasAir) {
        this.events.push({ t: "land" });
        if (this.rollQueued) {
          this.roll = ROLL_FRAMES;
          this.rollQueued = false;
        }
      }
    } else this.grounded = false;
    if (this.roll > 0) this.roll--;
  }

  private pickups() {
    const pz = this.dist;
    const y = this.y, h = this.height();
    const value = this.double > 0 ? 2 : 1;
    let got = 0;
    this.coins = this.coins.filter((c) => {
      const near = c.lane === this.lane && Math.abs(c.z - pz) < 0.6 && c.y > y - 0.25 && c.y < y + h + 0.35;
      const pulled = this.magnet > 0 && c.z > pz - 0.5 && c.z < pz + MAGNET_REACH;
      if (!near && !pulled) return true;
      got++;
      return false;
    });
    if (got) {
      this.coinCount += got * value;
      this.coinPoints += got * value;
      this.events.push({ t: "coin", sfx: "brick", n: got, value });
    }
    this.powers = this.powers.filter((p) => {
      if (p.lane !== this.lane || Math.abs(p.z - pz) > 0.7 || y > 1.4) return true;
      this.activate(p.kind);
      return false;
    });
  }

  private activate(kind: PowerKind) {
    if (kind === "magnet") this.magnet = MAGNET_FRAMES;
    else if (kind === "double") this.double = DOUBLE_FRAMES;
    else if (kind === "shield") this.shield = true;
    else {
      this.hover = HOVER_FRAMES;
      this.roll = 0;
      this.rollQueued = false;
      // A trail of sky coins along the ride.
      const rng = this.gen.rng;
      let lane = this.lane;
      const end = this.dist + this.speed * (HOVER_FRAMES - 50);
      for (let z = this.dist + 8; z < end; z += 2.5) {
        if (rng.int(8) === 0) lane = Math.max(0, Math.min(2, lane + (rng.int(2) ? 1 : -1)));
        this.coins.push({ lane, z, y: HOVER_Y + 0.4 });
      }
      this.coins.sort((a, b) => a.z - b.z);
    }
    this.events.push({ t: "power", kind, sfx: "extraGood", mood: "happy" });
  }

  view(): LanesView {
    const far = this.dist + SPAWN_AHEAD;
    return {
      frame: this.frame,
      dist: this.dist,
      speed: this.speed,
      lane: this.lane,
      laneX: this.laneX,
      y: this.y,
      vy: this.vy,
      airborne: !this.grounded,
      roll: this.roll,
      hover: this.hover,
      magnet: this.magnet,
      double: this.double,
      shield: this.shield,
      invuln: this.invuln,
      obstacles: this.obstacles.filter((o) => o.z < far),
      coins: this.coins.filter((c) => c.z < far),
      powers: this.powers.slice(),
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

/** How safe a lane is: distance to the first solid wall ahead, -1/-100 if unreachable now. */
function laneValue(v: LanesView, l: number, look: number): number {
  const pz = v.dist;
  let free = look + 1;
  for (const o of v.obstacles) {
    if (o.lane !== l || o.z1 < pz - PLAYER_HALF) continue;
    if (isWall(o.kind)) {
      const overlapping = o.z <= pz + PLAYER_HALF + v.speed * 3;
      if (overlapping) {
        const s = Math.max(surface(o, pz + PLAYER_HALF), surface(o, pz));
        if (v.y >= WALL_H - 0.05 || (s > 0 && v.y >= s - 0.05)) continue; // on top of it (or above)
        if (l === v.lane && o.kind === "ramp") continue; // running up its ramp
        return l === v.lane ? -1 : -100;
      }
      if (o.kind === "wall" && v.y < WALL_H - 0.1) free = Math.min(free, o.z - pz);
    } else if (l !== v.lane && o.z - pz < 1.4 + v.speed * 6) {
      return -50; // would bump into it from the side
    }
  }
  if (free > look) {
    let coins = 0;
    for (const c of v.coins) if (c.lane === l && c.z > pz && c.z < pz + look * 0.5 && c.y < v.y + 1.4) coins++;
    free += Math.min(coins, 6) * 0.5;
  }
  return free;
}

export const lanes: GameDef<LanesView> = {
  id: "lanes",
  name: "Moon Dash 3",
  tagline: "Three lanes, one moon. Dodge the candle walls, grab the coins, never stop running.",
  genre: "3-lane endless runner",
  session: "1–4 min",
  controls: "Left / Right or swipe to change lane, Up / swipe up / tap to jump, Down / swipe down to roll (or drop fast).",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes:
      "Original three-lane runner written for ArcadePad: lane/height/distance engine, chunked deterministic track generator with fairness rules, power-ups and pseudo-3D renderer are all ours. No code, names, characters or art from any commercial lane-runner game.",
  },
  create: (seed) => new LanesEngine(seed),
  bot(v, frame) {
    const idle = { x: 0, y: 0, b: 0 };
    if (v.dead || frame & 1) return idle;
    // Occasional "distracted" second so attract-mode runs end eventually.
    const win = Math.floor(frame / 80);
    if (frame > 900 && hash32(win) % 37 === 0) return idle;

    const pz = v.dist;
    const look = v.speed * 70 + 8;
    let b = 0;

    if (v.hover > 0) {
      // Follow the sky coins.
      const c = v.coins.find((q) => q.z > pz + 1 && q.y > 2);
      if (c && c.lane !== v.lane) b |= c.lane < v.lane ? BTN.LEFT : BTN.RIGHT;
      return { x: 0, y: 0, b };
    }

    const vals = [0, 1, 2].map((l) => laneValue(v, l, look));
    let best = v.lane;
    for (let l = 0; l < LANES; l++) {
      const bonus = l === v.lane ? 0.3 : -Math.abs(l - v.lane) * 0.2;
      const cur = vals[best] + (best === v.lane ? 0.3 : -Math.abs(best - v.lane) * 0.2);
      if (vals[l] + bonus > cur) best = l;
    }
    if (best !== v.lane) {
      const dir = best < v.lane ? -1 : 1;
      if (vals[v.lane + dir] > -50) b |= dir < 0 ? BTN.LEFT : BTN.RIGHT;
    }

    // Hurdles and signs in the lane we will be in after this frame.
    const actLane = b & BTN.LEFT ? v.lane - 1 : b & BTN.RIGHT ? v.lane + 1 : v.lane;
    let next: Obstacle | null = null;
    for (const o of v.obstacles) {
      if (o.lane !== actLane || isWall(o.kind) || o.z1 < pz - PLAYER_HALF) continue;
      if (!next || o.z < next.z) next = o;
    }
    if (next) {
      const d = next.z - pz;
      const rollCovers = v.roll * v.speed > d + BAR_DEPTH + PLAYER_HALF + 0.2;
      if (v.airborne) {
        // Predict our height when the obstacle reaches us; dive if we would hit it.
        const t = Math.max(0, (d - PLAYER_HALF) / v.speed);
        const yAt = v.y + v.vy * t - (GRAVITY * t * t) / 2;
        const top = next.kind === "low" ? LOW_Y1 : HIGH_Y1;
        if (d < v.speed * 14 + 1 && yAt < top + 0.05) b |= BTN.DOWN;
      } else if (next.kind === "high") {
        if (d < v.speed * 7 + 0.6 && !rollCovers) b |= BTN.DOWN;
      } else if (!rollCovers && d < v.speed * 16 + 0.3) {
        if (d > v.speed * 9 + 0.3) b |= BTN.UP;
        else b |= BTN.DOWN; // too late for a clean jump: roll under
      }
    }
    return { x: 0, y: 0, b };
  },
};
