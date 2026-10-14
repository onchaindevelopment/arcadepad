/*
 * Soft Landing: original landing game for ArcadePad (GPL-3.0-or-later).
 *
 * Steer a small capsule (the coin mascot sits in its window) down onto flat
 * pads marked x2 / x3 / x5. Rotate with LEFT/RIGHT, thrust with UP or FIRE,
 * against gravity, with limited fuel. Touch down slowly and upright to score;
 * anything else is a crash. Every landing generates the next site (gravity a
 * little higher, smaller refuel bonus); fuel carries over. The run ends when
 * fuel is gone (and the capsule is down) or after 3 crashes.
 *
 * Engine is deterministic: byte angles via core/trig, randomness via Rng,
 * only + - * / and Math.sqrt/floor/round/abs/min/max. The camera (zoom when
 * close to the ground) is computed here too, so pointer steering maps the same
 * way in live play and in the server replay.
 */
import { Rng } from "../core/rng.ts";
import { cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 640;
export const H = 360;
export const SEG = 16; // terrain segment width
export const NPTS = W / SEG + 1; // 41 terrain points

// Capsule geometry (local, upright: -y is up).
export const FOOT = 11; // feet below the centre
export const LEG = 9; // feet half spread
const BODY_R = 11;

// Physics, per frame at 60 fps.
const ANG_FRAC = 16;
const UP = 192 * ANG_FRAC; // facing up
const ROT = 24; // 1.5 byte angles per frame (~127 deg/s)
const MAX_TILT = 64 * ANG_FRAC; // never past horizontal
const THRUST = 0.034;
const G0 = 0.012;
const G_STEP = 0.0011;
const G_MAX = 0.022;

// Landing thresholds.
export const LAND_VY = 0.7; // px/frame (42 px/s)
export const LAND_VX = 0.5;
export const LAND_TILT = 8; // byte angles (~11 deg)
const GOOD_VY = 0.35;
const GOOD_VX = 0.25;
const GOOD_TILT = 3;

// Fuel (1 unit = 1 frame of thrust).
export const START_FUEL = 900;
export const FUEL_CAP = 1500;
const LOW_FUEL = 150;
export const MAX_CRASHES = 3;

const READY_FRAMES = 45;
const OUTCOME_FRAMES = 100;

const ZOOM_IN_ALT = 70;
const ZOOM_OUT_ALT = 100;
const ZOOM_MAX = 2;

export type Phase = "ready" | "fly" | "landed" | "crashed" | "over";
export interface Pad { i0: number; i1: number; y: number; mult: number }
export interface LanderView {
  frame: number;
  phase: Phase;
  phaseT: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Byte angle of the thrust direction (192 = up). */
  angle: number;
  tilt: number; // byte angles, 0 = upright, + = leaning right
  thrust: boolean;
  fuel: number;
  site: number; // 0-based
  gravity: number;
  terrain: number[]; // NPTS heights (y of ground at x = i * SEG)
  pads: Pad[];
  crashes: number;
  score: number;
  alt: number;
  cam: { x: number; y: number; zoom: number };
  last: { mult: number; points: number; perfect: boolean; refuel: number } | null;
  pointer: boolean;
  lowFuel: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export function groundAt(terrain: readonly number[], x: number): number {
  const fx = clamp(x, 0, W) / SEG;
  let i = Math.floor(fx);
  if (i >= NPTS - 1) i = NPTS - 2;
  const f = fx - i;
  return terrain[i] + (terrain[i + 1] - terrain[i]) * f;
}

/** Pad whose span contains [x0, x1], if any. */
export function padUnder(pads: readonly Pad[], x0: number, x1: number): Pad | null {
  for (const p of pads) if (x0 >= p.i0 * SEG && x1 <= p.i1 * SEG) return p;
  return null;
}

class LanderEngine implements GameEngine<LanderView> {
  private rng: Rng;
  private x = 0;
  private y = 0;
  private vx = 0;
  private vy = 0;
  private ang = UP;
  private thrusting = false;
  private fuel = START_FUEL;
  private site = 0;
  private sitesCleared = 0;
  private terrain: number[] = [];
  private pads: Pad[] = [];
  private crashes = 0;
  private score = 0;
  private phase: Phase = "ready";
  private phaseT = 0;
  private prevB = 0;
  private px = 0;
  private py = 0;
  private pointerMode = false;
  private camX = W / 2;
  private camY = H / 2;
  private zoom = 1;
  private zoomed = false;
  private last: LanderView["last"] = null;
  private lowFuelWarned = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.newSite();
  }

  private gravity() {
    return Math.min(G_MAX, G0 + G_STEP * this.site);
  }

  private newSite() {
    const r = this.rng;
    // Jagged random walk.
    const t: number[] = [];
    let h = r.range(220, 320);
    for (let i = 0; i < NPTS; i++) {
      if (i > 0) {
        const swing = 18 + Math.min(this.site, 6) * 3;
        h = clamp(h + r.range(-swing, swing), 140, 340);
      }
      t.push(h);
    }
    // Three pads in three zones, multipliers shuffled; narrower = richer.
    const mults = [2, 3, 5];
    for (let i = 2; i > 0; i--) {
      const j = r.int(i + 1);
      const tmp = mults[i]; mults[i] = mults[j]; mults[j] = tmp;
    }
    const zones = [[2, 12], [15, 25], [28, 38]];
    const pads: Pad[] = [];
    for (let z = 0; z < 3; z++) {
      const mult = mults[z];
      const len = mult === 2 ? 4 : mult === 3 ? 3 : 2;
      const [a, b] = zones[z];
      const i0 = a + r.int(b - a - len + 1);
      const i1 = i0 + len;
      let y = t[i0];
      // Rich pads sit a bit higher up among the peaks.
      if (mult === 5) y = Math.max(160, y - r.range(10, 40));
      for (let i = i0; i <= i1; i++) t[i] = y;
      // Raise neighbours a little so pads read as ledges.
      if (i0 > 0 && t[i0 - 1] > y + 4) t[i0 - 1] = Math.max(y + 6, t[i0 - 1] - 10);
      if (i1 < NPTS - 1 && t[i1 + 1] > y + 4) t[i1 + 1] = Math.max(y + 6, t[i1 + 1] - 10);
      pads.push({ i0, i1, y, mult });
    }
    this.terrain = t;
    this.pads = pads;
    this.x = 60 + r.int(W - 120);
    this.y = 30;
    this.vx = (r.int(61) - 30) / 50; // -0.6..0.6
    this.vy = 0;
    this.ang = UP;
    this.thrusting = false;
    this.phase = "ready";
    this.phaseT = READY_FRAMES;
    this.zoomed = false;
  }

  private tilt() {
    return this.ang - UP;
  }

  /** Rotate the capsule-local point (lx, ly) and return world coords. */
  private pt(lx: number, ly: number): [number, number] {
    const a = Math.round(this.tilt() / ANG_FRAC);
    const c = cos256(a), s = sin256(a);
    return [this.x + lx * c - ly * s, this.y + lx * s + ly * c];
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    const b = inp.b;
    this.prevB = b;
    if (this.frame > 1 && (inp.x !== this.px || inp.y !== this.py)) this.pointerMode = true;
    this.px = inp.x;
    this.py = inp.y;
    if (b & (BTN.LEFT | BTN.RIGHT)) this.pointerMode = false;
    this.thrusting = false;

    if (this.phase === "ready") {
      if (--this.phaseT <= 0) {
        this.phase = "fly";
        this.events.push({ t: "start", sfx: "launch", x: this.x, y: this.y, site: this.site + 1 });
      }
    } else if (this.phase === "fly") {
      this.fly(inp);
    } else if (--this.phaseT <= 0) {
      if (this.phase === "landed") {
        this.site++;
        this.newSite();
      } else if (this.crashes >= MAX_CRASHES || this.fuel <= 0) {
        this.phase = "over";
        this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
      } else {
        this.newSite();
      }
    }
    this.updateCamera();
  }

  private fly(inp: Input) {
    const b = inp.b;
    // Steering.
    if (this.pointerMode) {
      const sx = W / 2 + (this.x - this.camX) * this.zoom;
      const dx = inp.x - sx;
      let target = 0;
      if (dx > 12 || dx < -12) target = clamp(Math.round((dx - (dx > 0 ? 12 : -12)) / 3), -48, 48) * ANG_FRAC;
      const d = clamp(UP + target - this.ang, -ROT, ROT);
      this.ang += d;
    } else {
      if (b & BTN.LEFT) this.ang -= ROT;
      if (b & BTN.RIGHT) this.ang += ROT;
    }
    this.ang = clamp(this.ang, UP - MAX_TILT, UP + MAX_TILT);

    // Thrust.
    if (b & (BTN.UP | BTN.FIRE) && this.fuel > 0) {
      this.thrusting = true;
      this.fuel--;
      const a = Math.round(this.ang / ANG_FRAC);
      this.vx += cos256(a) * THRUST;
      this.vy += sin256(a) * THRUST;
      if (this.fuel === 0) this.events.push({ t: "nofuel", sfx: "extraBad", mood: "sad", x: this.x, y: this.y });
      else if (this.fuel < LOW_FUEL && !this.lowFuelWarned) {
        this.lowFuelWarned = true;
        this.events.push({ t: "lowfuel", sfx: "extraBad", x: this.x, y: this.y });
      }
    }
    this.vy += this.gravity();
    this.x += this.vx;
    this.y += this.vy;

    // Edges.
    if (this.x < BODY_R) { this.x = BODY_R; if (this.vx < 0) { this.vx = -this.vx * 0.3; this.events.push({ t: "wall", sfx: "wall", x: this.x, y: this.y }); } }
    if (this.x > W - BODY_R) { this.x = W - BODY_R; if (this.vx > 0) { this.vx = -this.vx * 0.3; this.events.push({ t: "wall", sfx: "wall", x: this.x, y: this.y }); } }
    if (this.y < 6) { this.y = 6; if (this.vy < 0) this.vy = 0; }

    // Ground contact.
    const probes: [number, number][] = [
      this.pt(-LEG, FOOT), this.pt(LEG, FOOT), this.pt(0, FOOT - 1),
      this.pt(-BODY_R, 0), this.pt(BODY_R, 0), this.pt(0, -BODY_R),
      this.pt(-BODY_R + 3, -BODY_R + 3), this.pt(BODY_R - 3, -BODY_R + 3),
    ];
    let hit = false;
    for (const [qx, qy] of probes) if (qy >= groundAt(this.terrain, qx)) { hit = true; break; }
    if (hit) this.touchdown(probes[0], probes[1]);
  }

  private touchdown(fl: [number, number], fr: [number, number]) {
    const tilt = this.tilt() / ANG_FRAC;
    const atilt = Math.abs(tilt);
    const pad = padUnder(this.pads, Math.min(fl[0], fr[0]), Math.max(fl[0], fr[0]));
    const vy = this.vy, avx = Math.abs(this.vx);
    if (pad && vy <= LAND_VY && avx <= LAND_VX && atilt <= LAND_TILT) {
      const perfect = vy <= GOOD_VY && avx <= GOOD_VX && atilt <= GOOD_TILT;
      const soft = Math.floor((LAND_VY - vy) * 100);
      const points = pad.mult * (50 + soft + (perfect ? 25 : 0));
      const base = Math.max(120, 340 - this.site * 20);
      const refuel = perfect ? base : Math.floor(base * 0.4);
      this.score += points;
      this.fuel = Math.min(FUEL_CAP, this.fuel + refuel);
      if (this.fuel >= LOW_FUEL) this.lowFuelWarned = false;
      this.sitesCleared++;
      this.y = pad.y - FOOT;
      this.vx = 0; this.vy = 0;
      this.ang = UP;
      this.phase = "landed";
      this.phaseT = OUTCOME_FRAMES;
      this.last = { mult: pad.mult, points, perfect, refuel };
      this.events.push({ t: "landed", sfx: "levelclear", toast: "levelClear", mood: "happy", x: this.x, y: pad.y, mult: pad.mult, points, perfect, refuel });
      if (perfect) this.events.push({ t: "perfect", sfx: "extraGood", x: this.x, y: this.y });
    } else {
      this.crashes++;
      this.phase = "crashed";
      this.phaseT = OUTCOME_FRAMES;
      this.last = null;
      const why = !pad ? "rough" : vy > LAND_VY ? "fast" : avx > LAND_VX ? "drift" : "tilt";
      this.events.push({ t: "crash", sfx: "explode", shake: 10, x: this.x, y: this.y, vx: this.vx, vy: this.vy, why });
      this.events.push({ t: "lost", sfx: "lost", mood: "sad", toast: "lifeLost", x: this.x, y: this.y });
      this.vx = 0; this.vy = 0;
    }
  }

  private updateCamera() {
    const alt = groundAt(this.terrain, this.x) - (this.y + FOOT);
    const active = this.phase === "fly" || this.phase === "landed" || this.phase === "crashed";
    if (!active) this.zoomed = false;
    else if (alt < ZOOM_IN_ALT) this.zoomed = true;
    else if (alt > ZOOM_OUT_ALT) this.zoomed = false;
    const target = this.zoomed ? ZOOM_MAX : 1;
    this.zoom += (target - this.zoom) * 0.06;
    if (Math.abs(target - this.zoom) < 0.001) this.zoom = target;
    const hw = W / 2 / this.zoom, hh = H / 2 / this.zoom;
    const tx = clamp(this.x, hw, W - hw), ty = clamp(this.y + 10, hh, H - hh);
    const k = (this.zoom - 1) / (ZOOM_MAX - 1);
    this.camX = W / 2 + (tx - W / 2) * k;
    this.camY = H / 2 + (ty - H / 2) * k;
  }

  view(): LanderView {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      x: this.x,
      y: this.y,
      vx: this.vx,
      vy: this.vy,
      angle: this.ang / ANG_FRAC,
      tilt: this.tilt() / ANG_FRAC,
      thrust: this.thrusting,
      fuel: this.fuel,
      site: this.site,
      gravity: this.gravity(),
      terrain: this.terrain.slice(),
      pads: this.pads.map((p) => ({ ...p })),
      crashes: this.crashes,
      score: this.score,
      alt: groundAt(this.terrain, this.x) - (this.y + FOOT),
      cam: { x: this.camX, y: this.camY, zoom: this.zoom },
      last: this.last ? { ...this.last } : null,
      pointer: this.pointerMode,
      lowFuel: this.fuel < LOW_FUEL,
    };
  }
  hud(): Hud {
    return { score: this.score, lives: MAX_CRASHES - this.crashes, level: this.site + 1, label: `Fuel ${this.fuel}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.site, levelsCleared: this.sitesCleared, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

export const lander: GameDef<LanderView> = {
  id: "lander",
  name: "Soft Landing",
  tagline: "Feather the thrusters, set the capsule down gently, chase the x5 pads.",
  genre: "Landing",
  session: "2–6 min",
  controls:
    "Keys: LEFT/RIGHT rotate, UP or SPACE thrust. Mouse/touch: move left or right of the capsule to tilt it, hold to thrust. " +
    "Land slowly and upright on a flat pad.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the landing genre: own physics, procedural terrain, scoring, art and sounds. No code or assets copied.",
  },
  create: (seed) => new LanderEngine(seed),
  bot(v, frame) {
    // Keyboard autopilot (pointer fixed): pick a pad, glide over it, brake, settle.
    const out = { x: W / 2, y: H / 2, b: 0 };
    if (v.phase !== "fly") return out;
    // Prefer the richest pad on even sites, the widest on odd ones (keeps it imperfect).
    let pad = v.pads[0];
    for (const p of v.pads) {
      if (v.site % 2 === 0 ? p.mult > pad.mult : p.mult < pad.mult) pad = p;
    }
    const px = ((pad.i0 + pad.i1) / 2) * SEG;
    const halfW = ((pad.i1 - pad.i0) * SEG) / 2 - LEG - 2;
    const dx = px - v.x;
    const footY = v.y + FOOT;
    const h = pad.y - footY;
    // Highest ground between here and the pad.
    let top = H;
    const a = Math.floor(Math.min(v.x, px) / SEG), bIdx = Math.ceil(Math.max(v.x, px) / SEG);
    for (let i = Math.max(0, a - 1); i <= Math.min(NPTS - 1, bIdx + 1); i++) if (v.terrain[i] < top) top = v.terrain[i];
    const over = Math.abs(dx) < halfW;
    const wantVx = clamp(dx / 70, -1.1, 1.1);
    let wantTilt = clamp((wantVx - v.vx) * 50, -24, 24);
    let wantVy: number;
    if (!over && footY > top - 28) wantVy = -0.4; // climb over the ridge
    else if (!over) wantVy = h > 60 ? 0.6 : 0.1;
    else wantVy = h > 120 ? 1.6 : h > 50 ? 0.9 : h > 15 ? 0.45 : 0.3 + (v.site % 3) * 0.17;
    if (over && h < 25) wantTilt = clamp(-v.vx * 30, -4, 4);
    const tilt = v.tilt;
    if (tilt < wantTilt - 1) out.b |= BTN.RIGHT;
    else if (tilt > wantTilt + 1) out.b |= BTN.LEFT;
    const up = cos256(Math.round(tilt)); // vertical share of thrust
    if (v.vy > wantVy && up > 0.4) out.b |= BTN.UP;
    else if (!over && Math.abs(v.vx - wantVx) > 0.25 && Math.abs(tilt) > 10 && v.vy > -0.3) out.b |= BTN.UP;
    // Small reaction lag now and then.
    if (frame % 97 < 3) out.b &= ~BTN.UP;
    return out;
  },
};
