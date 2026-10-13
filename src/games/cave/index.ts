/*
 * Moon Tunnel: an original hold-to-rise cave flyer (the genre of the classic
 * one-button tunnel games). No code was ported; this is an in-house design.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Rules: hold FIRE or UP to fire the rocket (thrust beats gravity), let go to
 * fall. Velocity has inertia and a little drag, so the ride is smooth and a
 * bit floaty. The tunnel's centre follows a damped random walk towards
 * random targets, its gap narrows with distance and the scroll speed creeps
 * up. Rock drips, rising spikes and floating boulders appear now and then;
 * coins line the way. Touching rock ends the run.
 * Score = metres flown (distance / 10) + 25 per coin.
 *
 * Fairness: the tunnel slope is capped so that following it never needs more
 * than a fraction of the rocket's vertical speed at the current scroll speed,
 * the gap never drops below GAP_MIN (+ bump margin), obstacles always leave
 * a passage of at least PASS_MIN and are spaced so the rocket can switch
 * sides between two of them. cave.test.ts proves passability with a
 * reachable-set search over long generated tunnels.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 600;
export const H = 340;
/** Rocket centre x on screen. */
export const PLAYER_X = 140;
/** Hitbox half size (rocket body + rider). */
export const HW = 11;
export const HH = 7;
/** Tunnel is sampled every COL_W px; walls are straight lines between samples. */
export const COL_W = 8;
/** Minimum rock thickness at the top and bottom of the screen. */
export const EDGE = 10;
export const OBS_W = 24;
export const COIN_R = 7;
export const START_Y = H / 2;
export const METRES_PER_MILESTONE = 500;
export const COIN_POINTS = 25;

// Physics (per 1/60 s frame).
export const GRAV = 0.17;
export const THRUST = 0.34;
export const DRAG = 0.985;
export const VY_MAX = 4.2;

// Difficulty curve (x and d in world px).
const SPEED0 = 2.6;
const SPEED_MAX = 5.6;
const SPEED_RAMP = 3 / 32000;
const GAP0 = 236;
export const GAP_MIN = 100;
const GAP_RAMP = (GAP0 - GAP_MIN) / 36000;
/** Wall bumps only ever eat into the gap, by at most this much per side. */
const BUMP = 4;
/** Vertical speed needed to follow the tunnel slope, px/frame. */
const FOLLOW_VY = 2.0;
export const PASS_MIN = 64;
const START_COLS = 90; // straight, wide run-up
const AUTO_START = 180;
const LAUNCH_GAP = 20; // min frames between "launch" sounds
const NEAR = 5; // clearance (px) that counts as a near miss
const NEAR_GAP = 45;
const THRUST_KEYS = BTN.FIRE | BTN.UP;

export function speedAt(d: number): number {
  return Math.min(SPEED_MAX, SPEED0 + d * SPEED_RAMP);
}
export function gapAt(x: number): number {
  return Math.max(GAP_MIN, GAP0 - x * GAP_RAMP);
}

/** One frame of rocket physics. Shared by the engine and the fairness test. */
export function stepBody(y: number, vy: number, hold: boolean): [number, number] {
  vy += GRAV;
  if (hold) vy -= THRUST;
  vy *= DRAG;
  if (vy > VY_MAX) vy = VY_MAX;
  else if (vy < -VY_MAX) vy = -VY_MAX;
  return [y + vy, vy];
}

export type ObstacleKind = "drip" | "rise" | "boulder";
export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  x: number; // world x of the left edge
  w: number;
  top: number;
  bot: number;
}
export interface Coin {
  id: number;
  x: number; // world x
  y: number;
  taken: boolean;
}

/** Hit codes from Cave.hits. */
export const HIT_NONE = 0;
export const HIT_CEIL = 1;
export const HIT_FLOOR = 2;
export const HIT_ROCK = 3;

/**
 * The tunnel: generated lazily, column by column, from its own Rng. The
 * sequence never depends on the player, so a seed always gives the same cave.
 */
export class Cave {
  private rng: Rng;
  /** Column index of tops[0]. */
  base = 0;
  tops: number[] = [];
  bots: number[] = [];
  private next = 0;
  private c = START_Y;
  private cv = 0;
  private target = START_Y;
  private targetIn = 0;
  obstacles: Obstacle[] = [];
  coins: Coin[] = [];
  private nextId = 0;
  private nextObs = START_COLS + 30;
  private nextCoin = 40;
  private coinLeft = 0;
  private coinOff = 0;
  private lastCoinCol = -99;

  constructor(seed: number) {
    this.rng = new Rng(seed ^ 0x5eed7);
  }

  /** Make sure columns exist up to world x. */
  ensure(x: number) {
    while ((this.next - 1) * COL_W < x) this.gen();
  }

  /** Drop columns, obstacles and coins left of world x. */
  trim(x: number) {
    const keep = Math.floor(x / COL_W) - 1;
    const drop = keep - this.base;
    if (drop > 0) {
      this.tops.splice(0, drop);
      this.bots.splice(0, drop);
      this.base += drop;
    }
    if (this.obstacles.length && this.obstacles[0].x + this.obstacles[0].w < x) this.obstacles = this.obstacles.filter((o) => o.x + o.w >= x);
    if (this.coins.length && this.coins[0].x + COIN_R < x) this.coins = this.coins.filter((c) => c.x + COIN_R >= x);
  }

  private gen() {
    const rng = this.rng;
    const i = this.next++;
    const x = i * COL_W;
    const sp = speedAt(x);
    const g = i < START_COLS ? GAP0 : gapAt(x) + 2 * BUMP;
    const half = g / 2;
    const lo = EDGE + half;
    const hi = H - EDGE - half;
    if (i >= START_COLS) {
      if (--this.targetIn <= 0) {
        this.target = lo + rng.int(Math.floor(hi - lo) + 1);
        this.targetIn = 20 + rng.int(40);
      }
      const maxCv = Math.min(0.7, FOLLOW_VY / sp) * COL_W;
      const t = Math.min(hi, Math.max(lo, this.target));
      let acc = (t - this.c) * 0.004 - this.cv * 0.12;
      if (acc > 0.12) acc = 0.12;
      else if (acc < -0.12) acc = -0.12;
      this.cv += acc;
      if (this.cv > maxCv) this.cv = maxCv;
      else if (this.cv < -maxCv) this.cv = -maxCv;
      this.c += this.cv;
    }
    if (this.c < lo) {
      this.c = lo;
      if (this.cv < 0) this.cv = 0;
    } else if (this.c > hi) {
      this.c = hi;
      if (this.cv > 0) this.cv = 0;
    }
    const top = this.c - half + rng.int(BUMP + 1);
    const bot = this.c + half - rng.int(BUMP + 1);
    this.tops.push(top);
    this.bots.push(bot);

    // Coins: short runs along the tunnel, never next to an obstacle.
    if (this.coinLeft > 0) {
      if (i % 4 === 0) {
        const y = Math.min(bot - 16, Math.max(top + 16, this.c + this.coinOff));
        this.coins.push({ id: this.nextId++, x, y, taken: false });
        this.lastCoinCol = i;
        if (--this.coinLeft === 0) this.nextObs = Math.max(this.nextObs, i + 8);
      }
    } else if (i >= this.nextCoin && rng.int(100) < 5) {
      this.coinLeft = 3 + rng.int(4);
      const spread = Math.floor((half - 20) * 0.5);
      this.coinOff = rng.range(-spread, spread);
      this.nextCoin = i + 50 + rng.int(60);
    }

    // Obstacles: covering columns i-3..i.
    if (this.coinLeft === 0 && i >= this.nextObs && i > this.lastCoinCol + 8 && i >= START_COLS + 30) {
      const chance = 4 + Math.min(6, Math.floor(x / 5000));
      if (rng.int(100) < chance) this.placeObstacle(i, sp);
    }
  }

  private placeObstacle(i: number, sp: number) {
    const rng = this.rng;
    const k0 = i - 3 - this.base;
    let ceil = -Infinity, floor = Infinity;
    for (let k = k0; k <= i - this.base; k++) {
      ceil = Math.max(ceil, this.tops[k]);
      floor = Math.min(floor, this.bots[k]);
    }
    const avail = floor - ceil;
    const pass = PASS_MIN + Math.floor(sp * 2);
    let kind = rng.int(3);
    if (kind === 2 && avail < 2 * pass + 26) kind = rng.int(2);
    if (avail < pass + 22) return;
    const x = (i - 3) * COL_W;
    let top: number, bot: number;
    if (kind === 2) {
      const hb = 26 + rng.int(Math.min(30, Math.floor(avail - 2 * pass - 26)) + 1);
      top = ceil + pass + rng.int(Math.floor(avail - 2 * pass - hb) + 1);
      bot = top + hb;
    } else {
      const len = 22 + rng.int(Math.floor(avail - pass - 22) + 1);
      if (kind === 0) {
        top = ceil - 40;
        bot = ceil + len;
      } else {
        top = floor - len;
        bot = floor + 40;
      }
    }
    this.obstacles.push({ id: this.nextId++, kind: kind === 0 ? "drip" : kind === 1 ? "rise" : "boulder", x, w: OBS_W, top, bot });
    this.nextObs = i + Math.ceil((220 + sp * 45) / COL_W) + rng.int(30);
    this.nextCoin = Math.max(this.nextCoin, i + 8);
  }

  private colTop(k: number) {
    return this.tops[k - this.base];
  }
  private colBot(k: number) {
    return this.bots[k - this.base];
  }
  topAt(x: number): number {
    const k = Math.floor(x / COL_W);
    const f = (x - k * COL_W) / COL_W;
    if (f === 0) return this.colTop(k);
    return this.colTop(k) + (this.colTop(k + 1) - this.colTop(k)) * f;
  }
  botAt(x: number): number {
    const k = Math.floor(x / COL_W);
    const f = (x - k * COL_W) / COL_W;
    if (f === 0) return this.colBot(k);
    return this.colBot(k) + (this.colBot(k + 1) - this.colBot(k)) * f;
  }

  /** Lowest ceiling and highest floor over [l, r] (walls are piecewise linear). */
  span(l: number, r: number): [number, number] {
    let ceil = Math.max(this.topAt(l), this.topAt(r));
    let floor = Math.min(this.botAt(l), this.botAt(r));
    for (let k = Math.ceil(l / COL_W); k * COL_W <= r; k++) {
      const t = this.colTop(k), b = this.colBot(k);
      if (t > ceil) ceil = t;
      if (b < floor) floor = b;
    }
    return [ceil, floor];
  }

  /** Does the rocket hitbox centred at (px, y) touch rock? */
  hits(px: number, y: number): number {
    const l = px - HW, r = px + HW, t = y - HH, b = y + HH;
    const [ceil, floor] = this.span(l, r);
    if (t < ceil) return HIT_CEIL;
    if (b > floor) return HIT_FLOOR;
    for (const o of this.obstacles) {
      if (o.x > r) break;
      if (r > o.x && l < o.x + o.w && b > o.top && t < o.bot) return HIT_ROCK;
    }
    return HIT_NONE;
  }

  /** Smallest vertical clearance to rock; side -1 = above, 1 = below. */
  clearance(px: number, y: number): [number, number] {
    const l = px - HW, r = px + HW, t = y - HH, b = y + HH;
    const [ceil, floor] = this.span(l, r);
    let best = t - ceil, side = -1;
    if (floor - b < best) { best = floor - b; side = 1; }
    for (const o of this.obstacles) {
      if (o.x > r) break;
      if (r > o.x && l < o.x + o.w) {
        if (o.bot <= t && t - o.bot < best) { best = t - o.bot; side = -1; }
        if (o.top >= b && o.top - b < best) { best = o.top - b; side = 1; }
      }
    }
    return [best, side];
  }
}

export interface CaveView {
  frame: number;
  state: "ready" | "flying" | "dead";
  y: number;
  vy: number;
  /** Thrust held this frame (flame on). */
  thrust: boolean;
  /** World x of the left edge of the screen. */
  dist: number;
  speed: number;
  metres: number;
  coins: number;
  score: number;
  /** Visible wall samples: column k is at world x (col0 + k) * COL_W. */
  col0: number;
  tops: number[];
  bots: number[];
  obstacles: Obstacle[];
  coinList: Coin[];
  /** Smallest gap to rock (px) and which side it is on. */
  clear: number;
  clearSide: number;
}

class CaveEngine implements GameEngine<CaveView> {
  private cave: Cave;
  private state: "ready" | "flying" | "dead" = "ready";
  private y = START_Y;
  private vy = 0;
  private held = false;
  private prevB = 0;
  private dist = 0;
  private coins = 0;
  private milestones = 0;
  private lastLaunch = -999;
  private lastNear = -999;
  private clear = 99;
  private clearSide = 1;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.cave = new Cave(seed);
    this.cave.ensure(W + 64);
  }

  private metres() {
    return Math.floor(this.dist / 10);
  }
  private score() {
    return this.metres() + this.coins * COIN_POINTS;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.state === "dead") return;
    const pressed = inp.b & ~this.prevB & THRUST_KEYS;
    this.prevB = inp.b;
    this.held = (inp.b & THRUST_KEYS) !== 0;

    if (this.state === "ready") {
      if (!pressed && this.frame < AUTO_START) return;
      this.state = "flying";
    }
    if (pressed && this.frame - this.lastLaunch >= LAUNCH_GAP) {
      this.lastLaunch = this.frame;
      this.events.push({ t: "thrust", sfx: "launch", quiet: true, x: PLAYER_X - 16, y: this.y + 2 });
    }

    [this.y, this.vy] = stepBody(this.y, this.vy, this.held);
    this.dist += speedAt(this.dist);
    const cave = this.cave;
    cave.ensure(this.dist + W + 64);
    cave.trim(this.dist - 64);
    const px = this.dist + PLAYER_X;

    const hit = cave.hits(px, this.y);
    if (hit !== HIT_NONE) {
      this.state = "dead";
      this.held = false;
      const side = hit === HIT_CEIL ? "ceiling" : hit === HIT_FLOOR ? "floor" : "rock";
      this.events.push({ t: "crash", side, sfx: "explode", shake: 12, x: PLAYER_X, y: this.y });
      this.events.push({ t: "lost", sfx: "lost", mood: "sad" });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }

    for (const c of cave.coins) {
      if (c.x - COIN_R > px + HW) break;
      if (!c.taken && Math.abs(c.x - px) < HW + COIN_R && Math.abs(c.y - this.y) < HH + COIN_R) {
        c.taken = true;
        this.coins++;
        this.events.push({ t: "coin", sfx: "brick", x: c.x - this.dist, y: c.y, points: COIN_POINTS });
      }
    }

    const m = Math.floor(this.metres() / METRES_PER_MILESTONE);
    if (m > this.milestones) {
      this.milestones = m;
      this.events.push({ t: "milestone", metres: m * METRES_PER_MILESTONE, sfx: "extraGood", mood: "happy", x: PLAYER_X, y: this.y });
    }

    [this.clear, this.clearSide] = cave.clearance(px, this.y);
    if (this.clear < NEAR && this.frame - this.lastNear >= NEAR_GAP) {
      this.lastNear = this.frame;
      this.events.push({ t: "nearmiss", x: PLAYER_X, y: this.y + this.clearSide * (HH + this.clear) });
    }
  }

  view(): CaveView {
    const cave = this.cave;
    const k0 = Math.max(cave.base, Math.floor((this.dist - 16) / COL_W));
    const k1 = Math.ceil((this.dist + W + 16) / COL_W);
    const a = k0 - cave.base, b = k1 - cave.base + 1;
    const right = this.dist + W + 32;
    return {
      frame: this.frame,
      state: this.state,
      y: this.y,
      vy: this.vy,
      thrust: this.state === "flying" && this.held,
      dist: this.dist,
      speed: speedAt(this.dist),
      metres: this.metres(),
      coins: this.coins,
      score: this.score(),
      col0: k0,
      tops: cave.tops.slice(a, b),
      bots: cave.bots.slice(a, b),
      obstacles: cave.obstacles.filter((o) => o.x < right).map((o) => ({ ...o })),
      coinList: cave.coins.filter((c) => !c.taken && c.x < right).map((c) => ({ ...c })),
      clear: this.clear,
      clearSide: this.clearSide,
    };
  }
  hud(): Hud {
    return { score: this.score(), label: this.state === "ready" ? "Hold to fly" : `${this.metres()} m` };
  }
  result(): GameResult {
    return { score: this.score(), level: 0, levelsCleared: 0, frames: this.frame, status: this.state === "dead" ? "over" : "playing" };
  }
  get done() {
    return this.state === "dead";
  }
}

/** Deterministic per-frame noise for the bot (0..1023). */
function noise(n: number, salt: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 1023;
}

/** Middle of the open passage at world x, picking the wider side of an obstacle. */
function passageMid(v: CaveView, x: number): number {
  const k = Math.min(v.tops.length - 2, Math.max(0, Math.floor(x / COL_W) - v.col0));
  let top = v.tops[k], bot = v.bots[k];
  for (const o of v.obstacles) {
    if (o.x + o.w + 30 < x - 60 || o.x > x + 30) continue;
    const above = o.top - top, below = bot - o.bot;
    if (above >= below) bot = Math.min(bot, o.top);
    else top = Math.max(top, o.bot);
  }
  return (top + bot) / 2;
}

export const cave: GameDef<CaveView> = {
  id: "cave",
  name: "Moon Tunnel",
  tagline: "Hold to boost, let go to drop. Ride the rocket as deep as the cave goes.",
  genre: "Hold-to-rise cave flyer",
  session: "30 s–4 min",
  controls: "Hold Space, Up, click or touch to rise; let go to fall.",
  field: { w: W, h: H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the hold-to-rise tunnel genre. No code, art, sounds or levels from any existing game; the cave is generated from the seed and all art is drawn with the theme.",
  },
  create: (seed) => new CaveEngine(seed),
  bot(v, frame) {
    if (v.state !== "flying") return { x: 0, y: 0, b: v.state === "ready" && frame > 30 ? BTN.FIRE : 0 };
    const px = v.dist + PLAYER_X;
    const look = 30 + v.speed * 14;
    const target = (passageMid(v, px + look) * 2 + passageMid(v, px + look * 0.4)) / 3;
    // Imperfect: aim wobbles, and now and then the pilot dozes off for a moment.
    const window = Math.floor(frame / 50);
    const doze = noise(window, 11) < 20 + Math.min(40, Math.floor(v.metres / 100));
    const jitter = (noise(frame >> 3, 5) % 25) - 12;
    const hold = v.y + v.vy * 9 > target + jitter;
    return { x: 0, y: 0, b: hold !== (doze && (frame % 50) < 14) ? BTN.FIRE : 0 };
  },
};
