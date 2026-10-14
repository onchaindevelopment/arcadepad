/*
 * Turf Paint: an original territory-capture game for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original design and code (no ported source).
 *
 * The genre mechanic is used (own a patch of an 80x80 grid; leave it to draw
 * a trail; come home to claim the loop and everything it encloses; anyone who
 * runs over your trail while you are out ends you), single player against six
 * deterministic bots. Run ends when you are caught or after three minutes.
 * Score = share of the map (tenths of a percent x10) + 100 per knock-out.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const COLS = 80;
export const ROWS = 80;
export const NCELLS = COLS * ROWS;
/** World pixels per cell (the renderer draws at this scale). */
export const CELL = 12;
/** Field (screen) size; the camera keeps the player at the centre. */
export const W = 360;
export const H = 600;
/** Movement sub-steps per cell. */
export const SUB = 120;
export const BOTS = 6;
export const RUN_FRAMES = 3 * 60 * 60;
const PLAYER_SPEED = 14; // ~7 cells/s
const BOT_SPEED = 12; // ~6 cells/s
const AUTO_START = 90;
const RESPAWN = 240;
const START_R = 2; // start patch is (2R+1)^2
const EARLY_TURN = SUB / 4; // turns this early in a cell apply at once
const PTR_DWELL = 6; // pointer must rest this many frames before it steers
const PTR_DEAD = 18; // pointer dead zone around the player
const KILL_POINTS = 100;

/** 0 up, 1 right, 2 down, 3 left. */
export const DIRS = [
  { b: BTN.UP, dx: 0, dy: -1 },
  { b: BTN.RIGHT, dx: 1, dy: 0 },
  { b: BTN.DOWN, dx: 0, dy: 1 },
  { b: BTN.LEFT, dx: -1, dy: 0 },
];

export function nextCell(cell: number, d: number): number {
  const c = (cell % COLS) + DIRS[d].dx;
  const r = ((cell / COLS) | 0) + DIRS[d].dy;
  return c < 0 || c >= COLS || r < 0 || r >= ROWS ? -1 : r * COLS + c;
}

export interface ActorView {
  id: number;
  alive: boolean;
  cell: number;
  c: number;
  r: number;
  dir: number;
  /** 0..1 progress towards the next cell. */
  t: number;
  trailLen: number;
  cells: number;
  kills: number;
  legA: number;
  legB: number;
  side: number;
  outDir: number;
  aggr: number;
}

export interface TurfView {
  frame: number;
  started: boolean;
  timeLeft: number;
  /** Owner id per cell (-1 = nobody); live reference, valid until the next step. */
  owner: Int8Array;
  /** Trail owner id per cell (-1 = none); live reference. */
  trail: Int8Array;
  /** actors[0] is the player. */
  actors: ActorView[];
  /** Player share in tenths of a percent. */
  pct10: number;
  score: number;
  dead: boolean;
  timeUp: boolean;
}

/* ---------------- shared AI (engine bots and the attract-mode bot) ---------------- */

export interface AiActor {
  id: number;
  dir: number;
  trailLen: number;
  legA: number;
  legB: number;
  side: number;
  outDir: number;
  aggr: number;
  /** Head home when an enemy head is this close (Manhattan cells). */
  caution: number;
}

export interface Scratch {
  q: Int32Array;
  seen: Int32Array;
  first: Int8Array;
  gen: number;
}
export function makeScratch(): Scratch {
  return { q: new Int32Array(NCELLS), seen: new Int32Array(NCELLS), first: new Int8Array(NCELLS), gen: 0 };
}

function manhattan(a: number, b: number): number {
  const ac = a % COLS, bc = b % COLS;
  return Math.abs(ac - bc) + Math.abs(((a - ac) / COLS) - ((b - bc) / COLS));
}

/** Shortest way back to own land (avoiding own trail); first direction or -1. */
function bfsHome(owner: Int8Array, trail: Int8Array, id: number, cell: number, cands: number[], s: Scratch): number {
  const g = ++s.gen;
  let head = 0, tail = 0;
  s.seen[cell] = g;
  for (const d of cands) {
    const n = nextCell(cell, d);
    if (owner[n] === id) return d;
    s.seen[n] = g;
    s.first[n] = d;
    s.q[tail++] = n;
  }
  while (head < tail) {
    const k = s.q[head++];
    for (let d = 0; d < 4; d++) {
      const n = nextCell(k, d);
      if (n < 0 || s.seen[n] === g || trail[n] === id) continue;
      if (owner[n] === id) return s.first[k];
      s.seen[n] = g;
      s.first[n] = s.first[k];
      s.q[tail++] = n;
    }
  }
  return -1;
}

/**
 * Pick the direction to leave `cell` in. Roams inside its land, goes out on a
 * two-leg excursion (legA straight, legB sideways), then takes the shortest
 * way home. Heads home early when an enemy head comes close; aggressive
 * actors chase nearby enemy trails. `rnd` is any uint32.
 */
export function aiChoose(owner: Int8Array, trail: Int8Array, a: AiActor, cell: number, heads: number[], rnd: number, s: Scratch): number {
  const cands: number[] = [];
  for (let d = 0; d < 4; d++) {
    if (d === ((a.dir + 2) & 3)) continue;
    const n = nextCell(cell, d);
    if (n < 0 || trail[n] === a.id) continue;
    cands.push(d);
  }
  if (!cands.length) return a.dir;
  const pool: number[] = [];
  for (const d of cands) {
    const n = nextCell(cell, d);
    const nc = n % COLS, nr = (n - nc) / COLS;
    if (nc > 0 && nc < COLS - 1 && nr > 0 && nr < ROWS - 1) pool.push(d);
  }
  const opts = pool.length ? pool : cands;
  const out = owner[cell] !== a.id;
  let danger = false;
  if (out) for (const h of heads) if (manhattan(h, cell) <= a.caution) danger = true;

  // Chase an enemy trail nearby.
  if (a.aggr && !danger && (!out || a.trailLen < 10) && ((rnd >>> 4) & 1) !== 0) {
    const c0 = cell % COLS, r0 = (cell - c0) / COLS;
    let best = -1, bestD = 99;
    for (let r = Math.max(0, r0 - 7); r <= Math.min(ROWS - 1, r0 + 7); r++) {
      for (let c = Math.max(0, c0 - 7); c <= Math.min(COLS - 1, c0 + 7); c++) {
        const k = r * COLS + c;
        const t = trail[k];
        if (t < 0 || t === a.id) continue;
        const dd = Math.abs(c - c0) + Math.abs(r - r0);
        if (dd < bestD) {
          bestD = dd;
          best = k;
        }
      }
    }
    if (best >= 0) {
      let pick = opts[0], pd = 999;
      for (const d of opts) {
        const dd = manhattan(nextCell(cell, d), best);
        if (dd < pd || (dd === pd && d === a.dir)) {
          pd = dd;
          pick = d;
        }
      }
      return pick;
    }
  }

  if (!out) {
    if (opts.includes(a.dir) && ((rnd >>> 8) % 10) !== 0) return a.dir;
    return opts[(rnd >>> 12) % opts.length];
  }
  if (!danger && a.trailLen < a.legA + a.legB) {
    const want = a.trailLen < a.legA ? a.outDir : (a.outDir + a.side) & 3;
    if (opts.includes(want)) return want;
  }
  const home = bfsHome(owner, trail, a.id, cell, cands, s);
  return home >= 0 ? home : cands[rnd % cands.length];
}

/* ---------------- engine ---------------- */

interface Actor {
  id: number;
  alive: boolean;
  cell: number;
  dir: number;
  p: number;
  speed: number;
  trail: number[];
  cells: number;
  kills: number;
  bx0: number;
  by0: number;
  bx1: number;
  by1: number;
  legA: number;
  legB: number;
  side: number;
  outDir: number;
  aggr: number;
  respawn: number;
}

class TurfEngine implements GameEngine<TurfView> {
  private rng: Rng;
  private owner = new Int8Array(NCELLS).fill(-1);
  private trail = new Int8Array(NCELLS).fill(-1);
  private actors: Actor[] = [];
  private scratch = makeScratch();
  private queue: number[] = [];
  private prevB = 0;
  private started = false;
  private dead = false;
  private timeUp = false;
  private finalScore = -1;
  private lastPX = 0;
  private lastPY = 0;
  private ptrFrame = 0;
  private ptrArmed = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const spots: number[] = [];
    for (let i = 0; i <= BOTS; i++) {
      let cell = 0;
      for (let tries = 0; tries < 400; tries++) {
        const lo = i === 0 ? 28 : 6;
        const c = lo + this.rng.int(COLS - 2 * lo);
        const r = lo + this.rng.int(ROWS - 2 * lo);
        cell = r * COLS + c;
        const minD = tries < 300 ? 18 : 10;
        if (spots.every((s) => manhattan(s, cell) >= minD)) break;
      }
      spots.push(cell);
      this.actors.push({
        id: i, alive: true, cell, dir: this.rng.int(4), p: 0, speed: i === 0 ? PLAYER_SPEED : BOT_SPEED,
        trail: [], cells: 0, kills: 0, bx0: COLS, by0: ROWS, bx1: -1, by1: -1,
        legA: 6, legB: 4, side: 1, outDir: 0, aggr: i === 2 || i === 5 ? 1 : 0, respawn: 0,
      });
    }
    this.actors[0].dir = 0;
    for (const a of this.actors) this.claimPatch(a, a.cell);
  }

  private claimPatch(a: Actor, cell: number) {
    const c0 = cell % COLS, r0 = (cell - c0) / COLS;
    for (let r = r0 - START_R; r <= r0 + START_R; r++)
      for (let c = c0 - START_R; c <= c0 + START_R; c++)
        if (c >= 0 && c < COLS && r >= 0 && r < ROWS) this.setOwner(r * COLS + c, a.id);
  }

  private setOwner(k: number, id: number) {
    const old = this.owner[k];
    if (old === id) return;
    if (old >= 0) this.actors[old].cells--;
    this.owner[k] = id;
    if (id >= 0) {
      const a = this.actors[id];
      a.cells++;
      const c = k % COLS, r = (k - c) / COLS;
      if (c < a.bx0) a.bx0 = c;
      if (c > a.bx1) a.bx1 = c;
      if (r < a.by0) a.by0 = r;
      if (r > a.by1) a.by1 = r;
    }
  }

  private scoreNow(): number {
    if (this.finalScore >= 0) return this.finalScore;
    const me = this.actors[0];
    return Math.floor((me.cells * 1000) / NCELLS) * 10 + me.kills * KILL_POINTS;
  }

  private request(d: number) {
    const me = this.actors[0];
    if (!me.alive) return;
    if (!this.started) {
      this.started = true;
      me.dir = d;
      this.queue = [];
      return;
    }
    const last = this.queue.length ? this.queue[this.queue.length - 1] : me.dir;
    if (d === last) return;
    if (!this.queue.length && d !== ((me.dir + 2) & 3) && me.p < EARLY_TURN) {
      me.dir = d;
      return;
    }
    if (this.queue.length >= 2) this.queue.pop();
    this.queue.push(d);
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.done) return;
    const me = this.actors[0];

    // Buttons (arrows / swipe pulses)
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    for (let d = 0; d < 4; d++) {
      if (!(pressed & DIRS[d].b)) continue;
      this.ptrArmed = false;
      this.request(d);
    }
    // Pointer: steer towards where it rests, relative to the player (screen centre).
    if (this.frame === 1) {
      this.lastPX = inp.x;
      this.lastPY = inp.y;
    } else if (inp.x !== this.lastPX || inp.y !== this.lastPY) {
      this.lastPX = inp.x;
      this.lastPY = inp.y;
      this.ptrFrame = this.frame;
      this.ptrArmed = true;
    }
    if (this.ptrArmed && this.frame - this.ptrFrame >= PTR_DWELL) {
      this.ptrArmed = false;
      const dx = inp.x - W / 2, dy = inp.y - H / 2;
      if (Math.max(Math.abs(dx), Math.abs(dy)) >= PTR_DEAD) {
        this.request(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0));
      }
    }
    if (!this.started && this.frame >= AUTO_START) this.started = true;

    for (const a of this.actors) {
      if (!a.alive) {
        if (a.id > 0 && --a.respawn <= 0) this.respawn(a);
        continue;
      }
      if (a.id === 0 && !this.started) continue;
      a.p += a.speed;
      while (a.p >= SUB && a.alive) {
        a.p -= SUB;
        this.enter(a);
      }
    }

    if (!me.alive) {
      this.dead = true;
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    const left = RUN_FRAMES - this.frame;
    if (left > 0 && left <= 300 && left % 60 === 0) this.events.push({ t: "tick", sfx: "wall", n: left / 60 });
    if (left <= 0) {
      this.timeUp = true;
      this.finalScore = this.scoreNow();
      this.events.push({ t: "timeup", sfx: "won", mood: "happy", toast: "levelClear", pct10: Math.floor((me.cells * 1000) / NCELLS) });
    }
  }

  private heads(except: number): number[] {
    const out: number[] = [];
    for (const o of this.actors) if (o.alive && o.id !== except) out.push(o.cell);
    return out;
  }

  private enter(a: Actor) {
    const nc = nextCell(a.cell, a.dir);
    if (nc < 0) {
      this.kill(a, -1, a.cell);
      return;
    }
    a.cell = nc;
    const t = this.trail[nc];
    if (t === a.id) {
      this.kill(a, -1, nc);
      return;
    }
    if (t >= 0) this.kill(this.actors[t], a.id, nc);
    if (this.owner[nc] === a.id) {
      if (a.trail.length) this.capture(a);
    } else {
      if (!a.trail.length) {
        a.outDir = a.dir;
        a.legA = 4 + this.rng.int(9);
        a.legB = 3 + this.rng.int(8);
        a.side = this.rng.int(2) ? 1 : 3;
        if (a.id === 0) this.events.push({ t: "leave", sfx: "paddle" });
      }
      this.trail[nc] = a.id;
      a.trail.push(nc);
    }
    if (a.id === 0) this.turnPlayer(a);
    else {
      const ai: AiActor = { id: a.id, dir: a.dir, trailLen: a.trail.length, legA: a.legA, legB: a.legB, side: a.side, outDir: a.outDir, aggr: a.aggr, caution: a.aggr ? 3 : 4 };
      a.dir = aiChoose(this.owner, this.trail, ai, a.cell, this.heads(a.id), this.rng.next(), this.scratch);
    }
  }

  private turnPlayer(a: Actor) {
    if (!this.queue.length) return;
    const d = this.queue.shift()!;
    if (d === ((a.dir + 2) & 3) && a.trail.length) {
      // U-turn instead of reversing onto your own trail.
      let side = (a.dir + 1) & 3;
      if (nextCell(a.cell, side) < 0) side = (a.dir + 3) & 3;
      a.dir = side;
      this.queue.unshift(d);
    } else a.dir = d;
  }

  private capture(a: Actor) {
    const { owner } = this;
    const before = a.cells;
    let sx = 0, sy = 0, n = 0;
    for (const k of a.trail) {
      if (this.trail[k] === a.id) this.trail[k] = -1;
      this.setOwner(k, a.id);
    }
    a.trail = [];
    // Flood the bounding box (plus a margin) from its rim; whatever isn't reached is enclosed.
    const x0 = Math.max(0, a.bx0 - 1), x1 = Math.min(COLS - 1, a.bx1 + 1);
    const y0 = Math.max(0, a.by0 - 1), y1 = Math.min(ROWS - 1, a.by1 + 1);
    const s = this.scratch;
    const g = ++s.gen;
    let head = 0, tail = 0;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (y !== y0 && y !== y1 && x !== x0 && x !== x1) continue;
        const k = y * COLS + x;
        if (owner[k] === a.id || s.seen[k] === g) continue;
        s.seen[k] = g;
        s.q[tail++] = k;
      }
    }
    while (head < tail) {
      const k = s.q[head++];
      const x = k % COLS, y = (k - x) / COLS;
      if (x > x0) tail = this.floodPush(k - 1, a.id, g, tail);
      if (x < x1) tail = this.floodPush(k + 1, a.id, g, tail);
      if (y > y0) tail = this.floodPush(k - COLS, a.id, g, tail);
      if (y < y1) tail = this.floodPush(k + COLS, a.id, g, tail);
    }
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = y * COLS + x;
        if (owner[k] !== a.id && s.seen[k] !== g) this.setOwner(k, a.id);
      }
    }
    // Centre of the gained area, for effects.
    n = a.cells - before;
    if (n <= 0) return;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (owner[y * COLS + x] === a.id) { sx += x; sy += y; }
    const cx = (sx / a.cells + 0.5) * CELL, cy = (sy / a.cells + 0.5) * CELL;
    const big = n >= 60;
    if (a.id === 0) {
      this.events.push({ t: "capture", who: 0, n, x: cx, y: cy, sfx: big ? "extraGood" : "brickgone", mood: big ? "happy" : undefined, shake: big ? 4 : 0 });
    } else this.events.push({ t: "capture", who: a.id, n, x: cx, y: cy });
    for (const o of this.actors) if (o.alive && o.id !== a.id && o.cells <= 0) this.kill(o, a.id, o.cell);
  }

  private floodPush(k: number, id: number, g: number, tail: number): number {
    const s = this.scratch;
    if (this.owner[k] === id || s.seen[k] === g) return tail;
    s.seen[k] = g;
    s.q[tail] = k;
    return tail + 1;
  }

  private kill(v: Actor, killer: number, at: number) {
    if (!v.alive) return;
    const x = ((at % COLS) + 0.5) * CELL, y = (((at / COLS) | 0) + 0.5) * CELL;
    if (v.id === 0) this.finalScore = this.scoreNow();
    v.alive = false;
    for (const k of v.trail) if (this.trail[k] === v.id) this.trail[k] = -1;
    v.trail = [];
    if (killer >= 0 && killer !== v.id) this.actors[killer].kills++;
    if (v.id === 0) {
      this.events.push({ t: "die", who: 0, killer, x, y, sfx: "lost", mood: "sad", shake: 10 });
      return;
    }
    for (let k = 0; k < NCELLS; k++) if (this.owner[k] === v.id) this.setOwner(k, -1);
    v.cells = 0;
    v.bx0 = COLS; v.by0 = ROWS; v.bx1 = -1; v.by1 = -1;
    v.respawn = RESPAWN;
    const me = this.actors[0];
    if (killer === 0) {
      this.events.push({ t: "kill", victim: v.id, killer, x, y, sfx: "explode", mood: "happy", shake: 5 });
    } else {
      const near = manhattan(me.cell, at) <= 18;
      this.events.push({ t: "kill", victim: v.id, killer, x, y, sfx: near ? "brick" : undefined });
    }
  }

  private respawn(a: Actor) {
    const me = this.actors[0];
    for (let tries = 0; tries < 30; tries++) {
      const c0 = 5 + this.rng.int(COLS - 10), r0 = 5 + this.rng.int(ROWS - 10);
      const cell = r0 * COLS + c0;
      if (manhattan(cell, me.cell) < 14) continue;
      let ok = true;
      for (let r = r0 - 3; r <= r0 + 3 && ok; r++)
        for (let c = c0 - 3; c <= c0 + 3; c++) {
          const k = r * COLS + c;
          if (this.owner[k] >= 0 || this.trail[k] >= 0) { ok = false; break; }
        }
      if (!ok) continue;
      a.alive = true;
      a.cell = cell;
      a.dir = this.rng.int(4);
      a.p = 0;
      a.trail = [];
      this.claimPatch(a, cell);
      this.events.push({ t: "spawn", who: a.id, x: (c0 + 0.5) * CELL, y: (r0 + 0.5) * CELL });
      return;
    }
    a.respawn = 30;
  }

  view(): TurfView {
    const me = this.actors[0];
    return {
      frame: this.frame,
      started: this.started,
      timeLeft: Math.max(0, RUN_FRAMES - this.frame),
      owner: this.owner,
      trail: this.trail,
      actors: this.actors.map((a) => ({
        id: a.id, alive: a.alive, cell: a.cell, c: a.cell % COLS, r: (a.cell / COLS) | 0, dir: a.dir, t: a.p / SUB,
        trailLen: a.trail.length, cells: a.cells, kills: a.kills, legA: a.legA, legB: a.legB, side: a.side, outDir: a.outDir, aggr: a.aggr,
      })),
      pct10: Math.floor((me.cells * 1000) / NCELLS),
      score: this.scoreNow(),
      dead: this.dead,
      timeUp: this.timeUp,
    };
  }
  hud(): Hud {
    const me = this.actors[0];
    const pct10 = Math.floor((me.cells * 1000) / NCELLS);
    const secs = Math.ceil(Math.max(0, RUN_FRAMES - this.frame) / 60);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    return { score: this.scoreNow(), label: `${Math.floor(pct10 / 10)}.${pct10 % 10}% · ${me.kills} KO · ${clock}` };
  }
  result(): GameResult {
    return { score: this.scoreNow(), level: 0, levelsCleared: 0, frames: this.frame, status: this.timeUp ? "won" : this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead || this.timeUp;
  }
}

function hash(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

export const turf: GameDef<TurfView> = {
  id: "turf",
  name: "Turf Paint",
  tagline: "Paint a loop, claim the land. Cut their trails, guard your own.",
  genre: "Territory capture",
  session: "1–3 min",
  controls: "Arrows / WASD, swipe, or point where to go. Leave your land to draw a trail, come back to claim the loop.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: true, arrowsAsButtons: true },
  maxFrames: RUN_FRAMES + 120,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the territory-capture genre (trail, loop fill, trail cutting) with our own rules, bots, scoring and art. No code or assets from any existing game.",
  },
  create: (seed) => new TurfEngine(seed),
  bot(v) {
    // Same brain as the rivals; decides right after entering a cell (the early-turn window).
    const me = v.actors[0];
    const idle = { x: W / 2, y: H / 2, b: 0 };
    if (!me.alive || (v.started && me.t >= EARLY_TURN / SUB)) return idle;
    const heads: number[] = [];
    for (const o of v.actors) if (o.alive && o.id !== 0) heads.push(o.cell);
    const rnd = hash(me.cell * 131 + me.trailLen * 7 + me.legA);
    const ai: AiActor = { ...me, legA: Math.min(me.legA, 10), legB: Math.min(me.legB, 8), caution: 6 };
    const d = aiChoose(v.owner, v.trail, ai, me.cell, heads, rnd, makeScratch());
    return { x: W / 2, y: H / 2, b: d !== me.dir || !v.started ? DIRS[d].b : 0 };
  },
};
