/*
 * Four Up: an original four-in-a-row game against a ladder of Bear CPUs.
 * ArcadePad, GPL-3.0-or-later. No code ported; written from scratch. The
 * abstract game (drop discs into a 7x6 upright grid, first to line up four
 * wins) is a public-domain classic; no commercial name, board look or colours
 * are used.
 *
 * Rules: you are the coin, the Bear is the CPU. Tap a column (or LEFT/RIGHT +
 * FIRE) to drop. Win a match to climb a rung (the Bear searches deeper and
 * blunders less); a draw replays the rung with the other side starting; a loss
 * ends the run. Beat all 10 rungs to win the run.
 * Score: 1000 per match won + 50 per move you had left when you won (faster
 * wins pay more).
 *
 * The Bear is negamax with alpha-beta pruning at a depth set by the rung,
 * plus Rng-driven random blunders on the low rungs. Everything is integer or
 * plain + - * arithmetic, so replays are bit-identical.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const COLS = 7;
export const ROWS = 6;
export const CELL = 48;
export const BOARD_X = (W - COLS * CELL) / 2; // 12
export const BOARD_Y = 214;
export const AIM_Y = BOARD_Y - CELL / 2 - 6; // centre of the hovering disc
export const RUNGS = 10;

export const EMPTY = 0;
export const YOU = 1;
export const BEAR = 2;

/** Bear search depth and blunder chance (percent) per rung. */
export const DEPTH = [2, 3, 3, 4, 4, 5, 5, 6, 6, 7];
export const BLUNDER = [35, 25, 18, 12, 8, 5, 3, 1, 0, 0];

const INTRO_FRAMES = 80;
const END_FRAMES = 150;
const SKIP_AFTER = 30;
const G = 0.035; // drop gravity, rows per frame^2
const BOUNCE = 0.28;
const WIN = 1000000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];

export type Phase = "intro" | "turn" | "think" | "drop" | "end" | "over";

/** All 69 lines of four, as flat cell indices (r * COLS + c, r = 0 at the top). */
export const LINES: Int8Array = (() => {
  const out: number[] = [];
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of dirs) {
        const r3 = r + dr * 3;
        const c3 = c + dc * 3;
        if (r3 < 0 || r3 >= ROWS || c3 < 0 || c3 >= COLS) continue;
        for (let k = 0; k < 4; k++) out.push((r + dr * k) * COLS + c + dc * k);
      }
  return Int8Array.from(out);
})();

/** Row a disc dropped into column c lands on, or -1 if the column is full. */
export function landingRow(board: ArrayLike<number>, c: number): number {
  for (let r = ROWS - 1; r >= 0; r--) if (board[r * COLS + c] === EMPTY) return r;
  return -1;
}

/** The winning four through cell idx for player p, or null. */
export function lineThrough(board: ArrayLike<number>, idx: number, p: number): number[] | null {
  const r0 = Math.floor(idx / COLS);
  const c0 = idx % COLS;
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (const [dr, dc] of dirs) {
    const cells = [idx];
    for (const s of [1, -1]) {
      let r = r0 + dr * s;
      let c = c0 + dc * s;
      while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === p) {
        cells.push(r * COLS + c);
        r += dr * s;
        c += dc * s;
      }
    }
    if (cells.length >= 4) return cells.sort((a, b) => a - b);
  }
  return null;
}

function winsAt(board: Int8Array, idx: number, p: number): boolean {
  const r0 = Math.floor(idx / COLS);
  const c0 = idx % COLS;
  for (let d = 0; d < 4; d++) {
    const dr = d === 0 ? 0 : 1;
    const dc = d === 1 ? 0 : d === 3 ? -1 : 1;
    let n = 1;
    let r = r0 + dr, c = c0 + dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === p) { n++; r += dr; c += dc; }
    r = r0 - dr; c = c0 - dc;
    while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === p) { n++; r -= dr; c -= dc; }
    if (n >= 4) return true;
  }
  return false;
}

/** Static score of the position for player me (integer). */
export function evaluate(board: Int8Array, me: number): number {
  const op = 3 - me;
  let s = 0;
  for (let i = 0; i < LINES.length; i += 4) {
    let m = 0, o = 0;
    for (let k = 0; k < 4; k++) {
      const v = board[LINES[i + k]];
      if (v === me) m++;
      else if (v === op) o++;
    }
    if (m && o) continue;
    if (m === 3) s += 6;
    else if (m === 2) s += 2;
    else if (o === 3) s -= 7;
    else if (o === 2) s -= 2;
  }
  for (let r = 0; r < ROWS; r++) {
    const v = board[r * COLS + 3];
    if (v === me) s += 3;
    else if (v === op) s -= 3;
  }
  return s;
}

function negamax(board: Int8Array, heights: Int8Array, depth: number, alpha: number, beta: number, me: number, filled: number): number {
  if (depth === 0) return evaluate(board, me);
  let best = -WIN * 2;
  let any = false;
  for (let i = 0; i < COLS; i++) {
    const c = ORDER[i];
    if (heights[c] >= ROWS) continue;
    any = true;
    const idx = (ROWS - 1 - heights[c]) * COLS + c;
    board[idx] = me;
    heights[c]++;
    let s: number;
    if (winsAt(board, idx, me)) s = WIN + depth;
    else if (filled + 1 >= COLS * ROWS) s = 0;
    else s = -negamax(board, heights, depth - 1, -beta, -alpha, 3 - me, filled + 1);
    heights[c]--;
    board[idx] = EMPTY;
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return any ? best : 0;
}

/** Scores of every legal column for player me at the given depth (null = full). */
export function scoreMoves(board: ArrayLike<number>, me: number, depth: number): (number | null)[] {
  const b = Int8Array.from(board as ArrayLike<number>);
  const heights = new Int8Array(COLS);
  let filled = 0;
  for (let i = 0; i < b.length; i++) if (b[i] !== EMPTY) { filled++; heights[i % COLS]++; }
  const out: (number | null)[] = new Array(COLS).fill(null);
  let best = -WIN * 2;
  for (let i = 0; i < COLS; i++) {
    const c = ORDER[i];
    if (heights[c] >= ROWS) continue;
    const idx = (ROWS - 1 - heights[c]) * COLS + c;
    b[idx] = me;
    heights[c]++;
    let s: number;
    if (winsAt(b, idx, me)) s = WIN + depth;
    else if (filled + 1 >= COLS * ROWS) s = 0;
    else s = -negamax(b, heights, depth - 1, -WIN * 2, -(best - 1), 3 - me, filled + 1);
    heights[c]--;
    b[idx] = EMPTY;
    out[c] = s;
    if (s > best) best = s;
  }
  return out;
}

export interface Drop {
  col: number;
  row: number;
  who: number;
  /** Disc centre in rows: -1 = the aim row above the board, row = resting. */
  y: number;
  vy: number;
  hits: number;
}

export interface FourView {
  frame: number;
  phase: Phase;
  /** Frames spent in the current phase. */
  phaseT: number;
  board: number[];
  cursor: number; // your aim column
  bearCol: number; // where the Bear's disc hovers
  turn: number; // YOU or BEAR
  drop: Drop | null;
  lastIdx: number;
  winLine: number[] | null;
  outcome: "win" | "lose" | "draw" | null;
  level: number; // 1-based rung
  wins: number;
  score: number;
  youFirst: boolean;
  yourMoves: number;
  lastPoints: number;
  blundered: boolean;
  runWon: boolean;
}

export class FourEngine implements GameEngine<FourView> {
  private rng: Rng;
  board = new Int8Array(COLS * ROWS);
  phase: Phase = "intro";
  phaseT = 0;
  cursor = 3;
  bearCol = 3;
  private bearTarget = 3;
  private thinkFrames = 0;
  turn = YOU;
  drop: Drop | null = null;
  lastIdx = -1;
  winLine: number[] | null = null;
  outcome: "win" | "lose" | "draw" | null = null;
  level = 1;
  wins = 0;
  score = 0;
  private matchNo = 0; // every match played, replays included (decides who starts)
  youFirst = true;
  yourMoves = 0;
  lastPoints = 0;
  blundered = false;
  runWon = false;
  private prevB = 0;
  private prevX = -1;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.startMatch();
  }

  private startMatch() {
    this.board.fill(EMPTY);
    this.youFirst = (this.matchNo & 1) === 0;
    this.matchNo++;
    this.turn = this.youFirst ? YOU : BEAR;
    this.drop = null;
    this.lastIdx = -1;
    this.winLine = null;
    this.outcome = null;
    this.yourMoves = 0;
    this.blundered = false;
    this.setPhase("intro");
    this.events.push({ t: "match", level: this.level, youFirst: this.youFirst, sfx: "launch" });
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  private cellX(c: number) {
    return BOARD_X + c * CELL + CELL / 2;
  }
  private cellY(r: number) {
    return BOARD_Y + r * CELL + CELL / 2;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    if (this.frame >= four.maxFrames) {
      this.setPhase("over");
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    // Pointer: moving it (or tapping somewhere new) aims at that column.
    const px = inp.x;
    const moved = this.prevX >= 0 && px !== this.prevX;
    this.prevX = px;
    let aim = -1;
    if (moved) aim = Math.max(0, Math.min(COLS - 1, Math.floor((px - BOARD_X) / CELL)));
    this.phaseT++;

    switch (this.phase) {
      case "intro":
        if (this.phaseT >= INTRO_FRAMES || (pressed & BTN.FIRE && this.phaseT >= SKIP_AFTER)) this.beginTurn();
        if (aim >= 0) this.cursor = aim;
        return;
      case "turn": {
        if (aim >= 0 && aim !== this.cursor) { this.cursor = aim; this.events.push({ t: "aim", col: aim }); }
        if (pressed & BTN.LEFT && this.cursor > 0) { this.cursor--; this.events.push({ t: "aim", col: this.cursor }); }
        if (pressed & BTN.RIGHT && this.cursor < COLS - 1) { this.cursor++; this.events.push({ t: "aim", col: this.cursor }); }
        if (pressed & BTN.FIRE) {
          const r = landingRow(this.board, this.cursor);
          if (r < 0) this.events.push({ t: "full", sfx: "wall", x: this.cellX(this.cursor), y: AIM_Y });
          else this.startDrop(this.cursor, r, YOU);
        }
        return;
      }
      case "think":
        if (aim >= 0) this.cursor = aim;
        // The Bear's disc slides over to its chosen column, then drops.
        if (this.phaseT % 6 === 0 && this.bearCol !== this.bearTarget) this.bearCol += this.bearCol < this.bearTarget ? 1 : -1;
        if (this.phaseT >= this.thinkFrames && this.bearCol === this.bearTarget) this.startDrop(this.bearCol, landingRow(this.board, this.bearCol), BEAR);
        return;
      case "drop":
        if (aim >= 0) this.cursor = aim;
        this.updateDrop();
        return;
      case "end":
        if (aim >= 0) this.cursor = aim;
        if (this.phaseT >= END_FRAMES || (pressed & BTN.FIRE && this.phaseT >= SKIP_AFTER * 2)) this.finishMatch();
        return;
    }
  }

  private beginTurn() {
    if (this.turn === YOU) {
      this.setPhase("turn");
      return;
    }
    this.setPhase("think");
    this.bearTarget = this.chooseBear();
    this.thinkFrames = 24 + this.rng.int(24);
  }

  /** The Bear's move: deepest search for its rung, best scores tie-broken by Rng, sometimes a blunder. */
  private chooseBear(): number {
    const legal: number[] = [];
    for (let c = 0; c < COLS; c++) if (landingRow(this.board, c) >= 0) legal.push(c);
    const li = Math.min(this.level, RUNGS) - 1;
    this.blundered = false;
    if (this.rng.int(100) < BLUNDER[li]) {
      this.blundered = true;
      return legal[this.rng.int(legal.length)];
    }
    const scores = scoreMoves(this.board, BEAR, DEPTH[li]);
    let best = -WIN * 4;
    for (const s of scores) if (s !== null && s > best) best = s;
    const top: number[] = [];
    for (let c = 0; c < COLS; c++) if (scores[c] === best) top.push(c);
    return top[this.rng.int(top.length)];
  }

  private startDrop(col: number, row: number, who: number) {
    this.drop = { col, row, who, y: -1, vy: 0, hits: 0 };
    if (who === YOU) this.yourMoves++;
    this.setPhase("drop");
    this.events.push({ t: "drop", who, col, sfx: "shot", x: this.cellX(col), y: AIM_Y });
  }

  private updateDrop() {
    const d = this.drop!;
    d.vy += G;
    d.y += d.vy;
    if (d.y >= d.row) {
      d.y = d.row;
      const impact = d.vy;
      d.vy = -d.vy * BOUNCE;
      d.hits++;
      if (d.hits === 1) {
        this.events.push({ t: "thud", who: d.who, col: d.col, row: d.row, power: impact, sfx: d.who === YOU ? "paddle" : "brick", shake: 2, x: this.cellX(d.col), y: this.cellY(d.row) });
      }
      if (d.hits >= 3 || -d.vy < 0.03) this.land();
    }
  }

  private land() {
    const d = this.drop!;
    const idx = d.row * COLS + d.col;
    this.board[idx] = d.who;
    this.lastIdx = idx;
    this.drop = null;
    if (d.who === BEAR) this.bearCol = d.col;
    const line = lineThrough(this.board, idx, d.who);
    if (line) {
      this.winLine = line;
      const cx = (this.cellX(line[0] % COLS) + this.cellX(line[line.length - 1] % COLS)) / 2;
      const cy = (this.cellY(Math.floor(line[0] / COLS)) + this.cellY(Math.floor(line[line.length - 1] / COLS))) / 2;
      if (d.who === YOU) {
        this.outcome = "win";
        const bonus = Math.max(0, 21 - this.yourMoves) * 50;
        this.lastPoints = 1000 + bonus;
        this.score += this.lastPoints;
        this.wins++;
        this.events.push({ t: "win", points: this.lastPoints, bonus, cells: line, sfx: "levelclear", mood: "happy", toast: "levelClear", shake: 4, x: cx, y: cy });
      } else {
        this.outcome = "lose";
        this.events.push({ t: "lose", cells: line, sfx: "lost", mood: "sad", shake: 8, x: cx, y: cy });
      }
      this.setPhase("end");
      return;
    }
    let full = true;
    for (let c = 0; c < COLS; c++) if (this.board[c] === EMPTY) { full = false; break; }
    if (full) {
      this.outcome = "draw";
      this.events.push({ t: "draw", sfx: "extraBad" });
      this.setPhase("end");
      return;
    }
    this.turn = 3 - d.who;
    this.beginTurn();
  }

  private finishMatch() {
    if (this.outcome === "lose") {
      this.setPhase("over");
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    if (this.outcome === "win") {
      if (this.level >= RUNGS) {
        this.runWon = true;
        this.setPhase("over");
        this.events.push({ t: "won", sfx: "won", mood: "happy" });
        return;
      }
      this.level++;
    }
    this.startMatch();
  }

  view(): FourView {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      board: Array.from(this.board),
      cursor: this.cursor,
      bearCol: this.bearCol,
      turn: this.turn,
      drop: this.drop ? { ...this.drop } : null,
      lastIdx: this.lastIdx,
      winLine: this.winLine ? this.winLine.slice() : null,
      outcome: this.outcome,
      level: this.level,
      wins: this.wins,
      score: this.score,
      youFirst: this.youFirst,
      yourMoves: this.yourMoves,
      lastPoints: this.lastPoints,
      blundered: this.blundered,
      runWon: this.runWon,
    };
  }
  hud(): Hud {
    const label = this.phase === "turn" ? "Your move" : this.phase === "think" ? "Bear thinking" : `Rung ${this.level}/${RUNGS}`;
    return { score: this.score, level: this.level, label };
  }
  result(): GameResult {
    return {
      score: this.score,
      level: this.level - 1,
      levelsCleared: this.wins,
      frames: this.frame,
      status: this.phase !== "over" ? "playing" : this.runWon ? "won" : "over",
    };
  }
  get done() {
    return this.phase === "over";
  }
}

/** Cheap hash for the bot's (deterministic) imperfection. */
function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Bot move: win, block, avoid feeding the Bear, else a shallow search with some noise. */
export function botColumn(board: ArrayLike<number>, salt: number): number {
  const b = Int8Array.from(board as ArrayLike<number>);
  const legal: number[] = [];
  for (let c = 0; c < COLS; c++) if (landingRow(b, c) >= 0) legal.push(c);
  const scores = scoreMoves(b, YOU, 2);
  let best = -WIN * 4;
  for (const c of legal) if (scores[c]! > best) best = scores[c]!;
  if (best >= WIN) return scores.indexOf(best);
  const safe = legal.filter((c) => scores[c]! > -WIN);
  const pool = safe.length ? safe : legal;
  // A third of the time just play any safe column; otherwise the best shallow one.
  const h = hash(salt);
  if (h % 3 === 0) return pool[(h >>> 4) % pool.length];
  let pick = pool[0];
  for (const c of pool) if (scores[c]! > scores[pick]!) pick = c;
  return pick;
}

export const four: GameDef<FourView> = {
  id: "four",
  name: "Four Up",
  tagline: "Line up four before the Bear does. Every win, a smarter Bear.",
  genre: "Four in a row",
  session: "2–10 min",
  controls: "Tap a column, or ← → and Space to drop.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 30 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the public-domain four-in-a-row game with a negamax/alpha-beta CPU. No code, names, art, colours or sounds taken from any commercial game.",
  },
  create: (seed) => new FourEngine(seed),
  bot(v, frame) {
    const x = BOARD_X + v.cursor * CELL + CELL / 2;
    if (v.phase === "intro" || v.phase === "end") return { x, y: AIM_Y, b: v.phaseT > 70 && frame & 1 ? BTN.FIRE : 0 };
    if (v.phase !== "turn" || v.phaseT < 20) return { x, y: AIM_Y, b: 0 };
    const c = botColumn(v.board, v.frame * 31 + v.level);
    const tx = BOARD_X + c * CELL + CELL / 2;
    // Move the pointer first, then tap on the next frame.
    if (c !== v.cursor) return { x: tx, y: AIM_Y, b: 0 };
    return { x: tx, y: AIM_Y, b: frame & 1 ? BTN.FIRE : 0 };
  },
};
