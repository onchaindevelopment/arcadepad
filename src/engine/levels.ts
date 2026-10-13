/*
 * levels.ts - original Game Port levels (LBreakout2 level format) and the
 * coin-ticker level generator.
 * Game Port, GPL-3.0-or-later.
 *
 * Brick chars: a/b/c = 1/2/3 hits, v = invisible (4 hits), x/y/z = healing,
 * d..k = plain colours, * = explosive, ! = grows neighbours, # = only a metal
 * ball breaks it, @ = chaos (random reflection, metal only), E = wall.
 * Bonus chars: see EXTRA_CHARS in level.ts (0..5 score, + lengthen,
 * - shorten, l life, s slime, m metal, b ball, w floor, f frozen, p weapon,
 * ? random, > fast, < slow, j joker, d darkness, c chaos, ~ ghost,
 * ! disable, & time add, * explosive ball, } bonus magnet, { malus magnet,
 * W weak ball).
 */

import type { LevelDef } from "./types.ts";
import { EDIT_H, EDIT_W } from "./level.ts";

const AUTHOR = "Game Port";

function pad(rows: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < EDIT_H; i++) {
    const r = rows[i] ?? "";
    out.push((r + ".".repeat(EDIT_W)).slice(0, EDIT_W));
  }
  return out;
}

function level(title: string, bricks: string[], bonus: string[]): LevelDef {
  return { title, author: AUTHOR, bricks: pad(bricks), bonus: pad(bonus) };
}

/** Eight original levels with escalating difficulty. */
export const OWN_LEVELS: readonly LevelDef[] = [
  level("First Light", [
    "..............",
    "..............",
    "dddddddddddddd",
    "eeeeeeeeeeeeee",
    "ffffffffffffff",
    "gggggggggggggg",
    "hhhhhhhhhhhhhh",
  ], [
    "..............",
    "..............",
    "..0........0..",
    "....+....b....",
    ".1.....s.....2",
    "......0.......",
    "..p.......+...",
  ]),
  level("Stepping Stones", [
    "..............",
    "......bb......",
    ".....baab.....",
    "....baddab....",
    "...baddddab...",
    "..baddeeddab..",
    ".baddeffeddab.",
    "baddeffffeddab",
    "..............",
    "..i..i..i..i..",
  ], [
    "..............",
    "......1.......",
    ".....+..s.....",
    "....0....b....",
    "...2......l...",
    "..p..0..0..m..",
    ".....w..?.....",
    "1...........0.",
    "..............",
    "..3........<..",
  ]),
  level("Checkpoint", [
    "..............",
    "c.c.c.c.c.c.c.",
    ".d.d.d.d.d.d.d",
    "e.e.e.e.e.e.e.",
    ".v.f.f.f.f.v.f",
    "g.g.g.g.g.g.g.",
    ".h.h.h.h.h.h.h",
    "b.b.b.b.b.b.b.",
  ], [
    "..............",
    "0...+...1...2.",
    ".s.....b.....p",
    "..........0...",
    ".l.0.....-.3..",
    "......*.......",
    ".?...>.....m..",
    "..w.......<...",
  ]),
  level("Spark Plugs", [
    "..............",
    "ffffffffffffff",
    "f*ff*ff*ff*ff*",
    "gggggggggggggg",
    "..............",
    "hhhhhhhhhhhhhh",
    "h*hh*hh*hh*hh*",
    "iiiiiiiiiiiiii",
    "..............",
    "..bb..bb..bb..",
  ], [
    "..............",
    "1....0....2...",
    "..............",
    ".+....s....b..",
    "..............",
    "0...3....?...0",
    "..............",
    ".p....>....l..",
    "..............",
    "..*.......m...",
  ]),
  level("Garrison", [
    "..............",
    "..##......##..",
    "..#..cccc..#..",
    "..#.b.yy.b.#..",
    "..#..cccc..#..",
    "..#........#..",
    "..##.x..x.##..",
    "..............",
    "jjjjjjjjjjjjjj",
    "kkkkkkkkkkkkkk",
  ], [
    "..............",
    "..............",
    ".....4..5.....",
    "....b.mm.s....",
    ".....+..p.....",
    "..............",
    ".....d..&.....",
    "..............",
    "1..0...?..0..2",
    ".l...w...<..>.",
  ]),
  level("Wildflowers", [
    "..............",
    "..!...!...!...",
    ".ddd.eee.fff..",
    "..............",
    "....!...!...!.",
    "...ggg.hhh.iii",
    "..............",
    "..!...!...!...",
    ".jjj.kkk.ddd..",
    "..............",
    "bbbbbbbbbbbbbb",
  ], [
    "..............",
    "..2...?...1...",
    ".+...s....b...",
    "..............",
    "....0...}...3.",
    "...p.....-....",
    "..............",
    "..?...c...0...",
    ".m...f...>....",
    "..............",
    "1..j..l..w..2.",
  ]),
  level("Chaos Theory", [
    "..............",
    "@............@",
    ".vvvvvvvvvvvv.",
    ".c..........c.",
    ".c.@..**..@.c.",
    ".c..........c.",
    ".bbbbbbbbbbbb.",
    "..............",
    "..aa..@@..aa..",
    "..............",
    "eeeeeeeeeeeeee",
  ], [
    "..............",
    "..............",
    ".3...m...p..4.",
    ".s..........b.",
    ".+..........l.",
    ".?.........*..",
    ".c..~..d..W.>.",
    "..............",
    "..2........0..",
    "..............",
    "1.j.{.?.!.&.0.",
  ]),
  level("The Vault", [
    "..............",
    "E####....####E",
    "#bbbbbbbbbbbb#",
    "#.*cccccccc*.#",
    "#.c@vvvvvv@c.#",
    "#.c.vyzzyv.c.#",
    "#.*cccccccc*.#",
    "#............#",
    "E##........##E",
    "..............",
    "..xx..xx..xx..",
    "..............",
    "bbbbbbbbbbbbbb",
  ], [
    "..............",
    "..............",
    ".5..m.....p.4.",
    "..s...3.....b.",
    "...l..*..?....",
    "....j.2....+..",
    "..W...!...~...",
    "..............",
    "..............",
    "..............",
    "..2..{..}..1..",
    "..............",
    "0..w..?..<..0.",
  ]),
];

/** The first five own levels: the ranked run. */
export const RANKED_LEVELS: readonly LevelDef[] = OWN_LEVELS.slice(0, 5);

/* 3x5 pixel font for the ticker level */
const FONT: Record<string, readonly string[]> = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: ["###", "#.#", "#.#", "#.#", "###"],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", "###"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": [".#.", "#.#", "#.#", "#.#", ".#."],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "###", "#.#", "###"],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": ["###", "#.#", "###", "#.#", "###"],
  "9": ["###", "#.#", "###", "..#", "##."],
  $: ["###", "#..", "###", "..#", "###"],
};

const GLYPH_BRICKS = "defghijk";
const TICKER_BONUS = "+bs12p0l3m+w2b";

/** Uppercase, keep A-Z 0-9 $, at most 6 chars (fallback "GP"). */
export function sanitizeTicker(ticker: string): string {
  let t = "";
  for (const ch of ticker.toUpperCase()) if (FONT[ch] && t.length < 6) t += ch;
  return t.length > 0 ? t : "GP";
}

/** Level 1 of a themed run: the ticker spelled in bricks, extras sprinkled. */
export function tickerLevel(ticker: string): LevelDef {
  const t = sanitizeTicker(ticker);
  const grid: string[][] = [];
  for (let r = 0; r < EDIT_H; r++) grid.push(".".repeat(EDIT_W).split(""));
  const lines = t.length <= 3 ? [t] : [t.slice(0, 3), t.slice(3)];
  const top = lines.length === 1 ? 4 : 2;
  /* a top line of single-hit bricks */
  for (let c = 0; c < EDIT_W; c++) grid[0][c] = "a";
  let g = 0;
  for (let li = 0; li < lines.length; li++) {
    const word = lines[li];
    const width = word.length * 4 - 1;
    const left = (EDIT_W - width) >> 1;
    for (let k = 0; k < word.length; k++) {
      const glyph = FONT[word[k]];
      const brick = GLYPH_BRICKS[g++ % GLYPH_BRICKS.length];
      for (let y = 0; y < 5; y++)
        for (let x = 0; x < 3; x++)
          if (glyph[y][x] === "#") grid[top + li * 6 + y][left + k * 4 + x] = brick;
    }
  }
  /* deterministic sprinkle of (mostly good) extras */
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 0x01000193) >>> 0;
  const bonus: string[][] = [];
  for (let r = 0; r < EDIT_H; r++) bonus.push(".".repeat(EDIT_W).split(""));
  const cells: number[] = [];
  for (let r = 0; r < EDIT_H; r++)
    for (let c = 0; c < EDIT_W; c++) if (grid[r][c] !== ".") cells.push(r * EDIT_W + c);
  const count = Math.min(9, cells.length);
  for (let i = 0; i < count; i++) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const cell = cells[h % cells.length];
    bonus[(cell / EDIT_W) | 0][cell % EDIT_W] = TICKER_BONUS[(h >>> 8) % TICKER_BONUS.length];
  }
  return {
    title: "$" + t,
    author: AUTHOR,
    bricks: grid.map((r) => r.join("")),
    bonus: bonus.map((r) => r.join("")),
  };
}

/** Themed run: ticker level, then the first four own levels. */
export function runLevels(ticker: string): LevelDef[] {
  return [tickerLevel(ticker), ...OWN_LEVELS.slice(0, 4)];
}
