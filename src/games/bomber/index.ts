/*
 * Blast Grid: an original grid bomb-arena game for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original design and code (no ported source).
 *
 * The genre mechanic (drop timed bombs on a pillar grid, blasts run in a +
 * shape, crates hide power-ups, last one standing wins the round) is used;
 * everything else is our own: the coin mascot against three CPU rivals
 * (bear, ghost, rug), coin-shaped bombs, crate/arena generation, the
 * danger-map AI, scoring and the endless match ladder.
 *
 * Rules: 13x11 grid, pillars on odd/odd cells, random crates. FIRE drops a
 * bomb that explodes after 2.5 s. Blasts stop at pillars, destroy the first
 * crate they hit and set off other bombs. Anyone in a blast is out. Last one
 * standing takes the round; three rounds take the match; the run goes on
 * match after match against smarter bots until a bot takes a match.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const COLS = 13;
export const ROWS = 11;
export const N = COLS * ROWS;
export const CELL = 27;
export const FIELD_W = 360;
export const FIELD_H = 600;
/** Board origin in field units (renderer layout). */
export const OX = (FIELD_W - COLS * CELL) / 2;
export const OY = 150;
/** Sub-steps per cell (actor positions are integers). */
export const SUB = 120;
export const BOMB_T = 150; // 2.5 s
export const FLAME_T = 32;
export const BASE_SPEED = 7;
export const MAX_SPEED = 12;
const MAX_POWER = 8;
const MAX_BOMBS = 8;
export const INTRO_T = 100;
export const END_T = 160;
export const ROUND_T = 120 * 60;
/** Sudden death: after HURRY_AT frames the arena closes in, one cell every CLOSE_EVERY frames. */
export const HURRY_AT = 60 * 60;
export const CLOSE_EVERY = 16;
export const WINS_NEEDED = 3;
/** Presses shorter than this are swipe pulses: the actor glides until blocked. */
const TAP_FRAMES = 5;

export const EMPTY = 0;
export const PILLAR = 1;
export const CRATE = 2;
export const BURNING = 3;

export const ITEM_BOMB = 1;
export const ITEM_FIRE = 2;
export const ITEM_SPEED = 3;

export const NAMES = ["YOU", "BEAR", "GHOST", "RUG"];
const SPAWNS: [number, number][] = [[0, 0], [COLS - 1, 0], [0, ROWS - 1], [COLS - 1, ROWS - 1]];

/** Sudden-death order: rings from the outside in, clockwise, pillars skipped. */
export const CLOSE_ORDER: number[] = (() => {
  const out: number[] = [];
  for (let k = 0; 2 * k < Math.min(COLS, ROWS); k++) {
    const c0 = k, r0 = k, c1 = COLS - 1 - k, r1 = ROWS - 1 - k;
    const ring: [number, number][] = [];
    for (let c = c0; c <= c1; c++) ring.push([c, r0]);
    for (let r = r0 + 1; r <= r1; r++) ring.push([c1, r]);
    if (r1 > r0) for (let c = c1 - 1; c >= c0; c--) ring.push([c, r1]);
    if (c1 > c0) for (let r = r1 - 1; r > r0; r--) ring.push([c0, r]);
    for (const [c, r] of ring) if (!(c % 2 === 1 && r % 2 === 1)) out.push(r * COLS + c);
  }
  return out;
})();

export const DIRS = [
  { b: BTN.UP, dx: 0, dy: -1 },
  { b: BTN.RIGHT, dx: 1, dy: 0 },
  { b: BTN.DOWN, dx: 0, dy: 1 },
  { b: BTN.LEFT, dx: -1, dy: 0 },
];

export const SCORE = { crate: 10, item: 25, kill: 100, round: 250, match: 1000 };

// ---------------------------------------------------------------------------
// Planner shared by the CPU rivals and the attract-mode autoplayer.
// Pure functions over a small board description: no engine state, no Rng.

const INF = 1 << 30;

export interface PlanBomb { c: number; r: number; timer: number; power: number }
export interface PlanActor { alive: boolean; c: number; r: number; power: number; bombsLeft: number; speed: number }
export interface PlanBoard {
  grid: ArrayLike<number>;
  flame: ArrayLike<number>;
  item: ArrayLike<number>;
  bombs: readonly PlanBomb[];
  /** c/r: the cell the actor plans from (its destination while moving). */
  actors: readonly PlanActor[];
  /** Cells about to be walled in by sudden death, with frames until they close. */
  soon?: readonly { i: number; t: number }[];
}
export interface Skill {
  /** Extra frames of safety when planning escapes. */
  margin: number;
  /** Percent chance to drop a bomb without checking for an escape. */
  reckless: number;
  /** Percent chance to take a random safe step. */
  wander: number;
  /** Value of catching a rival in a blast. */
  aggro: number;
}
export interface Plan { dir: number; bomb: boolean }

const inside = (c: number, r: number) => c >= 0 && c < COLS && r >= 0 && r < ROWS;
export const framesPerCell = (speed: number) => Math.ceil(SUB / speed);

/** Cells covered by a blast from (c, r). `bombAt(i)` stops the ray (chain). */
export function blastCells(grid: ArrayLike<number>, bombAt: (i: number) => boolean, c: number, r: number, power: number, out: number[]): number[] {
  out.push(r * COLS + c);
  for (const d of DIRS) {
    for (let k = 1; k <= power; k++) {
      const nc = c + d.dx * k;
      const nr = r + d.dy * k;
      if (!inside(nc, nr)) break;
      const i = nr * COLS + nc;
      const g = grid[i];
      if (g === PILLAR) break;
      out.push(i);
      if (g !== EMPTY || bombAt(i)) break;
    }
  }
  return out;
}

export interface Danger {
  /** Frames until a blast covers the cell (0 = burning now, INF = safe). */
  t: Int32Array;
  /** Bomb index + 1 per cell (0 = none). */
  bomb: Int16Array;
}

/** Danger map with chain reactions; `extra` is a hypothetical new bomb. */
export function dangerMap(b: PlanBoard, extra: PlanBomb | null): Danger {
  const list = extra ? [...b.bombs, extra] : b.bombs;
  const at = new Int16Array(N);
  for (let k = 0; k < list.length; k++) at[list[k].r * COLS + list[k].c] = k + 1;
  const bombAt = (i: number) => at[i] > 0;
  const t = list.map((x) => x.timer);
  const cells = list.map((x) => blastCells(b.grid, bombAt, x.c, x.r, x.power, []));
  let changed = true;
  while (changed) {
    changed = false;
    for (let k = 0; k < list.length; k++)
      for (const i of cells[k]) {
        const j = at[i] - 1;
        if (j >= 0 && t[j] > t[k]) {
          t[j] = t[k];
          changed = true;
        }
      }
  }
  const out = new Int32Array(N).fill(INF);
  for (let k = 0; k < list.length; k++) for (const i of cells[k]) if (t[k] < out[i]) out[i] = t[k];
  for (let i = 0; i < N; i++) if (b.flame[i] > 0) out[i] = 0;
  if (b.soon) for (const s of b.soon) if (s.t < out[s.i]) out[s.i] = s.t;
  return { t: out, bomb: at };
}

const walkable = (b: PlanBoard, dg: Danger, i: number) => b.grid[i] === EMPTY && dg.bomb[i] === 0 && b.flame[i] === 0;

/** BFS to the nearest cell no blast will reach, only through cells we can cross in time. */
export function escapeRoute(b: PlanBoard, start: number, dg: Danger, fpc: number, margin: number): { dir: number; dist: number } | null {
  if (dg.t[start] === INF) return { dir: -1, dist: 0 };
  const dist = new Int16Array(N).fill(-1);
  const first = new Int8Array(N).fill(-1);
  dist[start] = 0;
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    const c = cur % COLS;
    const r = (cur - c) / COLS;
    for (let d = 0; d < 4; d++) {
      const nc = c + DIRS[d].dx;
      const nr = r + DIRS[d].dy;
      if (!inside(nc, nr)) continue;
      const n = nr * COLS + nc;
      if (dist[n] >= 0 || !walkable(b, dg, n)) continue;
      const arrive = (dist[cur] + 1) * fpc;
      if (dg.t[n] !== INF && dg.t[n] <= arrive + fpc + margin) continue;
      dist[n] = dist[cur] + 1;
      first[n] = cur === start ? d : first[cur];
      if (dg.t[n] === INF) return { dir: first[n], dist: dist[n] };
      q.push(n);
    }
  }
  return null;
}

/** Decide the next step for actor `me`, standing (or arriving) at its plan cell. */
export function planStep(b: PlanBoard, me: number, sk: Skill, roll: () => number): Plan {
  const a = b.actors[me];
  const start = a.r * COLS + a.c;
  const fpc = framesPerCell(a.speed);
  const dg = dangerMap(b, null);
  const stay: Plan = { dir: -1, bomb: false };

  if (dg.t[start] !== INF) {
    const e = escapeRoute(b, start, dg, fpc, sk.margin);
    if (e && e.dir >= 0) return { dir: e.dir, bomb: false };
    // Trapped: step to whichever neighbour blows up last.
    let best = -1;
    let bestT = dg.t[start];
    for (let d = 0; d < 4; d++) {
      const nc = a.c + DIRS[d].dx;
      const nr = a.r + DIRS[d].dy;
      if (!inside(nc, nr)) continue;
      const n = nr * COLS + nc;
      if (walkable(b, dg, n) && dg.t[n] > bestT) {
        bestT = dg.t[n];
        best = d;
      }
    }
    return { dir: best, bomb: false };
  }

  const safeStep = (n: number) => walkable(b, dg, n) && dg.t[n] === INF;
  if (roll() < sk.wander) {
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nc = a.c + DIRS[d].dx;
      const nr = a.r + DIRS[d].dy;
      if (inside(nc, nr) && safeStep(nr * COLS + nc)) opts.push(d);
    }
    if (opts.length) return { dir: opts[roll() % opts.length], bomb: false };
  }

  // Rival cells.
  const rivals: number[] = [];
  for (let k = 0; k < b.actors.length; k++) if (k !== me && b.actors[k].alive) rivals.push(b.actors[k].r * COLS + b.actors[k].c);
  const bombAt = (i: number) => dg.bomb[i] > 0;
  const bombValue = (x: number) => {
    if (a.bombsLeft <= 0) return 0;
    const cells = blastCells(b.grid, bombAt, x % COLS, Math.floor(x / COLS), a.power, []);
    let v = 0;
    for (const i of cells) {
      if (b.grid[i] === CRATE && dg.t[i] === INF) v += 30;
      for (const rc of rivals) if (rc === i && i !== x) v += sk.aggro;
    }
    return v;
  };
  const hunt = (x: number) => {
    let m = 99;
    const xc = x % COLS;
    const xr = Math.floor(x / COLS);
    for (const rc of rivals) m = Math.min(m, Math.abs((rc % COLS) - xc) + Math.abs(Math.floor(rc / COLS) - xr));
    return Math.max(0, 40 - 5 * m);
  };

  // BFS over safe cells, scoring each reachable cell.
  const dist = new Int16Array(N).fill(-1);
  const first = new Int8Array(N).fill(-1);
  dist[start] = 0;
  const q = [start];
  let best = -1;
  let bestScore = 0;
  let startBomb = 0;
  for (let h = 0; h < q.length; h++) {
    const x = q[h];
    const c = x % COLS;
    const r = (x - c) / COLS;
    let s = hunt(x) - dist[x] * 3;
    const it = b.item[x];
    if (it && x !== start) s += it === ITEM_SPEED && a.speed >= MAX_SPEED ? 10 : 100;
    const bv = bombValue(x);
    if (x === start) startBomb = bv;
    else s += bv;
    if (x !== start && s > bestScore) {
      bestScore = s;
      best = x;
    }
    for (let d = 0; d < 4; d++) {
      const nc = c + DIRS[d].dx;
      const nr = r + DIRS[d].dy;
      if (!inside(nc, nr)) continue;
      const n = nr * COLS + nc;
      if (dist[n] >= 0 || !safeStep(n)) continue;
      dist[n] = dist[x] + 1;
      first[n] = x === start ? d : first[x];
      q.push(n);
    }
  }
  const startScore = hunt(start) + startBomb;
  if (startBomb > 0 && startScore >= bestScore) {
    let ok = roll() < sk.reckless;
    if (!ok) {
      const extra = { c: a.c, r: a.r, timer: BOMB_T, power: a.power };
      const dg2 = dangerMap(b, extra);
      ok = escapeRoute(b, start, dg2, fpc, sk.margin) !== null;
    }
    if (ok) return { dir: -1, bomb: true };
  }
  if (best >= 0 && bestScore > hunt(start)) return { dir: first[best], bomb: false };
  return stay;
}

/** Skill of the CPU rivals in match `level` (0-based). */
export function skillFor(level: number): Skill {
  return {
    margin: level >= 2 ? 8 : level >= 1 ? 3 : 0,
    reckless: Math.max(0, 8 - 4 * level),
    wander: Math.max(1, 12 - 4 * level),
    aggro: 30 + 15 * level,
  };
}

// ---------------------------------------------------------------------------
// Engine

export interface Bomb { id: number; c: number; r: number; owner: number; timer: number; power: number; done: boolean }

export interface Actor {
  id: number;
  alive: boolean;
  /** Cell it is leaving (or standing on). */
  c: number;
  r: number;
  /** Cell it is moving into. */
  tc: number;
  tr: number;
  /** 0..SUB progress from (c, r) to (tc, tr). */
  p: number;
  dir: number; // moving direction, -1 standing
  face: number;
  speed: number;
  maxBombs: number;
  power: number;
  wins: number;
  killer: number;
  deadAt: number;
  think: number;
}

export type Phase = "intro" | "play" | "roundEnd" | "over";

export interface ActorView extends Actor {
  bombsLeft: number;
}

export interface BomberView {
  frame: number;
  phase: Phase;
  phaseT: number;
  match: number; // 1-based
  round: number; // 1-based within the match
  level: number; // 0-based bot level
  grid: number[];
  flame: number[];
  flameKind: number[];
  item: number[];
  bombs: Bomb[];
  actors: ActorView[];
  score: number;
  timeLeft: number; // frames
  /** Sudden death running. */
  hurry: boolean;
  /** Frame each cell was walled in by sudden death (0 = never). */
  closedAt: number[];
  /** Next cells to close (warning blink). */
  nextClose: number[];
  soon: { i: number; t: number }[];
  /** Set during roundEnd: winner index, -1 = draw. */
  roundWinner: number;
  matchWon: boolean;
  matchLost: boolean;
}

export class BomberEngine implements GameEngine<BomberView> {
  rng: Rng;
  grid = new Uint8Array(N);
  hidden = new Uint8Array(N);
  item = new Uint8Array(N);
  flame = new Uint8Array(N);
  flameOwner = new Int8Array(N);
  flameKind = new Uint8Array(N);
  bombs: Bomb[] = [];
  actors: Actor[] = [];
  phase: Phase = "intro";
  phaseT = 0;
  roundT = 0;
  closeIdx = 0;
  closedAt = new Int32Array(N);
  match = 1;
  round = 1;
  level = 0;
  matchesWon = 0;
  score = 0;
  roundWinner = -1;
  matchWon = false;
  matchLost = false;
  /** Test hook: CPU rivals stand still and never bomb. */
  freezeBots = false;
  frame = 0;
  events: GameEvent[] = [];
  private bombId = 0;
  private prevB = 0;
  // Human control state.
  private queued = -1;
  private queuedTTL = 0;
  private glide = -1;
  private holdDir = -1;
  private holdFrames = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    for (let k = 0; k < 4; k++)
      this.actors.push({ id: k, alive: true, c: 0, r: 0, tc: 0, tr: 0, p: 0, dir: -1, face: 2, speed: BASE_SPEED, maxBombs: 1, power: 1, wins: 0, killer: -1, deadAt: 0, think: 0 });
    this.newRound();
  }

  // ---- setup ----
  newRound() {
    const rng = this.rng;
    this.bombs = [];
    this.flame.fill(0);
    this.flameKind.fill(0);
    this.item.fill(0);
    this.hidden.fill(0);
    const crateChance = Math.min(80, 66 + this.level * 3);
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const i = r * COLS + c;
        this.grid[i] = EMPTY;
        if (c % 2 === 1 && r % 2 === 1) {
          this.grid[i] = PILLAR;
          continue;
        }
        let nearSpawn = false;
        for (const [sc, sr] of SPAWNS) if (Math.abs(sc - c) + Math.abs(sr - r) <= 1) nearSpawn = true;
        if (nearSpawn) continue;
        if (rng.int(100) < crateChance) {
          this.grid[i] = CRATE;
          if (rng.int(100) < 34) {
            const k = rng.int(10);
            this.hidden[i] = k < 4 ? ITEM_BOMB : k < 8 ? ITEM_FIRE : ITEM_SPEED;
          }
        }
      }
    for (let k = 0; k < 4; k++) {
      const a = this.actors[k];
      const [sc, sr] = SPAWNS[k];
      const bot = k > 0;
      Object.assign(a, {
        alive: true, c: sc, r: sr, tc: sc, tr: sr, p: 0, dir: -1, face: 2,
        speed: BASE_SPEED + (bot && this.level >= 4 ? 1 : 0),
        maxBombs: 1 + (bot && this.level >= 3 ? 1 : 0),
        power: 1 + (bot && this.level >= 1 ? 1 : 0),
        killer: -1, deadAt: 0, think: 20 + k * 6,
      });
    }
    this.queued = -1;
    this.queuedTTL = 0;
    this.glide = -1;
    this.roundT = 0;
    this.closeIdx = 0;
    this.closedAt.fill(0);
    this.roundWinner = -1;
    this.phase = "intro";
    this.phaseT = 0;
    this.events.push({ t: "roundStart", round: this.round, match: this.match, sfx: "launch" });
  }

  // ---- helpers ----
  occ(a: Actor) {
    return a.dir >= 0 && a.p >= SUB / 2 ? a.tr * COLS + a.tc : a.r * COLS + a.c;
  }
  bombAt(i: number) {
    for (const b of this.bombs) if (!b.done && b.r * COLS + b.c === i) return b;
    return null;
  }
  activeBombs(owner: number) {
    let n = 0;
    for (const b of this.bombs) if (!b.done && b.owner === owner) n++;
    return n;
  }
  canEnter(a: Actor, d: number) {
    const nc = a.c + DIRS[d].dx;
    const nr = a.r + DIRS[d].dy;
    if (!inside(nc, nr)) return false;
    const i = nr * COLS + nc;
    return this.grid[i] === EMPTY && !this.bombAt(i);
  }
  private start(a: Actor, d: number) {
    a.face = d;
    if (!this.canEnter(a, d)) return false;
    a.dir = d;
    a.tc = a.c + DIRS[d].dx;
    a.tr = a.r + DIRS[d].dy;
    return true;
  }
  cx(i: number) {
    return OX + ((i % COLS) + 0.5) * CELL;
  }
  cy(i: number) {
    return OY + (Math.floor(i / COLS) + 0.5) * CELL;
  }

  planBoard(): PlanBoard {
    return {
      grid: this.grid,
      flame: this.flame,
      item: this.item,
      bombs: this.bombs.filter((b) => !b.done),
      actors: this.actors.map((a) => ({
        alive: a.alive,
        c: a.dir >= 0 ? a.tc : a.c,
        r: a.dir >= 0 ? a.tr : a.r,
        power: a.power,
        bombsLeft: a.maxBombs - this.activeBombs(a.id),
        speed: a.speed,
      })),
      soon: this.soonList(),
    };
  }

  /** The next few sudden-death cells with frames until they close. */
  soonList(): { i: number; t: number }[] {
    const out: { i: number; t: number }[] = [];
    for (let k = 0; k < 8 && this.closeIdx + k < CLOSE_ORDER.length; k++) {
      const due = HURRY_AT + (this.closeIdx + k + 1) * CLOSE_EVERY;
      const t = due - this.roundT;
      if (t > 240) break;
      out.push({ i: CLOSE_ORDER[this.closeIdx + k], t: Math.max(0, t) });
    }
    return out;
  }

  private suddenDeath() {
    if (this.roundT === HURRY_AT) this.events.push({ t: "hurry", sfx: "extraBad", shake: 4 });
    if (this.roundT <= HURRY_AT || (this.roundT - HURRY_AT) % CLOSE_EVERY !== 0 || this.closeIdx >= CLOSE_ORDER.length) return;
    const i = CLOSE_ORDER[this.closeIdx++];
    this.grid[i] = PILLAR;
    this.hidden[i] = 0;
    this.item[i] = 0;
    this.closedAt[i] = this.frame;
    for (const b of this.bombs) if (!b.done && b.r * COLS + b.c === i) b.done = true;
    this.bombs = this.bombs.filter((b) => !b.done);
    this.events.push({ t: "close", sfx: "wall", shake: 2, x: this.cx(i), y: this.cy(i) });
    for (const a of this.actors) {
      if (!a.alive) continue;
      if (this.occ(a) === i) this.kill(a, -1);
      else if (a.dir >= 0 && a.tr * COLS + a.tc === i) {
        // Still on its own half of the move: bounce back.
        a.dir = -1;
        a.p = 0;
      }
    }
  }

  dropBomb(a: Actor) {
    const i = this.occ(a);
    if (this.grid[i] !== EMPTY || this.bombAt(i) || this.activeBombs(a.id) >= a.maxBombs) return false;
    this.bombs.push({ id: ++this.bombId, c: i % COLS, r: Math.floor(i / COLS), owner: a.id, timer: BOMB_T, power: a.power, done: false });
    this.events.push({ t: "drop", owner: a.id, sfx: a.id === 0 ? "paddle" : undefined, x: this.cx(i), y: this.cy(i) });
    return true;
  }

  // ---- step ----
  step(inp: Input) {
    this.frame++;
    this.events = [];
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    if (this.phase === "over") return;
    this.phaseT++;
    if (this.phase === "intro") {
      this.readControls(inp.b, pressed, released);
      if (this.phaseT >= INTRO_T) {
        this.phase = "play";
        this.phaseT = 0;
        this.events.push({ t: "go", sfx: "launch" });
      }
      return;
    }
    if (this.phase === "roundEnd") {
      this.updateFlames();
      this.updateBombs();
      if (this.phaseT >= END_T) this.afterRound();
      return;
    }
    // play
    this.roundT++;
    this.updateFlames();
    this.updateBombs();
    this.suddenDeath();
    this.readControls(inp.b, pressed, released);
    const me = this.actors[0];
    if (me.alive && pressed & BTN.FIRE) this.dropBomb(me);
    if (me.alive) this.moveActor(me, () => this.humanWant(me));
    const sk = skillFor(this.level);
    for (let k = 1; k < 4; k++) {
      const a = this.actors[k];
      if (!a.alive || this.freezeBots) continue;
      this.moveActor(a, () => this.botWant(a, sk));
    }
    this.checkDeaths();
    this.checkRoundEnd();
  }

  private readControls(b: number, pressed: number, released: number) {
    if (this.queuedTTL > 0 && --this.queuedTTL === 0) this.queued = -1;
    const me = this.actors[0];
    for (let d = 0; d < 4; d++) {
      if (!(pressed & DIRS[d].b)) continue;
      this.queued = d;
      this.queuedTTL = 24;
      this.glide = d;
      this.holdDir = d;
      this.holdFrames = 0;
      // Instant reversal mid-move.
      if (me.alive && this.phase === "play" && me.dir >= 0 && d === (me.dir + 2) % 4 && me.p > 0) {
        [me.c, me.tc] = [me.tc, me.c];
        [me.r, me.tr] = [me.tr, me.r];
        me.p = SUB - me.p;
        me.dir = d;
        me.face = d;
        this.queued = -1;
      }
    }
    if (this.holdDir >= 0) {
      if (b & DIRS[this.holdDir].b) this.holdFrames++;
      else if (released & DIRS[this.holdDir].b) {
        // A long hold is walking: stop at the next cell. A short pulse (swipe) glides.
        if (this.holdFrames > TAP_FRAMES && this.glide === this.holdDir) this.glide = -1;
        this.holdDir = -1;
      }
    }
  }

  private heldDir(b: number) {
    if (this.holdDir >= 0 && b & DIRS[this.holdDir].b && this.holdFrames > TAP_FRAMES) return this.holdDir;
    for (let d = 0; d < 4; d++) if (b & DIRS[d].b && this.holdFrames > TAP_FRAMES) return d;
    return -1;
  }

  private humanWant(a: Actor): number {
    if (this.queued >= 0 && this.canEnter(a, this.queued)) {
      const d = this.queued;
      this.queued = -1;
      this.queuedTTL = 0;
      if (this.glide >= 0) this.glide = d;
      return d;
    }
    const h = this.heldDir(this.prevB);
    if (h >= 0) {
      if (this.canEnter(a, h)) return h;
      a.face = h;
    }
    if (this.glide >= 0) {
      if (this.canEnter(a, this.glide)) return this.glide;
      this.glide = -1;
    }
    return -1;
  }

  private botWant(a: Actor, sk: Skill): number {
    const board = this.planBoard();
    const start = a.r * COLS + a.c;
    const roll = () => this.rng.int(100);
    if (a.think > 0) {
      a.think--;
      const dg = dangerMap(board, null);
      if (dg.t[start] === INF) return -1;
    }
    let plan = planStep(board, a.id, sk, roll);
    if (plan.bomb) {
      if (this.dropBomb(a)) plan = planStep(this.planBoard(), a.id, sk, roll);
      else plan = { dir: -1, bomb: false };
    }
    if (plan.dir < 0) a.think = Math.max(3, 24 - 7 * this.level);
    return plan.dir;
  }

  private moveActor(a: Actor, want: () => number) {
    if (a.dir >= 0) {
      a.p += a.speed;
      if (a.p < SUB) return;
      const left = a.p - SUB;
      a.c = a.tc;
      a.r = a.tr;
      a.p = 0;
      a.dir = -1;
      this.arrive(a);
      const d = want();
      if (d >= 0 && this.start(a, d)) a.p = left;
      return;
    }
    const d = want();
    if (d >= 0) this.start(a, d);
  }

  private arrive(a: Actor) {
    const i = a.r * COLS + a.c;
    const it = this.item[i];
    if (!it) return;
    this.item[i] = 0;
    if (it === ITEM_BOMB) a.maxBombs = Math.min(MAX_BOMBS, a.maxBombs + 1);
    else if (it === ITEM_FIRE) a.power = Math.min(MAX_POWER, a.power + 1);
    else a.speed = Math.min(MAX_SPEED, a.speed + 1);
    const mine = a.id === 0;
    if (mine) this.score += SCORE.item;
    this.events.push({ t: "pickup", who: a.id, kind: it, pts: mine ? SCORE.item : 0, sfx: mine ? "extraGood" : undefined, mood: mine ? "happy" : undefined, x: this.cx(i), y: this.cy(i) });
  }

  private updateFlames() {
    for (let i = 0; i < N; i++) {
      if (this.flame[i] === 0) continue;
      if (--this.flame[i] === 0) {
        this.flameKind[i] = 0;
        if (this.grid[i] === BURNING) {
          this.grid[i] = EMPTY;
          this.item[i] = this.hidden[i];
          this.hidden[i] = 0;
          if (this.item[i]) this.events.push({ t: "reveal", kind: this.item[i], x: this.cx(i), y: this.cy(i) });
        }
      }
    }
  }

  private setFlame(i: number, owner: number, kind: number) {
    if (this.flame[i] === 0) this.flameKind[i] = 0;
    this.flame[i] = FLAME_T;
    this.flameOwner[i] = owner;
    this.flameKind[i] |= kind;
  }

  private updateBombs() {
    const queue: Bomb[] = [];
    for (const b of this.bombs) if (--b.timer <= 0) queue.push(b);
    let count = 0;
    let crates = 0;
    while (queue.length) {
      const b = queue.shift()!;
      if (b.done) continue;
      b.done = true;
      count++;
      crates += this.explode(b, queue);
      const i = b.r * COLS + b.c;
      this.events.push({ t: "boom", owner: b.owner, power: b.power, x: this.cx(i), y: this.cy(i) });
    }
    if (count) {
      this.bombs = this.bombs.filter((b) => !b.done);
      this.events.push({ t: "blast", n: count, sfx: "explode", shake: Math.min(12, 4 + count * 2) });
      if (crates) this.events.push({ t: "crates", n: crates, sfx: "brickgone" });
    }
  }

  private explode(b: Bomb, queue: Bomb[]): number {
    let crates = 0;
    this.setFlame(b.r * COLS + b.c, b.owner, 3);
    for (let d = 0; d < 4; d++) {
      const kind = d % 2 === 0 ? 2 : 1;
      for (let k = 1; k <= b.power; k++) {
        const nc = b.c + DIRS[d].dx * k;
        const nr = b.r + DIRS[d].dy * k;
        if (!inside(nc, nr)) break;
        const i = nr * COLS + nc;
        const g = this.grid[i];
        if (g === PILLAR) break;
        this.setFlame(i, b.owner, kind);
        if (g === CRATE) {
          this.grid[i] = BURNING;
          crates++;
          const mine = b.owner === 0;
          if (mine) this.score += SCORE.crate;
          this.events.push({ t: "crate", pts: mine ? SCORE.crate : 0, x: this.cx(i), y: this.cy(i) });
          break;
        }
        if (g === BURNING) break;
        const other = this.bombAt(i);
        if (other) {
          other.timer = 0;
          queue.push(other);
          break;
        }
        if (this.item[i]) {
          this.item[i] = 0;
          this.events.push({ t: "itemBurn", x: this.cx(i), y: this.cy(i) });
        }
      }
    }
    return crates;
  }

  private checkDeaths() {
    for (const a of this.actors) {
      if (!a.alive) continue;
      const i = this.occ(a);
      if (this.flame[i] === 0) continue;
      this.kill(a, this.flameOwner[i]);
    }
  }

  private kill(a: Actor, killer: number) {
    a.alive = false;
      a.killer = killer;
      a.deadAt = this.frame;
      const x = OX + (a.c + ((a.tc - a.c) * a.p) / SUB + 0.5) * CELL;
      const y = OY + (a.r + ((a.tr - a.r) * a.p) / SUB + 0.5) * CELL;
      if (a.id === 0) {
        this.events.push({ t: "out", who: 0, killer: a.killer, sfx: "lost", mood: "sad", toast: "lifeLost", shake: 10, x, y });
      } else {
        const byMe = a.killer === 0;
        if (byMe) this.score += SCORE.kill;
        this.events.push({ t: "out", who: a.id, killer: a.killer, pts: byMe ? SCORE.kill : 0, sfx: "brick", mood: byMe ? "happy" : undefined, shake: 6, x, y });
      }
  }

  private checkRoundEnd() {
    const alive = this.actors.filter((a) => a.alive);
    const me = this.actors[0];
    if (this.roundT >= ROUND_T) return this.endRound(-1);
    if (me.alive && alive.length > 1) return;
    if (me.alive) return this.endRound(0);
    if (alive.length === 0) return this.endRound(-1);
    if (alive.length === 1) return this.endRound(alive[0].id);
    // The player is out while several rivals stand: the one who got the player takes it.
    const k = this.actors[me.killer];
    if (k && k.id !== 0 && k.alive) return this.endRound(k.id);
    return this.endRound(alive[0].id);
  }

  private endRound(winner: number) {
    this.phase = "roundEnd";
    this.phaseT = 0;
    this.roundWinner = winner;
    this.matchWon = false;
    this.matchLost = false;
    if (winner >= 0) this.actors[winner].wins++;
    if (winner === 0) {
      this.score += SCORE.round;
      if (this.actors[0].wins >= WINS_NEEDED) {
        const bonus = SCORE.match * this.match;
        this.score += bonus;
        this.matchWon = true;
        this.matchesWon++;
        this.events.push({ t: "matchWon", pts: SCORE.round + bonus, sfx: "won", mood: "happy", toast: "levelClear" });
      } else this.events.push({ t: "roundWon", pts: SCORE.round, sfx: "levelclear", mood: "happy" });
    } else if (winner > 0 && this.actors[winner].wins >= WINS_NEEDED) {
      this.matchLost = true;
      this.events.push({ t: "matchLost", who: winner, sfx: "gameover", mood: "sad" });
    } else this.events.push({ t: "roundLost", who: winner, sfx: winner < 0 ? "extraBad" : undefined });
  }

  private afterRound() {
    if (this.matchLost) {
      this.phase = "over";
      return;
    }
    if (this.matchWon) {
      this.match++;
      this.level++;
      this.round = 1;
      for (const a of this.actors) a.wins = 0;
    } else this.round++;
    this.matchWon = false;
    this.newRound();
  }

  // ---- outputs ----
  view(): BomberView {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      match: this.match,
      round: this.round,
      level: this.level,
      grid: Array.from(this.grid),
      flame: Array.from(this.flame),
      flameKind: Array.from(this.flameKind),
      item: Array.from(this.item),
      bombs: this.bombs.map((b) => ({ ...b })),
      actors: this.actors.map((a) => ({ ...a, bombsLeft: a.maxBombs - this.activeBombs(a.id) })),
      score: this.score,
      timeLeft: Math.max(0, ROUND_T - this.roundT),
      hurry: this.roundT >= HURRY_AT,
      closedAt: Array.from(this.closedAt),
      nextClose: CLOSE_ORDER.slice(this.closeIdx, this.closeIdx + 3),
      soon: this.soonList(),
      roundWinner: this.roundWinner,
      matchWon: this.matchWon,
      matchLost: this.matchLost,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.match, label: `Round ${this.round} · ${this.actors[0].wins}/${WINS_NEEDED} wins` };
  }
  result(): GameResult {
    return { score: this.score, level: this.match - 1, levelsCleared: this.matchesWon, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

// ---- autoplayer: the same planner as the rivals, slightly sloppier ----
function hash(n: number) {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}
const BOT_SKILL: Skill = { margin: 2, reckless: 3, wander: 4, aggro: 40 };

function bomberBot(v: BomberView, frame: number): Input {
  const idle = { x: 0, y: 0, b: 0 };
  if (v.phase !== "play") return idle;
  const me = v.actors[0];
  if (!me.alive) return idle;
  const board: PlanBoard = {
    grid: v.grid,
    flame: v.flame,
    item: v.item,
    bombs: v.bombs,
    soon: v.soon,
    actors: v.actors.map((a) => ({ alive: a.alive, c: a.dir >= 0 ? a.tc : a.c, r: a.dir >= 0 ? a.tr : a.r, power: a.power, bombsLeft: a.bombsLeft, speed: a.speed })),
  };
  let k = 0;
  const roll = () => hash(frame * 7 + k++) % 100;
  const plan = planStep(board, 0, BOT_SKILL, roll);
  let b = 0;
  // Bombs land on the cell we occupy; only fire once that is the plan cell.
  if (plan.bomb && (me.dir < 0 || me.p >= SUB / 2) && frame % 2 === 0) b |= BTN.FIRE;
  if (plan.dir >= 0) b |= DIRS[plan.dir].b;
  return { x: 0, y: 0, b };
}

export const bomber: GameDef<BomberView> = {
  id: "bomber",
  name: "Blast Grid",
  tagline: "Drop coin-bombs, crack crates, outlast the bear, the ghost and the rug.",
  genre: "Bomb arena",
  session: "3–10 min",
  controls: "Arrows / WASD to walk, Space to drop a coin-bomb. Touch: swipe to glide, tap to drop a bomb.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true, touchMap: { tap: BTN.FIRE } },
  maxFrames: 30 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original grid bomb-arena design and code. Original arena generation, coin-bombs, rivals (bear, ghost, rug), danger-map AI, power-ups, scoring and match ladder. No code, characters, sounds, layouts or art from any commercial game.",
  },
  create: (seed) => new BomberEngine(seed),
  bot: bomberBot,
};
