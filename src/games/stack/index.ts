/*
 * Moon Stack: an original one-button tower stacker. ArcadePad, GPL-3.0-or-later.
 *
 * A slab slides back and forth above the tower (alternately entering from the
 * left and the right). FIRE / UP / DOWN drops it. Whatever overhangs the slab
 * below is sliced off and falls away, so the tower narrows. A complete miss
 * ends the run. A drop within PERFECT_PX of the slab below snaps exactly and
 * counts as a perfect; from the 3rd perfect in a row each further perfect
 * regrows the slab by GROW_PX (up to the base width). Speed rises with height.
 *
 * Scoring: +1 per slab placed. A perfect also adds a bonus equal to the
 * current perfect streak (1st perfect +1, 2nd +2, 3rd +3 ...), capped at
 * MAX_BONUS. Every MILESTONE slabs is a "level" (toast); the moon is at
 * MOON_HEIGHT, but the run carries on past it for score.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 560;
export const SLAB_H = 20;
export const BASE_W = 180;
export const BASE_X = (W - BASE_W) / 2;
export const PERFECT_PX = 3;
export const GROW_PX = 6;
export const MILESTONE = 25;
export const MOON_HEIGHT = 100;
const MAX_BONUS = 10;
const EDGE_VISIBLE = 24; // slab keeps at least this much of itself on screen
const DROP_BTNS = BTN.FIRE | BTN.UP | BTN.DOWN;

export const MILESTONE_NAMES = ["", "SKY HIGH", "ORBIT", "DEEP SPACE", "THE MOON!"];
export function milestoneName(level: number): string {
  return MILESTONE_NAMES[level] ?? `MOON +${(level - 4) * MILESTONE}`;
}

export interface Slab {
  x: number; // left edge, field units
  w: number;
}

export interface StackView {
  frame: number;
  /** Placed slabs, bottom (base, index 0) first. Slab i sits at world height i * SLAB_H. */
  slabs: readonly Slab[];
  /** The sliding slab (level = slabs.length), or null after game over. */
  moving: { x: number; w: number; dir: number; speed: number } | null;
  /** Slabs stacked on the base. */
  height: number;
  streak: number;
  score: number;
  dead: boolean;
}

export function speedFor(height: number): number {
  return Math.min(5.5, 1.9 + height * 0.035);
}

class StackEngine implements GameEngine<StackView> {
  private rng: Rng;
  private slabs: Slab[] = [{ x: BASE_X, w: BASE_W }];
  private mx = 0;
  private mw = BASE_W;
  private dir = 1;
  private fromLeft = true;
  private prevB = 0;
  private streak = 0;
  private score = 0;
  private dead = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.fromLeft = (this.rng.next() & 1) === 0;
    this.spawn();
  }

  private get height() {
    return this.slabs.length - 1;
  }
  private minX() {
    return EDGE_VISIBLE - this.mw;
  }
  private maxX() {
    return W - EDGE_VISIBLE;
  }

  private spawn() {
    const top = this.slabs[this.slabs.length - 1];
    this.mw = top.w;
    const jitter = this.rng.int(30);
    if (this.fromLeft) {
      this.mx = this.minX() + jitter;
      this.dir = 1;
    } else {
      this.mx = this.maxX() - jitter;
      this.dir = -1;
    }
    this.fromLeft = !this.fromLeft;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    if (pressed & DROP_BTNS) {
      this.drop();
      return;
    }
    // Slide and bounce.
    this.mx += this.dir * speedFor(this.height);
    if (this.mx > this.maxX()) {
      this.mx = this.maxX();
      this.dir = -1;
    } else if (this.mx < this.minX()) {
      this.mx = this.minX();
      this.dir = 1;
    }
  }

  private drop() {
    const top = this.slabs[this.slabs.length - 1];
    const level = this.slabs.length;
    const y = level * SLAB_H; // world height of the dropped slab's bottom
    const ev = this.events;
    ev.push({ t: "drop", sfx: "paddle", x: this.mx + this.mw / 2, level });

    const left = Math.max(this.mx, top.x);
    const right = Math.min(this.mx + this.mw, top.x + top.w);
    if (right <= left) {
      // Complete miss: the whole slab falls.
      this.dead = true;
      ev.push({ t: "miss", sfx: "lost", mood: "sad", shake: 10, x: this.mx, w: this.mw, level, side: this.mx < top.x ? -1 : 1, y });
      ev.push({ t: "gameover", sfx: "gameover" });
      return;
    }

    let slab: Slab;
    if (Math.abs(this.mx - top.x) <= PERFECT_PX) {
      this.streak++;
      slab = { x: top.x, w: top.w };
      let grew = false;
      if (this.streak >= 3 && slab.w < BASE_W) {
        const nw = Math.min(BASE_W, slab.w + GROW_PX);
        slab.x -= (nw - slab.w) / 2;
        slab.w = nw;
        grew = true;
      }
      const bonus = Math.min(MAX_BONUS, this.streak);
      this.score += 1 + bonus;
      ev.push({ t: "perfect", sfx: "extraGood", mood: "happy", streak: this.streak, bonus, grew, x: slab.x + slab.w / 2, level, y });
    } else {
      this.streak = 0;
      slab = { x: left, w: right - left };
      // The overhanging part.
      const cutX = this.mx < top.x ? this.mx : right;
      const cutW = this.mw - slab.w;
      this.score += 1;
      ev.push({ t: "slice", sfx: "brick", x: cutX, w: cutW, level, side: this.mx < top.x ? -1 : 1, y });
    }
    this.slabs.push(slab);
    const h = this.height;
    if (h % MILESTONE === 0) {
      const lv = h / MILESTONE;
      ev.push({ t: "milestone", sfx: h === MOON_HEIGHT ? "won" : "levelclear", toast: "levelClear", mood: "happy", level: lv, name: milestoneName(lv) });
    }
    this.spawn();
  }

  view(): StackView {
    return {
      frame: this.frame,
      slabs: this.slabs,
      moving: this.dead ? null : { x: this.mx, w: this.mw, dir: this.dir, speed: speedFor(this.height) },
      height: this.height,
      streak: this.streak,
      score: this.score,
      dead: this.dead,
    };
  }
  hud(): Hud {
    return {
      score: this.score,
      level: Math.floor(this.height / MILESTONE) + 1,
      label: this.streak >= 2 ? `Perfect x${this.streak}` : `Height ${this.height}`,
    };
  }
  result(): GameResult {
    const lv = Math.floor(this.height / MILESTONE);
    return { score: this.score, level: lv, levelsCleared: lv, frames: this.frame, status: this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead;
  }
}

export const stack: GameDef<StackView> = {
  id: "stack",
  name: "Moon Stack",
  tagline: "Drop the slabs, trim the overhang, stack your way to the moon.",
  genre: "One-button stacker",
  session: "1–3 min",
  controls: "Tap, click or Space to drop the slab (Up/Down also drop).",
  field: { w: W, h: H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the one-button tower-stacking genre. No code or assets from any existing game; all art is drawn with the ArcadePad kit and the coin's theme.",
  },
  create: (seed) => new StackEngine(seed),
  bot(v, frame) {
    // Aim for the slab below plus a deliberate, height-dependent error so runs end.
    const m = v.moving;
    if (!m || frame < 30) return { x: 0, y: 0, b: 0 };
    const top = v.slabs[v.slabs.length - 1];
    const k = v.height + 1;
    const err = ((k * 7919 + 13) % 25) - 12; // -12..12 px, roughly 1 in 4 within the perfect window
    const target = top.x + err;
    const fire = Math.abs(m.x - target) <= m.speed / 2 + 0.01;
    return { x: 0, y: 0, b: fire ? BTN.FIRE : 0 };
  },
};
