/*
 * game.ts - deterministic single-player LBreakout2 game logic.
 * Port of LBreakout2 (C) 2001-2015 Michael Speck and contributors,
 * GPL-2.0-or-later; this file GPL-3.0-or-later.
 *
 * Ported from game/balls.c, bricks.c, paddle.c, extras.c, shots.c and game.c
 * (local game, "Medium" difficulty, convex paddle, random launch angle,
 * automatic return of idle balls). Ball/brick collision is a swept
 * circle-vs-grid test instead of LBreakout2's tangent target prediction, with
 * LBreakout2's reflection rules (side/corner, corner entropy, angle masks,
 * 2-degree angle steps, chaos).
 *
 * Coordinates: field units, 640 x 480, origin top-left, y grows downwards.
 * Velocities are in px per ms like the original; one step is STEP_MS.
 */

import {
  BRICK_H, BRICK_W, FIELD_H, FIELD_W, MAP_H, MAP_W, STEP_MS,
} from "./types.ts";
import type {
  ActiveEffects, BallView, BrickKind, BrickView, ExtraView, FrameInput,
  GameEvent, GameStatus, GameView, LevelDef, PaddleView, RunConfig, RunResult,
  ShotView,
} from "./types.ts";
import { Rng } from "./rng.ts";
import { IMPACT_X, IMPACT_Y, vec2angle, vlen } from "./fmath.ts";
import {
  BRICK_CONV, BRICK_GROW_FIRST, BRICK_GROW_LAST, EDIT_H, EDIT_W,
  EX_BALL, EX_BONUS_MAGNET, EX_CHAOS, EX_DARKNESS, EX_DISABLE, EX_EXPL_BALL,
  EX_FAST, EX_FROZEN, EX_GHOST_PADDLE, EX_GOLDSHOWER, EX_JOKER, EX_LENGTHEN,
  EX_LIFE, EX_MALUS_MAGNET, EX_METAL, EX_NONE, EX_NUMBER, EX_RANDOM,
  EX_SCORE1000, EX_SCORE10000, EX_SCORE200, EX_SCORE2000, EX_SCORE500,
  EX_SCORE5000, EX_SHORTEN, EX_SLIME, EX_SLOW, EX_TIME_ADD, EX_WALL,
  EX_WEAK_BALL, EX_WEAPON, EXTRA_KINDS, INVIS_BRICK_ID,
  MAP_BRICK_CHAOS, MAP_BRICK_EXP, MAP_BRICK_GROW, MAP_BRICK_HEAL, MAP_EMPTY,
  MAP_WALL, brickConvIndex, extraFromChar, extraIsMalus, extraToChar,
} from "./level.ts";

/* ---------------------------------------------------------------- tuning */

/** LBreakout2 "Medium" difficulty (diffs[2] in game.c). */
const DIFF = {
  maxLives: 7,
  paddleMinLen: 0,
  paddleLen: 1,
  paddleMaxLen: 6,
  scoreMod: 10,
  vStart: 0.27,
  vAdd: 0.0016,
  vMax: 0.43,
  vDelay: 1800,
  allowMaluses: true,
  timeMod: 1,
};

const BALL_RAD = 6;
const BALL_DIA = 12;
const BALL_VH_MASK = 0.363970234; // tan(20 deg): flattest allowed direction
const BALL_VV_MASK = 5.67128182; // tan(80 deg): steepest allowed direction
const BALLS_IDLE_LIMIT = 10000;
const BALL_FIRE_RATE = 500;

const PADDLE_CW = 18;
const PADDLE_H = 18;
const PADDLE_Y = (MAP_H - 2) * BRICK_H; // 440
const PADDLE_RESIZE_DELAY = 40;
const PADDLE_INVIS_DELAY = 200;
const PADDLE_MAX_STEP = 28; // px per step toward input.x
const PADDLE_WEAPON_AMMO = 100;
const WEAPON_FIRE_RATE = 150;

const SHOT_W = 10;
const SHOT_H = 10;
const SHOT_VY = 0.2;
const EXTRA_V = 0.05;

const BRICK_EXP_TIME = 150;
const BRICK_HEAL_TIME = 4000;

const TIME_WALL = 10000;
const TIME_METAL = 5000;
const TIME_WEAPON = 5000;
const TIME_FROZEN = 1000;
const TIME_SLIME = 20000;
const TIME_FAST = 20000;
const TIME_SLOW = 20000;
const TIME_GOLDSHOWER = 20000;
const TIME_DARKNESS = 20000;
const TIME_CHAOS = 10000;
const TIME_GHOST_PADDLE = 20000;
const TIME_EXPL_BALL = 10000;
const TIME_BONUS_MAGNET = 20000;
const TIME_MALUS_MAGNET = 20000;
const TIME_WEAK_BALL = 10000;
const TIME_ADD = 7000;

/* Game Port additions (not in LBreakout2) */
const SERVE_AUTO_MS = 3000; // held balls are launched automatically
const LEVELCLEAR_MS = 1500;
const STALL_MS = 30000; // nudge balls if no destructible brick was hit
const MAX_FRAMES = 15 * 60 * 60; // 15 minutes of steps
export const LEVEL_CLEAR_BONUS = 2000;
export const WIN_BONUS = 10000;
export const WIN_BONUS_PER_LIFE = 5000;

const ATTRACT_NONE = 0;
const ATTRACT_BONUS = 1;
const ATTRACT_MALUS = 2;

const SIDE_TOP = 0;
const SIDE_BOTTOM = 1;
const SIDE_LEFT = 2;
const SIDE_RIGHT = 3;
const SIDE_CORNER = 4;

const PEN_TOL = 0.5; // px of penetration still resolved as a face hit
const CELLS = MAP_W * MAP_H;

/** Round and clamp a paddle x input to an integer in 0..FIELD_W. */
export function quantizeX(x: number): number {
  if (!Number.isFinite(x)) return FIELD_W >> 1;
  const q = Math.round(x);
  return q < 0 ? 0 : q > FIELD_W ? FIELD_W : q;
}

/* ---------------------------------------------------------------- types */

interface Ball {
  /** top-left (LBreakout2 ball->cur); relative to paddle when attached */
  x: number;
  y: number;
  vx: number;
  vy: number;
  attached: boolean;
  movingBack: boolean;
  idle: number;
}

interface Extra {
  type: number;
  x: number; // top-left of the 40x20 extra
  y: number;
}

interface Shot {
  x: number; // top-left of the 10x10 shot
  y: number;
}

interface Hit {
  t: number;
  c: number;
  r: number;
  side: number;
  px: number; // corner point for SIDE_CORNER
  py: number;
}

/* ------------------------------------------------------------------ game */

export class Game {
  private readonly cfg: RunConfig;
  private readonly levels: LevelDef[];
  private readonly rng: Rng;

  private frame = 0;
  private status: GameStatus = "serve";
  private levelIndex = 0;
  private maxLevel = 0;
  private levelsCleared = 0;
  private score = 0;
  private lives: number;
  private levelTitle = "";
  private levelClearTimer = 0;

  /* bricks, index = row * MAP_W + col */
  private readonly bType = new Int8Array(CELLS);
  private readonly bId = new Int16Array(CELLS);
  private readonly bDur = new Int16Array(CELLS);
  private readonly bExtra = new Int8Array(CELLS);
  private readonly bScore = new Int32Array(CELLS);
  private readonly bExp = new Float64Array(CELLS);
  private readonly bHeal = new Float64Array(CELLS);
  private readonly bChar: string[] = new Array<string>(CELLS).fill(" ");
  private expList: number[] = [];
  private healList: number[] = [];
  private bricksLeft = 0;

  /* timed extras (game and paddle extras share one table: one paddle) */
  private readonly exTime = new Float64Array(EX_NUMBER);
  private readonly exActive = new Uint8Array(EX_NUMBER);

  /** Current ball speed in px/ms (public for tests/tools only). */
  ballV = DIFF.vStart;
  private speedupLevel = 0;
  private speedupCur = 0;

  /* paddle */
  private padX = 0;
  private padW = 0;
  private padLen = 0;
  private padWantedW = 0;
  private padResizeCur = 0;
  private padInvis = false;
  private padInvisDelay = 0;
  private padFrozen = false;
  private padSlime = false;
  private padAttract = ATTRACT_NONE;
  private padWeapon = false;
  private padWeaponDelay = 0;
  private padAmmo = PADDLE_WEAPON_AMMO;
  private ballFireDelay = 0;
  private wallAlpha = 0;
  private wallActive = false;

  private balls: Ball[] = [];
  private extras: Extra[] = [];
  private shots: Shot[] = [];
  private holdTime = 0;
  private stallTime = 0;

  private readonly hit: Hit = { t: 0, c: 0, r: 0, side: 0, px: 0, py: 0 };
  private events: GameEvent[] = [];
  private bricksDirty = true;
  private brickViews: BrickView[] = [];
  private lastView: GameView | null = null;

  constructor(cfg: RunConfig) {
    this.cfg = cfg;
    this.levels = cfg.levels.slice();
    this.rng = new Rng(cfg.seed >>> 0);
    this.lives = cfg.lives !== undefined && cfg.lives > 0 ? Math.floor(cfg.lives) : 3;
    if (this.levels.length === 0) {
      this.status = "won";
      this.lastView = this.buildView();
      return;
    }
    const l = this.levels[0];
    this.startLevel(0, l.bricks, l.bonus);
    this.lastView = this.buildView();
  }

  get done(): boolean {
    return this.status === "gameover" || this.status === "won";
  }

  view(): GameView {
    if (this.lastView === null) this.lastView = this.buildView();
    return this.lastView;
  }

  result(): RunResult {
    return {
      score: this.score,
      level: this.maxLevel,
      levelsCleared: this.levelsCleared,
      frames: this.frame,
      status: this.status,
    };
  }

  /** Testing aid: force the ball speed (px/ms) of all moving balls. */
  setBallSpeed(v: number): void {
    this.ballV = v;
    for (const b of this.balls) if (!b.attached) this.setLen(b, v);
  }

  /** Advance one fixed step (STEP_MS). */
  step(input: FrameInput): GameView {
    this.events = [];
    if (this.done) {
      this.lastView = this.buildView();
      return this.lastView;
    }
    this.frame++;
    const ms = STEP_MS;

    if (this.status === "levelclear") {
      this.levelClearTimer -= ms;
      if (this.levelClearTimer <= 0) {
        this.levelIndex++;
        if (this.levelIndex > this.maxLevel) this.maxLevel = this.levelIndex;
        const l = this.levels[this.levelIndex];
        this.startLevel(this.levelIndex, l.bricks, l.bonus);
      }
    } else {
      const fire = input.fire === true;
      this.movePaddle(input.x);
      this.extrasUpdate(ms);
      this.wallsUpdate(ms);
      this.shotsUpdate(ms);
      this.bricksUpdate(ms);
      this.paddleUpdate(ms, fire);
      if (!this.paddleSolid()) this.detachBalls();
      this.ballsUpdate(ms, fire);
      this.stallUpdate(ms);

      if (this.bricksLeft <= 0) this.levelClear();
      else if (this.balls.length === 0) this.loseLife();
    }

    if (!this.done && this.frame >= MAX_FRAMES) {
      this.status = "gameover";
      this.events.push({ t: "gameover" });
    }
    this.lastView = this.buildView();
    return this.lastView;
  }

  /* ============================================================ levels */

  private startLevel(index: number, bricks: readonly string[], bonus: readonly string[]): void {
    this.levelIndex = index;
    if (index > this.maxLevel) this.maxLevel = index;
    this.levelTitle = this.levels[index].title;
    this.status = "serve";

    /* game_init + game_finalize + paddle_reset */
    this.exTime.fill(0);
    this.exActive.fill(0);
    this.ballV = DIFF.vStart;
    this.speedupLevel = 0;
    this.speedupCur = 0;
    this.padLen = DIFF.paddleLen;
    this.padW = (this.padLen + 2) * PADDLE_CW;
    this.padWantedW = this.padW;
    this.padResizeCur = 0;
    this.padX = (FIELD_W - this.padW) >> 1;
    this.padInvis = false;
    this.padInvisDelay = 0;
    this.padFrozen = false;
    this.padSlime = false;
    this.padAttract = ATTRACT_NONE;
    this.padWeapon = false;
    this.padWeaponDelay = 0;
    this.padAmmo = PADDLE_WEAPON_AMMO;
    this.ballFireDelay = 0;
    this.wallAlpha = 0;
    this.wallActive = false;
    this.extras = [];
    this.shots = [];
    this.holdTime = 0;
    this.stallTime = 0;

    /* one ball attached to the paddle */
    const b: Ball = {
      x: (this.padW - BALL_DIA) >> 1, y: -BALL_DIA, vx: 0, vy: 0,
      attached: true, movingBack: false, idle: 0,
    };
    this.setRandomAngle(b);
    this.balls = [b];

    this.initBricks(bricks, bonus);
  }

  /** bricks_init(): frame walls + 14x18 level at columns 1..14, rows 1..18. */
  private initBricks(bricks: readonly string[], bonus: readonly string[]): void {
    for (let i = 0; i < CELLS; i++) this.clearCell(i);
    this.expList = [];
    this.healList = [];
    for (let c = 0; c < MAP_W; c++) this.setWall(c);
    for (let r = 0; r < MAP_H; r++) {
      this.setWall(r * MAP_W);
      this.setWall(r * MAP_W + MAP_W - 1);
    }
    for (let j = 0; j < EDIT_H; j++) {
      const brow = bricks[j] ?? "";
      const xrow = bonus[j] ?? "";
      for (let i = 0; i < EDIT_W; i++) {
        const idx = (j + 1) * MAP_W + (i + 1);
        const k = brickConvIndex(brow.charAt(i));
        if (k >= 0) {
          this.setByConv(idx, k);
          this.bScore[idx] = (DIFF.scoreMod * BRICK_CONV[k].score / 10) | 0;
        }
        this.bExtra[idx] = extraFromChar(xrow.charAt(i));
      }
    }
    this.bricksLeft = 0;
    for (let r = 1; r < MAP_H - 1; r++)
      for (let c = 1; c < MAP_W - 1; c++) {
        const idx = r * MAP_W + c;
        if (this.bDur[idx] > 0) this.bricksLeft++;
        if (this.bType[idx] === MAP_BRICK_HEAL && this.bDur[idx] < 3) {
          this.bHeal[idx] = BRICK_HEAL_TIME * DIFF.timeMod;
          this.healList.push(idx);
        }
      }
    this.bricksDirty = true;
  }

  private clearCell(idx: number): void {
    this.bType[idx] = MAP_EMPTY;
    this.bId[idx] = -1;
    this.bDur[idx] = -1;
    this.bExtra[idx] = EX_NONE;
    this.bScore[idx] = 0;
    this.bExp[idx] = -1;
    this.bHeal[idx] = -1;
    this.bChar[idx] = " ";
  }

  private setWall(idx: number): void {
    this.bType[idx] = MAP_WALL;
    this.bId[idx] = 0;
    this.bDur[idx] = -1;
  }

  private setByConv(idx: number, k: number): void {
    const conv = BRICK_CONV[k];
    this.bType[idx] = conv.type;
    this.bId[idx] = conv.id;
    this.bDur[idx] = conv.dur;
    this.bChar[idx] = conv.c;
    this.bExp[idx] = -1;
    this.bHeal[idx] = -1;
  }

  /** Level snapshot (game_get_level_snapshot) used to restart after a life loss. */
  private snapshotRows(): { bricks: string[]; bonus: string[] } {
    const bricks: string[] = [];
    const bonus: string[] = [];
    for (let j = 0; j < EDIT_H; j++) {
      let br = "";
      let xr = "";
      for (let i = 0; i < EDIT_W; i++) {
        const idx = (j + 1) * MAP_W + (i + 1);
        const ch = this.bChar[idx];
        br += ch === " " ? "." : ch;
        xr += extraToChar(this.bExtra[idx]);
      }
      bricks.push(br);
      bonus.push(xr);
    }
    return { bricks, bonus };
  }

  private levelClear(): void {
    const last = this.levelIndex >= this.levels.length - 1;
    let bonus = LEVEL_CLEAR_BONUS;
    if (last) bonus += WIN_BONUS + WIN_BONUS_PER_LIFE * this.lives;
    this.score += bonus;
    this.levelsCleared++;
    this.events.push({ t: "levelclear", level: this.levelIndex, bonus });
    this.balls = [];
    this.extras = [];
    this.shots = [];
    if (last) {
      this.status = "won";
      this.events.push({ t: "won" });
    } else {
      this.status = "levelclear";
      this.levelClearTimer = LEVELCLEAR_MS;
    }
  }

  private loseLife(): void {
    this.lives--;
    this.events.push({ t: "lifelost", lives: this.lives });
    if (this.lives <= 0) {
      this.lives = 0;
      this.status = "gameover";
      this.events.push({ t: "gameover" });
      return;
    }
    const snap = this.snapshotRows();
    this.startLevel(this.levelIndex, snap.bricks, snap.bonus);
  }

  /* ============================================================ paddle */

  private movePaddle(rawX: number): void {
    if (this.padFrozen) return;
    const half = this.padW >> 1;
    let nx = quantizeX(rawX) - half;
    if (nx > this.padX + PADDLE_MAX_STEP) nx = this.padX + PADDLE_MAX_STEP;
    if (nx < this.padX - PADDLE_MAX_STEP) nx = this.padX - PADDLE_MAX_STEP;
    if (nx < BRICK_W) nx = BRICK_W;
    if (nx > FIELD_W - BRICK_W - this.padW) nx = FIELD_W - BRICK_W - this.padW;
    if (nx !== this.padX) {
      this.padX = nx;
      if (this.padInvis) this.padInvisDelay = PADDLE_INVIS_DELAY;
    }
  }

  private paddleSolid(): boolean {
    return !this.padInvis || this.padInvisDelay > 0;
  }

  private paddleInitResize(c: number): void {
    const len = this.padLen + c;
    if (len > DIFF.paddleMaxLen || len < DIFF.paddleMinLen) return;
    this.padLen = len;
    this.padWantedW = (len + 2) * PADDLE_CW;
    this.padResizeCur = 0;
  }

  /** paddle_update(): ghost delay, weapon, resize. */
  private paddleUpdate(ms: number, fire: boolean): void {
    if (this.padInvis && this.padInvisDelay > 0) {
      this.padInvisDelay -= ms;
      if (this.padInvisDelay <= 0) this.padInvisDelay = 0;
    }
    if (this.padWeapon && fire && this.padAmmo > 0) {
      this.padWeaponDelay -= ms;
      if (this.padWeaponDelay <= 0) {
        this.padWeaponDelay = WEAPON_FIRE_RATE;
        const s: Shot = {
          x: this.padX + (this.padW >> 1) - (SHOT_W >> 1),
          y: PADDLE_Y + (PADDLE_H >> 1) - (SHOT_H >> 1),
        };
        this.shots.push(s);
        this.padAmmo--;
        this.events.push({ t: "shot", x: s.x + (SHOT_W >> 1), y: s.y + (SHOT_H >> 1) });
      }
    }
    if (this.padW !== this.padWantedW) {
      this.padResizeCur += ms;
      if (this.padResizeCur >= PADDLE_RESIZE_DELAY) {
        this.padResizeCur = 0;
        let result: number;
        if (this.padW < this.padWantedW) {
          this.padW += 2;
          this.padX -= 1;
          if (this.padX < BRICK_W) this.padX = BRICK_W;
          if (this.padX + this.padW > FIELD_W - BRICK_W) this.padX = FIELD_W - BRICK_W - this.padW;
          result = 1;
        } else {
          this.padW -= 2;
          this.padX += 1;
          result = -1;
        }
        for (const b of this.balls)
          if (b.attached && b.x > (this.padW >> 1)) b.x += 2 * result;
      }
    }
  }

  /* ============================================================ balls */

  private setLen(b: Ball, len: number): void {
    const l = vlen(b.vx, b.vy);
    if (l === 0) return;
    b.vx = (b.vx / l) * len;
    b.vy = (b.vy / l) * len;
  }

  /** Only use 2 degree steps (vec2angle / angle2vec), then set speed. */
  private quantize(b: Ball): void {
    const a = vec2angle(b.vx, b.vy);
    b.vx = IMPACT_X[a];
    b.vy = IMPACT_Y[a];
    this.setLen(b, this.ballV);
  }

  /** ball_set_random_angle() for the bottom paddle. */
  private setRandomAngle(b: Ball): void {
    b.vy = -1;
    b.vx = this.rng.int(145) + 6;
    if (this.rng.int(2)) b.vx /= -100;
    else b.vx /= 100;
    const a = vec2angle(b.vx, b.vy);
    b.vx = IMPACT_X[a] * this.ballV;
    b.vy = IMPACT_Y[a] * this.ballV;
  }

  /** ball_mask_vel(): keep the direction between 20 and 80 degrees. */
  private maskVel(b: Ball, oldVx: number, entropy: boolean): void {
    if (b.vx === 0 && b.vy === 0) return;
    if (b.vx === 0) b.vx = oldVx < 0 ? 0.01 : -0.01;
    let level = 0;
    if (entropy) level = (this.rng.int(81) + 40) / 1000;
    const m = b.vy / b.vx;
    if (Math.abs(m) < BALL_VH_MASK) {
      b.vy = b.vy < 0 ? -Math.abs(BALL_VH_MASK * b.vx) : Math.abs(BALL_VH_MASK * b.vx);
      if (entropy) b.vx -= b.vx * level;
    } else if (Math.abs(m) > BALL_VV_MASK) {
      b.vx = b.vx < 0 ? -Math.abs(b.vy / BALL_VV_MASK) : Math.abs(b.vy / BALL_VV_MASK);
      if (entropy) b.vx += b.vx * level;
    } else if (entropy) {
      if (this.rng.int(2)) level = -level;
      b.vx += b.vx * level;
    }
    if (b.vx === b.vy) b.vx *= 0.98;
    this.setLen(b, this.ballV);
  }

  private attach(b: Ball): void {
    b.attached = true;
    b.idle = 0;
    b.movingBack = false;
    b.x -= this.padX;
    b.y -= PADDLE_Y;
    this.holdTime = 0;
  }

  /** balls_detach_from_paddle(); launch direction is the stored velocity. */
  private detachBalls(): boolean {
    let fired = false;
    for (const b of this.balls) {
      if (!b.attached) continue;
      const bx = Math.trunc(b.x);
      if (bx + this.padX < BRICK_W) continue;
      if (bx + BALL_DIA + this.padX >= FIELD_W - BRICK_W) continue;
      b.attached = false;
      b.movingBack = false;
      b.idle = 0;
      b.x = bx + this.padX;
      b.y = Math.trunc(b.y) + PADDLE_Y;
      fired = true;
    }
    if (fired) {
      this.events.push({ t: "launch" });
      if (this.status === "serve") this.status = "play";
      this.holdTime = 0;
    }
    return fired;
  }

  private ballsUpdate(ms: number, fire: boolean): void {
    let attachedCount = 0;
    for (const b of this.balls) if (b.attached) attachedCount++;
    if (attachedCount > 0) this.holdTime += ms;
    else this.holdTime = 0;

    this.ballFireDelay -= ms;
    if (this.ballFireDelay <= 0 && (fire || (attachedCount > 0 && this.holdTime >= SERVE_AUTO_MS))) {
      this.ballFireDelay = BALL_FIRE_RATE;
      this.detachBalls();
    }

    /* speed up */
    if (!this.exActive[EX_SLOW] && !this.exActive[EX_FAST] && this.ballV < DIFF.vMax) {
      this.speedupCur += ms;
      if (this.speedupCur >= DIFF.vDelay) {
        this.speedupCur = 0;
        this.ballV += DIFF.vAdd;
        this.speedupLevel++;
        for (const b of this.balls) if (!b.attached) this.setLen(b, this.ballV);
      }
    }

    const keep: Ball[] = [];
    for (const b of this.balls) {
      if (b.movingBack) this.moveBack(b, ms);
      if (!b.attached && !b.movingBack) {
        b.idle += ms;
        if (this.paddleContactPossible(b)) this.checkPaddleReflection(b);
        if (!b.attached) this.moveFree(b, ms);
        /* heading for the paddle soon: not idle */
        if (!b.attached && b.vy > 0 && b.y + BALL_DIA >= (MAP_H - 4) * BRICK_H && !this.exActive[EX_CHAOS])
          b.idle = 0;
        if (!b.attached && b.idle >= BALLS_IDLE_LIMIT && b.y + BALL_DIA < PADDLE_Y) {
          b.idle = 0;
          b.movingBack = true;
        }
      }
      if (!b.attached) {
        const bx = Math.trunc(b.x);
        const by = Math.trunc(b.y);
        if (bx >= FIELD_W || bx + BALL_DIA < 0 || by >= FIELD_H || by + BALL_DIA < 0) {
          this.events.push({ t: "balllost" });
          continue;
        }
      }
      keep.push(b);
    }
    this.balls = keep;
  }

  /** Idle ball flies back to the paddle (auto return of balls.c). */
  private moveBack(b: Ball, ms: number): void {
    b.vx = this.padX + (this.padW >> 1) - (b.x + BALL_RAD);
    b.vy = PADDLE_Y - BALL_RAD + 2 - (b.y + BALL_RAD);
    this.setLen(b, DIFF.vMax);
    b.x += b.vx * ms;
    b.y += b.vy * ms;
    const bx = Math.trunc(b.x);
    const by = Math.trunc(b.y);
    if (
      bx + BALL_RAD >= this.padX && bx + BALL_RAD < this.padX + this.padW &&
      by + BALL_DIA >= PADDLE_Y && by + BALL_DIA < PADDLE_Y + PADDLE_H
    ) {
      b.x = this.padX + (this.padW >> 1) - BALL_RAD;
      b.y = PADDLE_Y - BALL_DIA;
      this.attach(b);
      this.setRandomAngle(b);
    }
  }

  private paddleContactPossible(b: Ball): boolean {
    if (!this.paddleSolid()) return false;
    if (b.vy < 0) return false;
    const by = Math.trunc(b.y);
    if (by + BALL_DIA < PADDLE_Y) return false;
    if (by >= PADDLE_Y + (PADDLE_H >> 1)) return false;
    return true;
  }

  /** ball_check_paddle_reflection(): two hemispheres + middle, convex. */
  private checkPaddleReflection(b: Ball): void {
    const half = PADDLE_H >> 1;
    const cx = b.x + BALL_RAD;
    const cy = b.y + BALL_RAD;
    const lhx = this.padX + half;
    const lhy = PADDLE_Y + half;
    const rhx = this.padX + this.padW - half;
    const rhy = PADDLE_Y + half;
    const hemiR = BALL_RAD + half;
    let pty = PADDLE_Y - BALL_RAD;
    let ptx = cx + (pty - cy) / (b.vy / b.vx);
    let contact = false;
    if (ptx < lhx || ptx > rhx) {
      const hx = ptx < lhx ? lhx : rhx;
      const hy = ptx < lhx ? lhy : rhy;
      const l = vlen(b.vx, b.vy);
      const nx = b.vx / l;
      const ny = b.vy / l;
      const dx = cx - hx;
      const dy = cy - hy;
      const dv = dx * nx + dy * ny;
      let dis = dv * dv + hemiR * hemiR - (dx * dx + dy * dy);
      if (dis >= 0 && vlen(dx, dy) <= hemiR) {
        dis = Math.sqrt(dis);
        const t1 = -dv + dis;
        const t2 = -dv - dis;
        const y1 = cy + t1 * ny;
        const y2 = cy + t2 * ny;
        /* use the higher point as this is the upper intersection */
        if (y1 > y2) { ptx = cx + t2 * nx; pty = y2; }
        else { ptx = cx + t1 * nx; pty = y1; }
        contact = true;
      }
    } else {
      contact = true;
    }
    if (!contact) return;
    b.idle = 0;
    if (this.padSlime) {
      b.x = ptx - BALL_RAD;
      b.y = pty - BALL_RAD;
    }
    /* convex perpendicular (not normed on purpose, as in the original) */
    const ccx = this.padX + (this.padW >> 1);
    const ccy = lhy + (ccx - lhx);
    this.handlePaddleContact(b, ccx - ptx, ccy - pty);
  }

  private handlePaddleContact(b: Ball, px: number, py: number): void {
    if (px === 0 && py === 0) return;
    const oldVx = b.vx;
    const cx = (1 - 2 * px * px) * b.vx + -2 * px * py * b.vy;
    const cy = -2 * px * py * b.vx + (1 - 2 * py * py) * b.vy;
    if (cy > 0) return; /* lower hemisphere: no reflection */
    b.vx = cx;
    b.vy = cy;
    this.maskVel(b, oldVx, false);
    this.quantize(b);
    const bx = Math.trunc(b.x);
    if (bx < BRICK_W) b.x = BRICK_W;
    else if (bx + BALL_DIA >= FIELD_W - BRICK_W) b.x = FIELD_W - BRICK_W - BALL_DIA;
    if (this.wallActive && b.y + BALL_DIA > FIELD_H - BRICK_H - 1) b.y = FIELD_H - BRICK_H - 1 - BALL_DIA;
    this.events.push({ t: "paddle", x: b.x + BALL_RAD, y: b.y + BALL_RAD });
    if (this.padSlime) this.attach(b);
  }

  /* -------------------------------------------- swept brick collision */

  private solidAt(c: number, r: number): boolean {
    if (c < 0 || c >= MAP_W || r < 0 || r >= MAP_H) return true;
    return this.bType[r * MAP_W + c] !== MAP_EMPTY;
  }

  /**
   * Earliest contact of the ball centre (moving by v for at most tMax ms)
   * with a non-empty cell grown by the ball radius. Only exposed faces and
   * exposed corners are tested, like LBreakout2's blocked-side checks.
   */
  private findHit(cx: number, cy: number, vx: number, vy: number, tMax: number, h: Hit): boolean {
    const R = BALL_RAD;
    const ex = cx + vx * tMax;
    const ey = cy + vy * tMax;
    let c0 = Math.floor((Math.min(cx, ex) - R - 1) / BRICK_W);
    let c1 = Math.floor((Math.max(cx, ex) + R + 1) / BRICK_W);
    let r0 = Math.floor((Math.min(cy, ey) - R - 1) / BRICK_H);
    let r1 = Math.floor((Math.max(cy, ey) + R + 1) / BRICK_H);
    if (c0 < 0) c0 = 0;
    if (r0 < 0) r0 = 0;
    if (c1 > MAP_W - 1) c1 = MAP_W - 1;
    if (r1 > MAP_H - 1) r1 = MAP_H - 1;
    let best = Infinity;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        if (this.bType[r * MAP_W + c] === MAP_EMPTY) continue;
        const x0 = c * BRICK_W;
        const x1 = x0 + BRICK_W;
        const y0 = r * BRICK_H;
        const y1 = y0 + BRICK_H;
        const upOpen = !this.solidAt(c, r - 1);
        const downOpen = !this.solidAt(c, r + 1);
        const leftOpen = !this.solidAt(c - 1, r);
        const rightOpen = !this.solidAt(c + 1, r);
        let t: number;
        let pen: number;
        if (vy > 0 && upOpen) {
          pen = cy - (y0 - R);
          if (pen <= PEN_TOL) {
            t = pen >= 0 ? 0 : -pen / vy;
            const hx = cx + vx * t;
            if (t < best && t <= tMax && hx >= x0 && hx <= x1) { best = t; this.setHit(h, t, c, r, SIDE_TOP, 0, 0); }
          }
        }
        if (vy < 0 && downOpen) {
          pen = y1 + R - cy;
          if (pen <= PEN_TOL) {
            t = pen >= 0 ? 0 : pen / vy;
            const hx = cx + vx * t;
            if (t < best && t <= tMax && hx >= x0 && hx <= x1) { best = t; this.setHit(h, t, c, r, SIDE_BOTTOM, 0, 0); }
          }
        }
        if (vx > 0 && leftOpen) {
          pen = cx - (x0 - R);
          if (pen <= PEN_TOL) {
            t = pen >= 0 ? 0 : -pen / vx;
            const hy = cy + vy * t;
            if (t < best && t <= tMax && hy >= y0 && hy <= y1) { best = t; this.setHit(h, t, c, r, SIDE_LEFT, 0, 0); }
          }
        }
        if (vx < 0 && rightOpen) {
          pen = x1 + R - cx;
          if (pen <= PEN_TOL) {
            t = pen >= 0 ? 0 : pen / vx;
            const hy = cy + vy * t;
            if (t < best && t <= tMax && hy >= y0 && hy <= y1) { best = t; this.setHit(h, t, c, r, SIDE_RIGHT, 0, 0); }
          }
        }
        if (upOpen && leftOpen) best = this.cornerHit(h, best, tMax, cx, cy, vx, vy, c, r, x0, y0, -1, -1);
        if (upOpen && rightOpen) best = this.cornerHit(h, best, tMax, cx, cy, vx, vy, c, r, x1, y0, 1, -1);
        if (downOpen && leftOpen) best = this.cornerHit(h, best, tMax, cx, cy, vx, vy, c, r, x0, y1, -1, 1);
        if (downOpen && rightOpen) best = this.cornerHit(h, best, tMax, cx, cy, vx, vy, c, r, x1, y1, 1, 1);
      }
    }
    return best !== Infinity;
  }

  private cornerHit(
    h: Hit, best: number, tMax: number, cx: number, cy: number, vx: number, vy: number,
    c: number, r: number, px: number, py: number, qx: number, qy: number,
  ): number {
    const dx = cx - px;
    const dy = cy - py;
    const b = dx * vx + dy * vy;
    if (b >= 0) return best; /* moving away */
    const a = vx * vx + vy * vy;
    const cc = dx * dx + dy * dy - BALL_RAD * BALL_RAD;
    let t: number;
    if (cc <= 0) t = 0;
    else {
      const disc = b * b - a * cc;
      if (disc < 0) return best;
      t = (-b - Math.sqrt(disc)) / a;
      if (t < 0) t = 0;
    }
    if (t >= best || t > tMax) return best;
    /* contact must lie in the corner's outer quadrant, else a face handles it */
    const hx = cx + vx * t - px;
    const hy = cy + vy * t - py;
    if (hx * qx < -1e-9 || hy * qy < -1e-9) return best;
    this.setHit(h, t, c, r, SIDE_CORNER, px, py);
    return t;
  }

  private setHit(h: Hit, t: number, c: number, r: number, side: number, px: number, py: number): void {
    h.t = t; h.c = c; h.r = r; h.side = side; h.px = px; h.py = py;
  }

  private moveFree(b: Ball, ms: number): void {
    let tLeft = ms;
    const h = this.hit;
    for (let iter = 0; iter < 12 && tLeft > 0; iter++) {
      if (!this.findHit(b.x + BALL_RAD, b.y + BALL_RAD, b.vx, b.vy, tLeft, h)) {
        b.x += b.vx * tLeft;
        b.y += b.vy * tLeft;
        return;
      }
      b.x += b.vx * h.t;
      b.y += b.vy * h.t;
      tLeft -= h.t;
      this.ballHitsBrick(b, h);
    }
  }

  /** ball_check_brick_reflection(). */
  private ballHitsBrick(b: Ball, h: Hit): void {
    const idx = h.r * MAP_W + h.c;
    const type = this.bType[idx];
    const metal = this.exActive[EX_METAL] === 1;
    if (this.bDur[idx] !== -1 || (metal && type !== MAP_WALL)) b.idle = 0;
    const reflect = !(metal && type !== MAP_WALL);
    const chaos = this.exActive[EX_CHAOS] === 1 || type === MAP_BRICK_CHAOS;
    const indestructible = type === MAP_WALL || (this.bDur[idx] === -1 && !metal);
    if (reflect) this.reflectAtBrick(b, h, chaos);
    if (!this.exActive[EX_WEAK_BALL] || this.rng.int(10) < 6) {
      if (this.exActive[EX_EXPL_BALL] && this.bDur[idx] > 0) {
        this.bType[idx] = MAP_BRICK_EXP;
        this.bDur[idx] = 1;
      }
      this.brickHit(idx, metal);
    }
    if (indestructible) this.events.push({ t: "wall", x: b.x + BALL_RAD, y: b.y + BALL_RAD });
    /* safety: never pass through a brick that is still there */
    if (!reflect && this.bType[idx] !== MAP_EMPTY) this.reflectAtBrick(b, h, false);
  }

  private reflectAtBrick(b: Ball, h: Hit, chaos: boolean): void {
    const oldVx = b.vx;
    const corner = h.side === SIDE_CORNER;
    const cx = b.x + BALL_RAD;
    const cy = b.y + BALL_RAD;
    if (!chaos) {
      if (h.side === SIDE_TOP || h.side === SIDE_BOTTOM) b.vy = -b.vy;
      else if (h.side === SIDE_LEFT || h.side === SIDE_RIGHT) b.vx = -b.vx;
      else {
        let px = h.px - cx;
        let py = h.py - cy;
        const l = vlen(px, py);
        if (l > 0) { px /= l; py /= l; }
        const nx = (1 - 2 * px * px) * b.vx + -2 * px * py * b.vy;
        const ny = -2 * px * py * b.vx + (1 - 2 * py * py) * b.vy;
        b.vx = nx;
        b.vy = ny;
      }
    } else {
      b.vx = this.rng.range(-10000, 10000) / 10000;
      b.vy = this.rng.range(-10000, 10000) / 10000;
      if (b.vx === 0 && b.vy === 0) b.vy = -1;
    }
    this.maskVel(b, oldVx, corner && !chaos);
    this.quantize(b);
    /* make sure the ball leaves the surface it touched */
    switch (h.side) {
      case SIDE_TOP: b.vy = -Math.abs(b.vy); break;
      case SIDE_BOTTOM: b.vy = Math.abs(b.vy); break;
      case SIDE_LEFT: b.vx = -Math.abs(b.vx); break;
      case SIDE_RIGHT: b.vx = Math.abs(b.vx); break;
      default: {
        const nx = cx - h.px;
        const ny = cy - h.py;
        if (b.vx * nx + b.vy * ny <= 0) {
          if (nx < 0) b.vx = -Math.abs(b.vx); else if (nx > 0) b.vx = Math.abs(b.vx);
          if (ny < 0) b.vy = -Math.abs(b.vy); else if (ny > 0) b.vy = Math.abs(b.vy);
        }
      }
    }
  }

  /** Game Port stalemate breaker: nudge balls after 30 s without damage. */
  private stallUpdate(ms: number): void {
    let free = false;
    for (const b of this.balls) if (!b.attached && !b.movingBack) free = true;
    if (!free) return;
    this.stallTime += ms;
    if (this.stallTime < STALL_MS) return;
    this.stallTime = 0;
    for (const b of this.balls) {
      if (b.attached || b.movingBack) continue;
      const oldVx = b.vx;
      const delta = this.rng.range(3, 8) * (this.rng.int(2) ? 1 : -1);
      const a = (vec2angle(b.vx, b.vy) + delta + 180) % 180;
      b.vx = IMPACT_X[a];
      b.vy = IMPACT_Y[a];
      this.maskVel(b, oldVx, false);
      this.quantize(b);
    }
  }

  /* ============================================================ bricks */

  private kindOf(idx: number): BrickKind {
    switch (this.bType[idx]) {
      case MAP_WALL: return "wall";
      case MAP_BRICK_EXP: return "explosive";
      case MAP_BRICK_GROW: return "grow";
      case MAP_BRICK_HEAL: return "heal";
      case MAP_BRICK_CHAOS: return "chaos";
      default:
        if (this.bDur[idx] === -1) return "wall";
        if (this.bId[idx] === INVIS_BRICK_ID) return "invisible";
        return "brick";
    }
  }

  /** brick_hit(): returns true if the brick was destroyed. */
  private brickHit(idx: number, metal: boolean): boolean {
    const type = this.bType[idx];
    if (type === MAP_WALL || type === MAP_EMPTY) return false;
    let remove = false;
    if (metal) remove = true;
    else {
      if (this.bDur[idx] === -1) return false;
      if (this.bDur[idx] <= 1) remove = true;
    }
    this.stallTime = 0;
    if (remove) this.removeBrick(idx);
    else {
      this.looseDur(idx);
      this.events.push({ t: "brickhit", col: idx % MAP_W, row: (idx / MAP_W) | 0, id: this.bId[idx] });
    }
    return remove;
  }

  /** brick_loose_dur() by one point. */
  private looseDur(idx: number): void {
    this.bDur[idx]--;
    this.bId[idx]--;
    const ch = this.bChar[idx];
    this.bChar[idx] = ch === "v" ? "c" : String.fromCharCode(ch.charCodeAt(0) - 1);
    if (this.bType[idx] === MAP_BRICK_HEAL) {
      if (this.bHeal[idx] === -1) this.healList.push(idx);
      this.bHeal[idx] = BRICK_HEAL_TIME * DIFF.timeMod;
    }
    this.bricksDirty = true;
  }

  /** brick_remove(): explosions, growth, extra release, score. */
  private removeBrick(idx: number): void {
    const c = idx % MAP_W;
    const r = (idx / MAP_W) | 0;
    const type = this.bType[idx];
    const id = this.bId[idx];
    const kind = this.kindOf(idx);
    if (type === MAP_BRICK_EXP) {
      for (let i = c - 1; i <= c + 1; i++)
        for (let j = r - 1; j <= r + 1; j++) {
          if (i === c && j === r) continue;
          if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_H) continue;
          const n = j * MAP_W + i;
          if (this.bType[n] !== MAP_EMPTY && this.bDur[n] > 0 && this.bExp[n] === -1) {
            this.bExp[n] = BRICK_EXP_TIME;
            this.expList.push(n);
          }
        }
    }
    if (type === MAP_BRICK_GROW) {
      for (let i = c - 1; i <= c + 1; i++)
        for (let j = r - 1; j <= r + 1; j++) {
          if (i < 0 || j < 0 || i >= MAP_W || j >= MAP_H) continue;
          const n = j * MAP_W + i;
          if (this.bType[n] === MAP_EMPTY) this.growBrick(n, this.rng.range(BRICK_GROW_FIRST, BRICK_GROW_LAST));
        }
    }
    if (this.bDur[idx] !== -1) this.bricksLeft--;
    const extra = this.bExtra[idx];
    const score = this.bScore[idx];
    this.clearCell(idx);
    if (extra !== EX_NONE) {
      if (DIFF.allowMaluses || !extraIsMalus(extra))
        this.extras.push({ type: extra, x: c * BRICK_W, y: r * BRICK_H });
    } else if (this.exActive[EX_GOLDSHOWER]) {
      this.extras.push({ type: EX_SCORE1000, x: c * BRICK_W, y: r * BRICK_H });
    }
    this.score += score;
    this.events.push({ t: "brickgone", col: c, row: r, id, kind });
    if (type === MAP_BRICK_EXP) this.events.push({ t: "explode", col: c, row: r });
    this.bricksDirty = true;
  }

  /** brick_grow(): not where a ball is. */
  private growBrick(idx: number, convIdx: number): void {
    if (this.bType[idx] !== MAP_EMPTY) return;
    const c = idx % MAP_W;
    const r = (idx / MAP_W) | 0;
    for (const b of this.balls) {
      const bx = Math.trunc(b.attached ? b.x + this.padX : b.x);
      const by = Math.trunc(b.attached ? b.y + PADDLE_Y : b.y);
      const lc = Math.trunc(bx / BRICK_W);
      const rc = Math.trunc((bx + BALL_DIA) / BRICK_W);
      const tr = Math.trunc(by / BRICK_H);
      const br = Math.trunc((by + BALL_DIA) / BRICK_H);
      if ((c === lc || c === rc) && (r === tr || r === br)) return;
    }
    this.setByConv(idx, convIdx);
    this.bChar[idx] = BRICK_CONV[convIdx].c.toUpperCase();
    this.bScore[idx] = BRICK_CONV[convIdx].score;
    this.bricksLeft++;
    this.bricksDirty = true;
  }

  /** bricks_update(): delayed explosions and regeneration. */
  private bricksUpdate(ms: number): void {
    if (this.expList.length > 0) {
      const list = this.expList;
      this.expList = [];
      for (const idx of list) {
        if (this.bExp[idx] === -1 || this.bType[idx] === MAP_EMPTY) continue;
        this.bExp[idx] -= ms;
        if (this.bExp[idx] <= 0) {
          this.bExp[idx] = -1;
          this.stallTime = 0;
          this.removeBrick(idx);
        } else this.expList.push(idx);
      }
    }
    if (this.healList.length > 0) {
      const list = this.healList;
      this.healList = [];
      for (const idx of list) {
        if (this.bType[idx] !== MAP_BRICK_HEAL) continue;
        this.bHeal[idx] -= ms;
        if (this.bHeal[idx] < 0) {
          this.bDur[idx]++;
          this.bId[idx]++;
          this.bricksDirty = true;
          if (this.bDur[idx] < 3) {
            this.bHeal[idx] = BRICK_HEAL_TIME;
            this.healList.push(idx);
          } else this.bHeal[idx] = -1;
        } else this.healList.push(idx);
      }
    }
  }

  /* ============================================================ shots */

  private shotsUpdate(ms: number): void {
    if (this.shots.length === 0) return;
    const keep: Shot[] = [];
    for (const s of this.shots) {
      s.y -= SHOT_VY * ms;
      if (s.y + SHOT_H < 0) { this.padAmmo++; continue; }
      const r = Math.floor((s.y + 3) / BRICK_H);
      if (r >= 0 && r < MAP_H) {
        const c1 = Math.trunc((s.x + 3) / BRICK_W);
        const c2 = Math.trunc((s.x + 6) / BRICK_W);
        const hit1 = this.bType[r * MAP_W + c1] !== MAP_EMPTY;
        const hit2 = c2 !== c1 && this.bType[r * MAP_W + c2] !== MAP_EMPTY;
        if (hit1 || hit2) {
          if (hit1) this.brickHit(r * MAP_W + c1, false);
          if (hit2) this.brickHit(r * MAP_W + c2, false);
          this.padAmmo++;
          continue;
        }
      }
      keep.push(s);
    }
    this.shots = keep;
  }

  /* ============================================================ extras */

  private attracts(type: number): boolean {
    switch (type) {
      case EX_SCORE200: case EX_SCORE500: case EX_SCORE1000: case EX_SCORE2000:
      case EX_SCORE5000: case EX_SCORE10000: case EX_GOLDSHOWER: case EX_LENGTHEN:
      case EX_LIFE: case EX_SLIME: case EX_METAL: case EX_BALL: case EX_WALL:
      case EX_WEAPON: case EX_SLOW: case EX_JOKER: case EX_EXPL_BALL: case EX_BONUS_MAGNET:
        return this.padAttract === ATTRACT_BONUS;
      case EX_SHORTEN: case EX_FAST: case EX_MALUS_MAGNET: case EX_WEAK_BALL:
      case EX_DARKNESS: case EX_GHOST_PADDLE: case EX_FROZEN:
        return this.padAttract === ATTRACT_MALUS;
      default:
        return false;
    }
  }

  private setBallVelocity(v: number): void {
    for (const b of this.balls) this.setLen(b, v);
  }

  private expire(i: number): void {
    switch (i) {
      case EX_SLOW:
      case EX_FAST:
        this.ballV = DIFF.vStart + DIFF.vAdd * this.speedupLevel;
        this.setBallVelocity(this.ballV);
        break;
      case EX_SLIME:
        this.padSlime = false;
        this.rng.int(2); /* direction pick of the original; unused with random angles */
        this.detachBalls();
        break;
      case EX_WEAPON: this.padWeapon = false; break;
      case EX_FROZEN: this.padFrozen = false; break;
      case EX_GHOST_PADDLE: this.padInvis = false; break;
      case EX_BONUS_MAGNET:
      case EX_MALUS_MAGNET:
        this.padAttract = ATTRACT_NONE;
        break;
    }
  }

  /** extras_update(): timers, falling extras, collection. */
  private extrasUpdate(ms: number): void {
    for (let i = 0; i < EX_NUMBER; i++) {
      if (i === EX_WALL || this.exTime[i] === 0) continue;
      this.exTime[i] -= ms;
      if (this.exTime[i] <= 0) {
        this.exTime[i] = 0;
        this.expire(i);
        this.exActive[i] = 0;
      }
    }
    if (this.extras.length === 0) return;
    const keep: Extra[] = [];
    const list = this.extras;
    this.extras = keep;
    for (let k = 0; k < list.length; k++) {
      const ex = list[k];
      const center = this.padX + (this.padW >> 1) - (BRICK_W >> 1);
      ex.y += EXTRA_V * ms;
      if (this.attracts(ex.type)) {
        if (ex.x < center) {
          ex.x += EXTRA_V * ms;
          if (ex.x > center) ex.x = center;
        } else {
          ex.x -= EXTRA_V * ms;
          if (ex.x < center) ex.x = center;
        }
      }
      if (ex.y >= FIELD_H || ex.y + BRICK_H < 0) continue;
      if (
        this.paddleSolid() &&
        ex.x + BRICK_W > this.padX && ex.x < this.padX + this.padW - 1 &&
        ex.y + BRICK_H > PADDLE_Y && ex.y < PADDLE_Y + PADDLE_H
      ) {
        const px = ex.x + (BRICK_W >> 1);
        const py = ex.y + (BRICK_H >> 1);
        if (ex.type !== EX_JOKER) {
          this.extraUse(ex.type, px, py);
          continue;
        }
        /* joker: every good extra on screen is used twice, all others vanish */
        this.events.push({ t: "extra", kind: "joker", good: true, x: px, y: py });
        const all = keep.concat(list.slice(k + 1));
        keep.length = 0;
        for (const o of all) {
          const t = o.type;
          if (
            t !== EX_JOKER && t !== EX_SHORTEN && t !== EX_FROZEN && t !== EX_FAST &&
            t !== EX_RANDOM && t !== EX_DARKNESS && t !== EX_GHOST_PADDLE &&
            t !== EX_CHAOS && t !== EX_DISABLE && t !== EX_MALUS_MAGNET && t !== EX_WEAK_BALL
          ) {
            this.extraUse(t, px, py);
            this.extraUse(t, px, py);
          }
        }
        this.extras = [];
        return;
      }
      keep.push(ex);
    }
  }

  /** extra_use() (with the client part for EX_LIFE). */
  private extraUse(type: number, x: number, y: number): void {
    const tm = DIFF.timeMod;
    if (DIFF.allowMaluses) {
      while (type === EX_RANDOM) type = this.rng.int(EX_NUMBER);
    } else {
      while (type === EX_RANDOM || extraIsMalus(type)) type = this.rng.int(EX_NUMBER);
    }
    this.events.push({ t: "extra", kind: EXTRA_KINDS[type], good: !extraIsMalus(type), x, y });
    const m = DIFF.scoreMod;
    switch (type) {
      case EX_SCORE200: this.score += (m * 200 / 10) | 0; break;
      case EX_SCORE500: this.score += (m * 500 / 10) | 0; break;
      case EX_SCORE1000: this.score += (m * 1000 / 10) | 0; break;
      case EX_SCORE2000: this.score += (m * 2000 / 10) | 0; break;
      case EX_SCORE5000: this.score += (m * 5000 / 10) | 0; break;
      case EX_SCORE10000: this.score += (m * 10000 / 10) | 0; break;
      case EX_GOLDSHOWER:
        this.exTime[type] += TIME_GOLDSHOWER * tm;
        this.exActive[type] = 1;
        break;
      case EX_LIFE:
        if (this.lives < DIFF.maxLives) this.lives++;
        break;
      case EX_SHORTEN: this.paddleInitResize(-1); break;
      case EX_LENGTHEN: this.paddleInitResize(1); break;
      case EX_BALL: {
        const b: Ball = {
          x: this.padX + ((this.padW - BALL_DIA) >> 1), y: PADDLE_Y - BALL_DIA,
          vx: 0, vy: 0, attached: false, movingBack: false, idle: 0,
        };
        this.setRandomAngle(b);
        this.balls.push(b);
        break;
      }
      case EX_WALL:
        this.exTime[type] += TIME_WALL * tm;
        if (this.exActive[type]) break;
        this.exActive[type] = 1;
        this.wallActive = true;
        this.wallAlpha = 0;
        for (let i = 1; i < MAP_W - 1; i++) this.setWall((MAP_H - 1) * MAP_W + i);
        break;
      case EX_METAL:
        this.exTime[type] += TIME_METAL * tm;
        this.exActive[type] = 1;
        this.exActive[EX_EXPL_BALL] = 0; this.exTime[EX_EXPL_BALL] = 0;
        this.exActive[EX_WEAK_BALL] = 0; this.exTime[EX_WEAK_BALL] = 0;
        break;
      case EX_FROZEN:
        this.exTime[type] = TIME_FROZEN * tm;
        this.exActive[type] = 1;
        this.padFrozen = true;
        break;
      case EX_WEAPON:
        this.exTime[type] += TIME_WEAPON * tm;
        this.exActive[type] = 1;
        this.padWeapon = true;
        this.padWeaponDelay = WEAPON_FIRE_RATE;
        break;
      case EX_SLIME:
        this.exTime[type] += TIME_SLIME * tm;
        this.exActive[type] = 1;
        this.padSlime = true;
        break;
      case EX_FAST:
        this.exTime[EX_SLOW] = 0; this.exActive[EX_SLOW] = 0;
        this.exTime[type] += TIME_FAST * tm;
        this.exActive[type] = 1;
        this.ballV = DIFF.vMax;
        this.setBallVelocity(this.ballV);
        break;
      case EX_SLOW:
        this.exTime[EX_FAST] = 0; this.exActive[EX_FAST] = 0;
        this.exTime[type] += TIME_SLOW * tm;
        this.exActive[type] = 1;
        this.ballV = DIFF.vStart;
        this.setBallVelocity(this.ballV);
        break;
      case EX_CHAOS:
        this.exTime[type] += TIME_CHAOS * tm;
        this.exActive[type] = 1;
        break;
      case EX_DARKNESS:
        this.exTime[type] += TIME_DARKNESS * tm;
        this.exActive[type] = 1;
        break;
      case EX_GHOST_PADDLE:
        this.exTime[type] += TIME_GHOST_PADDLE * tm;
        this.exActive[type] = 1;
        this.padInvis = true;
        this.padInvisDelay = PADDLE_INVIS_DELAY;
        break;
      case EX_TIME_ADD:
        for (let i = 0; i < EX_NUMBER; i++) if (this.exTime[i]) this.exTime[i] += TIME_ADD * tm;
        break;
      case EX_EXPL_BALL:
        this.exTime[type] += TIME_EXPL_BALL * tm;
        this.exActive[type] = 1;
        this.exActive[EX_METAL] = 0; this.exTime[EX_METAL] = 0;
        this.exActive[EX_WEAK_BALL] = 0; this.exTime[EX_WEAK_BALL] = 0;
        break;
      case EX_WEAK_BALL:
        this.exTime[type] += TIME_WEAK_BALL * tm;
        this.exActive[type] = 1;
        this.exActive[EX_METAL] = 0; this.exTime[EX_METAL] = 0;
        this.exActive[EX_EXPL_BALL] = 0; this.exTime[EX_EXPL_BALL] = 0;
        break;
      case EX_BONUS_MAGNET:
        this.padAttract = ATTRACT_BONUS;
        this.exTime[type] += TIME_BONUS_MAGNET * tm;
        this.exActive[type] = 1;
        this.exActive[EX_MALUS_MAGNET] = 0; this.exTime[EX_MALUS_MAGNET] = 0;
        break;
      case EX_MALUS_MAGNET:
        this.padAttract = ATTRACT_MALUS;
        this.exTime[type] += TIME_MALUS_MAGNET * tm;
        this.exActive[type] = 1;
        this.exActive[EX_BONUS_MAGNET] = 0; this.exTime[EX_BONUS_MAGNET] = 0;
        break;
      case EX_DISABLE:
        for (let i = 0; i < EX_NUMBER; i++) if (this.exTime[i]) this.exTime[i] = 1;
        break;
      default:
        break;
    }
  }

  /** walls_update(): bonus floor lasts its time, then fades out (~1 s). */
  private wallsUpdate(ms: number): void {
    if (!this.wallActive) return;
    if (this.exTime[EX_WALL] > 0) {
      this.exTime[EX_WALL] -= ms;
      if (this.exTime[EX_WALL] < 0) this.exTime[EX_WALL] = 0;
      if (this.wallAlpha < 255) {
        this.wallAlpha += 0.25 * ms;
        if (this.wallAlpha > 255) this.wallAlpha = 255;
      }
    } else {
      this.wallAlpha -= 0.25 * ms;
      if (this.wallAlpha < 0) {
        this.wallAlpha = 0;
        this.wallActive = false;
        this.exActive[EX_WALL] = 0;
        for (let i = 1; i < MAP_W - 1; i++) this.clearCell((MAP_H - 1) * MAP_W + i);
      }
    }
  }

  /* ============================================================ view */

  private buildView(): GameView {
    if (this.bricksDirty) {
      const out: BrickView[] = [];
      for (let r = 1; r < MAP_H - 1; r++)
        for (let c = 1; c < MAP_W - 1; c++) {
          const idx = r * MAP_W + c;
          if (this.bType[idx] === MAP_EMPTY) continue;
          const id = this.bId[idx];
          out.push({
            col: c, row: r, kind: this.kindOf(idx), id, hp: this.bDur[idx],
            visible: id !== INVIS_BRICK_ID,
          });
        }
      this.brickViews = out;
      this.bricksDirty = false;
    }
    const metal = this.exActive[EX_METAL] === 1;
    const expl = this.exActive[EX_EXPL_BALL] === 1;
    const weak = this.exActive[EX_WEAK_BALL] === 1;
    const balls: BallView[] = [];
    for (const b of this.balls) {
      const x = b.attached ? b.x + this.padX : b.x;
      const y = b.attached ? b.y + PADDLE_Y : b.y;
      balls.push({
        x: x + BALL_RAD, y: y + BALL_RAD, r: BALL_RAD, attached: b.attached,
        metal, explosive: expl, weak,
      });
    }
    const extras: ExtraView[] = [];
    for (const e of this.extras)
      extras.push({ kind: EXTRA_KINDS[e.type], x: e.x + (BRICK_W >> 1), y: e.y + (BRICK_H >> 1) });
    const shots: ShotView[] = [];
    for (const s of this.shots) shots.push({ x: s.x + (SHOT_W >> 1), y: s.y + (SHOT_H >> 1) });
    const effects: ActiveEffects = {};
    for (let i = 0; i < EX_NUMBER; i++) if (this.exTime[i] > 0) effects[EXTRA_KINDS[i]] = this.exTime[i];
    const paddle: PaddleView = {
      x: this.padX, y: PADDLE_Y, w: this.padW, h: PADDLE_H,
      sticky: this.padSlime, weapon: this.padWeapon, frozen: this.padFrozen,
      ghost: this.padInvis,
    };
    return {
      frame: this.frame,
      status: this.status,
      level: this.levelIndex,
      levelTitle: this.levelTitle,
      score: this.score,
      lives: this.lives,
      bricks: this.brickViews,
      balls,
      paddle,
      extras,
      shots,
      effects,
      floor: this.wallActive,
      darkness: this.exActive[EX_DARKNESS] === 1,
      events: this.events,
    };
  }
}
