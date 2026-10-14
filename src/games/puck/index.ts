/*
 * Air Puck: an original air-hockey duel against a grumpy bear.
 * ArcadePad, GPL-3.0-or-later. No code ported; written from scratch for the
 * genre (round mallets on a frictionless table, a puck, goals at both ends).
 *
 * Rules: portrait table, your goal at the bottom, the Bear's at the top. Your
 * round mallet moves freely in 2D inside your half; the puck bounces off the
 * rails and picks up the mallet's velocity on contact (circle-circle hits).
 * First to 7 wins the match and climbs a level (faster, sharper Bear that
 * starts banking shots); losing a match ends the run. Holding the puck in one
 * half for 8 seconds hands it to the other side.
 * Score: 100 per goal, 1000 per match won.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const PUCK_R = 13;
export const MALLET_R = 22;
export const GOAL_W = 124;
export const GOAL_L = (W - GOAL_W) / 2;
export const GOAL_R = (W + GOAL_W) / 2;
export const WIN_GOALS = 7;
export const MID = H / 2;

const PLAYER_SPEED = 12; // max mallet px per frame
const KEY_SPEED = 7; // arrow nudge of the target per frame
const PUCK_MAX = 15;
const FRICTION = 0.996;
const WALL_E = 0.86;
const HIT_E = 0.9;
const GOAL_PAUSE = 70;
const READY = 50;
const HOLD_LIMIT = 480; // frames the puck may stay in one half
const PLAYER_HOME = { x: W / 2, y: H - 80 };
const CPU_HOME_Y = 52;

export type Side = "player" | "cpu";

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export interface PuckState {
  phase: "ready" | "play" | "pause" | "over";
  timer: number;
  level: number; // 1-based
  you: number;
  bear: number;
  score: number;
  matches: number;
  hits: number;
  puck: Body;
  player: Body;
  cpu: Body;
  /** Who gets the puck at the next face-off. */
  faceoff: Side;
  hold: number;
  holdSide: Side;
  lastGoal: Side | null;
  cpuTarget: { x: number; y: number };
  cpuTimer: number;
  cpuErr: number;
  cpuAimX: number;
}

export interface PuckView {
  frame: number;
  phase: PuckState["phase"];
  timer: number;
  level: number;
  you: number;
  bear: number;
  score: number;
  hits: number;
  puck: Body;
  player: Body;
  cpu: Body;
  hold: number;
  holdSide: Side;
  lastGoal: Side | null;
}

/** Bear tuning per level: speed (px/frame), reaction (frames), aim error (px), bank-shot chance (/100). */
export function cpuSkill(level: number) {
  const n = level - 1;
  return {
    speed: Math.min(11, 3.6 + 0.9 * n),
    react: Math.max(2, 16 - 3 * n),
    err: Math.max(3, 36 - 7 * n),
    bank: Math.min(45, 8 * n),
  };
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/** Where the puck crosses y = targetY (rail bounces folded in); x if it is not heading there. */
export function predictX(p: Body, targetY: number): number {
  if (p.vy === 0) return p.x;
  const t = (targetY - p.y) / p.vy;
  if (t <= 0) return p.x;
  const span = W - 2 * PUCK_R;
  const u = p.x + p.vx * t - PUCK_R;
  let m = ((u % (2 * span)) + 2 * span) % (2 * span);
  if (m > span) m = 2 * span - m;
  return PUCK_R + m;
}

/**
 * Mallet AI for the side whose goal is at y = 0 (the Bear). Callers mirror y
 * for the bottom side. aimX: x on the far goal line to shoot at (outside the
 * table = bank shot off a rail); err: px of misjudgement.
 */
export function aiTarget(puck: Body, m: Body, aimX: number, err: number, homeY: number): { x: number; y: number } {
  const reach = MALLET_R + PUCK_R;
  const inHalf = puck.y < MID + PUCK_R;
  if (inHalf && (puck.vy < 3 || puck.y < MID - 70)) {
    // Attack: line up behind the puck on the line to the aim point, then drive through it.
    let dx = aimX - puck.x;
    let dy = H + 30 - puck.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    dx /= d;
    dy /= d;
    if (puck.y < reach - 4) {
      // Puck pinned against our rail: sweep it out from the outside.
      const s = puck.x < W / 2 ? -1 : 1;
      return { x: puck.x + s * (reach - 6), y: puck.y + 4 };
    }
    const along = (m.x - puck.x) * dx + (m.y - puck.y) * dy; // < 0: we are behind it
    const side = (m.x - puck.x) * dy - (m.y - puck.y) * dx;
    if (along < -reach * 0.6 && Math.abs(side) < reach * 0.8) return { x: puck.x + dx * 24 + err * 0.3, y: puck.y + dy * 24 };
    // Swing round the side we are already on so we don't knock it into our own goal.
    const s = side >= 0 ? 1 : -1;
    let bx = puck.x - dx * (reach + 8) + dy * s * (along > -reach * 0.6 ? reach : 0);
    if (bx < MALLET_R || bx > W - MALLET_R) bx = puck.x - dx * (reach + 8) - dy * s * reach;
    return { x: bx + err, y: puck.y - dy * (reach + 8) };
  }
  // Defend: stand between the puck and our goal.
  let tx: number;
  if (puck.vy < -0.5) tx = clamp(predictX(puck, homeY), GOAL_L - 10, GOAL_R + 10);
  else tx = W / 2 + (puck.x - W / 2) * 0.45;
  return { x: tx + err, y: homeY };
}

const mirror = (b: Body): Body => ({ x: b.x, y: H - b.y, vx: b.vx, vy: -b.vy });

export class PuckEngine implements GameEngine<PuckView> {
  private rng: Rng;
  private tx = PLAYER_HOME.x;
  private ty = PLAYER_HOME.y;
  private lastPx = -1;
  private lastPy = -1;
  /** Mutable game state (exposed for rule tests). */
  s: PuckState;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.s = {
      phase: "ready",
      timer: 0,
      level: 1,
      you: 0,
      bear: 0,
      score: 0,
      matches: 0,
      hits: 0,
      puck: { x: W / 2, y: H * 0.7, vx: 0, vy: 0 },
      player: { x: PLAYER_HOME.x, y: PLAYER_HOME.y, vx: 0, vy: 0 },
      cpu: { x: W / 2, y: CPU_HOME_Y, vx: 0, vy: 0 },
      faceoff: "player",
      hold: 0,
      holdSide: "player",
      lastGoal: null,
      cpuTarget: { x: W / 2, y: CPU_HOME_Y },
      cpuTimer: 0,
      cpuErr: 0,
      cpuAimX: W / 2,
    };
    this.placePuck("player");
  }

  private placePuck(side: Side) {
    const s = this.s;
    s.puck = { x: W / 2, y: side === "player" ? H * 0.7 : H * 0.3, vx: 0, vy: 0 };
    s.phase = "ready";
    s.timer = 0;
    s.hold = 0;
    s.holdSide = side;
    s.hits = 0;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    const s = this.s;
    if (s.phase === "over") return;
    s.timer++;

    // Player target: arrows nudge it; otherwise it follows the pointer when the pointer moves.
    const keys = inp.b & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN);
    if (keys) {
      if (inp.b & BTN.LEFT) this.tx -= KEY_SPEED;
      if (inp.b & BTN.RIGHT) this.tx += KEY_SPEED;
      if (inp.b & BTN.UP) this.ty -= KEY_SPEED;
      if (inp.b & BTN.DOWN) this.ty += KEY_SPEED;
    } else if (this.lastPx >= 0 && (inp.x !== this.lastPx || inp.y !== this.lastPy)) {
      this.tx = inp.x;
      this.ty = inp.y;
    }
    this.lastPx = inp.x;
    this.lastPy = inp.y;
    this.tx = clamp(this.tx, MALLET_R, W - MALLET_R);
    this.ty = clamp(this.ty, MID + MALLET_R, H - MALLET_R);

    this.cpuThink();
    const sk = cpuSkill(s.level);
    const pOld = { x: s.player.x, y: s.player.y };
    const cOld = { x: s.cpu.x, y: s.cpu.y };
    const pNew = this.moveToward(s.player, this.tx, this.ty, PLAYER_SPEED, "player");
    const cNew = this.moveToward(s.cpu, s.cpuTarget.x, s.cpuTarget.y, sk.speed, "cpu");
    s.player.vx = pNew.x - pOld.x;
    s.player.vy = pNew.y - pOld.y;
    s.cpu.vx = cNew.x - cOld.x;
    s.cpu.vy = cNew.y - cOld.y;

    if (s.phase === "pause") {
      s.player.x = pNew.x; s.player.y = pNew.y;
      s.cpu.x = cNew.x; s.cpu.y = cNew.y;
      if (s.timer >= GOAL_PAUSE) this.placePuck(s.faceoff);
      return;
    }
    if (s.phase === "ready" && s.timer >= READY) {
      s.phase = "play";
      s.timer = 0;
      this.events.push({ t: "go", sfx: "launch", x: s.puck.x, y: s.puck.y });
    }

    // Substepped physics: mallets sweep from old to new position, puck moves, collide.
    const pk = s.puck;
    const sp = Math.max(Math.abs(pk.vx) + Math.abs(pk.vy), Math.abs(s.player.vx) + Math.abs(s.player.vy), Math.abs(s.cpu.vx) + Math.abs(s.cpu.vy));
    const n = Math.max(1, Math.ceil(sp / 4));
    const live = s.phase === "play";
    for (let k = 1; k <= n; k++) {
      s.player.x = pOld.x + ((pNew.x - pOld.x) * k) / n;
      s.player.y = pOld.y + ((pNew.y - pOld.y) * k) / n;
      s.cpu.x = cOld.x + ((cNew.x - cOld.x) * k) / n;
      s.cpu.y = cOld.y + ((cNew.y - cOld.y) * k) / n;
      if (live) {
        pk.x += pk.vx / n;
        pk.y += pk.vy / n;
      }
      this.collideMallet(s.player, "player");
      this.collideMallet(s.cpu, "cpu");
      const goal = this.rails();
      if (goal) {
        this.goal(goal);
        return;
      }
    }
    if (live) {
      pk.vx *= FRICTION;
      pk.vy *= FRICTION;
      // Holding rule.
      const half: Side = pk.y >= MID ? "player" : "cpu";
      if (half !== s.holdSide) {
        s.holdSide = half;
        s.hold = 0;
      } else if (++s.hold >= HOLD_LIMIT) {
        const other: Side = half === "player" ? "cpu" : "player";
        this.events.push({ t: "foul", side: half, sfx: "extraBad", x: pk.x, y: pk.y });
        s.faceoff = other;
        s.phase = "pause";
        s.timer = GOAL_PAUSE - 25;
        s.lastGoal = null;
      }
    }
  }

  private moveToward(m: Body, tx: number, ty: number, max: number, side: Side) {
    let dx = tx - m.x;
    let dy = ty - m.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d > max) {
      dx = (dx * max) / d;
      dy = (dy * max) / d;
    }
    const y0 = side === "player" ? MID + MALLET_R : MALLET_R;
    const y1 = side === "player" ? H - MALLET_R : MID - MALLET_R;
    return { x: clamp(m.x + dx, MALLET_R, W - MALLET_R), y: clamp(m.y + dy, y0, y1) };
  }

  private collideMallet(m: Body, side: Side) {
    const pk = this.s.puck;
    const dx = pk.x - m.x;
    const dy = pk.y - m.y;
    const rr = PUCK_R + MALLET_R;
    const d2 = dx * dx + dy * dy;
    if (d2 >= rr * rr) return;
    const d = Math.sqrt(d2);
    const nx = d > 0.0001 ? dx / d : 0;
    const ny = d > 0.0001 ? dy / d : side === "player" ? -1 : 1;
    pk.x = m.x + nx * rr;
    pk.y = m.y + ny * rr;
    const rvx = pk.vx - m.vx;
    const rvy = pk.vy - m.vy;
    const vn = rvx * nx + rvy * ny;
    if (vn < 0) {
      pk.vx -= (1 + HIT_E) * vn * nx;
      pk.vy -= (1 + HIT_E) * vn * ny;
      const sp = Math.sqrt(pk.vx * pk.vx + pk.vy * pk.vy);
      if (sp > PUCK_MAX) {
        pk.vx = (pk.vx * PUCK_MAX) / sp;
        pk.vy = (pk.vy * PUCK_MAX) / sp;
      }
      if (this.s.phase === "ready") {
        this.s.phase = "play";
        this.s.timer = 0;
      }
      const power = -vn;
      if (power > 1) {
        this.s.hits++;
        const smash = power >= 13;
        this.events.push({ t: "hit", side, sfx: "paddle", smash, shake: smash ? 5 : undefined, power, x: m.x + nx * MALLET_R, y: m.y + ny * MALLET_R });
      }
      if (side === "cpu") this.s.cpuTimer = Math.min(this.s.cpuTimer, 6);
    }
  }

  /** Rails, goal posts and goal mouths. Returns the side that scored, if any. */
  private rails(): Side | null {
    const pk = this.s.puck;
    const R = PUCK_R;
    if (pk.x < R) {
      pk.x = 2 * R - pk.x;
      this.wallHit(-pk.vx, 0, pk.y);
      pk.vx = Math.abs(pk.vx) * WALL_E;
    } else if (pk.x > W - R) {
      pk.x = 2 * (W - R) - pk.x;
      this.wallHit(pk.vx, W, pk.y);
      pk.vx = -Math.abs(pk.vx) * WALL_E;
    }
    const inMouth = pk.x > GOAL_L && pk.x < GOAL_R;
    if (pk.y < R) {
      if (!inMouth) {
        pk.y = 2 * R - pk.y;
        this.wallHit(-pk.vy, pk.x, 0);
        pk.vy = Math.abs(pk.vy) * WALL_E;
      } else {
        this.post(GOAL_L, 0);
        this.post(GOAL_R, 0);
        if (pk.y < 0) pk.x = clamp(pk.x, GOAL_L + R, GOAL_R - R);
        if (pk.y < -R) return "player";
      }
    } else if (pk.y > H - R) {
      if (!inMouth) {
        pk.y = 2 * (H - R) - pk.y;
        this.wallHit(pk.vy, pk.x, H);
        pk.vy = -Math.abs(pk.vy) * WALL_E;
      } else {
        this.post(GOAL_L, H);
        this.post(GOAL_R, H);
        if (pk.y > H) pk.x = clamp(pk.x, GOAL_L + R, GOAL_R - R);
        if (pk.y > H + R) return "cpu";
      }
    }
    return null;
  }

  private wallHit(speed: number, x: number, y: number) {
    if (speed > 1.5) this.events.push({ t: "wall", sfx: "wall", x, y, power: speed });
  }

  private post(px: number, py: number) {
    const pk = this.s.puck;
    const dx = pk.x - px;
    const dy = pk.y - py;
    const d2 = dx * dx + dy * dy;
    if (d2 >= PUCK_R * PUCK_R || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d, ny = dy / d;
    pk.x = px + nx * PUCK_R;
    pk.y = py + ny * PUCK_R;
    const vn = pk.vx * nx + pk.vy * ny;
    if (vn < 0) {
      pk.vx -= (1 + WALL_E) * vn * nx;
      pk.vy -= (1 + WALL_E) * vn * ny;
      this.wallHit(-vn, px, py);
    }
  }

  private cpuThink() {
    const s = this.s;
    const sk = cpuSkill(s.level);
    if (s.phase === "pause" || (s.phase === "ready" && s.puck.y > MID)) {
      s.cpuTarget = { x: W / 2, y: CPU_HOME_Y };
      return;
    }
    if (--s.cpuTimer <= 0) {
      s.cpuTimer = sk.react;
      s.cpuErr = this.rng.range(-sk.err, sk.err);
      // Pick a shot: mostly at the goal, sometimes a bank off a rail.
      if (this.rng.int(100) < sk.bank) s.cpuAimX = this.rng.int(2) ? -W / 2 + this.rng.range(-20, 20) : W * 1.5 + this.rng.range(-20, 20);
      else s.cpuAimX = W / 2 + this.rng.range(-GOAL_W / 3, GOAL_W / 3);
    }
    s.cpuTarget = aiTarget(s.puck, s.cpu, s.cpuAimX, s.cpuErr, CPU_HOME_Y);
  }

  private goal(scorer: Side) {
    const s = this.s;
    const x = clamp(s.puck.x, GOAL_L, GOAL_R);
    s.lastGoal = scorer;
    if (scorer === "player") {
      s.score += 100;
      s.you++;
      const matchWon = s.you >= WIN_GOALS;
      this.events.push({ t: "goal", side: "player", sfx: matchWon ? undefined : "brickgone", mood: "happy", shake: 6, popup: "+100", x, y: 0 });
      if (matchWon) {
        s.score += 1000;
        s.matches++;
        s.level++;
        s.you = 0;
        s.bear = 0;
        this.events.push({ t: "levelclear", sfx: "levelclear", mood: "happy", toast: "levelClear", level: s.level, popup: "+1000" });
      }
      s.faceoff = "cpu";
    } else {
      s.bear++;
      if (s.bear >= WIN_GOALS) {
        s.phase = "over";
        this.events.push({ t: "goal", side: "cpu", shake: 8, x, y: H });
        this.events.push({ t: "lost", sfx: "lost", mood: "sad", shake: 8, x, y: H });
        this.events.push({ t: "gameover", sfx: "gameover" });
        return;
      }
      this.events.push({ t: "goal", side: "cpu", sfx: "extraBad", mood: "sad", shake: 8, x, y: H });
      s.faceoff = "player";
    }
    s.phase = "pause";
    s.timer = 0;
  }

  view(): PuckView {
    const s = this.s;
    return {
      frame: this.frame,
      phase: s.phase,
      timer: s.timer,
      level: s.level,
      you: s.you,
      bear: s.bear,
      score: s.score,
      hits: s.hits,
      puck: { ...s.puck },
      player: { ...s.player },
      cpu: { ...s.cpu },
      hold: s.hold,
      holdSide: s.holdSide,
      lastGoal: s.lastGoal,
    };
  }
  hud(): Hud {
    return { score: this.s.score, level: this.s.level, label: `You ${this.s.you} – ${this.s.bear} Bear` };
  }
  result(): GameResult {
    const s = this.s;
    return { score: s.score, level: s.level - 1, levelsCleared: s.matches, frames: this.frame, status: s.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.s.phase === "over";
  }
}

export const puck: GameDef<PuckView> = {
  id: "puck",
  name: "Air Puck",
  tagline: "Slam the coin past the grumpy Bear. First to 7 climbs the ladder.",
  genre: "Air hockey",
  session: "2–8 min",
  controls: "Mouse or touch moves your mallet (or arrow keys). Hit the puck into the top goal.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the air-hockey genre (round mallets, circle collisions, goals at both ends). No code, art, sounds or names taken from any commercial game.",
  },
  create: (seed) => new PuckEngine(seed),
  bot(v, frame) {
    // Same playbook as the Bear, mirrored, with a drifting deterministic wobble and slower aim changes.
    const wobble = ((((frame >> 5) * 37) % 81) - 40) * 1.2;
    const aimX = W / 2 + ((((frame >> 7) * 53) % 61) - 30);
    const t = aiTarget(mirror(v.puck), mirror(v.player), aimX, wobble, CPU_HOME_Y + 10);
    return { x: Math.round(clamp(t.x, 0, W)), y: Math.round(clamp(H - t.y, 0, H)), b: 0 };
  },
};
