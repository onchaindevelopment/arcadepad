/*
 * Whack the FUD: original whack-a-mole style tapper.
 * ArcadePad, GPL-3.0-or-later. Original design, no code or assets ported.
 *
 * A 3x4 grid of holes. FUD critters (bear, paper-hands ghost, rug) pop up
 * for a short time; whack them for points. The coin mascot pops up too:
 * leave it alone (whacking it costs points and a heart). Golden coins pay a
 * bonus and heal, bombs whack every FUD on the board, ice freezes the clock
 * and every critter for a moment. Pop-ups get faster and busier; the run is
 * a 60 second clock with 3 hearts. Consecutive hits build a combo
 * multiplier; whacking an empty hole or letting FUD escape breaks it.
 *
 * Input: tap/click a hole (pointer), or arrows move a hammer cursor and
 * FIRE whacks the cursor hole.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const COLS = 3;
export const ROWS = 4;
export const CELL_W = 120;
export const CELL_H = 100;
/** Top edge of the hole grid. */
export const GRID_Y = 150;
/** Hole centre (the rim line critters rise out of). */
export const holeX = (i: number) => (i % COLS) * CELL_W + CELL_W / 2;
export const holeY = (i: number) => GRID_Y + Math.floor(i / COLS) * CELL_H + 62;

export const INTRO = 60; // "READY" frames before the clock starts
export const RUN = 60 * 60; // 60 seconds of clock
export const HEARTS = 3;
export const RISE = 8; // frames to pop up / sink
export const HIT_ANIM = 24; // squash frames before the hole empties
export const FREEZE = 150;
const COOLDOWN = 10; // empty frames before a hole is reused
export const STAGE = 15 * 60; // a "level" every 15 s of clock

export type Kind = "bear" | "ghost" | "rug" | "friend" | "gold" | "bomb" | "ice";
export const KINDS: readonly Kind[] = ["bear", "ghost", "rug", "friend", "gold", "bomb", "ice"];
/** Base points per kind (friend: penalty when whacked). */
export const POINTS: Record<Kind, number> = { bear: 10, ghost: 15, rug: 20, friend: -30, gold: 50, bomb: 5, ice: 10 };
/** Up-time multiplier, in 1/16ths of the base stay. */
const STAY16: Record<Kind, number> = { bear: 16, ghost: 13, rug: 10, friend: 17, gold: 9, bomb: 14, ice: 12 };
export const FRIEND_SAFE = 5;
export const isFud = (k: Kind) => k === "bear" || k === "ghost" || k === "rug";

export interface HoleView {
  kind: Kind | null;
  id: number;
  /** Frames since it spawned (paused while frozen). */
  age: number;
  /** Total up-time in frames (rise + hold + sink). */
  life: number;
  /** 0..1 how far out of the hole. */
  rise: number;
  /** Frames since it was whacked, -1 if not whacked. */
  hitT: number;
  hittable: boolean;
}

export interface WhackView {
  frame: number;
  phase: "intro" | "play" | "over";
  /** Frames into the intro or since the run ended. */
  phaseT: number;
  timeLeft: number; // clock frames
  hearts: number;
  score: number;
  combo: number;
  mult: number;
  stage: number; // 0-based
  freeze: number; // frames of freeze left
  holes: HoleView[];
  cursor: number;
  /** Pointer (last known) and whether the pointer drives the hammer. */
  ptr: { x: number; y: number };
  ptrMode: boolean;
  /** Last swing: hole (-1 = outside the grid), position and frames since. */
  swing: { hole: number; x: number; y: number; t: number };
  fireHeld: boolean;
  outOfHearts: boolean;
}

interface Hole {
  kind: Kind | null;
  id: number;
  age: number;
  life: number;
  hitT: number;
  cool: number;
}

/** Hole under a field point, or -1. */
export function holeAt(x: number, y: number): number {
  if (x < 0 || x >= W || y < GRID_Y || y >= GRID_Y + ROWS * CELL_H) return -1;
  return Math.floor((y - GRID_Y) / CELL_H) * COLS + Math.floor(x / CELL_W);
}

function riseOf(h: Hole): number {
  if (!h.kind) return 0;
  if (h.hitT >= 0) return 1;
  if (h.age < RISE) return h.age / RISE;
  if (h.age > h.life - RISE) return Math.max(0, (h.life - h.age) / RISE);
  return 1;
}

class WhackEngine implements GameEngine<WhackView> {
  private rng: Rng;
  private holes: Hole[] = [];
  private phase: WhackView["phase"] = "intro";
  private phaseT = 0;
  private timeLeft = RUN;
  private hearts = HEARTS;
  private score = 0;
  private combo = 0;
  private freeze = 0;
  private spawnIn = 20;
  private nextId = 1;
  private cursor = 4;
  private px = 0;
  private py = 0;
  private ptrSeen = false;
  private ptrMode = false;
  private prevB = 0;
  private swing = { hole: -1, x: holeX(4), y: holeY(4), t: 999 };
  private outOfHearts = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    for (let i = 0; i < COLS * ROWS; i++) this.holes.push({ kind: null, id: 0, age: 0, life: 0, hitT: -1, cool: 0 });
  }

  private get elapsed() {
    return RUN - this.timeLeft;
  }
  private get stage() {
    return Math.min(3, Math.floor(this.elapsed / STAGE));
  }
  private get mult() {
    return Math.min(5, 1 + Math.floor(this.combo / 5));
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") {
      this.phaseT++;
      return;
    }
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    // Pointer vs keyboard cursor.
    if (!this.ptrSeen) {
      this.ptrSeen = true;
      this.px = inp.x;
      this.py = inp.y;
    } else if (inp.x !== this.px || inp.y !== this.py) {
      this.px = inp.x;
      this.py = inp.y;
      this.ptrMode = true;
      const h = holeAt(inp.x, inp.y);
      if (h >= 0) this.cursor = h;
    }
    const arrows = pressed & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
    if (arrows) {
      this.ptrMode = false;
      let c = this.cursor % COLS;
      let r = Math.floor(this.cursor / COLS);
      if (arrows & BTN.LEFT) c = Math.max(0, c - 1);
      if (arrows & BTN.RIGHT) c = Math.min(COLS - 1, c + 1);
      if (arrows & BTN.UP) r = Math.max(0, r - 1);
      if (arrows & BTN.DOWN) r = Math.min(ROWS - 1, r + 1);
      this.cursor = r * COLS + c;
    }
    this.swing.t++;

    if (this.phase === "intro") {
      if (++this.phaseT >= INTRO) {
        this.phase = "play";
        this.phaseT = 0;
        this.events.push({ t: "go", sfx: "launch" });
      }
      return;
    }

    if (pressed & BTN.FIRE) this.whack();
    if (this.phase !== "play") return;

    // Holes: age, escape, finish squash.
    const frozen = this.freeze > 0;
    for (let i = 0; i < this.holes.length; i++) {
      const h = this.holes[i];
      if (!h.kind) {
        if (h.cool > 0) h.cool--;
        continue;
      }
      if (h.hitT >= 0) {
        if (++h.hitT >= HIT_ANIM) this.clear(h);
        continue;
      }
      if (frozen) continue;
      if (++h.age >= h.life) {
        const k = h.kind;
        if (isFud(k)) {
          const broke = this.combo > 0;
          this.combo = 0;
          this.events.push({ t: "escape", kind: k, broke, x: holeX(i), y: holeY(i) });
        } else if (k === "friend") {
          this.score += FRIEND_SAFE;
          this.events.push({ t: "safe", kind: k, value: FRIEND_SAFE, x: holeX(i), y: holeY(i) - 40 });
        }
        this.clear(h);
      }
    }

    if (frozen) {
      if (--this.freeze === 0) this.events.push({ t: "thaw" });
      return;
    }

    // Clock.
    const stageBefore = this.stage;
    this.timeLeft--;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.end(false);
      return;
    }
    if (this.stage > stageBefore) this.events.push({ t: "stage", stage: this.stage, sfx: "levelclear" });

    if (--this.spawnIn <= 0) this.spawn();
  }

  private clear(h: Hole) {
    h.kind = null;
    h.hitT = -1;
    h.age = 0;
    h.cool = COOLDOWN;
  }

  private spawn() {
    const d = this.elapsed; // 0..RUN
    const every = 46 - Math.floor((26 * d) / RUN); // 46 -> 20 frames
    this.spawnIn = every + this.rng.int(Math.max(1, every >> 1)) - (every >> 2);
    const maxUp = Math.min(5, 2 + Math.floor((4 * d) / RUN));
    let up = 0;
    for (const h of this.holes) if (h.kind && h.hitT < 0) up++;
    if (up >= maxUp) return;
    const free: number[] = [];
    for (let i = 0; i < this.holes.length; i++) if (!this.holes[i].kind && this.holes[i].cool === 0) free.push(i);
    if (!free.length) return;
    const i = free[this.rng.int(free.length)];
    const k = this.pickKind(d);
    const base = 86 - Math.floor((44 * d) / RUN); // 86 -> 42 frames
    const h = this.holes[i];
    h.kind = k;
    h.id = this.nextId++;
    h.age = 0;
    h.hitT = -1;
    h.life = Math.max(2 * RISE + 8, Math.floor((base * STAY16[k]) / 16) + this.rng.int(12));
    this.events.push({ t: "pop", kind: k, hole: i, x: holeX(i), y: holeY(i) });
  }

  private pickKind(d: number): Kind {
    const w: [Kind, number][] = [
      ["bear", 40],
      ["ghost", d >= 5 * 60 ? 26 : 0],
      ["rug", d >= 12 * 60 ? 18 : 0],
      ["friend", d >= 3 * 60 ? 14 : 0],
      ["gold", 4],
      ["bomb", d >= 15 * 60 ? 3 : 0],
      ["ice", d >= 20 * 60 && this.freeze === 0 ? 2 : 0],
    ];
    let total = 0;
    for (const [, n] of w) total += n;
    let r = this.rng.int(total);
    for (const [k, n] of w) {
      if (r < n) return k;
      r -= n;
    }
    return "bear";
  }

  private whack() {
    const target = this.ptrMode ? holeAt(this.px, this.py) : this.cursor;
    const x = target >= 0 ? holeX(target) : this.px;
    const y = target >= 0 ? holeY(target) : this.py;
    this.swing = { hole: target, x, y, t: 0 };
    if (target < 0) return; // swing at the scenery: no penalty
    const h = this.holes[target];
    if (!h.kind || h.hitT >= 0 || riseOf(h) <= 0) {
      const broke = this.combo > 0;
      this.combo = 0;
      this.events.push({ t: "whiff", sfx: "wall", broke, x, y });
      return;
    }
    const k = h.kind;
    if (k === "friend") {
      h.hitT = 0;
      this.combo = 0;
      this.score = Math.max(0, this.score + POINTS.friend);
      this.hearts--;
      this.events.push({ t: "ouch", kind: k, value: POINTS.friend, sfx: "extraBad", mood: "sad", toast: "lifeLost", shake: 10, x, y });
      if (this.hearts <= 0) this.end(true);
      return;
    }
    this.hitHole(target, false);
    if (k === "gold") {
      if (this.hearts < HEARTS) {
        this.hearts++;
        this.events.push({ t: "heal", x, y: y - 50 });
      }
    } else if (k === "bomb") {
      this.events.push({ t: "boom", sfx: "explode", shake: 8, x, y });
      for (let i = 0; i < this.holes.length; i++) {
        const o = this.holes[i];
        if (i !== target && o.kind && isFud(o.kind) && o.hitT < 0 && riseOf(o) > 0) this.hitHole(i, true);
      }
    } else if (k === "ice") {
      this.freeze = FREEZE;
      this.events.push({ t: "freeze", sfx: "extraGood", x, y });
    }
  }

  private hitHole(i: number, byBomb: boolean) {
    const h = this.holes[i];
    const k = h.kind!;
    h.hitT = 0;
    this.combo++;
    const mult = this.mult;
    const value = POINTS[k] * mult;
    this.score += value;
    const sfx = k === "gold" ? "extraGood" : byBomb ? undefined : this.combo % 5 === 0 ? "brickgone" : "brick";
    this.events.push({
      t: "hit", kind: k, value, mult, combo: this.combo, byBomb, sfx,
      mood: k === "gold" || (this.combo >= 10 && this.combo % 10 === 0) ? "happy" : undefined,
      shake: byBomb ? undefined : 3,
      x: holeX(i), y: holeY(i),
    });
  }

  private end(outOfHearts: boolean) {
    this.phase = "over";
    this.phaseT = 0;
    this.outOfHearts = outOfHearts;
    if (outOfHearts) this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
    else this.events.push({ t: "timeup", sfx: "won", mood: "happy" });
  }

  view(): WhackView {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      timeLeft: this.timeLeft,
      hearts: this.hearts,
      score: this.score,
      combo: this.combo,
      mult: this.mult,
      stage: this.stage,
      freeze: this.freeze,
      holes: this.holes.map((h) => ({
        kind: h.kind,
        id: h.id,
        age: h.age,
        life: h.life,
        rise: riseOf(h),
        hitT: h.hitT,
        hittable: !!h.kind && h.hitT < 0 && riseOf(h) > 0,
      })),
      cursor: this.cursor,
      ptr: { x: this.px, y: this.py },
      ptrMode: this.ptrMode,
      swing: { ...this.swing },
      fireHeld: (this.prevB & BTN.FIRE) !== 0,
      outOfHearts: this.outOfHearts,
    };
  }
  hud(): Hud {
    const secs = Math.ceil(this.timeLeft / 60);
    return { score: this.score, lives: this.hearts, level: this.stage + 1, label: this.combo >= 5 ? `x${this.mult} combo · ${secs}s` : `${secs}s` };
  }
  result(): GameResult {
    return {
      score: this.score,
      level: this.stage,
      levelsCleared: Math.floor(this.elapsed / STAGE),
      frames: this.frame,
      status: this.phase === "over" ? "over" : "playing",
    };
  }
  get done() {
    return this.phase === "over";
  }
}

/** Small deterministic hash for the bot's "human" mistakes. */
function hash(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b1, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x27d4eb2d);
  return (h ^ (h >>> 13)) >>> 0;
}

export const whack: GameDef<WhackView> = {
  id: "whack",
  name: "Whack the FUD",
  tagline: "Bonk the bears, paper hands and rugs. Never bonk the mascot.",
  genre: "Whack-a-mole",
  session: "1 min",
  controls: "Tap or click a hole to whack. Keys: arrows move the hammer, Space whacks.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 3 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the whack-a-mole genre. No code, art, sounds or names from any existing game; all critters are drawn with the ArcadePad kit.",
  },
  create: (seed) => new WhackEngine(seed),
  bot(v, frame) {
    const rest = { x: v.ptr.x, y: v.ptr.y, b: 0 };
    if (v.phase !== "play" || v.fireHeld) return rest;
    let best = -1;
    let bestLeft = 1e9;
    for (let i = 0; i < v.holes.length; i++) {
      const h = v.holes[i];
      if (!h.hittable || !h.kind) continue;
      const roll = hash(h.id, 77) % 100;
      if (h.kind === "friend" && roll >= 5) continue; // ~5% of mascots get bonked by mistake
      if (h.kind !== "friend" && roll < 12) continue; // ~12% of critters missed
      const react = 9 + (hash(h.id, 3) % 16); // reaction time
      if (h.age < react) continue;
      const left = h.life - h.age;
      if (left < bestLeft) {
        bestLeft = left;
        best = i;
      }
    }
    if (best < 0) {
      // Rare stray whack at an empty hole (breaks combos).
      if (hash(frame, 991) % 900 === 0) {
        const i = hash(frame, 5) % (COLS * ROWS);
        return { x: holeX(i), y: holeY(i), b: BTN.FIRE };
      }
      return rest;
    }
    return { x: holeX(best), y: holeY(best) - 10, b: BTN.FIRE };
  },
};
