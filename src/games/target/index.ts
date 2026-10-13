/*
 * Coin Toss: original "throw into the spinning target" tapper.
 * ArcadePad, GPL-3.0-or-later. Original design, no code or assets ported.
 *
 * A coin disc spins near the top of the field. Every tap throws one rocket
 * pin straight up; it sticks in the rim and turns with the disc. Hitting a
 * pin that is already stuck ends the run (single life). Each level needs N
 * pins; later levels start with pre-stuck pins and rim coins pay a bonus.
 * Every 5th level is a boss disc with a faster, meaner spin pattern.
 *
 * Angles: disc rotation and pin positions are integers in 1/4096 turn
 * (0 = +x, 1024 = straight down on screen). Rotation is kept as fixed point
 * (x256) so speeds can ramp smoothly while staying integer-exact.
 */
import { Rng } from "../core/rng.ts";
import { SIN256 } from "../core/trig.ts";
import type { GameDef, GameEngine, GameEvent, GameResult, Hud, Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const CX = 180;
export const CY = 200;
export const R = 92; // disc radius
export const TURN = 4096;
export const DOWN = 1024; // impact angle on screen (straight below the centre)
const FIX = 256;
const TURN_F = TURN * FIX;
/** Frames a pin needs from the launcher to the rim. */
export const FLIGHT = 7;
/** Tip y of a pin waiting on the launcher. */
export const LAUNCH_Y = 540;
/** Pins closer than this (1/4096 turn) collide. ~17px at the rim. */
export const HIT_GAP = 120;
/** A pin this close to a rim coin collects it. */
export const COIN_GAP = 150;
export const CLEAR_FRAMES = 72;
export const FAIL_FRAMES = 54;

export const PTS_PIN = 10;
export const PTS_COIN = 50;

export type Pattern = "steady" | "accel" | "reverse" | "stopgo";

interface LevelCfg {
  need: number;
  boss: boolean;
  pattern: Pattern;
  dir: 1 | -1;
  base: number; // units (1/4096 turn) per frame
  period: number; // frames (accel wave, reverse interval, go time)
  stop: number; // stop-and-go: frames standing still
  accel: number; // max |dv| per frame, fixed point
}

export interface TargetView {
  frame: number;
  level: number; // 0-based
  boss: boolean;
  pattern: Pattern;
  phase: "play" | "clear" | "fail" | "over";
  /** Frames since the current phase started (clear/fail) or since the level started (play). */
  phaseT: number;
  /** Disc rotation, 0..4095. */
  rot: number;
  /** Angular velocity, units per frame (may be fractional). */
  vel: number;
  /** Local angles (disc frame) of pins the player stuck. */
  pins: number[];
  /** Local angles of pre-stuck obstacle pins. */
  obstacles: number[];
  /** Local angles of rim coins still on the disc. */
  coins: number[];
  /** Pin in flight: tip y on screen, or null. */
  flight: { t: number; y: number } | null;
  need: number;
  /** Pins left to throw this level (excluding one in flight). */
  remaining: number;
  /** Frames since the last pin stuck (wobble). */
  wobble: number;
  score: number;
  levelsCleared: number;
}

/** sin of a 4096-step angle, linear interpolation of the 256-entry table (deterministic). */
export function sin4096(a: number): number {
  const i = (a >> 4) & 255;
  const f = (a & 15) / 16;
  const s0 = SIN256[i];
  const s1 = SIN256[(i + 1) & 255];
  return s0 + (s1 - s0) * f;
}
export function cos4096(a: number): number {
  return sin4096(a + 1024);
}

/** Shortest distance between two 4096-step angles. */
export function angDist(a: number, b: number): number {
  const d = (a - b) & (TURN - 1);
  return d > TURN / 2 ? TURN - d : d;
}

/** Local (disc) angle that sits at the impact point for a disc rotation. */
export function impactLocal(rot: number): number {
  return (DOWN - rot) & (TURN - 1);
}

class TargetEngine implements GameEngine<TargetView> {
  private rng: Rng;
  private level = 0;
  private cfg!: LevelCfg;
  private rotF = 0;
  private velF = 0;
  private lt = 0; // frames since level start
  private pins: number[] = [];
  private obstacles: number[] = [];
  private coins: number[] = [];
  private flight = -1; // frames in flight, -1 = none
  private remaining = 0;
  private sinceHit = 999;
  private phase: TargetView["phase"] = "play";
  private phaseT = 0;
  private prevB = 0;
  private score = 0;
  private levelsCleared = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.rotF = this.rng.int(TURN) * FIX;
    this.setupLevel();
  }

  private setupLevel() {
    const lv = this.level;
    const rng = this.rng;
    const boss = lv % 5 === 4;
    const need = boss ? Math.min(12, 8 + Math.floor(lv / 5)) : Math.min(12, 6 + Math.floor(lv / 2));
    let pattern: Pattern;
    if (lv === 0) pattern = "steady";
    else if (boss) pattern = (["accel", "reverse", "stopgo"] as const)[rng.int(3)];
    else if (lv === 1) pattern = (["steady", "accel"] as const)[rng.int(2)];
    else pattern = (["steady", "accel", "reverse", "stopgo"] as const)[rng.int(4)];
    const dir: 1 | -1 = rng.int(2) ? 1 : -1;
    let base = Math.min(46, 18 + lv * 2 + rng.range(0, 5));
    if (boss) base = Math.min(56, Math.round(base * 1.3));
    let period = 0;
    let stop = 0;
    if (pattern === "accel") period = rng.range(150, 260);
    else if (pattern === "reverse") period = rng.range(80, 160);
    else if (pattern === "stopgo") {
      period = rng.range(50, 100);
      stop = rng.range(18, 40);
    }
    this.cfg = { need, boss, pattern, dir, base, period, stop, accel: boss ? 300 : 170 };

    this.pins = [];
    this.obstacles = [];
    this.coins = [];
    const nObs = lv === 0 ? 0 : boss ? rng.range(2, 3) : rng.range(0, Math.min(4, 1 + Math.floor(lv / 2)));
    for (let tries = 0; this.obstacles.length < nObs && tries < 60; tries++) {
      const a = rng.int(TURN);
      if (this.obstacles.every((o) => angDist(o, a) > 500)) this.obstacles.push(a);
    }
    const nCoins = lv === 0 ? 1 : rng.range(1, boss ? 3 : 2);
    for (let tries = 0; this.coins.length < nCoins && tries < 60; tries++) {
      const a = rng.int(TURN);
      if (this.obstacles.every((o) => angDist(o, a) > 300) && this.coins.every((c) => angDist(c, a) > 300)) this.coins.push(a);
    }
    this.remaining = need;
    this.flight = -1;
    this.lt = 0;
    this.velF = this.targetVel();
    this.phase = "play";
    this.phaseT = 0;
  }

  /** Desired angular velocity (fixed point) for the current level time. */
  private targetVel(): number {
    const c = this.cfg;
    const baseF = c.base * FIX;
    const t = this.lt;
    switch (c.pattern) {
      case "steady":
        return c.dir * baseF;
      case "accel": {
        const s = sin4096(Math.floor((t * TURN) / c.period) & (TURN - 1));
        return c.dir * Math.round(baseF * (0.75 + 0.45 * s)); // 0.3x .. 1.2x
      }
      case "reverse":
        return (Math.floor(t / c.period) % 2 === 0 ? c.dir : -c.dir) * baseF;
      case "stopgo":
        return t % (c.period + c.stop) < c.period ? c.dir * Math.round(baseF * 1.25) : 0;
    }
  }

  private spin() {
    const target = this.targetVel();
    const a = this.cfg.accel;
    const dv = target - this.velF;
    this.velF += dv > a ? a : dv < -a ? -a : dv;
    this.rotF = (((this.rotF + this.velF) % TURN_F) + TURN_F) % TURN_F;
  }

  private get rot() {
    return this.rotF >> 8;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    if (this.phase === "fail") {
      this.phaseT++;
      this.spin();
      if (this.phaseT >= FAIL_FRAMES) {
        this.phase = "over";
        this.events.push({ t: "gameover", sfx: "gameover" });
      }
      return;
    }
    if (this.phase === "clear") {
      if (++this.phaseT >= CLEAR_FRAMES) {
        this.level++;
        this.setupLevel();
        this.events.push({ t: "level", level: this.level, boss: this.cfg.boss });
      }
      return;
    }

    this.lt++;
    this.sinceHit++;
    this.spin();
    if (this.flight >= 0) {
      if (++this.flight >= FLIGHT) this.resolve();
    } else if (pressed && this.remaining > 0) {
      this.flight = 0;
      this.remaining--;
      this.events.push({ t: "throw", sfx: "shot", x: CX, y: LAUNCH_Y });
    }
  }

  private resolve() {
    this.flight = -1;
    const local = impactLocal(this.rot);
    const x = CX;
    const y = CY + R;
    const blocked = this.pins.some((p) => angDist(p, local) < HIT_GAP) || this.obstacles.some((p) => angDist(p, local) < HIT_GAP);
    if (blocked) {
      this.phase = "fail";
      this.phaseT = 0;
      this.events.push({ t: "fail", sfx: "lost", mood: "sad", shake: 10, x, y });
      return;
    }
    this.pins.push(local);
    this.sinceHit = 0;
    this.score += PTS_PIN;
    this.events.push({ t: "stick", sfx: "paddle", x, y, angle: local });
    const ci = this.coins.findIndex((c) => angDist(c, local) < COIN_GAP);
    if (ci >= 0) {
      this.coins.splice(ci, 1);
      this.score += PTS_COIN;
      this.events.push({ t: "coin", sfx: "extraGood", value: PTS_COIN, x, y });
    }
    if (this.pins.length >= this.cfg.need) {
      const bonus = 100 + 25 * this.level + (this.cfg.boss ? 200 : 0);
      this.score += bonus;
      this.levelsCleared++;
      this.phase = "clear";
      this.phaseT = 0;
      this.events.push({ t: "clear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus, boss: this.cfg.boss, x: CX, y: CY });
    }
  }

  view(): TargetView {
    const f = this.flight;
    return {
      frame: this.frame,
      level: this.level,
      boss: this.cfg.boss,
      pattern: this.cfg.pattern,
      phase: this.phase,
      phaseT: this.phase === "play" ? this.lt : this.phaseT,
      rot: this.rot,
      vel: this.velF / FIX,
      pins: this.pins.slice(),
      obstacles: this.obstacles.slice(),
      coins: this.coins.slice(),
      flight: f >= 0 ? { t: f, y: LAUNCH_Y - ((LAUNCH_Y - (CY + R)) * f) / FLIGHT } : null,
      need: this.cfg.need,
      remaining: this.remaining,
      wobble: this.sinceHit,
      score: this.score,
      levelsCleared: this.levelsCleared,
    };
  }
  hud(): Hud {
    const left = this.remaining + (this.flight >= 0 ? 1 : 0);
    return { score: this.score, level: this.level + 1, label: this.cfg.boss ? `BOSS · ${left} pins` : `${left} pins` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.levelsCleared, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

export const target: GameDef<TargetView> = {
  id: "target",
  name: "Coin Toss",
  tagline: "Pin rockets into a spinning coin. Don't hit your own pins.",
  genre: "Timing tapper",
  session: "1–3 min",
  controls: "Tap, click or Space to throw.",
  field: { w: W, h: H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the spinning-target throwing genre. No code, art, sounds or levels from any existing game; all art is drawn with the ArcadePad kit.",
  },
  create: (seed) => new TargetEngine(seed),
  bot(v, frame) {
    const idle = { x: 0, y: 0, b: 0 };
    if (v.phase !== "play" || v.flight || v.remaining <= 0) return idle;
    // Human-ish pacing: let the disc settle after each hit.
    if (v.wobble < 14 || frame % 3 !== 0) return idle;
    // The press step spins once more, then FLIGHT steps until impact.
    const rotAt = Math.round(v.rot + v.vel * (FLIGHT + 1)) & (TURN - 1);
    const local = impactLocal(rotAt);
    const margin = HIT_GAP + 70;
    const free = v.pins.every((p) => angDist(p, local) > margin) && v.obstacles.every((p) => angDist(p, local) > margin);
    if (free) return { x: 0, y: 0, b: 1 };
    // Occasional mistimed throw so attract runs end.
    const h = Math.imul(frame ^ (v.rot << 13) ^ 0x5bd1e995, 0x9e3779b1) >>> 0;
    return (h >>> 7) % 100 < 2 ? { x: 0, y: 0, b: 1 } : idle;
  },
};
