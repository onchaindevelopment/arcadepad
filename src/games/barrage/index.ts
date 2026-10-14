/*
 * Ball Barrage: an original turn-based "aim a stream of balls at numbered
 * blocks" game for ArcadePad. Rules, physics and art written from scratch;
 * no code, art, names or sounds from any commercial game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Each turn you aim from the launcher on the floor (drag to aim, release to
 * fire; or LEFT/RIGHT + FIRE) and N coin-balls fly out one after another.
 * Every hit knocks one off a block's number; at 0 it breaks. "+1" rings add a
 * ball for the next turn. When every ball is back, all blocks move down one
 * row and a new row (numbers around the turn number) appears at the top. A
 * block reaching the bottom row ends the run. The launcher moves to wherever
 * the first ball landed. Long turns fast-forward (deterministically).
 * Score = turns survived + blocks broken.
 *
 * Physics: fixed 60 Hz, balls move in substeps of at most 3 px; collisions are
 * axis-separated (move x, test, then move y, test) against block rectangles
 * expanded by the ball radius, so the maths is only + - * / and Math.sqrt.
 */
import { Rng } from "../core/rng.ts";
import { angle256, cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- constants

export const FIELD_W = 360;
export const FIELD_H = 600;
export const COLS = 7;
export const ROWS = 10; // row 0 is a spawn buffer; a block in row ROWS-1 ends the run
export const CELL = 50;
export const LEFT = 5;
export const RIGHT = LEFT + COLS * CELL; // 355
export const TOP = 56;
export const FLOOR = TOP + ROWS * CELL; // 556
export const GAP = 2; // inset of a block inside its cell
export const BALL_R = 5;
export const PICK_R = 10;
export const LAUNCH_Y = FLOOR - BALL_R;
const BASE_SPEED = 7; // px per frame
const SUB_MAX = 3; // max px per substep
const LAUNCH_GAP = 5; // frames between balls
const SLIDE = 12; // px/frame for landed balls gathering at the next launcher
export const SHIFT_FRAMES = 16;
const FF_START = 240; // fast-forward kicks in after 4 s
const FF_EVERY = 120; // then +0.5x every 2 s
const FF_MAX = 4;
const TURN_CAP = 60 * 45; // 45 s: any ball still flying is recalled
const AQ_MIN = 134 * 4; // aim limits in quarter byte-angles (128*4 = left, 192*4 = up)
const AQ_MAX = 250 * 4;
const MIN_UP = 0.15; // minimum upward component of a pointer aim
const X_MIN = LEFT + BALL_R + 1;
const X_MAX = RIGHT - BALL_R - 1;

export type Phase = "aim" | "fly" | "shift" | "over";

export interface BlockV {
  id: number;
  c: number;
  r: number;
  hp: number;
  max: number;
}
export interface BallV {
  x: number;
  y: number;
  landed: boolean;
}
export interface BarrageView {
  frame: number;
  phase: Phase;
  phaseT: number;
  turn: number;
  score: number;
  broken: number;
  turnsSurvived: number;
  balls: number; // balls fired this/next turn
  gained: number; // +1s collected this turn
  queued: number; // balls still waiting in the launcher
  launcherX: number;
  nextX: number;
  firstLanded: boolean;
  aim: { x: number; y: number; valid: boolean; dragging: boolean; pointerMode: boolean };
  showGuide: boolean;
  blocks: BlockV[];
  pickups: { c: number; r: number }[];
  shots: BallV[];
  shiftT: number; // 0..1 during the shift phase
  speed: number; // fast-forward multiplier
}

/** Rectangle of the block in cell (c, r), in field units. */
export function cellRect(c: number, r: number) {
  const x0 = LEFT + c * CELL + GAP;
  const y0 = TOP + r * CELL + GAP;
  return { x0, y0, x1: x0 + CELL - 2 * GAP, y1: y0 + CELL - 2 * GAP };
}

/** Unit vector for a quarter byte-angle (linear between table steps, renormalised). */
function aimFromQ(q: number): { x: number; y: number } {
  const a = q >> 2;
  const f = (q & 3) / 4;
  const x = cos256(a) * (1 - f) + cos256(a + 1) * f;
  const y = sin256(a) * (1 - f) + sin256(a + 1) * f;
  const l = Math.sqrt(x * x + y * y);
  return { x: x / l, y: y / l };
}

interface Shot {
  x: number;
  y: number;
  vx: number; // unit direction * BASE_SPEED
  vy: number;
  landed: boolean;
}

/**
 * Trace the aim guide: from the launcher to the first thing it hits, then a
 * short reflected stretch. Pure function of the view (renderer + bot).
 */
export function traceGuide(v: Pick<BarrageView, "launcherX" | "aim" | "blocks">, after = 70): { x: number; y: number }[] {
  const occ = new Uint8Array(COLS * ROWS);
  for (const b of v.blocks) occ[b.r * COLS + b.c] = 1;
  let x = v.launcherX;
  let y = LAUNCH_Y;
  let dx = v.aim.x * 2;
  let dy = v.aim.y * 2;
  const pts = [{ x, y }];
  let bounced = false;
  let rest = after;
  for (let i = 0; i < 900; i++) {
    let hitX = false;
    let hitY = false;
    const nx = x + dx;
    if (nx < X_MIN || nx > X_MAX || overlaps(occ, nx, y)) hitX = true;
    else x = nx;
    const ny = y + dy;
    if (ny < TOP + BALL_R || overlaps(occ, x, ny)) hitY = true;
    else y = ny;
    if (y >= FLOOR - BALL_R && dy > 0) {
      pts.push({ x, y });
      return pts;
    }
    if (hitX || hitY) {
      if (!bounced) {
        pts.push({ x, y });
        bounced = true;
      }
      if (hitX) dx = -dx;
      if (hitY) dy = -dy;
    } else if (bounced) {
      rest -= 2;
      if (rest <= 0) break;
    }
  }
  pts.push({ x, y });
  return pts;
}

function overlaps(occ: Uint8Array, x: number, y: number): boolean {
  const c0 = Math.max(0, Math.floor((x - BALL_R - LEFT) / CELL));
  const c1 = Math.min(COLS - 1, Math.floor((x + BALL_R - LEFT) / CELL));
  const r0 = Math.max(0, Math.floor((y - BALL_R - TOP) / CELL));
  const r1 = Math.min(ROWS - 1, Math.floor((y + BALL_R - TOP) / CELL));
  for (let r = r0; r <= r1; r++)
    for (let c = c0; c <= c1; c++) {
      if (!occ[r * COLS + c]) continue;
      const q = cellRect(c, r);
      if (x > q.x0 - BALL_R && x < q.x1 + BALL_R && y > q.y0 - BALL_R && y < q.y1 + BALL_R) return true;
    }
  return false;
}

// ---------------------------------------------------------------- engine

class BarrageEngine implements GameEngine<BarrageView> {
  private rng: Rng;
  private hp = new Int32Array(COLS * ROWS);
  private maxHp = new Int32Array(COLS * ROWS);
  private ids = new Int32Array(COLS * ROWS);
  private pick = new Uint8Array(COLS * ROWS);
  private nextId = 1;
  private phase: Phase = "aim";
  private phaseT = 0;
  private turn = 1;
  private score = 0;
  private broken = 0;
  private turnsSurvived = 0;
  private balls = 1;
  private gained = 0;
  private launcherX = (LEFT + RIGHT) / 2;
  private nextX = this.launcherX;
  private firstLanded = false;
  private aimQ = 192 * 4;
  private aimX = 0;
  private aimY = -1;
  private aimValid = true;
  private pointerMode = false;
  private armed = false;
  private prevB = 0;
  private px = 0;
  private py = 0;
  private holdLR = 0;
  private shots: Shot[] = [];
  private toLaunch = 0;
  private launchTimer = 0;
  private turnFrames = 0;
  private speed = 1;
  private sfxHit = false;
  private sfxWall = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.spawnRow();
  }

  // -------------------------------------------------------------- rows

  private spawnRow() {
    const T = this.turn;
    const lo = 1 + Math.min(3, Math.floor(T / 12));
    const hi = Math.min(6, 3 + Math.floor(T / 8));
    const k = this.rng.range(lo, hi);
    const cols = [0, 1, 2, 3, 4, 5, 6];
    for (let i = COLS - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const t = cols[i];
      cols[i] = cols[j];
      cols[j] = t;
    }
    const r = 1;
    let doubled = false;
    for (let i = 0; i < k; i++) {
      const cell = r * COLS + cols[i];
      let v = T;
      if (T >= 5 && !doubled && this.rng.int(4) === 0) {
        v = T * 2;
        doubled = true;
      } else if (T >= 3 && this.rng.int(3) === 0) v = T + this.rng.range(-Math.floor(T / 4), Math.floor(T / 4));
      v = Math.max(1, v);
      this.hp[cell] = v;
      this.maxHp[cell] = v;
      this.ids[cell] = this.nextId++;
    }
    if (k < COLS) this.pick[r * COLS + cols[k]] = 1;
  }

  private shiftDown() {
    for (let r = ROWS - 1; r >= 1; r--)
      for (let c = 0; c < COLS; c++) {
        const a = r * COLS + c;
        const b = (r - 1) * COLS + c;
        this.hp[a] = this.hp[b];
        this.maxHp[a] = this.maxHp[b];
        this.ids[a] = this.ids[b];
        this.pick[a] = this.pick[b];
      }
    for (let c = 0; c < COLS; c++) {
      this.hp[c] = 0;
      this.pick[c] = 0;
    }
  }

  // -------------------------------------------------------------- input

  step(inp: Input) {
    this.frame++;
    this.events = [];
    this.sfxHit = false;
    if (this.sfxWall > 0) this.sfxWall--;
    if (this.phase === "over") return;
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    if (this.frame === 1) {
      this.px = inp.x;
      this.py = inp.y;
    }
    if (inp.x !== this.px || inp.y !== this.py) this.pointerMode = true;
    this.px = inp.x;
    this.py = inp.y;
    if (inp.b & (BTN.LEFT | BTN.RIGHT)) this.pointerMode = false;
    this.phaseT++;

    if (this.phase === "aim") this.stepAim(inp, pressed, released);
    else if (this.phase === "fly") this.stepFly();
    else if (this.phase === "shift" && this.phaseT >= SHIFT_FRAMES) this.endShift();
  }

  private stepAim(inp: Input, pressed: number, released: number) {
    const lr = inp.b & (BTN.LEFT | BTN.RIGHT);
    if (lr) {
      this.holdLR++;
      const d = this.holdLR > 24 ? 4 : this.holdLR > 8 ? 2 : 1;
      if (inp.b & BTN.LEFT) this.aimQ -= d;
      if (inp.b & BTN.RIGHT) this.aimQ += d;
      this.aimQ = Math.max(AQ_MIN, Math.min(AQ_MAX, this.aimQ));
    } else this.holdLR = 0;

    if (!this.pointerMode) {
      this.armed = false;
      const a = aimFromQ(this.aimQ);
      this.aimX = a.x;
      this.aimY = a.y;
      this.aimValid = true;
      if (pressed & BTN.FIRE) this.fire();
      return;
    }
    if (pressed & BTN.FIRE) this.armed = true;
    if (this.armed && inp.b & BTN.FIRE) this.pointAt(inp.x, inp.y);
    if (this.armed && released & BTN.FIRE) {
      this.armed = false;
      if (this.aimValid) this.fire();
    }
  }

  private pointAt(x: number, y: number) {
    const dx = x - this.launcherX;
    const dy = y - LAUNCH_Y;
    if (dy > -6) {
      this.aimValid = false;
      return;
    }
    const l = Math.sqrt(dx * dx + dy * dy);
    let ux = dx / l;
    let uy = dy / l;
    if (-uy < MIN_UP) {
      uy = -MIN_UP;
      ux = (ux < 0 ? -1 : 1) * Math.sqrt(1 - MIN_UP * MIN_UP);
    }
    this.aimX = ux;
    this.aimY = uy;
    this.aimValid = true;
    this.aimQ = Math.max(AQ_MIN, Math.min(AQ_MAX, angle256(dx, dy) * 4));
  }

  private fire() {
    this.phase = "fly";
    this.phaseT = 0;
    this.toLaunch = this.balls;
    this.launchTimer = 0;
    this.turnFrames = 0;
    this.speed = 1;
    this.firstLanded = false;
    this.nextX = this.launcherX;
    this.shots = [];
    this.events.push({ t: "launch", sfx: "launch", x: this.launcherX, y: LAUNCH_Y, n: this.balls });
  }

  // -------------------------------------------------------------- flight

  private stepFly() {
    this.turnFrames++;
    const k = this.turnFrames < FF_START ? 0 : 1 + Math.floor((this.turnFrames - FF_START) / FF_EVERY);
    const sp = Math.min(FF_MAX, 1 + 0.5 * k);
    if (sp !== this.speed) {
      this.speed = sp;
      this.events.push({ t: "speed", speed: sp, x: FIELD_W / 2, y: FIELD_H / 2 });
    }
    if (this.toLaunch > 0) {
      this.launchTimer -= this.speed;
      if (this.launchTimer <= 0) {
        this.launchTimer += LAUNCH_GAP;
        this.toLaunch--;
        this.shots.push({ x: this.launcherX, y: LAUNCH_Y, vx: this.aimX * BASE_SPEED, vy: this.aimY * BASE_SPEED, landed: false });
      }
    }
    const recall = this.turnFrames >= TURN_CAP;
    let allHome = this.toLaunch === 0;
    for (const s of this.shots) {
      if (!s.landed) {
        if (recall) this.land(s);
        else {
          const dist = BASE_SPEED * this.speed;
          const n = Math.ceil(dist / SUB_MAX);
          const m = this.speed / n;
          for (let i = 0; i < n && !s.landed; i++) this.substep(s, s.vx * m, s.vy * m);
        }
      }
      if (s.landed) {
        const d = this.nextX - s.x;
        s.x += Math.abs(d) <= SLIDE ? d : d < 0 ? -SLIDE : SLIDE;
        if (s.x !== this.nextX) allHome = false;
      } else allHome = false;
    }
    if (allHome) this.startShift();
  }

  private land(s: Shot) {
    s.landed = true;
    s.y = LAUNCH_Y;
    s.x = Math.max(X_MIN, Math.min(X_MAX, s.x));
    if (!this.firstLanded) {
      this.firstLanded = true;
      this.nextX = s.x;
      this.events.push({ t: "land", x: s.x, y: LAUNCH_Y });
    }
  }

  private substep(s: Shot, dx: number, dy: number) {
    // X axis
    s.x += dx;
    if (s.x < X_MIN) {
      s.x = 2 * X_MIN - s.x;
      s.vx = Math.abs(s.vx);
      this.wall(s);
    } else if (s.x > X_MAX) {
      s.x = 2 * X_MAX - s.x;
      s.vx = -Math.abs(s.vx);
      this.wall(s);
    } else {
      const cell = this.blockAt(s.x, s.y);
      if (cell >= 0) {
        s.x -= dx;
        s.vx = -s.vx;
        this.hit(cell, s);
      }
    }
    // Y axis
    s.y += dy;
    if (s.y < TOP + BALL_R) {
      s.y = 2 * (TOP + BALL_R) - s.y;
      s.vy = Math.abs(s.vy);
      this.wall(s);
    } else {
      const cell = this.blockAt(s.x, s.y);
      if (cell >= 0) {
        s.y -= dy;
        s.vy = -s.vy;
        this.hit(cell, s);
      }
    }
    // pickups
    const pc = Math.floor((s.x - LEFT) / CELL);
    const pr = Math.floor((s.y - TOP) / CELL);
    if (pc >= 0 && pc < COLS && pr >= 0 && pr < ROWS && this.pick[pr * COLS + pc]) {
      const cx = LEFT + pc * CELL + CELL / 2;
      const cy = TOP + pr * CELL + CELL / 2;
      const ddx = s.x - cx;
      const ddy = s.y - cy;
      const rr = PICK_R + BALL_R;
      if (ddx * ddx + ddy * ddy < rr * rr) {
        this.pick[pr * COLS + pc] = 0;
        this.gained++;
        this.events.push({ t: "pickup", sfx: "extraGood", x: cx, y: cy });
      }
    }
    if (s.y >= FLOOR - BALL_R && s.vy > 0) this.land(s);
  }

  private wall(s: Shot) {
    if (this.sfxWall === 0) {
      this.sfxWall = 6;
      this.events.push({ t: "wall", sfx: "wall", x: s.x, y: s.y });
    }
  }

  private blockAt(x: number, y: number): number {
    const c0 = Math.max(0, Math.floor((x - BALL_R - LEFT) / CELL));
    const c1 = Math.min(COLS - 1, Math.floor((x + BALL_R - LEFT) / CELL));
    const r0 = Math.max(0, Math.floor((y - BALL_R - TOP) / CELL));
    const r1 = Math.min(ROWS - 1, Math.floor((y + BALL_R - TOP) / CELL));
    for (let r = r0; r <= r1; r++)
      for (let c = c0; c <= c1; c++) {
        const cell = r * COLS + c;
        if (this.hp[cell] <= 0) continue;
        const q = cellRect(c, r);
        if (x > q.x0 - BALL_R && x < q.x1 + BALL_R && y > q.y0 - BALL_R && y < q.y1 + BALL_R) return cell;
      }
    return -1;
  }

  private hit(cell: number, s: Shot) {
    const c = cell % COLS;
    const r = Math.floor(cell / COLS);
    const cx = LEFT + c * CELL + CELL / 2;
    const cy = TOP + r * CELL + CELL / 2;
    this.hp[cell]--;
    if (this.hp[cell] <= 0) {
      this.broken++;
      this.score++;
      this.events.push({ t: "break", sfx: "brickgone", x: cx, y: cy, id: this.ids[cell], max: this.maxHp[cell], shake: this.maxHp[cell] >= 20 ? 3 : undefined });
    } else {
      const e: GameEvent = { t: "hit", x: s.x, y: s.y, id: this.ids[cell], hp: this.hp[cell] };
      if (!this.sfxHit) {
        e.sfx = "brick";
        this.sfxHit = true;
      }
      this.events.push(e);
    }
  }

  // -------------------------------------------------------------- turn end

  private startShift() {
    this.phase = "shift";
    this.phaseT = 0;
    this.shots = [];
    this.launcherX = this.nextX;
    this.balls += this.gained;
    this.gained = 0;
    this.turnsSurvived++;
    this.score++;
    this.turn++;
    let any = false;
    for (let i = 0; i < COLS * ROWS; i++) if (this.hp[i] > 0) any = true;
    if (!any) this.events.push({ t: "clear", sfx: "extraGood", mood: "happy", x: FIELD_W / 2, y: FIELD_H / 2 });
    this.shiftDown();
    this.spawnRow();
    // +1 rings that reach the bottom row are collected for free.
    for (let c = 0; c < COLS; c++) {
      const cell = (ROWS - 1) * COLS + c;
      if (this.pick[cell]) {
        this.pick[cell] = 0;
        this.balls++;
        this.events.push({ t: "pickup", sfx: "extraGood", x: LEFT + c * CELL + CELL / 2, y: TOP + (ROWS - 1) * CELL + CELL / 2 });
      }
    }
  }

  private endShift() {
    let dead = false;
    let danger = false;
    for (let c = 0; c < COLS; c++) {
      if (this.hp[(ROWS - 1) * COLS + c] > 0) dead = true;
      if (this.hp[(ROWS - 2) * COLS + c] > 0) danger = true;
    }
    if (dead) {
      this.phase = "over";
      this.phaseT = 0;
      this.events.push({ t: "over", sfx: "lost", mood: "sad", shake: 10, x: this.launcherX, y: LAUNCH_Y });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    this.phase = "aim";
    this.phaseT = 0;
    this.armed = false;
    if (this.turn % 10 === 0) this.events.push({ t: "milestone", turn: this.turn, sfx: "levelclear", mood: "happy", toast: "levelClear" });
    else if (danger) this.events.push({ t: "danger", sfx: "extraBad", mood: "sad", shake: 2 });
  }

  // -------------------------------------------------------------- outputs

  view(): BarrageView {
    const blocks: BlockV[] = [];
    const pickups: { c: number; r: number }[] = [];
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        if (this.hp[i] > 0) blocks.push({ id: this.ids[i], c, r, hp: this.hp[i], max: this.maxHp[i] });
        if (this.pick[i]) pickups.push({ c, r });
      }
    const dragging = this.armed && (this.prevB & BTN.FIRE) !== 0;
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      turn: this.turn,
      score: this.score,
      broken: this.broken,
      turnsSurvived: this.turnsSurvived,
      balls: this.balls,
      gained: this.gained,
      queued: this.phase === "fly" ? this.toLaunch : this.phase === "aim" ? this.balls : 0,
      launcherX: this.launcherX,
      nextX: this.nextX,
      firstLanded: this.firstLanded,
      aim: { x: this.aimX, y: this.aimY, valid: this.aimValid, dragging, pointerMode: this.pointerMode },
      showGuide: this.phase === "aim" && this.aimValid && (!this.pointerMode || dragging),
      blocks,
      pickups,
      shots: this.shots.map((s) => ({ x: s.x, y: s.y, landed: s.landed })),
      shiftT: this.phase === "shift" ? Math.min(1, this.phaseT / SHIFT_FRAMES) : 1,
      speed: this.speed,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.turn, label: `x${this.balls} balls` };
  }
  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

// ---------------------------------------------------------------- def + bot

/** Where the bot points: the lowest block (most dangerous), sometimes a low +1 ring, with a little wobble. */
export function botTarget(v: BarrageView): { x: number; y: number } {
  let best: BlockV | null = null;
  for (const b of v.blocks) if (!best || b.r > best.r || (b.r === best.r && b.hp < best.hp)) best = b;
  let tx = FIELD_W / 2;
  let ty = TOP + CELL * 2;
  if (best) {
    tx = LEFT + best.c * CELL + CELL / 2;
    ty = TOP + best.r * CELL + CELL - GAP;
  }
  if (v.pickups.length && v.turn % 3 === 0) {
    let p = v.pickups[0];
    for (const q of v.pickups) if (q.r > p.r) p = q;
    if (!best || p.r >= best.r - 1) {
      tx = LEFT + p.c * CELL + CELL / 2;
      ty = TOP + p.r * CELL + CELL / 2;
    }
  }
  tx += ((v.turn * 37) % 23) - 11;
  if (ty > LAUNCH_Y - 20) ty = LAUNCH_Y - 20;
  return { x: Math.round(Math.max(0, Math.min(FIELD_W - 1, tx))), y: Math.round(ty) };
}

export const barrage: GameDef<BarrageView> = {
  id: "barrage",
  name: "Ball Barrage",
  tagline: "Aim once, fire a stream of coins, crack every number before the wall comes down.",
  genre: "Aim-and-fire block breaker",
  session: "3–10 min",
  controls:
    "Drag up from anywhere to aim (dots show the first bounce) and release to fire. Keyboard: ← / → aim, Space to fire. Grab +1 rings for more balls; don't let a block reach the floor.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 40 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original game in the turn-based aim-and-fire block breaker genre: rules, row generation, physics and art written from scratch. No code, names, art or sounds from any commercial game.",
  },
  create: (seed) => new BarrageEngine(seed),
  bot(v) {
    const t = botTarget(v);
    if (v.phase !== "aim") return { x: t.x, y: t.y, b: 0 };
    if (v.phaseT < 20) return { x: t.x, y: t.y, b: 0 };
    if (v.phaseT < 30) return { x: t.x, y: t.y, b: BTN.FIRE };
    return { x: t.x, y: t.y, b: 0 };
  },
};
