// Theme pack = everything that re-skins a game for one coin.
// Packs are plain JSON (src/themes/packs/*.json) so a new coin is one file.

export type SfxName =
  | "paddle" | "wall" | "brick" | "brickgone" | "explode" | "extraGood" | "extraBad"
  | "shot" | "launch" | "lost" | "levelclear" | "gameover" | "won";

export interface SfxRecipe {
  wave: "sine" | "square" | "triangle" | "sawtooth" | "noise";
  /** Start and end frequency in Hz (ignored for noise except as filter cutoff). */
  f0: number;
  f1: number;
  /** Seconds. */
  dur: number;
  vol: number;
  /** Optional arpeggio, semitone offsets played in sequence over dur. */
  arp?: number[];
}

export interface MusicRecipe {
  bpm: number;
  lead: OscillatorType;
  bass: OscillatorType;
  /** 16-step patterns, note names like "C4", "." = rest, "-" = hold. */
  leadSteps: string[];
  bassSteps: string[];
}

export interface ThemePack {
  id: string;
  coin: {
    name: string;
    ticker: string; // without $
    chain: "solana" | "base" | "ethereum";
    /** Demo skins are fictional coins; real coins need written permission. */
    fictional: boolean;
  };
  game: { title: string; tagline: string };
  palette: {
    bg: string;
    bg2: string;
    ink: string;
    text: string;
    primary: string;
    secondary: string;
    accent: string;
    wall: string;
    bricks: string[];
  };
  /** Colours for sprite grid chars ('.' is transparent). */
  pixels: Record<string, string>;
  mascot: {
    name: string;
    /** 16x16 frames. */
    idle: string[];
    blink: string[];
    happy: string[];
    sad: string[];
    /** 12x12 head used as the ball. */
    mini: string[];
  };
  backdrop: "stars" | "bubbles" | "confetti";
  sfx: Record<SfxName, SfxRecipe>;
  music: MusicRecipe;
  copy: {
    start: string;
    levelClear: string[];
    lifeLost: string[];
    gameOver: string[];
    won: string;
  };
}
