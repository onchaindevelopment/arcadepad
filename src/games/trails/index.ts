/*
 * Light Trails: original light-cycle arena game for ArcadePad.
 * ArcadePad, GPL-3.0-or-later.
 *
 * Rules: you and 3-5 CPU riders move continuously on a grid, each leaving a
 * solid trail. Hitting a wall or any trail (yours included) knocks you out;
 * two riders entering the same cell on the same step both crash. Be the last
 * rider standing to win the round. The run is a ladder: each round won is
 * worth 500 and the next round is faster with more CPUs (3, 3, 4, 4, then 5).
 * One lost round ends the run. Survival time also scores (10 per second).
 *
 * Controls (one scheme, everywhere): LEFT / RIGHT turn relative to the way
 * you are heading (arrow keys or A/D, swipe left / right on touch). Boost
 * while holding FIRE (Space / mouse button), ALT (X / Shift) or UP; any press
 * of those (including a tap or a swipe up on touch) starts a short boost
 * burst. Boost drains a meter that refills while you cruise.
 *
 * CPU riders: deterministic lookahead. Each cell they score straight / left /
 * right by flood-filling the free space behind each option (capped by a
 * look-ahead budget that grows with the round), the straight corridor length,
 * head-on danger and, from round 2, cutting in front of the player. Mistakes
 * are level-scaled: a small look-ahead budget early on (they walk into
 * pockets) and an occasional seeded blunder that fades with the rounds.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const CELL = 6;
export const COLS = 58;
export const ROWS = 92;
/** Arena origin in field pixels. */
export const OX = 6;
export const OY = 36;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const ROUND_SCORE = 500;
export const METER_MAX = 1000;
const METER_DRAIN = 10;
const METER_FILL = 3;
const BURST = 30; // frames of boost from a single press
const COUNT_FRAMES = 120;
const BETWEEN_FRAMES = 100;
const MAX_CPUS = 5;

/** Spawn slots: [col, row, dir]. Player first, then the CPU slots in order of appearance. */
const PLAYER_SPAWN = [29, 80, 0] as const;
const CPU_SLOTS: readonly (readonly [number, number, number])[] = [
  [22, 10, 2],
  [5, 40, 1],
  [52, 52, 3],
  [50, 76, 0],
  [8, 16, 2],
];

export function cpusForRound(round: number): number {
  return Math.min(MAX_CPUS, 3 + (round >> 1));
}
/** Speed in 1/256 cell per frame (64 = one cell every 4 frames). */
export function speedForRound(round: number): number {
  return Math.min(150, 64 + round * 8);
}

export type Phase = "count" | "run" | "between" | "over";

export interface RiderView {
  x: number;
  y: number;
  dir: number;
  alive: boolean;
  boost: boolean;
  /** 0..1 progress towards the next cell (for smooth heads). */
  t: number;
  /** Colour slot: 0 = player, 1.. = CPUs. */
  color: number;
  cpu: boolean;
}

export interface TrailsView {
  frame: number;
  phase: Phase;
  /** Frames left in the current count / between phase. */
  phaseT: number;
  round: number;
  roundsWon: number;
  score: number;
  /** Player boost meter 0..METER_MAX. */
  meter: number;
  /** Player turns waiting for the next cell. */
  queued: number;
  /** Cells: 0 empty, otherwise colour slot + 1 of the owner. Shared buffer, valid until the next step. */
  grid: Uint8Array;
  riders: RiderView[];
}

interface Rider {
  x: number;
  y: number;
  dir: number;
  alive: boolean;
  prog: number;
  boost: boolean;
  boostT: number;
  meter: number;
  color: number;
  cpu: boolean;
}

/** Reusable bounded flood fill over free cells. */
export class Filler {
  private stamp = new Uint32Array(COLS * ROWS);
  private q = new Int32Array(COLS * ROWS);
  private cur = 0;

  /** Free cells reachable from (x, y) (itself included), stopping at cap. */
  fill(grid: Uint8Array, x: number, y: number, cap: number): number {
    if (++this.cur >= 0xffffffff) {
      this.stamp.fill(0);
      this.cur = 1;
    }
    const st = this.stamp;
    const id = this.cur;
    let head = 0;
    let tail = 0;
    const s = y * COLS + x;
    st[s] = id;
    this.q[tail++] = s;
    let n = 0;
    while (head < tail && n < cap) {
      const c = this.q[head++];
      n++;
      const cx = c % COLS;
      if (cx > 0 && grid[c - 1] === 0 && st[c - 1] !== id) { st[c - 1] = id; this.q[tail++] = c - 1; }
      if (cx < COLS - 1 && grid[c + 1] === 0 && st[c + 1] !== id) { st[c + 1] = id; this.q[tail++] = c + 1; }
      if (c >= COLS && grid[c - COLS] === 0 && st[c - COLS] !== id) { st[c - COLS] = id; this.q[tail++] = c - COLS; }
      if (c < COLS * (ROWS - 1) && grid[c + COLS] === 0 && st[c + COLS] !== id) { st[c + COLS] = id; this.q[tail++] = c + COLS; }
    }
    return n;
  }
}

export function freeCell(grid: Uint8Array, x: number, y: number): boolean {
  return x >= 0 && x < COLS && y >= 0 && y < ROWS && grid[y * COLS + x] === 0;
}

/** Free cells straight ahead from (x, y) heading dir, up to max. (x, y) itself not counted. */
export function corridor(grid: Uint8Array, x: number, y: number, dir: number, max: number): number {
  let n = 0;
  while (n < max) {
    x += DX[dir];
    y += DY[dir];
    if (!freeCell(grid, x, y)) break;
    n++;
  }
  return n;
}

export interface Option {
  rel: number; // -1 left, 0 straight, 1 right
  dir: number;
  x: number;
  y: number;
  free: boolean;
  area: number;
  run: number;
}

/** Look-ahead for straight / left / right from a head. */
export function options(grid: Uint8Array, filler: Filler, x: number, y: number, dir: number, cap: number): Option[] {
  const out: Option[] = [];
  for (const rel of [0, -1, 1]) {
    const d = (dir + rel + 4) & 3;
    const nx = x + DX[d];
    const ny = y + DY[d];
    const free = freeCell(grid, nx, ny);
    out.push({ rel, dir: d, x: nx, y: ny, free, area: free ? filler.fill(grid, nx, ny, cap) : 0, run: free ? corridor(grid, nx, ny, d, 12) : 0 });
  }
  return out;
}

class TrailsEngine implements GameEngine<TrailsView> {
  private rng: Rng;
  private filler = new Filler();
  private grid = new Uint8Array(COLS * ROWS);
  private riders: Rider[] = [];
  private queue: number[] = [];
  private prevB = 0;
  private burst = 0;
  private phase: Phase = "count";
  private phaseT = COUNT_FRAMES;
  private round = 0;
  private roundsWon = 0;
  private survival = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.setupRound(0);
  }

  private setupRound(round: number) {
    this.round = round;
    this.grid.fill(0);
    this.queue = [];
    this.burst = 0;
    const meter = this.riders.length ? Math.max(this.riders[0].meter, METER_MAX / 2) : METER_MAX;
    this.riders = [];
    const add = (x: number, y: number, dir: number, color: number, cpu: boolean) => {
      this.riders.push({ x, y, dir, alive: true, prog: 0, boost: false, boostT: 0, meter: cpu ? METER_MAX : meter, color, cpu });
      this.grid[y * COLS + x] = color + 1;
    };
    add(PLAYER_SPAWN[0], PLAYER_SPAWN[1], PLAYER_SPAWN[2], 0, false);
    const n = cpusForRound(round);
    // Seeded choice of which slots are used when fewer than all five ride.
    const slots = [0, 1, 2, 3, 4];
    for (let i = slots.length - 1; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const tmp = slots[i];
      slots[i] = slots[j];
      slots[j] = tmp;
    }
    const used = slots.slice(0, n).sort((a, b) => a - b);
    for (const s of used) add(CPU_SLOTS[s][0], CPU_SLOTS[s][1], CPU_SLOTS[s][2], s + 1, true);
    this.phase = "count";
    this.phaseT = COUNT_FRAMES;
    this.events.push({ t: "round", round, cpus: n });
  }

  private px(r: Rider) {
    return { x: OX + r.x * CELL + CELL / 2, y: OY + r.y * CELL + CELL / 2 };
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    const me = this.riders[0];

    if (this.phase !== "between") {
      if (pressed & BTN.LEFT && this.queue.length < 2) {
        this.queue.push(-1);
        this.events.push({ t: "turn", rel: -1 });
      }
      if (pressed & BTN.RIGHT && this.queue.length < 2) {
        this.queue.push(1);
        this.events.push({ t: "turn", rel: 1 });
      }
    }
    const boostBits = BTN.FIRE | BTN.ALT | BTN.UP;
    if (pressed & boostBits) this.burst = BURST;
    const wantBoost = (inp.b & boostBits) !== 0 || this.burst > 0;
    if (this.burst > 0) this.burst--;

    if (this.phase === "count") {
      this.phaseT--;
      if (this.phaseT === 80 || this.phaseT === 40) this.events.push({ t: "count", n: this.phaseT / 40, sfx: "wall" });
      if (this.phaseT <= 0) {
        this.phase = "run";
        this.events.push({ t: "go", sfx: "launch" });
      }
      return;
    }
    if (this.phase === "between") {
      if (--this.phaseT <= 0) this.setupRound(this.round + 1);
      return;
    }

    // Running.
    this.survival++;
    const base = speedForRound(this.round);
    const movers: Rider[] = [];
    for (const r of this.riders) {
      if (!r.alive) continue;
      const want = r.cpu ? r.boostT > 0 : wantBoost;
      if (r.cpu && r.boostT > 0) r.boostT--;
      const was = r.boost;
      r.boost = want && r.meter > 0;
      if (r.boost) r.meter = Math.max(0, r.meter - METER_DRAIN);
      else if (!want) r.meter = Math.min(METER_MAX, r.meter + METER_FILL);
      if (r.boost && !was && !r.cpu) this.events.push({ t: "boost", sfx: "shot" });
      const sp = Math.min(250, r.boost ? base + Math.floor((base * 3) / 5) : base);
      r.prog += sp;
      if (r.prog >= 256) {
        r.prog -= 256;
        movers.push(r);
      }
    }
    if (!movers.length) return;

    // Choose directions (all against the grid as it was before this step).
    for (const r of movers) {
      if (r.cpu) this.decide(r, me);
      else if (this.queue.length) r.dir = (r.dir + this.queue.shift()! + 4) & 3;
    }
    const tx = movers.map((r) => r.x + DX[r.dir]);
    const ty = movers.map((r) => r.y + DY[r.dir]);
    const dies = movers.map((_, i) => !freeCell(this.grid, tx[i], ty[i]));
    for (let i = 0; i < movers.length; i++)
      for (let j = i + 1; j < movers.length; j++)
        if (tx[i] === tx[j] && ty[i] === ty[j]) dies[i] = dies[j] = true;

    const playerDies = movers.some((r, i) => !r.cpu && dies[i]);
    for (let i = 0; i < movers.length; i++) {
      const r = movers[i];
      if (dies[i]) {
        r.alive = false;
        r.boost = false;
        const p = this.px(r);
        if (r.cpu) this.events.push({ t: "crash", color: r.color, x: p.x, y: p.y, sfx: "explode", shake: 4, mood: playerDies ? undefined : "happy" });
        else this.events.push({ t: "die", color: 0, x: p.x, y: p.y, sfx: "lost", mood: "sad", shake: 10 });
      } else {
        r.x = tx[i];
        r.y = ty[i];
        this.grid[r.y * COLS + r.x] = r.color + 1;
      }
    }

    if (!me.alive) {
      this.phase = "over";
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    if (!this.riders.some((r) => r.cpu && r.alive)) {
      this.roundsWon++;
      this.phase = "between";
      this.phaseT = BETWEEN_FRAMES;
      const p = this.px(me);
      this.events.push({ t: "roundwon", round: this.round, x: p.x, y: p.y, sfx: "levelclear", toast: "levelClear", mood: "happy" });
    }
  }

  /** CPU look-ahead with level-scaled mistakes. */
  private decide(r: Rider, me: Rider) {
    const round = this.round;
    const cap = Math.min(700, 30 + 50 * round);
    const opts = options(this.grid, this.filler, r.x, r.y, r.dir, cap);
    const free = opts.filter((o) => o.free);
    if (!free.length) return; // doomed, keep going
    const blunder = Math.max(6, 80 - round * 12); // per mille, per cell
    let pick: Option;
    if (this.rng.int(1000) < blunder) {
      pick = free[this.rng.int(free.length)];
    } else {
      const aggr = me.alive && round >= 1 ? Math.min(4, round) : 0;
      const tgx = me.x + DX[me.dir] * 5;
      const tgy = me.y + DY[me.dir] * 5;
      let best = -Infinity;
      pick = free[0];
      for (const o of free) {
        let s = Math.min(o.area, cap) * 1000 + Math.min(o.run, 10) * 6 + (o.rel === 0 ? 8 : 0) + this.rng.int(5);
        for (const q of this.riders) {
          if (q === r || !q.alive) continue;
          if (Math.abs(q.x - o.x) + Math.abs(q.y - o.y) === 1) s -= 400;
        }
        if (aggr) s -= (Math.abs(o.x - tgx) + Math.abs(o.y - tgy)) * aggr;
        if (s > best) {
          best = s;
          pick = o;
        }
      }
    }
    r.dir = pick.dir;
    if (round >= 2 && r.boostT === 0 && r.meter >= 400 && pick.run >= 10 && this.rng.int(100) < 3) r.boostT = 30;
  }

  private score() {
    return this.roundsWon * ROUND_SCORE + Math.floor(this.survival / 6);
  }

  view(): TrailsView {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      round: this.round,
      roundsWon: this.roundsWon,
      score: this.score(),
      meter: this.riders[0].meter,
      queued: this.queue.length,
      grid: this.grid,
      riders: this.riders.map((r) => ({ x: r.x, y: r.y, dir: r.dir, alive: r.alive, boost: r.boost, t: r.prog / 256, color: r.color, cpu: r.cpu })),
    };
  }
  hud(): Hud {
    const left = this.riders.filter((r) => r.cpu && r.alive).length;
    return { score: this.score(), level: this.round + 1, label: `${left} rival${left === 1 ? "" : "s"} left` };
  }
  result(): GameResult {
    return { score: this.score(), level: this.round, levelsCleared: this.roundsWon, frames: this.frame, status: this.phase === "over" ? "over" : "playing" };
  }
  get done() {
    return this.phase === "over";
  }
}

let botFiller: Filler | null = null;

export const trails: GameDef<TrailsView> = {
  id: "trails",
  name: "Light Trails",
  tagline: "Ride, box them in, be the last light on the grid.",
  genre: "Light-cycle arena",
  session: "1–5 min",
  controls: "Left/Right (or swipe) turn relative to your heading. Hold Space/X/Up or tap to boost.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: true, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the light-cycle genre: rules, CPU flood-fill AI, boost meter and round ladder written from scratch. No code, art or sound from any existing game.",
  },
  create: (seed) => new TrailsEngine(seed),
  bot(v, frame) {
    // Short-sighted flood-fill rider: decent, but its small look-ahead walks it into pockets.
    const me = v.riders[0];
    if (!me || !me.alive || v.phase === "over" || v.phase === "between") return { x: 0, y: 0, b: 0 };
    botFiller ??= new Filler();
    const opts = options(v.grid, botFiller, me.x, me.y, me.dir, 160);
    const straight = opts[0];
    const boost = v.phase === "run" && v.meter > 700 && straight.run >= 12 && straight.area >= 160 ? BTN.ALT : 0;
    if (frame & 1 || v.queued > 0) return { x: 0, y: 0, b: boost };
    let best = opts[0];
    let bs = -Infinity;
    for (const o of opts) {
      if (!o.free) continue;
      const s = o.area * 1000 + Math.min(o.run, 8) * 6 + (o.rel === 0 ? 10 : 0) + ((frame >> 5) % 3 === o.rel + 1 ? 3 : 0);
      if (s > bs) {
        bs = s;
        best = o;
      }
    }
    const b = best.rel < 0 ? BTN.LEFT : best.rel > 0 ? BTN.RIGHT : 0;
    return { x: 0, y: 0, b: b | boost };
  },
};
