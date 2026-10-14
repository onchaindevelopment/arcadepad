/*
 * Drift Circuit: an original top-down arcade racer. ArcadePad, GPL-3.0-or-later.
 *
 * Original design (credits.basedOn = "Original"): no code, names, cars, tracks
 * or art from any commercial racing game. Three original circuits are closed
 * Catmull-Rom centre lines resampled to a fixed spacing; each has a width,
 * a grass run-off and a barrier. Cars have an integer heading (4096 steps per
 * turn, interpolated from core/trig's 256-step table), throttle, brakes and a
 * lateral grip limit: slip past the limit is a drift, and drifting fills a
 * boost meter. Five AI cars follow a precomputed racing line with
 * deterministic lane noise, corner speed limits and rubber-banding.
 * A run is a championship of three 3-lap races; points 10/7/5/3/2/1.
 * Score = championship points x 100 + best-lap bonus of every race.
 */
import { Rng } from "../core/rng.ts";
import { cos256, sin256, angle256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- constants
export const FIELD_W = 360;
export const FIELD_H = 600;
export const SPACING = 8; // world px between centre-line samples
export const HALF_W = 46; // asphalt half width
export const WALL = 74; // barrier distance from the centre line
export const CAR_R = 8;
export const LAPS = 3;
export const RACES = 3;
export const CARS = 6;
export const POINTS = [10, 7, 5, 3, 2, 1];
export const COUNTDOWN = 180;
export const RACE_LIMIT = 150 * 60;
export const FINISH_T = 120;
export const RESULTS_T = 330;
export const MAX_FRAMES = RACES * (COUNTDOWN + RACE_LIMIT + FINISH_T + RESULTS_T) + 600;

export const MAXV = 4.4;
const BOOST_V = 6.2;
const ACC = 0.075;
const BOOST_ACC = 0.2;
const BRAKE = 0.16;
const REV_MAX = -1.6;
const GRASS_V = 2.1;
export const GRIP = 0.14;
const HANDBRAKE_GRIP = 0.035;
const STEER_LO = 34; // heading units (1/4096 turn) per frame at low speed
const STEER_HI = 26;
export const BOOST_COST = 34;
const BOOST_FRAMES = 60;
const DRIFT_SLIP = 0.45;

const AI_NAMES = ["ZIPP", "NOVA", "FUZZ", "BRRR", "DASH"];

// ---------------------------------------------------------------- tracks
export interface Track {
  name: string;
  n: number;
  len: number;
  x: number[];
  y: number[];
  nx: number[]; // right-hand normal
  ny: number[];
  tx: number[];
  ty: number[];
  curv: number[]; // signed 1/radius, >0 = right turn
  safe: number[]; // AI target speed (corner limits + braking)
  line: number[]; // racing-line lateral offset
  par: number; // par lap in frames for the bonus
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

function buildTrack(name: string, ctrl: number[][]): Track {
  const m = ctrl.length;
  const dense: number[][] = [];
  const SUB = 24;
  for (let i = 0; i < m; i++) {
    const p0 = ctrl[(i - 1 + m) % m], p1 = ctrl[i], p2 = ctrl[(i + 1) % m], p3 = ctrl[(i + 2) % m];
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      dense.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  const dn = dense.length;
  const cum = [0];
  for (let i = 0; i < dn; i++) {
    const a = dense[i], b = dense[(i + 1) % dn];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    cum.push(cum[i] + Math.sqrt(dx * dx + dy * dy));
  }
  const total = cum[dn];
  const n = Math.round(total / SPACING);
  const step = total / n;
  const x: number[] = [], y: number[] = [];
  let seg = 0;
  for (let i = 0; i < n; i++) {
    const d = i * step;
    while (cum[seg + 1] < d) seg++;
    const a = dense[seg], b = dense[(seg + 1) % dn];
    const u = (d - cum[seg]) / (cum[seg + 1] - cum[seg] || 1);
    x.push(a[0] + (b[0] - a[0]) * u);
    y.push(a[1] + (b[1] - a[1]) * u);
  }
  const tx: number[] = [], ty: number[] = [], nx: number[] = [], ny: number[] = [];
  for (let i = 0; i < n; i++) {
    const dx = x[(i + 1) % n] - x[(i - 1 + n) % n], dy = y[(i + 1) % n] - y[(i - 1 + n) % n];
    const l = Math.sqrt(dx * dx + dy * dy) || 1;
    tx.push(dx / l);
    ty.push(dy / l);
    nx.push(-dy / l);
    ny.push(dx / l);
  }
  const raw: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i - 2 + n) % n, b = (i + 2) % n;
    raw.push((tx[a] * ty[b] - ty[a] * tx[b]) / (4 * step));
  }
  const curv: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += raw[(i + k + n) % n];
    curv.push(s / 7);
  }
  // Corner speed limit: grip-limited and steer-rate-limited, then braking zones.
  const safe: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = 1 / Math.max(1e-4, Math.abs(curv[i]));
    const w = (STEER_HI / 4096) * 6.2832;
    safe.push(Math.min(MAXV, Math.sqrt(GRIP * 1.05 * r), w * 1.05 * r));
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = n - 1; i >= 0; i--) {
      const nxt = safe[(i + 1) % n];
      const lim = Math.sqrt(nxt * nxt + 2 * (BRAKE * 0.6) * step);
      if (lim < safe[i]) safe[i] = lim;
    }
  const lineRaw: number[] = [];
  for (let i = 0; i < n; i++) lineRaw.push(clamp(curv[i] * 150, -1, 1) * HALF_W * 0.6);
  const line: number[] = [];
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let k = -8; k <= 8; k++) s += lineRaw[(i + k + n) % n];
    line.push(s / 17);
  }
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, x[i]);
    maxX = Math.max(maxX, x[i]);
    minY = Math.min(minY, y[i]);
    maxY = Math.max(maxY, y[i]);
  }
  let parSum = 0;
  for (let i = 0; i < n; i++) parSum += step / Math.max(1, safe[i]);
  return { name, n, len: total, x, y, nx, ny, tx, ty, curv, safe, line, par: Math.round(parSum * 1.12), minX, minY, maxX, maxY };
}

export const TRACKS: Track[] = [
  buildTrack("SUNNY BAY", [
    [400, 175], [700, 180], [900, 260], [950, 600], [800, 800], [900, 1050], [800, 1300], [400, 1350], [180, 1150], [300, 850], [160, 600], [200, 220],
  ]),
  buildTrack("SWITCHBACK", [
    [560, 148], [860, 150], [950, 300], [840, 450], [430, 450], [320, 600], [430, 750], [840, 760], [960, 950], [760, 1150], [300, 1200], [100, 1050], [90, 600], [140, 160],
  ]),
  buildTrack("NEON KNOT", [
    [500, 120], [860, 230], [930, 500], [720, 700], [890, 930], [860, 1250], [500, 1330], [150, 1200], [170, 900], [390, 720], [150, 520], [170, 230],
  ]),
];

// ---------------------------------------------------------------- cars
interface Car {
  id: number;
  name: string;
  player: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hd: number; // 0..4095
  idx: number;
  laps: number;
  finished: boolean;
  finishRank: number;
  boost: number;
  boostT: number;
  slip: number;
  off: boolean;
  lapStart: number;
  bestLap: number;
  lastLap: number;
  // AI
  skill: number;
  amp: number;
  phase: number;
  freq: number;
  topMul: number;
  stuck: number;
  revT: number;
  wobbleT: number;
  wobble: number;
}

interface Ctl {
  steer: number;
  gas: boolean;
  brake: boolean;
  boost: boolean;
}

export interface CarView {
  id: number;
  name: string;
  player: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hd: number;
  idx: number;
  laps: number;
  slip: number;
  off: boolean;
  boostT: number;
  boost: number;
  finished: boolean;
  place: number;
}

export type Phase = "countdown" | "race" | "finish" | "results" | "done";

export interface RacerView {
  frame: number;
  phase: Phase;
  phaseT: number;
  race: number;
  track: number;
  cars: CarView[];
  me: number;
  place: number;
  lap: number; // 1-based current lap (clamped to LAPS)
  raceT: number;
  bestLap: number;
  lastLap: number;
  boost: number;
  points: number[]; // championship points per car id
  lastOrder: number[]; // car ids in finishing order of the last race
  lapBonus: number;
  score: number;
  champion: boolean;
}

function headVec(hd: number): [number, number] {
  const a = hd >> 4, fr = (hd & 15) / 16;
  return [cos256(a) * (1 - fr) + cos256(a + 1) * fr, sin256(a) * (1 - fr) + sin256(a + 1) * fr];
}

/** Shared AI steering/throttle (also used by the attract-mode bot). */
export function aiDrive(tr: Track, c: { x: number; y: number; vx: number; vy: number; hd: number; idx: number }, laneOff: number, speedMul: number): Ctl {
  const [fx, fy] = headVec(c.hd);
  const sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
  const look = 5 + Math.floor(sp * 2.2);
  const j = (c.idx + look) % tr.n;
  const off = clamp(tr.line[j] + laneOff, -HALF_W + 10, HALF_W - 10);
  const dx = tr.x[j] + tr.nx[j] * off - c.x, dy = tr.y[j] + tr.ny[j] * off - c.y;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const cross = (fx * dy - fy * dx) / d;
  const dot = (fx * dx + fy * dy) / d;
  const steer = dot < 0 ? (cross < 0 ? -1 : 1) : clamp(cross * 3, -1, 1);
  const target = tr.safe[(c.idx + 3) % tr.n] * speedMul;
  const vf = c.vx * fx + c.vy * fy;
  return { steer, gas: vf < target, brake: vf > target + 0.35, boost: false };
}

class RacerEngine implements GameEngine<RacerView> {
  private rng: Rng;
  private cars: Car[] = [];
  private phase: Phase = "countdown";
  private phaseT = 0;
  private race = 0;
  private raceT = 0;
  private prevB = 0;
  private lastFirePress = -100;
  private finishCount = 0;
  private points: number[] = [0, 0, 0, 0, 0, 0];
  private lastOrder: number[] = [];
  private lapBonus = 0;
  private racesDone = 0;
  private lastPlace = 6;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    for (let i = 0; i < CARS; i++) {
      this.cars.push({
        id: i, name: i === 0 ? "YOU" : AI_NAMES[i - 1], player: i === 0,
        x: 0, y: 0, vx: 0, vy: 0, hd: 0, idx: 0, laps: -1, finished: false, finishRank: 0,
        boost: 0, boostT: 0, slip: 0, off: false, lapStart: 0, bestLap: 0, lastLap: 0,
        skill: 1, amp: 0, phase: 0, freq: 1, topMul: 1, stuck: 0, revT: 0, wobbleT: 0, wobble: 0,
      });
    }
    this.setupRace();
  }

  private get tr() {
    return TRACKS[this.race];
  }

  private setupRace() {
    const tr = this.tr;
    // Grid: race 1 the player starts 5th; later races in reverse championship order.
    let order: number[];
    if (this.race === 0) order = [1, 2, 3, 4, 0, 5];
    else order = [0, 1, 2, 3, 4, 5].sort((a, b) => this.points[a] - this.points[b] || b - a);
    for (let slot = 0; slot < CARS; slot++) {
      const c = this.cars[order[slot]];
      const row = slot >> 1, col = slot & 1;
      const idx = (tr.n - 3 - row * 5 - col * 2) % tr.n;
      const lat = col ? 18 : -18;
      c.x = tr.x[idx] + tr.nx[idx] * lat;
      c.y = tr.y[idx] + tr.ny[idx] * lat;
      c.vx = c.vy = 0;
      c.hd = (angle256(tr.tx[idx] * 1000, tr.ty[idx] * 1000) * 16) & 4095;
      c.idx = idx;
      c.laps = -1;
      c.finished = false;
      c.finishRank = 0;
      c.boost = c.player ? c.boost >> 1 : 0;
      c.boostT = 0;
      c.slip = 0;
      c.off = false;
      c.lapStart = 0;
      c.bestLap = 0;
      c.lastLap = 0;
      c.stuck = 0;
      c.revT = 0;
      c.wobbleT = 0;
      if (!c.player) {
        c.skill = Math.min(0.995, 0.885 + 0.025 * this.race + this.rng.int(8) * 0.01);
        c.amp = 5 + this.rng.int(14);
        c.phase = this.rng.int(256);
        c.freq = 1 + this.rng.int(3);
      }
    }
    this.finishCount = 0;
    this.raceT = 0;
    this.phase = "countdown";
    this.phaseT = 0;
    this.lastPlace = 6;
  }

  private progress(c: Car) {
    return (c.laps * this.tr.n + c.idx) * SPACING;
  }

  private ranking(): Car[] {
    return this.cars.slice().sort((a, b) => {
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (a.finished) return a.finishRank - b.finishRank;
      return this.progress(b) - this.progress(a) || a.id - b.id;
    });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "done") return;
    this.phaseT++;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    if (this.phase === "countdown") {
      if (this.phaseT === 1 || this.phaseT === 61 || this.phaseT === 121) this.events.push({ t: "count", n: 3 - ((this.phaseT - 1) / 60), sfx: "brick" });
      if (this.phaseT >= COUNTDOWN) {
        this.phase = "race";
        this.phaseT = 0;
        this.events.push({ t: "go", sfx: "launch" });
      }
      return;
    }
    if (this.phase === "results") {
      if (this.phaseT >= RESULTS_T || (this.phaseT > 90 && pressed & (BTN.FIRE | BTN.ALT))) this.nextRace();
      return;
    }

    this.raceT++;
    const tr = this.tr;
    const player = this.cars[0];
    const pProg = this.progress(player);

    for (const c of this.cars) {
      let ctl: Ctl;
      if (c.player && this.phase === "race") ctl = this.playerCtl(inp, pressed);
      else if (c.player) ctl = { ...aiDrive(tr, c, 0, 0.7), boost: false };
      else ctl = this.aiCtl(c, pProg);
      this.physics(c, ctl);
    }
    this.collide();
    for (const c of this.cars) this.trackUpdate(c);

    // Overtake feedback.
    const place = this.ranking().indexOf(player) + 1;
    if (this.phase === "race" && place < this.lastPlace && this.raceT > 30) this.events.push({ t: "overtake", place, mood: "happy" });
    this.lastPlace = place;

    if (this.phase === "race" && (player.finished || this.raceT >= RACE_LIMIT)) {
      this.phase = "finish";
      this.phaseT = 0;
      const p = player.finished ? player.finishRank : place;
      if (!player.finished) this.events.push({ t: "timeout", sfx: "extraBad", mood: "sad" });
      this.events.push({
        t: "finish", place: p, sfx: p === 1 ? "levelclear" : p <= 3 ? "brickgone" : "extraBad",
        mood: p <= 3 ? "happy" : "sad", toast: p === 1 ? "levelClear" : undefined,
      });
    } else if (this.phase === "finish" && this.phaseT >= FINISH_T) {
      this.endRace();
    }
  }

  private playerCtl(inp: Input, pressed: number): Ctl {
    const b = inp.b;
    let steer = 0;
    if (b & BTN.LEFT) steer -= 1;
    if (b & BTN.RIGHT) steer += 1;
    if (!(b & (BTN.LEFT | BTN.RIGHT)) && b & BTN.FIRE) {
      const dx = inp.x - FIELD_W / 2;
      if (dx > 10 || dx < -10) steer = clamp((dx - (dx > 0 ? 10 : -10)) / 80, -1, 1);
    }
    let boost = !!(pressed & BTN.ALT);
    if (pressed & BTN.FIRE) {
      if (this.raceT - this.lastFirePress <= 16) boost = true; // double tap
      this.lastFirePress = this.raceT;
    }
    const brake = !!(b & BTN.DOWN);
    return { steer, gas: !brake, brake, boost };
  }

  private aiCtl(c: Car, pProg: number): Ctl {
    const tr = this.tr;
    // Rubber band: catch up when behind the player, ease off when far ahead.
    const diff = pProg - this.progress(c);
    c.topMul = 1 + clamp(diff / 1500, -0.07, 0.06);
    if (c.finished) c.topMul = 0.8;
    if (c.wobbleT > 0) c.wobbleT--;
    else if (this.rng.int(900) === 0) {
      c.wobbleT = 30;
      c.wobble = this.rng.int(2) ? 14 : -14;
    }
    const lane = (c.amp * sin256(((this.raceT * c.freq) >> 2) + c.phase)) + (c.wobbleT > 0 ? c.wobble : 0);
    const ctl = aiDrive(tr, c, lane, c.skill * c.topMul);
    const sp = Math.sqrt(c.vx * c.vx + c.vy * c.vy);
    if (c.revT > 0) {
      c.revT--;
      return { steer: -ctl.steer, gas: false, brake: true, boost: false };
    }
    if (sp < 0.4 && this.raceT > 60) {
      if (++c.stuck > 50) {
        c.stuck = 0;
        c.revT = 45;
      }
    } else c.stuck = 0;
    if (c.boost >= BOOST_COST && c.boostT === 0 && tr.safe[(c.idx + 20) % tr.n] >= MAXV * 0.97 && this.rng.int(40) === 0) ctl.boost = true;
    return ctl;
  }

  private physics(c: Car, ctl: Ctl) {
    let [fx, fy] = headVec(c.hd);
    let vf = c.vx * fx + c.vy * fy;
    const sp = Math.abs(vf);
    const handbrake = ctl.brake && ctl.steer !== 0 && vf > 2;
    if (sp > 0.15) {
      let rate = sp < 2 ? STEER_LO : STEER_LO - ((Math.min(sp, MAXV) - 2) * (STEER_LO - STEER_HI)) / (MAXV - 2);
      rate *= Math.min(1, sp / 1.6);
      if (handbrake) rate *= 1.35;
      c.hd = (c.hd + Math.round(ctl.steer * rate * (vf < 0 ? -1 : 1))) & 4095;
      [fx, fy] = headVec(c.hd);
    }
    vf = c.vx * fx + c.vy * fy;
    let vl = -c.vx * fy + c.vy * fx;
    if (ctl.boost && c.boost >= BOOST_COST && c.boostT === 0) {
      c.boost -= BOOST_COST;
      c.boostT = BOOST_FRAMES;
      if (c.player) this.events.push({ t: "boost", sfx: "shot", shake: 3, x: c.x, y: c.y });
    }
    if (c.boostT > 0) c.boostT--;
    const top = (c.boostT > 0 ? BOOST_V : MAXV) * (c.player ? 1 : Math.min(1.04, c.topMul));
    const lim = c.off ? Math.min(top, GRASS_V) : top;
    if (handbrake) vf -= 0.04;
    else if (ctl.brake) {
      if (vf > 0.2) vf -= BRAKE;
      else vf = Math.max(REV_MAX, vf - 0.05);
    } else if (ctl.gas) {
      if (vf < lim) vf = Math.min(lim, vf + (c.boostT > 0 ? BOOST_ACC : ACC));
    } else vf *= 0.99;
    if (vf > lim) vf = Math.max(lim, vf * (c.off ? 0.95 : 0.985));
    let grip = handbrake ? HANDBRAKE_GRIP : c.off ? GRIP * 0.7 : GRIP;
    if (vf < 1) grip *= 2;
    if (vl > grip) vl -= grip;
    else if (vl < -grip) vl += grip;
    else vl = 0;
    c.slip = vl;
    if (Math.abs(vl) > DRIFT_SLIP && vf > 1.5 && !c.off) {
      const before = c.boost;
      c.boost = Math.min(100, c.boost + Math.abs(vl) * 0.45);
      vf *= 0.997;
      if (c.player && Math.floor(before / BOOST_COST) < Math.floor(c.boost / BOOST_COST)) this.events.push({ t: "charge", sfx: "brick", level: Math.floor(c.boost / BOOST_COST) });
    }
    c.vx = fx * vf - fy * vl;
    c.vy = fy * vf + fx * vl;
    c.x += c.vx;
    c.y += c.vy;
  }

  private collide() {
    const D = CAR_R * 2;
    for (let i = 0; i < CARS; i++)
      for (let j = i + 1; j < CARS; j++) {
        const a = this.cars[i], b = this.cars[j];
        const dx = b.x - a.x, dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        if (d2 >= D * D || d2 < 1e-6) continue;
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d;
        const ov = (D - d) / 2;
        a.x -= nx * ov;
        a.y -= ny * ov;
        b.x += nx * ov;
        b.y += ny * ov;
        const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if (rv < 0) {
          const jm = (-1.3 * rv) / 2;
          a.vx -= nx * jm;
          a.vy -= ny * jm;
          b.vx += nx * jm;
          b.vy += ny * jm;
          if ((a.player || b.player) && rv < -0.8) this.events.push({ t: "bump", sfx: "paddle", shake: 3, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        }
      }
  }

  private trackUpdate(c: Car) {
    const tr = this.tr, n = tr.n;
    let best = c.idx, bd = Infinity;
    for (let k = -6; k <= 6; k++) {
      const i = (c.idx + k + n) % n;
      const dx = c.x - tr.x[i], dy = c.y - tr.y[i];
      const d = dx * dx + dy * dy;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const delta = best - c.idx;
    c.idx = best;
    if (delta < -n / 2) this.crossLine(c);
    else if (delta > n / 2) c.laps--;
    const nx = tr.nx[best], ny = tr.ny[best];
    const lat = (c.x - tr.x[best]) * nx + (c.y - tr.y[best]) * ny;
    c.off = lat > HALF_W || lat < -HALF_W;
    const lim = WALL - CAR_R;
    if (lat > lim || lat < -lim) {
      const s = lat > 0 ? 1 : -1;
      const ex = lat - s * lim;
      c.x -= nx * ex;
      c.y -= ny * ex;
      const vn = c.vx * nx + c.vy * ny;
      if (vn * s > 0) {
        c.vx -= nx * vn * 1.4;
        c.vy -= ny * vn * 1.4;
        c.vx *= 0.88;
        c.vy *= 0.88;
        if (c.player && (vn > 0.6 || vn < -0.6)) this.events.push({ t: "wall", sfx: "wall", shake: Math.min(6, 2 + Math.abs(vn) * 1.5), x: c.x + nx * s * CAR_R, y: c.y + ny * s * CAR_R });
      }
    }
  }

  private crossLine(c: Car) {
    c.laps++;
    if (c.laps <= 0) {
      c.lapStart = this.raceT;
      return;
    }
    if (c.finished) return;
    const lt = this.raceT - c.lapStart;
    c.lastLap = lt;
    const isBest = !c.bestLap || lt < c.bestLap;
    if (isBest) c.bestLap = lt;
    c.lapStart = this.raceT;
    if (c.laps >= LAPS) {
      c.finished = true;
      c.finishRank = ++this.finishCount;
    }
    if (c.player && this.phase === "race") {
      if (c.laps < LAPS) this.events.push({ t: "lap", lap: c.laps + 1, best: isBest && c.laps > 1, frames: lt, sfx: isBest && c.laps > 1 ? "extraGood" : "brickgone", x: c.x, y: c.y });
    }
  }

  private endRace() {
    const order = this.ranking();
    this.lastOrder = order.map((c) => c.id);
    order.forEach((c, i) => (this.points[c.id] += POINTS[i]));
    const p = this.cars[0];
    if (p.bestLap > 0) this.lapBonus += Math.max(0, Math.floor((this.tr.par - p.bestLap) / 2));
    this.racesDone++;
    this.phase = "results";
    this.phaseT = 0;
    this.events.push({ t: "results", sfx: "levelclear" });
  }

  private nextRace() {
    if (this.race + 1 >= RACES) {
      this.phase = "done";
      const champ = this.isChampion();
      this.events.push(champ ? { t: "champion", sfx: "won", mood: "happy", toast: "levelClear" } : { t: "gameover", sfx: "gameover", mood: "sad" });
      return;
    }
    this.race++;
    this.setupRace();
  }

  private isChampion() {
    const me = this.points[0];
    for (let i = 1; i < CARS; i++) if (this.points[i] >= me) return false;
    return true;
  }

  private score() {
    return this.points[0] * 100 + this.lapBonus;
  }

  view(): RacerView {
    const rank = this.ranking();
    const p = this.cars[0];
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      race: this.race,
      track: this.race,
      cars: this.cars.map((c) => ({
        id: c.id, name: c.name, player: c.player, x: c.x, y: c.y, vx: c.vx, vy: c.vy, hd: c.hd, idx: c.idx,
        laps: c.laps, slip: c.slip, off: c.off, boostT: c.boostT, boost: c.boost, finished: c.finished, place: rank.indexOf(c) + 1,
      })),
      me: 0,
      place: rank.indexOf(p) + 1,
      lap: clamp(p.laps + 1, 1, LAPS),
      raceT: this.raceT,
      bestLap: p.bestLap,
      lastLap: p.lastLap,
      boost: p.boost,
      points: this.points.slice(),
      lastOrder: this.lastOrder.slice(),
      lapBonus: this.lapBonus,
      score: this.score(),
      champion: this.phase === "done" && this.isChampion(),
    };
  }
  hud(): Hud {
    const place = this.ranking().indexOf(this.cars[0]) + 1;
    return { score: this.score(), level: this.race + 1, label: `P${place} LAP ${clamp(this.cars[0].laps + 1, 1, LAPS)}/${LAPS}` };
  }
  result(): GameResult {
    return {
      score: this.score(),
      level: this.race,
      levelsCleared: this.racesDone,
      frames: this.frame,
      status: this.phase === "done" ? (this.isChampion() ? "won" : "over") : "playing",
    };
  }
  get done() {
    return this.phase === "done";
  }
}

function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const racer: GameDef<RacerView> = {
  id: "racer",
  name: "Drift Circuit",
  tagline: "Three tracks, five rivals, one championship. Drift to charge your boost.",
  genre: "Top-down arcade racing",
  session: "3–5 min",
  controls: "Gas is automatic. Left / Right steer, Down brakes (brake + steer = drift), X / Shift boosts. Touch: hold the left or right side to steer, double-tap to boost.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original top-down racer written for ArcadePad: spline tracks, drift/boost car model, racing-line AI with rubber-banding and all art are ours. No code, names, cars, tracks or art from any existing racing game.",
  },
  create: (seed) => new RacerEngine(seed),
  bot(v, frame) {
    const mid = { x: FIELD_W / 2, y: FIELD_H / 2 };
    if (v.phase === "results") return { ...mid, b: frame % 40 < 2 ? BTN.FIRE : 0 };
    if (v.phase !== "race") return { ...mid, b: 0 };
    const me = v.cars[v.me];
    // Imperfection: lane drift and occasional lapses of attention.
    const lane = ((hash32(frame >> 6) % 21) - 10) * 1.5;
    const ctl = aiDrive(TRACKS[v.track], me, lane, 0.93);
    if (hash32((frame >> 4) + 999) % 23 === 0) ctl.steer *= 0.3;
    let b: number = BTN.FIRE;
    if (ctl.brake) b |= BTN.DOWN;
    // Unstick: if parked against something, reverse with opposite lock for a while.
    if (v.raceT > 120 && Math.abs(me.vx) + Math.abs(me.vy) < 0.5 && (frame >> 5) & 1) {
      ctl.steer = -ctl.steer;
      b = BTN.FIRE | BTN.DOWN;
    }
    if (v.boost >= BOOST_COST && TRACKS[v.track].safe[(me.idx + 20) % TRACKS[v.track].n] >= MAXV * 0.97) b |= BTN.ALT;
    const sx = ctl.steer === 0 ? 0 : ctl.steer > 0 ? 10 + ctl.steer * 80 : -10 + ctl.steer * 80;
    return { x: Math.round(FIELD_W / 2 + sx), y: FIELD_H / 2, b };
  },
};
