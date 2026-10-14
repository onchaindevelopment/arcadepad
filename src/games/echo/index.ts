/*
 * Echo Pads: original "repeat the growing light and sound sequence" memory game.
 * ArcadePad, GPL-3.0-or-later. Original design, no code or assets ported.
 *
 * Coin pads sit around the mascot. The game lights a sequence of pads, each
 * with its own sound; the player repeats it by tapping the pads (or the
 * arrow keys: UP/RIGHT/DOWN/LEFT pads). Every success adds one step and the
 * playback gets faster. Each input has a timeout. One mistake ends the run,
 * except for a single second-chance heart handed out on reaching round 10.
 * From round 12 a 5th pad (Space) joins and the board re-forms, and from
 * round 18 a 6th pad (X). Score is the sum of the sequence lengths completed.
 *
 * Input: tap/click a pad (pointer; right click also taps). Keys: arrows are
 * the four diamond pads, Space the 5th pad, X/Shift the 6th pad. A Space/X
 * press counts as a key only after an arrow key was used since the pointer
 * last moved (taps also arrive as FIRE).
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;

export const INTRO = 60; // "READY" before the first round
export const WATCH = 36; // pause before each playback
export const WATCH_LAYOUT = 90; // longer pause when the board re-forms
export const GOOD = 40; // celebration after a cleared round
export const MISS = 80; // pause after a mistake that a heart saves
export const PRESS = 12; // frames a tapped pad stays lit
export const HEART_ROUND = 10; // reaching this round grants the second-chance heart
export const FIVE_ROUND = 12; // 5th pad from this round
export const SIX_ROUND = 18; // 6th pad from this round
export const WIN_LEN = 40; // clearing a sequence this long wins the run

/** Playback timing for a round (frames). */
export const litFrames = (round: number) => Math.max(10, 32 - 2 * round);
export const gapFrames = (round: number) => Math.max(5, 14 - (round >> 1));
/** Time allowed for each input (frames). */
export const inputTimeout = (round: number) => Math.max(90, 180 - 5 * round);

/** Button for each pad index. */
export const PAD_BTN = [BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT, BTN.FIRE, BTN.ALT] as const;
/** Sound for each pad: all different. */
export const PAD_SFX = ["paddle", "brick", "shot", "wall", "launch", "brickgone"] as const;

export interface Pad {
  x: number;
  y: number;
  /** Coins are circles (r = w / 2); pills are rounded bars. */
  kind: "coin" | "pill";
  w: number;
  h: number;
}

/** Field point of the mascot (centre of the pad ring) per layout. */
export const CENTER = [
  { x: 180, y: 312 },
  { x: 180, y: 272 },
  { x: 180, y: 272 },
] as const;

/** Layout 0: diamond of 4 coins. 1: smaller diamond + Space bar. 2: + X bar. */
export const LAYOUTS: readonly (readonly Pad[])[] = [
  [
    { x: 180, y: 192, kind: "coin", w: 112, h: 112 },
    { x: 298, y: 312, kind: "coin", w: 112, h: 112 },
    { x: 180, y: 432, kind: "coin", w: 112, h: 112 },
    { x: 62, y: 312, kind: "coin", w: 112, h: 112 },
  ],
  [
    { x: 180, y: 168, kind: "coin", w: 96, h: 96 },
    { x: 284, y: 272, kind: "coin", w: 96, h: 96 },
    { x: 180, y: 376, kind: "coin", w: 96, h: 96 },
    { x: 76, y: 272, kind: "coin", w: 96, h: 96 },
    { x: 180, y: 488, kind: "pill", w: 232, h: 70 },
  ],
  [
    { x: 180, y: 168, kind: "coin", w: 96, h: 96 },
    { x: 284, y: 272, kind: "coin", w: 96, h: 96 },
    { x: 180, y: 376, kind: "coin", w: 96, h: 96 },
    { x: 76, y: 272, kind: "coin", w: 96, h: 96 },
    { x: 96, y: 488, kind: "pill", w: 156, h: 70 },
    { x: 264, y: 488, kind: "pill", w: 156, h: 70 },
  ],
];

export const layoutFor = (round: number) => (round >= SIX_ROUND ? 2 : round >= FIVE_ROUND ? 1 : 0);

/** Pad under (or right next to) a field point, or -1. */
export function padAt(layout: number, x: number, y: number): number {
  const pads = LAYOUTS[layout];
  let best = -1;
  let bestD = 14; // tolerance outside the pad edge
  for (let i = 0; i < pads.length; i++) {
    const p = pads[i];
    let d: number;
    if (p.kind === "coin") {
      const dx = x - p.x;
      const dy = y - p.y;
      d = Math.sqrt(dx * dx + dy * dy) - p.w / 2;
    } else {
      const dx = Math.max(0, Math.abs(x - p.x) - p.w / 2);
      const dy = Math.max(0, Math.abs(y - p.y) - p.h / 2);
      d = Math.sqrt(dx * dx + dy * dy);
    }
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

export type Phase = "intro" | "watch" | "show" | "input" | "good" | "miss" | "over" | "won";

export interface EchoView {
  frame: number;
  phase: Phase;
  /** Frames since the phase started. */
  phaseT: number;
  /** Frames the current phase lasts (0 = open-ended). */
  phaseLen: number;
  round: number; // 1-based, equals the sequence length
  seq: readonly number[];
  /** Playback: step being shown (-1 before the first). Input: steps entered. */
  idx: number;
  layout: number;
  pads: readonly Pad[];
  center: { x: number; y: number };
  /** Pad lit by playback (-1 none) and frames into that flash. */
  lit: number;
  litT: number;
  litLen: number;
  /** Last pad pressed by the player: pad, frames since, right or wrong. */
  press: { pad: number; t: number; ok: boolean };
  /** Input clock. */
  timeLeft: number;
  timeMax: number;
  hearts: number;
  heartGiven: boolean;
  score: number;
  best: number; // longest sequence cleared
  ptr: { x: number; y: number };
  ptrMode: boolean;
  /** Why the last mistake happened. */
  missWhy: "wrong" | "timeout" | "";
  /** Frames since an input was accepted (or the input phase began). */
  sinceInput: number;
}

class EchoEngine implements GameEngine<EchoView> {
  private rng: Rng;
  private seq: number[] = [];
  private phase: Phase = "intro";
  private phaseT = 0;
  private phaseLen = INTRO;
  private idx = 0;
  private timeLeft = 0;
  private hearts = 0;
  private heartGiven = false;
  private score = 0;
  private best = 0;
  private layout = 0;
  private press = { pad: -1, t: 999, ok: true };
  private missWhy: EchoView["missWhy"] = "";
  private sinceInput = 0;
  private px = W / 2;
  private py = H / 2;
  private ptrSeen = false;
  private ptrMode = true;
  private prevB = 0;
  private overAtCap = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.addStep();
  }

  private get round() {
    return this.seq.length;
  }
  private get nPads() {
    return LAYOUTS[this.layout].length;
  }

  private addStep() {
    const len = this.seq.length;
    const n = LAYOUTS[layoutFor(len + 1)].length;
    let p: number;
    if (len > 0 && layoutFor(len + 1) !== layoutFor(len)) {
      p = n - 1; // first step after the board grows uses the new pad
    } else {
      p = this.rng.int(n);
      // No three of the same pad in a row.
      if (len >= 2 && this.seq[len - 1] === p && this.seq[len - 2] === p) p = (p + 1 + this.rng.int(n - 1)) % n;
    }
    this.seq.push(p);
  }

  private setPhase(ph: Phase, len: number) {
    this.phase = ph;
    this.phaseT = 0;
    this.phaseLen = len;
  }

  private stepLen() {
    return litFrames(this.round) + gapFrames(this.round);
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over" || this.phase === "won") {
      this.phaseT++;
      return;
    }
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    if (!this.ptrSeen) {
      this.ptrSeen = true;
      this.px = inp.x;
      this.py = inp.y;
    } else if (inp.x !== this.px || inp.y !== this.py) {
      this.px = inp.x;
      this.py = inp.y;
      this.ptrMode = true;
    }
    if (pressed & (BTN.UP | BTN.RIGHT | BTN.DOWN | BTN.LEFT)) this.ptrMode = false;
    this.press.t++;
    this.sinceInput++;
    this.phaseT++;

    switch (this.phase) {
      case "intro":
        if (this.phaseT >= this.phaseLen) {
          this.events.push({ t: "go", sfx: "launch" });
          this.setPhase("watch", WATCH);
        }
        break;
      case "watch":
        if (this.phaseT >= this.phaseLen) {
          this.setPhase("show", this.round * this.stepLen());
          this.idx = -1;
          this.showTick();
        }
        break;
      case "show":
        this.showTick();
        break;
      case "input":
        this.handleInput(pressed);
        if (this.phase === "input" && --this.timeLeft <= 0) {
          this.timeLeft = 0;
          this.mistake("timeout", -1);
        }
        break;
      case "good":
        if (this.phaseT >= this.phaseLen) this.nextRound();
        break;
      case "miss":
        if (this.phaseT >= this.phaseLen) this.setPhase("watch", WATCH);
        break;
    }
    if (this.frame >= echo.maxFrames && !this.done) {
      this.overAtCap = true;
      this.setPhase("over", 0);
      this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
    }
  }

  private showTick() {
    const sl = this.stepLen();
    const t = this.phaseT;
    const i = Math.floor(t / sl);
    if (i >= this.round) {
      this.idx = 0;
      this.timeLeft = inputTimeout(this.round);
      this.sinceInput = 0;
      this.setPhase("input", 0);
      this.events.push({ t: "yourTurn" });
      return;
    }
    if (i !== this.idx) {
      this.idx = i;
      const p = this.seq[i];
      const pad = LAYOUTS[this.layout][p];
      this.events.push({ t: "flash", pad: p, sfx: PAD_SFX[p], x: pad.x, y: pad.y });
    }
  }

  private handleInput(pressed: number) {
    const taps: number[] = [];
    for (let p = 0; p < 4; p++) if (pressed & PAD_BTN[p]) taps.push(p);
    const ptrTap = pressed & (BTN.FIRE | BTN.ALT);
    if (ptrTap) {
      if (this.ptrMode) {
        const p = padAt(this.layout, this.px, this.py);
        if (p >= 0) taps.push(p);
      } else {
        if (pressed & BTN.FIRE && this.nPads >= 5) taps.push(4);
        if (pressed & BTN.ALT && this.nPads >= 6) taps.push(5);
      }
    }
    for (const p of taps) {
      if (this.phase !== "input") return;
      this.tap(p);
    }
  }

  private tap(p: number) {
    const pad = LAYOUTS[this.layout][p];
    if (p !== this.seq[this.idx]) {
      this.press = { pad: p, t: 0, ok: false };
      this.mistake("wrong", p);
      return;
    }
    this.press = { pad: p, t: 0, ok: true };
    this.idx++;
    this.sinceInput = 0;
    this.timeLeft = inputTimeout(this.round);
    this.events.push({ t: "tap", pad: p, ok: true, sfx: PAD_SFX[p], x: pad.x, y: pad.y, step: this.idx });
    if (this.idx >= this.round) {
      this.score += this.round;
      this.best = this.round;
      const c = CENTER[this.layout];
      if (this.round >= WIN_LEN) {
        this.setPhase("won", 0);
        this.events.push({ t: "won", sfx: "won", mood: "happy", value: this.round, x: c.x, y: c.y });
        return;
      }
      const milestone = this.round % 5 === 0;
      this.events.push({
        t: "clear", value: this.round, sfx: "levelclear", mood: "happy",
        toast: milestone ? "levelClear" : undefined, x: c.x, y: c.y,
      });
      this.setPhase("good", GOOD);
    }
  }

  private mistake(why: "wrong" | "timeout", p: number) {
    this.missWhy = why;
    const pad = p >= 0 ? LAYOUTS[this.layout][p] : CENTER[this.layout];
    const want = this.seq[this.idx];
    if (this.hearts > 0) {
      this.hearts--;
      this.idx = 0;
      this.events.push({ t: "miss", why, pad: p, want, saved: true, sfx: "extraBad", mood: "sad", toast: "lifeLost", shake: 8, x: pad.x, y: pad.y });
      this.setPhase("miss", MISS);
      return;
    }
    this.events.push({ t: "miss", why, pad: p, want, saved: false, sfx: "lost", mood: "sad", shake: 12, x: pad.x, y: pad.y });
    this.events.push({ t: "gameover", sfx: "gameover" });
    this.setPhase("over", 0);
  }

  private nextRound() {
    const before = this.layout;
    this.addStep();
    this.layout = layoutFor(this.round);
    let wait = WATCH;
    if (this.layout !== before) {
      wait = WATCH_LAYOUT;
      this.events.push({ t: "layout", layout: this.layout, pads: this.nPads, sfx: "extraGood", shake: 6 });
    }
    if (this.round === HEART_ROUND && !this.heartGiven) {
      this.heartGiven = true;
      this.hearts = 1;
      const c = CENTER[this.layout];
      this.events.push({ t: "heart", sfx: "extraGood", mood: "happy", x: c.x, y: c.y });
    }
    this.idx = 0;
    this.setPhase("watch", wait);
  }

  view(): EchoView {
    const showing = this.phase === "show";
    const sl = this.stepLen();
    const litT = showing ? this.phaseT - this.idx * sl : 0;
    const lit = showing && this.idx >= 0 && litT < litFrames(this.round) ? this.seq[this.idx] : -1;
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      phaseLen: this.phaseLen,
      round: this.round,
      seq: this.seq.slice(),
      idx: this.idx,
      layout: this.layout,
      pads: LAYOUTS[this.layout],
      center: CENTER[this.layout],
      lit,
      litT,
      litLen: litFrames(this.round),
      press: { ...this.press },
      timeLeft: this.timeLeft,
      timeMax: inputTimeout(this.round),
      hearts: this.hearts,
      heartGiven: this.heartGiven,
      score: this.score,
      best: this.best,
      ptr: { x: this.px, y: this.py },
      ptrMode: this.ptrMode,
      missWhy: this.missWhy,
      sinceInput: this.sinceInput,
    };
  }
  hud(): Hud {
    const h: Hud = { score: this.score, level: this.round, label: `Length ${this.round}` };
    if (this.heartGiven) h.lives = this.hearts;
    return h;
  }
  result(): GameResult {
    return {
      score: this.score,
      level: this.round - 1,
      levelsCleared: this.best,
      frames: this.frame,
      status: this.phase === "won" ? "won" : this.phase === "over" ? "over" : "playing",
    };
  }
  get done() {
    return this.phase === "over" || this.phase === "won" || this.overAtCap;
  }
}

/** Small deterministic hash for the bot's "human" slips. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2d);
  return (h ^ (h >>> 13)) >>> 0;
}

export const echo: GameDef<EchoView> = {
  id: "echo",
  name: "Echo Pads",
  tagline: "Watch the pads light up, then play it back. One more step every round.",
  genre: "Memory sequence",
  session: "1–5 min",
  controls: "Tap or click the pads in the order they lit. Keys: arrows for the four pads, later Space and X for the new ones.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the sequence-memory genre. No code, art, sounds, names or console look from any existing game; pads, mascot and effects are drawn with the ArcadePad kit.",
  },
  create: (seed) => new EchoEngine(seed),
  bot(v) {
    // Taps pads with the pointer like a player would. Memory gets shakier as
    // the sequence grows, so the run ends somewhere in the teens.
    const rest = { x: v.ptr.x, y: v.ptr.y, b: 0 };
    if (v.phase !== "input" || v.idx >= v.seq.length) return rest;
    let p = v.seq[v.idx];
    let mix = v.hearts * 7;
    for (let i = 0; i < v.seq.length; i++) mix = Math.imul(mix ^ v.seq[i], 31) + i;
    const slip = hash(v.round * 977 + v.idx, mix) % 1000;
    const chance = v.round <= 5 ? 0 : (v.round - 5) * 7; // per-step slip chance in 1/1000
    if (slip < chance) p = (p + 1 + (slip % (v.pads.length - 1))) % v.pads.length;
    const pad = v.pads[p];
    const wait = 14 + (hash(v.idx, v.round) % 10);
    const jitterX = (hash(v.idx * 7, v.round) % 21) - 10;
    const jitterY = (hash(v.idx * 13, v.round) % 21) - 10;
    const b = v.sinceInput >= wait && v.sinceInput < wait + 5 ? BTN.FIRE : 0;
    return { x: pad.x + jitterX, y: pad.y + jitterY, b };
  },
};
