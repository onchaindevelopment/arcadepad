/*
 * Maze Dash: an original maze-chase game for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original design and code (no ported source).
 *
 * The genre mechanic (collect everything in a maze while enemies chase you,
 * a power item turns the tables) is used; layouts, enemy designs, AI, sounds
 * and look are our own: landscape 28x20 mazes, enemies roll out of four
 * corner vents (no central pen), each bot has its own simple brain
 * (chaser, ambusher, wanderer, patroller), eaten bots reboot in their vent.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const COLS = 28;
export const ROWS = 20;
export const TILE = 20;
/** Sub-steps per tile for movement (positions are integers). */
export const SUB = 120;

export const DIRS = [
  { b: BTN.UP, dx: 0, dy: -1 },
  { b: BTN.RIGHT, dx: 1, dy: 0 },
  { b: BTN.DOWN, dx: 0, dy: 1 },
  { b: BTN.LEFT, dx: -1, dy: 0 },
];

/*
 * Mazes are drawn as the left half (14 columns) and mirrored. '#' wall,
 * '.' coin, 'o' power coin, 'V' enemy vent (no coin). A row starting with
 * '.' is a wrap-around tunnel (edge cells hold no coins).
 */
interface MazeDef {
  name: string;
  half: string[];
  start: [number, number];
}

const MAZE_DEFS: MazeDef[] = [
  {
    name: "Order Book",
    start: [13, 10],
    half: [
      "##############",
      "#V............",
      "#.##.###.###.#",
      "#.##.###.###.#",
      "#o............",
      "#.######.###.#",
      "#.######.###.#",
      "#.............",
      "####.#######.#",
      "####.#######.#",
      "..............",
      "#.##.###.#####",
      "#.##.###.#####",
      "#.............",
      "#.######.###.#",
      "#.######.###.#",
      "#o............",
      "#.##.###.###.#",
      "#V............",
      "##############",
    ],
  },
  {
    name: "Candle Alley",
    start: [13, 9],
    half: [
      "##############",
      "#V............",
      "#.##.#.##.##.#",
      "#.##.#.##.##.#",
      "#.##...##.##.#",
      "#o##.#.##....#",
      "#.##.#.##.##.#",
      "#....#....##.#",
      "#.##.#.##.##.#",
      "..##.#.##.....",
      "#.##.#.##.##.#",
      "#.##.....o##.#",
      "#.##.#.##.##.#",
      "#....#.##.##.#",
      "#.##.#.##.##.#",
      "#.##.#....##.#",
      "#.##.#.##.##.#",
      "#.##.#.##.##.#",
      "#V............",
      "##############",
    ],
  },
  {
    name: "The Vault",
    start: [13, 10],
    half: [
      "##############",
      "#V............",
      "#.######.#####",
      "#.#...........",
      "#.#.#######.##",
      "#.#.#o........",
      "#.#.#.###.####",
      "#.#.#.#.......",
      "#.#.#.#.######",
      "#o..#.#.######",
      "#.#.#.........",
      "#.#...#.######",
      "#.#.#.#.......",
      "#.#.#.####.###",
      "#.#.#.........",
      "#.#.#####.####",
      "#.#...........",
      "#.####.#######",
      "#V............",
      "##############",
    ],
  },
  {
    name: "Pump Chart",
    start: [13, 10],
    half: [
      "##############",
      "#V............",
      "#.#.#####.##.#",
      "#.#..####..#.#",
      "#.##..####...#",
      "#.###..#####.#",
      "#.####..####.#",
      "#.#####..###.#",
      "#..o####..##.#",
      "#.#.#####.##.#",
      "..............",
      "#.####.#####.#",
      "#.####..####.#",
      "#.#####..###.#",
      "#..o####..##.#",
      "#.#..####..#.#",
      "#.##..####...#",
      "#.###.######.#",
      "#V............",
      "##############",
    ],
  },
];

export interface Maze {
  name: string;
  /** ROWS strings of COLS chars. */
  grid: string[];
  start: [number, number];
  /** Four vents: top-left, top-right, bottom-left, bottom-right. */
  vents: [number, number][];
}

export const MAZES: Maze[] = MAZE_DEFS.map((d) => {
  const grid = d.half.map((row) => row + [...row].reverse().join(""));
  const vents: [number, number][] = [];
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) if (grid[r][c] === "V") vents.push([c, r]);
  return { name: d.name, grid, start: d.start, vents };
});

export function wrapC(c: number) {
  return ((c % COLS) + COLS) % COLS;
}
export function isOpen(grid: readonly string[], c: number, r: number) {
  if (r < 0 || r >= ROWS) return false;
  return grid[r][wrapC(c)] !== "#";
}

/** Points for the n-th bot eaten during one power coin (0-based). */
export function enemyPoints(n: number) {
  return 200 << Math.min(3, n);
}

export const ENEMY_NAMES = ["FUD bot", "Bear bot", "Rug bot", "Dump bot"];
/** 0 chaser, 1 ambusher, 2 wanderer, 3 patrol. */
export type EnemyKind = 0 | 1 | 2 | 3;
export type EnemyState = "vent" | "active" | "dead";
export type Phase = "ready" | "play" | "dying" | "clear" | "over";

interface Mover {
  c: number;
  r: number;
  dir: number; // -1 = never moved
  p: number; // 0..SUB-1 progress from (c,r) towards (c,r)+dir
}

interface Enemy {
  m: Mover;
  kind: EnemyKind;
  state: EnemyState;
  timer: number; // vent release / respawn countdown
  fright: boolean;
  patrol: number;
  vent: [number, number];
}

export interface ActorView {
  /** Field pixel centre (smooth). */
  x: number;
  y: number;
  c: number;
  r: number;
  dir: number;
  p: number;
}
export interface EnemyView extends ActorView {
  kind: EnemyKind;
  state: EnemyState;
  fright: boolean;
  /** Frames until it leaves the vent / reboots. */
  timer: number;
  vent: [number, number];
}

export interface MazeView {
  frame: number;
  level: number; // 0-based
  mazeIndex: number;
  mazeName: string;
  grid: readonly string[];
  /** COLS*ROWS: 0 empty, 1 coin, 2 power coin. Do not mutate. */
  pellets: Uint8Array;
  pelletsLeft: number;
  player: ActorView & { moving: boolean; face: number };
  enemies: EnemyView[];
  frightLeft: number;
  frightTotal: number;
  bonus: { c: number; r: number; left: number } | null;
  lives: number;
  score: number;
  phase: Phase;
  phaseT: number;
  ticker: string;
}

const START_LIVES = 3;
const READY_FIRST = 90;
const READY_AGAIN = 60;
const DYING_FRAMES = 90;
const CLEAR_FRAMES = 120;
const RESPAWN_FRAMES = 150;
const BONUS_FRAMES = 540;

function posX(m: Mover) {
  return m.c * SUB + (m.dir >= 0 ? DIRS[m.dir].dx * m.p : 0);
}
function posY(m: Mover) {
  return m.r * SUB + (m.dir >= 0 ? DIRS[m.dir].dy * m.p : 0);
}

class MazeEngine implements GameEngine<MazeView> {
  private rng: Rng;
  private ticker: string;
  private level = 0;
  private maze: Maze = MAZES[0];
  private pellets = new Uint8Array(COLS * ROWS);
  private pelletsLeft = 0;
  private pelletsTotal = 0;
  private player: Mover = { c: 0, r: 0, dir: -1, p: 0 };
  private want = -1;
  private face = 3;
  private moving = false;
  private enemies: Enemy[] = [];
  private frightLeft = 0;
  private frightTotal = 0;
  private combo = 0;
  private bonusLeft = 0;
  private lives = START_LIVES;
  private score = 0;
  private levelsCleared = 0;
  private phase: Phase = "ready";
  private phaseT = READY_FIRST;
  private prevB = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, ticker: string) {
    this.rng = new Rng(seed);
    this.ticker = ticker || "X";
    this.loadLevel();
  }

  // ---- level setup ----
  private loadLevel() {
    this.maze = MAZES[this.level % MAZES.length];
    const g = this.maze.grid;
    this.pelletsLeft = 0;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const ch = g[r][c];
        const edge = c === 0 || c === COLS - 1;
        const v = ch === "." && !edge ? 1 : ch === "o" ? 2 : 0;
        this.pellets[r * COLS + c] = v;
        if (v) this.pelletsLeft++;
      }
    const [sc, sr] = this.maze.start;
    if (this.pellets[sr * COLS + sc]) {
      this.pellets[sr * COLS + sc] = 0;
      this.pelletsLeft--;
    }
    this.pelletsTotal = this.pelletsLeft;
    this.resetActors();
  }

  private resetActors() {
    const [sc, sr] = this.maze.start;
    this.player = { c: sc, r: sr, dir: -1, p: 0 };
    this.want = -1;
    this.face = 3;
    this.moving = false;
    const delays = [20, 160, 320, 480];
    this.enemies = this.maze.vents.map((v, i) => ({
      m: { c: v[0], r: v[1], dir: -1, p: 0 },
      kind: i as EnemyKind,
      state: "vent" as EnemyState,
      timer: Math.max(0, delays[i] - this.level * 30),
      fright: false,
      patrol: (i + 1) & 3,
      vent: v,
    }));
    this.frightLeft = 0;
    this.combo = 0;
    this.bonusLeft = 0;
  }

  // ---- tuning ----
  private playerSpeed() {
    return Math.min(16, 12 + this.level);
  }
  private enemySpeed() {
    return Math.min(15, 10 + this.level);
  }
  private frightSpeed() {
    return Math.min(8, 6 + Math.floor(this.level / 3));
  }
  private frightDuration() {
    return Math.max(120, 420 - this.level * 40);
  }

  // ---- movement ----
  private open(c: number, r: number) {
    return isOpen(this.maze.grid, c, r);
  }
  private canGo(m: Mover, d: number) {
    return this.open(m.c + DIRS[d].dx, m.r + DIRS[d].dy);
  }
  private reverse(m: Mover) {
    if (m.dir < 0) return;
    if (m.p > 0) {
      m.c = wrapC(m.c + DIRS[m.dir].dx);
      m.r += DIRS[m.dir].dy;
      m.p = SUB - m.p;
    }
    m.dir = (m.dir + 2) & 3;
  }
  /** Move up to `speed` sub-steps; `choose` picks the direction at each tile centre (-1 stops). */
  private advance(m: Mover, speed: number, choose: (m: Mover) => number, arrive?: (m: Mover) => void): boolean {
    let rem = speed;
    while (rem > 0) {
      if (m.p === 0) {
        const d = choose(m);
        if (d < 0) return false;
        m.dir = d;
      }
      const s = Math.min(rem, SUB - m.p);
      m.p += s;
      rem -= s;
      if (m.p === SUB) {
        m.c = wrapC(m.c + DIRS[m.dir].dx);
        m.r += DIRS[m.dir].dy;
        m.p = 0;
        if (arrive) arrive(m);
        if (this.phase !== "play") return true;
      }
    }
    return true;
  }

  private choosePlayer = (m: Mover): number => {
    if (this.want >= 0 && this.canGo(m, this.want)) return this.want;
    if (m.dir >= 0 && this.canGo(m, m.dir)) return m.dir;
    return -1;
  };

  private arrivePlayer = (m: Mover) => {
    const i = m.r * COLS + m.c;
    const x = (m.c + 0.5) * TILE;
    const y = (m.r + 0.5) * TILE;
    const v = this.pellets[i];
    if (v) {
      this.pellets[i] = 0;
      this.pelletsLeft--;
      if (v === 1) {
        this.score += 10;
        this.events.push({ t: "pellet", sfx: "brick", x, y });
      } else {
        this.score += 50;
        this.power();
        this.events.push({ t: "power", sfx: "extraGood", mood: "happy", x, y, points: 50 });
      }
      const eaten = this.pelletsTotal - this.pelletsLeft;
      if (eaten === Math.floor(this.pelletsTotal * 0.35) || eaten === Math.floor(this.pelletsTotal * 0.7)) {
        this.bonusLeft = BONUS_FRAMES;
        const [bc, br] = this.maze.start;
        this.events.push({ t: "bonusSpawn", x: (bc + 0.5) * TILE, y: (br + 0.5) * TILE });
      }
    }
    if (this.bonusLeft > 0 && m.c === this.maze.start[0] && m.r === this.maze.start[1]) {
      this.bonusLeft = 0;
      this.score += 500;
      this.events.push({ t: "bonus", sfx: "extraGood", mood: "happy", x, y, points: 500 });
    }
    if (this.pelletsLeft === 0) this.levelClear();
  };

  private power() {
    this.frightLeft = this.frightTotal = this.frightDuration();
    this.combo = 0;
    for (const e of this.enemies) {
      if (e.state !== "active") continue;
      e.fright = true;
      this.reverse(e.m);
    }
  }

  private enemyTarget(e: Enemy): [number, number] {
    const pl = this.player;
    const pd = pl.dir >= 0 ? pl.dir : this.face;
    const near = Math.abs(e.m.c - pl.c) + Math.abs(e.m.r - pl.r);
    switch (e.kind) {
      case 1:
        return [pl.c + DIRS[pd].dx * 4, pl.r + DIRS[pd].dy * 4];
      case 3: {
        if (near <= 6) return [pl.c, pl.r];
        const corners: [number, number][] = [[1, 1], [COLS - 2, 1], [COLS - 2, ROWS - 2], [1, ROWS - 2]];
        let t = corners[e.patrol];
        if (Math.abs(e.m.c - t[0]) + Math.abs(e.m.r - t[1]) <= 2) {
          e.patrol = (e.patrol + 1) & 3;
          t = corners[e.patrol];
        }
        return t;
      }
      default:
        return [pl.c, pl.r];
    }
  }

  private chooseEnemy(e: Enemy, m: Mover): number {
    const back = m.dir >= 0 ? (m.dir + 2) & 3 : -1;
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) if (d !== back && this.canGo(m, d)) opts.push(d);
    if (!opts.length) return back >= 0 && this.canGo(m, back) ? back : -1;
    if (opts.length === 1) return opts[0];
    const pl = this.player;
    const near = Math.abs(m.c - pl.c) + Math.abs(m.r - pl.r);
    if (e.fright) {
      if (this.rng.int(4) === 0) return opts[this.rng.int(opts.length)];
      return this.bestDir(m, opts, pl.c, pl.r, true);
    }
    if (e.kind === 2 && near > 4) return opts[this.rng.int(opts.length)];
    const [tc, tr] = this.enemyTarget(e);
    return this.bestDir(m, opts, tc, tr, false);
  }

  private bestDir(m: Mover, opts: number[], tc: number, tr: number, far: boolean) {
    let best = opts[0];
    let bestD = far ? -1 : Infinity;
    for (const d of opts) {
      const dc = m.c + DIRS[d].dx - tc;
      const dr = m.r + DIRS[d].dy - tr;
      const dist = dc * dc + dr * dr;
      if (far ? dist > bestD : dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  private updateEnemy(e: Enemy) {
    const pl = this.player;
    if (e.state === "vent") {
      if (e.timer > 0) e.timer--;
      else if (Math.abs(pl.c - e.vent[0]) + Math.abs(pl.r - e.vent[1]) > 2) {
        e.state = "active";
        this.events.push({ t: "release", kind: e.kind, x: (e.vent[0] + 0.5) * TILE, y: (e.vent[1] + 0.5) * TILE });
      }
      return;
    }
    if (e.state === "dead") {
      if (--e.timer <= 0) {
        e.m = { c: e.vent[0], r: e.vent[1], dir: -1, p: 0 };
        e.state = "active";
        e.fright = false;
        this.events.push({ t: "release", kind: e.kind, x: (e.vent[0] + 0.5) * TILE, y: (e.vent[1] + 0.5) * TILE });
      }
      return;
    }
    this.advance(e.m, e.fright ? this.frightSpeed() : this.enemySpeed(), (m) => this.chooseEnemy(e, m));
  }

  private collide() {
    const px = posX(this.player);
    const py = posY(this.player);
    const W = COLS * SUB;
    for (const e of this.enemies) {
      if (e.state !== "active") continue;
      let dx = Math.abs(posX(e.m) - px) % W;
      if (dx > W / 2) dx = W - dx;
      const dy = Math.abs(posY(e.m) - py);
      if (dx >= SUB * 0.55 || dy >= SUB * 0.55) continue;
      const x = (posX(e.m) / SUB + 0.5) * TILE;
      const y = (posY(e.m) / SUB + 0.5) * TILE;
      if (e.fright) {
        const pts = enemyPoints(this.combo++);
        this.score += pts;
        e.state = "dead";
        e.fright = false;
        e.timer = RESPAWN_FRAMES;
        this.events.push({ t: "eatEnemy", sfx: "brickgone", kind: e.kind, points: pts, x, y });
      } else {
        this.die();
        return;
      }
    }
  }

  private die() {
    this.lives--;
    this.phase = "dying";
    this.phaseT = DYING_FRAMES;
    const x = (posX(this.player) / SUB + 0.5) * TILE;
    const y = (posY(this.player) / SUB + 0.5) * TILE;
    this.events.push({ t: "die", sfx: "lost", mood: "sad", shake: 8, x, y, ...(this.lives > 0 ? { toast: "lifeLost" as const } : {}) });
  }

  private levelClear() {
    this.levelsCleared++;
    this.phase = "clear";
    this.phaseT = CLEAR_FRAMES;
    this.events.push({ t: "levelclear", sfx: "levelclear", mood: "happy", toast: "levelClear" });
  }

  // ---- main loop ----
  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    let got = false;
    for (let d = 0; d < 4; d++)
      if (pressed & DIRS[d].b) {
        this.want = d;
        got = true;
      }
    if (!got && this.want >= 0 && !(inp.b & DIRS[this.want].b)) {
      // A key is still held but the buffered one was released: follow the held key.
      for (let d = 0; d < 4; d++) if (inp.b & DIRS[d].b) this.want = d;
    }

    switch (this.phase) {
      case "ready":
        if (--this.phaseT <= 0) this.phase = "play";
        return;
      case "dying":
        if (--this.phaseT <= 0) {
          if (this.lives <= 0) {
            this.phase = "over";
            this.events.push({ t: "gameover", sfx: "gameover" });
          } else {
            this.resetActors();
            this.phase = "ready";
            this.phaseT = READY_AGAIN;
          }
        }
        return;
      case "clear":
        if (--this.phaseT <= 0) {
          this.level++;
          this.loadLevel();
          this.phase = "ready";
          this.phaseT = READY_FIRST;
        }
        return;
    }

    // play
    const pl = this.player;
    if (this.want >= 0 && pl.dir >= 0 && pl.p > 0 && this.want === ((pl.dir + 2) & 3)) this.reverse(pl);
    this.moving = this.advance(pl, this.playerSpeed(), this.choosePlayer, this.arrivePlayer);
    if (pl.dir >= 0) this.face = pl.dir;
    if (this.phase !== "play") return;
    this.collide();
    if (this.phase !== "play") return;
    for (const e of this.enemies) this.updateEnemy(e);
    this.collide();
    if (this.phase !== "play") return;
    if (this.frightLeft > 0 && --this.frightLeft === 0) {
      for (const e of this.enemies) e.fright = false;
      this.combo = 0;
    }
    if (this.bonusLeft > 0) this.bonusLeft--;
  }

  view(): MazeView {
    const actor = (m: Mover): ActorView => ({
      x: (posX(m) / SUB + 0.5) * TILE,
      y: (posY(m) / SUB + 0.5) * TILE,
      c: m.c,
      r: m.r,
      dir: m.dir,
      p: m.p,
    });
    return {
      frame: this.frame,
      level: this.level,
      mazeIndex: this.level % MAZES.length,
      mazeName: this.maze.name,
      grid: this.maze.grid,
      pellets: this.pellets,
      pelletsLeft: this.pelletsLeft,
      player: { ...actor(this.player), moving: this.moving && this.phase === "play", face: this.face },
      enemies: this.enemies.map((e) => ({ ...actor(e.m), kind: e.kind, state: e.state, fright: e.fright, timer: e.timer, vent: e.vent })),
      frightLeft: this.frightLeft,
      frightTotal: this.frightTotal,
      bonus: this.bonusLeft > 0 ? { c: this.maze.start[0], r: this.maze.start[1], left: this.bonusLeft } : null,
      lives: this.lives,
      score: this.score,
      phase: this.phase,
      phaseT: this.phaseT,
      ticker: this.ticker,
    };
  }
  hud(): Hud {
    return { score: this.score, lives: Math.max(0, this.lives), level: this.level + 1, label: this.maze.name };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.levelsCleared, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

// ---- autoplayer: BFS to the nearest coin, steering clear of bots ----
function mazeBot(v: MazeView): Input {
  const idle = { x: 0, y: 0, b: 0 };
  if (v.phase !== "play" && v.phase !== "ready") return idle;
  const g = v.grid;
  const pl = v.player;
  const sc = pl.p > 0 && pl.dir >= 0 ? wrapC(pl.c + DIRS[pl.dir].dx) : pl.c;
  const sr = pl.p > 0 && pl.dir >= 0 ? pl.r + DIRS[pl.dir].dy : pl.r;
  const N = COLS * ROWS;
  const danger = new Uint8Array(N);
  const threats: [number, number][] = [];
  const goal = new Uint8Array(N);
  const hunt = v.frightLeft > 90;
  for (const e of v.enemies) {
    if (e.state !== "active") continue;
    if (e.fright) {
      if (hunt) goal[e.r * COLS + e.c] = 2;
      continue;
    }
    threats.push([e.c, e.r]);
    const ahead = e.p > 0 && e.dir >= 0 ? [wrapC(e.c + DIRS[e.dir].dx), e.r + DIRS[e.dir].dy] : [e.c, e.r];
    for (const [c, r] of [[e.c, e.r], ahead]) {
      danger[r * COLS + c] = 1;
      for (const d of DIRS) {
        const nc = wrapC(c + d.dx);
        const nr = r + d.dy;
        if (nr >= 0 && nr < ROWS) danger[nr * COLS + nc] = 1;
      }
    }
  }
  for (let i = 0; i < N; i++) if (v.pellets[i] && !goal[i]) goal[i] = 1;
  if (v.bonus) goal[v.bonus.r * COLS + v.bonus.c] = 1;

  const order = [pl.dir >= 0 ? pl.dir : 3, 0, 1, 2, 3];
  const first = new Int8Array(N).fill(-1);
  const seen = new Uint8Array(N);
  const start = sr * COLS + sc;
  let pick = -1;
  if (!danger[start]) {
    seen[start] = 1;
    const q = [start];
    let fallback = -1;
    for (let h = 0; h < q.length; h++) {
      const cur = q[h];
      const c = cur % COLS;
      const r = (cur - c) / COLS;
      if (cur !== start && goal[cur] === 2) {
        pick = first[cur];
        break;
      }
      if (cur !== start && goal[cur] === 1 && fallback < 0) {
        fallback = first[cur];
        if (!hunt) break;
      }
      for (const d of order) {
        const nc = wrapC(c + DIRS[d].dx);
        const nr = r + DIRS[d].dy;
        if (!isOpen(g, nc, nr)) continue;
        const ni = nr * COLS + nc;
        if (seen[ni] || danger[ni]) continue;
        seen[ni] = 1;
        first[ni] = cur === start ? d : first[cur];
        q.push(ni);
      }
    }
    if (pick < 0) pick = fallback;
  }
  if (pick < 0) {
    // Flee: step to the neighbour farthest from the nearest threat.
    let best = -1;
    for (let d = 0; d < 4; d++) {
      const nc = wrapC(sc + DIRS[d].dx);
      const nr = sr + DIRS[d].dy;
      if (!isOpen(g, nc, nr)) continue;
      let m = 99;
      for (const [tc, tr] of threats) m = Math.min(m, Math.abs(tc - nc) + Math.abs(tr - nr));
      if (m > best) {
        best = m;
        pick = d;
      }
    }
  }
  return pick < 0 ? idle : { x: 0, y: 0, b: DIRS[pick].b };
}

export const maze: GameDef<MazeView> = {
  id: "maze",
  name: "Maze Dash",
  tagline: "Grab every coin, dodge the FUD bots, flip the chart with a power coin.",
  genre: "Maze chase",
  session: "2–8 min",
  controls: "Arrow keys / WASD or swipe. Turns are buffered: press early, turn at the next gap.",
  field: { w: COLS * TILE, h: ROWS * TILE },
  input: { pointer: false, swipe: true, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original maze-chase design and code. Four original landscape mazes with corner vents, original robot enemies with their own AI (chaser, ambusher, wanderer, patroller), original scoring. No code, layouts, characters, sounds or art from any commercial game.",
  },
  create: (seed, ctx) => new MazeEngine(seed, ctx.ticker),
  bot: (v) => mazeBot(v),
};
