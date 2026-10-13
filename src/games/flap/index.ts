/*
 * Moon Flap: one-tap flapper. Physics constants ported from floppybird
 * (https://github.com/nebez/floppybird, js/main.js + css/main.css),
 * Apache-2.0 (see the repo's LICENSE). Only numbers and rules were ported;
 * none of its code structure, art, sounds or fonts were used.
 * Port: ArcadePad, GPL-3.0-or-later.
 *
 * Kept from floppybird (per 1/60 s frame): gravity 0.25, flap sets the
 * vertical speed to -4.6, pipes 52 wide scrolling ~2.22 px/frame
 * (1000 px in 7.5 s), a new pipe every 1.4 s (~187 px apart), 80 px padding
 * between the gap and the top/bottom of the fly area, gap height drawn
 * uniformly at random, +1 when the player's left edge passes a pipe's right
 * edge, the ceiling only clamps, the ground kills, tilt = min(v/10*90, 90).
 * Changed: gap starts at 116 (floppybird: 90 with a sprite-sized hitbox),
 * candle wicks reach into the gap, a fall-speed cap, distance-based spawning,
 * a small difficulty ramp every 10 points, and a "get ready" state that
 * auto-starts after 3 s.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 540;
/** Top of the ground strip; the fly area is 0..GROUND_Y. */
export const GROUND_Y = 480;
export const BIRD_X = 80;
/** Hitbox half size (the mascot head is drawn a bit bigger). */
export const BIRD_HW = 11;
export const BIRD_HH = 9;
export const CANDLE_W = 52;
/** Wicks stick out of each candle body into the gap. */
export const WICK_LEN = 10;
export const WICK_W = 6;

const GRAVITY = 0.25;
const FLAP_V = -4.6;
const MAX_FALL = 8;
const SPEED0 = 2.25;
const SPEED_STEP = 0.125;
const SPEED_MAX = 3;
const GAP0 = 116; // wick tip to wick tip
const GAP_STEP = 5;
const GAP_MIN = 96;
const SPACING = 188; // px between candle pairs
const PADDING = 80;
const AUTO_START = 180; // 3 s
const FLAP_KEYS = BTN.FIRE | BTN.UP;

export interface Candle {
  id: number;
  x: number; // left edge
  /** Wick tip of the upper candle (top of the gap). */
  gapTop: number;
  gap: number;
  scored: boolean;
}

export interface FlapView {
  frame: number;
  state: "ready" | "flying" | "dead";
  y: number; // bird centre
  vy: number;
  /** Degrees, -25 (nose up) .. 90 (nose down). */
  tilt: number;
  candles: Candle[];
  score: number;
  speed: number;
  /** Total scroll distance, for parallax. */
  dist: number;
  /** Frames since the last flap (for wing animation). */
  sinceFlap: number;
}

class FlapEngine implements GameEngine<FlapView> {
  private rng: Rng;
  private prevB = 0;
  private state: "ready" | "flying" | "dead" = "ready";
  private y = GROUND_Y * 0.45;
  private vy = 0;
  private candles: Candle[] = [];
  private nextId = 0;
  private score = 0;
  private speed = SPEED0;
  private gap = GAP0;
  private dist = 0;
  private sinceSpawn = 0;
  private sinceFlap = 999;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  private spawn() {
    const constraint = GROUND_Y - this.gap - PADDING * 2;
    const gapTop = PADDING + this.rng.int(constraint + 1);
    this.candles.push({ id: this.nextId++, x: W + 8, gapTop, gap: this.gap, scored: false });
    this.sinceSpawn = 0;
  }

  private flap() {
    this.vy = FLAP_V;
    this.sinceFlap = 0;
    this.events.push({ t: "flap", sfx: "launch", quiet: true, x: BIRD_X, y: this.y });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.state === "dead") return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    this.sinceFlap++;

    if (this.state === "ready") {
      if (pressed & FLAP_KEYS || this.frame >= AUTO_START) {
        this.state = "flying";
        this.flap();
        this.spawn();
      }
      return;
    }

    if (pressed & FLAP_KEYS) this.flap();
    this.vy = Math.min(this.vy + GRAVITY, MAX_FALL);
    this.y += this.vy;
    if (this.y - BIRD_HH < 0) this.y = BIRD_HH; // ceiling clamps, as in the original

    // Scroll candles.
    this.dist += this.speed;
    this.sinceSpawn += this.speed;
    for (const c of this.candles) c.x -= this.speed;
    if (this.candles.length && this.candles[0].x + CANDLE_W < -20) this.candles.shift();
    if (this.sinceSpawn >= SPACING) this.spawn();

    // Scoring: left edge of the bird past the candle's right edge.
    for (const c of this.candles) {
      if (!c.scored && BIRD_X - BIRD_HW > c.x + CANDLE_W) {
        c.scored = true;
        this.score++;
        this.events.push({ t: "score", sfx: "brick", x: BIRD_X, y: this.y });
        if (this.score % 10 === 0) {
          this.speed = Math.min(SPEED_MAX, this.speed + SPEED_STEP);
          this.gap = Math.max(GAP_MIN, this.gap - GAP_STEP);
          this.events.push({ t: "milestone", score: this.score, sfx: "extraGood", mood: "happy", x: BIRD_X, y: this.y - 24 });
        }
      }
    }

    // Collisions.
    if (this.y + BIRD_HH >= GROUND_Y) {
      this.y = GROUND_Y - BIRD_HH;
      this.die();
      return;
    }
    for (const c of this.candles) if (this.hits(c)) return this.die();
  }

  private hits(c: Candle): boolean {
    const l = BIRD_X - BIRD_HW, r = BIRD_X + BIRD_HW, t = this.y - BIRD_HH, b = this.y + BIRD_HH;
    if (r <= c.x || l >= c.x + CANDLE_W) return false;
    const bodyTop = c.gapTop - WICK_LEN; // bottom of the upper body
    const bodyBot = c.gapTop + c.gap + WICK_LEN; // top of the lower body
    if (t < bodyTop || b > bodyBot) return true;
    // Wicks: narrow centred rects reaching into the gap.
    const wl = c.x + (CANDLE_W - WICK_W) / 2, wr = wl + WICK_W;
    if (r > wl && l < wr && (t < c.gapTop || b > c.gapTop + c.gap)) return true;
    return false;
  }

  private die() {
    this.state = "dead";
    this.events.push({ t: "hit", sfx: "lost", mood: "sad", shake: 10, x: BIRD_X, y: this.y });
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  view(): FlapView {
    return {
      frame: this.frame,
      state: this.state,
      y: this.y,
      vy: this.vy,
      tilt: this.state === "ready" ? 0 : Math.max(-25, Math.min((this.vy / 10) * 90, 90)),
      candles: this.candles.map((c) => ({ ...c })),
      score: this.score,
      speed: this.speed,
      dist: this.dist,
      sinceFlap: this.sinceFlap,
    };
  }
  hud(): Hud {
    return { score: this.score, label: this.state === "ready" ? "Get ready" : undefined };
  }
  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.state === "dead" ? "over" : "playing" };
  }
  get done() {
    return this.state === "dead";
  }
}

/** Deterministic per-frame noise for the bot (0..1023). */
function noise(frame: number, salt: number): number {
  let h = Math.imul(frame ^ 0x9e3779b9, 0x85ebca6b) ^ salt;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) & 1023;
}

export const flap: GameDef<FlapView> = {
  id: "flap",
  name: "Moon Flap",
  tagline: "One tap to pump. Thread the gap between the candles.",
  genre: "One-tap flapper",
  session: "30 s–3 min",
  controls: "Tap, click, Space or Up to flap.",
  field: { w: W, h: H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "floppybird",
    url: "https://github.com/nebez/floppybird",
    authors: "nebez and contributors",
    licence: "Apache-2.0",
    notes:
      "Physics and rule constants ported (gravity, flap speed, pipe width, speed, spacing, padding, random gap placement, scoring, ceiling clamp, tilt formula). Gap widened for the new hitbox, fall cap, wicks and difficulty ramp added. No code structure, sprites, sounds or fonts used; all art is drawn with the theme.",
  },
  create: (seed) => new FlapEngine(seed),
  bot(v, frame) {
    if (v.state !== "flying") return { x: 0, y: 0, b: v.state === "ready" && frame > 30 ? BTN.FIRE : 0 };
    const next = v.candles.find((c) => c.x + CANDLE_W > BIRD_X - BIRD_HW);
    const centre = next ? next.gapTop + next.gap / 2 : GROUND_Y / 2;
    const jitter = (noise(frame, 3) % 17) - 8;
    const flapNow = v.vy >= 0 && v.y > centre + 14 + jitter;
    return { x: 0, y: 0, b: flapNow ? BTN.FIRE : 0 };
  },
};
