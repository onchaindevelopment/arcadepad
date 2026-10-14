/*
 * Moon Bridge: an original one-button bridge builder. ArcadePad, GPL-3.0-or-later.
 *
 * The mascot stands at the right edge of a pillar. Press and hold FIRE to grow
 * a candle-plank straight up from the edge; release and it tips over (animated)
 * to lie across the gap. If its tip lands on the next pillar (between its near
 * and far edges) the mascot walks across; otherwise it walks to the tip and
 * falls. A tip inside the small centre zone of the target pillar is a perfect.
 *
 * While walking over the gap, DOWN (or a FIRE tap, for touch) flips the mascot
 * to hang under the plank, where it can grab coins. Reaching the next pillar
 * while still hanging means a crash.
 *
 * Scoring: +1 per pillar reached, +1 per perfect, +1 per coin. Every
 * MILESTONE pillars is a milestone (toast). Pillar gaps and widths come from
 * the run's Rng and get harder with distance, but always fit on screen.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
/** Screen y of every pillar's top surface. */
export const TOP_Y = 420;
/** Screen x where the current pillar's right edge sits once the camera settles. */
export const EDGE_SCREEN_X = 72;
export const HERO_BACK = 12; // hero centre stands this far left of the pillar's right edge
export const HERO_HALF = 10; // hero half width (collisions)
export const PERFECT_HALF = 4; // centre zone is 2*PERFECT_HALF+1 px wide
export const MAX_LEN = 330;
export const ROT_SPEED = 4; // byte-angle steps per frame (64 = quarter turn)
export const WALK_SPEED = 4;
export const SETTLE_FRAMES = 18;
export const FALL_FRAMES = 50;
export const MILESTONE = 10;
const START_W = 80;
const COIN_REACH = 12;

export type Phase = "ready" | "grow" | "rotate" | "walk" | "settle" | "fall" | "dead";

export interface Pillar {
  i: number; // pillar number (0 = start)
  x: number; // world x of the left edge
  w: number;
}

export interface Plank {
  x: number; // world x of its base (the pillar edge it grew from)
  len: number;
  ang: number; // 0 upright .. 64 flat .. 128 hanging down
}

export interface BridgeView {
  frame: number;
  phase: Phase;
  /** A few pillars around the current one, oldest first. */
  pillars: readonly Pillar[];
  cur: Pillar;
  next: Pillar;
  /** The plank in play (len 0 while ready). */
  plank: Plank;
  /** Earlier planks left lying across their gaps. */
  old: readonly Plank[];
  heroX: number;
  /** 0 on the surface; grows (downwards) while falling. */
  heroY: number;
  flipped: boolean;
  coin: { x: number; taken: boolean } | null;
  growSpeed: number;
  crossed: number;
  streak: number;
  score: number;
  dead: boolean;
}

export function growSpeedFor(crossed: number): number {
  return 3 + Math.min(15, crossed) / 10;
}

class BridgeEngine implements GameEngine<BridgeView> {
  private rng: Rng;
  private pillars: Pillar[] = [];
  private cur = 0; // index into pillars
  private phase: Phase = "ready";
  private plank: Plank = { x: 0, len: 0, ang: 0 };
  private old: Plank[] = [];
  private heroX = 0;
  private heroY = 0;
  private vy = 0;
  private flipped = false;
  private coin: { x: number; taken: boolean } | null = null;
  private success = false;
  private shortFail = false;
  private timer = 0;
  private crossed = 0;
  private streak = 0;
  private score = 0;
  private prevB = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.pillars.push({ i: 0, x: 0, w: START_W });
    this.spawnNext();
    this.heroX = START_W - HERO_BACK;
    this.plank = { x: START_W, len: 0, ang: 0 };
  }

  private get curP() {
    return this.pillars[this.cur];
  }
  private get nextP() {
    return this.pillars[this.cur + 1];
  }

  private spawnNext() {
    const last = this.pillars[this.pillars.length - 1];
    const k = this.crossed;
    const minGap = Math.min(60, 30 + k);
    const maxGap = Math.min(190, 100 + k * 4);
    const maxW = Math.max(34, 80 - k * 2);
    const minW = Math.min(maxW, Math.max(20, 44 - k));
    let gap = this.rng.range(minGap, maxGap);
    const w = this.rng.range(minW, maxW);
    // Fairness: the far edge must fit on screen after the camera settles.
    if (gap + w > W - EDGE_SCREEN_X - 16) gap = W - EDGE_SCREEN_X - 16 - w;
    const edge = last.x + last.w;
    this.pillars.push({ i: last.i + 1, x: edge + gap, w });
    // Optional coin hanging under the future plank.
    this.coin = null;
    const roll = this.rng.int(100);
    if (gap >= 60 && roll < 55) this.coin = { x: edge + this.rng.range(22, gap - 22), taken: false };
    // Keep only a few pillars around.
    while (this.pillars.length > 5 && this.cur > 1) {
      this.pillars.shift();
      this.cur--;
    }
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "dead") return;
    const held = inp.b;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    const ev = this.events;

    switch (this.phase) {
      case "ready":
        if (pressed & BTN.FIRE) {
          this.phase = "grow";
          this.plank = { x: this.curP.x + this.curP.w, len: 0, ang: 0 };
          ev.push({ t: "grow" });
          this.grow();
        }
        break;
      case "grow":
        if (held & BTN.FIRE) this.grow();
        else {
          this.phase = "rotate";
          ev.push({ t: "release", sfx: "launch", len: this.plank.len });
        }
        break;
      case "rotate":
        this.plank.ang = Math.min(64, this.plank.ang + ROT_SPEED);
        if (this.plank.ang === 64) this.land();
        break;
      case "walk":
        this.walk(pressed);
        break;
      case "settle":
        if (--this.timer <= 0) this.phase = "ready";
        break;
      case "fall":
        this.vy += 0.55;
        this.heroY += this.vy;
        if (this.shortFail) this.plank.ang = Math.min(128, this.plank.ang + ROT_SPEED);
        if (--this.timer <= 0) {
          this.phase = "dead";
          ev.push({ t: "gameover", sfx: "gameover" });
        }
        break;
    }
  }

  private grow() {
    const s = growSpeedFor(this.crossed);
    this.plank.len = Math.min(MAX_LEN, this.plank.len + s);
  }

  private land() {
    const n = this.nextP;
    const tip = this.plank.x + this.plank.len;
    this.success = tip >= n.x && tip <= n.x + n.w;
    this.shortFail = tip < n.x;
    this.phase = "walk";
    this.flipped = false;
    this.events.push({ t: "land", sfx: "paddle", shake: 2, x: tip, ok: this.success });
    if (this.success) {
      const c = n.x + n.w / 2;
      if (Math.abs(tip - c) <= PERFECT_HALF) {
        this.streak++;
        this.score += 1;
        this.events.push({ t: "perfect", sfx: "extraGood", mood: "happy", x: c, streak: this.streak });
      } else this.streak = 0;
    }
  }

  private walk(pressed: number) {
    const n = this.nextP;
    const ev = this.events;
    const gapStart = this.plank.x;
    // Flip / unflip while over the gap.
    if (pressed & (BTN.DOWN | BTN.FIRE)) {
      if (this.heroX >= gapStart && this.heroX + HERO_HALF < n.x) {
        this.flipped = !this.flipped;
        ev.push({ t: "flip", sfx: "wall", flipped: this.flipped, x: this.heroX });
      }
    }
    this.heroX += WALK_SPEED;
    // Coin grab while hanging.
    const c = this.coin;
    if (c && !c.taken && this.flipped && Math.abs(this.heroX - c.x) <= COIN_REACH) {
      c.taken = true;
      this.score += 1;
      ev.push({ t: "coin", sfx: "brickgone", x: c.x });
    }
    // Hanging hero hits the next pillar.
    if (this.flipped && this.heroX + HERO_HALF >= n.x && (this.success || this.plank.x + this.plank.len >= n.x)) {
      this.heroX = n.x - HERO_HALF;
      this.startFall("crash");
      return;
    }
    if (this.success) {
      const target = n.x + n.w - HERO_BACK;
      if (this.heroX >= target) {
        this.heroX = target;
        this.arrive();
      }
    } else if (this.heroX >= this.plank.x + this.plank.len) {
      this.heroX = this.plank.x + this.plank.len;
      this.startFall(this.shortFail ? "short" : "long");
    }
  }

  private startFall(why: string) {
    this.phase = "fall";
    this.timer = FALL_FRAMES;
    this.vy = this.flipped ? 1 : -2.5;
    this.streak = 0;
    this.events.push({ t: "fall", why, sfx: "lost", mood: "sad", shake: 10, x: this.heroX });
  }

  private arrive() {
    this.crossed++;
    this.score += 1;
    this.events.push({ t: "arrive", sfx: "brick", x: this.heroX, crossed: this.crossed });
    if (this.crossed % MILESTONE === 0) {
      this.events.push({ t: "milestone", sfx: "levelclear", toast: "levelClear", mood: "happy", crossed: this.crossed });
    }
    this.old.push({ ...this.plank });
    if (this.old.length > 3) this.old.shift();
    this.cur++;
    this.spawnNext();
    this.plank = { x: this.curP.x + this.curP.w, len: 0, ang: 0 };
    this.phase = "settle";
    this.timer = SETTLE_FRAMES;
  }

  view(): BridgeView {
    return {
      frame: this.frame,
      phase: this.phase,
      pillars: this.pillars,
      cur: this.curP,
      next: this.nextP,
      plank: this.plank,
      old: this.old,
      heroX: this.heroX,
      heroY: this.heroY,
      flipped: this.flipped,
      coin: this.coin,
      growSpeed: growSpeedFor(this.crossed),
      crossed: this.crossed,
      streak: this.streak,
      score: this.score,
      dead: this.phase === "dead" || this.phase === "fall",
    };
  }
  hud(): Hud {
    return {
      score: this.score,
      level: Math.floor(this.crossed / MILESTONE) + 1,
      label: this.streak >= 2 ? `Perfect x${this.streak}` : `Pillar ${this.crossed}`,
    };
  }
  result(): GameResult {
    const lv = Math.floor(this.crossed / MILESTONE);
    return { score: this.score, level: lv, levelsCleared: lv, frames: this.frame, status: this.phase === "dead" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "dead";
  }
}

/** Deterministic per-pillar bot error, in px from the target pillar's centre. */
function botError(k: number, x: number, w: number): number {
  let hsh = Math.imul((k * 131 + x * 7 + w) | 0, 0x9e3779b1);
  hsh = Math.imul(hsh ^ (hsh >>> 15), 0x85ebca6b);
  const e = ((hsh ^ (hsh >>> 13)) >>> 8) % 100;
  if (e < 7) return w / 2 + 8; // overshoot: a miss
  if (e < 10) return -(w / 2 + 8); // undershoot: a miss
  const half = Math.max(0, w / 2 - 3);
  return (((e * 37) % 21) - 10) * half / 10;
}

export const bridge: GameDef<BridgeView> = {
  id: "bridge",
  name: "Moon Bridge",
  tagline: "Hold to grow a candle, let go to drop it across the gap. Don't come up short.",
  genre: "One-button bridge builder",
  session: "1–3 min",
  controls: "Hold tap / click / Space to grow the bridge, release to drop it. While crossing, Down or a tap flips you under the bridge to grab coins.",
  field: { w: W, h: H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the hold-to-grow bridge genre. No code or assets from any existing game; all art is drawn with the ArcadePad kit and the coin's theme.",
  },
  create: (seed) => new BridgeEngine(seed),
  bot(v, frame) {
    const idle = { x: 0, y: 0, b: 0 };
    if (frame < 40) return idle;
    if (v.phase === "ready") return (frame & 1) === 0 ? { x: 0, y: 0, b: BTN.FIRE } : idle;
    if (v.phase === "grow") {
      const target = v.next.x + v.next.w / 2 + botError(v.next.i, v.next.x, v.next.w) - v.plank.x;
      return v.plank.len + v.growSpeed / 2 < target ? { x: 0, y: 0, b: BTN.FIRE } : idle;
    }
    if (v.phase === "walk" && (frame & 1) === 0) {
      const over = v.heroX >= v.plank.x && v.heroX + HERO_HALF + WALK_SPEED * 5 < v.next.x;
      const c = v.coin;
      const want = over && c !== null && !c.taken && c.x > v.heroX - 4;
      if (want !== v.flipped && (over || v.flipped)) return { x: 0, y: 0, b: BTN.DOWN };
    }
    return idle;
  },
};
