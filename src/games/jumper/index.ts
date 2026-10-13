/*
 * Moon Jumper: endless vertical platform jumper. Original implementation of
 * the "keep bouncing upward" genre for ArcadePad; no code, constants or art
 * were taken from any other game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * World units: x grows right (0..W, wraps), height `h` grows upward from the
 * start floor. The camera stores the height of the bottom screen edge and
 * only ever rises. 1 step = 1/60 s.
 *
 * Reachability: the main chain of platforms is generated bottom-up with a
 * vertical gap of at most SAFE_GAP (well under the plain bounce height
 * MAX_RISE) and a wrapped horizontal offset of at most MAX_DX, so the next
 * chain platform is always reachable from the previous one. Decoys, springs,
 * rockets and bears are extras on top of that chain.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;

export const GRAVITY = 0.3;
export const JUMP_V = 9.6;
export const SPRING_V = 15;
export const JET_V = 12;
export const JET_FRAMES = 140;
const MAX_FALL = 12;
const MAX_VX = 5.5;
const ACCEL = 0.55;
const POINTER_GAIN = 0.18;

/** Player hitbox: half width and body height above the feet. */
export const PW = 11;
export const PH = 26;
export const PLAT_H = 12;
export const BEAR_W = 15; // half width
export const BEAR_H = 26;

/** Exact peak of a plain bounce with this integrator (sum of 9.6-0.3k). */
export const MAX_RISE = maxRise(JUMP_V);
/** Largest vertical gap the generator ever leaves between chain platforms. */
export const SAFE_GAP = 118;
/** Largest direct (non-wrapped) horizontal centre offset between chain platforms. */
export const MAX_DX = 130;
/** The camera keeps the player at most this far above the bottom edge. */
const CAM_LINE = H * 0.55;
const MILESTONE = 1000;

export function maxRise(v0: number): number {
  let v = v0;
  let h = 0;
  let best = 0;
  while (v > 0) {
    v -= GRAVITY;
    h += v;
    if (h > best) best = h;
  }
  return best;
}

export type PlatKind = "base" | "normal" | "moving" | "crumble" | "spring";

export interface Plat {
  id: number;
  x: number; // left edge
  top: number; // height of the top surface
  w: number;
  kind: PlatKind;
  vx: number;
  /** 0 = intact; >0 frames since it crumbled (no longer solid). */
  broken: number;
  /** Frames since something bounced on it (springs animate), large = idle. */
  hitAge: number;
  chain: boolean;
}
export interface Rocket { id: number; x: number; h: number; taken: boolean }
export interface Bear { id: number; x: number; h: number; vx: number; lo: number; hi: number; dead: number }

export interface JumperView {
  frame: number;
  x: number;
  h: number;
  vx: number;
  vy: number;
  cam: number;
  maxH: number;
  score: number;
  bonus: number;
  jet: number;
  hit: boolean;
  dead: boolean;
  bounces: number;
  sinceBounce: number;
  /** Height of the last bounce. */
  baseH: number;
  platforms: readonly Plat[];
  rockets: readonly Rocket[];
  bears: readonly Bear[];
  milestones: number;
}

/** Highest platform top the feet cross this step while falling, or -1. Pure, for tests. */
export function landingIndex(x: number, prevH: number, h: number, vy: number, plats: readonly Plat[]): number {
  if (vy >= 0) return -1; // passing up through a platform never lands
  let best = -1;
  for (let i = 0; i < plats.length; i++) {
    const p = plats[i];
    if (p.broken) continue;
    if (prevH < p.top || h > p.top) continue;
    if (!overlapsX(x, PW, p.x, p.x + p.w)) continue;
    if (best < 0 || p.top > plats[best].top) best = i;
  }
  return best;
}

/** Does [cx-hw, cx+hw] (wrapping at the screen edges) overlap [a, b]? */
export function overlapsX(cx: number, hw: number, a: number, b: number): boolean {
  for (let s = -W; s <= W; s += W) {
    if (cx + s + hw > a && cx + s - hw < b) return true;
  }
  return false;
}

/** Shortest signed horizontal distance from a to b on the wrapping field. */
export function wrapDx(a: number, b: number): number {
  let d = b - a;
  if (d > W / 2) d -= W;
  if (d < -W / 2) d += W;
  return d;
}

class JumperEngine implements GameEngine<JumperView> {
  private rng: Rng;
  private x = W / 2;
  private h = 0;
  private vx = 0;
  private vy = JUMP_V;
  private cam = 0;
  private maxH = 0;
  private bonus = 0;
  private jet = 0;
  private hit = false;
  private dead = false;
  private bounces = 0;
  private sinceBounce = 0;
  private baseH = 0;
  private milestones = 0;
  private plats: Plat[] = [];
  private rockets: Rocket[] = [];
  private bears: Bear[] = [];
  private nextId = 1;
  private genTop = 0;
  private solidTop = 0;
  private genCx = W / 2;
  private lastRocket = 0;
  private lastBear = 0;
  // Input: "pointer" chases tx; "keys" uses arrows until the pointer moves again.
  private mode: "pointer" | "keys" = "pointer";
  private tx = W / 2;
  private lastPointerX = W / 2;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.plats.push({ id: this.nextId++, x: 0, top: 0, w: W, kind: "base", vx: 0, broken: 0, hitAge: 999, chain: true });
    this.generate(H + 200);
  }

  /** Difficulty 0..1 by height. */
  private diff(top: number) {
    return Math.min(1, top / 15000);
  }

  private generate(limit: number) {
    while (this.genTop < limit) this.addChainPlatform();
  }

  private addChainPlatform() {
    const rng = this.rng;
    const d = this.diff(this.genTop);
    const minGap = 28 + Math.floor(40 * d);
    const maxGap = Math.min(SAFE_GAP, 64 + Math.floor((SAFE_GAP - 64) * d * 1.3));
    // Crumbles vanish after one bounce, so the gap budget runs from the last
    // solid chain platform: falling back onto it must still reach the next one.
    const budget = SAFE_GAP - (this.genTop - this.solidTop);
    const hi = Math.min(maxGap, budget);
    const lo = Math.min(minGap, hi);
    const gap = lo + rng.int(hi - lo + 1);
    const top = this.genTop + gap;
    const w = 60 - Math.floor(16 * d);
    const off = rng.range(-130, 130);
    // Reflect off the side walls instead of wrapping, so the next chain
    // platform is within MAX_DX even for pointer players (who never wrap).
    let cx = this.genCx + off;
    if (cx < w / 2) cx = w - cx;
    else if (cx > W - w / 2) cx = 2 * W - w - cx;
    const r = rng.int(1000);
    let kind: PlatKind = "normal";
    const pMoving = top > 400 ? 80 + Math.floor(300 * d) : 0;
    const pCrumble = top > 700 ? 40 + Math.floor(180 * d) : 0;
    if (r < 60) kind = "spring";
    else if (r < 60 + pMoving) kind = "moving";
    else if (r < 60 + pMoving + pCrumble && top - this.solidTop <= SAFE_GAP - 40) kind = "crumble";
    if (kind !== "crumble") this.solidTop = top;
    const p = this.makePlat(cx - w / 2, top, w, kind, true);
    this.plats.push(p);

    // Rare rocket on a plain static platform.
    if (kind === "normal" && top > 900 && top - this.lastRocket > 2600 && rng.int(1000) < 25) {
      this.rockets.push({ id: this.nextId++, x: cx, h: top, taken: false });
      this.lastRocket = top;
    }
    // Decoys beside the chain: plenty low down, sparser higher up.
    if (rng.int(100) < 45 - Math.floor(30 * d)) {
      const dw = 44 + rng.int(17);
      const dcx = (cx + W / 2 + rng.range(-70, 70) + W) % W;
      const dtop = top - rng.int(Math.max(1, gap));
      const dk: PlatKind = top > 500 && rng.int(100) < 40 ? "crumble" : "normal";
      if (dtop > 20) this.plats.push(this.makePlat(Math.max(0, Math.min(W - dw, dcx - dw / 2)), dtop, dw, dk, false));
    }
    // Bears higher up, hovering on the far side of the chain.
    if (top > 2500 && top - this.lastBear > 900 && rng.int(100) < 8 + Math.floor(10 * d)) {
      const bx = (cx + W / 2) % W;
      const lo = Math.max(BEAR_W + 4, bx - 60);
      const hi = Math.min(W - BEAR_W - 4, bx + 60);
      this.bears.push({ id: this.nextId++, x: (lo + hi) / 2, h: top + 30, vx: rng.int(2) ? 0.9 : -0.9, lo, hi, dead: 0 });
      this.lastBear = top;
    }
    this.genTop = top;
    this.genCx = cx;
  }

  private makePlat(x: number, top: number, w: number, kind: PlatKind, chain: boolean): Plat {
    let vx = 0;
    if (kind === "moving") {
      const d = this.diff(top);
      vx = (6 + this.rng.int(5 + Math.floor(10 * d))) / 10;
      if (this.rng.int(2)) vx = -vx;
    }
    return { id: this.nextId++, x, top, w, kind, vx, broken: 0, hitAge: 999, chain };
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;

    // --- input -> horizontal speed
    const keys = inp.b & (BTN.LEFT | BTN.RIGHT);
    if (keys) this.mode = "keys";
    else if (inp.x !== this.lastPointerX) {
      this.mode = "pointer";
      this.tx = inp.x;
    }
    this.lastPointerX = inp.x;
    let want = 0;
    if (!this.hit) {
      if (keys === BTN.LEFT) want = -MAX_VX;
      else if (keys === BTN.RIGHT) want = MAX_VX;
      else if (this.mode === "pointer") want = Math.max(-MAX_VX, Math.min(MAX_VX, (this.tx - this.x) * POINTER_GAIN));
    }
    const dv = want - this.vx;
    this.vx += Math.max(-ACCEL, Math.min(ACCEL, dv));
    this.x += this.vx;
    if (this.x < 0) this.x += W;
    else if (this.x >= W) this.x -= W;

    // --- world motion
    for (const p of this.plats) {
      if (p.kind === "moving") {
        p.x += p.vx;
        if (p.x < 0) { p.x = -p.x; p.vx = -p.vx; }
        else if (p.x + p.w > W) { p.x = 2 * (W - p.w) - p.x; p.vx = -p.vx; }
      }
      if (p.broken) p.broken++;
      if (p.hitAge < 999) p.hitAge++;
    }
    for (const b of this.bears) {
      if (b.dead) { b.dead++; continue; }
      b.x += b.vx;
      if (b.x < b.lo) { b.x = b.lo; b.vx = -b.vx; }
      else if (b.x > b.hi) { b.x = b.hi; b.vx = -b.vx; }
    }

    // --- vertical motion
    if (this.jet > 0) {
      this.jet--;
      this.vy = JET_V;
    } else {
      this.vy -= GRAVITY;
      if (this.vy < -MAX_FALL) this.vy = -MAX_FALL;
    }
    const prevH = this.h;
    this.h += this.vy;
    this.sinceBounce++;

    // --- landing
    if (!this.hit && this.jet === 0) {
      const i = landingIndex(this.x, prevH, this.h, this.vy, this.plats);
      if (i >= 0) this.bounce(this.plats[i]);
    }

    // --- rockets
    if (!this.hit) {
      for (const r of this.rockets) {
        if (r.taken) continue;
        if (Math.abs(wrapDx(this.x, r.x)) < PW + 8 && this.h < r.h + 24 && this.h + PH > r.h) {
          r.taken = true;
          this.jet = JET_FRAMES;
          this.vy = JET_V;
          this.bonus += 25;
          this.events.push({ t: "rocket", sfx: "extraGood", mood: "happy", x: this.x, h: this.h });
        }
      }
    }

    // --- bears
    if (!this.hit) {
      for (const b of this.bears) {
        if (b.dead) continue;
        if (Math.abs(wrapDx(this.x, b.x)) >= PW + BEAR_W) continue;
        if (this.h >= b.h + BEAR_H || this.h + PH <= b.h) continue;
        if (this.jet > 0) {
          b.dead = 1;
          this.bonus += 50;
          this.events.push({ t: "bearBonk", sfx: "brickgone", shake: 4, x: b.x, h: b.h + BEAR_H / 2 });
        } else if (this.vy < 0 && prevH >= b.h + BEAR_H - 8) {
          b.dead = 1;
          this.h = b.h + BEAR_H;
          this.baseH = this.h;
          this.vy = JUMP_V;
          this.sinceBounce = 0;
          this.bonus += 50;
          this.events.push({ t: "stomp", sfx: "brickgone", mood: "happy", shake: 4, x: b.x, h: b.h + BEAR_H });
        } else {
          this.hit = true;
          if (this.vy > 0) this.vy = 0;
          this.events.push({ t: "hit", sfx: "explode", mood: "sad", shake: 8, x: this.x, h: this.h + PH / 2 });
          break;
        }
      }
    }

    // --- progress
    if (this.h > this.maxH) this.maxH = this.h;
    while (this.maxH >= (this.milestones + 1) * MILESTONE) {
      this.milestones++;
      this.bonus += 25;
      this.events.push({ t: "milestone", height: this.milestones * MILESTONE, sfx: "extraGood", mood: "happy", toast: "levelClear", x: this.x, h: this.h });
    }
    if (this.h - this.cam > CAM_LINE) this.cam = this.h - CAM_LINE;

    // --- world upkeep
    this.generate(this.cam + H + 200);
    const floor = this.cam - 80;
    if (this.plats.length && this.plats[0].top < floor) this.plats = this.plats.filter((p) => p.top >= floor && p.broken < 60);
    else if (this.frame % 30 === 0) this.plats = this.plats.filter((p) => p.broken < 60);
    if (this.rockets.length) this.rockets = this.rockets.filter((r) => !r.taken && r.h >= floor);
    if (this.bears.length) this.bears = this.bears.filter((b) => b.h >= floor && b.dead < 60);

    // --- fall out
    if (this.h + PH < this.cam - 10) {
      this.dead = true;
      this.events.push({ t: "fall", sfx: "lost", mood: "sad", shake: 10, x: this.x, h: this.cam });
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  private bounce(p: Plat) {
    this.h = p.top;
    this.baseH = p.top;
    this.bounces++;
    this.sinceBounce = 0;
    p.hitAge = 0;
    if (p.kind === "spring") {
      this.vy = SPRING_V;
      this.events.push({ t: "spring", sfx: "launch", x: this.x, h: p.top });
    } else {
      this.vy = JUMP_V;
      this.events.push({ t: "bounce", sfx: "paddle", quiet: true, x: this.x, h: p.top, kind: p.kind });
    }
    if (p.kind === "crumble") {
      p.broken = 1;
      this.events.push({ t: "crumble", sfx: "brick", x: p.x + p.w / 2, h: p.top });
    }
  }

  private score() {
    return Math.floor(this.maxH / 10) + this.bonus;
  }

  view(): JumperView {
    return {
      frame: this.frame,
      x: this.x,
      h: this.h,
      vx: this.vx,
      vy: this.vy,
      cam: this.cam,
      maxH: this.maxH,
      score: this.score(),
      bonus: this.bonus,
      jet: this.jet,
      hit: this.hit,
      dead: this.dead,
      bounces: this.bounces,
      sinceBounce: this.sinceBounce,
      baseH: this.baseH,
      platforms: this.plats,
      rockets: this.rockets,
      bears: this.bears,
      milestones: this.milestones,
    };
  }
  hud(): Hud {
    return { score: this.score(), level: this.milestones + 1, label: `${Math.floor(this.maxH / 10)} m` };
  }
  result(): GameResult {
    return { score: this.score(), level: this.milestones, levelsCleared: this.milestones, frames: this.frame, status: this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead;
  }
}

/** Test hook: the generator's chain without running the game. */
export function generateChain(seed: number, upTo: number): Plat[] {
  const e = new JumperEngine(seed) as unknown as { generate(n: number): void; plats: Plat[] };
  e.generate(upTo);
  return e.plats;
}

export const jumper: GameDef<JumperView> = {
  id: "jumper",
  name: "Moon Jumper",
  tagline: "Bounce, steer, never look down. How high can the mascot go?",
  genre: "Endless platform jumper",
  session: "1–5 min",
  controls: "Move the pointer (or hold ←/→) to steer. Bouncing is automatic; the sides wrap around.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 15 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the endless vertical jumper genre: own physics constants, generator and art. No code, levels or assets from any other game.",
  },
  create: (seed) => new JumperEngine(seed),
  bot(v) {
    if (v.jet > 0 || v.hit) return { x: W / 2, y: H / 2, b: 0 };
    const apex = v.h + (v.vy > 0 ? (v.vy * v.vy) / (2 * GRAVITY) : 0);
    let best: Plat | null = null;
    let bestScore = -Infinity;
    for (const p of v.platforms) {
      if (p.broken) continue;
      // While rising, only aim for something higher than where we took off.
      if (v.vy > 0 && p.top <= v.baseH + 1) continue;
      if (p.top > apex - 4) continue;
      if (v.vy <= 0 && p.top > v.h) continue;
      if (p.top < v.cam + 4) continue;
      const cx = p.x + p.w / 2;
      // Pointer steering cannot wrap, so far-away platforms cost more.
      const s = p.top - Math.abs(cx - v.x) * 0.35 - (p.kind === "crumble" ? 25 : 0) + (p.kind === "spring" ? 30 : 0);
      if (s > bestScore) { bestScore = s; best = p; }
    }
    if (!best) return { x: Math.round(v.x), y: H / 2, b: 0 };
    // Imperfection: a per-bounce aiming error, sometimes large.
    const k = Math.imul(v.bounces + 1, 2654435761) >>> 0;
    let err = (k % 41) - 20;
    // Now and then it commits to a sloppy line for the whole rise.
    if ((k >>> 8) % 11 === 0 && v.vy > 0) err *= 2.6;
    const tx = Math.max(0, Math.min(W, Math.round(best.x + best.w / 2 + err)));
    return { x: tx, y: H / 2, b: 0 };
  },
};
