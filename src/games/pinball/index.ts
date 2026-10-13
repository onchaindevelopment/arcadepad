/*
 * Moon Pinball: an original 2D pinball table for ArcadePad.
 * Original design and physics (no table layout, art or sound from any other
 * pinball game). ArcadePad, GPL-3.0-or-later.
 *
 * Physics: fixed 60 Hz with 8 substeps. The ball is a circle under gravity
 * (table tilt); static colliders are capsules (segments with a radius) and
 * circles; flippers are tapered capsules rotated by a byte angle, with their
 * surface velocity passed to the ball on contact. Only + - * / and Math.sqrt
 * plus core/trig.ts tables (linearly interpolated for sub-step angles).
 *
 * Table: plunger lane on the right, top orbit arc with a one-way gate, ticker
 * rollover lanes at the top (lane change with the flippers), 3 pop bumpers,
 * 2 slingshots, in/outlanes, a spinner lane on the left that arms a loop
 * shot, and a MOON mode (2-ball multiball) lit by loops and completed lanes.
 */
import { Rng } from "../core/rng.ts";
import { SIN256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- constants

export const FIELD_W = 400;
export const FIELD_H = 700;
export const BALL_R = 8;
const SUB = 8;
const H = 1 / (60 * SUB); // seconds per substep
const GRAVITY = 1250; // px/s^2 along the table
const MAX_SPEED = 1750; // px/s; 3.6 px per substep, well under the ball radius
const DRAG = 0.99986; // per substep
const DRAIN_Y = 735;
const TAU256 = 0.0245436926; // radians per byte-angle unit

const FLIP_LEN = 56;
const FLIP_R0 = 9; // radius at the pivot
const FLIP_R1 = 6; // radius at the tip
const FLIP_UP_SPEED = 1150; // byte units per second (~28 rad/s): snappy
const FLIP_DOWN_SPEED = 700;

const LAUNCH_MIN = 1150; // just clears the lane
const LAUNCH_MAX = 1330; // full plunge rides the whole orbit
const AUTO_LAUNCH = 180; // 3 s
const BALL_SAVE = 600; // 10 s
const BALLS = 3;
const BETWEEN = 100; // frames of end-of-ball bonus display

/** Playfield centre line (the plunger lane takes the right edge). */
export const MID_X = 185;
export const LANE_X = 376; // plunger lane ball x
export const PLUNGER_Y = 660;

export interface Seg {
  ax: number; ay: number; bx: number; by: number;
  r: number;
  e: number; // restitution
  kind: "wall" | "post" | "gate" | "plunger" | "sling" | "kicker";
  id: number; // sling index for sling/kicker
}

function seg(ax: number, ay: number, bx: number, by: number, kind: Seg["kind"] = "wall", r = 0, e = 0.4, id = -1): Seg {
  return { ax, ay, bx, by, r, e, kind, id };
}

/** Top arc: centre (200,200), radius 190, from the left wall over the top to the right wall. */
export const ARC: readonly [number, number][] = (() => {
  const pts: [number, number][] = [];
  for (let a = 128; a <= 256; a += 8) pts.push([200 + 190 * SIN256[(a + 64) & 255], 200 + 190 * SIN256[a & 255]]);
  return pts;
})();

const mirror = (x: number) => 2 * MID_X - x;

export const SLINGS: readonly { a: [number, number]; b: [number, number]; c: [number, number] }[] = [
  { a: [66, 460], b: [66, 540], c: [106, 566] },
  { a: [mirror(66), 460], b: [mirror(66), 540], c: [mirror(106), 566] },
];

export const BUMPERS: readonly { x: number; y: number; r: number }[] = [
  { x: 125, y: 245, r: 17 },
  { x: mirror(125), y: 245, r: 17 },
  { x: MID_X, y: 318, r: 17 },
];

export const FLIPPERS: readonly { px: number; py: number; rest: number; up: number }[] = [
  { px: 116, py: 612, rest: 22, up: -18 },
  { px: mirror(116), py: 612, rest: 128 - 22, up: 128 + 18 },
];

export const ORBIT_X = 58;
export const SPINNER = { x0: 10, x1: ORBIT_X, y0: 290, y1: 310 };
export const GATE: Seg = seg(392, 150, 360, 190, "gate", 2, 0.3);

const LANE_TOP = 86;
const LANE_BOT = 116;

/** Static walls (the rollover lane posts depend on the ticker and live on the engine). */
export const WALLS: readonly Seg[] = (() => {
  const w: Seg[] = [];
  for (let i = 0; i + 1 < ARC.length; i++) w.push(seg(ARC[i][0], ARC[i][1], ARC[i + 1][0], ARC[i + 1][1]));
  // Side walls: the plunger lane wall is the playfield's right wall.
  w.push(seg(10, 200, 10, 760), seg(390, 200, 390, 760), seg(360, 190, 360, 760, "wall", 1));
  w.push(seg(360, PLUNGER_Y, 390, PLUNGER_Y, "plunger", 0, 0.05));
  // Spinner lane (left orbit) inner wall.
  w.push(seg(ORBIT_X, 240, ORBIT_X, 400, "post", 3, 0.5));
  // Inlane / outlane guides.
  for (const m of [false, true]) {
    const X = (x: number) => (m ? mirror(x) : x);
    // Deflector: balls running down a side wall are steered into the inlane.
    w.push(seg(X(10), 410, X(28), 434, "wall", 2, 0.25), seg(X(28), 434, X(34), 456, "wall", 2, 0.25));
    w.push(seg(X(32), 490, X(32), 555, "post", 2), seg(X(32), 555, X(106), 596, "wall", 2));
  }
  // Slingshots: two plain edges and a kicking face.
  SLINGS.forEach((s, i) => {
    w.push(seg(s.a[0], s.a[1], s.b[0], s.b[1], "sling", 3, 0.25, i));
    w.push(seg(s.b[0], s.b[1], s.c[0], s.c[1], "sling", 3, 0.25, i));
    w.push(seg(s.a[0], s.a[1], s.c[0], s.c[1], "kicker", 3, 0.5, i));
  });
  return w;
})();

/** sin/cos of a fractional byte angle by linear interpolation of the table. */
function sinF(a: number): number {
  const i = Math.floor(a);
  const f = a - i;
  const s0 = SIN256[i & 255];
  return s0 + (SIN256[(i + 1) & 255] - s0) * f;
}
const cosF = (a: number) => sinF(a + 64);

// ---------------------------------------------------------------- types

interface Ball {
  id: number;
  x: number; y: number; vx: number; vy: number;
  inLane: boolean;
  autoIn: number; // frames until auto-launch once resting on the plunger
  ax: number; ay: number; af: number; // stuck-detection anchor
  loopArm: number; // frame until which a loop completion counts
  laneIn: number; // rollover lane the ball is in (-1 none)
  inSpin: boolean;
  flipF: number; // last frame touching a flipper
  drained: boolean;
}

export interface BallView { id: number; x: number; y: number; vx: number; vy: number; inLane: boolean }
export interface FlipperView { px: number; py: number; ex: number; ey: number; r0: number; r1: number; up: boolean; angle: number }
export interface LaneView { x0: number; x1: number; letter: string; lit: boolean }

export interface PinballView {
  frame: number;
  balls: BallView[];
  flippers: FlipperView[];
  lanes: LaneView[];
  lanePosts: number[];
  laneTop: number;
  laneBot: number;
  bumperFlash: number[]; // frames left
  slingFlash: number[];
  spinnerAngle: number; // byte units, for drawing
  plunger: { charge: number; ready: boolean };
  gateOpen: boolean;
  score: number;
  ballNo: number; // 1-based
  ballsLeft: number; // including the current one
  multiplier: number;
  bonusPool: number;
  saveLeft: number; // frames of ball save left (0 = off)
  moonProgress: number; // 0..3
  moonLit: boolean;
  multiball: boolean;
  tiltWarn: boolean;
  tilted: boolean;
  state: "play" | "between" | "over";
  lastBonus: number;
  ticker: string;
}

// ---------------------------------------------------------------- engine

export class PinballEngine implements GameEngine<PinballView> {
  frame = 0;
  events: GameEvent[] = [];
  private rng: Rng;
  private ticker: string;
  private balls: Ball[] = [];
  private nextId = 1;
  private flipA: number[] = FLIPPERS.map((f) => f.rest);
  private flipW: number[] = [0, 0]; // byte units per second
  private flipHeld = [false, false];
  private letters: string[];
  private lanePosts: number[];
  private laneWalls: Seg[];
  private lit: boolean[];
  private completions = 0;
  private prevB = 0;
  private charge = 0;
  private prevPlunge = false;
  private score = 0;
  private ballNo = 1;
  private ballsLeft = BALLS;
  private mult = 1;
  private bonusPool = 0;
  private saveUntil = 0;
  private freshBall = true;
  private moonProgress = 0;
  private moonLit = false;
  private spinnerSpins = 0;
  private spinnerAngle = 0;
  private spinnerSpeed = 0;
  private bumperFlash = [0, 0, 0];
  private bumperCd = [0, 0, 0];
  private slingFlash = [0, 0];
  private slingCd = [0, 0];
  private pendingLane = 0;
  private tilt = 0;
  private tiltWarn = false;
  private tilted = false;
  private nudgeCd = 0;
  private state: "play" | "between" | "over" = "play";
  private betweenT = 0;
  private lastBonus = 0;
  // scratch normal of the last collision
  private nx = 0;
  private ny = 0;

  constructor(seed: number, ticker: string) {
    this.rng = new Rng(seed);
    const t = (ticker || "MOON").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5) || "MOON";
    this.ticker = t;
    this.letters = [...t];
    while (this.letters.length < 3) this.letters.push("*");
    const n = this.letters.length;
    const span = 200;
    this.lanePosts = [];
    for (let k = 0; k <= n; k++) this.lanePosts.push(MID_X - span / 2 + (k * span) / n);
    this.laneWalls = this.lanePosts.map((x) => seg(x, LANE_TOP, x, LANE_BOT, "post", 3, 0.5));
    this.lit = this.letters.map(() => false);
    this.balls.push(this.laneBall(AUTO_LAUNCH));
  }

  private laneBall(autoIn: number): Ball {
    const y = PLUNGER_Y - BALL_R - 1;
    return {
      id: this.nextId++, x: LANE_X, y, vx: 0, vy: 0, inLane: true, autoIn,
      ax: LANE_X, ay: y, af: this.frame, loopArm: 0, laneIn: -1, inSpin: false, flipF: -100, drained: false,
    };
  }

  /** Test hook: put a ball anywhere on the table (replaces all balls). */
  placeBall(x: number, y: number, vx = 0, vy = 0) {
    const b = this.laneBall(AUTO_LAUNCH);
    b.x = x; b.y = y; b.vx = vx; b.vy = vy; b.inLane = false; b.ax = x; b.ay = y;
    this.balls = [b];
    this.freshBall = false;
  }

  private add(pts: number): number {
    if (this.tilted) return 0;
    const p = this.balls.length > 1 ? pts * 2 : pts;
    this.score += p;
    return p;
  }

  private isReady(b: Ball) {
    return b.inLane && b.y > PLUNGER_Y - 30 && Math.abs(b.vy) < 40 && Math.abs(b.vx) < 40;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.state === "over") return;
    const btn = inp.b | 0;
    const pressed = btn & ~this.prevB;
    this.prevB = btn;

    // ---- controls
    const ready = this.balls.find((b) => this.isReady(b));
    const inPlay = this.balls.some((b) => !b.inLane);
    const fireToPlunger = !!ready && !inPlay;
    const fire = (btn & BTN.FIRE) !== 0 && !fireToPlunger;
    let left = (btn & BTN.LEFT) !== 0 || (fire && inp.x < FIELD_W / 2);
    let right = (btn & BTN.RIGHT) !== 0 || (fire && inp.x >= FIELD_W / 2);
    if (this.tilted) left = right = false;
    if (left && !this.flipHeld[0]) this.laneChange(-1);
    if (right && !this.flipHeld[1]) this.laneChange(1);
    if (left && !this.flipHeld[0]) this.events.push({ t: "flip", side: 0 });
    if (right && !this.flipHeld[1]) this.events.push({ t: "flip", side: 1 });
    this.flipHeld[0] = left;
    this.flipHeld[1] = right;
    const plunge = (btn & BTN.DOWN) !== 0 || ((btn & BTN.FIRE) !== 0 && fireToPlunger);

    if (this.state === "between") {
      this.simFlippersOnly();
      if (--this.betweenT <= 0) {
        if (this.ballsLeft > 0) this.newBall();
        else {
          this.state = "over";
          this.events.push({ t: "gameover", sfx: "gameover" });
        }
      }
      this.prevPlunge = plunge;
      return;
    }

    // ---- nudge / tilt
    if (this.nudgeCd > 0) this.nudgeCd--;
    if (this.tilt > 0 && this.frame % 150 === 0) this.tilt--;
    if ((pressed & BTN.UP) && this.nudgeCd === 0 && !this.tilted) {
      this.nudgeCd = 30;
      this.tilt++;
      const dir = this.rng.int(2) * 2 - 1;
      for (const b of this.balls) if (!b.inLane) { b.vy -= 170; b.vx += dir * 70; }
      this.events.push({ t: "nudge", shake: 4 });
      if (this.tilt >= 4) {
        this.tilted = true;
        this.events.push({ t: "tilt", sfx: "extraBad", mood: "sad", shake: 8 });
      } else if (this.tilt === 3) {
        this.tiltWarn = true;
        this.events.push({ t: "tiltWarn", sfx: "extraBad" });
      }
    }
    if (this.tilt < 3) this.tiltWarn = false;

    // ---- plunger
    if (ready) {
      if (plunge) {
        this.charge = Math.min(1, this.charge + 1 / 45);
      } else if (this.prevPlunge && this.charge > 0) {
        this.launch(ready, this.charge);
      } else if (--ready.autoIn <= 0) {
        this.launch(ready, 0.6);
      }
    } else {
      this.charge = 0;
    }
    this.prevPlunge = plunge;

    // ---- physics
    for (let s = 0; s < SUB; s++) {
      this.stepFlippers();
      for (const b of this.balls) if (!b.drained) this.stepBall(b);
      if (this.balls.length === 2 && !this.balls[0].drained && !this.balls[1].drained) this.ballBall(this.balls[0], this.balls[1]);
    }

    // ---- per-frame bookkeeping
    for (let i = 0; i < 3; i++) {
      if (this.bumperFlash[i] > 0) this.bumperFlash[i]--;
      if (this.bumperCd[i] > 0) this.bumperCd[i]--;
    }
    for (let i = 0; i < 2; i++) {
      if (this.slingFlash[i] > 0) this.slingFlash[i]--;
      if (this.slingCd[i] > 0) this.slingCd[i]--;
    }
    this.spinnerAngle += this.spinnerSpeed;
    this.spinnerSpeed *= 0.97;
    if (this.spinnerSpins > 0 && this.frame % 3 === 0) {
      this.spinnerSpins--;
      const p = this.add(100);
      this.bonusPool += 20;
      this.events.push({ t: "spin", pts: p, x: (SPINNER.x0 + SPINNER.x1) / 2, y: SPINNER.y0 });
    }
    this.checkStuck();
    this.handleDrains();
    if (this.pendingLane > 0 && this.state === "play" && !this.balls.some((b) => b.inLane)) {
      this.pendingLane--;
      this.balls.push(this.laneBall(15));
    }
  }

  private newBall() {
    this.state = "play";
    this.balls = [this.laneBall(AUTO_LAUNCH)];
    this.freshBall = true;
    this.mult = 1;
    this.bonusPool = 0;
    this.tilt = 0;
    this.tiltWarn = false;
    this.tilted = false;
    this.saveUntil = 0;
    this.charge = 0;
  }

  private launch(b: Ball, charge: number) {
    b.vy = -(LAUNCH_MIN + (LAUNCH_MAX - LAUNCH_MIN) * charge);
    b.vx = 0;
    this.charge = 0;
    this.events.push({ t: "launch", sfx: "launch", power: charge, x: b.x, y: b.y });
    if (this.freshBall) {
      this.freshBall = false;
      this.saveUntil = this.frame + BALL_SAVE;
    }
  }

  private laneChange(dir: number) {
    const n = this.lit.length;
    if (this.lit.every((l) => !l) || this.lit.every((l) => l)) return;
    const old = this.lit.slice();
    for (let i = 0; i < n; i++) this.lit[i] = old[(i - dir + n) % n];
  }

  private flipperGeom(i: number) {
    const f = FLIPPERS[i];
    const a = this.flipA[i];
    return { px: f.px, py: f.py, ex: f.px + FLIP_LEN * cosF(a), ey: f.py + FLIP_LEN * sinF(a) };
  }

  private simFlippersOnly() {
    for (let s = 0; s < SUB; s++) this.stepFlippers();
  }

  private stepFlippers() {
    for (let i = 0; i < 2; i++) {
      const f = FLIPPERS[i];
      const target = this.flipHeld[i] ? f.up : f.rest;
      const speed = this.flipHeld[i] ? FLIP_UP_SPEED : FLIP_DOWN_SPEED;
      const d = target - this.flipA[i];
      const stepA = speed * H;
      if (d === 0) this.flipW[i] = 0;
      else if (Math.abs(d) <= stepA) {
        this.flipA[i] = target;
        this.flipW[i] = 0;
      } else {
        const dir = d > 0 ? 1 : -1;
        this.flipA[i] += dir * stepA;
        this.flipW[i] = dir * speed;
      }
    }
  }

  /**
   * Capsule collision. (ax,ay)-(bx,by) with radius r0 at a and r1 at b; surface
   * velocity given as an angular velocity w (rad/s) around (ox,oy), or zero.
   * Returns the impact normal speed (>= 0) or -1 when not touching.
   */
  private capsule(b: Ball, ax: number, ay: number, bx: number, by: number, r0: number, r1: number, e: number, fr: number, w: number, ox: number, oy: number): number {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((b.x - ax) * dx + (b.y - ay) * dy) / l2 : 0;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    const cx = ax + dx * t, cy = ay + dy * t;
    const rr = r0 + (r1 - r0) * t;
    const minD = BALL_R + rr;
    let px = b.x - cx, py = b.y - cy;
    const d2 = px * px + py * py;
    if (d2 >= minD * minD) return -1;
    let dist = Math.sqrt(d2);
    if (dist < 1e-6) {
      // Dead centre: push out perpendicular to the segment (up-ish).
      const l = Math.sqrt(l2) || 1;
      px = dy / l; py = -dx / l;
      if (py > 0) { px = -px; py = -py; }
      dist = 1e-6;
    } else {
      px /= dist; py /= dist;
    }
    this.nx = px; this.ny = py;
    b.x += px * (minD - dist);
    b.y += py * (minD - dist);
    // Surface velocity at the contact point.
    const sx = w !== 0 ? -w * (cy - oy) : 0;
    const sy = w !== 0 ? w * (cx - ox) : 0;
    const rvx = b.vx - sx, rvy = b.vy - sy;
    const vn = rvx * px + rvy * py;
    if (vn >= 0) return 0;
    const tx = rvx - vn * px, ty = rvy - vn * py;
    const ee = vn > -40 ? 0 : e; // resting contact: no bounce, no jitter
    const k = 1 - fr;
    b.vx = tx * k - ee * vn * px + sx;
    b.vy = ty * k - ee * vn * py + sy;
    return -vn;
  }

  private circle(b: Ball, cx: number, cy: number, r: number): boolean {
    const px = b.x - cx, py = b.y - cy;
    const minD = BALL_R + r;
    const d2 = px * px + py * py;
    if (d2 >= minD * minD || d2 < 1e-9) return false;
    const dist = Math.sqrt(d2);
    const nx = px / dist, ny = py / dist;
    b.x = cx + nx * minD;
    b.y = cy + ny * minD;
    const vn = b.vx * nx + b.vy * ny;
    if (vn < 0) {
      b.vx -= 1.5 * vn * nx;
      b.vy -= 1.5 * vn * ny;
    }
    this.nx = nx; this.ny = ny;
    return true;
  }

  private stepBall(b: Ball) {
    b.vy += GRAVITY * H;
    b.vx *= DRAG;
    b.vy *= DRAG;
    const sp2 = b.vx * b.vx + b.vy * b.vy;
    if (sp2 > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(sp2);
      b.vx *= k; b.vy *= k;
    }
    b.x += b.vx * H;
    b.y += b.vy * H;

    // Lane membership: leaves the plunger lane once left of the lane wall.
    if (b.inLane && b.x < 352) b.inLane = false;
    else if (!b.inLane && b.x > 362 && b.y > 200) b.inLane = true;

    // Static walls
    for (const w of WALLS) {
      const imp = this.capsule(b, w.ax, w.ay, w.bx, w.by, w.r, w.r, w.e, 0.0015, 0, 0, 0);
      if (imp < 0) continue;
      if (w.kind === "kicker" && this.slingCd[w.id] === 0 && imp > 40) {
        // The kicking face pushes the ball away along its normal.
        b.vx += this.nx * 520;
        b.vy += this.ny * 520;
        this.slingCd[w.id] = 10;
        this.slingFlash[w.id] = 8;
        const s = SLINGS[w.id];
        const p = this.add(10);
        this.events.push({ t: "sling", sfx: "wall", i: w.id, pts: p, shake: 2, x: (s.a[0] + s.c[0]) / 2, y: (s.a[1] + s.c[1]) / 2 });
      }
    }
    if (!b.inLane) this.capsule(b, GATE.ax, GATE.ay, GATE.bx, GATE.by, GATE.r, GATE.r, GATE.e, 0.0015, 0, 0, 0);
    for (const w of this.laneWalls) this.capsule(b, w.ax, w.ay, w.bx, w.by, w.r, w.r, w.e, 0.0015, 0, 0, 0);

    // Pop bumpers
    for (let i = 0; i < 3; i++) {
      const u = BUMPERS[i];
      if (!this.circle(b, u.x, u.y, u.r)) continue;
      // Kick away, with a little seeded scatter so no two games play the same.
      const j = this.rng.int(81) - 40;
      b.vx += this.nx * 430 - this.ny * j;
      b.vy += this.ny * 430 + this.nx * j;
      if (this.bumperCd[i] === 0) {
        this.bumperCd[i] = 5;
        this.bumperFlash[i] = 10;
        const p = this.add(100);
        this.bonusPool += 50;
        this.events.push({ t: "bumper", sfx: "paddle", i, pts: p, shake: 2, x: u.x, y: u.y });
      }
    }

    // Flippers
    for (let i = 0; i < 2; i++) {
      const g = this.flipperGeom(i);
      const imp = this.capsule(b, g.px, g.py, g.ex, g.ey, FLIP_R0, FLIP_R1, 0.28, 0.003, this.flipW[i] * TAU256, g.px, g.py);
      if (imp < 0) continue;
      b.flipF = this.frame;
      // A ball balanced on top of the pivot cap rolls off toward the tip.
      const dx = b.x - g.px;
      if (dx < 3 && dx > -3 && b.y < g.py && b.vx < 8 && b.vx > -8) b.vx += i === 0 ? 12 : -12;
    }

    // Final speed clamp after kicks.
    const sq = b.vx * b.vx + b.vy * b.vy;
    if (sq > MAX_SPEED * MAX_SPEED) {
      const k = MAX_SPEED / Math.sqrt(sq);
      b.vx *= k; b.vy *= k;
    }

    // Safety net: never leave the cabinet (should not happen).
    if (!(b.x >= 0 && b.x <= FIELD_W && b.y >= -20) || b.x !== b.x || b.y !== b.y) {
      b.x = LANE_X; b.y = PLUNGER_Y - BALL_R - 1; b.vx = 0; b.vy = 0; b.inLane = true; b.autoIn = 30;
    }

    this.sensors(b);
    if (b.y > DRAIN_Y) b.drained = true;
  }

  private sensors(b: Ball) {
    // Rollover lanes
    let lane = -1;
    if (b.y > LANE_TOP + 6 && b.y < LANE_BOT - 4) {
      for (let i = 0; i + 1 < this.lanePosts.length; i++) {
        if (b.x > this.lanePosts[i] + 3 && b.x < this.lanePosts[i + 1] - 3) lane = i;
      }
    }
    if (lane >= 0 && lane !== b.laneIn) this.rollover(lane);
    b.laneIn = lane;

    // Spinner lane
    const inSpin = b.x > SPINNER.x0 && b.x < SPINNER.x1 && b.y > SPINNER.y0 && b.y < SPINNER.y1;
    if (inSpin && !b.inSpin) {
      const sp = Math.abs(b.vy);
      const spins = Math.min(14, Math.floor(sp / 90));
      this.spinnerSpins += spins;
      this.spinnerSpeed = Math.min(40, sp / 30) * (b.vy < 0 ? 1 : -1);
      this.events.push({ t: "spinner", sfx: "brick", x: (SPINNER.x0 + SPINNER.x1) / 2, y: SPINNER.y0 });
      if (b.vy < 0) {
        b.loopArm = this.frame + 150;
        if (this.moonLit && this.balls.length === 1 && !this.tilted) this.startMultiball();
      }
    }
    b.inSpin = inSpin;

    // Loop completion: up the spinner lane, round the arc, down the right side.
    if (b.loopArm > this.frame && b.x > 290 && b.y < 140) {
      b.loopArm = 0;
      const p = this.add(2500);
      this.bonusPool += 1000;
      this.events.push({ t: "loop", sfx: "brickgone", pts: p, x: b.x, y: b.y + 20 });
      this.moonStep();
    }
  }

  private rollover(i: number) {
    const x = (this.lanePosts[i] + this.lanePosts[i + 1]) / 2;
    if (this.lit[i]) {
      const p = this.add(50);
      this.events.push({ t: "laneAgain", pts: p, i, x, y: LANE_BOT });
      return;
    }
    this.lit[i] = true;
    const p = this.add(500);
    this.bonusPool += 250;
    this.events.push({ t: "lane", sfx: "brick", i, letter: this.letters[i], pts: p, x, y: LANE_BOT });
    if (this.lit.every((l) => l)) {
      this.completions++;
      this.mult = Math.min(6, this.mult + 1);
      const q = this.add(5000);
      this.bonusPool += 2000;
      for (let k = 0; k < this.lit.length; k++) this.lit[k] = false;
      this.events.push({ t: "lanesComplete", sfx: "extraGood", mood: "happy", toast: "levelClear", mult: this.mult, pts: q, shake: 5, x: MID_X, y: LANE_BOT + 20 });
      this.moonStep();
    }
  }

  private moonStep() {
    if (this.moonLit || this.tilted) return;
    this.moonProgress++;
    if (this.moonProgress >= 3) {
      this.moonLit = true;
      this.events.push({ t: "moonLit", sfx: "extraGood", mood: "happy", x: (SPINNER.x0 + SPINNER.x1) / 2, y: SPINNER.y1 + 30 });
    }
  }

  private startMultiball() {
    this.moonLit = false;
    this.moonProgress = 0;
    this.pendingLane++;
    this.saveUntil = Math.max(this.saveUntil, this.frame + 480);
    const p = this.add(10000);
    this.events.push({ t: "multiball", sfx: "levelclear", mood: "happy", shake: 6, pts: p, x: MID_X, y: 380 });
  }

  private ballBall(a: Ball, b: Ball) {
    let dx = b.x - a.x, dy = b.y - a.y;
    const d2 = dx * dx + dy * dy;
    const minD = 2 * BALL_R;
    if (d2 >= minD * minD || d2 < 1e-9) return;
    const d = Math.sqrt(d2);
    dx /= d; dy /= d;
    const push = (minD - d) / 2;
    a.x -= dx * push; a.y -= dy * push;
    b.x += dx * push; b.y += dy * push;
    const vn = (b.vx - a.vx) * dx + (b.vy - a.vy) * dy;
    if (vn >= 0) return;
    const j = -0.95 * vn; // (1+e)/2 with e = 0.9
    a.vx -= j * dx; a.vy -= j * dy;
    b.vx += j * dx; b.vy += j * dy;
  }

  private checkStuck() {
    for (const b of this.balls) {
      if (b.drained) continue;
      const dx = b.x - b.ax, dy = b.y - b.ay;
      const cradled = this.frame - b.flipF < 3 && (this.flipHeld[0] || this.flipHeld[1]);
      if (dx * dx + dy * dy > 144 || cradled || this.isReady(b)) {
        b.ax = b.x; b.ay = b.y; b.af = this.frame;
        continue;
      }
      if (this.frame - b.af > 180) {
        // Stuck for 3 s: a little table bump frees it.
        b.vy = -450 - this.rng.int(200);
        b.vx = (this.rng.int(2) * 2 - 1) * (150 + this.rng.int(200));
        b.af = this.frame;
        this.events.push({ t: "unstick", shake: 3, x: b.x, y: b.y });
      }
    }
  }

  private handleDrains() {
    if (!this.balls.some((b) => b.drained)) return;
    const live = this.balls.filter((b) => !b.drained);
    for (const b of this.balls) {
      if (!b.drained) continue;
      if (this.frame < this.saveUntil && !this.tilted) {
        this.pendingLane++;
        this.events.push({ t: "save", sfx: "extraGood", x: b.x, y: FIELD_H - 20 });
      } else if (live.length > 0 || this.pendingLane > 0) {
        this.events.push({ t: "multiballEnd", x: b.x, y: FIELD_H - 20 });
      }
    }
    this.balls = live;
    if (this.balls.length > 0 || this.pendingLane > 0) return;
    // Ball over.
    this.ballsLeft--;
    const bonus = this.tilted ? 0 : this.bonusPool * this.mult;
    this.score += bonus;
    this.lastBonus = bonus;
    this.events.push({
      t: "drain", sfx: "lost", mood: "sad", toast: this.ballsLeft > 0 ? "lifeLost" : undefined, shake: 5,
      bonus, mult: this.mult, x: MID_X, y: FIELD_H - 20,
    });
    this.moonLit = false;
    this.state = "between";
    this.betweenT = BETWEEN;
    if (this.ballsLeft > 0) this.ballNo++;
  }

  view(): PinballView {
    return {
      frame: this.frame,
      balls: this.balls.map((b) => ({ id: b.id, x: b.x, y: b.y, vx: b.vx, vy: b.vy, inLane: b.inLane })),
      flippers: [0, 1].map((i) => {
        const g = this.flipperGeom(i);
        return { ...g, r0: FLIP_R0, r1: FLIP_R1, up: this.flipHeld[i], angle: this.flipA[i] };
      }),
      lanes: this.letters.map((letter, i) => ({ x0: this.lanePosts[i], x1: this.lanePosts[i + 1], letter, lit: this.lit[i] })),
      lanePosts: this.lanePosts,
      laneTop: LANE_TOP,
      laneBot: LANE_BOT,
      bumperFlash: this.bumperFlash.slice(),
      slingFlash: this.slingFlash.slice(),
      spinnerAngle: this.spinnerAngle,
      plunger: { charge: this.charge, ready: this.balls.some((b) => this.isReady(b)) },
      gateOpen: this.balls.some((b) => b.inLane),
      score: this.score,
      ballNo: this.ballNo,
      ballsLeft: this.ballsLeft,
      multiplier: this.mult,
      bonusPool: this.bonusPool,
      saveLeft: Math.max(0, this.saveUntil - this.frame),
      moonProgress: this.moonProgress,
      moonLit: this.moonLit,
      multiball: this.balls.length > 1,
      tiltWarn: this.tiltWarn,
      tilted: this.tilted,
      state: this.state,
      lastBonus: this.lastBonus,
      ticker: this.ticker,
    };
  }

  hud(): Hud {
    const label = this.tilted ? "TILT" : this.balls.length > 1 ? "MOON BALL x2" : this.moonLit ? "MOON LIT" : `Bonus x${this.mult}`;
    return { score: this.score, lives: this.ballsLeft, label: `Ball ${this.ballNo} · ${label}` };
  }

  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: this.completions, frames: this.frame, status: this.state === "over" ? "over" : "playing" };
  }

  get done() {
    return this.state === "over";
  }
}

// ---------------------------------------------------------------- definition

export const pinball: GameDef<PinballView> = {
  id: "pinball",
  name: "Moon Pinball",
  tagline: "Light the ticker, loop the moon, keep the ball alive.",
  genre: "Pinball",
  session: "2–6 min",
  controls:
    "← / → (or tap left / right half) flip. Hold ↓ or Space to pull the plunger, release to launch (auto-launch after 3 s). ↑ nudges the table: too many nudges and it tilts. Light every ticker lane for a bonus multiplier; loops and full lanes light MOON, then shoot the left spinner lane for 2-ball multiball.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original table layout, rules and physics written from scratch. No code, table data, art or sounds from any other pinball game.",
  },
  create: (seed, ctx) => new PinballEngine(seed, ctx.ticker),
  bot(v, frame) {
    let b = 0;
    const inPlay = v.balls.some((q) => !q.inLane);
    for (const q of v.balls) {
      if (q.inLane || q.y < 540 || q.y > 650) continue;
      const side = q.x < MID_X ? 0 : 1;
      const f = v.flippers[side];
      const dx = q.x - f.px, dy = q.y - f.py;
      const d2 = dx * dx + dy * dy;
      if (d2 > 76 * 76) continue;
      // Flip at a ball dropping in, or one rolling down the lowered flipper; a ball
      // sitting in the crook by the pivot is let go so it rolls out to the tip.
      const slow = q.vx * q.vx + q.vy * q.vy < 120 * 120;
      if (q.vy > 60 || (f.up && q.vy > -200) || (slow && d2 > 30 * 30)) b |= side === 0 ? BTN.LEFT : BTN.RIGHT;
      if (f.up && slow && d2 < 30 * 30 && frame % 60 < 30) b &= side === 0 ? ~BTN.LEFT : ~BTN.RIGHT;
    }
    if (v.plunger.ready && !inPlay && frame % 100 < 60) b |= BTN.DOWN;
    return { x: FIELD_W >> 1, y: FIELD_H >> 1, b };
  },
};
