/*
 * Moon Helix: an original "ball bounces down a rotating tower" game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Original design (credits.basedOn = "Original"): no code, names or art from
 * any existing tower-drop game.
 *
 * World: a vertical tower of rings, ring i has its top surface at
 * y = i * RING_GAP (y grows downward). Each ring has SEGS angular segments,
 * each GAP (open), SAFE or DANGER. Angles are integer units, ANG per turn
 * (SEG_U units per segment). The tower's rotation `rot` is an integer; a
 * segment with tower angle a sits at screen angle a + rot. The ball never
 * moves sideways: it bounces at screen angle FRONT (nearest the viewer), so
 * the segment under it has tower angle FRONT - rot.
 *
 * The ball bounces with a fixed launch speed whenever it lands on a SAFE
 * segment. Landing over a GAP drops it through (ring passed, combo + 1).
 * Landing on DANGER ends the run, unless the ball is "super" (it fell through
 * SUPER_AT or more rings in a row without bouncing): then it smashes the ring
 * and bounces. Landing on the bottom pad clears the level; every level adds
 * rings and danger segments.
 *
 * Score: each ring passed gives 10 + 5 x (combo - 1); a smash gives +25;
 * clearing level n gives 50 x n.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- geometry
export const FIELD_W = 360;
export const FIELD_H = 600;
export const SEGS = 12;
export const SEG_U = 128;
export const ANG = SEGS * SEG_U; // 1536 units per turn
/** Screen angle nearest the viewer (bottom of the ellipse). */
export const FRONT = ANG / 4; // 384
export const RING_GAP = 110;
export const BALL_R = 10;

export const GAP = 0;
export const SAFE = 1;
export const DANGER = 2;

// ---------------------------------------------------------------- physics (per frame)
export const GRAV = 0.35;
export const BOUNCE_V = 6.6;
const MAX_VY = 9.5;
export const ARROW_SPEED = 20; // units per frame
export const DRAG_K = 4; // units per field pixel of drag
export const SUPER_AT = 3;
const START_Y = -70;
const CLEAR_FRAMES = 75;
const MAX_FRAMES = 15 * 60 * 60;

export interface Ring {
  y: number;
  segs: number[];
  passed: boolean;
  smashed: boolean;
  pad: boolean;
}

export interface HelixView {
  frame: number;
  level: number; // 0-based
  rot: number;
  ballY: number;
  vy: number;
  rings: Ring[];
  combo: number;
  superBall: boolean;
  score: number;
  dead: boolean;
  /** Frames left in the level-clear pause (0 when playing). */
  clearing: number;
  ringsPassed: number;
  ringsTotal: number;
}

/** Wrap an angle to [0, ANG). */
export function wrapA(a: number): number {
  return ((a % ANG) + ANG) % ANG;
}
/** Segment index under the ball for a given rotation. */
export function segUnder(rot: number): number {
  return Math.floor(wrapA(FRONT - rot) / SEG_U);
}

export function ringsForLevel(level: number): number {
  return Math.min(40, 12 + 3 * level);
}

/** Build one level's tower. Exported for tests. */
export function buildTower(rng: Rng, level: number): Ring[] {
  const n = ringsForLevel(level);
  const rings: Ring[] = [];
  for (let i = 0; i < n; i++) {
    const segs = new Array<number>(SEGS).fill(SAFE);
    if (i === 0) {
      // Starter ring: the ball lands on safe ground, gap a few segments away.
      const start = segUnder(0);
      const g0 = (start + 4 + rng.int(5)) % SEGS;
      segs[g0] = GAP;
      segs[(g0 + 1) % SEGS] = GAP;
    } else {
      const wide = level < 3 && rng.int(3) === 0;
      const g0 = rng.int(SEGS);
      const gw = wide ? 3 : 2;
      for (let k = 0; k < gw; k++) segs[(g0 + k) % SEGS] = GAP;
      if (level < 2 && rng.int(4) === 0) segs[(g0 + 6) % SEGS] = GAP;
      let danger = Math.min(6, 1 + Math.floor((level * 2) / 3) + rng.int(2));
      if (i === 1) danger = Math.min(danger, 1);
      if (level === 0 && rng.int(3) === 0) danger = 0;
      let guard = 0;
      while (danger > 0 && guard++ < 40) {
        // Danger in short runs (1-2 segments) on solid ground.
        const s = rng.int(SEGS);
        const len = 1 + (level > 2 ? rng.int(2) : 0);
        for (let k = 0; k < len && danger > 0; k++) {
          const j = (s + k) % SEGS;
          if (segs[j] === SAFE) {
            segs[j] = DANGER;
            danger--;
          }
        }
      }
      // Always keep some safe ground.
      let safe = 0;
      for (const s of segs) if (s === SAFE) safe++;
      for (let j = 0; safe < 3 && j < SEGS; j++) {
        if (segs[j] === DANGER) {
          segs[j] = SAFE;
          safe++;
        }
      }
    }
    rings.push({ y: i * RING_GAP, segs, passed: false, smashed: false, pad: false });
  }
  rings.push({ y: n * RING_GAP, segs: new Array<number>(SEGS).fill(SAFE), passed: false, smashed: false, pad: true });
  return rings;
}

class HelixEngine implements GameEngine<HelixView> {
  private rng: Rng;
  private level = 0;
  private levelsCleared = 0;
  private rot = 0;
  private ballY = START_Y;
  private vy = 0;
  private rings: Ring[] = [];
  private next = 0; // index of the first ring not yet passed
  private combo = 0;
  private score = 0;
  private dead = false;
  private clearing = 0;
  private prevB = 0;
  private prevX = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.rings = buildTower(this.rng, 0);
  }

  private get superBall() {
    return this.combo >= SUPER_AT;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;
    const b = inp.b;
    const dragging = (b & BTN.FIRE) !== 0 && (this.prevB & BTN.FIRE) !== 0;
    const dx = inp.x - this.prevX;
    this.prevB = b;
    this.prevX = inp.x;

    if (this.clearing > 0) {
      if (--this.clearing === 0) this.startLevel();
      return;
    }

    // ---- rotation (drag right / RIGHT turns the front of the tower right)
    if (dragging && dx !== 0) this.rot = wrapA(this.rot - dx * DRAG_K);
    if (b & BTN.RIGHT) this.rot = wrapA(this.rot - ARROW_SPEED);
    if (b & BTN.LEFT) this.rot = wrapA(this.rot + ARROW_SPEED);

    // ---- ball
    this.vy = Math.min(MAX_VY, this.vy + GRAV);
    const prevBottom = this.ballY + BALL_R;
    this.ballY += this.vy;
    const bottom = this.ballY + BALL_R;
    if (this.vy <= 0 || this.next >= this.rings.length) return;
    const ring = this.rings[this.next];
    if (!(prevBottom <= ring.y && bottom > ring.y)) return;

    const si = segUnder(this.rot);
    const kind = ring.pad ? SAFE : ring.segs[si];
    if (ring.pad) {
      this.bounce(ring);
      this.levelClear(ring);
      return;
    }
    if (kind === GAP) {
      ring.passed = true;
      this.next++;
      this.combo++;
      const pts = 10 + 5 * (this.combo - 1);
      this.score += pts;
      this.events.push({
        t: "pass", ring: this.next - 1, combo: this.combo, pts, y: ring.y,
        sfx: this.combo >= SUPER_AT ? "extraGood" : "brickgone",
        mood: this.combo === SUPER_AT ? "happy" : undefined,
      });
      return;
    }
    if (this.superBall) {
      ring.passed = true;
      ring.smashed = true;
      this.next++;
      const pts = 25 + 10 + 5 * (this.combo - 1);
      this.score += pts;
      this.events.push({ t: "smash", ring: this.next - 1, pts, y: ring.y, sfx: "explode", shake: 7, mood: "happy" });
      this.combo = 0;
      this.ballY = ring.y - BALL_R;
      this.vy = -BOUNCE_V * 0.8;
      return;
    }
    if (kind === DANGER) {
      this.ballY = ring.y - BALL_R;
      this.vy = 0;
      this.dead = true;
      this.events.push({ t: "die", ring: this.next, seg: si, y: ring.y, sfx: "lost", mood: "sad", shake: 10, toast: "lifeLost" });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    this.bounce(ring);
  }

  private bounce(ring: Ring) {
    this.ballY = ring.y - BALL_R;
    this.vy = -BOUNCE_V;
    this.events.push({ t: "bounce", ring: this.next, seg: segUnder(this.rot), y: ring.y, sfx: "paddle", combo: this.combo });
    this.combo = 0;
  }

  private levelClear(ring: Ring) {
    this.levelsCleared++;
    const pts = 50 * this.levelsCleared;
    this.score += pts;
    this.clearing = CLEAR_FRAMES;
    this.vy = -BOUNCE_V;
    this.events.push({ t: "clear", pts, y: ring.y, sfx: "levelclear", toast: "levelClear", mood: "happy" });
  }

  private startLevel() {
    this.level++;
    this.rings = buildTower(this.rng, this.level);
    this.next = 0;
    this.combo = 0;
    this.ballY = START_Y;
    this.vy = 0;
    this.events.push({ t: "level", level: this.level, sfx: "launch" });
  }

  view(): HelixView {
    return {
      frame: this.frame,
      level: this.level,
      rot: this.rot,
      ballY: this.ballY,
      vy: this.vy,
      rings: this.rings,
      combo: this.combo,
      superBall: this.superBall,
      score: this.score,
      dead: this.dead,
      clearing: this.clearing,
      ringsPassed: this.next,
      ringsTotal: this.rings.length - 1,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level + 1, label: this.combo >= 2 ? `x${this.combo} combo` : `${Math.min(this.next, this.rings.length - 1)}/${this.rings.length - 1} rings` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.levelsCleared, frames: this.frame, status: this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead || this.frame >= MAX_FRAMES;
  }
}

function hash32(n: number): number {
  let h = Math.imul(n ^ 0x2c1b3c6d, 0x297a2d39);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Shortest signed difference a - b in angle units, in [-ANG/2, ANG/2). */
function angDiff(a: number, b: number): number {
  return wrapA(a - b + ANG / 2) - ANG / 2;
}

export const helix: GameDef<HelixView> = {
  id: "helix",
  name: "Moon Helix",
  tagline: "Spin the tower, drop through the gaps, never touch the hot zones. Fall three rings in a row to go super.",
  genre: "Tower drop",
  session: "1–4 min",
  controls: "Drag left / right, or Left / Right arrows, to spin the tower.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes:
      "Original tower-drop game written for ArcadePad: ring generator, bounce/fall/super-smash rules, scoring and pseudo-3D renderer are all ours. No code, names or art from any existing tower-drop game.",
  },
  create: (seed) => new HelixEngine(seed),
  bot(v, frame) {
    const idle = { x: FIELD_W / 2, y: FIELD_H / 2, b: 0 };
    if (v.dead || v.clearing > 0) return idle;
    const ring = v.rings[v.ringsPassed];
    if (!ring || ring.pad) return idle;
    // Imperfection: occasional lapses in attention.
    if (frame > 600 && hash32(Math.floor(frame / 30)) % 23 === 0) return idle;
    // Target: the gap segment nearest to the current rotation.
    let bestD = Infinity;
    for (let s = 0; s < SEGS; s++) {
      if (ring.segs[s] !== GAP) continue;
      const want = wrapA(FRONT - (s * SEG_U + SEG_U / 2));
      const d = angDiff(want, v.rot);
      if (Math.abs(d) < Math.abs(bestD)) bestD = d;
    }
    if (bestD === Infinity) return idle;
    const dist = ring.y - (v.ballY + BALL_R);
    const landing = v.vy > 0 && dist < v.vy * 3 + 6;
    const tol = 30 + (hash32(frame >> 4) % 3) * 6;
    if (Math.abs(bestD) <= tol) return idle;
    const dir = bestD > 0 ? 1 : -1; // +1 = increase rot = LEFT
    if (landing && !v.superBall) {
      const here = ring.segs[segUnder(v.rot)];
      const nextSeg = segUnder(wrapA(v.rot + dir * ARROW_SPEED));
      if (here === DANGER) {
        // Escape danger toward whichever side is clear sooner.
        const alt = segUnder(wrapA(v.rot - dir * ARROW_SPEED));
        if (ring.segs[nextSeg] === DANGER && ring.segs[alt] !== DANGER) return { x: FIELD_W / 2, y: FIELD_H / 2, b: dir > 0 ? BTN.RIGHT : BTN.LEFT };
      } else if (ring.segs[nextSeg] === DANGER) return idle; // don't spin danger under the ball
    }
    return { x: FIELD_W / 2, y: FIELD_H / 2, b: dir > 0 ? BTN.LEFT : BTN.RIGHT };
  },
};
