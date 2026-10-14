/*
 * Pulse Run: one-button auto-scrolling platformer. Original design and code
 * for ArcadePad, GPL-3.0-or-later.
 *
 * The mascot block slides right at a constant speed. FIRE (or UP) jumps;
 * holding it jumps again the moment you land. Spikes kill, blocks are
 * platforms (crash into their side and you are out), pads launch you, orbs
 * give a mid-air jump when you tap while touching them, gravity portals flip
 * you onto the ceiling and ship portals turn you into a hold-to-climb flyer.
 * One life: the run is how far you get through the levels in a row. After the
 * last level they come back shuffled and faster (the same paths in space,
 * scaled in time, so every level stays beatable).
 * Score: progress % of every level reached (100 per clear) + a clear bonus
 * that grows with each loop.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";
import { FINISH_TAIL, LEVELS, ROWS, T, type Level } from "./levels.ts";

export { LEVELS, T, ROWS, FINISH_TAIL };
export type { Level };

export const FIELD_W = 640;
export const FIELD_H = 360;
/** Player block size (a little smaller than a tile). */
export const P = 26;
/** Player x on screen (the camera follows horizontally only). */
export const PLAYER_SX = 170;
/** Frames per beat for the visual pulse (~128 bpm). */
export const BEAT = 28;

const SPEED = 5; // px per frame at speed factor 1 (10 tiles/s)
const G = 0.9;
const JUMP = 11.4; // apex ~2.4 tiles, ~4.2 tiles long
const PAD = 15.6; // apex ~4.5 tiles
const ORB = 11.4;
const MAX_FALL = 14;
const SHIP_UP = 0.55;
const SHIP_DOWN = 0.5;
const SHIP_MAX = 6.5;
const SNAP = 8; // landing forgiveness (px)
const HZ = 3; // hazard hitbox inset of the player
const READY_FIRST = 70;
const READY_NEXT = 40;
const CLEAR_FRAMES = 50;
const LOOP_SPEEDUP = 0.15;
const MAX_K = 1.6;
const START_X = 3 * T;

/** Physics state of the player; also used by the bot to look ahead. */
export interface Sim {
  x: number;
  y: number;
  vy: number;
  grav: number; // 1 = down, -1 = up
  ship: boolean;
  grounded: boolean;
  armed: boolean; // a press is buffered for an orb
  prev: boolean; // button held last frame
  dead: boolean;
  cleared: boolean;
  used: number[]; // ids (r * cols + c) of pads/orbs/portals already used
}

export function newSim(): Sim {
  return { x: START_X, y: 10 * T - P, vy: 0, grav: 1, ship: false, grounded: true, armed: false, prev: false, dead: false, cleared: false, used: [] };
}

export function cloneSim(s: Sim): Sim {
  return { ...s, used: s.used.slice() };
}

function hit(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function tile(lvl: Level, r: number, c: number): string {
  if (r < 0 || r >= ROWS || c < 0 || c >= lvl.cols) return ".";
  return lvl.rows[r][c];
}

/** One 1/60 s physics step. Pure apart from mutating `s` and pushing to `ev`. */
export function physStep(s: Sim, lvl: Level, held: boolean, k: number, ev: GameEvent[] | null): void {
  const pressed = held && !s.prev;
  s.prev = held;
  if (pressed) s.armed = true;
  if (!held) s.armed = false;

  if (!s.ship) {
    if (s.grounded && held) {
      s.vy = -s.grav * JUMP * k;
      s.grounded = false;
      s.armed = false;
      ev?.push({ t: "jump", x: s.x + P / 2, y: s.grav > 0 ? s.y + P : s.y });
    }
    s.vy += s.grav * G * k * k;
    const mf = MAX_FALL * k;
    if (s.vy > mf) s.vy = mf;
    if (s.vy < -mf) s.vy = -mf;
  } else {
    s.vy += (held ? -SHIP_UP : SHIP_DOWN) * k * k;
    const m = SHIP_MAX * k;
    if (s.vy > m) s.vy = m;
    if (s.vy < -m) s.vy = -m;
  }

  const py = s.y;
  s.x += SPEED * k;
  s.y += s.vy;
  s.grounded = false;
  const tol = SNAP * k;
  const c0 = Math.floor(s.x / T) - 1;
  const c1 = Math.floor((s.x + P) / T) + 1;
  const r0 = Math.max(0, Math.floor(s.y / T) - 1);
  const r1 = Math.min(ROWS - 1, Math.floor((s.y + P) / T) + 1);
  const down = s.ship || s.grav > 0;
  const up = s.ship || s.grav < 0;

  // Pass 1: landings on solids.
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tile(lvl, r, c) !== "#") continue;
      const top = r * T;
      const bot = top + T;
      if (!hit(s.x, s.y, P, P, c * T, top, T, T)) continue;
      if (down && s.vy >= 0 && py + P <= top + tol) {
        s.y = top - P;
        s.vy = 0;
        if (s.ship || s.grav > 0) s.grounded = true;
      } else if (up && s.vy <= 0 && py >= bot - tol) {
        s.y = bot;
        s.vy = 0;
        if (s.ship || s.grav < 0) s.grounded = true;
      }
    }
  }
  // Pass 2: anything still overlapping is a crash.
  for (let r = r0; r <= r1 && !s.dead; r++) {
    for (let c = c0; c <= c1; c++) {
      if (tile(lvl, r, c) === "#" && hit(s.x, s.y, P, P, c * T, r * T, T, T)) {
        s.dead = true;
        ev?.push({ t: "crash", x: s.x + P, y: s.y + P / 2 });
        return;
      }
    }
  }

  // Hazards and specials.
  const hx = s.x + HZ, hy = s.y + HZ, hs = P - 2 * HZ;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const ch = tile(lvl, r, c);
      if (ch === ".") continue;
      const x = c * T, y = r * T;
      if (ch === "^" || ch === "v") {
        if (hit(hx, hy, hs, hs, x + 9, ch === "^" ? y + 14 : y, 12, 16)) {
          s.dead = true;
          ev?.push({ t: "spiked", x: s.x + P / 2, y: s.y + P / 2 });
          return;
        }
      } else if (ch === "p" && !s.ship) {
        const id = r * lvl.cols + c;
        if (hit(s.x, s.y, P, P, x + 2, y + 20, 26, 10) && !s.used.includes(id)) {
          s.used.push(id);
          s.vy = -PAD * k;
          s.grounded = false;
          ev?.push({ t: "pad", x: x + T / 2, y: y + T - 4 });
        }
      } else if (ch === "o" && !s.ship) {
        const id = r * lvl.cols + c;
        if (s.armed && hit(s.x, s.y, P, P, x - 5, y - 5, T + 10, T + 10) && !s.used.includes(id)) {
          s.used.push(id);
          s.armed = false;
          s.vy = -s.grav * ORB * k;
          s.grounded = false;
          ev?.push({ t: "orb", x: x + T / 2, y: y + T / 2 });
        }
      }
    }
  }

  // Portals trigger by column (any height).
  for (const pt of lvl.portals) {
    const x = pt.c * T;
    if (x > s.x + P + T || x + T < s.x - T) continue;
    if (!hit(s.x, 0, P, 1, x + 8, 0, 14, 1)) continue;
    const id = pt.r * lvl.cols + pt.c;
    if (s.used.includes(id)) continue;
    s.used.push(id);
    if (pt.kind === "G") { s.grav = -1; s.vy *= 0.4; }
    else if (pt.kind === "N") { s.grav = 1; s.vy *= 0.4; }
    else if (pt.kind === "S") { s.ship = true; s.grav = 1; s.vy *= 0.4; }
    else { s.ship = false; s.grav = 1; }
    s.grounded = false;
    ev?.push({ t: "portal", kind: pt.kind, x: x + T / 2, y: pt.r * T + T / 2 });
  }

  if (s.y > FIELD_H + 20 || s.y + P < -20) {
    s.dead = true;
    ev?.push({ t: "fell", x: s.x + P / 2, y: s.y < 0 ? 0 : FIELD_H });
    return;
  }
  if (s.x >= lvl.endX) s.cleared = true;
}

/**
 * Look-ahead planner: depth-first search over hold/release choices, switching
 * only on frames divisible by `gran` (so the plan stays consistent frame to frame).
 * Returns whether to hold now, or null if every branch dies.
 */
export function plan(s0: Sim, lvl: Level, k: number, frame: number, horizon: number, budget = 6000, gran = 3): boolean | null {
  let nodes = 0;
  const failed = new Set<string>();
  let first: boolean | null = null;
  const dfs = (s: Sim, f: number, left: number, top: boolean): boolean => {
    if (s.cleared || left <= 0) return true;
    if (++nodes > budget) return true;
    const key = `${f}|${Math.round(s.y)}|${Math.round(s.vy * 4)}|${s.grav}|${s.ship ? 1 : 0}|${s.grounded ? 1 : 0}|${s.prev ? 1 : 0}|${s.armed ? 1 : 0}|${s.used.length}`;
    if (failed.has(key)) return false;
    const seg = Math.min(left, gran - (f % gran));
    const order = s.ship ? [s.prev, !s.prev] : [false, true];
    for (const h of order) {
      const c = cloneSim(s);
      let ok = true;
      for (let i = 0; i < seg; i++) {
        physStep(c, lvl, h, k, null);
        if (c.dead) { ok = false; break; }
        if (c.cleared) break;
      }
      if (ok && dfs(c, f + seg, left - seg, false)) {
        if (top) first = h;
        return true;
      }
    }
    failed.add(key);
    return false;
  };
  dfs(cloneSim(s0), frame, horizon, true);
  return first;
}

export type PulseState = "ready" | "play" | "clear" | "dead";

export interface PulseView {
  frame: number;
  state: PulseState;
  timer: number;
  level: Level;
  levelIdx: number;
  levelNo: number; // 1-based count in this run
  loop: number;
  k: number;
  sim: Sim;
  progress: number; // 0..100 in this level
  best: number;
  score: number;
  salt: number;
}

function speedFor(loop: number): number {
  return Math.min(MAX_K, 1 + LOOP_SPEEDUP * loop);
}

class PulseEngine implements GameEngine<PulseView> {
  private rng: Rng;
  private order: number[] = LEVELS.map((_, i) => i);
  private cleared = 0;
  private loop = 0;
  private levelIdx = 0;
  private lvl: Level = LEVELS[0];
  private sim: Sim = newSim();
  private k = 1;
  private state: PulseState = "ready";
  private timer = READY_FIRST;
  private score = 0;
  private progress = 0;
  private salt: number;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.salt = this.rng.next();
    this.startLevel(READY_FIRST);
  }

  private startLevel(ready: number) {
    const n = LEVELS.length;
    const loop = Math.floor(this.cleared / n);
    if (loop !== this.loop || this.cleared === 0) {
      this.loop = loop;
      this.order = LEVELS.map((_, i) => i);
      if (loop > 0) {
        for (let i = n - 1; i > 0; i--) {
          const j = this.rng.int(i + 1);
          const t = this.order[i];
          this.order[i] = this.order[j];
          this.order[j] = t;
        }
      }
    }
    this.k = speedFor(this.loop);
    this.levelIdx = this.order[this.cleared % n];
    this.lvl = LEVELS[this.levelIdx];
    this.sim = newSim();
    this.progress = 0;
    this.state = "ready";
    this.timer = ready;
    this.events.push({ t: "level", name: this.lvl.name, loop: this.loop });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.state === "dead") return;
    const held = (inp.b & (BTN.FIRE | BTN.UP)) !== 0;

    if (this.state === "ready") {
      this.sim.prev = held;
      if (--this.timer <= 0) {
        this.state = "play";
        this.events.push({ t: "go" });
      }
      return;
    }
    if (this.state === "clear") {
      if (--this.timer <= 0) this.startLevel(READY_NEXT);
      return;
    }

    const s = this.sim;
    physStep(s, this.lvl, held, this.k, this.events);
    for (const e of this.events) {
      if (e.t === "jump") e.sfx = "paddle";
      else if (e.t === "pad") e.sfx = "launch";
      else if (e.t === "orb") e.sfx = "brick";
      else if (e.t === "portal") e.sfx = "extraGood";
    }
    this.progress = Math.min(100, Math.floor(((s.x - START_X) * 100) / (this.lvl.endX - START_X)));
    if (s.dead) {
      this.score += this.progress;
      this.state = "dead";
      this.events.push({ t: "die", sfx: "explode", mood: "sad", shake: 10, x: s.x + P / 2, y: s.y + P / 2, progress: this.progress });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    if (s.cleared) {
      this.progress = 100;
      const bonus = 20 * (this.loop + 1);
      this.score += 100 + bonus;
      this.cleared++;
      this.state = "clear";
      this.timer = CLEAR_FRAMES;
      const lapped = this.cleared % LEVELS.length === 0;
      this.events.push({ t: "levelclear", sfx: lapped ? "won" : "levelclear", toast: "levelClear", mood: "happy", bonus, lapped, x: s.x + P / 2, y: s.y + P / 2 });
    }
  }

  view(): PulseView {
    return {
      frame: this.frame,
      state: this.state,
      timer: this.timer,
      level: this.lvl,
      levelIdx: this.levelIdx,
      levelNo: this.cleared + 1,
      loop: this.loop,
      k: this.k,
      sim: cloneSim(this.sim),
      progress: this.progress,
      best: this.score,
      score: this.liveScore(),
      salt: this.salt,
    };
  }

  private liveScore() {
    return this.score + (this.state === "play" || this.state === "ready" ? this.progress : 0);
  }

  hud(): Hud {
    return { score: this.liveScore(), level: this.cleared + 1, label: `${this.lvl.name} ${this.progress}%` };
  }

  result(): GameResult {
    return { score: this.liveScore(), level: this.cleared, levelsCleared: this.cleared, frames: this.frame, status: this.state === "dead" ? "over" : "playing" };
  }

  get done() {
    return this.state === "dead";
  }
}

function hash32(n: number): number {
  let h = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export const pulse: GameDef<PulseView> = {
  id: "pulse",
  name: "Pulse Run",
  tagline: "One button, one life. Jump to the beat and see how far the block goes.",
  genre: "One-button rhythm platformer",
  session: "1–5 min",
  controls: "Tap or hold Space / click / touch to jump. Tap on orbs for a mid-air jump. Hold to fly up in ship mode.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the one-button auto-scrolling platformer genre. Levels, physics, art and code are our own; no assets, levels or music from any other game.",
  },
  create: (seed) => new PulseEngine(seed),
  bot(v) {
    if (v.state !== "play") return { x: 0, y: 0, b: 0 };
    // Imperfect: on some columns the bot "blinks" and lets go.
    const col = Math.floor(v.sim.x / T);
    const h = hash32(v.salt ^ Math.imul(v.levelNo, 7919) ^ Math.imul(col, 104729)) % 1000;
    if (h < 10 + 8 * v.loop) return { x: 0, y: 0, b: 0 };
    const hold = plan(v.sim, v.level, v.k, v.frame, 60, 6000);
    return { x: 0, y: 0, b: hold === false ? 0 : BTN.FIRE };
  },
};
