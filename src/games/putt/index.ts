/*
 * Moon Putt: an original top-down mini golf game for ArcadePad.
 * Original design: rules, physics, nine hole layouts and art written from
 * scratch. No code, level data, art or sound from any commercial game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Pull back from the coin and release to putt (dotted line shows the aim),
 * or aim with LEFT/RIGHT and hold FIRE to charge a ping-pong power meter.
 * Walls are polygons (circle-vs-segment reflection), sand slows the coin,
 * slopes push it, water costs a stroke and puts it back, bumpers kick, and
 * moving blockers (spinning rotors, sliding gates) add timing.
 *
 * Score (high is good): per hole max(0, par + 3 - strokes) * 100, plus 500
 * for a hole in one. Eight strokes max per hole, then it auto-advances.
 *
 * Determinism: only + - * /, Math.sqrt, floor/min/max/abs and the byte-angle
 * table (core/trig.ts, linearly interpolated). Fixed 60 Hz, 4 substeps.
 */
import { Rng } from "../core/rng.ts";
import { SIN256, angle256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";
import { HOLES, type HoleDef, type Zone } from "./holes.ts";

export { HOLES };

// ---------------------------------------------------------------- constants

export const FIELD_W = 360;
export const FIELD_H = 600;
/** Screen region the camera fits each hole into. */
export const VIEW_X = 10;
export const VIEW_Y = 66;
export const VIEW_W = 340;
export const VIEW_H = 466;
const MAX_ZOOM = 1.5;

export const BALL_R = 6;
export const CUP_R = 8;
export const HUB_R = 7;
export const BLADE_T = 3; // blade half thickness
const SINK_V = 5; // faster than this lips out
export const VMAX = 10; // world px/frame at full power
const SUB = 4;
const FRIC_MUL = 0.985;
const FRIC_DEC = 0.04;
const SAND_MUL = 0.9;
const SAND_DEC = 0.08;
const WALL_E = 0.72;
const BUMP_KICK = 1.6;
const MAX_V = 13;
export const MAX_STROKES = 8;
export const GRAB_R = 34; // screen px: press this close to the coin to pull from it
export const PULL_DEAD = 6;
export const PULL_MAX = 110; // screen px of pull for full power
const DRAG_START = 4;
const MIN_POWER = 0.04;
const CHARGE_MIN = 6;
const CHARGE_PERIOD = 120;
const INTRO = 50;
const SPLASH = 45;
const OUTRO = 110;
const ROLL_CAP = 900;
const PI = 3.14159265;

// ---------------------------------------------------------------- math helpers

function sinF(a: number): number {
  const i = Math.floor(a);
  const f = a - i;
  const s0 = SIN256[i & 255], s1 = SIN256[(i + 1) & 255];
  return s0 + (s1 - s0) * f;
}
function cosF(a: number): number {
  return sinF(a + 64);
}

function inPoly(p: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = p.length >> 1;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = p[i * 2], yi = p[i * 2 + 1], xj = p[j * 2], yj = p[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function inZone(z: Zone, x: number, y: number): boolean {
  if (z.length === 4) return x >= z[0] && x <= z[0] + z[2] && y >= z[1] && y <= z[1] + z[3];
  const dx = x - z[0], dy = y - z[1];
  return dx * dx + dy * dy <= z[2] * z[2];
}

// ---------------------------------------------------------------- course + movers

export interface Seg { ax: number; ay: number; bx: number; by: number }

export interface Course {
  def: HoleDef;
  segs: Seg[];
  minX: number; minY: number; maxX: number; maxY: number;
}

function polySegs(p: readonly number[], out: Seg[]) {
  const n = p.length >> 1;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    out.push({ ax: p[i * 2], ay: p[i * 2 + 1], bx: p[j * 2], by: p[j * 2 + 1] });
  }
}

const courseCache: Course[] = [];
export function course(hole: number): Course {
  if (courseCache[hole]) return courseCache[hole];
  const def = HOLES[hole];
  const segs: Seg[] = [];
  polySegs(def.outer, segs);
  for (const b of def.blocks) polySegs(b, segs);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < def.outer.length; i += 2) {
    minX = Math.min(minX, def.outer[i]); maxX = Math.max(maxX, def.outer[i]);
    minY = Math.min(minY, def.outer[i + 1]); maxY = Math.max(maxY, def.outer[i + 1]);
  }
  const c = { def, segs, minX, minY, maxX, maxY };
  courseCache[hole] = c;
  return c;
}

export interface Cam { s: number; ox: number; oy: number }
export function camFor(hole: number): Cam {
  const c = course(hole);
  const w = c.maxX - c.minX, h = c.maxY - c.minY;
  const s = Math.min(VIEW_W / w, VIEW_H / h, MAX_ZOOM);
  return { s, ox: VIEW_X + (VIEW_W - w * s) / 2 - c.minX * s, oy: VIEW_Y + (VIEW_H - h * s) / 2 - c.minY * s };
}

export interface RotorNow { x: number; y: number; a: number; len: number; blades: number; w: number }
export interface GateNow { x: number; y: number; w: number; h: number; vx: number; vy: number }

export function rotorAt(def: HoleDef, t: number): RotorNow[] {
  return def.rotors.map((r) => ({ x: r.x, y: r.y, a: r.phase + r.speed * t, len: r.len, blades: r.blades, w: (r.speed * 2 * PI) / 256 }));
}

function gateOffset(period: number, phase: number, t: number): number {
  const u = ((t + phase) % period) / period;
  const tri = u < 0.5 ? u * 2 : 2 - u * 2;
  return tri * tri * (3 - 2 * tri);
}
export function gateAt(def: HoleDef, t: number): GateNow[] {
  return def.gates.map((g) => {
    const s = gateOffset(g.period, g.phase, t);
    const s0 = gateOffset(g.period, g.phase, t - 1 + g.period);
    const x = g.x1 + (g.x2 - g.x1) * s, y = g.y1 + (g.y2 - g.y1) * s;
    return { x, y, w: g.w, h: g.h, vx: (g.x2 - g.x1) * (s - s0), vy: (g.y2 - g.y1) * (s - s0) };
  });
}

// ---------------------------------------------------------------- ball physics

export interface Ball {
  x: number; y: number; vx: number; vy: number;
  still: number;
  rollT: number;
  /** Strongest impact this frame per kind (0 = none), for events. */
  hitWall: number;
  hitBump: number; // bumper index + 1
  hitMove: number;
  lip: boolean;
}

export function newBall(x: number, y: number): Ball {
  return { x, y, vx: 0, vy: 0, still: 0, rollT: 0, hitWall: 0, hitBump: 0, hitMove: 0, lip: false };
}

/** Circle vs segment (with thickness and segment velocity). Returns impact speed or -1. */
function hitSeg(b: Ball, ax: number, ay: number, bx: number, by: number, thick: number, svx: number, svy: number): number {
  const ex = bx - ax, ey = by - ay;
  const l2 = ex * ex + ey * ey;
  let u = l2 > 0 ? ((b.x - ax) * ex + (b.y - ay) * ey) / l2 : 0;
  u = u < 0 ? 0 : u > 1 ? 1 : u;
  const qx = ax + ex * u, qy = ay + ey * u;
  const dx = b.x - qx, dy = b.y - qy;
  const d2 = dx * dx + dy * dy;
  const R = BALL_R + thick;
  if (d2 >= R * R) return -1;
  let nx: number, ny: number;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d;
  } else {
    const l = Math.sqrt(l2) || 1;
    nx = -ey / l; ny = ex / l;
  }
  b.x = qx + nx * R;
  b.y = qy + ny * R;
  const rvx = b.vx - svx, rvy = b.vy - svy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return 0;
  const tx = rvx - vn * nx, ty = rvy - vn * ny;
  b.vx = svx + tx * 0.98 - WALL_E * vn * nx;
  b.vy = svy + ty * 0.98 - WALL_E * vn * ny;
  return -vn;
}

/** Circle vs circle obstacle. Returns impact speed or -1. */
function hitCircle(b: Ball, cx: number, cy: number, r: number, e: number, kick: number): number {
  const dx = b.x - cx, dy = b.y - cy;
  const d2 = dx * dx + dy * dy;
  const R = r + BALL_R;
  if (d2 >= R * R) return -1;
  let nx = 0, ny = -1;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d;
  }
  b.x = cx + nx * R;
  b.y = cy + ny * R;
  const vn = b.vx * nx + b.vy * ny;
  if (vn >= 0) return 0;
  b.vx -= (1 + e) * vn * nx;
  b.vy -= (1 + e) * vn * ny;
  b.vx += nx * kick;
  b.vy += ny * kick;
  return -vn;
}

function capSpeed(b: Ball) {
  const v2 = b.vx * b.vx + b.vy * b.vy;
  if (v2 > MAX_V * MAX_V) {
    const k = MAX_V / Math.sqrt(v2);
    b.vx *= k; b.vy *= k;
  }
}

/** Collide with the moving parts (rotors, hubs, gates) at time t. */
function hitMovers(c: Course, b: Ball, rotors: RotorNow[], gates: GateNow[]) {
  for (const r of rotors) {
    const hv = hitCircle(b, r.x, r.y, HUB_R, 0.5, 0);
    if (hv > b.hitMove) b.hitMove = hv;
    for (let k = 0; k < r.blades; k++) {
      const a = r.a + (256 * k) / r.blades;
      const tx = r.x + cosF(a) * r.len, ty = r.y + sinF(a) * r.len;
      // Velocity of the blade at the ball's projected point.
      const ex = tx - r.x, ey = ty - r.y;
      let u = ((b.x - r.x) * ex + (b.y - r.y) * ey) / (r.len * r.len);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const rx = ex * u, ry = ey * u;
      const iv = hitSeg(b, r.x, r.y, tx, ty, BLADE_T, -r.w * ry, r.w * rx);
      if (iv > b.hitMove) b.hitMove = iv;
    }
  }
  for (const g of gates) {
    const l = g.x - g.w / 2, rr = g.x + g.w / 2, t = g.y - g.h / 2, bt = g.y + g.h / 2;
    let iv = hitSeg(b, l, t, rr, t, 0, g.vx, g.vy);
    iv = Math.max(iv, hitSeg(b, rr, t, rr, bt, 0, g.vx, g.vy));
    iv = Math.max(iv, hitSeg(b, rr, bt, l, bt, 0, g.vx, g.vy));
    iv = Math.max(iv, hitSeg(b, l, bt, l, t, 0, g.vx, g.vy));
    if (iv > b.hitMove) b.hitMove = iv;
  }
  void c;
}

function escaped(c: Course, x: number, y: number): boolean {
  if (!inPoly(c.def.outer, x, y)) return true;
  for (const p of c.def.blocks) if (inPoly(p, x, y)) return true;
  return false;
}

export const ROLL = 0, REST = 1, SUNK = 2, WATER = 3, ESCAPE = 4;

/** One 1/60 s frame of a rolling ball at hole time t. Shared by the engine and the bot. */
export function rollFrame(c: Course, b: Ball, t: number): number {
  const def = c.def;
  b.hitWall = 0; b.hitBump = 0; b.hitMove = 0; b.lip = false;
  b.rollT++;
  let onSlope = false;
  for (const s of def.slopes) {
    if (inZone(s.r, b.x, b.y)) {
      b.vx += s.fx; b.vy += s.fy;
      onSlope = true;
    }
  }
  let sand = false;
  for (const z of def.sand) if (inZone(z, b.x, b.y)) sand = true;
  const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  if (sp > 0) {
    const ns = Math.max(0, sp * (sand ? SAND_MUL : FRIC_MUL) - (sand ? SAND_DEC : FRIC_DEC));
    b.vx *= ns / sp; b.vy *= ns / sp;
  }
  const rotors = rotorAt(def, t);
  const gates = gateAt(def, t);
  const [cx, cy] = def.cup;
  for (let s = 0; s < SUB; s++) {
    b.x += b.vx / SUB;
    b.y += b.vy / SUB;
    for (const g of c.segs) {
      const iv = hitSeg(b, g.ax, g.ay, g.bx, g.by, 0, 0, 0);
      if (iv > b.hitWall) b.hitWall = iv;
    }
    for (let i = 0; i < def.bumpers.length; i++) {
      const u = def.bumpers[i];
      if (hitCircle(b, u[0], u[1], u[2], 0.9, BUMP_KICK) > 0) b.hitBump = i + 1;
    }
    hitMovers(c, b, rotors, gates);
    capSpeed(b);
    for (const z of def.water) if (inZone(z, b.x, b.y)) return WATER;
    const dx = cx - b.x, dy = cy - b.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < CUP_R * CUP_R) {
      const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
      if (v < SINK_V) return SUNK;
      const d = Math.sqrt(d2) || 1;
      b.vx = b.vx * 0.93 + (dx / d) * 0.25;
      b.vy = b.vy * 0.93 + (dy / d) * 0.25;
      b.lip = true;
    }
  }
  if (escaped(c, b.x, b.y)) return ESCAPE;
  const v = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
  b.still = v < 0.2 ? b.still + 1 : 0;
  if ((!onSlope && v < 0.05) || b.still >= 40 || b.rollT >= ROLL_CAP) {
    b.vx = 0; b.vy = 0;
    return REST;
  }
  return ROLL;
}

/** A resting ball can be shoved by moving parts. Returns true if it now moves. */
export function restFrame(c: Course, b: Ball, t: number): boolean {
  b.hitWall = 0; b.hitBump = 0; b.hitMove = 0; b.lip = false;
  if (!c.def.rotors.length && !c.def.gates.length) return false;
  hitMovers(c, b, rotorAt(c.def, t), gateAt(c.def, t));
  for (const g of c.segs) hitSeg(b, g.ax, g.ay, g.bx, g.by, 0, 0, 0);
  return b.vx * b.vx + b.vy * b.vy > 0.04;
}

/** Shot velocity for a pointer drag (screen units). */
export function shotFromPointer(refX: number, refY: number, px: number, py: number): { vx: number; vy: number; power: number; dx: number; dy: number } {
  const ddx = px - refX, ddy = py - refY;
  const L = Math.sqrt(ddx * ddx + ddy * ddy);
  if (L < 1e-6) return { vx: 0, vy: 0, power: 0, dx: 0, dy: -1 };
  const power = Math.max(0, Math.min(1, (L - PULL_DEAD) / PULL_MAX));
  const dx = -ddx / L, dy = -ddy / L;
  return { vx: dx * power * VMAX, vy: dy * power * VMAX, power, dx, dy };
}

export function chargePower(chargeT: number): number {
  const c = chargeT % CHARGE_PERIOD;
  const h = CHARGE_PERIOD / 2;
  return Math.max(0.05, c <= h ? c / h : (CHARGE_PERIOD - c) / h);
}

/** Pins per hole: max(0, par + 3 - strokes) * 100, +500 for a hole in one. */
export function holePoints(par: number, strokes: number, sunk: boolean): number {
  if (!sunk) return 0;
  return Math.max(0, par + 3 - strokes) * 100 + (strokes === 1 ? 500 : 0);
}

// ---------------------------------------------------------------- view

export type Phase = "intro" | "aim" | "roll" | "splash" | "sunk" | "giveup" | "done";

export interface PuttView {
  frame: number;
  hole: number;
  holes: number;
  name: string;
  par: number;
  phase: Phase;
  phaseT: number;
  /** Hole time in frames (drives rotors and gates). */
  t: number;
  strokes: number;
  score: number;
  /** Strokes per finished hole (0 = not played). */
  cards: number[];
  lastPts: number;
  ball: { x: number; y: number; vx: number; vy: number };
  cam: Cam;
  aim: {
    active: boolean;
    dragged: boolean;
    grab: boolean;
    charging: boolean;
    power: number;
    /** Unit shot direction (world = screen orientation). */
    dx: number; dy: number;
    px: number; py: number;
    refX: number; refY: number;
    angle: number; // keyboard aim, 1024 per turn
  };
  rotors: RotorNow[];
  gates: GateNow[];
}

// ---------------------------------------------------------------- engine

export class PuttEngine implements GameEngine<PuttView> {
  private hole = 0;
  private c: Course;
  private cam: Cam;
  private phase: Phase = "intro";
  private phaseT = 0;
  private t = 0;
  private strokes = 0;
  private score = 0;
  private cards: number[] = HOLES.map(() => 0);
  private lastPts = 0;
  private cleared = 0;
  private ball: Ball;
  private restX = 0;
  private restY = 0;
  private prevB = 0;
  private aimA = 0;
  private lh = 0;
  private rh = 0;
  private active = false;
  private grab = false;
  private dragged = false;
  private chargeT = 0;
  private refX = 0;
  private refY = 0;
  private px = 0;
  private py = 0;
  private finished = false;
  frame = 0;
  events: GameEvent[] = [];

  private rng: Rng;

  constructor(seed: number, startHole = 0) {
    this.rng = new Rng(seed);
    this.hole = startHole;
    this.c = course(startHole);
    this.cam = camFor(startHole);
    this.ball = newBall(0, 0);
    this.load();
  }

  private load() {
    this.c = course(this.hole);
    this.cam = camFor(this.hole);
    const [tx, ty] = this.c.def.tee;
    this.ball = newBall(tx, ty);
    this.restX = tx; this.restY = ty;
    // Moving parts start at a seeded point of their cycle.
    this.t = this.rng.int(240);
    this.strokes = 0;
    this.phase = "intro";
    this.phaseT = 0;
    this.active = false;
    this.aimAtCup();
    this.events.push({ t: "hole", hole: this.hole });
  }

  private aimAtCup() {
    const [cx, cy] = this.c.def.cup;
    this.aimA = angle256(cx - this.ball.x, cy - this.ball.y) * 4;
  }

  private ballScreen(): [number, number] {
    return [this.ball.x * this.cam.s + this.cam.ox, this.ball.y * this.cam.s + this.cam.oy];
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.finished) return;
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    this.t++;
    this.phaseT++;
    switch (this.phase) {
      case "intro":
        this.handleKeysAim(inp);
        if (this.phaseT >= INTRO) this.enterAim();
        this.shove();
        break;
      case "aim":
        if (this.handleAim(inp, pressed, released)) this.roll();
        else this.shove();
        break;
      case "roll":
        this.roll();
        break;
      case "splash":
        if (this.phaseT >= SPLASH) {
          if (this.strokes >= MAX_STROKES) this.endHole(false);
          else this.enterAim();
        }
        break;
      case "sunk":
      case "giveup":
        if (this.phaseT >= OUTRO) this.nextHole();
        break;
    }
  }

  private enterAim() {
    this.phase = "aim";
    this.phaseT = 0;
    this.active = false;
    this.aimAtCup();
  }

  private handleKeysAim(inp: Input) {
    if (inp.b & BTN.LEFT) {
      this.lh++;
      if (this.lh === 1) this.aimA -= 4;
      else if (this.lh > 12) this.aimA -= 3;
    } else this.lh = 0;
    if (inp.b & BTN.RIGHT) {
      this.rh++;
      if (this.rh === 1) this.aimA += 4;
      else if (this.rh > 12) this.aimA += 3;
    } else this.rh = 0;
    this.aimA &= 1023;
  }

  /** Returns true when a shot was launched this step. */
  private handleAim(inp: Input, pressed: number, released: number): boolean {
    this.px = inp.x; this.py = inp.y;
    if (!this.active || !this.dragged) this.handleKeysAim(inp);
    if (pressed & BTN.FIRE && !this.active) {
      const [bx, by] = this.ballScreen();
      const dx = inp.x - bx, dy = inp.y - by;
      this.active = true;
      this.dragged = false;
      this.chargeT = 0;
      this.grab = dx * dx + dy * dy <= GRAB_R * GRAB_R;
      this.refX = this.grab ? bx : inp.x;
      this.refY = this.grab ? by : inp.y;
      this.anchorX = inp.x; this.anchorY = inp.y;
      return false;
    }
    if (!this.active) return false;
    if (inp.b & BTN.FIRE) {
      this.chargeT++;
      if (!this.dragged) {
        const dx = inp.x - this.anchorX, dy = inp.y - this.anchorY;
        if (dx * dx + dy * dy >= DRAG_START * DRAG_START) this.dragged = true;
      }
      return false;
    }
    if (released & BTN.FIRE || !(inp.b & BTN.FIRE)) {
      this.active = false;
      if (this.dragged) {
        const s = shotFromPointer(this.refX, this.refY, inp.x, inp.y);
        if (s.power < MIN_POWER) {
          this.events.push({ t: "cancel" });
          return false;
        }
        this.launch(s.vx, s.vy, s.power);
        return true;
      }
      if (this.chargeT >= CHARGE_MIN) {
        const p = chargePower(this.chargeT);
        const a = this.aimA / 4;
        this.launch(cosF(a) * p * VMAX, sinF(a) * p * VMAX, p);
        return true;
      }
    }
    return false;
  }
  private anchorX = 0;
  private anchorY = 0;

  private launch(vx: number, vy: number, power: number) {
    this.ball.vx = vx; this.ball.vy = vy;
    this.ball.still = 0; this.ball.rollT = 0;
    this.strokes++;
    this.phase = "roll";
    this.phaseT = 0;
    this.events.push({ t: "shot", sfx: "launch", power, x: this.ball.x, y: this.ball.y, stroke: this.strokes });
  }

  /** Moving parts may push a resting ball. */
  private shove() {
    if (restFrame(this.c, this.ball, this.t)) {
      this.active = false;
      this.ball.still = 0; this.ball.rollT = 0;
      this.phase = "roll";
      this.phaseT = 0;
      this.events.push({ t: "knock", sfx: "wall", x: this.ball.x, y: this.ball.y });
    }
  }

  private roll() {
    const b = this.ball;
    const code = rollFrame(this.c, b, this.t);
    if (b.hitBump) this.events.push({ t: "bump", sfx: "paddle", i: b.hitBump - 1, x: b.x, y: b.y, shake: 2 });
    else if (b.hitMove > 0.6) this.events.push({ t: "mover", sfx: "brick", x: b.x, y: b.y, shake: 2 });
    else if (b.hitWall > 0.8) this.events.push({ t: "wall", sfx: "wall", x: b.x, y: b.y, v: b.hitWall });
    if (b.lip) this.events.push({ t: "lip", x: b.x, y: b.y });
    if (code === REST) {
      this.restX = b.x; this.restY = b.y;
      if (this.strokes >= MAX_STROKES) this.endHole(false);
      else this.enterAim();
    } else if (code === SUNK) {
      const [cx, cy] = this.c.def.cup;
      b.x = cx; b.y = cy; b.vx = 0; b.vy = 0;
      this.endHole(true);
    } else if (code === WATER) {
      this.events.push({ t: "splash", sfx: "lost", mood: "sad", toast: "lifeLost", shake: 5, x: b.x, y: b.y });
      this.strokes++;
      b.x = this.restX; b.y = this.restY; b.vx = 0; b.vy = 0;
      this.phase = "splash";
      this.phaseT = 0;
    } else if (code === ESCAPE) {
      b.x = this.restX; b.y = this.restY; b.vx = 0; b.vy = 0;
      if (escaped(this.c, b.x, b.y)) {
        b.x = this.c.def.tee[0]; b.y = this.c.def.tee[1];
      }
      this.enterAim();
    }
  }

  private endHole(sunk: boolean) {
    const def = this.c.def;
    const pts = holePoints(def.par, this.strokes, sunk);
    this.cards[this.hole] = this.strokes;
    this.lastPts = pts;
    this.score += pts;
    this.cleared++;
    this.phaseT = 0;
    const [cx, cy] = def.cup;
    if (sunk) {
      this.phase = "sunk";
      const ace = this.strokes === 1;
      const good = this.strokes <= def.par;
      this.events.push({
        t: "sunk", sfx: ace ? "extraGood" : "levelclear", mood: good ? "happy" : undefined, toast: good ? "levelClear" : undefined,
        shake: ace ? 6 : 3, x: cx, y: cy, strokes: this.strokes, par: def.par, pts, ace,
      });
    } else {
      this.phase = "giveup";
      this.events.push({ t: "giveup", sfx: "extraBad", mood: "sad", x: this.ball.x, y: this.ball.y, pts: 0 });
    }
  }

  private nextHole() {
    if (this.hole + 1 >= HOLES.length) {
      this.finished = true;
      this.phase = "done";
      this.events.push({ t: "won", sfx: "won", mood: "happy" });
      return;
    }
    this.hole++;
    this.load();
  }

  view(): PuttView {
    const b = this.ball;
    let power = 0, dx = cosF(this.aimA / 4), dy = sinF(this.aimA / 4);
    const charging = this.active && !this.dragged;
    if (this.active && this.dragged) {
      const s = shotFromPointer(this.refX, this.refY, this.px, this.py);
      power = s.power; dx = s.dx; dy = s.dy;
    } else if (charging && this.chargeT >= CHARGE_MIN) power = chargePower(this.chargeT);
    return {
      frame: this.frame,
      hole: this.hole,
      holes: HOLES.length,
      name: this.c.def.name,
      par: this.c.def.par,
      phase: this.phase,
      phaseT: this.phaseT,
      t: this.t,
      strokes: this.strokes,
      score: this.score,
      cards: this.cards.slice(),
      lastPts: this.lastPts,
      ball: { x: b.x, y: b.y, vx: b.vx, vy: b.vy },
      cam: this.cam,
      aim: {
        active: this.active, dragged: this.dragged, grab: this.grab, charging, power, dx, dy,
        px: this.px, py: this.py, refX: this.refX, refY: this.refY, angle: this.aimA,
      },
      rotors: rotorAt(this.c.def, this.t),
      gates: gateAt(this.c.def, this.t),
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.hole + 1, label: `Par ${this.c.def.par} · Stroke ${this.strokes}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.hole, levelsCleared: this.cleared, frames: this.frame, status: this.finished ? "won" : "playing" };
  }
  get done() {
    return this.finished;
  }
}

// ---------------------------------------------------------------- bot

const GRID = 6;
interface Field { c: Course; x0: number; y0: number; cols: number; rows: number; d: Float64Array }
const fieldCache: Field[] = [];

/** Walking distance to the cup over a coarse grid (moving parts ignored). */
function distField(hole: number): Field {
  if (fieldCache[hole]) return fieldCache[hole];
  const c = course(hole);
  const def = c.def;
  const x0 = c.minX, y0 = c.minY;
  const cols = Math.ceil((c.maxX - c.minX) / GRID) + 1, rows = Math.ceil((c.maxY - c.minY) / GRID) + 1;
  const free = new Uint8Array(cols * rows);
  for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
    const x = x0 + q * GRID, y = y0 + r * GRID;
    if (escaped(c, x, y)) continue;
    let ok = true;
    for (const z of def.water) if (inZone(z, x, y)) ok = false;
    for (const u of def.bumpers) {
      const dx = x - u[0], dy = y - u[1], R = u[2] + BALL_R;
      if (dx * dx + dy * dy < R * R) ok = false;
    }
    for (const u of def.rotors) {
      const dx = x - u.x, dy = y - u.y, R = HUB_R + BALL_R;
      if (dx * dx + dy * dy < R * R) ok = false;
    }
    if (ok) for (const g of c.segs) {
      const ex = g.bx - g.ax, ey = g.by - g.ay;
      let u = ((x - g.ax) * ex + (y - g.ay) * ey) / (ex * ex + ey * ey);
      u = u < 0 ? 0 : u > 1 ? 1 : u;
      const dx = x - (g.ax + ex * u), dy = y - (g.ay + ey * u);
      if (dx * dx + dy * dy < (BALL_R - 1) * (BALL_R - 1)) { ok = false; break; }
    }
    free[r * cols + q] = ok ? 1 : 0;
  }
  const d = new Float64Array(cols * rows).fill(1e9);
  const cq = Math.round((def.cup[0] - x0) / GRID), cr = Math.round((def.cup[1] - y0) / GRID);
  const queue: number[] = [cr * cols + cq];
  d[cr * cols + cq] = 0;
  free[cr * cols + cq] = 1;
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    const q = k % cols, r = (k - q) / cols;
    for (const [dq, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nq = q + dq, nr = r + dr;
      if (nq < 0 || nr < 0 || nq >= cols || nr >= rows) continue;
      const n = nr * cols + nq;
      if (!free[n] || d[n] <= d[k] + 1) continue;
      d[n] = d[k] + 1;
      queue.push(n);
    }
  }
  const f = { c, x0, y0, cols, rows, d };
  fieldCache[hole] = f;
  return f;
}

function fieldAt(f: Field, x: number, y: number): number {
  const q0 = Math.round((x - f.x0) / GRID), r0 = Math.round((y - f.y0) / GRID);
  let best = 1e9;
  for (let r = r0 - 2; r <= r0 + 2; r++) for (let q = q0 - 2; q <= q0 + 2; q++) {
    if (q < 0 || r < 0 || q >= f.cols || r >= f.rows) continue;
    const v = f.d[r * f.cols + q] * GRID + Math.abs(q - q0) * 2 + Math.abs(r - r0) * 2;
    if (v < best) best = v;
  }
  return best;
}

/** Simulate a shot; lower is better. */
function judgeShot(hole: number, x: number, y: number, vx: number, vy: number, t0: number): number {
  const f = distField(hole);
  const b = newBall(x, y);
  b.vx = vx; b.vy = vy;
  for (let t = t0; t < t0 + ROLL_CAP + 2; t++) {
    const code = rollFrame(f.c, b, t);
    if (code === SUNK) return -1e6 + (t - t0);
    if (code === WATER || code === ESCAPE) return 1e7;
    if (code === REST) return fieldAt(f, b.x, b.y);
  }
  return 1e7;
}

const BOT_DRAG = 18;
const BOT_POWERS = [0.15, 0.3, 0.5, 0.7, 0.9];
let botPlan = { hole: -1, t0: -1, sx: 0, sy: 0, tx: 0, ty: 0 };

function planShot(v: PuttView): { tx: number; ty: number } {
  const { s, ox, oy } = v.cam;
  const bx = v.ball.x * s + ox, by = v.ball.y * s + oy;
  const sx = Math.round(bx), sy = Math.round(by);
  const tRelease = v.t + 1 + BOT_DRAG;
  let best = Infinity, bt = { tx: sx, ty: sy + 40 };
  for (let a = 0; a < 256; a += 8) {
    const ca = cosF(a), sa = sinF(a);
    for (const p of BOT_POWERS) {
      const L = PULL_DEAD + p * PULL_MAX + 1;
      const tx = Math.max(0, Math.min(FIELD_W, Math.round(bx - ca * L)));
      const ty = Math.max(0, Math.min(FIELD_H, Math.round(by - sa * L)));
      const shot = shotFromPointer(bx, by, tx, ty);
      if (shot.power < MIN_POWER) continue;
      const score = judgeShot(v.hole, v.ball.x, v.ball.y, shot.vx, shot.vy, tRelease) + p * 3;
      if (score < best) { best = score; bt = { tx, ty }; }
    }
  }
  // A small, deterministic wobble keeps the bot imperfect.
  const h = (v.hole * 7 + v.strokes * 13 + v.t * 3) % 49;
  return { tx: bt.tx + (h % 7) - 3, ty: bt.ty + Math.floor(h / 7) - 3 };
}

export const putt: GameDef<PuttView> = {
  id: "putt",
  name: "Moon Putt",
  tagline: "Nine holes of moon golf: rotors, gates, bumpers and one very round coin.",
  genre: "Mini golf",
  session: "4–8 min",
  controls:
    "Press near the coin, pull back and release to putt (the dotted line shows where it goes; further = harder). Keyboard: ← / → aim, hold Space to charge, release to shoot. Water costs a stroke; 8 strokes max per hole.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 30 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original mini golf game: rules, ball physics, nine hole layouts and art written from scratch. No code, course data, characters, art or sounds from any commercial game.",
  },
  create: (seed) => new PuttEngine(seed),
  bot(v) {
    const { s, ox, oy } = v.cam;
    const sx = Math.round(v.ball.x * s + ox), sy = Math.round(v.ball.y * s + oy);
    const idle = { x: sx, y: sy, b: 0 };
    if (v.phase !== "aim") return idle;
    if (!v.aim.active) {
      if (v.phaseT < 15) return idle;
      const p = planShot(v);
      botPlan = { hole: v.hole, t0: v.t + 1, sx, sy, tx: p.tx, ty: p.ty };
      return { x: sx, y: sy, b: BTN.FIRE };
    }
    const k = v.t + 1 - botPlan.t0;
    if (botPlan.hole !== v.hole || k < 1 || k >= BOT_DRAG) return { x: botPlan.tx, y: botPlan.ty, b: 0 };
    const f = Math.min(1, k / (BOT_DRAG - 4));
    return {
      x: Math.round(botPlan.sx + (botPlan.tx - botPlan.sx) * f),
      y: Math.round(botPlan.sy + (botPlan.ty - botPlan.sy) * f),
      b: BTN.FIRE,
    };
  },
};
