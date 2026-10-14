/*
 * Crate Push: an original box-pushing warehouse puzzle for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original design and code (no ported source).
 *
 * The genre mechanic (walk a grid, push crates one at a time onto target
 * pads, never pull) is used; the levels are our own (levels.ts, hand-made
 * and picked from our generator) and after them the run continues with
 * generated levels (gen.ts). ALT (tap on touch) undoes a move, 5 per level;
 * holding FIRE for a second, or a quick double ALT/tap, restarts the level
 * (costs points). Each level has a generous
 * time limit; running out ends the run. Score per level: base + a bonus for
 * coming close to the solver's optimal push count + seconds left.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";
import { LEVELS } from "./levels.ts";
import { generateLevel } from "./gen.ts";
import { DX, DY, FLOOR, OUTSIDE, WALL, blockDeadlock, liveCells, parseLevel, solve, type Level } from "./solver.ts";

export const FIELD_W = 360;
export const FIELD_H = 600;
/** Frames one step/push takes to slide. */
export const MOVE_FR = 7;
/** Frames a direction must be held before it repeats. */
const REPEAT_FR = 12;
export const UNDOS = 5;
/** Frames FIRE must be held to restart. */
export const RESTART_FR = 60;
export const RESTART_COST = 50;
const CLEAR_FR = 100;
/** Two ALT presses this close together restart the level (touch double-tap). */
export const DOUBLE_TAP_FR = 15;
/** Generated levels start at this generator tier. */
const GEN_TIER0 = 6;
/** Clearing this many levels wins the run. */
export const WIN_LEVELS = 60;
const MAX_FRAMES = 60 * 60 * 60;

const DIR_BTN = [BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT];

/** Board placement inside the 360x600 field (shared by renderer and tests). */
export function layout(w: number, h: number) {
  const cell = Math.min(40, Math.floor(340 / w), Math.floor(440 / h));
  return { cell, x0: Math.floor((FIELD_W - w * cell) / 2), y0: 80 + Math.floor((448 - h * cell) / 2) };
}

/** Time limit in frames: generous, longer for levels with long solutions. */
export function timeLimitFor(solutionMoves: number) {
  return Math.max(60, Math.min(300, 45 + solutionMoves)) * 60;
}

export interface CrateInfo {
  id: number;
  cell: number;
  /** Cell before the current slide (== cell when not moving). */
  from: number;
  on: boolean;
}

export interface CratesView {
  frame: number;
  phase: "play" | "clear" | "over" | "won";
  level: number; // 0-based
  name: string;
  generated: boolean;
  w: number;
  h: number;
  /** One char per cell: '#' wall, ' ' floor, '.' pad, '-' outside. */
  map: string;
  /** Changes whenever a new level loads (renderer cache key). */
  mapId: number;
  crates: CrateInfo[];
  player: number;
  playerFrom: number;
  facing: number; // 0 up, 1 right, 2 down, 3 left
  /** Slide progress 0..1 (1 = at rest). */
  t: number;
  /** Frames at rest since the last slide ended. */
  idle: number;
  moves: number;
  pushes: number;
  optimal: number;
  undos: number;
  timeLeft: number;
  timeLimit: number;
  /** 0..1 while FIRE is held towards a restart. */
  restart: number;
  /** A crate is off its pad and can never reach one. */
  stuck: boolean;
  score: number;
  clearTimer: number;
  /** Reference solution from the level start, and the moves made since (for the bot). */
  solution: readonly number[];
  path: number[];
}

interface HistoryEntry {
  dir: number;
  player: number;
  crate: number; // crate id or -1
  crateFrom: number;
}

const NAME_A = ["Cold", "Deep", "Night", "Back", "Hidden", "Iron", "Quiet", "Lower", "Old", "Far", "Dusty", "Locked"];
const NAME_B = ["Vault", "Dock", "Ledger", "Depot", "Cellar", "Annex", "Yard", "Bay", "Store", "Hold", "Wing", "Pit"];

class CratesEngine implements GameEngine<CratesView> {
  private rng: Rng;
  private lv!: Level;
  private live!: Uint8Array;
  private mapStr = "";
  private mapId = 0;
  private name = "";
  private generated = false;
  private solution: number[] = [];
  private optimal = 0;
  private level = 0;
  private cleared = 0;
  private crates: number[] = [];
  private crateFrom: number[] = [];
  private occ!: Int8Array; // cell -> crate id + 1
  private player = 0;
  private playerFrom = 0;
  private facing = 2;
  private history: HistoryEntry[] = [];
  private undos = UNDOS;
  private moves = 0;
  private pushes = 0;
  private anim = 0;
  private idle = 0;
  private queue = -1; // dir, or -2 = undo
  private holdDir = -1;
  private holdFrames = 0;
  private fireHold = 0;
  private lastAlt = -1000;
  private timeLeft = 0;
  private timeLimit = 0;
  private stuck = false;
  private phase: CratesView["phase"] = "play";
  private clearTimer = 0;
  private score = 0;
  private prevB = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.load(0);
  }

  private load(L: number) {
    this.level = L;
    let lv: Level | null = null;
    let sol: number[] = [];
    let opt = 0;
    if (L < LEVELS.length) {
      lv = parseLevel(LEVELS[L].rows);
      const s = solve(lv)!;
      sol = s.moves;
      opt = s.pushes;
      this.name = LEVELS[L].name;
      this.generated = false;
    } else {
      const g = generateLevel(this.rng, GEN_TIER0 + (L - LEVELS.length));
      if (g) {
        lv = g.level;
        sol = g.solution.moves;
        opt = g.solution.pushes;
      } else {
        // Never expected; fall back to a late hand-made level.
        const def = LEVELS[LEVELS.length - 1 - this.rng.int(5)];
        lv = parseLevel(def.rows);
        const s = solve(lv)!;
        sol = s.moves;
        opt = s.pushes;
      }
      this.name = `${NAME_A[this.rng.int(NAME_A.length)]} ${NAME_B[this.rng.int(NAME_B.length)]}`;
      this.generated = true;
    }
    this.lv = lv;
    this.live = liveCells(lv);
    this.solution = sol;
    this.optimal = opt;
    let m = "";
    for (let i = 0; i < lv.cell.length; i++) {
      m += lv.cell[i] === WALL ? "#" : lv.cell[i] === OUTSIDE ? "-" : lv.goal[i] ? "." : " ";
    }
    this.mapStr = m;
    this.mapId++;
    this.timeLimit = timeLimitFor(sol.length);
    this.timeLeft = this.timeLimit;
    this.reset();
    this.phase = "play";
  }

  /** Put crates and player back to the level start (level load or restart). */
  private reset() {
    const lv = this.lv;
    this.crates = lv.crates.slice();
    this.crateFrom = lv.crates.slice();
    this.occ = new Int8Array(lv.cell.length);
    this.crates.forEach((c, id) => (this.occ[c] = id + 1));
    this.player = this.playerFrom = lv.player;
    this.facing = 2;
    this.history = [];
    this.undos = UNDOS;
    this.moves = 0;
    this.pushes = 0;
    this.anim = 0;
    this.idle = 0;
    this.queue = -1;
    this.stuck = false;
  }

  private xy(cell: number) {
    const L = layout(this.lv.w, this.lv.h);
    const c = cell % this.lv.w, r = (cell - c) / this.lv.w;
    return { x: L.x0 + c * L.cell + (L.cell >> 1), y: L.y0 + r * L.cell + (L.cell >> 1) };
  }

  private settle() {
    for (let i = 0; i < this.crates.length; i++) this.crateFrom[i] = this.crates[i];
    this.playerFrom = this.player;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    if (this.phase === "over" || this.phase === "won") return;

    if (this.anim > 0 && --this.anim === 0) this.settle();

    if (this.phase === "clear") {
      if (--this.clearTimer <= 0) {
        if (this.cleared >= WIN_LEVELS) {
          this.phase = "won";
          this.events.push({ t: "won", sfx: "won", mood: "happy" });
        } else this.load(this.level + 1);
      }
      return;
    }

    // Clock.
    if (--this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.phase = "over";
      this.events.push({ t: "timeout", sfx: "lost", mood: "sad", shake: 6, toast: "lifeLost" });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    if (this.timeLeft === 600) this.events.push({ t: "hurry", sfx: "extraBad" });

    // Hold FIRE to restart.
    if (inp.b & BTN.FIRE) {
      if (++this.fireHold === RESTART_FR) {
        this.queue = -1;
        this.restart();
      }
    } else this.fireHold = 0;

    if (pressed & BTN.ALT) {
      if (this.frame - this.lastAlt <= DOUBLE_TAP_FR) {
        this.lastAlt = -1000;
        this.queue = -1;
        this.restart();
      } else {
        this.lastAlt = this.frame;
        this.queue = -2;
      }
    }
    for (let d = 0; d < 4; d++) if (pressed & DIR_BTN[d]) this.queue = d;
    let held = -1;
    for (let d = 0; d < 4; d++) if (inp.b & DIR_BTN[d]) held = held < 0 ? d : held;
    if (held !== this.holdDir) {
      this.holdDir = held;
      this.holdFrames = 0;
    } else if (held >= 0) this.holdFrames++;

    if (this.anim > 0) return;
    this.idle++;
    if (this.queue === -2) {
      this.queue = -1;
      this.undo();
    } else if (this.queue >= 0) {
      const d = this.queue;
      this.queue = -1;
      this.tryMove(d, true);
    } else if (this.holdDir >= 0 && this.holdFrames >= REPEAT_FR) {
      this.tryMove(this.holdDir, false);
    }
  }

  private tryMove(d: number, fresh: boolean) {
    const { w, cell, goal } = this.lv;
    const o = DX[d] + DY[d] * w;
    const t = this.player + o;
    this.facing = d;
    const bump = () => {
      if (fresh) {
        const p = this.xy(this.player);
        this.events.push({ t: "bump", sfx: "wall", dir: d, x: p.x, y: p.y });
      }
    };
    if (cell[t] !== FLOOR) return bump();
    const id = this.occ[t] - 1;
    const entry: HistoryEntry = { dir: d, player: this.player, crate: -1, crateFrom: -1 };
    if (id >= 0) {
      const u = t + o;
      if (cell[u] !== FLOOR || this.occ[u]) return bump();
      entry.crate = id;
      entry.crateFrom = t;
      this.occ[t] = 0;
      this.occ[u] = id + 1;
      this.crates[id] = u;
      this.pushes++;
      const p = this.xy(u);
      if (goal[u]) this.events.push({ t: "pad", sfx: "brick", x: p.x, y: p.y, id });
      else if (goal[t]) this.events.push({ t: "unpad", sfx: "paddle", x: p.x, y: p.y, id });
      else this.events.push({ t: "push", sfx: "paddle", x: p.x, y: p.y, id });
    }
    this.history.push(entry);
    this.player = t;
    this.moves++;
    this.anim = MOVE_FR;
    this.idle = 0;
    if (id >= 0) this.afterPush();
  }

  private afterPush() {
    const { goal } = this.lv;
    let solved = true;
    for (const c of this.crates) if (!goal[c]) solved = false;
    if (solved) return this.clear();
    const wasStuck = this.stuck;
    this.updateStuck();
    if (this.stuck && !wasStuck) {
      this.events.push({ t: "stuck", sfx: "extraBad", mood: "sad" });
    }
  }

  private updateStuck() {
    const { goal } = this.lv;
    const occ01 = new Uint8Array(this.occ.length);
    for (const c of this.crates) occ01[c] = 1;
    this.stuck = false;
    for (const c of this.crates) {
      if (goal[c]) continue;
      if (!this.live[c] || blockDeadlock(this.lv, occ01, c)) this.stuck = true;
    }
  }

  private undo() {
    const e = this.history.pop();
    if (!e || this.undos <= 0) {
      if (e) this.history.push(e);
      this.events.push({ t: "noUndo", sfx: "wall" });
      return;
    }
    this.undos--;
    this.settle();
    if (e.crate >= 0) {
      const now = this.crates[e.crate];
      this.occ[now] = 0;
      this.occ[e.crateFrom] = e.crate + 1;
      this.crates[e.crate] = e.crateFrom;
      this.pushes--;
    }
    this.player = e.player;
    this.facing = e.dir;
    this.moves--;
    this.anim = MOVE_FR;
    this.idle = 0;
    this.updateStuck();
    const p = this.xy(this.player);
    this.events.push({ t: "undo", sfx: "launch", x: p.x, y: p.y, left: this.undos });
  }

  private restart() {
    this.reset();
    this.score = Math.max(0, this.score - RESTART_COST);
    const p = this.xy(this.player);
    this.events.push({ t: "restart", sfx: "extraBad", mood: "sad", shake: 4, x: p.x, y: p.y, cost: RESTART_COST });
  }

  private clear() {
    const crates = this.crates.length;
    const base = 50 + 25 * crates + 10 * (this.level + 1);
    const eff = Math.round((200 * this.optimal) / Math.max(this.optimal, this.pushes));
    const time = Math.floor(this.timeLeft / 60) * 2;
    const gain = base + eff + time;
    this.score += gain;
    this.cleared++;
    this.phase = "clear";
    this.clearTimer = CLEAR_FR;
    const p = this.xy(this.player);
    this.events.push({
      t: "clear", sfx: "levelclear", mood: "happy", toast: "levelClear", x: p.x, y: p.y,
      gain, base, eff, time, perfect: this.pushes === this.optimal,
    });
  }

  view(): CratesView {
    return {
      frame: this.frame,
      phase: this.phase,
      level: this.level,
      name: this.name,
      generated: this.generated,
      w: this.lv.w,
      h: this.lv.h,
      map: this.mapStr,
      mapId: this.mapId,
      crates: this.crates.map((cell, id) => ({ id, cell, from: this.crateFrom[id], on: this.lv.goal[cell] === 1 })),
      player: this.player,
      playerFrom: this.playerFrom,
      facing: this.facing,
      t: this.anim > 0 ? 1 - this.anim / MOVE_FR : 1,
      idle: this.idle,
      moves: this.moves,
      pushes: this.pushes,
      optimal: this.optimal,
      undos: this.undos,
      timeLeft: this.timeLeft,
      timeLimit: this.timeLimit,
      restart: this.phase === "play" ? Math.min(1, this.fireHold / RESTART_FR) : 0,
      stuck: this.stuck,
      score: this.score,
      clearTimer: this.clearTimer,
      solution: this.solution,
      path: this.history.map((e) => e.dir),
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level + 1, label: this.name };
  }
  result(): GameResult {
    return {
      score: this.score,
      level: this.level,
      levelsCleared: this.cleared,
      frames: this.frame,
      status: this.phase === "won" ? "won" : this.phase === "over" ? "over" : "playing",
    };
  }
  get done() {
    return this.phase === "over" || this.phase === "won";
  }
}

export const crates: GameDef<CratesView> = {
  id: "crates",
  name: "Crate Push",
  tagline: "Shove coin crates onto wallet pads. Push only, never pull. Think first.",
  genre: "Box-pushing puzzle",
  session: "5–20 min",
  controls: "Arrows / WASD or swipe to walk and push. X / Shift or tap: undo a move (5 per level). Hold Space 1 s or double-tap: restart the level (-50 points).",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true, touchMap: { tap: BTN.ALT } },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the box-pushing puzzle genre. All levels are original (hand-made or made by our own generator); no published level sets were used. Solver, generator, art and sounds are our own.",
  },
  create: (seed) => new CratesEngine(seed),
  bot(v, frame) {
    // Follows the level's reference solution, slower on every level (so the
    // clock eventually wins), with the odd wrong step that it then undoes.
    const none = { x: 0, y: 0, b: 0 };
    if (v.phase !== "play") return none;
    let i = 0;
    while (i < v.path.length && i < v.solution.length && v.path[i] === v.solution[i]) i++;
    if (i < v.path.length) {
      if (v.undos <= 0) return { x: 0, y: 0, b: BTN.FIRE }; // hold to restart
      return frame & 1 || v.t < 1 ? none : { x: 0, y: 0, b: BTN.ALT };
    }
    if (frame & 1 || v.t < 1 || i >= v.solution.length) return none;
    if (v.idle < 6 + v.level * 10) return none;
    const want = v.solution[i];
    if (v.undos > 2 && (v.moves * 7 + v.level * 13 + v.undos * 5) % 23 === 5) {
      // A plain walk in another direction (never a bump or push).
      for (let k = 1; k < 4; k++) {
        const d = (want + k) & 3;
        const c = v.player % v.w + DX[d], r = Math.floor(v.player / v.w) + DY[d];
        const cell = r * v.w + c;
        const ch = v.map[cell];
        if ((ch === " " || ch === ".") && !v.crates.some((q) => q.cell === cell)) return { x: 0, y: 0, b: DIR_BTN[d] };
      }
    }
    return { x: 0, y: 0, b: DIR_BTN[want] };
  },
};
