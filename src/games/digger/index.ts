/*
 * Moon Digger: an original dig-and-dodge cave game for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original design and code (no ported source).
 *
 * The genre mechanic (dig through dirt on a grid, collect gems to open the
 * exit, boulders and gems fall and roll off rounded things, crushed enemies
 * explode) is used; everything else is our own: moon dust, moon rocks, coins
 * as the gems, the coin mascot as the digger, a patrolling bear and a ghost
 * that bursts into coins, random cave generation with a carved route to the
 * exit, scoring and the cave ladder.
 *
 * Rules: the cave is a 40x22 grid. The world updates in ticks (one cell per
 * tick). Rocks and coins fall into empty cells and roll off rocks, coins and
 * brick; a falling one that lands on the mascot costs a life. Rocks can be
 * pushed sideways into an empty cell (lean on them for two ticks). Collect
 * the required coins to open the exit, before the timer runs out. Touching a
 * bear or ghost costs a life; drop a rock on them instead. 3 lives, 8 caves.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const COLS = 40;
export const ROWS = 22;
export const N = COLS * ROWS;
export const CELL = 24;
export const FIELD_W = 360;
export const FIELD_H = 600;
/** Cave viewport on screen (renderer layout). */
export const VIEW_Y = 64;
export const VIEW_W = FIELD_W;
export const VIEW_H = ROWS * CELL; // 528: whole cave height fits, scrolls sideways

export const EMPTY = 0;
export const DUST = 1;
export const STEEL = 2;
export const BRICK = 3;
export const ROCK = 4;
export const COIN = 5;
export const EXIT = 6;
export const PLAYER = 7;
export const BEAR = 8;
export const GHOST = 9;
export const BOOM = 10;

export const CAVES = 8;
export const START_LIVES = 3;
export const INTRO_T = 80;
export const DEAD_T = 100;
export const CLEAR_T = 150;
const BOOM_STAGES = 3;
const PUSH_TICKS = 2;
/** Presses shorter than this are swipe pulses: the digger glides until blocked. */
const TAP_FRAMES = 5;

export const SCORE = { coin: 10, extraCoin: 25, bear: 100, ghost: 150, cave: 250, perSecond: 5 };

export const DIRS = [
  { b: BTN.UP, dx: 0, dy: -1 },
  { b: BTN.RIGHT, dx: 1, dy: 0 },
  { b: BTN.DOWN, dx: 0, dy: 1 },
  { b: BTN.LEFT, dx: -1, dy: 0 },
];
const DELTA = [-COLS, 1, COLS, -1];

const isRounded = (g: number) => g === ROCK || g === COIN || g === BRICK;
const isHeavy = (g: number) => g === ROCK || g === COIN;
const isEnemy = (g: number) => g === BEAR || g === GHOST;

export interface CaveSpec {
  need: number;
  seconds: number;
  period: number; // frames per tick
  bears: number;
  ghosts: number;
  rockP: number; // per mille
  coinP: number; // per mille
  bricks: number;
}

export function caveSpec(level: number): CaveSpec {
  return {
    need: Math.min(26, 10 + 2 * level),
    seconds: Math.max(90, 150 - 8 * level),
    period: Math.max(7, 9 - Math.floor(level / 3)),
    bears: Math.min(4, 1 + Math.floor(level / 2)),
    ghosts: level === 0 ? 0 : Math.min(3, 1 + Math.floor((level - 1) / 2)),
    rockP: Math.min(220, 120 + 15 * level),
    coinP: 70,
    bricks: 4 + level,
  };
}

export interface Cave {
  grid: Uint8Array;
  dirs: Uint8Array;
  start: number;
  exit: number;
}

/** Cells the digger can walk/dig through when planning (rocks and brick block). */
const passable = (g: number) => g === DUST || g === EMPTY || g === COIN;

/** BFS over diggable cells from `from`; returns the visited mask. */
export function reach(grid: ArrayLike<number>, from: number, extra = -1): Uint8Array {
  const seen = new Uint8Array(N);
  const q = [from];
  seen[from] = 1;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let d = 0; d < 4; d++) {
      const j = i + DELTA[d];
      if (seen[j]) continue;
      if (!passable(grid[j]) && j !== extra) continue;
      seen[j] = 1;
      if (j !== extra) q.push(j);
    }
  }
  return seen;
}

/** Generate a cave from its own seed. Same seed, same cave. */
export function generateCave(seed: number, level: number): Cave {
  const rng = new Rng(seed);
  const spec = caveSpec(level);
  const grid = new Uint8Array(N);
  const dirs = new Uint8Array(N);
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const i = r * COLS + c;
      if (r === 0 || c === 0 || r === ROWS - 1 || c === COLS - 1) { grid[i] = STEEL; continue; }
      const k = rng.int(1000);
      grid[i] = k < spec.rockP ? ROCK : k < spec.rockP + spec.coinP ? COIN : DUST;
    }
  }
  // Brick runs, horizontal and vertical.
  for (let b = 0; b < spec.bricks; b++) {
    const horiz = rng.int(3) !== 0;
    const len = horiz ? rng.range(4, 9) : rng.range(3, 6);
    const c0 = rng.range(2, COLS - 3 - (horiz ? len : 0));
    const r0 = rng.range(2, ROWS - 3 - (horiz ? 0 : len));
    for (let k = 0; k < len; k++) grid[(r0 + (horiz ? 0 : k)) * COLS + c0 + (horiz ? k : 0)] = BRICK;
  }
  // Start on the left, exit on the right.
  const sc = rng.range(2, 4);
  const sr = rng.range(3, ROWS - 4);
  const ec = rng.range(COLS - 6, COLS - 3);
  const er = rng.range(2, ROWS - 3);
  for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) grid[(sr + dr) * COLS + sc + dc] = DUST;
  // Nothing heavy right above the start box.
  for (let dc = -1; dc <= 1; dc++) if (isHeavy(grid[(sr - 2) * COLS + sc + dc])) grid[(sr - 2) * COLS + sc + dc] = DUST;
  const start = sr * COLS + sc;
  const exit = er * COLS + ec;
  // Carve a guaranteed route: a wobbly walk from start to exit through dust.
  let c = sc, r = sr;
  while (c !== ec || r !== er) {
    const dx = Math.sign(ec - c), dy = Math.sign(er - r);
    if (dx !== 0 && (dy === 0 || rng.int(3) !== 0)) c += dx;
    else r += dy;
    const i = r * COLS + c;
    if (grid[i] === ROCK || grid[i] === BRICK) grid[i] = DUST;
  }
  // Enemy pockets: short empty runs far from the start, ceilings made safe.
  const pockets: number[] = [];
  const want = spec.bears + spec.ghosts;
  for (let tries = 0; pockets.length < want && tries < 400; tries++) {
    const len = rng.range(4, 6);
    const pc = rng.range(2, COLS - 3 - len);
    const pr = rng.range(2, ROWS - 3);
    if (Math.abs(pc - sc) + Math.abs(pr - sr) < 12) continue;
    let ok = true;
    for (let k = -1; k <= len && ok; k++) {
      for (let dr = -1; dr <= 1; dr++) {
        const i = (pr + dr) * COLS + pc + k;
        if (i === exit || grid[i] === EMPTY || isEnemy(grid[i])) { ok = false; break; }
      }
    }
    if (!ok) continue;
    for (let k = 0; k < len; k++) {
      const i = pr * COLS + pc + k;
      grid[i] = EMPTY;
      const up = i - COLS;
      if (isHeavy(grid[up])) grid[up] = DUST;
    }
    const isGhost = pockets.length >= spec.bears;
    const at = pr * COLS + pc + (isGhost ? len - 1 : 0);
    grid[at] = isGhost ? GHOST : BEAR;
    dirs[at] = isGhost ? 3 : 1;
    pockets.push(at);
  }
  grid[start] = PLAYER;
  grid[exit] = EXIT;
  // Enough reachable coins for the quota plus a margin.
  const seen = reach(grid, start);
  let coins = 0;
  const spots: number[] = [];
  for (let i = 0; i < N; i++) {
    if (!seen[i]) continue;
    if (grid[i] === COIN) coins++;
    else if (grid[i] === DUST && grid[i - COLS] !== EMPTY && Math.abs(i - start) > 2) spots.push(i);
  }
  while (coins < spec.need + 6 && spots.length) {
    const k = rng.int(spots.length);
    grid[spots[k]] = COIN;
    spots[k] = spots[spots.length - 1];
    spots.pop();
    coins++;
  }
  return { grid, dirs, start, exit };
}

export type Phase = "intro" | "play" | "dead" | "clear" | "over" | "won";

export interface DiggerView {
  frame: number;
  tick: number;
  phase: Phase;
  phaseT: number;
  level: number; // 0-based cave index
  grid: Uint8Array;
  /** Per cell: where the object now in it came from this tick (-1 = didn't move). */
  from: Int16Array;
  falling: Uint8Array;
  dirs: Uint8Array;
  boomT: Uint8Array;
  /** 0..1 progress through the current tick, for smooth interpolation. */
  t: number;
  player: number;
  face: number;
  pushing: boolean;
  exit: number;
  exitOpen: boolean;
  coins: number;
  need: number;
  timeLeft: number; // frames
  lives: number;
  score: number;
  bonus: number;
  ticker: string;
}

export class DiggerEngine implements GameEngine<DiggerView> {
  private rng: Rng;
  private ticker: string;
  grid = new Uint8Array(N);
  dirs = new Uint8Array(N);
  falling = new Uint8Array(N);
  boomT = new Uint8Array(N);
  boomTo = new Uint8Array(N);
  moved = new Uint8Array(N);
  from = new Int16Array(N).fill(-1);
  player = 0;
  exit = 0;
  exitOpen = false;
  face = 1;
  pushT = 0;
  coins = 0;
  need = 0;
  period = 9;
  counter = 0;
  tick = 0;
  timeLeft = 0;
  level = 0;
  lives = START_LIVES;
  score = 0;
  bonus = 0;
  levelsCleared = 0;
  phase: Phase = "intro";
  phaseT = 0;
  alive = true;
  private caveSeed = 0;
  // input state
  private prevB = 0;
  private holdDir = -1;
  private holdLen = 0;
  private latch = -1;
  private glide = -1;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, ticker = "X") {
    this.rng = new Rng(seed);
    this.ticker = ticker || "X";
    this.startCave(true);
  }

  private startCave(fresh: boolean) {
    if (fresh) this.caveSeed = this.rng.next();
    const cave = generateCave(this.caveSeed, this.level);
    const spec = caveSpec(this.level);
    this.grid.set(cave.grid);
    this.dirs.set(cave.dirs);
    this.falling.fill(0);
    this.boomT.fill(0);
    this.boomTo.fill(0);
    this.from.fill(-1);
    this.player = cave.start;
    this.exit = cave.exit;
    this.exitOpen = false;
    this.coins = 0;
    this.need = spec.need;
    this.period = spec.period;
    this.timeLeft = spec.seconds * 60;
    this.counter = 0;
    this.pushT = 0;
    this.face = 1;
    this.alive = true;
    this.bonus = 0;
    this.phase = "intro";
    this.phaseT = 0;
    this.glide = -1;
    this.latch = -1;
  }

  /** Test helper: load a small hand-made cave (rest is steel). */
  loadMap(rows: string[], period = 9) {
    const key: Record<string, number> = { "#": STEEL, "=": BRICK, ".": DUST, " ": EMPTY, o: ROCK, $: COIN, E: EXIT, P: PLAYER, B: BEAR, G: GHOST };
    this.grid.fill(STEEL);
    this.dirs.fill(0);
    this.falling.fill(0);
    this.boomT.fill(0);
    this.from.fill(-1);
    for (let r = 0; r < rows.length; r++) {
      for (let c = 0; c < rows[r].length; c++) {
        const g = key[rows[r][c]] ?? STEEL;
        const i = r * COLS + c;
        this.grid[i] = g;
        if (g === PLAYER) this.player = i;
        if (g === EXIT) this.exit = i;
        if (g === BEAR) this.dirs[i] = 1;
        if (g === GHOST) this.dirs[i] = 3;
      }
    }
    this.period = period;
    this.counter = 0;
    this.phase = "play";
    this.phaseT = 0;
    this.alive = true;
    this.exitOpen = false;
    this.coins = 0;
  }

  private ev(e: GameEvent) {
    this.events.push(e);
  }
  private at(i: number) {
    return { x: ((i % COLS) + 0.5) * CELL, y: (Math.floor(i / COLS) + 0.5) * CELL };
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    this.readInput(inp);
    this.phaseT++;
    switch (this.phase) {
      case "intro":
        if (this.phaseT >= INTRO_T) { this.phase = "play"; this.phaseT = 0; this.counter = 0; }
        return;
      case "play":
        if (this.timeLeft > 0) {
          this.timeLeft--;
          if (this.timeLeft === 0) {
            this.ev({ t: "timeup", sfx: "extraBad" });
            this.explode(this.player, false);
          } else if (this.timeLeft <= 10 * 60 && this.timeLeft % 60 === 0) this.ev({ t: "tock", sfx: "wall" });
        }
        if (++this.counter >= this.period) {
          this.counter = 0;
          this.doTick();
        }
        if (!this.alive && this.phase === "play") this.die();
        return;
      case "dead":
        if (++this.counter >= this.period) { this.counter = 0; this.doTick(); }
        if (this.phaseT >= DEAD_T) {
          if (this.lives <= 0) {
            this.phase = "over";
            this.phaseT = 0;
            this.ev({ t: "gameover", sfx: "gameover", mood: "sad" });
          } else this.startCave(false);
        }
        return;
      case "clear":
        if (this.phaseT >= CLEAR_T) {
          this.level++;
          if (this.level >= CAVES) {
            this.level = CAVES - 1;
            this.phase = "won";
            this.phaseT = 0;
            this.ev({ t: "won", sfx: "won", mood: "happy" });
          } else this.startCave(true);
        }
        return;
      default:
        return;
    }
  }

  private readInput(inp: Input) {
    const b = inp.b;
    const pressed = b & ~this.prevB;
    this.prevB = b;
    for (let d = 0; d < 4; d++) {
      if (pressed & DIRS[d].b) {
        this.holdDir = d;
        this.holdLen = 0;
        this.latch = d;
        this.glide = -1;
      }
    }
    if (this.holdDir >= 0 && !(b & DIRS[this.holdDir].b)) {
      if (this.holdLen < TAP_FRAMES) this.glide = this.holdDir;
      else this.glide = -1;
      this.holdDir = -1;
      for (let d = 0; d < 4; d++) if (b & DIRS[d].b) { this.holdDir = d; this.holdLen = TAP_FRAMES; }
    }
    if (this.holdDir >= 0) this.holdLen++;
    if (pressed & BTN.FIRE) { this.glide = -1; this.latch = -1; }
  }

  private die() {
    this.lives--;
    this.phase = "dead";
    this.phaseT = 0;
    this.glide = -1;
    this.ev({ t: "die", sfx: "lost", mood: "sad", toast: "lifeLost", shake: 10, ...this.at(this.player) });
  }

  private moveObj(a: number, b: number) {
    this.grid[b] = this.grid[a];
    this.dirs[b] = this.dirs[a];
    this.falling[b] = this.falling[a];
    this.grid[a] = EMPTY;
    this.falling[a] = 0;
    this.from[b] = this.from[a] >= 0 ? this.from[a] : a;
    this.from[a] = -1;
    this.moved[b] = 1;
  }

  /** One world update: the digger first, then the cave bottom-up. */
  doTick() {
    this.tick++;
    this.moved.fill(0);
    this.from.fill(-1);
    if (this.phase === "play" && this.alive) this.movePlayer();
    let landed = false;
    const g = this.grid;
    for (let r = ROWS - 2; r >= 1; r--) {
      for (let c = 1; c < COLS - 1; c++) {
        const i = r * COLS + c;
        if (this.moved[i]) continue;
        const cell = g[i];
        if (cell === ROCK || cell === COIN) {
          const below = i + COLS;
          const gb = g[below];
          if (gb === EMPTY) {
            this.falling[i] = 1;
            this.moveObj(i, below);
          } else if (this.falling[i] && (gb === PLAYER || isEnemy(gb))) {
            this.crush(below);
          } else if (isRounded(gb) && g[i - 1] === EMPTY && g[below - 1] === EMPTY) {
            this.falling[i] = 1;
            this.moveObj(i, i - 1);
          } else if (isRounded(gb) && g[i + 1] === EMPTY && g[below + 1] === EMPTY) {
            this.falling[i] = 1;
            this.moveObj(i, i + 1);
          } else {
            if (this.falling[i]) {
              landed = true;
              if (cell === COIN) this.ev({ t: "clink", ...this.at(i) });
              else this.ev({ t: "thud", ...this.at(i) });
            }
            this.falling[i] = 0;
          }
        } else if (cell === BEAR || cell === GHOST) {
          this.moveEnemy(i, cell);
        } else if (cell === BOOM) {
          if (++this.boomT[i] >= BOOM_STAGES) {
            g[i] = this.boomTo[i];
            this.boomT[i] = 0;
            this.falling[i] = 0;
          }
        }
      }
    }
    if (landed) this.ev({ t: "land", sfx: "wall", shake: 2 });
  }

  private crush(i: number) {
    const victim = this.grid[i];
    if (victim === PLAYER) {
      this.explode(i, false);
    } else if (victim === BEAR) {
      this.score += SCORE.bear;
      this.ev({ t: "crush", kind: "bear", points: SCORE.bear, sfx: "explode", mood: "happy", ...this.at(i) });
      this.explode(i, false);
    } else if (victim === GHOST) {
      this.score += SCORE.ghost;
      this.ev({ t: "crush", kind: "ghost", points: SCORE.ghost, sfx: "explode", mood: "happy", ...this.at(i) });
      this.explode(i, true);
    }
  }

  /** 3x3 blast (steel and the exit survive). Coins: a ghost's treasure. */
  explode(center: number, toCoin: boolean) {
    this.ev({ t: "boom", coins: toCoin, sfx: "explode", shake: 7, ...this.at(center) });
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const i = center + dr * COLS + dc;
        const g = this.grid[i];
        if (g === STEEL || g === EXIT) continue;
        if (g === PLAYER) this.alive = false;
        this.grid[i] = BOOM;
        this.boomT[i] = 0;
        this.boomTo[i] = toCoin ? COIN : EMPTY;
        this.falling[i] = 0;
        this.moved[i] = 1;
        this.from[i] = -1;
      }
    }
  }

  private moveEnemy(i: number, kind: number) {
    for (let d = 0; d < 4; d++) {
      if (this.grid[i + DELTA[d]] === PLAYER && this.alive) {
        this.explode(i, kind === GHOST);
        return;
      }
    }
    const d = this.dirs[i];
    // Bear hugs walls on its left, the ghost on its right.
    const turn = kind === BEAR ? (d + 3) & 3 : (d + 1) & 3;
    if (this.grid[i + DELTA[turn]] === EMPTY) {
      this.dirs[i] = turn;
      this.moveObj(i, i + DELTA[turn]);
    } else if (this.grid[i + DELTA[d]] === EMPTY) {
      this.moveObj(i, i + DELTA[d]);
    } else {
      this.dirs[i] = kind === BEAR ? (d + 1) & 3 : (d + 3) & 3;
    }
  }

  private wantedDir(): number {
    if (this.holdDir >= 0) return this.holdDir;
    if (this.latch >= 0) return this.latch;
    return this.glide;
  }

  private movePlayer() {
    const d = this.wantedDir();
    this.latch = -1;
    if (d < 0) { this.pushT = 0; return; }
    this.face = d;
    const i = this.player;
    const t = i + DELTA[d];
    const g = this.grid[t];
    if (g === EMPTY || g === DUST || g === COIN || (g === EXIT && this.exitOpen)) {
      this.pushT = 0;
      if (g === DUST) this.ev({ t: "dig", ...this.at(t) });
      if (g === COIN) this.collect(t);
      this.moveObj(i, t);
      this.player = t;
      if (g === EXIT) this.clearCave();
      return;
    }
    if (g === ROCK && (d === 1 || d === 3) && !this.falling[t] && this.grid[t + DELTA[d]] === EMPTY) {
      if (++this.pushT >= PUSH_TICKS) {
        this.pushT = 0;
        this.moveObj(t, t + DELTA[d]);
        this.moveObj(i, t);
        this.player = t;
        this.ev({ t: "push", sfx: "paddle", ...this.at(t + DELTA[d]) });
      }
      return;
    }
    this.pushT = 0;
    if (isEnemy(g)) {
      this.explode(t, g === GHOST);
      return;
    }
    if (this.glide >= 0 && this.holdDir < 0) this.glide = -1;
  }

  private collect(i: number) {
    this.coins++;
    const extra = this.coins > this.need;
    const pts = extra ? SCORE.extraCoin : SCORE.coin;
    this.score += pts;
    this.ev({ t: "coin", points: pts, sfx: "brickgone", ...this.at(i) });
    if (this.coins === this.need && !this.exitOpen) {
      this.exitOpen = true;
      this.ev({ t: "open", sfx: "extraGood", mood: "happy", shake: 3, ...this.at(this.exit) });
    }
  }

  private clearCave() {
    const secs = Math.ceil(this.timeLeft / 60);
    this.bonus = SCORE.cave + secs * SCORE.perSecond;
    this.score += this.bonus;
    this.levelsCleared++;
    this.phase = "clear";
    this.phaseT = 0;
    this.ev({ t: "clear", bonus: this.bonus, sfx: "levelclear", mood: "happy", toast: "levelClear", ...this.at(this.exit) });
  }

  view(): DiggerView {
    return {
      frame: this.frame,
      tick: this.tick,
      phase: this.phase,
      phaseT: this.phaseT,
      level: this.level,
      grid: this.grid,
      from: this.from,
      falling: this.falling,
      dirs: this.dirs,
      boomT: this.boomT,
      t: this.counter / this.period,
      player: this.player,
      face: this.face,
      pushing: this.pushT > 0,
      exit: this.exit,
      exitOpen: this.exitOpen,
      coins: this.coins,
      need: this.need,
      timeLeft: this.timeLeft,
      lives: Math.max(0, this.lives),
      score: this.score,
      bonus: this.bonus,
      ticker: this.ticker,
    };
  }
  hud(): Hud {
    return { score: this.score, lives: Math.max(0, this.lives), level: this.level + 1, label: `${Math.min(this.coins, this.need)}/${this.need} coins` };
  }
  result(): GameResult {
    return {
      score: this.score,
      level: this.level,
      levelsCleared: this.levelsCleared,
      frames: this.frame,
      status: this.phase === "won" ? "won" : this.phase === "over" ? "over" : "playing",
    };
  }
  get done() {
    return this.phase === "over" || this.phase === "won";
  }
}

// ---------------------------------------------------------------------------
// Autoplayer: BFS to the nearest coin (or the open exit), dodging falling
// rocks and enemies. Decisions only change on ticks, so holds stay long.

function unsafe(v: DiggerView, i: number): boolean {
  const g = v.grid;
  const up = i - COLS;
  if (isHeavy(g[up])) {
    if (v.falling[up] || g[i] === EMPTY) return true;
  } else if (g[up] === EMPTY) {
    for (let j = up; j > COLS; j -= COLS) {
      if (g[j] === EMPTY) continue;
      if (isHeavy(g[j])) return true;
      break;
    }
  }
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      if (Math.abs(dr) + Math.abs(dc) > 2) continue;
      const j = i + dr * COLS + dc;
      if (j >= 0 && j < N && (isEnemy(g[j]) || g[j] === BOOM)) return true;
    }
  }
  return false;
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function bfsDir(v: DiggerView, careful: boolean): number {
  const g = v.grid;
  const p = v.player;
  const goalExit = v.exitOpen;
  const prev = new Int16Array(N).fill(-1);
  const firstDir = new Int8Array(N).fill(-1);
  const q: number[] = [p];
  prev[p] = p;
  for (let h = 0; h < q.length; h++) {
    const i = q[h];
    for (let d = 0; d < 4; d++) {
      const j = i + DELTA[d];
      if (prev[j] >= 0) continue;
      const gj = g[j];
      const ok = passable(gj) || (gj === EXIT && v.exitOpen);
      if (!ok) continue;
      if (careful && i === p && d === 2 && isHeavy(g[p - COLS])) continue;
      if (careful && unsafe(v, j)) continue;
      prev[j] = i;
      firstDir[j] = i === p ? d : firstDir[i];
      if ((goalExit && gj === EXIT) || (!goalExit && gj === COIN)) return firstDir[j];
      q.push(j);
    }
  }
  return -1;
}

export function botDir(v: DiggerView): number {
  const g = v.grid;
  const p = v.player;
  let found = bfsDir(v, true);
  // Nothing safe: every few seconds, take a gamble (imperfect on purpose).
  if (found < 0 && (v.tick >> 4) % 3 === 0) found = bfsDir(v, false);
  const r = hash(v.tick * 7919 + p);
  if (found >= 0 && r % 29 !== 0) return found;
  // Stuck: try a push, else wander somewhere safe-ish.
  for (const d of [1, 3]) {
    const t = p + DELTA[d];
    if (g[t] === ROCK && g[t + DELTA[d]] === EMPTY && !v.falling[t]) return d;
  }
  const d0 = r % 4;
  for (let k = 0; k < 4; k++) {
    const d = (d0 + k) & 3;
    const t = p + DELTA[d];
    if ((g[t] === DUST || g[t] === EMPTY || g[t] === COIN) && !unsafe(v, t) && !(d === 2 && isHeavy(g[p - COLS]))) return d;
  }
  return -1;
}

export const digger: GameDef<DiggerView> = {
  id: "digger",
  name: "Moon Digger",
  tagline: "Dig moon dust, grab the coins, don't get flattened by falling moon rocks.",
  genre: "Dig and dodge",
  session: "3–10 min",
  controls: "Arrows / WASD to dig (hold to keep going) or swipe to glide; tap to stop.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true },
  maxFrames: 30 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the dig-and-dodge cave genre: own cellular rules, cave generator, enemies, scoring and art. No code, levels or assets from any existing game.",
  },
  create: (seed, ctx) => new DiggerEngine(seed, ctx.ticker),
  bot(v) {
    if (v.phase !== "play") return { x: 0, y: 0, b: 0 };
    const d = botDir(v);
    return { x: 0, y: 0, b: d >= 0 ? DIRS[d].b : 0 };
  },
};
