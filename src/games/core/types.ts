/*
 * ArcadePad game contract. Every game is a deterministic engine (pure
 * TypeScript, no DOM/Date/Math.random/transcendental Math) plus a canvas
 * renderer. The server replays recorded inputs through the engine to verify
 * scores, so engines must give bit-identical results in every JS runtime.
 * ArcadePad, GPL-3.0-or-later.
 */
import type { SfxName } from "../../themes/types.ts";

/** Fixed simulation rate for every game. */
export const STEP_MS = 1000 / 60;

/** Button bits. Keyboard, touch and pointer are mapped onto these by the host. */
export const BTN = {
  FIRE: 1, // Space / Enter / click / tap
  UP: 2,
  DOWN: 4,
  LEFT: 8,
  RIGHT: 16,
  ALT: 32, // secondary action (X / Shift / right click / long press)
} as const;

/** One frame of input. x/y: pointer position in field units (integers, clamped to the field). */
export interface Input {
  x: number;
  y: number;
  b: number;
}

/**
 * Something that happened during the last step. The host uses the generic
 * fields (sounds, mascot mood, toasts, shake); renderers can read their own
 * game-specific fields for particles.
 */
export interface GameEvent {
  t: string;
  sfx?: SfxName;
  mood?: "happy" | "sad";
  toast?: "levelClear" | "lifeLost";
  shake?: number;
  x?: number;
  y?: number;
  [k: string]: unknown;
}

export interface Hud {
  score: number;
  lives?: number;
  level?: number; // 1-based for display
  label?: string; // short extra text, e.g. level title or "x2 combo"
}

export type GameStatus = "playing" | "over" | "won";

export interface GameResult {
  score: number;
  level: number; // 0-based highest level reached (0 if the game has no levels)
  levelsCleared: number;
  frames: number;
  status: GameStatus;
}

export interface GameEngine<V = unknown> {
  step(input: Input): void;
  /** Snapshot for the renderer and bots; valid until the next step. */
  view(): V;
  /** Events from the last step. */
  readonly events: readonly GameEvent[];
  hud(): Hud;
  result(): GameResult;
  readonly done: boolean;
  readonly frame: number;
}

export interface GameCtx {
  /** Coin ticker (A-Z0-9, up to 6 chars). Games may use it for a ticker level. */
  ticker: string;
}

export interface Credits {
  /** Original game the logic is ported from, or "Original" for in-house designs. */
  basedOn: string;
  url: string;
  authors: string;
  /** SPDX licence of the original code, e.g. "MIT", "GPL-2.0-or-later". */
  licence: string;
  /** What was ported and what was not (assets are never copied). */
  notes: string;
}

export interface GameMeta {
  id: string; // url slug
  name: string; // our own name, never a trademarked title
  tagline: string;
  genre: string;
  /** Typical run length, shown in the catalogue. */
  session: string;
  controls: string;
  field: { w: number; h: number };
  input: {
    /** Pointer position matters (mouse/touch moves something). */
    pointer: boolean;
    /** Touch swipes become short direction-button pulses (grid games). */
    swipe: boolean;
    /** Keyboard arrows are held buttons (true) or the host turns them into pointer x movement (false). */
    arrowsAsButtons: boolean;
    /** Optional per-game touch mapping (button bits) for tap and swipes. Defaults: tap FIRE, swipes = arrows. */
    touchMap?: Partial<Record<"tap" | "up" | "down" | "left" | "right", number>>;
  };
  /** Hard cap on run length in frames (server replay limit). */
  maxFrames: number;
  credits: Credits;
}

export interface GameDef<V = unknown> extends GameMeta {
  create(seed: number, ctx: GameCtx): GameEngine<V>;
  /** Simple autoplayer for attract mode and tests. */
  bot?(view: V, frame: number): Input;
  /** Title for a coin skin, defaults to `${coin name} ${game name}`. */
  titleFor?(theme: { coin: { name: string }; game: { title: string } }): string;
}

/** Client-side renderer, loaded lazily per game. */
export interface GameRenderer<V = unknown> {
  /** Called after every engine step with that step's events. */
  onEvents(events: readonly GameEvent[], view: V): void;
  /** Draw the current view; dtMs is wall time since the last draw. */
  draw(view: V, dtMs: number): void;
  dispose?(): void;
}
