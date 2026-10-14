/*
 * Hex Spin: an original "orbit the centre, dodge the closing walls" survival
 * game. ArcadePad, GPL-3.0-or-later.
 *
 * Original design (credits.basedOn = "Original"): no code, names, art,
 * music or layouts from any existing game of the genre.
 *
 * World: SECTORS = 6 angular sectors around the field centre. Angles are
 * integer units, ANG per turn (SECTOR_U = 256 units per sector). The mascot
 * sits at radius PR and angle `pa` (world units); LEFT / RIGHT turn it.
 * Walls are { s: sector, d: inner radius, th: thickness } and move inwards
 * at `speed` px per frame. A whole wave is a hand-authored pattern from
 * PATTERNS (rows of 6-bit sector masks, offsets in frames of travel), placed
 * with a random rotation and mirror from the Rng, one after another.
 *
 * Collisions are polar and exact:
 *  - turning into a sector whose wall overlaps the mascot's radial band is
 *    BLOCKED (the mascot stops at the sector edge),
 *  - a wall closing in on the mascot's own sector RUNS IT OVER (game over).
 *
 * The world rotation `rot` (also ANG units) is cosmetic: it spins, reverses
 * on the beat (BEAT frames) and sometimes surges. Byte angles from
 * core/trig give the mascot's screen position in the view and in events.
 *
 * Score = time survived in 1/10 s. Every STAGE_FRAMES (10 s) a new stage
 * with its own name: walls and the mascot get faster, the spin gets wilder.
 */
import { Rng } from "../core/rng.ts";
import { cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- geometry
export const FIELD_W = 360;
export const FIELD_H = 600;
export const CX = 180;
export const CY = 300;
export const SECTORS = 6;
export const SECTOR_U = 256;
export const ANG = SECTORS * SECTOR_U; // 1536 units per turn
/** Orbit radius of the mascot and half its radial size. */
export const PR = 58;
export const PSZ = 5;
/** Radius of the centre hexagon; walls vanish under it. */
export const CORE_R = 34;
/** Walls appear at this radius (just outside the field corners). */
export const SPAWN_R = 380;

// ---------------------------------------------------------------- tuning
export const BEAT = 30; // frames per beat (120 bpm)
export const STAGE_FRAMES = 600; // 10 s
const START_LEAD = 40; // frames of travel before the first wall arrives at SPAWN_R
const PATTERN_GAP = 44; // frames of travel between patterns
const MAX_FRAMES = 10 * 60 * 60;

export const STAGE_NAMES = ["Spark", "Ripple", "Orbit", "Vortex", "Prism", "Nova", "Eclipse", "Quasar", "Singularity", "Beyond"];

export function wallSpeed(stage: number): number {
  return Math.min(6, 2.4 + 0.3 * stage);
}
export function turnSpeed(stage: number): number {
  return Math.min(60, 32 + 3 * stage);
}
function spinSpeed(stage: number): number {
  return Math.min(13, 3 + stage);
}

// ---------------------------------------------------------------- patterns
/** One row: offset (frames of travel from the pattern start), sector mask (bit i = sector i), thickness (frames). */
export type Row = [off: number, mask: number, thick: number];
export interface Pattern {
  name: string;
  rows: Row[];
}
const T = 5; // default wall thickness, frames of travel

/** Hand-authored wave library. Every row leaves at least one sector open. */
export const PATTERNS: Pattern[] = [
  { name: "cage", rows: [[0, 0b111110, T]] },
  { name: "twin", rows: [[0, 0b110110, T]] },
  { name: "alternate", rows: [[0, 0b010101, T], [22, 0b101010, T], [44, 0b010101, T]] },
  { name: "zigzag", rows: [[0, 0b111110, T], [16, 0b111101, T], [32, 0b111110, T], [48, 0b111101, T]] },
  {
    name: "spiral",
    rows: [0, 1, 2, 3, 4, 5, 6].map((i): Row => [i * 12, 63 & ~((1 << (i % 6)) | (1 << ((i + 1) % 6))), T]),
  },
  { name: "corridor", rows: [[0, 0b001001, 78], [18, 0b010010, T], [42, 0b100100, T], [66, 0b010010, T]] },
  { name: "hammer", rows: [[0, 0b011111, T], [42, 0b111011, T]] },
  { name: "halves", rows: [[0, 0b111100, T], [24, 0b001111, T], [48, 0b111100, T]] },
  { name: "double cage", rows: [[0, 0b111110, T], [30, 0b111110, T]] },
  { name: "stairs", rows: [0, 1, 2, 3, 4, 5].map((i): Row => [i * 9, 1 << i, 9]) },
];

/** Rotate a 6-bit mask by r sectors, optionally mirrored. */
export function transformMask(mask: number, r: number, mirror: boolean): number {
  let m = mask & 63;
  if (mirror) {
    let o = 0;
    for (let i = 0; i < SECTORS; i++) if (m & (1 << i)) o |= 1 << (SECTORS - 1 - i);
    m = o;
  }
  r = ((r % SECTORS) + SECTORS) % SECTORS;
  return ((m << r) | (m >> (SECTORS - r))) & 63;
}

// ---------------------------------------------------------------- types
export interface Wall {
  s: number;
  d: number; // inner radius
  th: number; // thickness (px)
}

export interface HexView {
  frame: number;
  stage: number; // 0-based
  stageName: string;
  /** Frames into the current stage. */
  stageT: number;
  pa: number; // mascot world angle, ANG units
  sector: number;
  rot: number; // world rotation, ANG units (cosmetic)
  spin: number; // current rotation speed (signed)
  /** Screen position of the mascot (byte-angle trig). */
  px: number;
  py: number;
  /** -1 / 0 / +1: which way the player is turning. */
  turning: number;
  walls: Wall[]; // live array, valid until the next step
  speed: number;
  turn: number;
  /** Frames since the last beat (0..BEAT-1). */
  beatT: number;
  score: number; // tenths of a second
  dead: boolean;
  won: boolean;
}

export function wrapA(a: number): number {
  return ((a % ANG) + ANG) % ANG;
}
export function sectorOf(a: number): number {
  return Math.floor(wrapA(a) / SECTOR_U);
}
/** Does this wall overlap the mascot's radial band? */
export function overlapsPlayer(w: Wall): boolean {
  return w.d <= PR + PSZ && w.d + w.th >= PR - PSZ;
}

// ---------------------------------------------------------------- engine
class HexEngine implements GameEngine<HexView> {
  private rng: Rng;
  walls: Wall[] = [];
  private pa = SECTOR_U / 2; // middle of sector 0 (pointing right)
  private rot = 0;
  private spinDir = 1;
  private surge = 0;
  private nextFlip: number;
  private cursor: number;
  private lastPattern = -1;
  private stage = 0;
  private turning = 0;
  private bumpCool = 0;
  private dead = false;
  private won = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.cursor = SPAWN_R + START_LEAD * wallSpeed(0);
    this.nextFlip = BEAT * this.rng.range(6, 10);
    this.rot = this.rng.int(ANG);
  }

  private get speed() {
    return wallSpeed(this.stage);
  }

  private spawnPattern() {
    let k = this.rng.int(PATTERNS.length);
    if (k === this.lastPattern) k = (k + 1 + this.rng.int(PATTERNS.length - 1)) % PATTERNS.length;
    // Early on keep the simple shapes.
    if (this.stage === 0 && this.frame < 240 && PATTERNS[k].rows.length > 3) k = this.rng.int(2);
    this.lastPattern = k;
    const pat = PATTERNS[k];
    const r = this.rng.int(SECTORS);
    const mirror = this.rng.int(2) === 1;
    const sp = this.speed;
    let end = 0;
    for (const [off, mask, thick] of pat.rows) {
      const m = transformMask(mask, r, mirror);
      for (let s = 0; s < SECTORS; s++) if (m & (1 << s)) this.walls.push({ s, d: this.cursor + off * sp, th: thick * sp });
      end = Math.max(end, off + thick);
    }
    this.cursor += (end + PATTERN_GAP) * sp;
  }

  private blockedAt(sector: number): boolean {
    for (const w of this.walls) if (w.s === sector && overlapsPlayer(w)) return true;
    return false;
  }

  private screenPos() {
    const b = Math.floor(wrapA(this.pa + this.rot) / 6); // ANG units -> byte angle
    return { x: CX + cos256(b) * PR, y: CY + sin256(b) * PR };
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead || this.won) return;

    // --- input: arrows, or hold FIRE on either half of the field
    let dir = 0;
    if (inp.b & BTN.LEFT) dir -= 1;
    if (inp.b & BTN.RIGHT) dir += 1;
    if (dir === 0 && inp.b & BTN.FIRE) dir = inp.x < CX ? -1 : inp.x > CX ? 1 : 0;
    this.turning = dir;

    // --- turn the mascot; walls beside it block
    if (this.bumpCool > 0) this.bumpCool--;
    if (dir !== 0) {
      const cur = sectorOf(this.pa);
      const next = wrapA(this.pa + dir * turnSpeed(this.stage));
      const ns = sectorOf(next);
      if (ns !== cur && this.blockedAt(ns)) {
        this.pa = cur * SECTOR_U + (dir > 0 ? SECTOR_U - 1 : 0);
        if (this.bumpCool === 0) {
          const p = this.screenPos();
          this.events.push({ t: "bump", sfx: "wall", x: p.x, y: p.y, dir });
          this.bumpCool = 12;
        }
      } else this.pa = next;
    }

    // --- walls close in
    const sp = this.speed;
    this.cursor -= sp;
    while (this.cursor <= SPAWN_R) this.spawnPattern();
    let w = 0;
    for (const wall of this.walls) {
      wall.d -= sp;
      if (wall.d + wall.th > CORE_R - 4) this.walls[w++] = wall;
    }
    this.walls.length = w;

    // --- head-on: a wall in our own sector runs the mascot over
    if (this.blockedAt(sectorOf(this.pa))) {
      this.dead = true;
      const p = this.screenPos();
      this.events.push({ t: "die", sfx: "lost", mood: "sad", shake: 10, x: p.x, y: p.y });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }

    // --- world spin, beat, reversals
    if (this.frame % BEAT === 0) this.events.push({ t: "beat" });
    if (this.frame >= this.nextFlip) {
      this.spinDir = -this.spinDir;
      if (this.stage >= 1 && this.rng.int(3) === 0) this.surge = BEAT;
      this.nextFlip = this.frame + BEAT * this.rng.range(4, 10 - Math.min(4, this.stage >> 1));
      this.events.push({ t: "flip", dir: this.spinDir, surge: this.surge > 0 });
    }
    const spin = this.spinDir * spinSpeed(this.stage) * (this.surge > 0 ? 3 : 1);
    if (this.surge > 0) this.surge--;
    this.rot = wrapA(this.rot + spin);

    // --- stages
    if (this.frame % STAGE_FRAMES === 0) {
      this.stage++;
      this.events.push({ t: "stage", stage: this.stage, name: STAGE_NAMES[Math.min(this.stage, STAGE_NAMES.length - 1)], sfx: "levelclear", mood: "happy" });
    }
    if (this.frame >= MAX_FRAMES) {
      this.won = true;
      this.events.push({ t: "won", sfx: "won", mood: "happy" });
    }
  }

  view(): HexView {
    const p = this.screenPos();
    return {
      frame: this.frame,
      stage: this.stage,
      stageName: STAGE_NAMES[Math.min(this.stage, STAGE_NAMES.length - 1)],
      stageT: this.frame % STAGE_FRAMES,
      pa: this.pa,
      sector: sectorOf(this.pa),
      rot: this.rot,
      spin: this.spinDir * spinSpeed(this.stage) * (this.surge > 0 ? 3 : 1),
      px: p.x,
      py: p.y,
      turning: this.turning,
      walls: this.walls,
      speed: this.speed,
      turn: turnSpeed(this.stage),
      beatT: this.frame % BEAT,
      score: this.score,
      dead: this.dead,
      won: this.won,
    };
  }
  private get score() {
    return Math.floor(this.frame / 6);
  }
  hud(): Hud {
    const s = this.score;
    return { score: s, level: this.stage + 1, label: `${STAGE_NAMES[Math.min(this.stage, STAGE_NAMES.length - 1)]} ${Math.floor(s / 10)}.${s % 10}s` };
  }
  result(): GameResult {
    return {
      score: this.score,
      level: this.stage,
      levelsCleared: this.stage,
      frames: this.frame,
      status: this.won ? "won" : this.dead ? "over" : "playing",
    };
  }
  get done() {
    return this.dead || this.won;
  }
}

// ---------------------------------------------------------------- bot
function hash32(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Time windows (frames from now) during which walls of sector s cover the mascot's band. */
function windows(v: HexView, s: number): [number, number][] {
  const out: [number, number][] = [];
  for (const w of v.walls) {
    if (w.s !== s) continue;
    const t0 = (w.d - (PR + PSZ)) / v.speed;
    const t1 = (w.d + w.th - (PR - PSZ)) / v.speed;
    if (t1 >= 0) out.push([t0, t1]);
  }
  return out;
}

export const hex: GameDef<HexView> = {
  id: "hex",
  name: "Hex Spin",
  tagline: "Orbit the core, slip through the gaps, survive the spin. How long can you last?",
  genre: "Spin survival",
  session: "20 s – 3 min",
  controls: "Left / Right arrows (or A / D) to orbit. Touch: hold the left or right half of the screen.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes:
      "Original survival game written for ArcadePad: polar collision rules, hand-authored wave library, stage names, spin/beat system and renderer are all ours. No code, names, music or art from any existing game of the genre.",
  },
  create: (seed) => new HexEngine(seed),
  bot(v, frame) {
    const idle = { x: CX, y: CY, b: 0 };
    if (v.dead || v.won) return idle;
    // Imperfection: short attention lapses, more often as it speeds up.
    if (frame > 300 && hash32(frame >> 3) % Math.max(5, 24 - v.stage * 2) === 0) return idle;
    const cur = v.sector;
    const per = SECTOR_U / v.turn; // frames to cross one sector
    const within = v.pa - cur * SECTOR_U; // 0..255
    // Value of a sector: frames from now until its next wall, if we can get in (capped).
    const value = (s: number, tin: number) => {
      let free = 240;
      for (const [a, b] of windows(v, s)) {
        if (b < tin) continue;
        if (a <= tin + 1) return -1; // a wall is there when we arrive
        free = Math.min(free, a);
      }
      return free;
    };
    let best = value(cur, 0);
    let bestDir = 0;
    for (const dir of [-1, 1]) {
      const toEdge = dir > 0 ? (SECTOR_U - within) / v.turn : (within + 1) / v.turn;
      for (let k = 1; k <= 3; k++) {
        const s = (((cur + dir * k) % SECTORS) + SECTORS) % SECTORS;
        const tin = toEdge + (k - 1) * per;
        const val = value(s, tin);
        if (val < 0) break; // can't get in (or past) this sector
        if (val - k * 3 > best) {
          best = val - k * 3;
          bestDir = dir;
        }
        // To go further we must cross this sector before its next wall.
        if (val < tin + per + 2) break;
      }
    }
    if (bestDir === 0) {
      // Drift back towards the middle of the sector so the next move is short.
      const off = within - SECTOR_U / 2;
      if (Math.abs(off) > v.turn) bestDir = off > 0 ? -1 : 1;
      else return idle;
    }
    return { x: CX, y: CY, b: bestDir < 0 ? BTN.LEFT : BTN.RIGHT };
  },
};
