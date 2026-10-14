/*
 * Blob Grow: an original "eat smaller cells, avoid bigger ones" arena game.
 * Single player against deterministic AI blobs, no networking.
 * ArcadePad, GPL-3.0-or-later. Original implementation of the genre.
 *
 * Rules: you are a blob in a big square world full of pellets and AI blobs.
 * Move toward the pointer (or with the arrows); the bigger you are the slower
 * you move. Eat pellets and any blob you are at least 10% heavier than by
 * covering its centre. Tap / click / Space splits every cell big enough into
 * two (the new half shoots forward); split cells re-merge after a while.
 * The run ends when your last cell is eaten. Score = highest mass reached.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const WORLD = 3000;

const GRID = 100; // pellet bucket size
const GW = WORLD / GRID;
const PELLETS = 900;
const COIN_EVERY = 18; // every Nth pellet slot is a coin worth more
const COIN_MASS = 5;
const START_MASS = 20;
const MIN_SPLIT = 36;
const MAX_CELLS = 8;
const MERGE_FRAMES = 600;
const EAT_RATIO = 1.1;
const TAP_FRAMES = 15; // FIRE held at most this long counts as a tap (split)
const BOT_THINK = 10;
const BOT_RESPAWN = 240;
const MILESTONES = [50, 100, 200, 400, 800, 1600, 3200];

const BOT_NAMES = [
  "FUD", "Bear", "Paper Hands", "Rug", "Jeet", "Exit Liq", "Gas Fee", "Red Candle",
  "Sell Wall", "Bagholder", "NGMI", "Dumpster", "Whale", "Fomo", "Shill", "Dip",
];

export const radiusOf = (mass: number) => 4 * Math.sqrt(mass);
const speedOf = (mass: number) => 6.5 / Math.sqrt(Math.sqrt(mass));
/** Camera zoom (screen px per world unit) for a total player mass. */
export function zoomFor(mass: number): number {
  const z = 30 / (radiusOf(mass) + 18);
  return z > 1 ? 1 : z < 0.3 ? 0.3 : z;
}

export interface Pellet { x: number; y: number; c: number; coin: boolean; alive: boolean }
export interface CellV { id: number; x: number; y: number; mass: number; r: number; merge: number }
export interface BotV { id: number; name: string; x: number; y: number; mass: number; r: number; color: number; alive: boolean; dx: number; dy: number }
export interface BlobView {
  frame: number;
  zoom: number;
  /** Camera centre (mass-weighted player centroid), world units. */
  cx: number;
  cy: number;
  cells: CellV[];
  bots: BotV[];
  /** Live pellet array (read only). */
  pellets: readonly Pellet[];
  leaderboard: { name: string; mass: number; me: boolean }[];
  mass: number;
  maxMass: number;
  rank: number;
  dead: boolean;
  killer: string;
  over: boolean;
  won: boolean;
  pointerMode: boolean;
  started: boolean;
}

interface Cell { id: number; x: number; y: number; mass: number; vx: number; vy: number; merge: number }
interface Bot { id: number; name: string; x: number; y: number; mass: number; dx: number; dy: number; alive: boolean; respawn: number; color: number; vx: number; vy: number }
interface Ent { x: number; y: number; mass: number; r: number; bot: Bot | null; cell: Cell | null }

class BlobEngine implements GameEngine<BlobView> {
  private rng: Rng;
  private pellets: Pellet[] = [];
  private buckets: number[][] = [];
  private dead: number[] = [];
  private cells: Cell[] = [];
  private bots: Bot[] = [];
  private nextId = 1;
  private prevB = 0;
  private held = 0;
  private px = W / 2;
  private py = H / 2;
  private pointerMode = false;
  private started = false;
  private dirX = 1;
  private dirY = 0;
  private maxMass = START_MASS;
  private level = 0;
  private killer = "";
  private over = false;
  private won = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    for (let i = 0; i < GW * GW; i++) this.buckets.push([]);
    for (let i = 0; i < PELLETS; i++) {
      this.pellets.push({ x: 0, y: 0, c: i % 6, coin: i % COIN_EVERY === 0, alive: false });
      this.placePellet(i);
    }
    this.cells.push({ id: this.nextId++, x: WORLD / 2, y: WORLD / 2, mass: START_MASS, vx: 0, vy: 0, merge: 0 });
    for (let i = 0; i < BOT_NAMES.length; i++) {
      const b: Bot = { id: this.nextId++, name: BOT_NAMES[i], x: 0, y: 0, mass: 0, dx: 0, dy: 0, alive: false, respawn: 0, color: i, vx: 0, vy: 0 };
      this.bots.push(b);
      this.spawnBot(b, i < 2 ? this.rng.range(120, 220) : this.rng.range(8, 60));
    }
  }

  // ---- pellets ----
  private bucketOf(x: number, y: number) {
    const gx = Math.min(GW - 1, Math.max(0, Math.floor(x / GRID)));
    const gy = Math.min(GW - 1, Math.max(0, Math.floor(y / GRID)));
    return gy * GW + gx;
  }
  private placePellet(i: number) {
    const p = this.pellets[i];
    p.x = 10 + this.rng.int(WORLD - 20);
    p.y = 10 + this.rng.int(WORLD - 20);
    p.alive = true;
    this.buckets[this.bucketOf(p.x, p.y)].push(i);
  }
  /** Eat pellets within radius r of (x, y); returns mass gained. */
  private eatPellets(x: number, y: number, r: number, player: boolean): number {
    let gained = 0;
    const r2 = r * r;
    const gx0 = Math.max(0, Math.floor((x - r) / GRID)), gx1 = Math.min(GW - 1, Math.floor((x + r) / GRID));
    const gy0 = Math.max(0, Math.floor((y - r) / GRID)), gy1 = Math.min(GW - 1, Math.floor((y + r) / GRID));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      const b = this.buckets[gy * GW + gx];
      for (let k = b.length - 1; k >= 0; k--) {
        const i = b[k];
        const p = this.pellets[i];
        const dx = p.x - x, dy = p.y - y;
        if (dx * dx + dy * dy >= r2) continue;
        b[k] = b[b.length - 1];
        b.pop();
        p.alive = false;
        this.dead.push(i);
        const m = p.coin ? COIN_MASS : 1;
        gained += m;
        if (player) this.events.push(p.coin ? { t: "coin", sfx: "brick", wx: p.x, wy: p.y, c: p.c } : { t: "pellet", wx: p.x, wy: p.y, c: p.c });
      }
    }
    return gained;
  }
  private nearestPellet(x: number, y: number, range: number): Pellet | null {
    let best: Pellet | null = null;
    let bd = range * range;
    const gx0 = Math.max(0, Math.floor((x - range) / GRID)), gx1 = Math.min(GW - 1, Math.floor((x + range) / GRID));
    const gy0 = Math.max(0, Math.floor((y - range) / GRID)), gy1 = Math.min(GW - 1, Math.floor((y + range) / GRID));
    for (let gy = gy0; gy <= gy1; gy++) for (let gx = gx0; gx <= gx1; gx++) {
      for (const i of this.buckets[gy * GW + gx]) {
        const p = this.pellets[i];
        const dx = p.x - x, dy = p.y - y;
        const d = dx * dx + dy * dy - (p.coin ? 3000 : 0);
        if (d < bd) { bd = d; best = p; }
      }
    }
    return best;
  }

  // ---- bots ----
  private spawnBot(b: Bot, mass: number) {
    let x = 0, y = 0;
    for (let tries = 0; tries < 12; tries++) {
      x = 100 + this.rng.int(WORLD - 200);
      y = 100 + this.rng.int(WORLD - 200);
      let ok = true;
      for (const c of this.cells) {
        const dx = c.x - x, dy = c.y - y;
        const keep = 450 + radiusOf(c.mass) * 2;
        if (dx * dx + dy * dy < keep * keep) ok = false;
      }
      if (ok) break;
    }
    b.x = x; b.y = y; b.mass = mass; b.alive = true; b.vx = 0; b.vy = 0;
    this.randomDir(b);
  }
  private randomDir(b: Bot) {
    // Uniform-ish direction without trig: random point in the unit square, normalised.
    for (let k = 0; k < 4; k++) {
      const dx = this.rng.int(201) - 100, dy = this.rng.int(201) - 100;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 20) { b.dx = dx / l; b.dy = dy / l; return; }
    }
    b.dx = 1; b.dy = 0;
  }

  private entities(): Ent[] {
    const out: Ent[] = [];
    for (const c of this.cells) out.push({ x: c.x, y: c.y, mass: c.mass, r: radiusOf(c.mass), bot: null, cell: c });
    for (const b of this.bots) if (b.alive) out.push({ x: b.x, y: b.y, mass: b.mass, r: radiusOf(b.mass), bot: b, cell: null });
    return out;
  }

  private think(b: Bot, ents: Ent[]) {
    const r = radiusOf(b.mass);
    const sense = 260 + r * 3;
    let fx = 0, fy = 0, flee = false;
    let prey: Ent | null = null, preyScore = 0;
    for (const e of ents) {
      if (e.bot === b) continue;
      const dx = e.x - b.x, dy = e.y - b.y;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > sense + e.r || d < 0.001) continue;
      if (e.mass >= b.mass * EAT_RATIO) {
        const w = (sense + e.r - d) / sense;
        fx -= (dx / d) * w;
        fy -= (dy / d) * w;
        flee = true;
      } else if (b.mass >= e.mass * EAT_RATIO) {
        // Prefer big, close prey; the player counts a little extra.
        const s = (e.mass + (e.cell ? 15 : 0)) / (d + 60);
        if (s > preyScore) { preyScore = s; prey = e; }
      }
    }
    if (flee) {
      // Lean away from walls while fleeing.
      const m = 200;
      if (b.x < m) fx += (m - b.x) / m;
      if (b.x > WORLD - m) fx -= (b.x - (WORLD - m)) / m;
      if (b.y < m) fy += (m - b.y) / m;
      if (b.y > WORLD - m) fy -= (b.y - (WORLD - m)) / m;
      const l = Math.sqrt(fx * fx + fy * fy);
      if (l > 0.0001) { b.dx = fx / l; b.dy = fy / l; return; }
    }
    if (prey && this.rng.int(100) < 80) {
      const dx = prey.x - b.x, dy = prey.y - b.y;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 0.0001) { b.dx = dx / l; b.dy = dy / l; return; }
    }
    const p = this.nearestPellet(b.x, b.y, 280);
    if (p && this.rng.int(100) < 85) {
      const dx = p.x - b.x, dy = p.y - b.y;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 0.0001) { b.dx = dx / l; b.dy = dy / l; return; }
    }
    if (this.rng.int(4) === 0) this.randomDir(b);
    if (b.x < r + 40 && b.dx < 0) b.dx = -b.dx;
    if (b.x > WORLD - r - 40 && b.dx > 0) b.dx = -b.dx;
    if (b.y < r + 40 && b.dy < 0) b.dy = -b.dy;
    if (b.y > WORLD - r - 40 && b.dy > 0) b.dy = -b.dy;
  }

  // ---- player ----
  private totalMass() {
    let m = 0;
    for (const c of this.cells) m += c.mass;
    return m;
  }
  private centroid(): [number, number] {
    let m = 0, x = 0, y = 0;
    for (const c of this.cells) { m += c.mass; x += c.x * c.mass; y += c.y * c.mass; }
    return m > 0 ? [x / m, y / m] : [WORLD / 2, WORLD / 2];
  }

  private split(tx: number, ty: number) {
    const n = this.cells.length;
    let did = false;
    for (let i = 0; i < n && this.cells.length < MAX_CELLS; i++) {
      const c = this.cells[i];
      if (c.mass < MIN_SPLIT) continue;
      let dx = tx - c.x, dy = ty - c.y;
      let l = Math.sqrt(dx * dx + dy * dy);
      if (l < 1) { dx = this.dirX; dy = this.dirY; l = 1; }
      dx /= l; dy /= l;
      const half = c.mass / 2;
      c.mass = half;
      c.merge = MERGE_FRAMES;
      const imp = 11 + Math.sqrt(half) * 0.35;
      this.cells.push({ id: this.nextId++, x: c.x + dx * 4, y: c.y + dy * 4, mass: half, vx: dx * imp, vy: dy * imp, merge: MERGE_FRAMES });
      did = true;
    }
    if (did) this.events.push({ t: "split", sfx: "launch", n: this.cells.length });
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    if (this.frame > 1 && (inp.x !== this.px || inp.y !== this.py)) { this.pointerMode = true; this.started = true; }
    this.px = inp.x;
    this.py = inp.y;
    const arrows = inp.b & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT);
    if (arrows) { this.pointerMode = false; this.started = true; }

    // Movement target in world units.
    const [cx, cy] = this.centroid();
    const zoom = zoomFor(this.totalMass());
    let tx = cx, ty = cy;
    if (arrows) {
      let ax = 0, ay = 0;
      if (inp.b & BTN.LEFT) ax -= 1;
      if (inp.b & BTN.RIGHT) ax += 1;
      if (inp.b & BTN.UP) ay -= 1;
      if (inp.b & BTN.DOWN) ay += 1;
      const k = ax !== 0 && ay !== 0 ? 0.70710678 : 1;
      tx = cx + ax * k * 400;
      ty = cy + ay * k * 400;
    } else if (this.pointerMode) {
      tx = cx + (inp.x - W / 2) / zoom;
      ty = cy + (inp.y - H / 2) / zoom;
    }
    {
      const dx = tx - cx, dy = ty - cy;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 2) { this.dirX = dx / l; this.dirY = dy / l; }
    }

    // Split on a tap (short FIRE press, so touch-dragging never splits) or ALT.
    if (inp.b & BTN.FIRE) this.held++;
    let doSplit = (pressed & BTN.ALT) !== 0;
    if (released & BTN.FIRE) {
      if (this.held <= TAP_FRAMES) doSplit = true;
      this.held = 0;
    }
    this.prevB = inp.b;
    if (doSplit) { this.started = true; this.split(tx, ty); }

    // Move player cells.
    for (const c of this.cells) {
      const dx = tx - c.x, dy = ty - c.y;
      const l = Math.sqrt(dx * dx + dy * dy);
      if (l > 0.5) {
        const s = speedOf(c.mass) * Math.min(1, l / 40);
        c.x += (dx / l) * s;
        c.y += (dy / l) * s;
      }
      c.x += c.vx;
      c.y += c.vy;
      c.vx *= 0.88;
      c.vy *= 0.88;
      if (c.merge > 0) c.merge--;
      c.x = Math.max(0, Math.min(WORLD, c.x));
      c.y = Math.max(0, Math.min(WORLD, c.y));
    }
    // Split cells push apart until they may merge, then merge on overlap.
    for (let i = 0; i < this.cells.length; i++) {
      for (let j = i + 1; j < this.cells.length; j++) {
        const a = this.cells[i], b = this.cells[j];
        const ra = radiusOf(a.mass), rb = radiusOf(b.mass);
        let dx = b.x - a.x, dy = b.y - a.y;
        let d = Math.sqrt(dx * dx + dy * dy);
        if (a.merge > 0 || b.merge > 0) {
          const ov = ra + rb - d;
          if (ov > 0) {
            if (d < 0.01) { dx = 1; dy = 0; d = 1; }
            const push = ov * 0.25;
            a.x -= (dx / d) * push; a.y -= (dy / d) * push;
            b.x += (dx / d) * push; b.y += (dy / d) * push;
          }
        } else if (d < Math.max(ra, rb)) {
          const big = a.mass >= b.mass ? a : b, small = big === a ? b : a;
          big.x = (big.x * big.mass + small.x * small.mass) / (big.mass + small.mass);
          big.y = (big.y * big.mass + small.y * small.mass) / (big.mass + small.mass);
          big.mass += small.mass;
          this.cells.splice(this.cells.indexOf(small), 1);
          this.events.push({ t: "merge", sfx: "paddle", wx: big.x, wy: big.y });
          j = i; // restart inner loop for this cell
        }
      }
    }

    // Bots: think staggered, then move.
    let ents = this.entities();
    for (let i = 0; i < this.bots.length; i++) {
      const b = this.bots[i];
      if (!b.alive) {
        if (--b.respawn <= 0) this.spawnBot(b, this.rng.range(10, 40) + Math.min(120, Math.floor(this.frame / 1800) * 10));
        continue;
      }
      if ((this.frame + i) % BOT_THINK === 0) this.think(b, ents);
      const s = speedOf(b.mass) * 0.88;
      b.x = Math.max(0, Math.min(WORLD, b.x + b.dx * s));
      b.y = Math.max(0, Math.min(WORLD, b.y + b.dy * s));
    }

    // Pellets.
    for (const c of this.cells) c.mass += this.eatPellets(c.x, c.y, radiusOf(c.mass), true);
    for (const b of this.bots) if (b.alive) b.mass += this.eatPellets(b.x, b.y, radiusOf(b.mass), false);

    // Blob vs blob.
    ents = this.entities();
    for (const a of ents) {
      if (a.mass <= 0) continue;
      for (const e of ents) {
        if (e === a || e.mass <= 0 || (a.cell && e.cell)) continue;
        if (a.mass < e.mass * EAT_RATIO) continue;
        const dx = e.x - a.x, dy = e.y - a.y;
        const reach = a.r - e.r * 0.4;
        if (reach <= 0 || dx * dx + dy * dy >= reach * reach) continue;
        // a eats e
        a.mass += e.mass;
        a.r = radiusOf(a.mass);
        if (a.cell) a.cell.mass = a.mass;
        if (a.bot) a.bot.mass = a.mass;
        if (e.bot) {
          e.bot.alive = false;
          e.bot.respawn = BOT_RESPAWN;
          if (a.cell) this.events.push({ t: "eatBot", sfx: e.mass >= 60 ? "extraGood" : "brickgone", mood: "happy", shake: e.mass >= 60 ? 6 : 3, wx: e.x, wy: e.y, mass: Math.floor(e.mass), name: e.bot.name, color: e.bot.color });
          else this.events.push({ t: "botEat", wx: e.x, wy: e.y, color: e.bot.color });
        } else if (e.cell) {
          this.cells.splice(this.cells.indexOf(e.cell), 1);
          const last = this.cells.length === 0;
          this.events.push({ t: "cellLost", sfx: last ? "explode" : "lost", mood: "sad", shake: last ? 10 : 5, wx: e.x, wy: e.y, name: a.bot ? a.bot.name : "" });
          if (last) this.killer = a.bot ? a.bot.name : "";
        }
        e.mass = 0;
      }
    }

    // Respawn eaten pellets gradually.
    for (let k = 0; k < 3 && this.dead.length; k++) this.placePellet(this.dead.shift()!);

    // Slow decay keeps giants in check.
    for (const c of this.cells) if (c.mass > 150) c.mass -= (c.mass - 150) * 0.00005;
    for (const b of this.bots) if (b.alive && b.mass > 150) b.mass -= (b.mass - 150) * 0.0001;

    const total = this.totalMass();
    if (Math.floor(total) > this.maxMass) this.maxMass = Math.floor(total);
    while (this.level < MILESTONES.length && this.maxMass >= MILESTONES[this.level]) {
      this.level++;
      this.events.push({ t: "milestone", sfx: "levelclear", toast: "levelClear", mood: "happy", mass: MILESTONES[this.level - 1] });
    }

    if (this.cells.length === 0) {
      this.over = true;
      this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
    } else if (this.frame >= blob.maxFrames) {
      this.over = true;
      this.won = this.rank() === 1;
      this.events.push(this.won ? { t: "won", sfx: "won", mood: "happy" } : { t: "gameover", sfx: "gameover" });
    }
  }

  private rank() {
    const me = this.totalMass();
    let r = 1;
    for (const b of this.bots) if (b.alive && b.mass > me) r++;
    return r;
  }

  view(): BlobView {
    const [cx, cy] = this.centroid();
    const mass = this.totalMass();
    const lb = this.bots.filter((b) => b.alive).map((b) => ({ name: b.name, mass: Math.floor(b.mass), me: false }));
    if (this.cells.length) lb.push({ name: "", mass: Math.floor(mass), me: true });
    lb.sort((a, b) => b.mass - a.mass || (a.me ? -1 : b.me ? 1 : 0));
    return {
      frame: this.frame,
      zoom: zoomFor(mass > 0 ? mass : this.maxMass),
      cx,
      cy,
      cells: this.cells.map((c) => ({ id: c.id, x: c.x, y: c.y, mass: c.mass, r: radiusOf(c.mass), merge: c.merge })),
      bots: this.bots.map((b) => ({ id: b.id, name: b.name, x: b.x, y: b.y, mass: b.mass, r: radiusOf(b.mass), color: b.color, alive: b.alive, dx: b.dx, dy: b.dy })),
      pellets: this.pellets,
      leaderboard: lb,
      mass: Math.floor(mass),
      maxMass: this.maxMass,
      rank: this.cells.length ? this.rank() : 0,
      dead: this.cells.length === 0,
      killer: this.killer,
      over: this.over,
      won: this.won,
      pointerMode: this.pointerMode,
      started: this.started,
    };
  }
  hud(): Hud {
    return { score: this.maxMass, level: this.level + 1, label: this.cells.length ? `Mass ${Math.floor(this.totalMass())} · #${this.rank()}` : "Eaten" };
  }
  result(): GameResult {
    return { score: this.maxMass, level: this.level, levelsCleared: this.level, frames: this.frame, status: this.won ? "won" : this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

export const blob: GameDef<BlobView> = {
  id: "blob",
  name: "Blob Grow",
  tagline: "Eat the small fry, dodge the big FUD. Grow until you rule the arena.",
  genre: "Arena eater",
  session: "2–10 min",
  controls: "Move the pointer / drag (or arrows) to steer. Tap, click or Space to split.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 10 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the eat-and-grow arena genre: single player against deterministic AI blobs, pellets, split and merge. No code, names, art or sounds from any existing game.",
  },
  create: (seed) => new BlobEngine(seed),
  bot(v, frame) {
    // Simple autoplayer: flee nearby bigger blobs, chase smaller ones, else graze.
    // Imperfect on purpose: short danger radius, ignores walls and split cells.
    const out = { x: W / 2, y: H / 2, b: 0 };
    if (!v.cells.length) return out;
    let big = v.cells[0];
    for (const c of v.cells) if (c.mass > big.mass) big = c;
    const mx = v.cx, my = v.cy;
    let fx = 0, fy = 0, flee = false;
    let prey: BotV | null = null, pd = Infinity;
    for (const b of v.bots) {
      if (!b.alive) continue;
      const dx = b.x - mx, dy = b.y - my;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (b.mass >= big.mass * EAT_RATIO) {
        if (d < 110 + b.r + big.r && d > 0.01) { fx -= dx / d; fy -= dy / d; flee = true; }
      } else if (big.mass >= b.mass * EAT_RATIO * 1.05 && d < 320 && d < pd) { pd = d; prey = b; }
    }
    let tx = 0, ty = 0;
    if (flee) { tx = fx; ty = fy; }
    else if (prey) {
      tx = prey.x - mx; ty = prey.y - my;
      if (big.mass >= prey.mass * 2.6 && pd < 90 + big.r && v.cells.length < 2 && frame % 30 === 0) out.b = BTN.FIRE;
    } else {
      let bd = Infinity;
      for (const p of v.pellets) {
        if (!p.alive) continue;
        const dx = p.x - mx, dy = p.y - my;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; tx = dx; ty = dy; }
      }
    }
    const l = Math.sqrt(tx * tx + ty * ty);
    if (l > 0.001) {
      out.x = Math.round(W / 2 + (tx / l) * 120);
      out.y = Math.round(H / 2 + (ty / l) * 120);
    }
    return out;
  },
};
