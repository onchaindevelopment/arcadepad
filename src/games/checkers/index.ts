/*
 * Moon Checkers: an original draughts game against a ladder of Bear CPUs.
 * ArcadePad, GPL-3.0-or-later. No code ported; written from scratch. The
 * abstract game (English draughts on an 8x8 board) is a public-domain
 * classic; no commercial name, board look or colours are used.
 *
 * Rules (English draughts): pieces move diagonally forward on the dark
 * squares; kings move both ways. Captures are forced, a capture must be
 * finished (multi-jumps), and a man that reaches the far row is crowned,
 * which ends its move. No legal move = loss. 40 moves in a row (counting
 * both sides) without a capture = draw.
 * Run: a ladder of matches. Win a match to climb a rung (the Bear searches
 * deeper and blunders less); a draw replays the rung with the other side
 * starting; a loss ends the run. Beat all 10 rungs to win the run.
 * Score per win: 1000 + 20 per piece you have left + a speed bonus.
 *
 * The Bear is negamax with alpha-beta pruning (plus a capture extension) at a
 * depth set by the rung, Rng-driven blunders on low rungs and Rng tie-breaks.
 * Everything is integer arithmetic, so replays are bit-identical.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const N = 8;
export const CELL = 42;
export const BOARD_X = (W - N * CELL) / 2; // 12
export const BOARD_Y = 178;
export const RUNGS = 10;

export const EMPTY = 0;
export const YOU = 1; // your man; 3 = your king
export const BEAR = 2; // Bear man; 4 = Bear king
export const KING = 2; // added to a man's value

/** Bear search depth and blunder chance (percent) per rung. */
export const DEPTH = [1, 2, 2, 3, 3, 4, 4, 5, 5, 6];
export const BLUNDER = [30, 22, 15, 10, 6, 4, 2, 1, 0, 0];
/** Moves (plies, both sides) without a capture that make a draw. */
export const DRAW_MOVES = 40;

const INTRO_FRAMES = 80;
const END_FRAMES = 160;
const SKIP_AFTER = 30;
export const SLIDE_FRAMES = 12;
export const JUMP_FRAMES = 18;
const WIN = 1000000;

export type Phase = "intro" | "turn" | "think" | "anim" | "end" | "over";

export const owner = (v: number) => (v <= 0 ? 0 : v === YOU || v === YOU + KING ? YOU : BEAR);
export const isKing = (v: number) => v > 2;
export const sq = (r: number, c: number) => r * N + c;

/** A full move: start square, landing squares (one per hop), jumped squares. */
export interface Move {
  from: number;
  path: number[];
  caps: number[];
}

const DIAG = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

function forward(side: number) {
  return side === YOU ? -1 : 1;
}
function lastRow(side: number) {
  return side === YOU ? 0 : N - 1;
}

/** All legal moves for side (captures are forced). Board cells: 0 empty, 1..4 pieces. */
export function genMoves(board: ArrayLike<number>, side: number): Move[] {
  const b = Int8Array.from(board as ArrayLike<number>);
  const jumps: Move[] = [];
  for (let s = 0; s < N * N; s++) {
    if (owner(b[s]) !== side) continue;
    const piece = b[s];
    b[s] = EMPTY;
    const path: number[] = [];
    const caps: number[] = [];
    const dfs = (at: number) => {
      const r = Math.floor(at / N);
      const c = at % N;
      let found = false;
      for (const [dr, dc] of DIAG) {
        if (!isKing(piece) && dr !== forward(side)) continue;
        const lr = r + dr * 2;
        const lc = c + dc * 2;
        if (lr < 0 || lr >= N || lc < 0 || lc >= N) continue;
        const m = sq(r + dr, c + dc);
        const l = sq(lr, lc);
        const mid = b[m];
        if (mid <= 0 || owner(mid) === side || b[l] !== EMPTY) continue;
        found = true;
        b[m] = -1; // captured pieces stay on the board until the move ends
        path.push(l);
        caps.push(m);
        if (!isKing(piece) && lr === lastRow(side)) jumps.push({ from: s, path: path.slice(), caps: caps.slice() });
        else dfs(l);
        path.pop();
        caps.pop();
        b[m] = mid;
      }
      if (!found && path.length) jumps.push({ from: s, path: path.slice(), caps: caps.slice() });
    };
    dfs(s);
    b[s] = piece;
  }
  if (jumps.length) return jumps;
  const out: Move[] = [];
  for (let s = 0; s < N * N; s++) {
    const v = b[s];
    if (owner(v) !== side) continue;
    const r = Math.floor(s / N);
    const c = s % N;
    for (const [dr, dc] of DIAG) {
      if (!isKing(v) && dr !== forward(side)) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= N || nc < 0 || nc >= N) continue;
      if (b[sq(nr, nc)] === EMPTY) out.push({ from: s, path: [sq(nr, nc)], caps: [] });
    }
  }
  return out;
}

/** Apply a move to a board in place. Returns true if the piece was crowned. */
export function applyMove(b: Int8Array | number[], m: Move): boolean {
  const piece = b[m.from];
  b[m.from] = EMPTY;
  for (const c of m.caps) b[c] = EMPTY;
  const dest = m.path[m.path.length - 1];
  const side = owner(piece);
  const crown = !isKing(piece) && Math.floor(dest / N) === lastRow(side);
  b[dest] = crown ? piece + KING : piece;
  return crown;
}

export function startBoard(): Int8Array {
  const b = new Int8Array(N * N);
  for (let r = 0; r < N; r++)
    for (let c = 0; c < N; c++) {
      if ((r + c) % 2 !== 1) continue;
      if (r < 3) b[sq(r, c)] = BEAR;
      else if (r > 4) b[sq(r, c)] = YOU;
    }
  return b;
}

export function countPieces(board: ArrayLike<number>, side: number): number {
  let n = 0;
  for (let i = 0; i < N * N; i++) if (owner(board[i]) === side) n++;
  return n;
}

/** Static score of the position for side me (integer). */
export function evaluate(b: ArrayLike<number>, me: number): number {
  let s = 0;
  for (let i = 0; i < N * N; i++) {
    const v = b[i];
    if (v <= 0) continue;
    const side = owner(v);
    const r = Math.floor(i / N);
    const c = i % N;
    let val: number;
    if (isKing(v)) val = 165 + (c > 1 && c < 6 && r > 1 && r < 6 ? 6 : 0);
    else {
      const adv = side === YOU ? N - 1 - r : r;
      val = 100 + adv * 4 + (adv === 0 ? 8 : 0) + (c > 1 && c < 6 ? 3 : 0);
    }
    s += side === me ? val : -val;
  }
  return s;
}

function negamax(b: Int8Array, side: number, depth: number, alpha: number, beta: number, quiet: number): number {
  const moves = genMoves(b, side);
  if (!moves.length) return -WIN - depth;
  if (quiet >= DRAW_MOVES) return 0;
  const capture = moves[0].caps.length > 0;
  if (depth <= 0 && (!capture || depth <= -4)) return evaluate(b, side);
  let best = -WIN * 2;
  for (const m of moves) {
    const nb = b.slice();
    applyMove(nb, m);
    const s = -negamax(nb, 3 - side, depth - 1, -beta, -alpha, m.caps.length ? 0 : quiet + 1);
    if (s > best) best = s;
    if (s > alpha) alpha = s;
    if (alpha >= beta) break;
  }
  return best;
}

/** Score every legal move for side at the given depth (same order as genMoves). */
export function scoreMoves(board: ArrayLike<number>, side: number, depth: number, quiet = 0): { moves: Move[]; scores: number[] } {
  const b = Int8Array.from(board as ArrayLike<number>);
  const moves = genMoves(b, side);
  const scores: number[] = [];
  let best = -WIN * 4;
  for (const m of moves) {
    const nb = b.slice();
    applyMove(nb, m);
    const s = -negamax(nb, 3 - side, depth - 1, -WIN * 4, -(best - 1), m.caps.length ? 0 : quiet + 1);
    scores.push(s);
    if (s > best) best = s;
  }
  return { moves, scores };
}

export interface Hop {
  from: number;
  to: number;
  cap: number; // jumped square or -1
  piece: number;
}

export interface CheckersView {
  frame: number;
  phase: Phase;
  phaseT: number;
  board: number[];
  turn: number;
  cursor: number;
  selected: number;
  /** Squares the selected piece can hop to next. */
  dests: number[];
  /** Your pieces that have a legal move (when nothing is selected). */
  movable: number[];
  mustJump: boolean;
  /** Mid multi-jump: selection can't be cancelled. */
  locked: boolean;
  hop: Hop | null;
  hopFrames: number;
  lastFrom: number;
  lastTo: number;
  outcome: "win" | "lose" | "draw" | null;
  level: number;
  wins: number;
  score: number;
  youFirst: boolean;
  yourMoves: number;
  quiet: number;
  lastPoints: number;
  lastBonus: number;
  blundered: boolean;
  runWon: boolean;
}

export class CheckersEngine implements GameEngine<CheckersView> {
  private rng: Rng;
  board = startBoard();
  phase: Phase = "intro";
  phaseT = 0;
  turn = YOU;
  cursor = sq(5, 2);
  selected = -1;
  private legal: Move[] = [];
  /** Candidate moves still matching the hops made so far this turn. */
  private cands: Move[] = [];
  private hopIdx = 0;
  locked = false;
  hop: Hop | null = null;
  private hopFrames = SLIDE_FRAMES;
  private queue: Hop[] = [];
  private moving: Move | null = null;
  private bearMove: Move | null = null;
  private thinkFrames = 0;
  lastFrom = -1;
  lastTo = -1;
  outcome: "win" | "lose" | "draw" | null = null;
  level = 1;
  wins = 0;
  score = 0;
  private matchNo = 0;
  youFirst = true;
  yourMoves = 0;
  quiet = 0;
  lastPoints = 0;
  lastBonus = 0;
  blundered = false;
  runWon = false;
  private prevB = 0;
  private prevX = -1;
  private prevY = -1;
  private pointerOut = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.startMatch();
  }

  private startMatch() {
    this.board = startBoard();
    this.youFirst = (this.matchNo & 1) === 0;
    this.matchNo++;
    this.turn = this.youFirst ? YOU : BEAR;
    this.selected = -1;
    this.locked = false;
    this.hop = null;
    this.queue = [];
    this.lastFrom = this.lastTo = -1;
    this.outcome = null;
    this.yourMoves = 0;
    this.quiet = 0;
    this.blundered = false;
    this.cursor = sq(5, 2);
    this.setPhase("intro");
    this.events.push({ t: "match", level: this.level, youFirst: this.youFirst, sfx: "launch" });
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  static cx(s: number) {
    return BOARD_X + (s % N) * CELL + CELL / 2;
  }
  static cy(s: number) {
    return BOARD_Y + Math.floor(s / N) * CELL + CELL / 2;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    if (this.frame >= checkers.maxFrames) {
      this.setPhase("over");
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    const moved = this.prevX >= 0 && (inp.x !== this.prevX || inp.y !== this.prevY);
    this.prevX = inp.x;
    this.prevY = inp.y;
    if (moved) {
      const c = Math.floor((inp.x - BOARD_X) / CELL);
      const r = Math.floor((inp.y - BOARD_Y) / CELL);
      this.pointerOut = !(inp.x >= BOARD_X && r >= 0 && r < N && c >= 0 && c < N && inp.y >= BOARD_Y);
      if (!this.pointerOut) this.cursor = sq(r, c);
    }
    this.phaseT++;

    switch (this.phase) {
      case "intro":
        if (this.phaseT >= INTRO_FRAMES || (pressed & BTN.FIRE && this.phaseT >= SKIP_AFTER)) this.beginTurn();
        return;
      case "turn":
        this.playerInput(pressed);
        return;
      case "think":
        if (this.phaseT >= this.thinkFrames) this.startMove(this.bearMove!);
        return;
      case "anim":
        this.updateHop();
        return;
      case "end":
        if (this.phaseT >= END_FRAMES || (pressed & BTN.FIRE && this.phaseT >= SKIP_AFTER * 2)) this.finishMatch();
        return;
    }
  }

  private playerInput(pressed: number) {
    let r = Math.floor(this.cursor / N);
    let c = this.cursor % N;
    const keys = pressed & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
    if (keys) {
      if (pressed & BTN.UP && r > 0) r--;
      if (pressed & BTN.DOWN && r < N - 1) r++;
      if (pressed & BTN.LEFT && c > 0) c--;
      if (pressed & BTN.RIGHT && c < N - 1) c++;
      this.pointerOut = false;
      if (sq(r, c) !== this.cursor) {
        this.cursor = sq(r, c);
        this.events.push({ t: "cursor", at: this.cursor });
      }
    }
    if (pressed & BTN.ALT && this.selected >= 0 && !this.locked) {
      this.selected = -1;
      this.events.push({ t: "deselect" });
    }
    if (pressed & BTN.FIRE && !this.pointerOut) this.act(this.cursor);
  }

  private dests(): number[] {
    if (this.selected < 0) return [];
    const out: number[] = [];
    for (const m of this.cands) if (m.from === this.selected || this.locked) {
      const d = m.path[this.hopIdx];
      if (d !== undefined && !out.includes(d)) out.push(d);
    }
    return out;
  }

  private act(s: number) {
    const x = CheckersEngine.cx(s);
    const y = CheckersEngine.cy(s);
    if (this.selected >= 0 && this.dests().includes(s)) {
      if (!this.locked) this.cands = this.cands.filter((m) => m.from === this.selected);
      this.cands = this.cands.filter((m) => m.path[this.hopIdx] === s);
      this.yourMovePick(s);
      return;
    }
    if (this.locked) {
      this.events.push({ t: "nope", sfx: "wall", x, y, why: "keep jumping" });
      return;
    }
    if (owner(this.board[s]) === YOU) {
      if (this.legal.some((m) => m.from === s)) {
        this.selected = s === this.selected ? -1 : s;
        this.events.push({ t: this.selected >= 0 ? "select" : "deselect", sfx: "paddle", x, y });
      } else {
        const why = this.legal[0] && this.legal[0].caps.length ? "must jump" : "stuck";
        this.events.push({ t: "nope", sfx: "wall", x, y, why });
      }
      return;
    }
    if (this.selected >= 0) {
      this.selected = -1;
      this.events.push({ t: "deselect" });
    }
  }

  /** Player chose the next landing square: animate one hop. */
  private yourMovePick(to: number) {
    const m = this.cands[0];
    const from = this.hopIdx === 0 ? m.from : m.path[this.hopIdx - 1];
    const cap = m.caps.length ? m.caps[this.hopIdx] : -1;
    if (this.hopIdx === 0) {
      this.yourMoves++;
      this.lastFrom = from;
    }
    this.hopIdx++;
    this.queue = [{ from, to, cap, piece: this.board[from] }];
    this.moving = null;
    this.setPhase("anim");
    this.nextHop();
  }

  private beginTurn() {
    this.legal = genMoves(this.board, this.turn);
    if (!this.legal.length) {
      this.endMatch(this.turn === YOU ? "lose" : "win");
      return;
    }
    if (this.quiet >= DRAW_MOVES) {
      this.endMatch("draw");
      return;
    }
    this.hopIdx = 0;
    this.locked = false;
    this.selected = -1;
    if (this.turn === YOU) {
      this.cands = this.legal.slice();
      // Only one piece can move? Pick it up for you.
      const froms = new Set(this.legal.map((m) => m.from));
      if (froms.size === 1) this.selected = this.legal[0].from;
      this.setPhase("turn");
      return;
    }
    this.bearMove = this.chooseBear();
    this.thinkFrames = 26 + this.rng.int(24) + this.level * 2;
    this.setPhase("think");
    this.events.push({ t: "think" });
  }

  /** The Bear's move: search to its rung's depth, ties broken by Rng, sometimes a blunder. */
  private chooseBear(): Move {
    const li = Math.min(this.level, RUNGS) - 1;
    this.blundered = false;
    if (this.legal.length > 1 && this.rng.int(100) < BLUNDER[li]) {
      this.blundered = true;
      return this.legal[this.rng.int(this.legal.length)];
    }
    const { moves, scores } = scoreMoves(this.board, BEAR, DEPTH[li], this.quiet);
    let best = -WIN * 8;
    for (const s of scores) if (s > best) best = s;
    const top: Move[] = [];
    for (let i = 0; i < moves.length; i++) if (scores[i] === best) top.push(moves[i]);
    return top[this.rng.int(top.length)];
  }

  /** Queue every hop of a full move (Bear). */
  private startMove(m: Move) {
    this.moving = m;
    this.queue = [];
    let at = m.from;
    for (let i = 0; i < m.path.length; i++) {
      this.queue.push({ from: at, to: m.path[i], cap: m.caps.length ? m.caps[i] : -1, piece: this.board[m.from] });
      at = m.path[i];
    }
    this.lastFrom = m.from;
    this.setPhase("anim");
    this.nextHop();
  }

  private nextHop() {
    this.hop = this.queue.shift()!;
    this.hopFrames = this.hop.cap >= 0 ? JUMP_FRAMES : SLIDE_FRAMES;
    this.phaseT = 0;
    const h = this.hop;
    this.events.push({ t: h.cap >= 0 ? "jump" : "slide", who: owner(h.piece), sfx: h.cap >= 0 ? "shot" : undefined, x: CheckersEngine.cx(h.from), y: CheckersEngine.cy(h.from) });
  }

  private updateHop() {
    if (this.phaseT < this.hopFrames) return;
    const h = this.hop!;
    const who = owner(h.piece);
    const x = CheckersEngine.cx(h.to);
    const y = CheckersEngine.cy(h.to);
    this.board[h.from] = EMPTY;
    this.board[h.to] = h.piece;
    this.cursor = who === YOU ? h.to : this.cursor;
    if (h.cap >= 0) {
      const victim = this.board[h.cap];
      this.board[h.cap] = EMPTY;
      this.events.push({
        t: "capture", who, piece: victim, at: h.cap,
        sfx: who === YOU ? "brickgone" : "explode",
        mood: who === YOU ? undefined : "sad",
        shake: who === YOU ? 3 : 5,
        x: CheckersEngine.cx(h.cap), y: CheckersEngine.cy(h.cap),
      });
    } else {
      this.events.push({ t: "land", who, sfx: who === YOU ? "paddle" : "brick", x, y });
    }
    this.hop = null;
    if (this.queue.length) {
      this.nextHop();
      return;
    }
    if (who === YOU) {
      // Multi-jump: continue automatically if there is only one way on.
      const left = this.cands.filter((m) => m.path.length > this.hopIdx);
      if (left.length) {
        this.selected = h.to;
        this.locked = true;
        const nexts = new Set(left.map((m) => m.path[this.hopIdx]));
        if (nexts.size === 1) {
          this.cands = left;
          this.yourMovePick(left[0].path[this.hopIdx]);
          return;
        }
        this.cands = left;
        this.setPhase("turn");
        this.events.push({ t: "more", x, y });
        return;
      }
    }
    this.finishMove(h, who);
  }

  private finishMove(h: Hop, who: number) {
    const dest = h.to;
    const captured = who === YOU ? this.hopIdx > 0 && this.cands[0].caps.length > 0 : this.moving!.caps.length > 0;
    this.lastTo = dest;
    this.selected = -1;
    this.locked = false;
    this.moving = null;
    const piece = this.board[dest];
    if (!isKing(piece) && Math.floor(dest / N) === lastRow(who)) {
      this.board[dest] = piece + KING;
      this.events.push({
        t: "crown", who, sfx: who === YOU ? "extraGood" : "extraBad", mood: who === YOU ? "happy" : undefined,
        x: CheckersEngine.cx(dest), y: CheckersEngine.cy(dest),
      });
    }
    this.quiet = captured ? 0 : this.quiet + 1;
    this.turn = 3 - who;
    this.beginTurn();
  }

  private endMatch(outcome: "win" | "lose" | "draw") {
    this.outcome = outcome;
    this.selected = -1;
    const mx = BOARD_X + (N * CELL) / 2;
    const my = BOARD_Y + (N * CELL) / 2;
    if (outcome === "win") {
      const left = countPieces(this.board, YOU);
      const bonus = Math.max(0, 40 - this.yourMoves) * 15;
      this.lastBonus = bonus;
      this.lastPoints = 1000 + left * 20 + bonus;
      this.score += this.lastPoints;
      this.wins++;
      this.events.push({ t: "win", points: this.lastPoints, bonus, left, sfx: "levelclear", mood: "happy", toast: "levelClear", shake: 4, x: mx, y: my });
    } else if (outcome === "lose") {
      this.events.push({ t: "lose", sfx: "lost", mood: "sad", shake: 8, x: mx, y: my });
    } else {
      this.events.push({ t: "draw", sfx: "extraBad", x: mx, y: my });
    }
    this.setPhase("end");
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

  view(): CheckersView {
    const turnPhase = this.phase === "turn";
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      board: Array.from(this.board),
      turn: this.turn,
      cursor: this.cursor,
      selected: this.selected,
      dests: turnPhase ? this.dests() : [],
      movable: turnPhase && !this.locked ? [...new Set(this.legal.map((m) => m.from))] : [],
      mustJump: turnPhase && this.legal.length > 0 && this.legal[0].caps.length > 0,
      locked: this.locked,
      hop: this.hop ? { ...this.hop } : null,
      hopFrames: this.hopFrames,
      lastFrom: this.lastFrom,
      lastTo: this.lastTo,
      outcome: this.outcome,
      level: this.level,
      wins: this.wins,
      score: this.score,
      youFirst: this.youFirst,
      yourMoves: this.yourMoves,
      quiet: this.quiet,
      lastPoints: this.lastPoints,
      lastBonus: this.lastBonus,
      blundered: this.blundered,
      runWon: this.runWon,
    };
  }
  hud(): Hud {
    const label = this.phase === "turn" ? (this.locked ? "Keep jumping!" : "Your move") : this.phase === "think" ? "Bear thinking" : `Rung ${this.level}/${RUNGS}`;
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

let botCache: { key: string; move: Move } | null = null;

/** Bot move: shallow search, sometimes a lesser (but not losing-a-piece-for-free) move. */
export function botMove(board: ArrayLike<number>, quiet: number, salt: number): Move {
  const key = Array.prototype.join.call(board, "") + ":" + quiet + ":" + salt;
  if (botCache && botCache.key === key) return botCache.move;
  const { moves, scores } = scoreMoves(board, YOU, 3, quiet);
  const order = moves.map((_, i) => i).sort((a, b) => scores[b] - scores[a] || a - b);
  const h = hash(salt ^ key.length);
  let pick = order[0];
  if (h % 4 === 0 && order.length > 1 && scores[order[1]] > scores[order[0]] - 60) pick = order[1];
  botCache = { key, move: moves[pick] };
  return moves[pick];
}

export const checkers: GameDef<CheckersView> = {
  id: "checkers",
  name: "Moon Checkers",
  tagline: "Jump the Bears, crown your coins. Every win, a sharper Bear.",
  genre: "Checkers",
  session: "5–20 min",
  controls: "Tap a coin, then tap where it goes. Arrows + Space, X to cancel.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 60 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of public-domain English draughts with a negamax/alpha-beta CPU. No code, names, art, colours or sounds taken from any commercial game.",
  },
  create: (seed) => new CheckersEngine(seed),
  bot(v, frame) {
    const at = (s: number, b: number) => ({ x: CheckersEngine.cx(s), y: CheckersEngine.cy(s), b });
    if (v.phase === "intro" || v.phase === "end") return at(v.cursor, v.phaseT > 70 && frame & 1 ? BTN.FIRE : 0);
    if (v.phase !== "turn" || v.phaseT < 14) return at(v.cursor, 0);
    let target: number;
    if (v.locked) {
      target = v.dests[hash(v.frame) % v.dests.length];
    } else {
      const m = botMove(v.board, v.quiet, v.yourMoves * 131 + v.level);
      target = v.selected === m.from ? m.path[0] : m.from;
    }
    // Move the pointer first, then tap.
    if (target !== v.cursor) return at(target, 0);
    return at(target, frame & 1 ? BTN.FIRE : 0);
  },
};
