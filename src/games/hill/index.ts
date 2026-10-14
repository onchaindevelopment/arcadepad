/*
 * Hill Rider: physics hill driving over endless generated hills.
 * Original ArcadePad design (no code ported), GPL-3.0-or-later.
 *
 * Physics: position-based dynamics with four particles (two wheels, two
 * chassis corners) joined by one rigid frame and four soft suspension
 * springs; the driver's head (the coin mascot) rides on top of the frame.
 * Wheels collide with a piecewise-linear heightfield built from seeded
 * Catmull-Rom hills. Gas / brake drive the wheels while grounded and tilt the
 * buggy while airborne. Fuel drains over time; fuel cans and coins lie on
 * the road. Head on the ground = crash; empty tank and stopped = run over.
 *
 * Determinism: only + - * /, Math.sqrt/floor/min/max/abs and the shared Rng.
 * Units: pixels and frames (1 frame = 1/60 s), y grows downward.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- field / world
export const FIELD_W = 640;
export const FIELD_H = 360;
/** Terrain sample spacing (px). */
export const SAMPLE = 8;
/** Hill key-point spacing (px); must be a multiple of SAMPLE. */
const KEY_X = 128;
const PER_KEY = KEY_X / SAMPLE;
const FLAT_KEYS = 4; // flat start road
/** Pixels per metre for the distance score. */
export const PX_PER_M = 10;
const START_X = 120;
const LEFT_WALL = 16;

// ---------------------------------------------------------------- car
export const WHEEL_R = 10;
const BODY_R = 4;
export const HEAD_R = 8;
const ITER = 6;
const GRAVITY = 0.24;
const AIR_DAMP = 0.9995;
const SPRING_K = 0.12;
const AXLE_HALF = 22;
const SUSP_REST = 15;
const SUSP_MIN = 8;
const SUSP_MAX = 20;
const MAX_SPEED = 8;
const ACCEL = 0.3;
const BRAKE = 0.28;
const MAX_REVERSE = 3;
const ROLL_DAMP = 0.997;
const AIR_ROT = 0.0035;
const MAX_SPIN = 0.11;
const GROUND_ROT = 0.0012;
const MAX_GROUND_SPIN = 0.03;
/** Car-local rest layout (wheel centres at y = 0). */
const LAYOUT: readonly (readonly [number, number])[] = [
  [-22, 0], // 0 rear wheel
  [22, 0], // 1 front wheel
  [-20, -15], // 2 rear chassis corner
  [20, -15], // 3 front chassis corner
];
/** Head offset from the chassis midpoint: back along the frame, up off it. */
const HEAD_BACK = 4;
const HEAD_UP = 17;

// ---------------------------------------------------------------- rules
const FUEL_DRAIN = 1 / 2100; // ~35 s idle
const FUEL_GAS_DRAIN = 1 / 4200; // extra while on the gas
const FIRST_FUEL_X = 1700;
const FUEL_GAP = 1900;
const FUEL_GAP_GROWTH = 0.2; // gap grows with distance, so runs end
const COIN_VALUE = 10;
const BIG_COIN_VALUE = 50;
const FLIP_BONUS = 100;
const AIR_MIN_FRAMES = 30;
const AIR_POINTS_PER_SEC = 20;
const PICK_R = 18;
const CRASH_FRAMES = 70;
const STALL_FRAMES = 90;
const AUTO_START = 150;
const MILESTONE_M = 250;
const TWO_PI = 6.283185307179586;
const MAX_FRAMES = 15 * 60 * 60;

export type ItemKind = "coin" | "bigcoin" | "fuel";
export interface Item { id: number; x: number; y: number; kind: ItemKind }

interface Pt { x: number; y: number; ox: number; oy: number; vx: number; vy: number; r: number; contact: boolean; nx: number; ny: number }
interface Link { a: number; b: number; rest: number; k: number }

export interface HillView {
  frame: number;
  started: boolean;
  crashed: boolean;
  over: boolean;
  outOfFuel: boolean;
  wheels: { x: number; y: number; spin: number; contact: boolean }[];
  /** Rear and front chassis corners. */
  body: { x: number; y: number }[];
  head: { x: number; y: number };
  cx: number;
  cy: number;
  vx: number;
  vy: number;
  airborne: boolean;
  airFrames: number;
  /** -1 brake, 0 coast, 1 gas (what the driver is doing). */
  pedal: number;
  fuel: number;
  meters: number;
  coins: number;
  score: number;
  terrain: { x0: number; step: number; ys: number[] };
  items: Item[];
}

class HillEngine implements GameEngine<HillView> {
  private rng: Rng;
  private keys: number[] = [];
  private h: number[] = []; // terrain samples, h[i] at x = i * SAMPLE
  private segs = 0; // key segments with samples
  private itemsDone = 0; // key segments with items placed
  private kick = 0;
  private nextFuelX = FIRST_FUEL_X;
  private items: Item[] = [];
  private nextId = 1;
  private pts: Pt[] = [];
  private links: Link[] = [];
  private spin = [0, 0];
  private started = false;
  private crashed = false;
  private crashTimer = 0;
  private stallTimer = 0;
  private over = false;
  private outOfFuel = false;
  private fuel = 1;
  private lowWarned = false;
  private maxX = START_X;
  private coins = 0;
  private coinPts = 0;
  private bonus = 0;
  private airFrames = 0;
  private airRot = 0;
  private pedal = 0;
  private milestone = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.ensureTerrain(START_X + 1600);
    const gy = this.groundY(START_X);
    for (const [lx, ly] of LAYOUT) {
      const x = START_X + lx;
      const y = gy - WHEEL_R - 3 + ly;
      this.pts.push({ x, y, ox: x, oy: y, vx: 0, vy: 0, r: 0, contact: false, nx: 0, ny: -1 });
    }
    this.pts[0].r = this.pts[1].r = WHEEL_R;
    this.pts[2].r = this.pts[3].r = BODY_R;
    const link = (a: number, b: number, k: number) => {
      const dx = this.pts[b].x - this.pts[a].x, dy = this.pts[b].y - this.pts[a].y;
      this.links.push({ a, b, rest: Math.sqrt(dx * dx + dy * dy), k });
    };
    link(2, 3, 1); // rigid frame
  }

  // ------------------------------------------------------------ terrain
  private genKey() {
    const j = this.keys.length;
    if (j < FLAT_KEYS + 1) { this.keys.push(0); return; }
    const prev = this.keys[j - 1];
    const prev2 = this.keys[j - 2];
    const d = Math.min(1, (j - FLAT_KEYS) / 70);
    const amp = 26 + 74 * d;
    const lim = KEY_X * (0.5 + 0.3 * d);
    let dy: number;
    if (this.kick !== 0) {
      // Second half of a kicker: the road falls away behind the lip.
      dy = this.kick;
      this.kick = 0;
    } else if (j > FLAT_KEYS + 3 && this.rng.int(100) < 10 + 12 * d) {
      // Kicker: a short climb to a lip, then a long drop = big air.
      dy = -amp * (0.6 + this.rng.int(401) / 1000);
      this.kick = amp * (1.2 + this.rng.int(601) / 1000);
    } else {
      // Keep going the same way (a long hill) or turn around (a crest / dip).
      let dir = prev - prev2 < 0 ? -1 : 1;
      if (this.rng.int(100) < 55) dir = -dir;
      dy = dir * amp * (0.25 + this.rng.int(1001) / 1333);
      if (this.rng.int(9) === 0) dy *= 0.2; // breather / small bump
      dy -= prev * 0.12; // stay near the base line over long runs
    }
    if (dy > lim) dy = lim;
    if (dy < -lim) dy = -lim;
    this.keys.push(prev + dy);
  }

  private genSegment() {
    const j = this.segs;
    while (this.keys.length < j + 3) this.genKey();
    const p0 = this.keys[j > 0 ? j - 1 : 0], p1 = this.keys[j], p2 = this.keys[j + 1], p3 = this.keys[j + 2];
    for (let m = 0; m < PER_KEY; m++) {
      const t = m / PER_KEY, t2 = t * t, t3 = t2 * t;
      this.h.push(0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3));
    }
    this.segs++;
    // Items for the previous segment (its end sample now exists).
    while (this.itemsDone < this.segs - 1) this.placeItems(this.itemsDone++);
  }

  private ensureTerrain(x: number) {
    while ((this.h.length - 1) * SAMPLE < x) this.genSegment();
  }

  private placeItems(j: number) {
    if (j < FLAT_KEYS) return;
    const x0 = j * KEY_X;
    if (x0 + KEY_X / 2 >= this.nextFuelX) {
      const x = x0 + KEY_X / 2;
      this.items.push({ id: this.nextId++, x, y: this.groundY(x) - 16, kind: "fuel" });
      this.nextFuelX = x + FUEL_GAP + x * FUEL_GAP_GROWTH;
      return;
    }
    if (this.rng.int(5) < 2) {
      const n = 4 + this.rng.int(3);
      const big = this.rng.int(6) === 0 ? n >> 1 : -1;
      const start = x0 + (KEY_X - (n - 1) * 20) / 2;
      for (let i = 0; i < n; i++) {
        const x = start + i * 20;
        this.items.push({ id: this.nextId++, x, y: this.groundY(x) - 24, kind: i === big ? "bigcoin" : "coin" });
      }
    }
  }

  /** Surface y at world x (linear between samples). */
  groundY(x: number): number {
    if (x <= 0) return this.h[0];
    const f = x / SAMPLE;
    const i = Math.floor(f);
    if (i + 1 >= this.h.length) return this.h[this.h.length - 1];
    const t = f - i;
    return this.h[i] + (this.h[i + 1] - this.h[i]) * t;
  }

  /** Deepest penetration of a circle into the ground: pen > 0 means overlap; n points out of the ground. */
  private probe(px: number, py: number, r: number): { pen: number; nx: number; ny: number } {
    const below = py > this.groundY(px);
    const i0 = Math.max(0, Math.floor((px - r) / SAMPLE) - 1);
    const i1 = Math.min(this.h.length - 2, Math.floor((px + r) / SAMPLE) + 1);
    let best = Infinity, bx = 0, by = -1;
    for (let i = i0; i <= i1; i++) {
      const ax = i * SAMPLE, ay = this.h[i];
      const sx = SAMPLE, sy = this.h[i + 1] - ay;
      let t = ((px - ax) * sx + (py - ay) * sy) / (sx * sx + sy * sy);
      if (t < 0) t = 0;
      else if (t > 1) t = 1;
      const dx = px - (ax + sx * t), dy = py - (ay + sy * t);
      const d2 = dx * dx + dy * dy;
      if (d2 < best) {
        best = d2;
        const d = Math.sqrt(d2);
        if (d > 1e-6) { bx = dx / d; by = dy / d; }
        else { const l = Math.sqrt(sx * sx + sy * sy); bx = sy / l; by = -sx / l; }
      }
    }
    const dist = Math.sqrt(best);
    if (below) return { pen: r + dist, nx: -bx, ny: -by };
    return { pen: r - dist, nx: bx, ny: by };
  }

  // ------------------------------------------------------------ step
  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const b = inp.b;
    let gas = (b & (BTN.RIGHT | BTN.UP)) !== 0;
    let brake = (b & (BTN.LEFT | BTN.DOWN)) !== 0;
    if (b & BTN.FIRE) {
      if (inp.x >= FIELD_W / 2) gas = true;
      else brake = true;
    }
    if (gas && brake) brake = false;
    if (!this.started && (gas || brake || this.frame >= AUTO_START)) this.started = true;
    if (this.crashed || this.fuel <= 0) { gas = false; brake = false; }
    this.pedal = gas ? 1 : brake ? -1 : 0;

    const P = this.pts;
    let maxPx = 0;
    for (const p of P) {
      p.vy += GRAVITY;
      p.vx *= AIR_DAMP;
      p.vy *= AIR_DAMP;
      p.ox = p.x;
      p.oy = p.y;
      p.x += p.vx;
      p.y += p.vy;
      if (p.x > maxPx) maxPx = p.x;
    }
    this.ensureTerrain(maxPx + 1200);
    // Pre-step velocity for landing impacts.
    const preVy = (P[0].vy + P[1].vy) / 2;

    for (const p of P) p.contact = false;
    for (let it = 0; it < ITER; it++) {
      for (const L of this.links) {
        const a = P[L.a], c = P[L.b];
        const dx = c.x - a.x, dy = c.y - a.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 1e-6) continue;
        const k = ((d - L.rest) / d) * 0.5 * L.k;
        a.x += dx * k; a.y += dy * k;
        c.x -= dx * k; c.y -= dy * k;
      }
      this.suspension();
      for (const p of P) {
        if (p.x < LEFT_WALL) p.x = LEFT_WALL;
        const q = this.probe(p.x, p.y, p.r);
        if (q.pen > 0) {
          p.x += q.nx * q.pen;
          p.y += q.ny * q.pen;
          p.contact = true;
          p.nx = q.nx;
          p.ny = q.ny;
        }
      }
    }

    // Velocities from positions, then contact response.
    let wheelsDown = 0;
    let anyDown = false;
    let driveX = 0, driveY = 0; // traction, shared by the whole buggy
    for (let i = 0; i < 4; i++) {
      const p = P[i];
      p.vx = p.x - p.ox;
      p.vy = p.y - p.oy;
      const pushed = p.contact;
      if (!pushed) {
        // Wheels resting within a hair of the ground still drive.
        if (i < 2) {
          const q = this.probe(p.x, p.y, p.r + 1);
          if (q.pen > 0) { p.contact = true; p.nx = q.nx; p.ny = q.ny; }
        }
        if (!p.contact) continue;
      }
      anyDown = true;
      const nx = p.nx, ny = p.ny;
      const vn = p.vx * nx + p.vy * ny;
      // Soak up the bounce from being pushed out of the ground.
      if (pushed && vn > 0) { p.vx -= nx * vn * 0.6; p.vy -= ny * vn * 0.6; }
      const tx = -ny, ty = nx; // forward along the surface
      const vt = p.vx * tx + p.vy * ty;
      let nvt = vt;
      if (i < 2) {
        wheelsDown++;
        if (gas) { if (nvt < MAX_SPEED) nvt = Math.min(MAX_SPEED, nvt + ACCEL); }
        else if (brake) nvt = nvt > 0 ? Math.max(0, nvt - BRAKE) : Math.max(-MAX_REVERSE, nvt - ACCEL * 0.6);
        else nvt *= ROLL_DAMP;
        this.spin[i] += nvt / WHEEL_R;
        driveX += (nvt - vt) * tx * 0.5;
        driveY += (nvt - vt) * ty * 0.5;
      } else {
        nvt *= 0.9; // chassis scraping
        p.vx += (nvt - vt) * tx;
        p.vy += (nvt - vt) * ty;
      }
    }
    for (const p of P) { p.vx += driveX; p.vy += driveY; }
    for (let i = 0; i < 2; i++) {
      if (!P[i].contact) this.spin[i] += gas ? 0.35 : brake ? -0.2 : 0;
      if (this.spin[i] > 1e6 || this.spin[i] < -1e6) this.spin[i] = 0;
    }

    // Tilt control in the air (gas = nose up, brake = nose down).
    const cx = (P[0].x + P[1].x + P[2].x + P[3].x) / 4;
    const cy = (P[0].y + P[1].y + P[2].y + P[3].y) / 4;
    let num = 0, den = 0;
    for (const p of P) {
      const rx = p.x - cx, ry = p.y - cy;
      num += rx * p.vy - ry * p.vx;
      den += rx * rx + ry * ry;
    }
    const w = num / den;
    if (gas || brake) {
      // Full control in the air; on the ground the gas only lifts the nose a little.
      const air = wheelsDown === 0;
      const acc = air ? AIR_ROT : GROUND_ROT;
      const cap = air ? MAX_SPIN : MAX_GROUND_SPIN;
      let nw = w + (gas ? -acc : acc);
      if (nw > cap) nw = Math.max(w, cap);
      if (nw < -cap) nw = Math.min(w, -cap);
      const dw = nw - w;
      for (const p of P) {
        p.vx += -(p.y - cy) * dw;
        p.vy += (p.x - cx) * dw;
      }
    }

    // Air time and flips.
    const fx = P[3].x - P[2].x, fy = P[3].y - P[2].y;
    const pfx = P[3].ox - P[2].ox, pfy = P[3].oy - P[2].oy;
    if (!anyDown) {
      this.airFrames++;
      this.airRot += (pfx * fy - pfy * fx) / Math.sqrt((pfx * pfx + pfy * pfy) * (fx * fx + fy * fy));
    }

    // Head on the ground = crash.
    const head = this.headPos();
    if (!this.crashed && this.probe(head.x, head.y, HEAD_R).pen > 0) {
      this.crashed = true;
      this.events.push({ t: "crash", sfx: "explode", mood: "sad", shake: 12, wx: head.x, wy: head.y });
    }

    if (anyDown && this.airFrames > 0) {
      if (!this.crashed) {
        const flips = Math.floor((Math.abs(this.airRot) + 0.5) / TWO_PI);
        if (flips > 0) {
          const pts = flips * FLIP_BONUS;
          this.bonus += pts;
          this.events.push({ t: "flip", flips, points: pts, back: this.airRot < 0, sfx: "extraGood", mood: "happy", wx: cx, wy: cy });
        }
        if (this.airFrames >= AIR_MIN_FRAMES) {
          const pts = Math.floor((this.airFrames * AIR_POINTS_PER_SEC) / 60);
          this.bonus += pts;
          this.events.push({ t: "air", frames: this.airFrames, points: pts, sfx: "launch", wx: cx, wy: cy - 30 });
        }
        if (preVy > 4) this.events.push({ t: "land", impact: preVy, sfx: "paddle", shake: Math.min(8, preVy), wx: cx, wy: cy + 14 });
      }
      this.airFrames = 0;
      this.airRot = 0;
    }

    // Pickups.
    const hitPts = [P[0], P[1], { x: cx, y: cy }, head];
    for (let k = this.items.length - 1; k >= 0; k--) {
      const it = this.items[k];
      if (it.x < cx - 900) { this.items.splice(k, 1); continue; }
      if (it.x > cx + 120 || this.crashed) continue;
      let got = false;
      for (const q of hitPts) {
        const dx = q.x - it.x, dy = q.y - it.y;
        if (dx * dx + dy * dy < PICK_R * PICK_R) { got = true; break; }
      }
      if (!got) continue;
      this.items.splice(k, 1);
      if (it.kind === "fuel") {
        this.fuel = 1;
        this.lowWarned = false;
        this.events.push({ t: "fuel", sfx: "extraGood", mood: "happy", wx: it.x, wy: it.y });
      } else {
        const v = it.kind === "bigcoin" ? BIG_COIN_VALUE : COIN_VALUE;
        this.coins++;
        this.coinPts += v;
        this.events.push({ t: "coin", value: v, big: it.kind === "bigcoin", sfx: it.kind === "bigcoin" ? "brickgone" : "brick", wx: it.x, wy: it.y });
      }
    }

    // Distance.
    if (!this.crashed && cx > this.maxX) this.maxX = cx;
    const m = this.meters();
    if (Math.floor(m / MILESTONE_M) > this.milestone) {
      this.milestone = Math.floor(m / MILESTONE_M);
      this.events.push({ t: "milestone", meters: this.milestone * MILESTONE_M, sfx: "levelclear", toast: "levelClear", mood: "happy" });
    }

    // Fuel.
    if (this.started && !this.crashed && this.fuel > 0) {
      this.fuel -= FUEL_DRAIN + (gas ? FUEL_GAS_DRAIN : 0);
      if (this.fuel <= 0) {
        this.fuel = 0;
        this.events.push({ t: "empty", sfx: "lost", mood: "sad" });
      } else if (this.fuel < 0.25 && !this.lowWarned) {
        this.lowWarned = true;
        this.events.push({ t: "lowfuel", sfx: "extraBad" });
      }
    }

    // End conditions.
    if (this.crashed) {
      if (++this.crashTimer >= CRASH_FRAMES) this.finish();
    } else if (this.fuel <= 0) {
      const mvx = (P[0].vx + P[1].vx) / 2, mvy = (P[0].vy + P[1].vy) / 2;
      const v2 = mvx * mvx + mvy * mvy;
      this.stallTimer = v2 < 0.04 ? this.stallTimer + 1 : 0;
      if (this.stallTimer >= STALL_FRAMES) {
        this.outOfFuel = true;
        this.finish();
      }
    }
  }

  /**
   * Each wheel rides in a slot under its end of the frame: held in place
   * along the frame, sprung (and end-stopped) across it.
   */
  private suspension() {
    const P = this.pts;
    const r = P[2], f = P[3];
    const fx = f.x - r.x, fy = f.y - r.y;
    const l = Math.sqrt(fx * fx + fy * fy);
    if (l < 1e-6) return;
    const dx = fx / l, dy = fy / l;
    const ux = -dy, uy = dx; // "down" off the frame
    const mx = (r.x + f.x) / 2, my = (r.y + f.y) / 2;
    for (let i = 0; i < 2; i++) {
      const w = P[i], fp = P[2 + i];
      const along = i === 0 ? -AXLE_HALF : AXLE_HALF;
      const relx = w.x - (mx + dx * along), rely = w.y - (my + dy * along);
      const a = relx * dx + rely * dy;
      const n = relx * ux + rely * uy;
      let nn = n + (SUSP_REST - n) * SPRING_K;
      if (nn < SUSP_MIN) nn = SUSP_MIN;
      if (nn > SUSP_MAX) nn = SUSP_MAX;
      const cx = -a * dx + (nn - n) * ux, cy = -a * dy + (nn - n) * uy;
      w.x += cx * 0.5; w.y += cy * 0.5;
      fp.x -= cx * 0.5; fp.y -= cy * 0.5;
    }
  }

  private finish() {
    this.over = true;
    this.events.push({ t: "gameover", sfx: "gameover", mood: "sad", outOfFuel: this.outOfFuel });
  }

  private headPos() {
    const P = this.pts;
    const fx = P[3].x - P[2].x, fy = P[3].y - P[2].y;
    const l = Math.sqrt(fx * fx + fy * fy);
    const dx = fx / l, dy = fy / l;
    const mx = (P[2].x + P[3].x) / 2, my = (P[2].y + P[3].y) / 2;
    // Up off the frame is (dy, -dx).
    return { x: mx - dx * HEAD_BACK + dy * HEAD_UP, y: my - dy * HEAD_BACK - dx * HEAD_UP };
  }

  private meters() {
    return Math.floor((this.maxX - START_X) / PX_PER_M);
  }

  private score() {
    return this.meters() + this.coinPts + this.bonus;
  }

  view(): HillView {
    const P = this.pts;
    const cx = (P[0].x + P[1].x + P[2].x + P[3].x) / 4;
    const cy = (P[0].y + P[1].y + P[2].y + P[3].y) / 4;
    const i0 = Math.max(0, Math.floor((cx - 520) / SAMPLE));
    const i1 = Math.min(this.h.length - 1, Math.ceil((cx + 900) / SAMPLE));
    return {
      frame: this.frame,
      started: this.started,
      crashed: this.crashed,
      over: this.over,
      outOfFuel: this.outOfFuel,
      wheels: [0, 1].map((i) => ({ x: P[i].x, y: P[i].y, spin: this.spin[i], contact: P[i].contact })),
      body: [{ x: P[2].x, y: P[2].y }, { x: P[3].x, y: P[3].y }],
      head: this.headPos(),
      cx,
      cy,
      vx: (P[0].vx + P[1].vx + P[2].vx + P[3].vx) / 4,
      vy: (P[0].vy + P[1].vy + P[2].vy + P[3].vy) / 4,
      airborne: this.airFrames > 0,
      airFrames: this.airFrames,
      pedal: this.pedal,
      fuel: this.fuel,
      meters: this.meters(),
      coins: this.coins,
      score: this.score(),
      terrain: { x0: i0 * SAMPLE, step: SAMPLE, ys: this.h.slice(i0, i1 + 1) },
      items: this.items.filter((it) => it.x > cx - 520 && it.x < cx + 900),
    };
  }
  hud(): Hud {
    return { score: this.score(), level: this.milestone + 1, label: `${this.meters()}m  fuel ${Math.ceil(this.fuel * 100)}%` };
  }
  result(): GameResult {
    return { score: this.score(), level: this.milestone, levelsCleared: this.milestone, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over || this.frame >= MAX_FRAMES;
  }
}

export const hill: GameDef<HillView> = {
  id: "hill",
  name: "Hill Rider",
  tagline: "Floor it over endless hills. Grab fuel, stack flips, never land on your head.",
  genre: "Physics hill driving",
  session: "1–4 min",
  controls: "Right / Up / hold right side = gas. Left / Down / hold left side = brake and reverse. In the air they tilt the buggy.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the physics hill-driving genre: position-based buggy with soft suspension, seeded spline hills, fuel, coins, air-time and flip bonuses. No code, art, vehicles, characters or sounds from any existing game.",
  },
  create: (seed) => new HillEngine(seed),
  bot(v, frame) {
    // Tilt = sine of the frame angle (negative = nose up).
    const [r, f] = v.body;
    const dx = f.x - r.x, dy = f.y - r.y;
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    const s = dy / l, c = dx / l;
    const GAS = { x: 0, y: 0, b: BTN.RIGHT };
    const BRAKE_IN = { x: 0, y: 0, b: BTN.LEFT };
    const IDLE = { x: 0, y: 0, b: 0 };
    // A little sloppiness so runs differ and eventually end.
    if ((frame >> 5) % 23 === 7) return IDLE;
    if (v.airborne) {
      if (c < 0) return s < 0 ? BRAKE_IN : GAS; // tipping over: steer back
      if (s < -0.3) return BRAKE_IN;
      if (s > 0.45) return GAS;
      return IDLE;
    }
    if (s < -0.85 || c < 0.2) return frame & 1 ? BRAKE_IN : IDLE;
    if (s < -0.72) return frame % 3 === 0 ? IDLE : GAS;
    return GAS;
  },
};
