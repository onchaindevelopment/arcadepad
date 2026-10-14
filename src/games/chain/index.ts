/*
 * Coin Chain: an original chain-shooter for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. No code, levels or assets from any other game.
 *
 * Rules: a chain of coloured coins rolls along a curved track toward the rug
 * pit. The mascot turret in the middle turns toward the pointer (or LEFT /
 * RIGHT); FIRE shoots the loaded coin, which slots into the chain where it
 * hits. 3+ touching coins of one colour pop. A gap whose two ends share a
 * colour pulls the front part back; when it closes, a new match pops as a
 * chain-reaction combo. ALT (or DOWN) swaps the loaded and next coin. The
 * chain speeds up over time; destroy it all to clear the level; if the front
 * coin reaches the pit, the run is over.
 *
 * Determinism: the track is a polyline parameterised by arc length (built
 * with the 256-step trig table and Math.sqrt), coins sit on it by arc length
 * spaced one diameter apart, the aim is an integer angle in 1/1024 turns,
 * shots move with fixed velocity components, colours come from the seeded
 * Rng and are limited to colours still in the chain.
 */
import { Rng } from "../core/rng.ts";
import { SIN256, angle256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const R = 11; // coin radius
export const D = 2 * R; // coin spacing along the track
export const LX = 180; // launcher (turret) centre
export const LY = 300;
export const MUZZLE = 26; // shots start this far from the centre
export const SHOT_STEP = 2.5; // px per sub-step
export const SHOT_SUB = 4; // sub-steps per frame (10 px/frame)
const HIT = 20; // centre distance that counts as a hit
const COOLDOWN = 12;
const GROW = 1 / 7; // inserted coin opens its slot over 7 frames
const RETRACT = 4; // px/frame a matching front part rolls back
const INTRO_SPEED = 4; // px/frame roll-in at level start
const INTRO_FRAC = 0.2; // roll in until the front coin is this far along
const KEY_AIM = 12; // aim units (1/1024 turn) per frame while an arrow is held
const CLEAR_PAUSE = 120;
const MAX_COLOURS = 6;

// ---------------------------------------------------------------- trig

/** Interpolated trig for 1/1024-turn angles (0 = right, 256 = down). */
export function sin1024(a: number): number {
  const i = (a >> 2) & 255;
  const f = (a & 3) / 4;
  return SIN256[i] + (SIN256[(i + 1) & 255] - SIN256[i]) * f;
}
export function cos1024(a: number): number {
  return sin1024(a + 256);
}
export function aimDir(a: number): { dx: number; dy: number } {
  return { dx: cos1024(a), dy: sin1024(a) };
}

/** Aim angle (1/1024 turns) from the launcher toward a point; no atan. */
export function aimFromPointer(px: number, py: number, fallback = 768): number {
  const vx = px - LX;
  const vy = py - LY;
  if (vx === 0 && vy === 0) return fallback;
  const a0 = angle256(vx, vy) * 4;
  let best = a0;
  let bestErr = Infinity;
  for (let a = a0 - 4; a <= a0 + 4; a++) {
    const c = cos1024(a), s = sin1024(a);
    if (c * vx + s * vy <= 0) continue;
    const err = Math.abs(c * vy - s * vx);
    if (err < bestErr) { bestErr = err; best = a; }
  }
  return best & 1023;
}

// ---------------------------------------------------------------- tracks

export interface Pt { x: number; y: number }
export interface Track {
  name: string;
  pts: Pt[];
  cum: number[]; // arc length at each point
  len: number;
}

class PathBuilder {
  pts: Pt[] = [];
  to(x: number, y: number) {
    this.pts.push({ x, y });
    return this;
  }
  /** Arc around (cx, cy) from angle a0 to a1 (1/1024 turns, + = clockwise on screen). */
  arc(cx: number, cy: number, r: number, a0: number, a1: number) {
    const dir = a1 > a0 ? 1 : -1;
    for (let a = a0; dir > 0 ? a <= a1 : a >= a1; a += 8 * dir) this.to(cx + r * cos1024(a), cy + r * sin1024(a));
    return this;
  }
}

function finish(name: string, pts: Pt[]): Track {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
    cum.push(cum[i - 1] + Math.sqrt(dx * dx + dy * dy));
  }
  return { name, pts, cum, len: cum[cum.length - 1] };
}

function spiral(): Track {
  // ~1.75 clockwise turns around the turret, starting at the left edge.
  const b = new PathBuilder().to(-30, LY);
  const turns = 1792, n = 448;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = 512 + (turns * i) / n;
    const rx = 162 - 70 * t;
    const ry = 272 - 160 * t;
    b.to(LX + rx * cos1024(a), LY + ry * sin1024(a));
  }
  return finish("Orbit", b.pts);
}

function switchback(): Track {
  const b = new PathBuilder()
    .to(-30, 50).to(300, 50)
    .arc(300, 95, 45, -256, 256) // (300,140), heading left
    .to(70, 140)
    .arc(70, 180, 40, 768, 512) // (30,180), heading down
    .to(30, 430)
    .arc(70, 430, 40, 512, 256) // (70,470), heading right
    .to(290, 470)
    .arc(290, 515, 45, -256, 256) // (290,560), heading left
    .to(80, 560);
  return finish("Switchback", b.pts);
}

function hairpins(): Track {
  const b = new PathBuilder()
    .to(30, -30).to(30, 500)
    .arc(60, 500, 30, 512, 0) // (90,500), heading up
    .to(90, 130)
    .arc(180, 130, 90, 512, 1024) // over the top to (270,130)
    .to(270, 500)
    .arc(300, 500, 30, 512, 0) // (330,500), heading up
    .to(330, 60);
  return finish("Hairpins", b.pts);
}

export const TRACKS: readonly Track[] = [spiral(), switchback(), hairpins()];

/** Point on a track at arc length s (clamped to the track). */
export function trackPos(tr: Track, s: number): Pt {
  if (s <= 0) return tr.pts[0];
  if (s >= tr.len) return tr.pts[tr.pts.length - 1];
  let lo = 0, hi = tr.cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (tr.cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = tr.cum[hi] - tr.cum[lo];
  const k = seg > 0 ? (s - tr.cum[lo]) / seg : 0;
  const a = tr.pts[lo], b = tr.pts[hi];
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
}

// ---------------------------------------------------------------- chain helpers

export interface Coin {
  id: number;
  col: number;
  s: number; // arc length position (front of the chain has the largest s)
  w: number; // 0..1 slot width while being inserted
  hx: number; // where the shot hit (for the insert animation)
  hy: number;
}

/** Required centre spacing between neighbours a (front) and b (behind). */
export function spacing(a: Coin, b: Coin): number {
  return (D * (a.w + b.w)) / 2;
}
/** True if coins[i] and coins[i + 1] touch. */
export function touching(coins: readonly Coin[], i: number): boolean {
  return coins[i].s - coins[i + 1].s <= spacing(coins[i], coins[i + 1]) + 0.5;
}

/** Indices [a, b] of the touching same-colour run of settled coins around k. */
export function runAt(coins: readonly Coin[], k: number): [number, number] {
  const col = coins[k].col;
  let a = k, b = k;
  while (a > 0 && coins[a - 1].col === col && coins[a - 1].w >= 1 && touching(coins, a - 1)) a--;
  while (b < coins.length - 1 && coins[b + 1].col === col && coins[b + 1].w >= 1 && touching(coins, b)) b++;
  return [a, b];
}

/** Push pass: nobody may overlap the coin behind it (pushes toward the pit). */
export function pushPass(coins: Coin[]) {
  for (let i = coins.length - 2; i >= 0; i--) {
    const need = coins[i + 1].s + spacing(coins[i], coins[i + 1]);
    if (coins[i].s < need) coins[i].s = need;
  }
}

/** First visible coin a shot along aim a would hit (static chain), or -1. */
export function simulateShot(coins: readonly Coin[], tr: Track, a: number): { hit: number; x: number; y: number } {
  const d = aimDir(a);
  const pos = coins.map((c) => (c.s >= 0 && c.s <= tr.len ? trackPos(tr, c.s) : null));
  let x = LX + d.dx * MUZZLE, y = LY + d.dy * MUZZLE;
  for (let i = 0; i < 400; i++) {
    x += d.dx * SHOT_STEP;
    y += d.dy * SHOT_STEP;
    if (x < -R || x > W + R || y < -R || y > H + R) return { hit: -1, x, y };
    const j = nearestHit(pos, x, y);
    if (j >= 0) return { hit: j, x, y };
  }
  return { hit: -1, x, y };
}

function nearestHit(pos: (Pt | null)[], x: number, y: number): number {
  let best = -1, bestD = HIT * HIT;
  for (let j = 0; j < pos.length; j++) {
    const p = pos[j];
    if (!p) continue;
    const dx = x - p.x, dy = y - p.y;
    const dd = dx * dx + dy * dy;
    if (dd < bestD) { bestD = dd; best = j; }
  }
  return best;
}

// ---------------------------------------------------------------- engine

export interface CoinView { id: number; col: number; x: number; y: number; s: number; w: number }

export interface ChainView {
  frame: number;
  track: number;
  len: number;
  coins: CoinView[]; // front (nearest the pit) first; only coins on the track
  hidden: number; // coins still waiting off the start of the track
  shots: { x: number; y: number; col: number }[];
  aim: number;
  cur: number;
  next: number;
  ready: boolean;
  busy: boolean; // a shot is flying or a coin is still sliding in
  speed: number; // px/frame of the pushing chain
  danger: number; // 0..1, front coin progress toward the pit
  combo: number;
  level: number;
  score: number;
  over: boolean;
  clearing: boolean;
  intro: boolean; // chain is still rolling in
}

interface Shot { x: number; y: number; vx: number; vy: number; col: number }

class ChainEngine implements GameEngine<ChainView> {
  private rng: Rng;
  private coins: Coin[] = [];
  private shots: Shot[] = [];
  private nextId = 1;
  private track = 0;
  private colours = 4;
  private aim = 768; // up
  private cur = 0;
  private next = 0;
  private cooldown = 0;
  private combo = 0;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private level = 0;
  private cleared = 0;
  private levelFrame = 0;
  private intro = true;
  private warned = false;
  private score = 0;
  private over = false;
  private clearT = 0;
  private speedNow = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.buildLevel();
  }

  private tr(): Track {
    return TRACKS[this.track];
  }

  private buildLevel() {
    const L = this.level;
    this.track = L % TRACKS.length;
    this.colours = L < 2 ? 4 : L < 5 ? 5 : MAX_COLOURS;
    const count = Math.min(90, 36 + 8 * L);
    this.coins = [];
    this.shots = [];
    let prev = -1, run = 0;
    for (let i = 0; i < count; i++) {
      let col: number;
      if (prev >= 0 && run < 2 && this.rng.int(100) < 42) col = prev;
      else {
        col = this.rng.int(this.colours);
        if (col === prev) col = (col + 1 + this.rng.int(this.colours - 1)) % this.colours;
      }
      run = col === prev ? run + 1 : 1;
      prev = col;
      this.coins.push({ id: this.nextId++, col, s: -i * D, w: 1, hx: 0, hy: 0 });
    }
    this.levelFrame = 0;
    this.intro = true;
    this.warned = false;
    this.combo = 0;
    this.cur = this.pickColour();
    this.next = this.pickColour();
  }

  private present(): number[] {
    const seen = new Array(MAX_COLOURS).fill(false);
    for (const c of this.coins) seen[c.col] = true;
    const out: number[] = [];
    for (let k = 0; k < MAX_COLOURS; k++) if (seen[k]) out.push(k);
    return out;
  }
  private pickColour(): number {
    const p = this.present();
    if (!p.length) return this.rng.int(this.colours);
    return p[this.rng.int(p.length)];
  }

  private speed(): number {
    const tr = this.tr();
    if (this.intro) return INTRO_SPEED;
    let v = (0.3 + 0.045 * Math.min(this.level, 10)) * (1 + this.levelFrame / 5400);
    if (v > 1.6) v = 1.6;
    // Ease off near the pit so the last moments stay playable.
    if (this.coins.length && this.coins[0].s > tr.len * 0.82) v *= 0.55;
    return v;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    if (this.clearT > 0) {
      if (--this.clearT === 0) this.buildLevel();
      this.px = inp.x; this.py = inp.y;
      return;
    }
    this.levelFrame++;

    // Aim: arrows turn the turret; otherwise follow the pointer when it moves.
    if (inp.b & BTN.LEFT) this.aim = (this.aim - KEY_AIM) & 1023;
    if (inp.b & BTN.RIGHT) this.aim = (this.aim + KEY_AIM) & 1023;
    const moved = this.frame > 1 && (inp.x !== this.px || inp.y !== this.py);
    if (!(inp.b & (BTN.LEFT | BTN.RIGHT)) && moved) this.aim = aimFromPointer(inp.x, inp.y, this.aim);
    this.px = inp.x; this.py = inp.y;

    if (pressed & (BTN.ALT | BTN.DOWN)) {
      const t = this.cur; this.cur = this.next; this.next = t;
      this.events.push({ t: "swap" });
    }

    if (this.cooldown > 0) this.cooldown--;
    if (pressed & (BTN.FIRE | BTN.UP) && this.cooldown === 0 && !this.intro) {
      const d = aimDir(this.aim);
      this.shots.push({ x: LX + d.dx * MUZZLE, y: LY + d.dy * MUZZLE, vx: d.dx * SHOT_STEP, vy: d.dy * SHOT_STEP, col: this.cur });
      this.cur = this.next;
      this.next = this.pickColour();
      this.cooldown = COOLDOWN;
      this.events.push({ t: "shot", sfx: "shot", x: LX, y: LY, aim: this.aim });
    }

    this.moveShots();
    const joins = this.moveChain();
    this.growInserts();
    for (const c of joins) this.tryPop(c, true);
    this.afterChange();
  }

  private moveShots() {
    if (!this.shots.length) return;
    const tr = this.tr();
    const keep: Shot[] = [];
    for (const sh of this.shots) {
      let alive = true;
      for (let i = 0; i < SHOT_SUB && alive; i++) {
        sh.x += sh.vx;
        sh.y += sh.vy;
        if (sh.x < -R || sh.x > W + R || sh.y < -R || sh.y > H + R) { alive = false; break; }
        const pos = this.coins.map((c) => (c.s >= 0 && c.s <= tr.len ? trackPos(tr, c.s) : null));
        const j = nearestHit(pos, sh.x, sh.y);
        if (j >= 0) {
          this.insert(sh, j, pos[j]!);
          alive = false;
        }
      }
      if (alive) keep.push(sh);
    }
    this.shots = keep;
  }

  private insert(sh: Shot, j: number, pj: Pt) {
    const tr = this.tr();
    const c = this.coins[j];
    const f = trackPos(tr, c.s + R), b = trackPos(tr, c.s - R);
    const df = (sh.x - f.x) * (sh.x - f.x) + (sh.y - f.y) * (sh.y - f.y);
    const db = (sh.x - b.x) * (sh.x - b.x) + (sh.y - b.y) * (sh.y - b.y);
    const front = df < db;
    const coin: Coin = { id: this.nextId++, col: sh.col, s: front ? c.s + R : c.s - R, w: 0, hx: sh.x, hy: sh.y };
    this.coins.splice(front ? j : j + 1, 0, coin);
    this.events.push({ t: "insert", sfx: "paddle", x: pj.x, y: pj.y, col: sh.col });
  }

  /** Retract matching front parts, push the tail. Returns coins whose joins need a match check. */
  private moveChain(): Coin[] {
    const cs = this.coins;
    const joins: Coin[] = [];
    const pending: Coin[] = [];
    if (!cs.length) return joins;
    // Retract: process gaps from the back of the chain to the front.
    for (let i = cs.length - 2; i >= 0; i--) {
      if (touching(cs, i)) continue;
      const bk = cs[i], fr = cs[i + 1];
      if (bk.col !== fr.col || bk.w < 1 || fr.w < 1) continue;
      let a = i;
      while (a > 0 && touching(cs, a - 1)) a--;
      const gap = bk.s - fr.s - spacing(bk, fr);
      const d = Math.min(RETRACT, gap);
      for (let k = a; k <= i; k++) cs[k].s -= d;
      pending.push(bk);
    }
    // The tail pushes everything it touches toward the pit.
    const v = this.speed();
    this.speedNow = v;
    cs[cs.length - 1].s += v;
    pushPass(cs);
    // A retracting gap that closed this frame (by the pull or by the push) is a join.
    for (const bk of pending) {
      const k = cs.indexOf(bk);
      if (k >= 0 && k < cs.length - 1 && touching(cs, k)) joins.push(bk);
    }
    if (this.intro && cs[0].s >= this.tr().len * INTRO_FRAC) this.intro = false;
    return joins;
  }

  private growInserts() {
    const settled: Coin[] = [];
    for (const c of this.coins) {
      if (c.w >= 1) continue;
      c.w = Math.min(1, c.w + GROW);
      if (c.w >= 1) settled.push(c);
    }
    pushPass(this.coins);
    for (const c of settled) {
      this.combo = 0;
      this.tryPop(c, false);
    }
  }

  /** Pop the run around coin c if it has 3+ coins. */
  private tryPop(c: Coin, chain: boolean): boolean {
    const k = this.coins.indexOf(c);
    if (k < 0) return false;
    const [a, b] = runAt(this.coins, k);
    const n = b - a + 1;
    if (n < 3) return false;
    const tr = this.tr();
    const removed = this.coins.splice(a, n);
    this.combo++;
    const pts = 10 * n * this.combo + (n > 3 ? 10 * (n - 3) * n : 0);
    this.score += pts;
    const cells = removed.map((q) => ({ ...trackPos(tr, q.s), col: q.col }));
    const mid = cells[n >> 1];
    this.events.push({
      t: "pop", sfx: n >= 5 ? "explode" : "brickgone", cells, n, pts, combo: this.combo, chain,
      shake: Math.min(6, n - 1), x: mid.x, y: mid.y,
    });
    if (this.combo >= 2) this.events.push({ t: "combo", sfx: "extraGood", mood: "happy", combo: this.combo, x: mid.x, y: mid.y });
    return true;
  }

  private afterChange() {
    const tr = this.tr();
    if (!this.coins.length) {
      const bonus = 1000 + 500 * this.level;
      this.score += bonus;
      this.cleared++;
      this.level++;
      this.clearT = CLEAR_PAUSE;
      this.shots = [];
      this.events.push({ t: "levelclear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus, x: W / 2, y: H / 2 });
      return;
    }
    const p = this.present();
    if (!p.includes(this.cur)) this.cur = this.pickColour();
    if (!p.includes(this.next)) this.next = this.pickColour();
    const front = this.coins[0].s;
    if (!this.warned && front > tr.len * 0.82) {
      this.warned = true;
      const e = trackPos(tr, tr.len);
      this.events.push({ t: "danger", sfx: "extraBad", mood: "sad", x: e.x, y: e.y });
    } else if (this.warned && front < tr.len * 0.7) this.warned = false;
    if (front >= tr.len) {
      this.over = true;
      const e = trackPos(tr, tr.len);
      this.events.push({ t: "lost", sfx: "lost", mood: "sad", shake: 10, x: e.x, y: e.y });
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  view(): ChainView {
    const tr = this.tr();
    const coins: CoinView[] = [];
    let hidden = 0;
    let busy = this.shots.length > 0;
    for (const c of this.coins) {
      if (c.s < -R) { hidden++; continue; }
      const p = trackPos(tr, c.s);
      let x = p.x, y = p.y;
      if (c.w < 1) {
        busy = true;
        x = c.hx + (p.x - c.hx) * c.w;
        y = c.hy + (p.y - c.hy) * c.w;
      }
      coins.push({ id: c.id, col: c.col, x, y, s: c.s, w: c.w });
    }
    return {
      frame: this.frame,
      track: this.track,
      len: tr.len,
      coins,
      hidden,
      shots: this.shots.map((s) => ({ x: s.x, y: s.y, col: s.col })),
      aim: this.aim,
      cur: this.cur,
      next: this.next,
      ready: this.cooldown === 0 && !this.intro && this.clearT === 0 && !this.over,
      busy,
      speed: this.speedNow,
      danger: this.coins.length ? Math.max(0, Math.min(1, this.coins[0].s / tr.len)) : 0,
      combo: this.combo,
      level: this.level,
      score: this.score,
      over: this.over,
      clearing: this.clearT > 0,
      intro: this.intro,
    };
  }
  hud(): Hud {
    return { score: this.score, level: this.level + 1, label: this.combo >= 2 ? `Combo x${this.combo}` : `${this.coins.length} coins` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.cleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }

  /** Test hook: replace the chain (front first) on the current track. */
  setChain(cols: number[], s0: number, gapAfter = -1, gap = 0) {
    this.coins = [];
    let s = s0;
    for (let i = 0; i < cols.length; i++) {
      this.coins.push({ id: this.nextId++, col: cols[i], s, w: 1, hx: 0, hy: 0 });
      s -= D + (i === gapAfter ? gap : 0);
    }
    this.intro = false;
  }
  /** Test hook: insert colour col directly behind index j, already settled. */
  insertSettled(j: number, col: number): boolean {
    const c: Coin = { id: this.nextId++, col, s: this.coins[j].s, w: 1, hx: 0, hy: 0 };
    for (let k = 0; k <= j; k++) this.coins[k].s += D;
    this.coins.splice(j + 1, 0, c);
    return this.tryPop(c, false);
  }
  get rawCoins(): readonly Coin[] {
    return this.coins;
  }
}

export function createChain(seed: number): ChainEngine {
  return new ChainEngine(seed);
}
export type { ChainEngine };

// ---------------------------------------------------------------- bot

function pointFor(a: number): Pt {
  const d = aimDir(a);
  return { x: Math.max(0, Math.min(W - 1, Math.round(LX + d.dx * 170))), y: Math.max(0, Math.min(H - 1, Math.round(LY + d.dy * 170))) };
}

/** Pick a target for a colour: { aim, score } or null. */
function planFor(v: ChainView, col: number, frame: number): { x: number; y: number; score: number } | null {
  const tr = TRACKS[v.track];
  // Rebuild a static coin list for the shot simulation.
  const coins: Coin[] = v.coins.map((c) => ({ id: c.id, col: c.col, s: c.s, w: c.w, hx: 0, hy: 0 }));
  let best: { x: number; y: number; score: number } | null = null;
  for (let j = 0; j < coins.length; j++) {
    const c = coins[j];
    if (c.col !== col || c.s < 0) continue;
    // Same-colour neighbours already touching: a pop.
    const [a, b] = runAt(coins, j);
    const pair = b - a >= 1;
    const score = (c.s / tr.len) * 100 + (pair ? 200 : 20);
    // Lead the moving chain a little (the bot does not account for pushes from inserts).
    const p = trackPos(tr, c.s);
    const dist = Math.sqrt((p.x - LX) * (p.x - LX) + (p.y - LY) * (p.y - LY));
    const lead = trackPos(tr, c.s + v.speed * (dist / (SHOT_STEP * SHOT_SUB)));
    const jitter = ((frame * 7) % 11) - 5;
    const a0 = aimFromPointer(Math.round(lead.x + jitter * 0.6), Math.round(lead.y));
    const sim = simulateShot(coins, tr, a0);
    if (sim.hit < 0 || coins[sim.hit].col !== col) continue;
    if (!best || score > best.score) {
      const pt = pointFor(a0);
      best = { x: pt.x, y: pt.y, score };
    }
  }
  return best;
}

export const chain: GameDef<ChainView> = {
  id: "chain",
  name: "Coin Chain",
  tagline: "Shoot coins into the rolling chain, pop three of a kind, keep it out of the rug pit.",
  genre: "Chain shooter",
  session: "3–10 min",
  controls: "Aim with mouse/touch or Left/Right, click/tap/Space to shoot, X / right click / Down to swap.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the chain-shooter genre (coins rolling along a track, insert-and-match-3, gaps that pull back on matching ends for chain combos). Tracks, art and sounds are new; no code, levels or assets from any other game.",
  },
  create: (seed) => new ChainEngine(seed),
  bot(v, frame) {
    // A relaxed player: thinks for a moment between shots, so long runs still end.
    if (!v.ready || v.busy || frame % 30 >= 2) return { x: LX, y: LY - 120, b: 0 };
    const mine = planFor(v, v.cur, frame);
    if (mine && mine.score >= 200) return { x: mine.x, y: mine.y, b: frame & 1 ? 0 : BTN.FIRE };
    const other = planFor(v, v.next, frame);
    if (other && other.score >= 200 && (frame & 3) === 0) return { x: LX, y: LY - 120, b: BTN.ALT };
    if (mine) return { x: mine.x, y: mine.y, b: frame & 1 ? 0 : BTN.FIRE };
    // Nothing matches: dump the coin at the tail end of the visible chain.
    const tail = v.coins.length ? v.coins[v.coins.length - 1] : null;
    if (!tail) return { x: LX, y: LY - 120, b: 0 };
    const a = aimFromPointer(Math.round(tail.x), Math.round(tail.y));
    const pt = pointFor(a);
    return { x: pt.x, y: pt.y, b: frame & 1 ? 0 : BTN.FIRE };
  },
};
