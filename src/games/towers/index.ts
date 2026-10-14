/*
 * Moon Towers: original compact tower defense for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original implementation of the genre (no code,
 * names, maps or art taken from any existing game).
 *
 * Rules: one winding path on a 9x13 grid (three hand-made maps, the run picks
 * one with Rng). Waves of FUD creeps (normal, fast, armored, swarm, and a boss
 * bear every 5th wave) walk the path toward the moon base (20 lives; a bear
 * costs 5). Build towers on free cells with coins from kills:
 *   0 Coin Blaster  - single target, homing coins
 *   1 Candle Cannon - slow shells with splash damage
 *   2 Freeze Ray    - small damage + slow
 *   3 Laser         - long range, instant, ignores armor
 * Each has 2 upgrades; selling refunds 70%. Waves start after a countdown;
 * starting early (ALT or the GO button) pays bonus coins. Towers target the
 * creep in range that is nearest to the base (furthest along the path).
 * Score = waves cleared x 100 + kills + lives bonus (lives left are added each
 * time a wave is cleared). Clearing wave 30 wins.
 *
 * Input: tap a free cell for the radial build menu, tap a tower to upgrade or
 * sell. Keys: arrows move the cursor, FIRE opens / confirms, LEFT/RIGHT pick
 * in the menu, UP/DOWN close it, ALT starts the next wave early.
 * Everything is integer frame logic plus + - * / and sqrt; randomness only
 * from Rng.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const FIELD_W = 360;
export const FIELD_H = 600;
export const COLS = 9;
export const ROWS = 13;
export const CELL = 40;
export const BOARD_Y = 44;
export const BOARD_H = ROWS * CELL; // 520
export const BAR_Y = BOARD_Y + BOARD_H; // 564
/** GO button (start the next wave early) in the bottom bar. */
export const GO_BTN = { x: 244, y: 568, w: 108, h: 28 };

export const START_LIVES = 20;
export const START_COINS = 70;
export const FIRST_COUNTDOWN = 600;
export const COUNTDOWN = 540;
export const WIN_WAVES = 30;
export const MAX_FRAMES = 60 * 60 * 30;
export const MENU_R = 46; // option distance from the menu centre
export const OPT_HIT = 22; // option tap radius

/*
 * Maps: '#' path, 'B' moon base (path end), '.' free cell, 'o' crater
 * (blocked). The path starts at the '#' in row 0 and never touches itself
 * sideways, so it traces uniquely.
 */
export const MAPS: readonly (readonly string[])[] = [
  [
    ".#.....o.",
    ".#.......",
    ".#######.",
    "o......#.",
    ".#######.",
    ".#......o",
    ".#######.",
    ".......#.",
    "o......#.",
    ".#######.",
    ".#.......",
    ".#.....o.",
    ".B.......",
  ],
  [
    "o......#.",
    ".......#.",
    ".......#o",
    "..######.",
    "..#......",
    "o.#.....o",
    "..#####..",
    "......#..",
    ".######..",
    ".#......o",
    ".#.......",
    ".####...o",
    "o...B....",
  ],
  [
    "o...#....",
    "....#...o",
    ".####....",
    ".#.......",
    ".#......o",
    ".#######.",
    "o......#.",
    ".......#.",
    "...#####.",
    "...#....o",
    "o..#.....",
    "...#####.",
    ".......B.",
  ],
];
export const MAP_NAMES = ["Switchback", "Long Haul", "Staircase"];

export const TILE = { FREE: 0, PATH: 1, BASE: 2, ROCK: 3 } as const;

export interface TowerSpec {
  name: string;
  cost: readonly number[]; // build, upgrade 1, upgrade 2
  dmg: readonly number[];
  cd: readonly number[];
  range: readonly number[]; // px
  splash?: readonly number[];
  slow?: readonly number[];
  slowFrames?: readonly number[];
}

export const TOWERS: readonly TowerSpec[] = [
  { name: "Coin Blaster", cost: [20, 25, 45], dmg: [4, 7, 12], cd: [20, 17, 14], range: [76, 84, 92] },
  { name: "Candle Cannon", cost: [40, 40, 70], dmg: [7, 12, 20], cd: [60, 55, 50], range: [70, 76, 84], splash: [30, 36, 44] },
  { name: "Freeze Ray", cost: [30, 30, 50], dmg: [1, 2, 3], cd: [30, 26, 22], range: [66, 74, 82], slow: [0.4, 0.5, 0.6], slowFrames: [70, 90, 110] },
  { name: "Laser", cost: [50, 50, 90], dmg: [12, 20, 34], cd: [50, 45, 40], range: [120, 136, 152] },
];

export const CREEP = { NORMAL: 0, FAST: 1, ARMOR: 2, SWARM: 3, BOSS: 4 } as const;
export const CREEP_NAMES = ["FUD", "Fast FUD", "Armored FUD", "FUD Swarm", "Bear"];

export interface Tower {
  id: number;
  cell: number;
  type: number;
  level: number; // 0..2
  cool: number;
  invested: number;
  /** Last target position (renderer aims the barrel there). */
  ax: number;
  ay: number;
  fired: number; // frame of last shot
}

export interface Creep {
  id: number;
  kind: number;
  wave: number;
  hp: number;
  maxHp: number;
  armor: number;
  speed: number;
  d: number; // distance along the path
  seg: number;
  x: number;
  y: number;
  slowUntil: number;
  slowF: number;
  reward: number;
  leak: number;
  hitFrame: number;
}

export interface Shell {
  id: number;
  type: number; // tower type (0 blaster, 1 cannon)
  x: number;
  y: number;
  tx: number;
  ty: number;
  target: number; // creep id
  speed: number;
  dmg: number;
  splash: number;
}

export interface MenuOption {
  kind: "build" | "upgrade" | "sell";
  type: number; // tower type (build) or the tower's type
  x: number;
  y: number;
  cost: number; // cost, or refund for sell; -1 = maxed
  ok: boolean;
}

export interface Menu {
  cell: number;
  cx: number;
  cy: number;
  sel: number;
  options: MenuOption[];
}

export interface TowersView {
  frame: number;
  map: number;
  mapName: string;
  tiles: readonly number[]; // TILE per cell
  path: readonly { x: number; y: number }[]; // waypoints in px, entry to base
  pathCells: readonly number[];
  towers: readonly Tower[];
  creeps: readonly Creep[];
  shells: readonly Shell[];
  menu: Menu | null;
  cursor: number;
  keyCursor: boolean;
  coins: number;
  lives: number;
  wave: number; // waves started
  wavesCleared: number;
  kills: number;
  score: number;
  /** Frames until the next wave, or 0 while one is spawning. */
  countdown: number;
  spawning: boolean;
  earlyBonus: number;
  over: boolean;
  won: boolean;
}

export const cellX = (c: number) => c * CELL;
export const cellY = (r: number) => BOARD_Y + r * CELL;
export const cellCX = (cell: number) => (cell % COLS) * CELL + CELL / 2;
export const cellCY = (cell: number) => BOARD_Y + Math.floor(cell / COLS) * CELL + CELL / 2;

export function cellAt(x: number, y: number): number {
  if (x < 0 || x >= FIELD_W || y < BOARD_Y || y >= BAR_Y) return -1;
  const c = Math.floor(x / CELL), r = Math.floor((y - BOARD_Y) / CELL);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  return r * COLS + c;
}

export interface ParsedMap {
  tiles: number[];
  cells: number[]; // path cells in walking order, ending with the base
  points: { x: number; y: number }[];
  cum: number[]; // cumulative length at each point
  length: number;
}

export function parseMap(rows: readonly string[]): ParsedMap {
  if (rows.length !== ROWS) throw new Error("bad map height");
  const tiles: number[] = [];
  for (const row of rows) {
    if (row.length !== COLS) throw new Error("bad map width");
    for (const ch of row) tiles.push(ch === "#" ? TILE.PATH : ch === "B" ? TILE.BASE : ch === "o" ? TILE.ROCK : TILE.FREE);
  }
  const starts: number[] = [];
  for (let c = 0; c < COLS; c++) if (tiles[c] === TILE.PATH) starts.push(c);
  if (starts.length !== 1) throw new Error("map needs one entry in row 0");
  const cells = [starts[0]];
  const seen = new Set(cells);
  for (;;) {
    const cur = cells[cells.length - 1];
    if (tiles[cur] === TILE.BASE) break;
    const c = cur % COLS, r = Math.floor(cur / COLS);
    const next: number[] = [];
    for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const nc = c + dc, nr = r + dr;
      if (nc < 0 || nc >= COLS || nr < 0 || nr >= ROWS) continue;
      const n = nr * COLS + nc;
      if (!seen.has(n) && (tiles[n] === TILE.PATH || tiles[n] === TILE.BASE)) next.push(n);
    }
    if (next.length !== 1) throw new Error(`path forks or ends at ${c},${r}`);
    cells.push(next[0]);
    seen.add(next[0]);
  }
  const points = [{ x: cellCX(cells[0]), y: BOARD_Y - 14 }, ...cells.map((n) => ({ x: cellCX(n), y: cellCY(n) }))];
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    cum.push(cum[i - 1] + Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y));
  }
  return { tiles, cells, points, cum, length: cum[cum.length - 1] };
}

const PARSED = MAPS.map(parseMap);

/** Base creep hit points for wave n (1-based). */
export function waveHp(n: number): number {
  // Grows ~24% per wave on top of a linear ramp: the economy grows roughly
  // linearly, so every run ends eventually.
  let g = 1;
  for (let i = 1; i < n; i++) g *= 1.24;
  return Math.round(6 * g + 3 * (n - 1));
}

export class TowersEngine implements GameEngine<TowersView> {
  private rng: Rng;
  readonly mapIndex: number;
  private m: ParsedMap;
  private tiles: number[];
  towers: Tower[] = [];
  creeps: Creep[] = [];
  shells: Shell[] = [];
  private towerAt = new Map<number, Tower>();
  private nextId = 1;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private kb = false;
  cursor = 6 * COLS + 4;
  menu: Menu | null = null;
  coins = START_COINS;
  lives = START_LIVES;
  wave = 0;
  wavesCleared = 0;
  kills = 0;
  livesBonus = 0;
  countdown = FIRST_COUNTDOWN;
  private queue: { kind: number; gap: number }[] = [];
  private spawnTimer = 0;
  private waveLeft = new Map<number, number>();
  over = false;
  won = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, mapIndex?: number) {
    this.rng = new Rng(seed);
    this.mapIndex = mapIndex ?? this.rng.int(MAPS.length);
    this.m = PARSED[this.mapIndex];
    this.tiles = this.m.tiles.slice();
  }

  get score() {
    return this.wavesCleared * 100 + this.kills + this.livesBonus;
  }

  // ---------- Input ----------

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over || this.won) return;
    this.handleInput(inp);
    this.updateWaves();
    this.updateTowers();
    this.updateShells();
    this.updateCreeps();
    if (!this.over && !this.won && this.frame >= MAX_FRAMES) this.finish(false);
  }

  private handleInput(inp: Input) {
    const b = inp.b;
    const pressed = b & ~this.prevB;
    this.prevB = b;
    if (inp.x !== this.px || inp.y !== this.py) {
      this.kb = false;
      this.px = inp.x;
      this.py = inp.y;
      if (this.menu) {
        const h = this.optionAt(inp.x, inp.y);
        if (h >= 0) this.menu.sel = h;
      }
    }
    if (pressed & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT)) this.kb = true;
    if (pressed & BTN.ALT) this.startEarly();

    const menu = this.menu;
    if (menu) {
      const n = menu.options.length;
      if (pressed & BTN.LEFT) menu.sel = (menu.sel + n - 1) % n;
      if (pressed & BTN.RIGHT) menu.sel = (menu.sel + 1) % n;
      if (pressed & (BTN.UP | BTN.DOWN)) {
        this.menu = null;
        this.moveCursor(pressed);
        return;
      }
      if (pressed & BTN.FIRE) {
        if (this.kb) this.confirm(menu.sel);
        else {
          const h = this.optionAt(inp.x, inp.y);
          if (h >= 0) this.confirm(h);
          else {
            this.menu = null;
            const cell = cellAt(inp.x, inp.y);
            if (cell >= 0 && cell !== menu.cell) {
              this.cursor = cell;
              this.openMenu(cell);
            }
          }
        }
      }
      return;
    }
    this.moveCursor(pressed);
    if (pressed & BTN.FIRE) {
      if (!this.kb && inp.x >= GO_BTN.x && inp.x < GO_BTN.x + GO_BTN.w && inp.y >= GO_BTN.y && inp.y < GO_BTN.y + GO_BTN.h) {
        this.startEarly();
        return;
      }
      const cell = this.kb ? this.cursor : cellAt(inp.x, inp.y);
      if (cell < 0) return;
      this.cursor = cell;
      this.openMenu(cell);
    }
  }

  private moveCursor(pressed: number) {
    const c = this.cursor % COLS, r = Math.floor(this.cursor / COLS);
    let nc = c, nr = r;
    if (pressed & BTN.UP) nr--;
    if (pressed & BTN.DOWN) nr++;
    if (pressed & BTN.LEFT) nc--;
    if (pressed & BTN.RIGHT) nc++;
    nc = Math.max(0, Math.min(COLS - 1, nc));
    nr = Math.max(0, Math.min(ROWS - 1, nr));
    this.cursor = nr * COLS + nc;
  }

  private optionAt(x: number, y: number): number {
    if (!this.menu) return -1;
    const os = this.menu.options;
    for (let i = 0; i < os.length; i++) {
      const dx = x - os[i].x, dy = y - os[i].y;
      if (dx * dx + dy * dy <= OPT_HIT * OPT_HIT) return i;
    }
    return -1;
  }

  private openMenu(cell: number) {
    const tile = this.tiles[cell];
    const tower = this.towerAt.get(cell);
    if (!tower && tile !== TILE.FREE) {
      this.events.push({ t: "nope", sfx: "wall", x: cellCX(cell), y: cellCY(cell) });
      return;
    }
    const cx = Math.max(64, Math.min(FIELD_W - 64, cellCX(cell)));
    const cy = Math.max(BOARD_Y + 64, Math.min(BAR_Y - 64, cellCY(cell)));
    const options: MenuOption[] = [];
    if (!tower) {
      const offs = [[0, -MENU_R], [MENU_R, 0], [0, MENU_R], [-MENU_R, 0]];
      for (let t = 0; t < 4; t++) {
        options.push({ kind: "build", type: t, x: cx + offs[t][0], y: cy + offs[t][1], cost: TOWERS[t].cost[0], ok: false });
      }
    } else {
      const up = tower.level < 2 ? TOWERS[tower.type].cost[tower.level + 1] : -1;
      options.push({ kind: "upgrade", type: tower.type, x: cx - MENU_R, y: cy, cost: up, ok: false });
      options.push({ kind: "sell", type: tower.type, x: cx + MENU_R, y: cy, cost: Math.floor((tower.invested * 7) / 10), ok: true });
    }
    this.menu = { cell, cx, cy, sel: 0, options };
    this.refreshMenu();
    this.events.push({ t: "menu", cell });
  }

  private refreshMenu() {
    if (!this.menu) return;
    for (const o of this.menu.options) {
      if (o.kind !== "sell") o.ok = o.cost >= 0 && this.coins >= o.cost;
    }
  }

  private confirm(i: number) {
    const menu = this.menu;
    if (!menu) return;
    this.refreshMenu(); // affordability from current coins (view() may never be called in replays)
    const o = menu.options[i];
    if (!o) return;
    const x = cellCX(menu.cell), y = cellCY(menu.cell);
    if (!o.ok) {
      this.events.push({ t: "nope", sfx: "wall", x, y });
      return;
    }
    if (o.kind === "build") {
      this.coins -= o.cost;
      const tw: Tower = { id: this.nextId++, cell: menu.cell, type: o.type, level: 0, cool: 10, invested: o.cost, ax: x, ay: y - 20, fired: -999 };
      this.towers.push(tw);
      this.towerAt.set(menu.cell, tw);
      this.events.push({ t: "build", type: o.type, sfx: "extraGood", x, y });
    } else if (o.kind === "upgrade") {
      const tw = this.towerAt.get(menu.cell)!;
      this.coins -= o.cost;
      tw.level++;
      tw.invested += o.cost;
      this.events.push({ t: "upgrade", type: tw.type, level: tw.level, sfx: "extraGood", mood: "happy", x, y });
    } else {
      const tw = this.towerAt.get(menu.cell)!;
      this.coins += o.cost;
      this.towerAt.delete(menu.cell);
      this.towers = this.towers.filter((q) => q !== tw);
      this.events.push({ t: "sell", type: tw.type, refund: o.cost, sfx: "brick", x, y });
    }
    this.menu = null;
  }

  // ---------- Waves ----------

  private startEarly() {
    if (this.queue.length || this.countdown <= 0) return;
    const bonus = this.earlyBonus();
    this.coins += bonus;
    this.events.push({ t: "early", bonus, sfx: "extraGood", x: GO_BTN.x + GO_BTN.w / 2, y: GO_BTN.y });
    this.startWave();
  }

  earlyBonus() {
    return this.countdown > 0 && !this.queue.length ? 2 + Math.floor(this.countdown / 60) : 0;
  }

  private startWave() {
    const n = ++this.wave;
    this.countdown = 0;
    const q: { kind: number; gap: number }[] = [];
    const add = (kind: number, count: number, gap: number) => {
      for (let i = 0; i < count; i++) q.push({ kind, gap: q.length ? gap : 0 });
    };
    let theme: number;
    if (n % 5 === 0) {
      add(CREEP.NORMAL, 4 + (n >> 1), 36);
      q.push({ kind: CREEP.BOSS, gap: 70 });
      theme = CREEP.BOSS;
    } else {
      theme = n === 1 || n === 2 ? CREEP.NORMAL : n === 3 ? CREEP.FAST : n === 4 ? CREEP.SWARM : this.rng.int(5);
      if (theme === CREEP.NORMAL) add(CREEP.NORMAL, 8 + (n >> 1), 42);
      else if (theme === CREEP.FAST) add(CREEP.FAST, 8 + (n >> 1), 30);
      else if (theme === CREEP.ARMOR) add(CREEP.ARMOR, 6 + Math.floor(n / 3), 50);
      else if (theme === CREEP.SWARM) add(CREEP.SWARM, 16 + n, 16);
      else {
        // Mixed wave (theme 4 here means "mixed").
        const count = 10 + (n >> 1);
        for (let i = 0; i < count; i++) {
          const k = this.rng.int(3);
          q.push({ kind: k, gap: i ? 34 : 0 });
        }
      }
    }
    this.queue = q;
    this.spawnTimer = 0;
    this.waveLeft.set(n, q.length);
    this.events.push({ t: "wave", wave: n, theme, boss: n % 5 === 0, sfx: "launch" });
  }

  private spawn(kind: number) {
    const n = this.wave;
    const base = waveHp(n);
    let hp = base, speed = 0.62, armor = 0, reward = 2 + Math.floor(n / 6), leak = 1;
    if (kind === CREEP.FAST) {
      hp = Math.max(1, Math.round(base * 0.6));
      speed = 1.05;
    } else if (kind === CREEP.ARMOR) {
      hp = Math.round(base * 1.3);
      speed = 0.46;
      armor = 1 + Math.floor(n / 4);
      reward += 1;
    } else if (kind === CREEP.SWARM) {
      hp = Math.max(1, Math.round(base * 0.35));
      speed = 0.75;
      reward = 1;
    } else if (kind === CREEP.BOSS) {
      hp = base * 14;
      speed = 0.32;
      armor = Math.floor(n / 5);
      reward = 25 + 2 * n;
      leak = 5;
    }
    const p0 = this.m.points[0];
    this.creeps.push({ id: this.nextId++, kind, wave: n, hp, maxHp: hp, armor, speed, d: 0, seg: 0, x: p0.x, y: p0.y, slowUntil: 0, slowF: 0, reward, leak, hitFrame: -99 });
    if (kind === CREEP.BOSS) this.events.push({ t: "boss", sfx: "extraBad", shake: 4, x: p0.x, y: p0.y });
  }

  private updateWaves() {
    if (this.queue.length) {
      if (this.spawnTimer > 0) this.spawnTimer--;
      while (this.queue.length && this.spawnTimer <= 0) {
        const s = this.queue.shift()!;
        this.spawn(s.kind);
        if (this.queue.length) this.spawnTimer = this.queue[0].gap;
      }
      if (!this.queue.length) this.countdown = COUNTDOWN;
      return;
    }
    if (this.countdown > 0) {
      // Field empty: don't make the player wait the whole countdown.
      if (!this.creeps.length && this.countdown > 300) this.countdown = 300;
      if (--this.countdown <= 0) this.startWave();
    }
  }

  private waveDone(n: number) {
    const left = (this.waveLeft.get(n) ?? 1) - 1;
    this.waveLeft.set(n, left);
    if (left > 0 || this.lives <= 0) return;
    this.waveLeft.delete(n);
    this.wavesCleared++;
    this.livesBonus += this.lives;
    const bonus = 5 + n;
    this.coins += bonus;
    const boss = n % 5 === 0;
    this.events.push({ t: "waveClear", wave: n, bonus, sfx: "levelclear", mood: "happy", toast: boss ? "levelClear" : undefined });
    if (this.wavesCleared >= WIN_WAVES) this.finish(true);
  }

  // ---------- Combat ----------

  private hurt(c: Creep, dmg: number, pierce: boolean) {
    if (c.hp <= 0) return;
    const d = pierce ? dmg : Math.max(1, dmg - c.armor);
    c.hp -= d;
    c.hitFrame = this.frame;
    if (c.hp <= 0) {
      this.kills++;
      this.coins += c.reward;
      const boss = c.kind === CREEP.BOSS;
      this.events.push({
        t: "kill", kind: c.kind, reward: c.reward, x: c.x, y: c.y,
        sfx: boss ? "explode" : "brickgone", shake: boss ? 8 : undefined, mood: boss ? "happy" : undefined,
      });
      this.waveDone(c.wave);
    }
  }

  /** Creep in range nearest to the base (largest d); ties -> lower id. */
  private target(tw: Tower, range: number, preferUnslowed: boolean): Creep | null {
    const x = cellCX(tw.cell), y = cellCY(tw.cell);
    const r2 = range * range;
    let best: Creep | null = null;
    let bestFresh = false;
    for (const c of this.creeps) {
      if (c.hp <= 0) continue;
      const dx = c.x - x, dy = c.y - y;
      if (dx * dx + dy * dy > r2) continue;
      const fresh = preferUnslowed && c.slowUntil <= this.frame;
      if (!best || (fresh && !bestFresh) || (fresh === bestFresh && (c.d > best.d || (c.d === best.d && c.id < best.id)))) {
        best = c;
        bestFresh = fresh;
      }
    }
    return best;
  }

  private updateTowers() {
    for (const tw of this.towers) {
      if (tw.cool > 0) {
        tw.cool--;
        continue;
      }
      const spec = TOWERS[tw.type];
      const L = tw.level;
      const c = this.target(tw, spec.range[L], tw.type === 2);
      if (!c) continue;
      tw.cool = spec.cd[L];
      tw.ax = c.x;
      tw.ay = c.y;
      tw.fired = this.frame;
      const x = cellCX(tw.cell), y = cellCY(tw.cell);
      if (tw.type === 0 || tw.type === 1) {
        this.shells.push({
          id: this.nextId++, type: tw.type, x, y, tx: c.x, ty: c.y, target: c.id,
          speed: tw.type === 0 ? 6 : 3.6, dmg: spec.dmg[L], splash: spec.splash ? spec.splash[L] : 0,
        });
        this.events.push({ t: "fire", type: tw.type, level: L, x, y, tx: c.x, ty: c.y, sfx: tw.type === 1 ? "launch" : undefined });
      } else if (tw.type === 2) {
        const f = spec.slow![L];
        if (c.slowUntil <= this.frame || f >= c.slowF) c.slowF = f;
        c.slowUntil = Math.max(c.slowUntil, this.frame + spec.slowFrames![L]);
        this.events.push({ t: "beam", type: 2, level: L, x, y, tx: c.x, ty: c.y });
        this.hurt(c, spec.dmg[L], false);
      } else {
        this.events.push({ t: "beam", type: 3, level: L, x, y, tx: c.x, ty: c.y, sfx: "shot" });
        this.hurt(c, spec.dmg[L], true);
      }
    }
  }

  private updateShells() {
    if (!this.shells.length) return;
    const byId = new Map<number, Creep>();
    for (const c of this.creeps) if (c.hp > 0) byId.set(c.id, c);
    const keep: Shell[] = [];
    for (const s of this.shells) {
      const t = byId.get(s.target);
      if (t) {
        s.tx = t.x;
        s.ty = t.y;
      }
      const dx = s.tx - s.x, dy = s.ty - s.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > s.speed) {
        s.x += (dx / dist) * s.speed;
        s.y += (dy / dist) * s.speed;
        keep.push(s);
        continue;
      }
      s.x = s.tx;
      s.y = s.ty;
      if (s.type === 1) {
        const r2 = s.splash * s.splash;
        for (const c of this.creeps) {
          if (c.hp <= 0) continue;
          const ex = c.x - s.x, ey = c.y - s.y;
          if (ex * ex + ey * ey <= r2) this.hurt(c, s.dmg, false);
        }
        this.events.push({ t: "boom", x: s.x, y: s.y, r: s.splash, sfx: "brick", shake: 2 });
      } else if (t) {
        this.hurt(t, s.dmg, false);
        this.events.push({ t: "hit", x: s.x, y: s.y });
      }
    }
    this.shells = keep;
  }

  private updateCreeps() {
    const P = this.m.points, cum = this.m.cum, len = this.m.length;
    const alive: Creep[] = [];
    for (const c of this.creeps) {
      if (c.hp <= 0) continue;
      const slowed = c.slowUntil > this.frame;
      c.d += slowed ? c.speed * (1 - c.slowF) : c.speed;
      if (c.d >= len) {
        this.lives = Math.max(0, this.lives - c.leak);
        this.events.push({ t: "leak", kind: c.kind, x: P[P.length - 1].x, y: P[P.length - 1].y, sfx: "lost", mood: "sad", toast: "lifeLost", shake: c.leak > 1 ? 10 : 5 });
        c.hp = 0;
        if (this.lives <= 0) {
          this.finish(false);
          return;
        }
        this.waveDone(c.wave);
        continue;
      }
      while (c.seg < P.length - 2 && cum[c.seg + 1] <= c.d) c.seg++;
      const a = P[c.seg], b = P[c.seg + 1];
      const k = (c.d - cum[c.seg]) / (cum[c.seg + 1] - cum[c.seg]);
      c.x = a.x + (b.x - a.x) * k;
      c.y = a.y + (b.y - a.y) * k;
      alive.push(c);
    }
    this.creeps = alive;
  }

  private finish(won: boolean) {
    this.menu = null;
    if (won) {
      this.won = true;
      this.events.push({ t: "won", sfx: "won", mood: "happy" });
    } else {
      this.over = true;
      this.events.push({ t: "gameover", sfx: "gameover", mood: "sad", shake: 10 });
    }
  }

  // ---------- Output ----------

  view(): TowersView {
    this.refreshMenu();
    return {
      frame: this.frame,
      map: this.mapIndex,
      mapName: MAP_NAMES[this.mapIndex],
      tiles: this.tiles,
      path: this.m.points,
      pathCells: this.m.cells,
      towers: this.towers,
      creeps: this.creeps,
      shells: this.shells,
      menu: this.menu,
      cursor: this.cursor,
      keyCursor: this.kb,
      coins: this.coins,
      lives: this.lives,
      wave: this.wave,
      wavesCleared: this.wavesCleared,
      kills: this.kills,
      score: this.score,
      countdown: this.countdown,
      spawning: this.queue.length > 0,
      earlyBonus: this.earlyBonus(),
      over: this.over,
      won: this.won,
    };
  }

  hud(): Hud {
    return { score: this.score, lives: this.lives, level: Math.max(1, this.wave), label: `${this.coins} coins` };
  }

  result(): GameResult {
    return {
      score: this.score,
      level: Math.max(0, this.wave - 1),
      levelsCleared: this.wavesCleared,
      frames: this.frame,
      status: this.won ? "won" : this.over ? "over" : "playing",
    };
  }

  get done() {
    return this.over || this.won;
  }
}

// ---------- Bot ----------

const BOT_PLAN = [0, 0, 1, 3, 2, 0, 1, 3, 0, 2, 1, 3];
const NONE: Input = { x: 0, y: 0, b: 0 };

/** Free, unoccupied cells ranked by how many path cells a tower there covers. */
export function rankSpots(v: TowersView, range: number): { cell: number; cover: number }[] {
  const used = new Set(v.towers.map((t) => t.cell));
  const out: { cell: number; cover: number }[] = [];
  const r2 = range * range;
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    if (v.tiles[cell] !== TILE.FREE || used.has(cell)) continue;
    const x = cellCX(cell), y = cellCY(cell);
    let cover = 0;
    for (const pc of v.pathCells) {
      const dx = cellCX(pc) - x, dy = cellCY(pc) - y;
      if (dx * dx + dy * dy <= r2) cover++;
    }
    if (cover > 0) out.push({ cell, cover });
  }
  // Later path cells (nearer the base) matter a bit less here; keep it simple.
  out.sort((a, b) => b.cover - a.cover || a.cell - b.cell);
  return out;
}

function botWant(v: TowersView): { cell: number; kind: "build" | "upgrade"; type: number } | null {
  const plan = BOT_PLAN[v.towers.length % BOT_PLAN.length];
  const cap = 5 + (v.wave >> 1);
  if (v.towers.length < cap && v.coins >= TOWERS[plan].cost[0]) {
    const spots = rankSpots(v, TOWERS[plan].range[0]);
    if (spots.length) {
      // Not always the best spot: a decent but imperfect builder.
      const pick = spots[(v.towers.length * 5) % Math.min(4, spots.length)];
      return { cell: pick.cell, kind: "build", type: plan };
    }
  }
  let best: Tower | null = null;
  for (const t of v.towers) if (t.level < 2 && (!best || t.level < best.level)) best = t;
  if (best && v.coins >= TOWERS[best.type].cost[best.level + 1] && v.towers.length >= Math.min(cap, 6)) {
    return { cell: best.cell, kind: "upgrade", type: best.type };
  }
  return null;
}

export const towers: GameDef<TowersView> = {
  id: "towers",
  name: "Moon Towers",
  tagline: "FUD is marching on the moon base. Build towers, hold the line, send it.",
  genre: "Tower defense",
  session: "5–15 min",
  controls: "Tap a free cell to build, tap a tower to upgrade or sell, GO starts the next wave early. Keys: arrows move, Space opens/confirms, Left/Right pick, X starts the wave.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the tower defense genre: maps, towers, creeps, waves, balance and all art written for ArcadePad. No code, names, maps, art or sounds from any existing game.",
  },
  create: (seed) => new TowersEngine(seed),
  bot(v, frame) {
    if (v.over || v.won) return NONE;
    // Presses on every 4th frame, releases in between (one tap = one press).
    if (frame % 4 !== 0) return { x: v.menu ? v.menu.cx : 180, y: v.menu ? v.menu.cy : 20, b: 0 };
    const want = botWant(v);
    if (v.menu) {
      if (want && v.menu.cell === want.cell) {
        const i = v.menu.options.findIndex((o) => o.kind === want.kind && o.type === want.type);
        if (i >= 0) return { x: v.menu.options[i].x, y: v.menu.options[i].y, b: BTN.FIRE };
      }
      return { x: 180, y: 20, b: BTN.FIRE }; // tap the top bar: close
    }
    if (want) return { x: cellCX(want.cell), y: cellCY(want.cell), b: BTN.FIRE };
    // Impatient early on: sends the first waves early.
    if (v.countdown > 0 && !v.spawning && v.wave < 3 && v.towers.length >= 3) return { x: 180, y: 20, b: BTN.ALT };
    return NONE;
  },
};
