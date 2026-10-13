/*
 * Game Port engine contract.
 * The engine is a TypeScript port of the LBreakout2 game logic
 * (C) 2001-2015 Michael Speck and contributors, GPL-2.0-or-later.
 * This port is distributed under GPL-3.0-or-later.
 *
 * The engine is pure and deterministic: no DOM, no Date, no Math.random,
 * no transcendental Math functions (sin/cos/atan2/pow/exp/log/hypot), so the
 * server can replay a run from its inputs and get the exact same score.
 */

/** Playing field, LBreakout2 units: 16 x 24 bricks of 40 x 20 px. */
export const BRICK_W = 40;
export const BRICK_H = 20;
export const MAP_W = 16;
export const MAP_H = 24;
export const FIELD_W = MAP_W * BRICK_W; // 640
export const FIELD_H = MAP_H * BRICK_H; // 480
/** Fixed simulation step. */
export const STEP_MS = 1000 / 60;

/** A level in the LBreakout2 level-file format (14 x 18 editable area). */
export interface LevelDef {
  title: string;
  author: string;
  /** 18 strings of 14 chars, LBreakout2 brick chars ('.' = empty). */
  bricks: string[];
  /** 18 strings of 14 chars, LBreakout2 bonus chars ('.' = none). */
  bonus: string[];
}

export interface RunConfig {
  /** 32-bit unsigned seed, issued by the server for ranked runs. */
  seed: number;
  levels: LevelDef[];
  lives?: number; // default 3
}

/** One frame of player input. */
export interface FrameInput {
  /** Desired paddle centre x in field units (integer, 0..FIELD_W). */
  x: number;
  /** Fire: launch a held ball / shoot when the weapon extra is active. */
  fire: boolean;
}

export type BrickKind =
  | "wall" // indestructible
  | "brick" // normal, hp >= 1
  | "explosive"
  | "grow"
  | "heal"
  | "chaos"
  | "invisible";

export interface BrickView {
  col: number; // 0..MAP_W-1
  row: number; // 0..MAP_H-1
  kind: BrickKind;
  /** LBreakout2 brick id (0..25), used by skins to pick a colour/sprite. */
  id: number;
  hp: number; // remaining hits, -1 = indestructible
  visible: boolean;
}

export interface BallView {
  x: number; // centre
  y: number;
  r: number;
  attached: boolean; // held on the paddle
  metal: boolean;
  explosive: boolean;
  weak: boolean;
}

export interface PaddleView {
  x: number; // left
  y: number; // top
  w: number;
  h: number;
  sticky: boolean;
  weapon: boolean;
  frozen: boolean;
  ghost: boolean;
}

/** Extra (power-up) ids, same order as LBreakout2's EX_* enum. */
export type ExtraKind =
  | "score200" | "score500" | "score1000" | "score2000" | "score5000" | "score10000"
  | "goldshower" | "shorten" | "lengthen" | "life" | "slime" | "metal" | "ball"
  | "wall" | "frozen" | "weapon" | "random" | "fast" | "slow" | "joker" | "darkness"
  | "chaos" | "ghost" | "disable" | "timeadd" | "explosive" | "bonusmagnet"
  | "malusmagnet" | "weakball";

export interface ExtraView {
  kind: ExtraKind;
  x: number; // centre
  y: number;
}

export interface ShotView {
  x: number;
  y: number;
}

/** Active timed effects, remaining ms. */
export type ActiveEffects = Partial<Record<ExtraKind, number>>;

export type GameStatus =
  | "serve" // ball held on paddle, waiting for fire
  | "play"
  | "levelclear" // short pause between levels
  | "gameover"
  | "won"; // every level cleared

/** Events emitted during the last step, for sound and particles. */
export type GameEvent =
  | { t: "paddle"; x: number; y: number }
  | { t: "wall"; x: number; y: number }
  | { t: "brickhit"; col: number; row: number; id: number }
  | { t: "brickgone"; col: number; row: number; id: number; kind: BrickKind }
  | { t: "explode"; col: number; row: number }
  | { t: "extra"; kind: ExtraKind; good: boolean; x: number; y: number }
  | { t: "shot"; x: number; y: number }
  | { t: "launch" }
  | { t: "balllost" }
  | { t: "lifelost"; lives: number }
  | { t: "levelclear"; level: number; bonus: number }
  | { t: "gameover" }
  | { t: "won" };

export interface GameView {
  frame: number;
  status: GameStatus;
  level: number; // 0-based index into RunConfig.levels
  levelTitle: string;
  score: number;
  lives: number;
  bricks: BrickView[]; // only non-empty cells
  balls: BallView[];
  paddle: PaddleView;
  extras: ExtraView[];
  shots: ShotView[];
  effects: ActiveEffects;
  /** Bonus floor ("wall" extra) active. */
  floor: boolean;
  darkness: boolean;
  events: GameEvent[];
}

/** Result of replaying or finishing a run. */
export interface RunResult {
  score: number;
  level: number; // highest level index reached
  levelsCleared: number;
  frames: number;
  status: GameStatus;
}
