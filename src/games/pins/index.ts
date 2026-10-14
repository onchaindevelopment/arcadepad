/*
 * Pin Spin: an original "throw pins into a spinning target" game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Original design (credits.basedOn = "Original"): no code, names or art from
 * any existing game of the genre.
 *
 * A giant coin spins at (CX, CY). Angles are "fine" units, ANG = 65536 per
 * turn (256 fine units per byte angle of core/trig), so slow speeds stay
 * integer. A stuck pin sits at a coin-local angle `a`; on screen it is at
 * a + rot. Pins are thrown straight up from the bottom and hit the coin at
 * screen angle BOTTOM (straight down from the centre), i.e. local angle
 * BOTTOM - rot.
 *
 * Stuck pins stick out PIN_L px from the rim. While the flying pin's tip is
 * inside that ring (rim .. rim + PIN_L) any stuck pin closer than SEP to the
 * bottom knocks it away: run over. Otherwise it sticks at the rim (+1).
 * Gems sit on the rim; sticking a pin next to one collects it (+5).
 * Each stage needs `needed` pins; some stages start with pre-stuck pins.
 * Rotation patterns (from the Rng): constant, speeding, reversing,
 * stop-and-go. Every 5th stage is a boss coin with a lurch or pendulum swing.
 * Clearing a stage shatters the coin: +5 + stage (boss: +30 + 2 x stage).
 */
import { Rng } from "../core/rng.ts";
import { sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- geometry
export const FIELD_W = 360;
export const FIELD_H = 600;
export const CX = 180;
export const CY = 220;
export const R = 78; // coin radius
export const PIN_L = 46; // how far a stuck pin sticks out of the rim
export const ANG = 65536;
export const BOTTOM = 64 * 256; // screen angle straight down
export const SEP = 1200; // min angular distance between pins (fine units)
export const GEM_SEP = 1500;
export const LAUNCH_Y = 540; // tip y of a pin waiting to be thrown
export const PIN_SPEED = 18; // px per frame
const CLEAR_FRAMES = 72;
const MAX_FRAMES = 15 * 60 * 60;

export const PAT_CONSTANT = 0;
export const PAT_SPEEDING = 1;
export const PAT_REVERSING = 2;
export const PAT_STOPGO = 3;
export const PAT_BOSS_LURCH = 4;
export const PAT_BOSS_SWING = 5;
export const PATTERN_NAMES = ["Steady", "Speeding", "Reversing", "Stop & go", "Boss: lurch", "Boss: swing"];

export interface Pin {
  a: number; // coin-local angle, fine units
  preset: boolean;
}
export interface Gem {
  a: number;
  taken: boolean;
}

export interface PinsView {
  frame: number;
  stage: number; // 0-based
  boss: boolean;
  pattern: number;
  rot: number; // fine units
  vel: number; // fine units per frame
  pins: Pin[];
  gems: Gem[];
  /** Tip y of the pin in flight, or -1. */
  flyY: number;
  needed: number;
  left: number; // pins still to throw this stage
  score: number;
  dead: boolean;
  /** Frames left in the stage-clear pause (0 when playing). */
  clearing: number;
  throws: number; // total pins thrown this run
  ticker: string;
}

/** Wrap to [0, ANG). Inputs are integers. */
export function wrapA(a: number): number {
  return a & (ANG - 1);
}
/** |shortest distance| between two fine angles. */
export function angDist(a: number, b: number): number {
  const d = wrapA(a - b + ANG / 2) - ANG / 2;
  return d < 0 ? -d : d;
}

export function isBoss(stage: number): boolean {
  return stage % 5 === 4;
}
export function neededFor(stage: number): number {
  return isBoss(stage) ? Math.min(14, 9 + Math.floor(stage / 5)) : Math.min(11, 6 + Math.floor(stage / 2));
}
function baseSpeed(stage: number): number {
  return Math.min(430, 190 + 14 * stage);
}

export interface StageSetup {
  pattern: number;
  dir: number;
  pins: Pin[];
  gems: Gem[];
}

/** Build one stage. Exported for tests. */
export function buildStage(rng: Rng, stage: number): StageSetup {
  const boss = isBoss(stage);
  const pattern = boss ? (rng.int(2) === 0 ? PAT_BOSS_LURCH : PAT_BOSS_SWING) : stage === 0 ? PAT_CONSTANT : rng.int(4);
  const dir = rng.int(2) === 0 ? 1 : -1;
  const pins: Pin[] = [];
  const gems: Gem[] = [];
  let nPre = boss ? Math.min(7, 3 + Math.floor(stage / 5)) : stage === 0 ? 0 : Math.min(5, Math.floor(stage / 3) + rng.int(2));
  let guard = 0;
  while (nPre > 0 && guard++ < 200) {
    const a = rng.int(256) * 256;
    if (pins.some((p) => angDist(p.a, a) < SEP * 2)) continue;
    pins.push({ a, preset: true });
    nPre--;
  }
  let nGem = boss ? 2 : stage % 2 === 1 ? 1 : rng.int(2);
  guard = 0;
  while (nGem > 0 && guard++ < 200) {
    const a = rng.int(256) * 256;
    if (pins.some((p) => angDist(p.a, a) < SEP + 600)) continue;
    if (gems.some((g) => angDist(g.a, a) < GEM_SEP * 3)) continue;
    gems.push({ a, taken: false });
    nGem--;
  }
  return { pattern, dir, pins, gems };
}

class PinsEngine implements GameEngine<PinsView> {
  private rng: Rng;
  private ticker: string;
  private stage = 0;
  private levelsCleared = 0;
  private pattern = PAT_CONSTANT;
  private dir = 1;
  private rot = 0;
  private vel = 0;
  private target = 0;
  private acc = 10;
  private phase = 0;
  private phaseStep = 2;
  private timer = 0;
  private moving = true;
  private pins: Pin[] = [];
  private gems: Gem[] = [];
  private flyY = -1;
  private needed = 0;
  private left = 0;
  private score = 0;
  private dead = false;
  private clearing = 0;
  private throws = 0;
  private prevB = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, ticker: string) {
    this.rng = new Rng(seed);
    this.ticker = ticker;
    this.setupStage();
  }

  private setupStage() {
    const s = buildStage(this.rng, this.stage);
    this.pattern = s.pattern;
    this.dir = s.dir;
    this.pins = s.pins;
    this.gems = s.gems;
    this.needed = neededFor(this.stage);
    this.left = this.needed;
    this.flyY = -1;
    this.phase = 0;
    this.moving = true;
    const base = baseSpeed(this.stage);
    this.acc = 10;
    switch (this.pattern) {
      case PAT_CONSTANT:
        this.vel = this.dir * base;
        break;
      case PAT_REVERSING:
        this.timer = 70 + this.rng.int(90);
        this.acc = 12;
        this.vel = this.dir * base;
        break;
      case PAT_STOPGO:
        this.timer = 60 + this.rng.int(60);
        this.acc = 14;
        this.vel = this.dir * base;
        break;
      case PAT_BOSS_LURCH:
        this.phaseStep = 3 + this.rng.int(2);
        this.acc = 22;
        this.vel = 0;
        break;
      case PAT_BOSS_SWING:
        this.phaseStep = 2 + this.rng.int(2);
        this.acc = 22;
        this.vel = 0;
        break;
      default:
        this.vel = this.dir * Math.round(base * 0.5);
    }
    this.target = this.vel;
  }

  /** Target velocity for this frame, per pattern. */
  private updateTarget() {
    const base = baseSpeed(this.stage);
    switch (this.pattern) {
      case PAT_CONSTANT:
        this.target = this.dir * base;
        break;
      case PAT_SPEEDING:
        // Smoothly speeds up to ~2x and back down, period 512 frames.
        this.phase++;
        this.target = this.dir * Math.round(base * (1.05 + 0.75 * sin256(this.phase >> 1)));
        break;
      case PAT_REVERSING:
        if (--this.timer <= 0) {
          this.dir = -this.dir;
          this.timer = 70 + this.rng.int(110);
        }
        this.target = this.dir * base;
        break;
      case PAT_STOPGO:
        if (--this.timer <= 0) {
          this.moving = !this.moving;
          if (this.moving) {
            this.timer = 60 + this.rng.int(80);
            if (this.rng.int(3) === 0) this.dir = -this.dir;
          } else this.timer = 25 + this.rng.int(40);
        }
        this.target = this.moving ? this.dir * Math.round(base * 1.4) : 0;
        break;
      case PAT_BOSS_LURCH: {
        // Bursts of speed with dead stops in between.
        this.phase += this.phaseStep;
        const s = sin256(this.phase >> 1);
        this.target = this.dir * Math.round(base * (0.15 + 1.9 * (s > 0 ? s : 0)));
        break;
      }
      case PAT_BOSS_SWING:
        // Pendulum: swings one way, then the other.
        this.phase += this.phaseStep;
        this.target = Math.round(base * 1.7 * sin256(this.phase >> 1));
        break;
    }
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    if (this.clearing > 0) {
      if (--this.clearing === 0) {
        this.stage++;
        this.setupStage();
        this.events.push({ t: "stage", stage: this.stage, boss: isBoss(this.stage), sfx: "launch" });
      }
      return;
    }

    // ---- rotation
    this.updateTarget();
    const d = this.target - this.vel;
    this.vel += d > this.acc ? this.acc : d < -this.acc ? -this.acc : d;
    this.rot = wrapA(this.rot + this.vel);

    // ---- throw
    if (pressed & (BTN.FIRE | BTN.UP) && this.flyY < 0 && this.left > 0) {
      this.flyY = LAUNCH_Y;
      this.left--;
      this.throws++;
      this.events.push({ t: "throw", sfx: "shot", x: CX, y: LAUNCH_Y });
    }

    // ---- pin in flight
    if (this.flyY < 0) return;
    this.flyY -= PIN_SPEED;
    const rim = CY + R;
    if (this.flyY > rim + PIN_L) return;
    const local = wrapA(BOTTOM - this.rot);
    for (const p of this.pins) {
      if (angDist(p.a, local) < SEP) {
        this.die(Math.max(this.flyY, rim));
        return;
      }
    }
    if (this.flyY > rim) return;
    this.stick(local);
  }

  private stick(local: number) {
    this.flyY = -1;
    this.pins.push({ a: local, preset: false });
    this.score += 1;
    this.events.push({ t: "stick", sfx: "brick", x: CX, y: CY + R, pts: 1 });
    for (const g of this.gems) {
      if (!g.taken && angDist(g.a, local) < GEM_SEP) {
        g.taken = true;
        this.score += 5;
        this.events.push({ t: "gem", sfx: "extraGood", mood: "happy", x: CX, y: CY + R, pts: 5 });
      }
    }
    if (this.left === 0) {
      const boss = isBoss(this.stage);
      const bonus = boss ? 30 + 2 * (this.stage + 1) : 5 + (this.stage + 1);
      this.score += bonus;
      this.levelsCleared++;
      this.clearing = CLEAR_FRAMES;
      this.events.push({ t: "clear", boss, pts: bonus, x: CX, y: CY, sfx: "levelclear", toast: "levelClear", mood: "happy", shake: boss ? 10 : 6 });
    }
  }

  private die(y: number) {
    this.dead = true;
    this.events.push({ t: "die", x: CX, y, sfx: "lost", mood: "sad", shake: 10, toast: "lifeLost" });
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  view(): PinsView {
    return {
      frame: this.frame,
      stage: this.stage,
      boss: isBoss(this.stage),
      pattern: this.pattern,
      rot: this.rot,
      vel: this.vel,
      pins: this.pins,
      gems: this.gems,
      flyY: this.flyY,
      needed: this.needed,
      left: this.left,
      score: this.score,
      dead: this.dead,
      clearing: this.clearing,
      throws: this.throws,
      ticker: this.ticker,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.stage + 1, label: isBoss(this.stage) ? `BOSS ${this.left} pins` : `${this.left} pins` };
  }
  result(): GameResult {
    return { score: this.score, level: this.stage, levelsCleared: this.levelsCleared, frames: this.frame, status: this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead || this.frame >= MAX_FRAMES;
  }
}

function hash32(n: number): number {
  let h = Math.imul(n ^ 0x51ed270b, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

function cleanTicker(t: string): string {
  const s = (t || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  return s || "COIN";
}

/** Frames until a freshly thrown pin reaches the stuck-pin zone and the rim. */
const T_ZONE = Math.ceil((LAUNCH_Y - (CY + R + PIN_L)) / PIN_SPEED);
const T_RIM = Math.ceil((LAUNCH_Y - (CY + R)) / PIN_SPEED);

export const pins: GameDef<PinsView> = {
  id: "pins",
  name: "Pin Spin",
  tagline: "Throw pins into the spinning coin. Hit a pin that's already stuck and it's over.",
  genre: "Timing / pin throw",
  session: "1–4 min",
  controls: "Tap, click, Space or Up to throw a pin.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true, touchMap: { tap: 1 } },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes:
      "Original pin-throw game written for ArcadePad: stage generator, rotation patterns, boss coins, gem and scoring rules and the renderer are all ours. No code, names, sounds or art from any existing game of the genre.",
  },
  create: (seed, ctx) => new PinsEngine(seed, cleanTicker(ctx.ticker)),
  bot(v, frame) {
    const idle = { x: CX, y: LAUNCH_Y, b: 0 };
    if (v.dead || v.clearing > 0 || v.flyY >= 0 || v.left <= 0) return idle;
    // Think time between throws (varies), so play looks human.
    const h = hash32(frame >> 3);
    if (h % 4 === 0) return idle;
    // Imperfection: rare blind throws.
    if (hash32(frame * 7 + v.throws) % 900 === 0) return { x: CX, y: LAUNCH_Y, b: BTN.FIRE };
    // Predict with the current velocity (wrong when the coin is about to change pace).
    const margin = SEP + 380 + (h % 3) * 120;
    for (let f = T_ZONE - 1; f <= T_RIM + 1; f++) {
      const local = wrapA(BOTTOM - (v.rot + v.vel * f));
      for (const p of v.pins) if (angDist(p.a, local) < margin) return idle;
    }
    return { x: CX, y: LAUNCH_Y, b: BTN.FIRE };
  },
};
