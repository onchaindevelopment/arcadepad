/*
 * Moon Sling: an original slingshot-physics puzzler for ArcadePad.
 * Original design, levels and physics written from scratch (genre: fling a
 * character at a tower). No code, level data, art or sound from any
 * commercial game. ArcadePad, GPL-3.0-or-later.
 *
 * The coin mascot sits in a spring-loaded "catapult cup" on the left. Drag
 * back and release (or aim with the arrows and press FIRE) to fling it at
 * structures of candle planks (wood), chart panes (glass) and vault blocks
 * (stone) that shelter grumpy FUD critters. Pop every critter to clear the
 * level; leftover launches are a bonus. A failed level ends the run.
 *
 * Physics (deterministic: only + - * / and Math.sqrt): fixed 60 Hz with 4
 * substeps. Blocks are axis-aligned boxes (no rotation), critters and shots
 * are circles. Contacts are solved with a sequential-impulse solver
 * (accumulated, clamped, warm-started impulses; Coulomb friction; restitution
 * above a speed threshold) followed by a split position correction. Bodies
 * fall asleep when slow for half a second; sleeping bodies are static and
 * cost nothing, and levels start fully asleep in exact resting contact, so
 * an untouched level never moves. Damage comes from the normal impulse of
 * each contact (impact speed above a threshold, shared by inverse mass).
 */
import { Rng } from "../core/rng.ts";
import { angle256, cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- constants

export const FIELD_W = 640;
export const FIELD_H = 360;
export const GROUND_Y = 330;
/** Centre of the catapult cup (where the mascot sits and launches from). */
export const CUP_X = 96;
export const CUP_Y = 256;
export const SHOT_R = 10;
export const MAX_PULL = 70;
const MIN_PULL = 8;
const GRAB_R = 28; // press within this of the cup: absolute drag; else relative drag
export const VMAX = 640; // launch speed at full pull, px/s
export const GRAVITY = 600; // px/s^2
export const SUB = 4;
export const H = 1 / (60 * SUB);
const MAX_V = 800;
const VEL_ITERS = 10;
const POS_ITERS = 3;
const TOUCH = 0.05; // contacts within this gap count as touching
const SLOP = 0.1;
const BETA = 0.5;
const BOUNCE_V = 60;
const WAKE_V = 15;
const SLEEP_V = 5;
const SLEEP_FRAMES = 30;
const DMG_TH = 60; // impact speed (px/s) below which nothing breaks
const DMG_K = 0.1;
const DUST_V = 110;
const GROUND_MU = 0.8;
const PI = 3.14159265;

const ANG_MIN = -60; // byte angle, 0 = right, -64 = straight up
const ANG_MAX = 8;
const PWR_MIN = 20;
const PWR_MAX = 100;

const SETTLE_FRAMES = 45; // everything asleep this long -> launch resolved
const CLEAR_FRAMES = 150;
const OVER_FRAMES = 90;
const FLY_CAP = 720; // stop waiting for things to settle after 12 s
const FORCE_SLEEP = 900;

export const PTS_CRITTER = 5000;
export const PTS_SPARE = 10000;

export type Mat = "chart" | "candle" | "vault";
export const MATS: Record<Mat, { density: number; hp: number; mu: number; e: number; pts: number }> = {
  chart: { density: 0.8, hp: 10, mu: 0.35, e: 0.1, pts: 500 }, // glass
  candle: { density: 1, hp: 24, mu: 0.6, e: 0.1, pts: 1000 }, // wood
  vault: { density: 2.5, hp: 60, mu: 0.7, e: 0.05, pts: 1500 }, // stone
};
const CRITTER = { density: 0.6, hp: 6, mu: 0.5, e: 0.3 };
const SHOT = { density: 4, mu: 0.5, e: 0.25 };

// ---------------------------------------------------------------- levels

/**
 * Pieces are placed in order and dropped straight down onto what is already
 * there (blocks: max top under their span; critters: max top under their
 * centre), so every level starts in exact resting contact.
 * Block: [W|G|S, left x, width, height]. Critter: [C, centre x, radius].
 */
type Piece = readonly ["W" | "G" | "S", number, number, number] | readonly ["C", number, number];
export interface LevelDef { name: string; shots: number; pieces: readonly Piece[] }

export const LEVELS: readonly LevelDef[] = [
  {
    name: "FIRST FLING", shots: 3, pieces: [
      ["W", 440, 10, 48], ["W", 490, 10, 48], ["W", 432, 76, 8], ["C", 470, 11], ["C", 560, 11],
    ],
  },
  {
    name: "GLASS HUT", shots: 3, pieces: [
      ["G", 420, 8, 44], ["C", 447, 11], ["G", 466, 8, 44], ["W", 412, 70, 8], ["C", 447, 11],
      ["G", 540, 8, 30], ["G", 580, 8, 30], ["G", 534, 60, 8], ["C", 564, 10],
    ],
  },
  {
    name: "TWO TOWERS", shots: 4, pieces: [
      ["W", 380, 10, 60], ["W", 420, 10, 60], ["S", 374, 62, 10], ["C", 405, 11],
      ["C", 470, 10],
      ["G", 520, 10, 80], ["G", 566, 10, 80], ["C", 548, 11], ["W", 512, 72, 8],
      ["G", 530, 8, 30], ["G", 560, 8, 30], ["W", 524, 52, 8], ["C", 550, 11],
    ],
  },
  {
    name: "VAULT DOOR", shots: 4, pieces: [
      ["S", 440, 20, 40], ["C", 485, 12], ["S", 500, 20, 40], ["S", 434, 92, 12],
      ["G", 446, 10, 34], ["G", 504, 10, 34], ["W", 440, 80, 8], ["C", 480, 11],
      ["W", 580, 12, 70], ["C", 586, 9],
    ],
  },
  {
    name: "CANDLE SKYLINE", shots: 4, pieces: [
      ["W", 360, 10, 70], ["W", 410, 10, 70], ["C", 390, 11], ["W", 354, 72, 8],
      ["W", 460, 10, 110], ["W", 510, 10, 110], ["C", 490, 11], ["W", 454, 72, 8], ["S", 470, 30, 24], ["C", 485, 10],
      ["G", 560, 10, 50], ["G", 600, 10, 50], ["W", 554, 62, 8], ["C", 585, 11],
    ],
  },
  {
    name: "CHART STAIRS", shots: 4, pieces: [
      ["G", 400, 40, 20], ["G", 440, 40, 40], ["G", 480, 40, 60], ["G", 520, 40, 80],
      ["C", 420, 10], ["C", 460, 10], ["C", 500, 10], ["C", 540, 10],
      ["S", 566, 20, 100], ["C", 606, 11],
    ],
  },
  {
    name: "STONE CRADLE", shots: 4, pieces: [
      ["S", 400, 16, 50], ["C", 443, 12], ["S", 470, 16, 50], ["S", 394, 98, 12],
      ["W", 410, 8, 40], ["W", 476, 8, 40], ["G", 404, 86, 8], ["C", 447, 11],
      ["S", 540, 16, 80], ["C", 578, 12], ["S", 600, 16, 80], ["W", 534, 88, 8], ["C", 578, 11],
    ],
  },
  {
    name: "MOON FORTRESS", shots: 4, pieces: [
      ["W", 370, 10, 40], ["W", 420, 10, 40], ["W", 364, 72, 8], ["C", 395, 11],
      ["S", 470, 20, 30], ["S", 560, 20, 30], ["C", 525, 12], ["W", 464, 122, 8],
      ["G", 480, 10, 40], ["G", 560, 10, 40], ["C", 520, 11], ["S", 474, 102, 12],
      ["W", 500, 10, 40], ["W", 540, 10, 40], ["G", 494, 62, 8], ["C", 520, 10],
      ["C", 612, 10],
    ],
  },
];

// ---------------------------------------------------------------- types

const K_BLOCK = 0;
const K_CRITTER = 1;
const K_SHOT = 2;

interface Body {
  id: number;
  kind: number; // K_BLOCK | K_CRITTER | K_SHOT
  mat: Mat | null;
  x: number; y: number; vx: number; vy: number;
  hw: number; hh: number; r: number; // boxes: half extents; circles: r (hw = hh = r)
  im: number; mu: number; e: number;
  hp: number; maxHp: number;
  asleep: boolean;
  still: number;
  dead: boolean;
}

interface Contact {
  a: Body; b: Body | null; // b null = ground
  nx: number; ny: number; pen: number; // normal from a to b, overlap depth
  ima: number; imb: number; mu: number; e: number; bias: number;
  jn: number; jt: number;
  ax: number; ay: number; bx: number; by: number; // positions at generation
  key: number;
}

export type Phase = "aim" | "fly" | "clear" | "over";

export interface BodyView {
  id: number;
  kind: "block" | "critter" | "shot";
  mat: Mat | null;
  x: number; y: number; hw: number; hh: number; r: number;
  vx: number; vy: number;
  hp: number; maxHp: number;
  asleep: boolean;
}

export interface AimView {
  dragging: boolean;
  dragT: number;
  /** False while a drag is inside the cancel zone. */
  valid: boolean;
  /** Launch velocity the shot would get now (px/s). */
  vx: number; vy: number;
  /** Mascot offset from the cup while dragging. */
  pullX: number; pullY: number;
  angle: number; // keyboard byte angle
  power: number; // keyboard power 20..100
}

export interface SlingView {
  frame: number;
  level: number; // 0-based
  loop: number;
  name: string;
  phase: Phase;
  phaseT: number;
  levelT: number;
  turn: number; // increments every time the launcher is (re)armed
  shotsLeft: number;
  shotsTotal: number;
  critters: number;
  score: number;
  bonus: number;
  bodies: BodyView[];
  active: number; // id of the shot in flight, -1 if none
  aim: AimView;
}

const KIND_NAME = ["block", "critter", "shot"] as const;

// ---------------------------------------------------------------- collision

interface Hit { nx: number; ny: number; pen: number }

function boxBox(a: Body, b: Body, o: Hit): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const ox = a.hw + b.hw - Math.abs(dx);
  const oy = a.hh + b.hh - Math.abs(dy);
  if (ox <= -TOUCH || oy <= -TOUCH) return false;
  // Prefer the vertical axis unless the side overlap is clearly smaller, so
  // boxes slide across seams between equal-height neighbours without snagging.
  if (ox + 1 < oy) { o.nx = dx < 0 ? -1 : 1; o.ny = 0; o.pen = ox; }
  else { o.nx = 0; o.ny = dy < 0 ? -1 : 1; o.pen = oy; }
  return true;
}

/** Circle c against box b, normal from c to b. */
function circleBox(c: Body, b: Body, o: Hit): boolean {
  const l = b.x - b.hw, r = b.x + b.hw, t = b.y - b.hh, bt = b.y + b.hh;
  const qx = c.x < l ? l : c.x > r ? r : c.x;
  const qy = c.y < t ? t : c.y > bt ? bt : c.y;
  const dx = qx - c.x, dy = qy - c.y;
  const d2 = dx * dx + dy * dy;
  if (d2 > 0) {
    const lim = c.r + TOUCH;
    if (d2 >= lim * lim) return false;
    const d = Math.sqrt(d2);
    o.nx = dx / d; o.ny = dy / d; o.pen = c.r - d;
    return true;
  }
  // Centre inside the box: push out through the nearest face.
  let m = c.x - l; o.nx = 1; o.ny = 0;
  if (r - c.x < m) { m = r - c.x; o.nx = -1; o.ny = 0; }
  if (c.y - t < m) { m = c.y - t; o.nx = 0; o.ny = 1; }
  if (bt - c.y < m) { m = bt - c.y; o.nx = 0; o.ny = -1; }
  o.pen = c.r + m;
  return true;
}

function circleCircle(a: Body, b: Body, o: Hit): boolean {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d2 = dx * dx + dy * dy;
  const lim = a.r + b.r + TOUCH;
  if (d2 >= lim * lim) return false;
  const d = Math.sqrt(d2);
  if (d < 1e-9) { o.nx = 0; o.ny = 1; }
  else { o.nx = dx / d; o.ny = dy / d; }
  o.pen = a.r + b.r - d;
  return true;
}

function collide(a: Body, b: Body, o: Hit): boolean {
  const ac = a.kind !== K_BLOCK, bc = b.kind !== K_BLOCK;
  if (!ac && !bc) return boxBox(a, b, o);
  if (ac && bc) return circleCircle(a, b, o);
  if (ac) return circleBox(a, b, o);
  if (!circleBox(b, a, o)) return false;
  o.nx = -o.nx; o.ny = -o.ny;
  return true;
}

function near(a: Body, b: Body, m: number): boolean {
  return Math.abs(b.x - a.x) <= a.hw + b.hw + m && Math.abs(b.y - a.y) <= a.hh + b.hh + m;
}

// ---------------------------------------------------------------- prediction (bot + renderer)

export interface PathHit {
  kind: "critter" | "block" | "shot" | "ground" | "out" | "none";
  id: number;
  x: number; y: number;
  speed: number;
  frames: number;
}

/** Ballistic flight from the cup, identical to the engine until the first contact. */
export function predictShot(bodies: readonly BodyView[], vx: number, vy: number, maxFrames = 300): PathHit {
  let x = CUP_X, y = CUP_Y;
  const n = maxFrames * SUB;
  for (let s = 0; s < n; s++) {
    vy += GRAVITY * H;
    const v2 = vx * vx + vy * vy;
    if (v2 > MAX_V * MAX_V) { const k = MAX_V / Math.sqrt(v2); vx *= k; vy *= k; }
    x += vx * H; y += vy * H;
    const speed = Math.sqrt(vx * vx + vy * vy);
    const frames = Math.floor(s / SUB);
    if (x < -60 || x > FIELD_W + 60 || y > FIELD_H + 60) return { kind: "out", id: -1, x, y, speed, frames };
    if (x <= FIELD_W && y + SHOT_R >= GROUND_Y) return { kind: "ground", id: -1, x, y, speed, frames };
    for (const b of bodies) {
      if (b.kind === "block") {
        const qx = x < b.x - b.hw ? b.x - b.hw : x > b.x + b.hw ? b.x + b.hw : x;
        const qy = y < b.y - b.hh ? b.y - b.hh : y > b.y + b.hh ? b.y + b.hh : y;
        if ((qx - x) * (qx - x) + (qy - y) * (qy - y) < SHOT_R * SHOT_R) return { kind: "block", id: b.id, x, y, speed, frames };
      } else {
        const rr = b.r + SHOT_R;
        if ((b.x - x) * (b.x - x) + (b.y - y) * (b.y - y) < rr * rr) return { kind: b.kind, id: b.id, x, y, speed, frames };
      }
    }
  }
  return { kind: "none", id: -1, x, y, speed: 0, frames: maxFrames };
}

/** Free-flight positions from the cup, one per frame (for the aiming dots). */
export function trajectory(vx: number, vy: number, frames: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  let x = CUP_X, y = CUP_Y;
  for (let f = 0; f < frames; f++) {
    for (let s = 0; s < SUB; s++) {
      vy += GRAVITY * H;
      x += vx * H; y += vy * H;
    }
    out.push({ x, y });
  }
  return out;
}

// ---------------------------------------------------------------- engine

export class SlingEngine implements GameEngine<SlingView> {
  private rng: Rng;
  private bodies: Body[] = [];
  private nextId = 1;
  private contacts: Contact[] = [];
  private warm = new Map<number, number[]>();
  private hit: Hit = { nx: 0, ny: 0, pen: 0 };
  private dying: Body[] = [];

  private level: number;
  private levelsCleared = 0;
  private loop = 0;
  private def: LevelDef = LEVELS[0];
  private score = 0;
  private bonus = 0;
  private shotsLeft = 0;
  private shotsTotal = 0;
  private critters = 0;
  private phase: Phase = "aim";
  private phaseT = 0;
  private levelT = 0;
  private turn = 0;
  private active: Body | null = null;
  private flyT = 0;
  private settleT = 0;
  private finished = false;

  // aiming
  private prevB = 0;
  private angle = -32;
  private power = 75;
  private angT = 0;
  private drag = false;
  private dragT = 0;
  private dragged = false;
  private dragValid = false;
  private anchorX = 0;
  private anchorY = 0;
  private dragVx = 0;
  private dragVy = 0;
  private pullX = 0;
  private pullY = 0;

  // per-frame event caps
  private brickEv = 0;
  private dustEv = 0;

  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, startLevel = 0) {
    this.rng = new Rng(seed);
    this.level = startLevel;
    this.build();
  }

  // ------------------------------------------------------------ level setup

  private build() {
    const def = LEVELS[this.level % LEVELS.length];
    this.def = def;
    this.loop = Math.floor(this.level / LEVELS.length);
    const hpMul = 1 + 0.3 * this.loop;
    this.bodies = [];
    this.nextId = 1;
    this.warm = new Map();
    this.critters = 0;
    const placed: { x0: number; x1: number; top: number }[] = [];
    for (const p of def.pieces) {
      if (p[0] === "C") {
        const cx = p[1], r = p[2];
        let top = 0;
        for (const q of placed) if (q.x0 < cx && cx < q.x1 && q.top > top) top = q.top;
        const mass = (CRITTER.density * PI * r * r) / 100;
        this.bodies.push(this.body(K_CRITTER, null, cx, GROUND_Y - top - r, r, r, r, mass, CRITTER.mu, CRITTER.e, CRITTER.hp * hpMul));
        this.critters++;
        continue;
      }
      const x0 = p[1], w = p[2], h = p[3];
      let bottom = 0;
      for (const q of placed) if (q.x0 < x0 + w && x0 < q.x1 && q.top > bottom) bottom = q.top;
      placed.push({ x0, x1: x0 + w, top: bottom + h });
      let mat: Mat = p[0] === "G" ? "chart" : p[0] === "W" ? "candle" : "vault";
      if (this.loop > 0) {
        // Harder variants: some glass becomes candle, some candle becomes vault.
        if (mat === "chart" && this.rng.int(3) === 0) mat = "candle";
        else if (mat === "candle" && this.rng.int(5) === 0) mat = "vault";
      }
      const m = MATS[mat];
      const mass = (m.density * w * h) / 100;
      this.bodies.push(this.body(K_BLOCK, mat, x0 + w / 2, GROUND_Y - bottom - h / 2, w / 2, h / 2, 0, mass, m.mu, m.e, m.hp * hpMul));
    }
    this.shotsTotal = this.shotsLeft = Math.max(2, def.shots - (this.loop >= 2 ? 1 : 0));
    this.active = null;
    this.phase = "aim";
    this.phaseT = 0;
    this.levelT = 0;
    this.turn++;
    this.drag = false;
    this.angle = -32;
    this.power = 75;
  }

  private body(kind: number, mat: Mat | null, x: number, y: number, hw: number, hh: number, r: number, mass: number, mu: number, e: number, hp: number): Body {
    return { id: this.nextId++, kind, mat, x, y, vx: 0, vy: 0, hw, hh, r, im: 1 / mass, mu, e, hp, maxHp: hp, asleep: true, still: 0, dead: false };
  }

  /** Test helper: wake every body (a settled level must stay put). */
  wakeAll() {
    for (const b of this.bodies) { b.asleep = false; b.still = 0; }
  }

  // ------------------------------------------------------------ input

  private kbVel(): [number, number] {
    const s = (VMAX * this.power) / 100;
    return [cos256(this.angle) * s, sin256(this.angle) * s];
  }

  private aimInput(inp: Input, pressed: number, released: number) {
    if (!this.drag) {
      const lr = inp.b & (BTN.LEFT | BTN.RIGHT);
      if (lr) {
        if (this.angT % 3 === 0) {
          if (lr & BTN.LEFT) this.angle = Math.max(ANG_MIN, this.angle - 1);
          else this.angle = Math.min(ANG_MAX, this.angle + 1);
        }
        this.angT++;
      } else this.angT = 0;
      if (inp.b & BTN.UP) this.power = Math.min(PWR_MAX, this.power + 1);
      if (inp.b & BTN.DOWN) this.power = Math.max(PWR_MIN, this.power - 1);
    }
    if (pressed & BTN.FIRE) {
      this.drag = true;
      this.dragT = 0;
      this.dragged = false;
      this.dragValid = false;
      this.pullX = this.pullY = 0;
      const dx = inp.x - CUP_X, dy = inp.y - CUP_Y;
      const abs = dx * dx + dy * dy <= GRAB_R * GRAB_R;
      this.anchorX = abs ? CUP_X : inp.x;
      this.anchorY = abs ? CUP_Y : inp.y;
    }
    if (this.drag && inp.b & BTN.FIRE) {
      this.dragT++;
      const px = this.anchorX - inp.x, py = this.anchorY - inp.y; // launch direction
      const l2 = px * px + py * py;
      if (l2 >= MIN_PULL * MIN_PULL) {
        this.dragged = true;
        this.dragValid = true;
        const l = Math.sqrt(l2);
        const lc = l > MAX_PULL ? MAX_PULL : l;
        const s = (VMAX * lc) / MAX_PULL / l;
        this.dragVx = px * s;
        this.dragVy = py * s;
        this.pullX = (-px * lc) / l;
        this.pullY = (-py * lc) / l;
        // Keep the keyboard aim in sync with the drag.
        let a = angle256(px, py);
        if (a > 128) a -= 256;
        this.angle = a < ANG_MIN ? ANG_MIN : a > ANG_MAX ? ANG_MAX : a;
        this.power = Math.max(PWR_MIN, Math.min(PWR_MAX, Math.round((lc * 100) / MAX_PULL)));
      } else {
        this.dragValid = false;
        this.pullX = -px;
        this.pullY = -py;
      }
    }
    if (this.drag && released & BTN.FIRE) {
      this.drag = false;
      if (!this.dragged) {
        const [vx, vy] = this.kbVel(); // tap / Space: fire along the keyboard aim
        this.launch(vx, vy);
      } else if (this.dragValid) this.launch(this.dragVx, this.dragVy);
      this.pullX = this.pullY = 0;
    }
  }

  private launch(vx: number, vy: number) {
    const m = (SHOT.density * PI * SHOT_R * SHOT_R) / 100;
    const s = this.body(K_SHOT, null, CUP_X, CUP_Y, SHOT_R, SHOT_R, SHOT_R, m, SHOT.mu, SHOT.e, 1);
    s.vx = vx; s.vy = vy; s.asleep = false;
    this.bodies.push(s);
    this.active = s;
    this.shotsLeft--;
    this.phase = "fly";
    this.phaseT = 0;
    this.flyT = 0;
    this.settleT = 0;
    this.events.push({ t: "launch", sfx: "launch", x: CUP_X, y: CUP_Y, shake: 2 });
  }

  // ------------------------------------------------------------ physics

  private substep() {
    const bs = this.bodies;
    const n = bs.length;
    // Wake sleepers touched by anything moving.
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (a.dead || a.asleep || a.vx * a.vx + a.vy * a.vy < WAKE_V * WAKE_V) continue;
      for (let j = 0; j < n; j++) {
        const b = bs[j];
        if (b.asleep && !b.dead && near(a, b, 2)) { b.asleep = false; b.still = 0; }
      }
    }
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (!a.dead && !a.asleep) a.vy += GRAVITY * H;
    }
    // Contacts.
    const cs = this.contacts;
    cs.length = 0;
    const o = this.hit;
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (a.dead) continue;
      if (!a.asleep && a.x <= FIELD_W) {
        const pen = a.y + a.hh - GROUND_Y;
        if (pen > -TOUCH) { o.nx = 0; o.ny = 1; o.pen = pen; this.addContact(a, null); }
      }
      for (let j = i + 1; j < n; j++) {
        const b = bs[j];
        if (b.dead || (a.asleep && b.asleep)) continue;
        if (Math.abs(b.x - a.x) > a.hw + b.hw + 1 || Math.abs(b.y - a.y) > a.hh + b.hh + 1) continue;
        if (collide(a, b, o)) this.addContact(a, b);
      }
    }
    // Velocity iterations.
    for (let it = 0; it < VEL_ITERS; it++) {
      for (const c of cs) {
        const a = c.a, b = c.b;
        const k = c.ima + c.imb;
        let rvx = (b ? b.vx : 0) - a.vx, rvy = (b ? b.vy : 0) - a.vy;
        const vn = rvx * c.nx + rvy * c.ny;
        const nj = Math.max(0, c.jn + (c.bias - vn) / k);
        const dj = nj - c.jn;
        c.jn = nj;
        this.apply(c, dj * c.nx, dj * c.ny);
        const tx = -c.ny, ty = c.nx;
        rvx = (b ? b.vx : 0) - a.vx; rvy = (b ? b.vy : 0) - a.vy;
        const vt = rvx * tx + rvy * ty;
        const mx = c.mu * c.jn;
        let nt = c.jt - vt / k;
        nt = nt < -mx ? -mx : nt > mx ? mx : nt;
        const dt = nt - c.jt;
        c.jt = nt;
        this.apply(c, dt * tx, dt * ty);
      }
    }
    // Integrate positions.
    for (let i = 0; i < n; i++) {
      const a = bs[i];
      if (a.dead || a.asleep) continue;
      const v2 = a.vx * a.vx + a.vy * a.vy;
      if (v2 > MAX_V * MAX_V) { const k = MAX_V / Math.sqrt(v2); a.vx *= k; a.vy *= k; }
      a.x += a.vx * H;
      a.y += a.vy * H;
    }
    // Position correction (split: does not add velocity).
    for (let it = 0; it < POS_ITERS; it++) {
      for (const c of cs) {
        const a = c.a, b = c.b;
        const bx = b ? b.x : c.bx, by = b ? b.y : c.by;
        const pen = c.pen - ((bx - c.bx) - (a.x - c.ax)) * c.nx - ((by - c.by) - (a.y - c.ay)) * c.ny;
        if (pen <= SLOP) continue;
        const corr = ((pen - SLOP) * BETA) / (c.ima + c.imb);
        a.x -= c.nx * corr * c.ima; a.y -= c.ny * corr * c.ima;
        if (b) { b.x += c.nx * corr * c.imb; b.y += c.ny * corr * c.imb; }
      }
    }
    // Warm-start cache and damage.
    const warm = new Map<number, number[]>();
    for (const c of cs) {
      warm.set(c.key, [c.nx, c.ny, c.jn, c.jt]);
      if (c.jn <= 0) continue;
      const k = c.ima + c.imb;
      const dv = (c.jn * k) / (1 + c.e); // impact speed this contact absorbed
      if (dv > DUST_V && this.dustEv < 4) {
        this.dustEv++;
        const b = c.b;
        this.events.push({ t: "dust", x: b ? (c.a.x + b.x) / 2 : c.a.x, y: b ? (c.a.y + b.y) / 2 : GROUND_Y, power: dv });
      }
      if (dv <= DMG_TH) continue;
      const over = (dv - DMG_TH) * DMG_K;
      this.hurt(c.a, (over * c.ima) / k);
      if (c.b) this.hurt(c.b, (over * c.imb) / k);
    }
    this.warm = warm;
    if (this.dying.length) {
      for (const b of this.dying) this.kill(b, true);
      this.dying.length = 0;
    }
  }

  private addContact(a: Body, b: Body | null) {
    const o = this.hit;
    const ima = a.asleep ? 0 : a.im;
    const imb = b && !b.asleep ? b.im : 0;
    if (ima + imb === 0) return;
    const rvx = (b ? b.vx : 0) - a.vx, rvy = (b ? b.vy : 0) - a.vy;
    const vn = rvx * o.nx + rvy * o.ny;
    let e = 0, bias = 0;
    if (vn < -BOUNCE_V) {
      e = Math.max(a.e, b ? b.e : 0.2);
      bias = -e * vn;
    }
    const key = a.id * 8192 + (b ? b.id : 8191);
    const c: Contact = {
      a, b, nx: o.nx, ny: o.ny, pen: o.pen, ima, imb,
      mu: Math.sqrt(a.mu * (b ? b.mu : GROUND_MU)), e, bias, jn: 0, jt: 0,
      ax: a.x, ay: a.y, bx: b ? b.x : a.x, by: b ? b.y : GROUND_Y, key,
    };
    const w = this.warm.get(key);
    if (w && w[0] === o.nx && w[1] === o.ny) {
      c.jn = w[2]; c.jt = w[3];
      this.apply(c, c.jn * o.nx - c.jt * o.ny, c.jn * o.ny + c.jt * o.nx);
    }
    this.contacts.push(c);
  }

  private apply(c: Contact, px: number, py: number) {
    const a = c.a, b = c.b;
    a.vx -= px * c.ima; a.vy -= py * c.ima;
    if (b) { b.vx += px * c.imb; b.vy += py * c.imb; }
  }

  private hurt(b: Body, amt: number) {
    if (b.kind === K_SHOT || b.dead || amt <= 0) return;
    b.hp -= amt;
    if (b.hp <= 0) {
      b.dead = true;
      this.dying.push(b);
    } else if (b.kind === K_BLOCK && this.brickEv < 3) {
      this.brickEv++;
      this.events.push({ t: "brick", sfx: "brick", x: b.x, y: b.y, id: b.id, mat: b.mat });
    }
  }

  /** Remove a body: score it (if broken/popped) and wake whatever it touched. */
  private kill(b: Body, scored: boolean) {
    b.dead = true;
    for (const q of this.bodies) if (!q.dead && q.asleep && near(b, q, 2)) { q.asleep = false; q.still = 0; }
    if (b.kind === K_CRITTER) {
      this.critters--;
      this.score += PTS_CRITTER;
      this.events.push({ t: "pop", sfx: "explode", mood: "happy", shake: 5, x: b.x, y: b.y, r: b.r, pts: PTS_CRITTER });
    } else if (b.kind === K_BLOCK && scored) {
      const pts = MATS[b.mat!].pts;
      this.score += pts;
      this.events.push({ t: "brickgone", sfx: "brickgone", shake: 3, x: b.x, y: b.y, w: b.hw * 2, h: b.hh * 2, mat: b.mat, pts });
    }
  }

  // ------------------------------------------------------------ step

  step(inp: Input) {
    this.frame++;
    this.events = [];
    this.brickEv = 0;
    this.dustEv = 0;
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    if (this.finished) return;
    this.phaseT++;
    this.levelT++;

    if (this.phase === "aim") this.aimInput(inp, pressed, released);

    for (let s = 0; s < SUB; s++) this.substep();

    // Sleep, fall-offs, compaction.
    let any = false;
    for (const b of this.bodies) {
      if (b.dead) { any = true; continue; }
      if (b.x < -60 || b.x > FIELD_W + 60 || b.y > FIELD_H + 60) {
        this.kill(b, false);
        any = true;
        continue;
      }
      if (b.asleep) continue;
      if (b.vx * b.vx + b.vy * b.vy < SLEEP_V * SLEEP_V) {
        if (++b.still >= SLEEP_FRAMES) { b.asleep = true; b.vx = b.vy = 0; }
      } else b.still = 0;
    }
    if (any) this.bodies = this.bodies.filter((b) => !b.dead);

    if (this.phase === "fly") this.flying();
    else if (this.phase === "clear") {
      if (this.phaseT >= CLEAR_FRAMES) {
        this.level++;
        this.levelsCleared++;
        this.build();
      }
    } else if (this.phase === "over" && this.phaseT >= OVER_FRAMES) {
      this.finished = true;
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  private flying() {
    this.flyT++;
    const shot = this.active;
    const shotDone = !shot || shot.dead || shot.asleep || this.flyT > FLY_CAP;
    let allAsleep = true;
    for (const b of this.bodies) if (!b.asleep) { allAsleep = false; break; }
    if (this.flyT >= FORCE_SLEEP && !allAsleep) {
      for (const b of this.bodies) { b.asleep = true; b.vx = b.vy = 0; }
      allAsleep = true;
    }
    if (shotDone && (allAsleep || this.flyT > FLY_CAP)) this.settleT++;
    else this.settleT = 0;
    if (this.settleT < SETTLE_FRAMES) return;
    this.active = null;
    this.phaseT = 0;
    if (this.critters <= 0) {
      this.phase = "clear";
      this.bonus = this.shotsLeft * PTS_SPARE;
      this.score += this.bonus;
      this.events.push({ t: "levelclear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus: this.bonus, spare: this.shotsLeft });
    } else if (this.shotsLeft <= 0) {
      this.phase = "over";
      this.events.push({ t: "lost", sfx: "lost", mood: "sad", shake: 6 });
    } else {
      this.phase = "aim";
      this.turn++;
      this.drag = false;
    }
  }

  // ------------------------------------------------------------ outputs

  view(): SlingView {
    const aimVel = this.drag && this.dragged ? [this.dragVx, this.dragVy] : this.kbVel();
    return {
      frame: this.frame,
      level: this.level,
      loop: this.loop,
      name: this.def.name,
      phase: this.phase,
      phaseT: this.phaseT,
      levelT: this.levelT,
      turn: this.turn,
      shotsLeft: this.shotsLeft,
      shotsTotal: this.shotsTotal,
      critters: this.critters,
      score: this.score,
      bonus: this.bonus,
      bodies: this.bodies.map((b) => ({
        id: b.id, kind: KIND_NAME[b.kind], mat: b.mat, x: b.x, y: b.y, hw: b.hw, hh: b.hh, r: b.r,
        vx: b.vx, vy: b.vy, hp: b.hp, maxHp: b.maxHp, asleep: b.asleep,
      })),
      active: this.active && !this.active.dead ? this.active.id : -1,
      aim: {
        dragging: this.drag,
        dragT: this.dragT,
        valid: !(this.drag && this.dragged && !this.dragValid),
        vx: aimVel[0], vy: aimVel[1],
        pullX: this.drag ? this.pullX : 0, pullY: this.drag ? this.pullY : 0,
        angle: this.angle, power: this.power,
      },
    };
  }

  hud(): Hud {
    return { score: this.score, lives: this.shotsLeft, level: this.level + 1, label: this.def.name };
  }

  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.levelsCleared, frames: this.frame, status: this.finished || this.phase === "over" ? "over" : "playing" };
  }

  get done() {
    return this.finished;
  }
}

// ---------------------------------------------------------------- bot

/** Best pointer position to drag to (absolute drag from the cup), found by predicting the free flight. */
export function botTarget(v: SlingView): { x: number; y: number; hit: PathHit } {
  const crit = v.bodies.filter((b) => b.kind === "critter");
  let best = { x: CUP_X - 50, y: CUP_Y + 50, hit: predictShot(v.bodies, 0, 0, 1) };
  let bestS = -Infinity;
  let idx = 0;
  for (let py = CUP_Y - 12; py <= CUP_Y + MAX_PULL; py += 3) {
    for (let px = CUP_X - MAX_PULL; px <= CUP_X; px += 3) {
      const dx = CUP_X - px, dy = CUP_Y - py;
      const l2 = dx * dx + dy * dy;
      if (l2 < 24 * 24 || l2 > MAX_PULL * MAX_PULL) continue;
      idx++;
      const s0 = VMAX / MAX_PULL;
      const hit = predictShot(v.bodies, dx * s0, dy * s0);
      let nearest = 1e9;
      let above = false;
      for (const c of crit) {
        const d = Math.sqrt((c.x - hit.x) * (c.x - hit.x) + (c.y - hit.y) * (c.y - hit.y));
        if (d < nearest) nearest = d;
        if (Math.abs(c.x - hit.x) < 60 && c.y < hit.y) above = true;
      }
      let s: number;
      if (hit.kind === "critter") s = 100000 + hit.speed;
      else if (hit.kind === "block") {
        const b = v.bodies.find((q) => q.id === hit.id)!;
        const weak = b.mat === "chart" ? 150 : b.mat === "candle" ? 80 : 0;
        s = hit.speed * 0.3 + weak - nearest * 1.5 + (above ? 120 : 0);
      } else if (hit.kind === "shot") s = -500 - nearest;
      else if (hit.kind === "ground") s = -300 - nearest * 2;
      else s = -1e6;
      s += ((idx * 7 + v.turn * 13) % 17) * 0.5; // small deterministic variety
      if (s > bestS) { bestS = s; best = { x: px, y: py, hit }; }
    }
  }
  return best;
}

let botKey = "";
let botPick = { x: CUP_X, y: CUP_Y };

export const sling: GameDef<SlingView> = {
  id: "sling",
  name: "Moon Sling",
  tagline: "Fling the mascot, topple the towers, pop every FUD critter.",
  genre: "Physics puzzler",
  session: "3–10 min",
  controls:
    "Drag back from the cup and release to fling (dots preview the arc). Keyboard: ← / → aim, ↑ / ↓ power, Space to launch. Pop every FUD critter to clear the level; spare launches are a 10,000 bonus each.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original physics puzzler in the fling-at-a-tower genre: rules, levels, box/circle impulse physics and art written from scratch. No code, level data, characters, art or sounds from any commercial game.",
  },
  create: (seed) => new SlingEngine(seed),
  bot(v) {
    const idle = { x: CUP_X, y: CUP_Y, b: 0 };
    if (v.phase !== "aim") return idle;
    if (!v.aim.dragging) return v.phaseT < 40 ? idle : { x: CUP_X, y: CUP_Y, b: BTN.FIRE };
    let h = v.level * 31 + v.turn * 7 + v.bodies.length;
    for (const b of v.bodies) h = (h * 31 + Math.round(b.x * 4) * 7 + Math.round(b.y * 4)) % 1000000007;
    const key = `${v.level}|${v.turn}|${h}`;
    if (key !== botKey) {
      botKey = key;
      const t = botTarget(v);
      botPick = { x: t.x, y: t.y };
    }
    const P = botPick;
    if (v.aim.dragT >= 45) return { x: P.x, y: P.y, b: 0 };
    const f = Math.min(1, v.aim.dragT / 30);
    return { x: Math.round(CUP_X + (P.x - CUP_X) * f), y: Math.round(CUP_Y + (P.y - CUP_Y) * f), b: BTN.FIRE };
  },
};
