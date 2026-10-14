/*
 * Beat Tiles: an original four-lane rhythm tapper. ArcadePad, GPL-3.0-or-later.
 * Original implementation of the genre (no code, names or art taken from any
 * existing game).
 *
 * Tiles scroll down four lanes on a 16th-note beat grid and must be tapped as
 * they cross the hit line. Pointer: FIRE taps the lane under the pointer x
 * (field quarters). Keyboard: LEFT / DOWN / UP / RIGHT are lanes 1-4.
 *   - Perfect (within PERFECT_PX of the line) scores more than Good.
 *   - Long tiles must be held until their tail reaches the line; letting go
 *     early breaks the tile (no hold points, combo reset) but is not fatal.
 *   - Tapping a lane with no tile in the hit window, or letting a tile's head
 *     pass the line, ends the run.
 * The tempo rises every bar (BPM_STEP) up to BPM_MAX; every BARS_PER_LEVEL
 * bars is a level. The note sequence is strictly one note at a time (no
 * chords, nothing during a hold) so a single pointer can play everything.
 *
 * Timing is kept in milli-frames (1 frame = 1000) so the beat grid is exact
 * integer arithmetic; tile positions are (sixteenth - beatPos) * SPACING px,
 * so the scroll speed rises with the tempo automatically.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const LANES = 4;
export const LANE_W = W / LANES;
export const HIT_Y = 500;
/** Pixels per sixteenth note on screen. */
export const SPACING = 36;
/** Drawn height of a tap tile (centred on its note). */
export const TILE_H = 30;
export const PERFECT_PX = 10;
export const GOOD_EARLY = 46; // tile still above the line
export const GOOD_LATE = 30; // tile already past the line
export const BPM0 = 96;
export const BPM_STEP = 2; // per bar
export const BPM_MAX = 196;
export const BARS_PER_LEVEL = 8;
export const LEAD_IN = 16; // sixteenths before the first tile
const MIN_GAP_MF = 8500; // never two notes closer than ~8.5 frames
const MF = 1000; // milli-frames per frame
const LOOKAHEAD = 24; // sixteenths of notes kept generated ahead

/** Keyboard lane buttons, lanes 0..3. */
export const LANE_BTNS = [BTN.LEFT, BTN.DOWN, BTN.UP, BTN.RIGHT] as const;

export const PENDING = 0;
export const HIT = 1;
export const HOLDING = 2;
export const HELD = 3;
export const BROKEN = 4;
export const MISSED = 5;

export function bpmAtBar(bar: number): number {
  return Math.min(BPM_MAX, BPM0 + bar * BPM_STEP);
}
/** Length of the sixteenth with index `six`, in milli-frames. */
export function sixLenMf(six: number): number {
  return Math.floor((900 * MF) / bpmAtBar(Math.floor(six / 16)));
}
export function levelAt(six: number): number {
  return Math.floor(Math.floor(six / 16) / BARS_PER_LEVEL);
}
export const laneOfX = (x: number) => Math.max(0, Math.min(LANES - 1, Math.floor(x / LANE_W)));
export const laneCenter = (lane: number) => lane * LANE_W + LANE_W / 2;

export interface Note {
  id: number;
  lane: number;
  /** Sixteenth index of the head (the tile's centre crosses the line then). */
  six: number;
  /** Hold length in sixteenths (0 = tap tile). */
  len: number;
  state: number;
  judge: "" | "perfect" | "good";
}

export interface BeatView {
  frame: number;
  /** Continuous position on the beat grid, in sixteenths. */
  beatPos: number;
  bpm: number;
  level: number; // 0-based
  notes: readonly Note[];
  /** The long tile being held, if any, and the button that holds it. */
  hold: { id: number; bit: number } | null;
  score: number;
  combo: number;
  bestCombo: number;
  prevB: number;
  /** Lane pressed last (for the mascot), -1 at start. */
  lastLane: number;
  dead: boolean;
  fail: { lane: number; kind: "miss" | "wrongtap" } | null;
}

/** Signed distance (px) of a sixteenth position above the hit line. */
export function distPx(six: number, beatPos: number): number {
  return (six - beatPos) * SPACING;
}

const GAPS = [1, 2, 3, 4, 6];

class BeatEngine implements GameEngine<BeatView> {
  private rng: Rng;
  private notes: Note[] = [];
  private nextId = 0;
  private genSix = LEAD_IN;
  private genLane = -1;
  private six = 0;
  private frac = 0; // milli-frames into the current sixteenth
  private prevB = 0;
  private hold: { id: number; bit: number } | null = null;
  private score = 0;
  private combo = 0;
  private bestCombo = 0;
  private level = 0;
  private lastLane = -1;
  private dead = false;
  private fail: BeatView["fail"] = null;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.generate();
  }

  private beatPos() {
    return this.six + this.frac / sixLenMf(this.six);
  }

  private pickGap(six: number): number {
    const lvl = levelAt(six);
    const late = Math.min(1, lvl / 6);
    // weights for gaps 1, 2, 3, 4, 6 sixteenths; denser as levels rise
    const wts = [1 + 3 * late, 6 + 2 * late, 2, 4 - 2 * late, 1.5 - late];
    const len = sixLenMf(six);
    let total = 0;
    const ok: number[] = [];
    for (let i = 0; i < GAPS.length; i++) {
      const w = GAPS[i] * len >= MIN_GAP_MF ? Math.round(wts[i] * 10) : 0;
      ok.push(w);
      total += w;
    }
    let k = this.rng.int(total);
    for (let i = 0; i < GAPS.length; i++) {
      if (k < ok[i]) return GAPS[i];
      k -= ok[i];
    }
    return 4;
  }

  private generate() {
    while (this.genSix < this.six + LOOKAHEAD) {
      const at = this.genSix;
      const lvl = levelAt(at);
      let lane: number;
      if (this.genLane < 0) lane = this.rng.int(LANES);
      else if (this.rng.int(100) < 12) lane = this.genLane;
      else lane = (this.genLane + 1 + this.rng.int(LANES - 1)) % LANES;
      const longChance = Math.min(22, 10 + lvl * 2);
      const len = this.nextId > 2 && this.rng.int(100) < longChance ? 2 + this.rng.int(3 + Math.min(3, lvl)) : 0;
      this.notes.push({ id: this.nextId++, lane, six: at, len, state: PENDING, judge: "" });
      this.genLane = lane;
      // A hold needs room to release before the next tile.
      this.genSix = at + len + (len ? Math.max(2, this.pickGap(at + len)) : this.pickGap(at));
    }
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    // Advance the beat grid.
    this.frac += MF;
    let len = sixLenMf(this.six);
    while (this.frac >= len) {
      this.frac -= len;
      this.six++;
      len = sixLenMf(this.six);
    }
    const lvl = levelAt(this.six);
    if (lvl > this.level) {
      this.level = lvl;
      this.events.push({ t: "levelup", level: lvl, bpm: bpmAtBar(Math.floor(this.six / 16)), sfx: "levelclear", toast: "levelClear", mood: "happy" });
    }
    this.generate();
    const pos = this.beatPos();

    // Holds: complete when the tail reaches the line, break on early release.
    if (this.hold) {
      const n = this.notes.find((q) => q.id === this.hold!.id)!;
      const tailDist = distPx(n.six + n.len, pos);
      if (tailDist <= 0 || (!(inp.b & this.hold.bit) && tailDist <= GOOD_LATE)) {
        n.state = HELD;
        const pts = n.len * 2;
        this.score += pts;
        this.hold = null;
        this.events.push({ t: "holdDone", lane: n.lane, pts, sfx: "brickgone", x: laneCenter(n.lane), y: HIT_Y });
      } else if (!(inp.b & this.hold.bit)) {
        n.state = BROKEN;
        this.hold = null;
        this.combo = 0;
        this.events.push({ t: "break", lane: n.lane, sfx: "extraBad", mood: "sad", shake: 3, x: laneCenter(n.lane), y: HIT_Y });
      }
    }

    // Taps: pointer FIRE picks the lane under x, arrows pick their lane.
    if (pressed & BTN.FIRE) this.tap(laneOfX(inp.x), BTN.FIRE, pos);
    for (let l = 0; l < LANES && !this.dead; l++) if (pressed & LANE_BTNS[l]) this.tap(l, LANE_BTNS[l], pos);
    if (this.dead) return;

    // Tiles that slid past the line unplayed end the run.
    for (const n of this.notes) {
      if (n.state === PENDING && distPx(n.six, pos) < -GOOD_LATE) {
        n.state = MISSED;
        this.die(n.lane, "miss");
        return;
      }
    }
    // Drop finished notes well below the screen.
    this.notes = this.notes.filter((n) => n.state === PENDING || n.state === HOLDING || distPx(n.six + n.len, pos) > -(H - HIT_Y + TILE_H + 40));
  }

  private tap(lane: number, bit: number, pos: number) {
    if (this.dead) return;
    this.lastLane = lane;
    let target: Note | null = null;
    for (const n of this.notes) {
      if (n.state !== PENDING || n.lane !== lane) continue;
      const d = distPx(n.six, pos);
      if (d <= GOOD_EARLY && d >= -GOOD_LATE) {
        target = n;
        break;
      }
      if (d > GOOD_EARLY) break;
    }
    if (!target) {
      this.die(lane, "wrongtap");
      return;
    }
    const d = distPx(target.six, pos);
    const perfect = Math.abs(d) <= PERFECT_PX;
    this.combo++;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    const pts = (perfect ? 3 : 1) + Math.min(5, Math.floor(this.combo / 20));
    this.score += pts;
    target.judge = perfect ? "perfect" : "good";
    if (target.len > 0) {
      target.state = HOLDING;
      this.hold = { id: target.id, bit };
    } else target.state = HIT;
    const milestone = this.combo % 50 === 0;
    this.events.push({
      t: "hit",
      lane,
      judge: target.judge,
      pts,
      combo: this.combo,
      long: target.len > 0,
      sfx: milestone ? "extraGood" : perfect ? "paddle" : "brick",
      mood: milestone ? "happy" : undefined,
      x: laneCenter(lane),
      y: HIT_Y,
    });
  }

  private die(lane: number, kind: "miss" | "wrongtap") {
    this.dead = true;
    this.fail = { lane, kind };
    this.hold = null;
    this.events.push({ t: kind, lane, sfx: "lost", mood: "sad", shake: 8, x: laneCenter(lane), y: HIT_Y });
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  view(): BeatView {
    return {
      frame: this.frame,
      beatPos: this.beatPos(),
      bpm: bpmAtBar(Math.floor(this.six / 16)),
      level: this.level,
      notes: this.notes.map((n) => ({ ...n })),
      hold: this.hold ? { ...this.hold } : null,
      score: this.score,
      combo: this.combo,
      bestCombo: this.bestCombo,
      prevB: this.prevB,
      lastLane: this.lastLane,
      dead: this.dead,
      fail: this.fail,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level + 1, label: this.combo > 1 ? `${this.combo} combo` : `${bpmAtBar(Math.floor(this.six / 16))} BPM` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.level, frames: this.frame, status: this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead;
  }
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x5bd1e995, 0x2c1b3c6d);
  h ^= h >>> 13;
  return Math.imul(h, 0x297a2d39) >>> 0;
}

export const beat: GameDef<BeatView> = {
  id: "beat",
  name: "Beat Tiles",
  tagline: "Four lanes, one beat. Tap every tile on the line and never miss.",
  genre: "Rhythm tapper",
  session: "1–4 min",
  controls: "Tap a lane as its tile hits the line, hold long tiles. Keys: ← ↓ ↑ → for lanes 1–4.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the four-lane falling-tile rhythm genre. No code, names, art or sounds from any existing game.",
  },
  create: (seed) => new BeatEngine(seed),
  bot(v) {
    // Taps on time with a little per-tile jitter; skips the odd tile (more often
    // as levels rise), so attract runs end.
    const none = { x: W / 2, y: HIT_Y, b: 0 };
    if (v.dead) return none;
    if (v.hold) {
      const n = v.notes.find((q) => q.id === v.hold!.id);
      return { x: n ? laneCenter(n.lane) : W / 2, y: HIT_Y, b: v.hold.bit };
    }
    const n = v.notes.find((q) => q.state === PENDING);
    if (!n) return none;
    const h = hash(n.id * 31 + n.six * 7 + n.lane + 977);
    if (n.id > 4 && h % 1000 < 1 + v.level * 2) return none; // lapse: lets it pass
    const aim = (h % 23) - 9;
    if (distPx(n.six, v.beatPos) > aim) return none;
    const bit = (h >>> 10) & 1 ? LANE_BTNS[n.lane] : BTN.FIRE;
    if (v.prevB & bit) return none; // release first, press next frame
    return { x: laneCenter(n.lane), y: HIT_Y, b: bit };
  },
};
