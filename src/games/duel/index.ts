/*
 * Paddle Duel: an original two-paddle ball duel against a grumpy bear.
 * ArcadePad, GPL-3.0-or-later. No code ported; written from scratch for the
 * genre (two paddles, a ball, first to 5 points).
 *
 * Rules: portrait field, you at the bottom, the Bear CPU at the top. Where the
 * ball meets the paddle sets the bounce angle; every rally hit speeds the ball
 * up. Power-up coins drift across the court; the ball that touches one gives
 * it to whoever hit that ball last (Big paddle, Multi-ball, Slow ball).
 * First to 5 wins the match and climbs a level (faster, sharper Bear); losing
 * a match ends the run.
 */
import { Rng } from "../core/rng.ts";
import { cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const PADDLE_H = 12;
export const PADDLE_W = 64;
export const BIG_W = 96;
export const BALL_R = 8;
export const COIN_R = 10;
/** Top edge of the player paddle / CPU paddle. */
export const PLAYER_Y = H - 44;
export const CPU_Y = 32;
export const WIN_POINTS = 5;

const PLAYER_SPEED = 9; // max paddle px per frame (pointer follow)
const KEY_SPEED = 9; // arrow nudge of the target per frame
const MAX_SPEED = 12;
const SPEED_UP = 0.3;
const MAX_ANGLE = 40; // byte-angle deflection at the paddle edge (~56 degrees)
const SMASH_SPEED = 7.5;
const EFFECT_FRAMES = 600;
const MAX_BALLS = 3;
const AUTO_SERVE = 300;
const CPU_SERVE = 50;
const POINT_PAUSE = 40;

export type Side = "player" | "cpu";
export type PowerKind = "big" | "multi" | "slow";
export const POWER_KINDS: readonly PowerKind[] = ["big", "multi", "slow"];

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  owner: Side; // last paddle that hit (or served) this ball
}
export interface PowerCoin {
  x: number;
  y: number;
  vx: number;
  kind: PowerKind;
}
export interface Paddle {
  x: number; // centre
  w: number;
  big: number; // frames of Big left
}

export interface DuelState {
  phase: "serve" | "play" | "pause" | "over";
  server: Side;
  timer: number; // frames in the current phase
  level: number; // 1-based
  you: number;
  bear: number;
  score: number;
  matches: number;
  rally: number;
  balls: Ball[];
  coins: PowerCoin[];
  coinTimer: number;
  player: Paddle;
  cpu: Paddle;
  cpuTarget: number;
  cpuTimer: number;
  cpuAim: number;
}

export interface DuelView {
  frame: number;
  phase: DuelState["phase"];
  server: Side;
  timer: number;
  level: number;
  you: number;
  bear: number;
  score: number;
  rally: number;
  balls: readonly Ball[];
  coins: readonly PowerCoin[];
  player: Paddle;
  cpu: Paddle;
}

/**
 * Level tuning for the Bear: max speed (px/frame), reaction (frames), aim
 * error (px), vision (px from its paddle within which it reads bounces).
 */
export function cpuSkill(level: number) {
  const n = level - 1;
  return {
    speed: Math.min(6.5, 2.6 + 0.35 * n),
    react: Math.max(4, 14 - 1.5 * n),
    err: Math.max(20, 30 - 2 * n),
    vision: Math.min(420, 220 + 40 * n),
    baseSpeed: Math.min(7, 5 + 0.25 * n),
  };
}

/** Where a ball will cross the line y = targetY, folding wall bounces in. */
export function predictX(b: { x: number; y: number; vx: number; vy: number }, targetY: number): number {
  if (b.vy === 0) return b.x;
  const t = (targetY - b.y) / b.vy;
  if (t <= 0) return b.x;
  const span = W - 2 * BALL_R;
  const u = b.x + b.vx * t - BALL_R;
  let m = ((u % (2 * span)) + 2 * span) % (2 * span);
  if (m > span) m = 2 * span - m;
  return BALL_R + m;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class DuelEngine implements GameEngine<DuelView> {
  private rng: Rng;
  private prevB = 0;
  private tx = W / 2;
  private lastPointerX = W / 2;
  /** Mutable game state (exposed for rule tests). */
  s: DuelState;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.s = {
      phase: "serve",
      server: "player",
      timer: 0,
      level: 1,
      you: 0,
      bear: 0,
      score: 0,
      matches: 0,
      rally: 0,
      balls: [],
      coins: [],
      coinTimer: 0,
      player: { x: W / 2, w: PADDLE_W, big: 0 },
      cpu: { x: W / 2, w: PADDLE_W, big: 0 },
      cpuTarget: W / 2,
      cpuTimer: 0,
      cpuAim: 0,
    };
    this.resetServe("player");
  }

  private resetServe(server: Side) {
    const s = this.s;
    s.phase = "serve";
    s.server = server;
    s.timer = 0;
    s.rally = 0;
    s.coins = [];
    s.coinTimer = this.rng.range(360, 720);
    s.balls = [{ x: 0, y: 0, vx: 0, vy: 0, speed: cpuSkill(s.level).baseSpeed, owner: server }];
    this.stickBall();
  }

  private stickBall() {
    const s = this.s;
    const b = s.balls[0];
    if (s.server === "player") {
      b.x = s.player.x;
      b.y = PLAYER_Y - BALL_R - 1;
    } else {
      b.x = s.cpu.x;
      b.y = CPU_Y + PADDLE_H + BALL_R + 1;
    }
  }

  private launch(angle: number) {
    const b = this.s.balls[0];
    b.vx = b.speed * cos256(angle);
    b.vy = b.speed * sin256(angle);
    this.s.phase = "play";
    this.s.timer = 0;
    this.events.push({ t: "serve", sfx: "launch", x: b.x, y: b.y });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    const s = this.s;
    if (s.phase === "over") return;
    s.timer++;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    // Player paddle: arrows nudge the target, otherwise follow the pointer when it moves.
    if (inp.b & BTN.LEFT) this.tx -= KEY_SPEED;
    if (inp.b & BTN.RIGHT) this.tx += KEY_SPEED;
    if (!(inp.b & (BTN.LEFT | BTN.RIGHT)) && inp.x !== this.lastPointerX) this.tx = inp.x;
    this.lastPointerX = inp.x;
    this.tx = clamp(this.tx, 0, W);
    this.movePaddle(s.player, this.tx, PLAYER_SPEED);
    this.tickEffect(s.player);
    this.tickEffect(s.cpu);
    this.cpuThink();

    if (s.phase === "pause") {
      if (s.timer >= POINT_PAUSE) this.resetServe(s.server);
      return;
    }
    if (s.phase === "serve") {
      this.stickBall();
      if (s.server === "player") {
        if (((pressed & (BTN.FIRE | BTN.UP)) && s.timer > 10) || s.timer >= AUTO_SERVE) this.launch(192 + this.rng.range(-12, 12));
      } else if (s.timer >= CPU_SERVE) {
        this.launch(64 + this.rng.range(-14, 14));
      }
      return;
    }

    // Play
    for (let i = 0; i < s.balls.length; i++) {
      const out = this.moveBall(s.balls[i]);
      if (out) {
        this.pointTo(out === "top" ? "player" : "cpu", s.balls[i]);
        return;
      }
    }
    this.moveCoins();
  }

  private tickEffect(p: Paddle) {
    if (p.big > 0 && --p.big === 0) p.w = PADDLE_W;
  }

  private movePaddle(p: Paddle, target: number, maxSpeed: number) {
    const d = clamp(target - p.x, -maxSpeed, maxSpeed);
    p.x = clamp(p.x + d, p.w / 2, W - p.w / 2);
  }

  private cpuThink() {
    const s = this.s;
    const sk = cpuSkill(s.level);
    if (--s.cpuTimer <= 0) {
      s.cpuTimer = sk.react;
      // Most urgent ball heading up.
      let threat: Ball | null = null;
      for (const b of s.balls) if (b.vy < 0 && (!threat || b.y < threat.y)) threat = b;
      if (s.phase === "play" && threat) {
        // Fast balls are harder to read and long rallies tire the Bear: the aim error grows with both.
        const e = Math.round(sk.err * (0.5 + threat.speed / 6) * (1 + s.rally / 30));
        const err = this.rng.range(-e, e);
        // Out of its vision the Bear just follows the ball; close up it reads the bounce.
        s.cpuTarget = threat.y - CPU_Y > sk.vision ? threat.x : predictX(threat, CPU_Y + PADDLE_H + BALL_R) + err - s.cpuAim;
      } else if (s.phase === "serve" && s.server === "cpu") {
        s.cpuTarget = W / 2 + this.rng.range(-60, 60);
      } else {
        s.cpuTarget = W / 2;
        // Pick a fresh aim offset for the next return: smarter Bears aim away from you.
        const off = this.rng.range(0, Math.floor(s.cpu.w * 0.35));
        s.cpuAim = s.level >= 3 ? (s.player.x < W / 2 ? -off : off) : this.rng.int(2) ? off : -off;
      }
    }
    this.movePaddle(s.cpu, s.cpuTarget, sk.speed);
  }

  /** Move one ball with substeps; returns "top"/"bottom" when it leaves the court. */
  private moveBall(b: Ball): "top" | "bottom" | null {
    const s = this.s;
    const n = Math.ceil(b.speed / 4);
    for (let k = 0; k < n; k++) {
      b.x += b.vx / n;
      b.y += b.vy / n;
      if (b.x < BALL_R) {
        b.x = 2 * BALL_R - b.x;
        b.vx = Math.abs(b.vx);
        this.events.push({ t: "wall", sfx: "wall", x: 0, y: b.y });
      } else if (b.x > W - BALL_R) {
        b.x = 2 * (W - BALL_R) - b.x;
        b.vx = -Math.abs(b.vx);
        this.events.push({ t: "wall", sfx: "wall", x: W, y: b.y });
      }
      if (b.vy > 0 && this.hitsPaddle(b, s.player, PLAYER_Y)) this.bounce(b, s.player, "player");
      else if (b.vy < 0 && this.hitsPaddle(b, s.cpu, CPU_Y)) this.bounce(b, s.cpu, "cpu");
      if (b.y < -BALL_R) return "top";
      if (b.y > H + BALL_R) return "bottom";
    }
    return null;
  }

  private hitsPaddle(b: Ball, p: Paddle, py: number) {
    return b.y + BALL_R >= py && b.y - BALL_R <= py + PADDLE_H && b.x >= p.x - p.w / 2 - BALL_R && b.x <= p.x + p.w / 2 + BALL_R;
  }

  private bounce(b: Ball, p: Paddle, side: Side) {
    const s = this.s;
    const rel = clamp((b.x - p.x) / (p.w / 2 + BALL_R), -1, 1);
    const off = Math.round(rel * MAX_ANGLE);
    b.speed = Math.min(MAX_SPEED, b.speed + SPEED_UP);
    const a = side === "player" ? 192 + off : 64 - off;
    b.vx = b.speed * cos256(a);
    b.vy = b.speed * sin256(a);
    b.y = side === "player" ? PLAYER_Y - BALL_R : CPU_Y + PADDLE_H + BALL_R;
    b.owner = side;
    s.rally++;
    const smash = b.speed >= SMASH_SPEED && (rel > 0.6 || rel < -0.6);
    this.events.push({ t: "paddle", sfx: "paddle", side, smash, shake: smash ? 6 : undefined, x: b.x, y: b.y, rally: s.rally });
    if (side === "cpu") s.cpuTimer = 1; // re-plan after its own return
  }

  private moveCoins() {
    const s = this.s;
    if (s.coins.length === 0 && --s.coinTimer <= 0) {
      const fromLeft = this.rng.int(2) === 0;
      s.coins.push({
        x: fromLeft ? -COIN_R : W + COIN_R,
        y: this.rng.range(220, 380),
        vx: fromLeft ? 1.1 : -1.1,
        kind: POWER_KINDS[this.rng.int(3)],
      });
      s.coinTimer = this.rng.range(420, 780);
    }
    for (let i = s.coins.length - 1; i >= 0; i--) {
      const c = s.coins[i];
      c.x += c.vx;
      if (c.x < -COIN_R * 2 || c.x > W + COIN_R * 2) {
        s.coins.splice(i, 1);
        continue;
      }
      const rr = (COIN_R + BALL_R) * (COIN_R + BALL_R);
      for (const b of s.balls) {
        const dx = b.x - c.x, dy = b.y - c.y;
        if (dx * dx + dy * dy <= rr) {
          s.coins.splice(i, 1);
          this.applyPower(c, b);
          break;
        }
      }
    }
  }

  private applyPower(c: PowerCoin, b: Ball) {
    const s = this.s;
    const who = b.owner;
    if (c.kind === "big") {
      const p = who === "player" ? s.player : s.cpu;
      p.w = BIG_W;
      p.big = EFFECT_FRAMES;
    } else if (c.kind === "multi") {
      for (const d of [-16, 16]) {
        if (s.balls.length >= MAX_BALLS) break;
        const a = (who === "player" ? 192 : 64) + d;
        s.balls.push({ x: b.x, y: b.y, vx: b.speed * cos256(a), vy: b.speed * sin256(a), speed: b.speed, owner: who });
      }
    } else {
      const base = cpuSkill(s.level).baseSpeed;
      for (const o of s.balls) {
        const ns = Math.max(base, o.speed * 0.7);
        const k = ns / o.speed;
        o.vx *= k;
        o.vy *= k;
        o.speed = ns;
      }
    }
    this.events.push({ t: "power", sfx: "extraGood", mood: who === "player" ? "happy" : undefined, kind: c.kind, side: who, x: c.x, y: c.y });
  }

  private pointTo(winner: Side, b: Ball) {
    const s = this.s;
    const x = clamp(b.x, 20, W - 20);
    if (winner === "player") {
      const pts = 100 + Math.min(s.rally, 30) * 10;
      s.score += pts;
      s.you++;
      const matchWon = s.you >= WIN_POINTS;
      this.events.push({ t: "point", side: "player", sfx: matchWon ? undefined : "brickgone", mood: "happy", popup: `+${pts}`, x, y: 24 });
      if (matchWon) {
        s.score += 1000;
        s.matches++;
        s.level++;
        s.you = 0;
        s.bear = 0;
        s.player.w = PADDLE_W; s.player.big = 0;
        s.cpu.w = PADDLE_W; s.cpu.big = 0;
        this.events.push({ t: "levelclear", sfx: "levelclear", mood: "happy", toast: "levelClear", level: s.level, popup: "+1000" });
      }
      this.pause("cpu");
    } else {
      s.bear++;
      if (s.bear >= WIN_POINTS) {
        s.phase = "over";
        s.balls = [];
        s.coins = [];
        this.events.push({ t: "lost", sfx: "lost", mood: "sad", shake: 8, x, y: H - 24 });
        this.events.push({ t: "gameover", sfx: "gameover" });
        return;
      }
      this.events.push({ t: "point", side: "cpu", sfx: "extraBad", mood: "sad", shake: 4, x, y: H - 24 });
      this.pause("player");
    }
  }

  private pause(nextServer: Side) {
    const s = this.s;
    s.phase = "pause";
    s.server = nextServer;
    s.timer = 0;
    s.balls = [];
    s.coins = [];
  }

  view(): DuelView {
    const s = this.s;
    return {
      frame: this.frame,
      phase: s.phase,
      server: s.server,
      timer: s.timer,
      level: s.level,
      you: s.you,
      bear: s.bear,
      score: s.score,
      rally: s.rally,
      balls: s.balls.map((b) => ({ ...b })),
      coins: s.coins.map((c) => ({ ...c })),
      player: { ...s.player },
      cpu: { ...s.cpu },
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

export const duel: GameDef<DuelView> = {
  id: "duel",
  name: "Paddle Duel",
  tagline: "Out-rally the grumpy Bear. First to 5 climbs the ladder.",
  genre: "Paddle duel",
  session: "2–8 min",
  controls: "Mouse, touch or ← →. Click / Space to serve.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the two-paddle ball duel genre. No code, art, sounds or names taken from any commercial game.",
  },
  create: (seed) => new DuelEngine(seed),
  bot(v, frame) {
    // Serve when it's our turn (pulse FIRE so it registers as a press).
    if (v.phase === "serve" && v.server === "player") return { x: Math.round(v.player.x), y: H - 20, b: v.timer > 20 && (frame & 1) ? BTN.FIRE : 0 };
    let threat: Ball | null = null;
    for (const b of v.balls) if (b.vy > 0 && (!threat || b.y > threat.y)) threat = b;
    let target = W / 2;
    if (threat) {
      // Imperfect: a wobble that drifts with time, larger when the ball is fast.
      const wobble = ((((frame >> 4) * 37) % 41) - 20) * (0.5 + threat.speed / 8);
      target = predictX(threat, PLAYER_Y - BALL_R) + wobble;
    }
    return { x: Math.round(clamp(target, 0, W)), y: H - 20, b: 0 };
  },
};
