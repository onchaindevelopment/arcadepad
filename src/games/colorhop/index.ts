/*
 * Color Hop: tap to hop upward through spinning multicoloured obstacles.
 * Original ArcadePad design of the "colour-matching hopper" genre, written
 * from scratch (no code, art, obstacle set or sounds from any existing game).
 * ArcadePad, GPL-3.0-or-later.
 *
 * Rules: the mascot ball has one of 4 colours. Tap gives an upward impulse,
 * gravity pulls down. Every obstacle is made of 4 colours; touching a part
 * whose colour differs from yours ends the run, matching parts let you pass.
 * Colour orbs between obstacles switch your colour, coins score 1 point.
 * Falling below the screen ends the run. Obstacles speed up as you climb.
 *
 * Obstacles (all original): rotating rings, concentric counter-rings,
 * sliding bars (single and opposed pairs), side-mounted spinning crosses and
 * a wheel of rotating coins.
 *
 * Determinism: rotation is an integer "fine angle" (4096 per turn) advanced
 * by an integer speed per frame and evaluated with a linearly interpolated
 * core/trig table. Collision samples 9 points of the ball and asks each
 * part which colour (if any) is at that point.
 */
import { Rng } from "../core/rng.ts";
import { SIN256, angle256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const BALL_X = W / 2;
export const BALL_R = 10;
export const COLOURS = 4;
/** Fine angles per turn. */
export const TURN = 4096;

export const GRAVITY = 0.3;
export const HOP_V = -6.2;
export const MAX_FALL = 9;
/** The camera keeps the ball at least this far below the top of the screen. */
export const CAM_OFF = 330;
const START_Y = 450;
const AUTO_START = 150;
const HOP_KEYS = BTN.FIRE | BTN.UP;
const COIN_R = 11;
const ORB_R = 11;
const LEVEL_EVERY = 5;

export type PartKind = "ring" | "bar" | "cross" | "wheel";

/**
 * One moving piece. Angle/offset at frame f = phase + speed * f (integers,
 * fine angles for rotating parts, 1/16 px for bars).
 *  ring:  size = radius, thick = band width
 *  bar:   size = segment width (4 segments repeat), thick = bar height
 *  cross: size = arm length, thick = arm width
 *  wheel: size = wheel radius, thick = coin radius, n = coins
 */
export interface Part {
  k: PartKind;
  cx: number;
  cy: number;
  size: number;
  thick: number;
  n: number;
  phase: number;
  speed: number;
}

export type GroupKind = "ring" | "ring2" | "bars" | "bars2" | "cross" | "wheel";

export interface Group {
  id: number;
  kind: GroupKind;
  top: number;
  bottom: number;
  parts: Part[];
  coinY: number;
  coinTaken: boolean;
  /** Colour orb above this group (between it and the next). */
  orbY: number;
  orbColour: number;
  orbTaken: boolean;
  passed: boolean;
}

export interface HopView {
  frame: number;
  state: "ready" | "play" | "dead";
  y: number;
  vy: number;
  colour: number;
  camY: number;
  groups: Group[];
  score: number;
  level: number;
  sinceHop: number;
  sinceSwap: number;
}

// ---------- deterministic maths ----------

/** sin of a fine angle (4096 per turn), linear between the 256-step table entries. */
export function sinF(a: number): number {
  a &= TURN - 1;
  const i = a >> 4;
  const f = (a & 15) / 16;
  const s0 = SIN256[i];
  const s1 = SIN256[(i + 1) & 255];
  return s0 + (s1 - s0) * f;
}
export function cosF(a: number): number {
  return sinF(a + 1024);
}

export function partPos(p: Part, frame: number): number {
  return p.phase + p.speed * frame;
}

function mod(a: number, m: number): number {
  const r = a % m;
  return r < 0 ? r + m : r;
}

/** Colour index of part p at point (px, py), or -1 if the point is empty. */
export function colourAt(p: Part, pos: number, px: number, py: number): number {
  const dx = px - p.cx;
  const dy = py - p.cy;
  switch (p.k) {
    case "ring": {
      const d2 = dx * dx + dy * dy;
      const r0 = p.size - p.thick / 2, r1 = p.size + p.thick / 2;
      if (d2 < r0 * r0 || d2 > r1 * r1) return -1;
      const a = angle256(dx, dy) * 16;
      return mod(a - pos, TURN) >> 10;
    }
    case "bar": {
      if (dy < -p.thick / 2 || dy > p.thick / 2) return -1;
      const off = pos / 16;
      return Math.floor(mod(px - off, p.size * COLOURS) / p.size);
    }
    case "cross": {
      const c = cosF(pos), s = sinF(pos);
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const h = p.thick / 2, L = p.size;
      if (ly >= -h && ly <= h) {
        if (lx >= -h && lx <= L) return 0;
        if (lx <= h && lx >= -L) return 2;
      }
      if (lx >= -h && lx <= h) {
        if (ly >= -h && ly <= L) return 1;
        if (ly <= h && ly >= -L) return 3;
      }
      return -1;
    }
    case "wheel": {
      const r2 = p.thick * p.thick;
      for (let k = 0; k < p.n; k++) {
        const a = pos + Math.floor((k * TURN) / p.n);
        const ex = dx - p.size * cosF(a);
        const ey = dy - p.size * sinF(a);
        if (ex * ex + ey * ey <= r2) return k % COLOURS;
      }
      return -1;
    }
  }
  return -1;
}

// Ball sample points: centre + 8 on the rim.
const PTS: [number, number][] = [[0, 0]];
for (let k = 0; k < 8; k++) PTS.push([BALL_R * SIN256[(k * 32 + 64) & 255], BALL_R * SIN256[(k * 32) & 255]]);

export interface Hit {
  colour: number;
  x: number;
  y: number;
}

/** First wrong-coloured contact for a ball of `colour` at height y on `frame`, or null. */
export function findHit(groups: readonly Group[], frame: number, y: number, colour: number): Hit | null {
  for (const g of groups) {
    if (g.bottom < y - BALL_R - 2 || g.top > y + BALL_R + 2) continue;
    for (const p of g.parts) {
      const pos = partPos(p, frame);
      for (const [ox, oy] of PTS) {
        const c = colourAt(p, pos, BALL_X + ox, y + oy);
        if (c >= 0 && c !== colour) return { colour: c, x: BALL_X + ox, y: y + oy };
      }
    }
  }
  return null;
}

// ---------- engine ----------

class HopEngine implements GameEngine<HopView> {
  private rng: Rng;
  private prevB = 0;
  private state: "ready" | "play" | "dead" = "ready";
  private y = START_Y;
  private vy = 0;
  private colour: number;
  private camY = 0;
  private groups: Group[] = [];
  private nextBottom = 250;
  private made = 0;
  private nextId = 0;
  private score = 0;
  private passed = 0;
  private level = 0;
  private sinceHop = 999;
  private sinceSwap = 999;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.colour = this.rng.int(COLOURS);
    this.generate();
  }

  private speedOf(base: number): number {
    const diff = Math.min(this.made, 36);
    const s = Math.round((base * (32 + diff)) / 32);
    return this.rng.int(2) ? s : -s;
  }

  private pickKind(): GroupKind {
    const i = this.made;
    if (i === 0) return "ring";
    if (i === 1) return "bars";
    if (i === 2) return "wheel";
    const pool: GroupKind[] = ["ring", "bars", "wheel", "cross"];
    if (i >= 4) pool.push("bars2");
    if (i >= 7) pool.push("ring2");
    if (i >= 10) pool.push("ring", "cross", "bars2", "wheel");
    return pool[this.rng.int(pool.length)];
  }

  private makeGroup(bottom: number): Group {
    const kind = this.pickKind();
    const ph = () => this.rng.int(TURN);
    const parts: Part[] = [];
    let top: number, coinY: number;
    switch (kind) {
      case "ring": {
        const R = 76 + this.rng.int(3) * 6, T = 16;
        const cy = bottom - R - T / 2;
        parts.push({ k: "ring", cx: BALL_X, cy, size: R, thick: T, n: 0, phase: ph(), speed: this.speedOf(16) });
        top = cy - R - T / 2;
        coinY = cy;
        break;
      }
      case "ring2": {
        const cy = bottom - 113;
        const sp = this.speedOf(11);
        parts.push({ k: "ring", cx: BALL_X, cy, size: 106, thick: 14, n: 0, phase: ph(), speed: sp });
        parts.push({ k: "ring", cx: BALL_X, cy, size: 66, thick: 14, n: 0, phase: ph(), speed: -Math.round(sp * 0.6) });
        top = cy - 113;
        coinY = cy;
        break;
      }
      case "bars": {
        const cy = bottom - 9;
        parts.push({ k: "bar", cx: 0, cy, size: 96, thick: 18, n: 0, phase: this.rng.int(96 * 4 * 16), speed: this.speedOf(24) });
        coinY = cy - 62;
        top = coinY - COIN_R - 4;
        break;
      }
      case "bars2": {
        // Two opposed bars with room to hover between them (coin in the middle).
        const cy1 = bottom - 9, cy2 = cy1 - 124;
        const sp = this.speedOf(22);
        parts.push({ k: "bar", cx: 0, cy: cy1, size: 100, thick: 18, n: 0, phase: this.rng.int(100 * 4 * 16), speed: sp });
        parts.push({ k: "bar", cx: 0, cy: cy2, size: 100, thick: 18, n: 0, phase: this.rng.int(100 * 4 * 16), speed: -sp });
        coinY = (cy1 + cy2) / 2;
        top = cy2 - 9;
        break;
      }
      case "cross": {
        const side = this.rng.int(2) ? 1 : -1;
        const L = 100, off = 70;
        const reach = Math.ceil(Math.sqrt(L * L - off * off)) + 10;
        const cy = bottom - reach;
        parts.push({ k: "cross", cx: BALL_X + side * off, cy, size: L, thick: 16, n: 0, phase: ph(), speed: this.speedOf(11) });
        top = cy - reach;
        coinY = cy;
        break;
      }
      case "wheel": {
        const R = 84, cr = 15;
        const cy = bottom - R - cr;
        parts.push({ k: "wheel", cx: BALL_X, cy, size: R, thick: cr, n: 8, phase: ph(), speed: this.speedOf(12) });
        top = cy - R - cr;
        coinY = cy;
        break;
      }
    }
    const gap = Math.max(130, 180 - this.made * 2);
    const orbY = top - gap / 2;
    const orbColour = (this.colourAfter() + 1 + this.rng.int(COLOURS - 1)) % COLOURS;
    this.nextBottom = top - gap;
    this.made++;
    return { id: this.nextId++, kind, top, bottom, parts, coinY, coinTaken: false, orbY, orbColour, orbTaken: false, passed: false };
  }

  /** Colour the ball will have when it reaches the next group generated. */
  private colourAfter(): number {
    return this.groups.length ? this.groups[this.groups.length - 1].orbColour : this.colour;
  }

  private generate() {
    while (this.nextBottom > this.camY - 450) this.groups.push(this.makeGroup(this.nextBottom));
    while (this.groups.length && this.groups[0].top > this.camY + H + 60) this.groups.shift();
  }

  private hop() {
    this.vy = HOP_V;
    this.sinceHop = 0;
    this.events.push({ t: "hop", sfx: "launch", quiet: true, x: BALL_X, y: this.y - this.camY });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.state === "dead") return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    this.sinceHop++;
    this.sinceSwap++;

    if (this.state === "ready") {
      if (pressed & HOP_KEYS || this.frame >= AUTO_START) {
        this.state = "play";
        this.hop();
      }
      return;
    }

    if (pressed & HOP_KEYS) this.hop();
    this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);
    this.y += this.vy;
    if (this.y - CAM_OFF < this.camY) this.camY = this.y - CAM_OFF;

    if (this.y - BALL_R > this.camY + H) {
      this.die(BALL_X, this.camY + H - 4, -1);
      return;
    }

    for (const g of this.groups) {
      if (!g.coinTaken && Math.abs(g.coinY - this.y) < BALL_R + COIN_R) {
        g.coinTaken = true;
        this.score++;
        this.events.push({ t: "coin", sfx: "brick", x: BALL_X, y: g.coinY - this.camY, score: this.score });
      }
      if (!g.orbTaken && Math.abs(g.orbY - this.y) < BALL_R + ORB_R) {
        g.orbTaken = true;
        this.sinceSwap = 0;
        const from = this.colour;
        this.colour = g.orbColour;
        this.events.push({ t: "swap", sfx: "extraGood", x: BALL_X, y: g.orbY - this.camY, from, colour: this.colour });
      }
      if (!g.passed && this.y + BALL_R < g.top) {
        g.passed = true;
        this.passed++;
        if (this.passed % LEVEL_EVERY === 0) {
          this.level++;
          this.events.push({ t: "levelup", sfx: "levelclear", mood: "happy", level: this.level, x: BALL_X, y: this.y - this.camY - 30 });
        }
      }
    }

    const hit = findHit(this.groups, this.frame, this.y, this.colour);
    if (hit) {
      this.die(hit.x, hit.y - this.camY, hit.colour);
      return;
    }
    this.generate();
  }

  private die(x: number, sy: number, colour: number) {
    this.state = "dead";
    this.events.push({ t: "hit", sfx: "explode", mood: "sad", shake: 10, x, y: sy, colour, ball: this.colour });
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  view(): HopView {
    return {
      frame: this.frame,
      state: this.state,
      y: this.y,
      vy: this.vy,
      colour: this.colour,
      camY: this.camY,
      groups: this.groups.map((g) => ({ ...g, parts: g.parts.map((p) => ({ ...p })) })),
      score: this.score,
      level: this.level,
      sinceHop: this.sinceHop,
      sinceSwap: this.sinceSwap,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level + 1, label: this.state === "ready" ? "Tap to hop" : undefined };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.level, frames: this.frame, status: this.state === "dead" ? "over" : "playing" };
  }
  get done() {
    return this.state === "dead";
  }
}

// ---------- bot ----------

/** Deterministic per-frame noise for the bot (0..1023). */
function noise(frame: number, salt: number): number {
  let h = (frame + Math.imul(salt + 1, 0x9e3779b9)) | 0;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 1023;
}

/**
 * Frames survived (up to horizon) under a simple plan: optionally hop now,
 * then either hop every `cadence` frames (climb) or hop whenever the ball
 * falls to `hover` (hold position).
 */
function survive(v: HopView, tapNow: boolean, cadence: number, hover: number, horizon: number): number {
  let y = v.y, vy = v.vy, col = v.colour, cam = v.camY;
  let since = tapNow ? 0 : v.sinceHop;
  const taken = new Set<number>();
  for (let i = 0; i < horizon; i++) {
    const f = v.frame + 1 + i;
    let tap = false;
    if (i === 0) tap = tapNow;
    else if (since >= 2) tap = cadence > 0 ? since >= cadence : vy > 0 && y >= hover;
    if (tap) {
      vy = HOP_V;
      since = 0;
    } else since++;
    vy = Math.min(vy + GRAVITY, MAX_FALL);
    y += vy;
    if (y - CAM_OFF < cam) cam = y - CAM_OFF;
    if (y - BALL_R > cam + H) return i;
    for (const g of v.groups) {
      if (!g.orbTaken && !taken.has(g.id) && Math.abs(g.orbY - y) < BALL_R + ORB_R) {
        taken.add(g.id);
        col = g.orbColour;
      }
    }
    if (findHit(v.groups, f, y, col)) return i;
  }
  return horizon;
}

function bestPlan(v: HopView, tapNow: boolean, horizon: number): number {
  let best = 0;
  for (const c of [12, 16, 22]) {
    best = Math.max(best, survive(v, tapNow, c, 0, horizon));
    if (best >= horizon) return best;
  }
  for (const d of [0, 30, 60]) {
    best = Math.max(best, survive(v, tapNow, 0, v.y + d, horizon));
    if (best >= horizon) return best;
  }
  return best;
}

export const colorhop: GameDef<HopView> = {
  id: "colorhop",
  name: "Color Hop",
  tagline: "Hop up through spinning colours. Only your colour lets you through.",
  genre: "Colour-matching hopper",
  session: "30 s–4 min",
  controls: "Tap, click, Space or Up to hop.",
  field: { w: W, h: H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the colour-matching hopper genre with its own obstacle set (rings, counter-rings, sliding bars, side crosses, coin wheels). No code, art, sounds or names from any existing game.",
  },
  create: (seed) => new HopEngine(seed),
  bot(v, frame) {
    if (v.state === "dead") return { x: 0, y: 0, b: 0 };
    if (v.state === "ready") return { x: 0, y: 0, b: frame > 40 && frame % 2 === 0 ? BTN.FIRE : 0 };
    if (v.sinceHop < 2) return { x: 0, y: 0, b: 0 };
    const horizon = 40 + (noise(frame, 7) % 16);
    const tapS = bestPlan(v, true, horizon);
    const waitS = bestPlan(v, false, horizon);
    let tap = tapS >= horizon && waitS >= horizon ? v.vy > -1.5 : tapS > waitS;
    const salt = v.groups.length ? v.groups[0].parts[0].phase : 0;
    if (noise(frame, salt) === 0 && noise(frame, 77) < 384) tap = !tap; // occasional slip
    return { x: 0, y: 0, b: tap ? BTN.FIRE : 0 };
  },
};
