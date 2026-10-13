/*
 * level.ts - LBreakout2 level-file format: parser, serializer and the
 * brick / bonus character tables.
 * Port of LBreakout2 (C) 2001-2015 Michael Speck and contributors,
 * GPL-2.0-or-later; this file GPL-3.0-or-later.
 *
 * File format (one levelset = many levels):
 *   Version: 1.00          (optional first line)
 *   Level:
 *   <author>
 *   <title>
 *   Bricks:
 *   18 lines of 14 brick chars ('.' = empty)
 *   Bonus:
 *   18 lines of 14 bonus chars ('.' = none)
 */

import type { ExtraKind, LevelDef } from "./types.ts";

export const EDIT_W = 14;
export const EDIT_H = 18;

/* map cell types (LBreakout2 MAP_*) */
export const MAP_EMPTY = 0;
export const MAP_WALL = 1;
export const MAP_BRICK = 2;
export const MAP_BRICK_EXP = 3;
export const MAP_BRICK_GROW = 4;
export const MAP_BRICK_HEAL = 5;
export const MAP_BRICK_CHAOS = 6;

export const BRICK_SCORE = 100;
export const INVIS_BRICK_ID = 6;
export const GROW_BRICK_ID = 19;
export const BRICK_GROW_FIRST = 12;
export const BRICK_GROW_LAST = 17;

export interface BrickConv {
  c: string;
  type: number;
  id: number;
  /** durability; -1 = only a metal ball destroys it (or never, for walls) */
  dur: number;
  score: number;
}

/** Brick conversion table, same order and values as bricks.c. */
export const BRICK_CONV: readonly BrickConv[] = [
  { c: "E", type: MAP_WALL, id: 0, dur: -1, score: 0 },
  { c: "#", type: MAP_BRICK, id: 1, dur: -1, score: 1000 },
  { c: "@", type: MAP_BRICK_CHAOS, id: 2, dur: -1, score: 1000 },
  { c: "a", type: MAP_BRICK, id: 3, dur: 1, score: BRICK_SCORE * 1 },
  { c: "b", type: MAP_BRICK, id: 4, dur: 2, score: BRICK_SCORE * 2 },
  { c: "c", type: MAP_BRICK, id: 5, dur: 3, score: BRICK_SCORE * 3 },
  { c: "v", type: MAP_BRICK, id: 6, dur: 4, score: BRICK_SCORE * 4 },
  { c: "x", type: MAP_BRICK_HEAL, id: 7, dur: 1, score: BRICK_SCORE * 2 },
  { c: "y", type: MAP_BRICK_HEAL, id: 8, dur: 2, score: BRICK_SCORE * 4 },
  { c: "z", type: MAP_BRICK_HEAL, id: 9, dur: 3, score: BRICK_SCORE * 6 },
  { c: "d", type: MAP_BRICK, id: 10, dur: 1, score: BRICK_SCORE },
  { c: "e", type: MAP_BRICK, id: 11, dur: 1, score: BRICK_SCORE },
  { c: "f", type: MAP_BRICK, id: 12, dur: 1, score: BRICK_SCORE },
  { c: "g", type: MAP_BRICK, id: 13, dur: 1, score: BRICK_SCORE },
  { c: "h", type: MAP_BRICK, id: 14, dur: 1, score: BRICK_SCORE },
  { c: "i", type: MAP_BRICK, id: 15, dur: 1, score: BRICK_SCORE },
  { c: "j", type: MAP_BRICK, id: 16, dur: 1, score: BRICK_SCORE },
  { c: "k", type: MAP_BRICK, id: 17, dur: 1, score: BRICK_SCORE },
  { c: "*", type: MAP_BRICK_EXP, id: 18, dur: 1, score: BRICK_SCORE * 2 },
  { c: "!", type: MAP_BRICK_GROW, id: GROW_BRICK_ID, dur: 1, score: BRICK_SCORE * 2 },
  /* grown bricks: same ids as f..k, upper case marks them as grown */
  { c: "F", type: MAP_BRICK, id: 12, dur: 1, score: BRICK_SCORE },
  { c: "G", type: MAP_BRICK, id: 13, dur: 1, score: BRICK_SCORE },
  { c: "H", type: MAP_BRICK, id: 14, dur: 1, score: BRICK_SCORE },
  { c: "I", type: MAP_BRICK, id: 15, dur: 1, score: BRICK_SCORE },
  { c: "J", type: MAP_BRICK, id: 16, dur: 1, score: BRICK_SCORE },
  { c: "K", type: MAP_BRICK, id: 17, dur: 1, score: BRICK_SCORE },
];

/** Extra kinds in LBreakout2 EX_* order (index = EX id). */
export const EXTRA_KINDS: readonly ExtraKind[] = [
  "score200", "score500", "score1000", "score2000", "score5000", "score10000",
  "goldshower", "shorten", "lengthen", "life", "slime", "metal", "ball",
  "wall", "frozen", "weapon", "random", "fast", "slow", "joker", "darkness",
  "chaos", "ghost", "disable", "timeadd", "explosive", "bonusmagnet",
  "malusmagnet", "weakball",
];

export const EX_NONE = -1;
export const EX_SCORE200 = 0;
export const EX_SCORE500 = 1;
export const EX_SCORE1000 = 2;
export const EX_SCORE2000 = 3;
export const EX_SCORE5000 = 4;
export const EX_SCORE10000 = 5;
export const EX_GOLDSHOWER = 6;
export const EX_SHORTEN = 7;
export const EX_LENGTHEN = 8;
export const EX_LIFE = 9;
export const EX_SLIME = 10;
export const EX_METAL = 11;
export const EX_BALL = 12;
export const EX_WALL = 13;
export const EX_FROZEN = 14;
export const EX_WEAPON = 15;
export const EX_RANDOM = 16;
export const EX_FAST = 17;
export const EX_SLOW = 18;
export const EX_JOKER = 19;
export const EX_DARKNESS = 20;
export const EX_CHAOS = 21;
export const EX_GHOST_PADDLE = 22;
export const EX_DISABLE = 23;
export const EX_TIME_ADD = 24;
export const EX_EXPL_BALL = 25;
export const EX_BONUS_MAGNET = 26;
export const EX_MALUS_MAGNET = 27;
export const EX_WEAK_BALL = 28;
export const EX_NUMBER = 29;

/** Index into BRICK_CONV for a brick char, -1 if unknown/empty. */
export function brickConvIndex(ch: string): number {
  for (let k = 0; k < BRICK_CONV.length; k++) if (BRICK_CONV[k].c === ch) return k;
  return -1;
}

/** EX id for a bonus char, -1 (EX_NONE) if none. */
export function extraFromChar(ch: string): number {
  return EXTRA_CHARS.indexOf(ch);
}

/** Bonus char for an EX id ('.' for none). */
export function extraToChar(ex: number): string {
  return ex >= 0 && ex < EX_NUMBER ? EXTRA_CHARS[ex] : ".";
}

/** Bonus chars in EX_* order (extra_conv_table of bricks.c). */
export const EXTRA_CHARS: readonly string[] = [
  "0", "1", "2", "3", "4", "5", "g", "-", "+", "l", "s", "m", "b", "w", "f",
  "p", "?", ">", "<", "j", "d", "c", "~", "!", "&", "*", "}", "{", "W",
];

/** True if the extra is a malus (extra_is_malus of extras.c). */
export function extraIsMalus(ex: number): boolean {
  return (
    ex === EX_SHORTEN || ex === EX_FROZEN || ex === EX_FAST ||
    ex === EX_DARKNESS || ex === EX_GHOST_PADDLE || ex === EX_CHAOS ||
    ex === EX_DISABLE || ex === EX_MALUS_MAGNET || ex === EX_WEAK_BALL
  );
}

/** True if a brick char is destructible by a normal hit (levels.c). */
export function isDestructibleChar(ch: string): boolean {
  return (
    (ch >= "a" && ch <= "k") || (ch >= "x" && ch <= "z") ||
    ch === "v" || ch === "*" || ch === "!"
  );
}

function fitLine(s: string | undefined): string {
  const line = (s ?? "").replace(/\r$/, "");
  if (line.length >= EDIT_W) return line.slice(0, EDIT_W);
  return line + ".".repeat(EDIT_W - line.length);
}

/** An empty 14x18 level. */
export function emptyLevel(title = "", author = ""): LevelDef {
  const rows: string[] = [];
  for (let i = 0; i < EDIT_H; i++) rows.push(".".repeat(EDIT_W));
  return { title, author, bricks: rows.slice(), bonus: rows.slice() };
}

/**
 * Parse a LBreakout2 levelset file. Lenient: tolerates CRLF, blank lines
 * between levels and short/long grid lines (padded with '.' / cut to 14).
 * Stops at the first malformed level, like level_load().
 */
export function parseLevelFile(text: string): LevelDef[] {
  const lines = text.split(/\r?\n/);
  const levels: LevelDef[] = [];
  let i = 0;
  if (lines.length > 0 && lines[0].startsWith("Version:")) i = 1;
  for (;;) {
    while (i < lines.length && lines[i].trim() === "") i++;
    if (i >= lines.length) break;
    if (!lines[i].startsWith("Level:")) break;
    i++;
    if (i + 2 >= lines.length) break;
    const author = lines[i++].slice(0, 31);
    const title = lines[i++].slice(0, 31);
    if (!(lines[i] ?? "").startsWith("Bricks:")) break;
    i++;
    const bricks: string[] = [];
    for (let r = 0; r < EDIT_H; r++) bricks.push(fitLine(lines[i++]));
    if (!(lines[i] ?? "").startsWith("Bonus:")) break;
    i++;
    const bonus: string[] = [];
    for (let r = 0; r < EDIT_H; r++) bonus.push(fitLine(lines[i++]));
    levels.push({ title, author, bricks, bonus });
  }
  return levels;
}

/** Serialize levels to the LBreakout2 levelset file format. */
export function serializeLevels(levels: readonly LevelDef[]): string {
  const out: string[] = ["Version: 1.00"];
  for (const l of levels) {
    out.push("Level:", l.author, l.title, "Bricks:");
    for (let r = 0; r < EDIT_H; r++) out.push(fitLine(l.bricks[r]));
    out.push("Bonus:");
    for (let r = 0; r < EDIT_H; r++) out.push(fitLine(l.bonus[r]));
  }
  return out.join("\n") + "\n";
}
