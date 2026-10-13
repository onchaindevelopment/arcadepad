/*
 * Coin Slash: an original swipe-to-slice arcade game.
 * ArcadePad, GPL-3.0-or-later. No code, art or sound from any existing game.
 *
 * Coins, candles and gems are tossed up from the bottom in arcs; hold the
 * button (or touch) and drag to slice them. The blade is the segment from
 * the cursor position of the previous frame to the current one, while FIRE is
 * held on both frames. Several slices in one quick stroke make a combo.
 * Letting a non-bomb fall back off the bottom costs one of 3 lives; slicing a
 * rug bomb ends the run. A rare clock coin slows everything down for a while.
 * Waves get bigger, faster and bomb-heavier.
 *
 * Deterministic: spawns from Rng, physics with + - * / and Math.sqrt only.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 600;
export const H = 400;
export const LIVES = 3;
const KEY_SPEED = 9; // keyboard cursor px/frame
const MIN_BLADE2 = 4; // a blade must move at least 2 px in a frame to cut
const COMBO_WINDOW = 10; // frames between slices that still count as one stroke
const SLOW_FRAMES = 300;
const FIRST_WAVE_AT = 60;
const WAVE_GAP = 40;

export type ObjKind = "coin" | "candle" | "gem" | "bomb" | "slow";

const KINDS: Record<ObjKind, { r: number; pts: number }> = {
  coin: { r: 17, pts: 10 },
  candle: { r: 15, pts: 15 },
  gem: { r: 13, pts: 30 },
  bomb: { r: 17, pts: 0 },
  slow: { r: 15, pts: 20 },
};

export interface SliceObj {
  id: number;
  kind: ObjKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** Palette index (bricks) for coins/gems; 0 = green / 1 = red for candles. */
  color: number;
  /** Spin direction/speed for the renderer, -4..4. */
  spin: number;
}

export interface SliceView {
  frame: number;
  objects: SliceObj[];
  /** Blade cursor; `on` while FIRE is held; px/py = previous cursor. */
  blade: { x: number; y: number; px: number; py: number; on: boolean };
  lives: number;
  score: number;
  wave: number;
  /** Frames of slow-mo left. */
  slow: number;
  /** Slices in the current stroke. */
  combo: number;
  over: boolean;
}

interface Pending {
  at: number; // frame
  kind: ObjKind;
}

export interface SliceOptions {
  /** Tests only: disable wave spawning so objects can be injected by hand. */
  noSpawn?: boolean;
}

/** Closest-point test: does segment (ax,ay)-(bx,by) come within r of (cx,cy)? */
export function segHitsCircle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, r: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - ax) * dx + (cy - ay) * dy) / len2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  const qx = ax + dx * t - cx;
  const qy = ay + dy * t - cy;
  return qx * qx + qy * qy <= r * r;
}

export class SliceEngine implements GameEngine<SliceView> {
  private rng: Rng;
  private opts: SliceOptions;
  private objs: SliceObj[] = [];
  private nextId = 1;
  private queue: Pending[] = [];
  private nextWaveAt = FIRST_WAVE_AT;
  private wave = 0;
  private wavesCleared = 0;
  private lives = LIVES;
  private score = 0;
  private slow = 0;
  private cx = W / 2;
  private cy = H / 2;
  private pcx = W / 2;
  private pcy = H / 2;
  private lastPx = -1;
  private lastPy = -1;
  private prevB = 0;
  private stroke = 0;
  private strokeTimer = 0;
  private strokeX = 0;
  private strokeY = 0;
  private over = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, opts: SliceOptions = {}) {
    this.rng = new Rng(seed);
    this.opts = opts;
  }

  private gravity() {
    return 0.1 + Math.min(this.wave, 20) * 0.004;
  }

  /** Tests and tools: put an object on the field directly. */
  inject(kind: ObjKind, x: number, y: number, vx = 0, vy = 0): SliceObj {
    const o: SliceObj = { id: this.nextId++, kind, x, y, vx, vy, r: KINDS[kind].r, color: 0, spin: 1 };
    this.objs.push(o);
    return o;
  }

  private startWave() {
    this.wave++;
    const w = this.wave;
    const count = Math.min(10, 2 + w);
    const bombPct = w < 2 ? 0 : Math.min(12 + 2 * w, 30);
    const volley = this.rng.int(3) === 0;
    const gap = Math.max(8, 30 - 2 * w);
    let at = this.frame + 1;
    let safe = 0;
    for (let i = 0; i < count; i++) {
      let kind: ObjKind;
      const roll = this.rng.int(100);
      if (roll < bombPct && (safe > 0 || i < count - 1)) kind = "bomb";
      else {
        const k = this.rng.int(10);
        kind = k < 5 ? "coin" : k < 8 ? "candle" : "gem";
        safe++;
      }
      this.queue.push({ at, kind });
      at += volley ? this.rng.int(6) : gap + this.rng.int(gap);
    }
    if (w >= 3 && this.slow === 0 && this.rng.int(10) === 0) this.queue.push({ at: at + gap, kind: "slow" });
    this.events.push({ t: "wave", n: w });
  }

  private toss(kind: ObjKind, first: boolean) {
    const g = this.gravity();
    const r = KINDS[kind].r;
    const x = 60 + this.rng.int(W - 120);
    const y = H + r;
    const peak = 50 + this.rng.int(170); // top of the arc, field y
    const vy = -Math.sqrt(2 * g * (y - peak));
    const flight = (-2 * vy) / g; // frames until back at y
    const tx = 140 + this.rng.int(W - 280);
    const vx = (tx - x) / flight;
    const color = kind === "candle" ? this.rng.int(2) : this.rng.int(6);
    const spin = this.rng.int(9) - 4;
    this.objs.push({ id: this.nextId++, kind, x, y, vx, vy, r, color, spin });
    this.events.push({ t: "toss", kind, x, y, sfx: first ? "launch" : undefined });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;

    // Cursor: arrows move it; otherwise it follows the pointer when the pointer moves.
    this.pcx = this.cx;
    this.pcy = this.cy;
    const arrows = inp.b & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN);
    if (arrows) {
      if (inp.b & BTN.LEFT) this.cx -= KEY_SPEED;
      if (inp.b & BTN.RIGHT) this.cx += KEY_SPEED;
      if (inp.b & BTN.UP) this.cy -= KEY_SPEED;
      if (inp.b & BTN.DOWN) this.cy += KEY_SPEED;
      this.cx = Math.max(0, Math.min(W - 1, this.cx));
      this.cy = Math.max(0, Math.min(H - 1, this.cy));
    } else if (inp.x !== this.lastPx || inp.y !== this.lastPy) {
      this.cx = inp.x;
      this.cy = inp.y;
    }
    this.lastPx = inp.x;
    this.lastPy = inp.y;
    const fire = (inp.b & BTN.FIRE) !== 0;
    const bladeLive = fire && (this.prevB & BTN.FIRE) !== 0;
    this.prevB = inp.b;

    // Spawning
    if (!this.opts.noSpawn) {
      if (this.queue.length === 0 && this.objs.length === 0 && this.frame >= this.nextWaveAt) {
        if (this.wave > 0) this.wavesCleared++;
        this.startWave();
      }
      let first = true;
      while (this.queue.length && this.queue[0].at <= this.frame) {
        this.toss(this.queue.shift()!.kind, first);
        first = false;
      }
    }

    // Physics
    const s = this.slow > 0 ? 0.5 : 1;
    if (this.slow > 0) this.slow--;
    const g = this.gravity();
    for (const o of this.objs) {
      o.vy += g * s;
      o.x += o.vx * s;
      o.y += o.vy * s;
    }

    // Blade
    if (bladeLive) {
      const dx = this.cx - this.pcx;
      const dy = this.cy - this.pcy;
      if (dx * dx + dy * dy >= MIN_BLADE2) {
        const keep: SliceObj[] = [];
        for (const o of this.objs) {
          if (!segHitsCircle(this.pcx, this.pcy, this.cx, this.cy, o.x, o.y, o.r)) {
            keep.push(o);
            continue;
          }
          if (o.kind === "bomb") {
            this.events.push({ t: "bomb", sfx: "explode", shake: 14, x: o.x, y: o.y, id: o.id });
            this.objs = this.objs.filter((q) => q !== o);
            this.endGame();
            return;
          }
          const pts = KINDS[o.kind].pts;
          this.score += pts;
          this.stroke++;
          this.strokeTimer = 0;
          this.strokeX = o.x;
          this.strokeY = o.y;
          this.events.push({ t: "slice", sfx: "brickgone", x: o.x, y: o.y, id: o.id, kind: o.kind, color: o.color, r: o.r, vx: o.vx, vy: o.vy, spin: o.spin, dx, dy, pts });
          if (o.kind === "slow") {
            this.slow = SLOW_FRAMES;
            this.events.push({ t: "slowmo", sfx: "extraGood", mood: "happy", x: o.x, y: o.y });
          }
        }
        this.objs = keep;
      }
    }

    // Combo: slices in one stroke, resolved when the stroke ends or pauses.
    if (this.stroke > 0) {
      this.strokeTimer++;
      if (!fire || this.strokeTimer > COMBO_WINDOW) this.resolveStroke();
    }

    // Misses
    const keep: SliceObj[] = [];
    for (const o of this.objs) {
      if (o.vy > 0 && o.y - o.r > H) {
        if (o.kind !== "bomb" && o.kind !== "slow") {
          this.lives--;
          this.events.push({ t: "miss", sfx: "extraBad", mood: "sad", x: Math.max(12, Math.min(W - 12, o.x)), y: H - 8, kind: o.kind, lives: this.lives });
          if (this.lives <= 0) {
            this.objs = [];
            this.endGame();
            return;
          }
        }
        continue;
      }
      keep.push(o);
    }
    this.objs = keep;
    if (this.queue.length === 0 && this.objs.length === 0 && this.nextWaveAt <= this.frame && this.wave > 0) this.nextWaveAt = this.frame + WAVE_GAP;
  }

  private resolveStroke() {
    const n = this.stroke;
    this.stroke = 0;
    this.strokeTimer = 0;
    if (n >= 3) {
      const bonus = n * 10;
      this.score += bonus;
      this.events.push({ t: "combo", sfx: "extraGood", mood: "happy", n, bonus, x: this.strokeX, y: this.strokeY });
    }
  }

  private endGame() {
    this.over = true;
    this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
  }

  view(): SliceView {
    return {
      frame: this.frame,
      objects: this.objs.map((o) => ({ ...o })),
      blade: { x: this.cx, y: this.cy, px: this.pcx, py: this.pcy, on: (this.prevB & BTN.FIRE) !== 0 && !this.over },
      lives: this.lives,
      score: this.score,
      wave: this.wave,
      slow: this.slow,
      combo: this.stroke,
      over: this.over,
    };
  }
  hud(): Hud {
    const label = this.slow > 0 ? "SLOW-MO" : this.stroke >= 2 ? `x${this.stroke}` : `Wave ${Math.max(1, this.wave)}`;
    return { score: this.score, lives: this.lives, level: Math.max(1, this.wave), label };
  }
  result(): GameResult {
    return { score: this.score, level: Math.max(0, this.wave - 1), levelsCleared: this.wavesCleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over || this.frame >= MAX_FRAMES;
  }
}

const MAX_FRAMES = 15 * 60 * 60;

export const slice: GameDef<SliceView> = {
  id: "slice",
  name: "Coin Slash",
  tagline: "Coins fly, you slash. Chain cuts for combos, and never touch a rug bomb.",
  genre: "Swipe-to-slice arcade",
  session: "1–4 min",
  controls: "Hold the mouse button and drag, or drag a finger, to slash. Keyboard: arrows move the blade, hold Space to cut while moving.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the swipe-to-slice genre. No code, names, art, sounds or layouts from any existing game; all art is drawn from the coin theme.",
  },
  create: (seed) => new SliceEngine(seed),
  bot(v, frame) {
    // Chase the lowest/nearest falling valuable, pass through it, dodge bombs.
    // Speed is limited and the bomb check is short-sighted, so runs end.
    const bx = v.blade.x;
    const by = v.blade.y;
    let best: SliceObj | null = null;
    let bestScore = Infinity;
    for (const o of v.objects) {
      if (o.kind === "bomb" || o.y > H - 4) continue;
      const d = Math.abs(o.x - bx) + Math.abs(o.y - by);
      const sc = d - (o.vy > 0 ? o.y * 0.6 : 0);
      if (sc < bestScore) {
        bestScore = sc;
        best = o;
      }
    }
    if (!best) {
      const dx = W / 2 - bx;
      const dy = H / 2 - by;
      return { x: Math.round(bx + Math.sign(dx) * Math.min(4, Math.abs(dx))), y: Math.round(by + Math.sign(dy) * Math.min(4, Math.abs(dy))), b: 0 };
    }
    const speed = 8 + ((frame * 7) % 5);
    const ax = best.x + best.vx * 3;
    const ay = best.y + best.vy * 3;
    let dx = ax - bx;
    let dy = ay - by;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    dx = (dx / d) * speed;
    dy = (dy / d) * speed;
    let nx = Math.max(0, Math.min(W - 1, Math.round(bx + dx)));
    let ny = Math.max(0, Math.min(H - 1, Math.round(by + dy)));
    let b: number = BTN.FIRE;
    for (const o of v.objects) {
      if (o.kind !== "bomb") continue;
      if (segHitsCircle(bx, by, nx, ny, o.x, o.y, o.r + 4)) {
        // Lift the blade and sidestep.
        b = 0;
        nx = Math.max(0, Math.min(W - 1, Math.round(bx - dy)));
        ny = Math.max(0, Math.min(H - 1, Math.round(by + dx)));
        break;
      }
    }
    return { x: nx, y: ny, b };
  },
};
