/*
 * Hoop Flick: original flick-to-shoot basketball for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original design, no code or assets ported.
 *
 * A coin ball waits on the court. Press on it, swipe up and let go: the launch
 * velocity comes from the last few frames of pointer movement. Holding FIRE
 * without moving charges a power meter instead (LEFT/RIGHT aim), so keyboard
 * play works too. Side view: the hoop has a backboard on its right and a rim
 * made of two small circles; the ball must drop down between them.
 *
 * 60 second run. Basket +2, swish (no rim or board touch) +3, moon ball +5,
 * times a streak multiplier. After 10 baskets the hoop starts sliding
 * sideways and speeds up with every 5 more.
 *
 * Physics (deterministic: + - * / and Math.sqrt only): px and px/frame,
 * gravity per frame, SUB substeps per frame for collisions.
 */
import { Rng } from "../core/rng.ts";
import { SIN256, cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const FLOOR_Y = 566;
export const BALL_Y = 524; // resting centre of a fresh ball
export const BR = 13; // ball radius (physics)
export const HOOP_Y = 214; // rim height
export const HOOP_CX = 172; // hoop centre when still
export const RIM_HALF = 30; // centre of rim circle to hoop centre
export const RR = 4; // rim circle radius
export const BOARD_DX = 40; // backboard x offset from hoop centre
export const BOARD_TOP = 124;
export const BOARD_BOT = 228;
export const BOARD_HALF = 3; // half thickness
export const GRAVITY = 0.45; // px/frame^2
export const MAX_V = 22; // px/frame
const MIN_VY = 5; // a flick must go at least this fast upward
export const SUB = 4;
export const GAIN = 0.85; // launch velocity per px/frame of swipe
export const HIST = 4; // frames of pointer movement used for the flick
const AUTO_FLICK = 140; // drag this far up and the ball goes on its own
const CHARGE_MIN = 8; // frames held still before the power meter shows
const CHARGE_PERIOD = 50; // frames 0 -> full power
const STILL = 6; // px the pointer may wander and still count as "held still"
export const AIM_MIN = 192 - 22; // byte angles, 192 = straight up
export const AIM_MAX = 192 + 22;
export const TIME = 60 * 60;
const IDLE_START = 150; // the clock starts on the first touch or after this
const RESPAWN = 16;
const MAX_FLIGHT = 360;
export const MOVE_AT = 10; // baskets before the hoop starts moving

export type Phase = "ready" | "flight" | "respawn" | "over";

export interface HoopsView {
  frame: number;
  phase: Phase;
  phaseT: number;
  ball: { x: number; y: number; vx: number; vy: number; moon: boolean };
  /** Shot state for the renderer. */
  shot: { touched: boolean; scored: boolean; swish: boolean };
  hoop: { x: number; vx: number; moving: boolean };
  /** Drag or charge in progress. */
  aim: { mode: "none" | "drag" | "charge"; angle: number; power: number; gx: number; gy: number; px: number; py: number };
  /** Frames since the ball last dropped through the net (999 = long ago). */
  netT: number;
  timeLeft: number; // frames
  started: boolean;
  score: number;
  baskets: number;
  streak: number;
  mult: number;
  level: number;
}

/** Linear interpolation of the byte sine table at a fractional byte angle. */
export function sinLerp(a: number): number {
  const f0 = Math.floor(a);
  const f = a - f0;
  const s0 = SIN256[f0 & 255];
  const s1 = SIN256[(f0 + 1) & 255];
  return s0 + (s1 - s0) * f;
}

export function multFor(streak: number): number {
  return Math.min(4, 1 + Math.floor((streak - 1) / 3));
}

/** Launch velocity from a swipe: average px/frame times GAIN, clamped. Null if not a usable flick. */
export function flickVelocity(dx: number, dy: number, frames: number): { vx: number; vy: number } | null {
  if (frames <= 0) return null;
  let vx = (dx / frames) * GAIN;
  let vy = (dy / frames) * GAIN;
  if (vy > -MIN_VY) return null;
  const s = Math.sqrt(vx * vx + vy * vy);
  if (s > MAX_V) {
    vx = (vx * MAX_V) / s;
    vy = (vy * MAX_V) / s;
  }
  return { vx, vy };
}

class HoopsEngine implements GameEngine<HoopsView> {
  private rng: Rng;
  private phase: Phase = "ready";
  private phaseT = 0;
  private x = 0;
  private y = BALL_Y;
  private vx = 0;
  private vy = 0;
  private moon = false;
  private touched = false;
  private scored = false;
  private swish = false;
  private hx = HOOP_CX;
  private hvx = 0;
  private hPhase = 0; // byte angle, fractional
  private hAmp = 0;
  private hSpeed = 0;
  private prevB = 0;
  private mode: "none" | "drag" | "charge" = "none";
  private hist: { x: number; y: number }[] = [];
  private gx = 0;
  private gy = 0;
  private held = 0;
  private moved = false;
  private aim = 192;
  private power = 0;
  private netT = 999;
  private started = false;
  private clock = TIME;
  private score = 0;
  private baskets = 0;
  private streak = 0;
  private sinceRim = 99;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.spawn();
  }

  private spawn() {
    this.x = this.rng.range(46, 290);
    this.y = BALL_Y;
    this.vx = 0;
    this.vy = 0;
    this.moon = this.baskets >= 3 && this.rng.int(7) === 0;
    this.touched = false;
    this.scored = false;
    this.swish = false;
    this.phase = "ready";
    this.phaseT = 0;
    this.mode = "none";
    this.hist = [];
    this.power = 0;
    if (this.moon) this.events.push({ t: "moon", sfx: "extraGood", x: this.x, y: this.y });
  }

  private get level() {
    return this.baskets < MOVE_AT ? 0 : 1 + Math.floor((this.baskets - MOVE_AT) / 5);
  }

  private moveHoop() {
    const old = this.hx;
    if (this.baskets >= MOVE_AT) {
      const k = this.baskets - MOVE_AT;
      const ampT = Math.min(112, 46 + k * 6);
      const spdT = Math.min(2.6, 0.55 + k * 0.12);
      this.hAmp += Math.min(0.5, ampT - this.hAmp);
      this.hSpeed += Math.min(0.004, spdT - this.hSpeed);
      this.hPhase += this.hSpeed;
      if (this.hPhase >= 256) this.hPhase -= 256;
    }
    this.hx = HOOP_CX + this.hAmp * sinLerp(this.hPhase);
    this.hvx = this.hx - old;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    this.phaseT++;
    if (this.netT < 999) this.netT++;
    this.sinceRim++;

    if (pressed && !this.started) this.started = true;
    if (!this.started && this.frame >= IDLE_START) this.started = true;
    if (this.started && this.clock > 0) {
      this.clock--;
      if (this.clock === 0) this.events.push({ t: "buzzer", sfx: "levelclear" });
    }
    this.moveHoop();

    if (this.phase === "ready") {
      if (this.clock === 0) return this.finish();
      if (inp.b & BTN.LEFT) this.aim = Math.max(AIM_MIN, this.aim - 1);
      if (inp.b & BTN.RIGHT) this.aim = Math.min(AIM_MAX, this.aim + 1);
      this.handleInput(inp, pressed, released);
    } else if (this.phase === "flight") {
      this.fly();
    } else if (this.phase === "respawn") {
      if (this.phaseT >= RESPAWN) {
        if (this.clock === 0) return this.finish();
        this.spawn();
      }
    }
  }

  private handleInput(inp: Input, pressed: number, released: number) {
    if (this.mode === "none" && pressed & BTN.FIRE) {
      this.mode = "drag";
      this.gx = inp.x;
      this.gy = inp.y;
      this.hist = [{ x: inp.x, y: inp.y }];
      this.held = 0;
      this.moved = false;
      this.power = 0;
      return;
    }
    if (this.mode === "none") return;
    if (inp.b & BTN.FIRE) {
      this.held++;
      this.hist.push({ x: inp.x, y: inp.y });
      if (this.hist.length > HIST + 1) this.hist.shift();
      if (Math.abs(inp.x - this.gx) > STILL || Math.abs(inp.y - this.gy) > STILL) this.moved = true;
      if (!this.moved && this.held >= CHARGE_MIN) {
        this.mode = "charge";
        const c = (this.held - CHARGE_MIN) % (CHARGE_PERIOD * 2);
        this.power = (c <= CHARGE_PERIOD ? c : CHARGE_PERIOD * 2 - c) / CHARGE_PERIOD;
      }
      if (this.mode === "drag" && this.gy - inp.y >= AUTO_FLICK) this.tryFlick();
      return;
    }
    if (released & BTN.FIRE) {
      if (this.mode === "charge" && !this.moved) {
        const s = 12 + 10 * this.power;
        this.launch(cos256(this.aim) * s, sin256(this.aim) * s);
      } else this.tryFlick();
      this.mode = "none";
    }
  }

  private tryFlick() {
    const h = this.hist;
    const a = h[0];
    const b = h[h.length - 1];
    const v = flickVelocity(b.x - a.x, b.y - a.y, h.length - 1);
    this.mode = "none";
    if (v) this.launch(v.vx, v.vy);
  }

  private launch(vx: number, vy: number) {
    this.vx = vx;
    this.vy = vy;
    this.phase = "flight";
    this.phaseT = 0;
    this.mode = "none";
    this.events.push({ t: "launch", sfx: "launch", x: this.x, y: this.y });
  }

  private fly() {
    const hx = this.hx;
    const lx = hx - RIM_HALF;
    const rx = hx + RIM_HALF;
    const bx = hx + BOARD_DX;
    for (let s = 0; s < SUB; s++) {
      this.vy += GRAVITY / SUB;
      const py = this.y;
      this.x += this.vx / SUB;
      this.y += this.vy / SUB;
      this.rim(lx, HOOP_Y);
      this.rim(rx, HOOP_Y);
      this.board(bx);
      // walls
      if (this.x < BR && this.vx < 0) {
        this.x = BR;
        this.vx = -this.vx * 0.6;
        this.events.push({ t: "wallhit", sfx: "wall", x: this.x, y: this.y });
      } else if (this.x > W - BR && this.vx > 0) {
        this.x = W - BR;
        this.vx = -this.vx * 0.6;
        this.events.push({ t: "wallhit", sfx: "wall", x: this.x, y: this.y });
      }
      if (!this.scored && py < HOOP_Y && this.y >= HOOP_Y && this.vy > 0 && this.x > lx + RR && this.x < rx - RR) this.basket();
    }
    if (this.y - BR > FLOOR_Y || this.phaseT >= MAX_FLIGHT) this.endShot();
  }

  private rim(cx: number, cy: number) {
    const dx = this.x - cx;
    const dy = this.y - cy;
    const d2 = dx * dx + dy * dy;
    const r = BR + RR;
    if (d2 >= r * r || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    this.x = cx + nx * r;
    this.y = cy + ny * r;
    this.bounce(nx, ny, 0.55, "rim", "paddle");
  }

  private board(bx: number) {
    const cy = this.y < BOARD_TOP ? BOARD_TOP : this.y > BOARD_BOT ? BOARD_BOT : this.y;
    const dx = this.x - bx;
    const dy = this.y - cy;
    const d2 = dx * dx + dy * dy;
    const r = BR + BOARD_HALF;
    if (d2 >= r * r || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    this.x = bx + nx * r;
    this.y = cy + ny * r;
    this.bounce(nx, ny, 0.7, "board", "wall");
  }

  private bounce(nx: number, ny: number, rest: number, t: string, sfx: "paddle" | "wall") {
    const rvx = this.vx - (t === "rim" ? this.hvx : 0);
    const vn = rvx * nx + this.vy * ny;
    if (vn >= 0) return;
    const tx = -ny;
    const ty = nx;
    const vt = rvx * tx + this.vy * ty;
    const nvn = -vn * rest;
    const nvt = vt * 0.92;
    this.vx = nx * nvn + tx * nvt + (t === "rim" ? this.hvx : 0);
    this.vy = ny * nvn + ty * nvt;
    this.touched = true;
    if (-vn > 1.2 && this.sinceRim > 3) {
      this.sinceRim = 0;
      this.events.push({ t, sfx, x: this.x, y: this.y, power: -vn });
    }
  }

  private basket() {
    this.scored = true;
    this.swish = !this.touched;
    this.streak++;
    this.baskets++;
    const base = this.moon ? 5 : this.swish ? 3 : 2;
    const mult = multFor(this.streak);
    const pts = base * mult;
    this.score += pts;
    this.netT = 0;
    const big = this.moon || this.swish;
    this.events.push({
      t: "basket",
      sfx: big ? "extraGood" : "brickgone",
      mood: big || mult > 1 ? "happy" : undefined,
      shake: big ? 4 : 2,
      x: this.hx,
      y: HOOP_Y,
      pts,
      base,
      mult,
      swish: this.swish,
      moon: this.moon,
      streak: this.streak,
    });
    if (this.baskets === MOVE_AT || (this.baskets > MOVE_AT && (this.baskets - MOVE_AT) % 5 === 0)) {
      this.events.push({ t: "speedup", sfx: "levelclear", toast: "levelClear", level: this.level, x: this.hx, y: HOOP_Y - 60 });
    }
  }

  private endShot() {
    if (!this.scored) {
      const lostStreak = this.streak;
      this.streak = 0;
      this.events.push({ t: "miss", sfx: "lost", mood: lostStreak >= 3 ? "sad" : undefined, x: this.x, y: FLOOR_Y, lostStreak });
    } else this.events.push({ t: "land", sfx: "wall", x: this.x, y: FLOOR_Y });
    this.phase = "respawn";
    this.phaseT = 0;
  }

  private finish() {
    this.phase = "over";
    this.phaseT = 0;
    this.mode = "none";
    this.events.push({ t: "gameover", sfx: "gameover", mood: this.score > 0 ? "happy" : "sad" });
  }

  view(): HoopsView {
    const last = this.hist.length ? this.hist[this.hist.length - 1] : { x: this.gx, y: this.gy };
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      ball: { x: this.x, y: this.y, vx: this.vx, vy: this.vy, moon: this.moon },
      shot: { touched: this.touched, scored: this.scored, swish: this.swish },
      hoop: { x: this.hx, vx: this.hvx, moving: this.baskets >= MOVE_AT },
      aim: { mode: this.mode, angle: this.aim, power: this.power, gx: this.gx, gy: this.gy, px: last.x, py: last.y },
      netT: this.netT,
      timeLeft: this.clock,
      started: this.started,
      score: this.score,
      baskets: this.baskets,
      streak: this.streak,
      mult: multFor(this.streak + 1),
      level: this.level,
    };
  }
  hud(): Hud {
    const secs = Math.ceil(this.clock / 60);
    const m = multFor(this.streak + 1);
    return { score: this.score, level: this.level + 1, label: `${secs}s${m > 1 ? ` · x${m}` : ""}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.level, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

/** Small integer hash for bot noise (deterministic). */
function hash(n: number): number {
  return Math.imul(n ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
}

export const hoops: GameDef<HoopsView> = {
  id: "hoops",
  name: "Hoop Flick",
  tagline: "Flick the coin, sink the shot. 60 seconds, then the hoop starts running.",
  genre: "Flick basketball",
  session: "1 min",
  controls: "Press the ball, swipe up and let go. Keys: LEFT/RIGHT aim, hold Space for power, release to shoot.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: TIME + IDLE_START + MAX_FLIGHT + 600,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the flick-to-shoot basketball genre. No code, art, sounds or names from any existing game; all art is drawn with the ArcadePad kit.",
  },
  create: (seed) => new HoopsEngine(seed),
  bot(v, frame) {
    const idle = { x: v.aim.px, y: v.aim.py, b: 0 };
    if (v.phase !== "ready") return idle;
    const bx = Math.round(v.ball.x);
    const by = Math.round(v.ball.y);
    // Think a little before each shot.
    if (v.aim.mode === "none") {
      if (v.phaseT < 20 + (hash(frame) % 20)) return { x: bx, y: by, b: 0 };
      return { x: bx, y: by, b: BTN.FIRE };
    }
    // Drag in progress: plan a shot that peaks above the rim and drops in.
    // Noise is fixed per shot (ball position + basket count), so the swipe stays straight.
    const shotId = Math.round(v.ball.x) * 131 + v.baskets * 7;
    const apexY = HOOP_Y - 60 - (hash(shotId * 3 + 1) % 40);
    const rise = v.ball.y - apexY;
    let vy = -Math.sqrt(2 * GRAVITY * rise);
    const tUp = -vy / GRAVITY;
    const tDown = Math.sqrt((2 * (HOOP_Y - apexY)) / GRAVITY);
    const T = tUp + tDown;
    const tx = v.hoop.x + v.hoop.vx * T - 4;
    let vx = (tx - v.ball.x) / T;
    // Imperfect: a small random error on most shots, a big one on some.
    const r = hash(shotId);
    const err = r % 100 < 18 ? 2.2 : 0.55;
    vx += (((r >>> 8) % 1000) / 500 - 1) * err;
    vy += (((r >>> 18) % 1000) / 500 - 1) * err * 0.4;
    // Swipe HIST frames with this per-frame displacement, then release.
    const sx = vx / GAIN;
    const sy = vy / GAIN;
    const k = Math.round(Math.abs(v.aim.py - v.aim.gy) / Math.max(1, Math.abs(sy)));
    if (k >= HIST) return { x: v.aim.px, y: v.aim.py, b: 0 };
    return { x: Math.round(v.aim.gx + sx * (k + 1)), y: Math.round(v.aim.gy + sy * (k + 1)), b: BTN.FIRE };
  },
};
