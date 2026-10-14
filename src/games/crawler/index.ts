/*
 * Candle Crawler: an original segmented-crawler shooter.
 * ArcadePad, GPL-3.0-or-later. Written from scratch; no code or assets ported.
 *
 * Rules: a long chain of red candles snakes down a field of money bags. Each
 * candle steps sideways one cell at a time; when the next cell is a wall or a
 * bag it drops a row and reverses. Shooting a candle splits the chain (the
 * candle behind becomes a new head) and leaves a fresh bag where it died; heads
 * are worth more. In the bottom zone the candles bounce up and down, and new
 * heads crawl in from the sides if they linger. The coin mascot roams the
 * bottom zone and auto-fires one shot at a time. Extra critters: a bouncing
 * bear in the player zone (closer = more points), a dumper that drops straight
 * down planting bags when the bottom gets bare, and a sweeper that crosses the
 * field clearing bags. Waves get longer and faster. 3 lives; at each life loss
 * every damaged bag is restored for a bonus.
 *
 * Determinism: one seeded Rng, + - * / and floor only, fixed 60 Hz step.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;
export const COLS = 24;
export const CELL = 15;
export const ROWS = 40;
/** First row of the player zone. */
export const PZ_ROW = 32;
export const PZ_Y = PZ_ROW * CELL;
export const BAG_HP = 4;

const START_LIVES = 3;
const READY_FRAMES = 60;
const DEATH_FRAMES = 90;
const SHOT_SPEED = 12; // px per frame, in 4 sub-steps
const SHOT_SUB = 4;
const KEY_SPEED = 4;
const FOLLOW_SPEED = 14;
export const PLAYER_START = { x: W / 2, y: H - 20 };
const PX_MIN = 8, PX_MAX = W - 8, PY_MIN = PZ_Y + 8, PY_MAX = H - 8;
const SEG_HIT = 7; // half-size of a candle for shots
const PLAYER_HIT = 11; // centre distance for touching a candle

export const POINTS = { body: 10, head: 100, bag: 1, flea: 200, scout: 500, restore: 5 } as const;

export interface Seg { c: number; r: number; pc: number; pr: number; dir: number; vdir: number }
export interface Mover { x: number; y: number; vx: number; vy: number }

export interface CrawlerView {
  frame: number;
  wave: number; // 0-based
  score: number;
  lives: number;
  /** Candle centres in px, chain order; head = first of its chain. */
  segs: { x: number; y: number; head: boolean; dir: number; chain: number }[];
  /** Bag hit points per cell (r * COLS + c), 0 = empty. */
  bags: number[];
  shot: { x: number; y: number } | null;
  player: { x: number; y: number; alive: boolean };
  bear: Mover | null;
  flea: Mover | null;
  scout: Mover | null;
  ready: number;
  dying: number;
  over: boolean;
}

class CrawlerEngine implements GameEngine<CrawlerView> {
  private rng: Rng;
  private bags = new Uint8Array(COLS * ROWS);
  private chains: Seg[][] = [];
  private counter = 0;
  private wave = 0;
  private wavesCleared = 0;
  private score = 0;
  private lives = START_LIVES;
  private px = PLAYER_START.x;
  private py = PLAYER_START.y;
  private tx = PLAYER_START.x;
  private ty = PLAYER_START.y;
  private lastPX = PLAYER_START.x;
  private lastPY = PLAYER_START.y;
  private shot: { x: number; y: number } | null = null;
  private bear: Mover | null = null;
  private bearTimer = 0;
  private flea: Mover | null = null;
  private fleaRow = -1;
  private fleaTimer = 0;
  private scout: Mover | null = null;
  private scoutTimer = 0;
  private zoneTimer = 0;
  private ready = READY_FRAMES;
  private dying = 0;
  private over = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    let placed = 0;
    while (placed < 42) {
      const r = 2 + this.rng.int(ROWS - 4);
      const c = this.rng.int(COLS);
      if (r >= PZ_ROW && this.rng.int(2)) continue;
      if (this.bags[r * COLS + c]) continue;
      this.bags[r * COLS + c] = BAG_HP;
      placed++;
    }
    this.startWave();
  }

  // ---- setup ----

  private interval() {
    return Math.max(3, 6 - Math.floor(this.wave / 2));
  }

  private startWave() {
    const len = Math.min(20, 10 + 2 * this.wave);
    const extra = Math.min(4, Math.floor(this.wave / 2));
    this.buildCrawler(len, extra);
    this.resetCritters();
  }

  private buildCrawler(len: number, extra: number) {
    this.chains = [];
    this.counter = 0;
    const flip = this.rng.int(2) === 1;
    const chain: Seg[] = [];
    for (let i = 0; i < len; i++) {
      const c = flip ? COLS - len + i : len - 1 - i;
      chain.push({ c, r: 0, pc: c, pr: 0, dir: flip ? -1 : 1, vdir: 1 });
    }
    if (chain.length) this.chains.push(chain);
    for (let i = 0; i < extra; i++) {
      const c = this.rng.int(COLS);
      this.chains.push([{ c, r: 1, pc: c, pr: 1, dir: this.rng.int(2) ? 1 : -1, vdir: 1 }]);
    }
  }

  private resetCritters() {
    this.shot = null;
    this.bear = null;
    this.flea = null;
    this.scout = null;
    this.bearTimer = 240 + this.rng.int(300);
    this.fleaTimer = 180 + this.rng.int(240);
    this.scoutTimer = 600 + this.rng.int(600);
    this.zoneTimer = 0;
  }

  private segCount() {
    let n = 0;
    for (const ch of this.chains) n += ch.length;
    return n;
  }

  private segPos(s: Seg) {
    const f = this.counter / this.interval();
    return { x: (s.pc + (s.c - s.pc) * f) * CELL + CELL / 2, y: (s.pr + (s.r - s.pr) * f) * CELL + CELL / 2 };
  }

  // ---- step ----

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    if (this.dying > 0) {
      if (--this.dying === 0) this.afterDeath();
      return;
    }
    this.movePlayer(inp);
    this.fire();
    this.moveShot();
    if (this.segCount() === 0) {
      this.clearWave();
      return;
    }
    if (this.ready > 0) this.ready--;
    else {
      this.moveCrawler();
      this.moveBear();
      this.moveFlea();
      this.moveScout();
      this.zoneSpawn();
    }
    this.checkPlayer();
    if (!this.over && this.frame >= crawler.maxFrames) this.endGame();
  }

  private movePlayer(inp: Input) {
    const keys = inp.b & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN);
    if (keys) {
      if (inp.b & BTN.LEFT) this.px -= KEY_SPEED;
      if (inp.b & BTN.RIGHT) this.px += KEY_SPEED;
      if (inp.b & BTN.UP) this.py -= KEY_SPEED;
      if (inp.b & BTN.DOWN) this.py += KEY_SPEED;
      this.px = Math.max(PX_MIN, Math.min(PX_MAX, this.px));
      this.py = Math.max(PY_MIN, Math.min(PY_MAX, this.py));
      this.tx = this.px;
      this.ty = this.py;
    } else {
      if (inp.x !== this.lastPX || inp.y !== this.lastPY) {
        this.tx = Math.max(PX_MIN, Math.min(PX_MAX, inp.x));
        this.ty = Math.max(PY_MIN, Math.min(PY_MAX, inp.y));
      }
      this.px += Math.max(-FOLLOW_SPEED, Math.min(FOLLOW_SPEED, this.tx - this.px));
      this.py += Math.max(-FOLLOW_SPEED, Math.min(FOLLOW_SPEED, this.ty - this.py));
    }
    this.lastPX = inp.x;
    this.lastPY = inp.y;
  }

  /** Auto-fire: one shot on screen at a time (FIRE does the same). */
  private fire() {
    if (this.shot) return;
    this.shot = { x: this.px, y: this.py - 10 };
    this.events.push({ t: "shot", x: this.px, y: this.py - 10 });
  }

  private moveShot() {
    const s = this.shot;
    if (!s) return;
    for (let k = 0; k < SHOT_SUB; k++) {
      s.y -= SHOT_SPEED / SHOT_SUB;
      if (s.y < 0) {
        this.shot = null;
        return;
      }
      if (this.shotHits(s.x, s.y)) {
        this.shot = null;
        return;
      }
    }
  }

  private shotHits(x: number, y: number): boolean {
    for (let ci = 0; ci < this.chains.length; ci++) {
      const ch = this.chains[ci];
      for (let si = 0; si < ch.length; si++) {
        const p = this.segPos(ch[si]);
        if (Math.abs(p.x - x) <= SEG_HIT && Math.abs(p.y - y) <= SEG_HIT) {
          this.killSeg(ci, si);
          return true;
        }
      }
    }
    const b = this.bear;
    if (b && Math.abs(b.x - x) <= 11 && Math.abs(b.y - y) <= 9) {
      const dy = Math.abs(b.y - this.py);
      const pts = dy < 24 ? 900 : dy < 60 ? 600 : 300;
      this.score += pts;
      this.events.push({ t: "bear", sfx: "explode", mood: "happy", shake: 5, x: b.x, y: b.y, points: pts });
      this.bear = null;
      this.bearTimer = 200 + this.rng.int(300);
      return true;
    }
    const f = this.flea;
    if (f && Math.abs(f.x - x) <= 7 && Math.abs(f.y - y) <= 8) {
      this.score += POINTS.flea;
      this.events.push({ t: "flea", sfx: "explode", shake: 3, x: f.x, y: f.y, points: POINTS.flea });
      this.flea = null;
      this.fleaTimer = 120 + this.rng.int(240);
      return true;
    }
    const sc = this.scout;
    if (sc && Math.abs(sc.x - x) <= 11 && Math.abs(sc.y - y) <= 7) {
      this.score += POINTS.scout;
      this.events.push({ t: "scout", sfx: "explode", mood: "happy", shake: 4, x: sc.x, y: sc.y, points: POINTS.scout });
      this.scout = null;
      this.scoutTimer = 700 + this.rng.int(600);
      return true;
    }
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS && this.bags[r * COLS + c] > 0) {
      const i = r * COLS + c;
      this.bags[i]--;
      const gone = this.bags[i] === 0;
      if (gone) this.score += POINTS.bag;
      this.events.push({ t: "chip", sfx: gone ? "brickgone" : "brick", x: c * CELL + CELL / 2, y: r * CELL + CELL / 2, gone });
      return true;
    }
    return false;
  }

  private killSeg(ci: number, si: number) {
    const ch = this.chains[ci];
    const s = ch[si];
    const head = si === 0;
    const pts = head ? POINTS.head : POINTS.body;
    this.score += pts;
    const p = this.segPos(s);
    // A bag grows where the candle died (the cell it was nearest to).
    const near = this.counter * 2 < this.interval();
    const bc = near ? s.pc : s.c, br = near ? s.pr : s.r;
    if (br >= 0 && br < ROWS && !this.bags[br * COLS + bc]) this.bags[br * COLS + bc] = BAG_HP;
    const front = ch.slice(0, si);
    const back = ch.slice(si + 1);
    const repl: Seg[][] = [];
    if (front.length) repl.push(front);
    if (back.length) repl.push(back);
    this.chains.splice(ci, 1, ...repl);
    this.events.push({ t: "kill", sfx: head ? "explode" : "brickgone", head, shake: head ? 3 : 0, x: p.x, y: p.y, points: pts, split: front.length > 0 && back.length > 0 });
  }

  private moveCrawler() {
    if (++this.counter < this.interval()) return;
    this.counter = 0;
    for (const ch of this.chains) for (const s of ch) this.advance(s);
  }

  /** One cell move: sideways, or drop a row and reverse at a wall or bag. */
  private advance(s: Seg) {
    s.pc = s.c;
    s.pr = s.r;
    const nc = s.c + s.dir;
    if (nc >= 0 && nc < COLS && !this.bags[s.r * COLS + nc]) {
      s.c = nc;
      return;
    }
    let nr = s.r + s.vdir;
    if (nr >= ROWS) {
      s.vdir = -1;
      nr = s.r - 1;
    } else if (s.vdir < 0 && nr < PZ_ROW) {
      s.vdir = 1;
      nr = s.r + 1;
    }
    s.r = nr;
    s.dir = -s.dir;
  }

  private moveBear() {
    const b = this.bear;
    if (!b) {
      if (--this.bearTimer > 0) return;
      const dir = this.rng.int(2) ? 1 : -1;
      const speed = this.wave >= 3 ? 3 : 2;
      this.bear = { x: dir > 0 ? -12 : W + 12, y: PZ_Y + 10 + this.rng.int(100), vx: dir * speed, vy: this.rng.int(2) ? 3 : -3 };
      this.events.push({ t: "bearin", x: this.bear.x, y: this.bear.y });
      return;
    }
    b.x += b.vx;
    b.y += b.vy;
    if (b.y < PZ_Y - 30) { b.y = PZ_Y - 30; b.vy = -b.vy; }
    if (b.y > H - 10) { b.y = H - 10; b.vy = -b.vy; }
    if (this.frame % 20 === 0) {
      const opts = [-3, -2, 2, 3];
      b.vy = opts[this.rng.int(4)];
    }
    // Bears munch bags they trample.
    const c = Math.floor(b.x / CELL), r = Math.floor(b.y / CELL);
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS && this.bags[r * COLS + c] && this.rng.int(10) === 0) {
      this.bags[r * COLS + c] = 0;
      this.events.push({ t: "munch", x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
    }
    if (b.x < -20 || b.x > W + 20) {
      this.bear = null;
      this.bearTimer = 200 + this.rng.int(300);
    }
  }

  private zoneBags() {
    let n = 0;
    for (let i = PZ_ROW * COLS; i < ROWS * COLS; i++) if (this.bags[i]) n++;
    return n;
  }

  private moveFlea() {
    const f = this.flea;
    if (!f) {
      if (this.wave < 1 || this.zoneBags() >= 5) return;
      if (--this.fleaTimer > 0) return;
      const c = this.rng.int(COLS);
      this.flea = { x: c * CELL + CELL / 2, y: -8, vx: 0, vy: this.wave >= 4 ? 5 : 4 };
      this.fleaRow = -1;
      this.events.push({ t: "fleain", x: this.flea.x, y: 0 });
      return;
    }
    f.y += f.vy;
    const r = Math.floor(f.y / CELL);
    if (r !== this.fleaRow) {
      this.fleaRow = r;
      const c = Math.floor(f.x / CELL);
      if (r >= 2 && r < ROWS - 2 && !this.bags[r * COLS + c] && this.rng.int(4) === 0) {
        this.bags[r * COLS + c] = BAG_HP;
        this.events.push({ t: "plant", x: f.x, y: r * CELL + CELL / 2 });
      }
    }
    if (f.y > H + 10) {
      this.flea = null;
      this.fleaTimer = 120 + this.rng.int(240);
    }
  }

  private moveScout() {
    const s = this.scout;
    if (!s) {
      if (this.wave < 1) return;
      if (--this.scoutTimer > 0) return;
      const dir = this.rng.int(2) ? 1 : -1;
      const r = 3 + this.rng.int(18);
      this.scout = { x: dir > 0 ? -12 : W + 12, y: r * CELL + CELL / 2, vx: dir * 2, vy: 0 };
      this.events.push({ t: "scoutin", x: this.scout.x, y: this.scout.y });
      return;
    }
    s.x += s.vx;
    const c = Math.floor(s.x / CELL), r = Math.floor(s.y / CELL);
    if (c >= 0 && c < COLS && this.bags[r * COLS + c]) {
      this.bags[r * COLS + c] = 0;
      this.events.push({ t: "sweep", x: c * CELL + CELL / 2, y: s.y });
    }
    if (s.x < -20 || s.x > W + 20) {
      this.scout = null;
      this.scoutTimer = 700 + this.rng.int(600);
    }
  }

  /** Candles that linger in the player zone call in fresh heads from the sides. */
  private zoneSpawn() {
    let inZone = false;
    for (const ch of this.chains) for (const s of ch) if (s.r >= PZ_ROW) inZone = true;
    if (!inZone) {
      this.zoneTimer = 0;
      return;
    }
    if (++this.zoneTimer < 420) return;
    this.zoneTimer = 0;
    if (this.segCount() >= 30) return;
    const left = this.rng.int(2) === 0;
    const r = PZ_ROW + this.rng.int(5);
    const c = left ? 0 : COLS - 1;
    this.chains.push([{ c, r, pc: c, pr: r, dir: left ? 1 : -1, vdir: 1 }]);
    this.events.push({ t: "newhead", x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 });
  }

  private checkPlayer() {
    for (const ch of this.chains) for (const s of ch) {
      const p = this.segPos(s);
      if (Math.abs(p.x - this.px) < PLAYER_HIT && Math.abs(p.y - this.py) < PLAYER_HIT) return this.playerHit();
    }
    const b = this.bear;
    if (b && Math.abs(b.x - this.px) < 15 && Math.abs(b.y - this.py) < 13) return this.playerHit();
    const f = this.flea;
    if (f && Math.abs(f.x - this.px) < 10 && Math.abs(f.y - this.py) < 12) return this.playerHit();
  }

  private playerHit() {
    this.lives--;
    this.dying = DEATH_FRAMES;
    this.shot = null;
    const last = this.lives <= 0;
    this.events.push({ t: "hit", sfx: "lost", mood: "sad", toast: last ? undefined : "lifeLost", shake: 10, x: this.px, y: this.py });
  }

  private afterDeath() {
    // Restore every damaged bag for a bonus.
    const cells: number[] = [];
    for (let i = 0; i < this.bags.length; i++) {
      if (this.bags[i] > 0 && this.bags[i] < BAG_HP) {
        this.bags[i] = BAG_HP;
        cells.push(i);
      }
    }
    const bonus = cells.length * POINTS.restore;
    this.score += bonus;
    if (cells.length) this.events.push({ t: "restore", sfx: "extraGood", cells, bonus, x: W / 2, y: H / 2 });
    if (this.lives <= 0) return this.endGame();
    const n = this.segCount();
    const main = Math.min(n, 20);
    this.buildCrawler(main, n - main);
    this.resetCritters();
    this.px = this.tx = PLAYER_START.x;
    this.py = this.ty = PLAYER_START.y;
    // Keep the respawn spot clear.
    for (let r = ROWS - 3; r < ROWS; r++) for (let c = 10; c < 14; c++) this.bags[r * COLS + c] = 0;
    this.ready = READY_FRAMES;
    this.events.push({ t: "respawn", x: this.px, y: this.py });
  }

  private clearWave() {
    const bonus = 100 * (this.wave + 1);
    this.score += bonus;
    this.wavesCleared++;
    this.wave++;
    this.startWave();
    this.ready = READY_FRAMES;
    this.events.push({ t: "waveclear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus, wave: this.wave, x: W / 2, y: H / 2 });
  }

  private endGame() {
    this.over = true;
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  view(): CrawlerView {
    const segs: CrawlerView["segs"] = [];
    this.chains.forEach((ch, ci) => ch.forEach((s, i) => {
      const p = this.segPos(s);
      segs.push({ x: p.x, y: p.y, head: i === 0, dir: s.dir, chain: ci });
    }));
    return {
      frame: this.frame,
      wave: this.wave,
      score: this.score,
      lives: this.lives,
      segs,
      bags: Array.from(this.bags),
      shot: this.shot ? { ...this.shot } : null,
      player: { x: this.px, y: this.py, alive: this.dying === 0 && !this.over },
      bear: this.bear ? { ...this.bear } : null,
      flea: this.flea ? { ...this.flea } : null,
      scout: this.scout ? { ...this.scout } : null,
      ready: this.ready,
      dying: this.dying,
      over: this.over,
    };
  }
  hud(): Hud {
    return { score: this.score, lives: Math.max(0, this.lives), level: this.wave + 1, label: `Wave ${this.wave + 1}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.wave, levelsCleared: this.wavesCleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

export { CrawlerEngine };

export const crawler: GameDef<CrawlerView> = {
  id: "crawler",
  name: "Candle Crawler",
  tagline: "A chain of red candles is crawling down through the bags. Split it before it reaches you.",
  genre: "Crawler shooter",
  session: "2–8 min",
  controls: "Drag / mouse moves the mascot (auto-fire), or arrows + Space.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the segmented-crawler shooter genre. No code, art, sounds or names from any commercial game: red candle chains, money-bag obstacles, a bouncing bear, a bag-dropping dumper and a bag-clearing sweeper.",
  },
  create: (seed) => new CrawlerEngine(seed),
  bot(v) {
    const { x: px, y: py } = v.player;
    let target = px;
    // Chase the lowest candle, a bit sluggishly.
    let best: CrawlerView["segs"][number] | null = null;
    for (const s of v.segs) if (!best || s.y > best.y) best = s;
    if (best) target = best.x + best.dir * 6;
    // Dodge things that are close.
    const threats: { x: number; y: number }[] = [];
    for (const s of v.segs) if (s.y > py - 60) threats.push(s);
    if (v.bear) threats.push(v.bear);
    if (v.flea && v.flea.y > py - 160) threats.push(v.flea);
    for (const t of threats) {
      if (Math.abs(t.x - px) < 34 && Math.abs(t.y - py) < 60) {
        target = t.x > px ? px - 40 : px + 40;
        if (target < 20) target = px + 40;
        if (target > W - 20) target = px - 40;
        break;
      }
    }
    const step = Math.max(-3, Math.min(3, target - px));
    const x = Math.max(0, Math.min(W - 1, Math.round(px + step)));
    return { x, y: H - 12, b: BTN.FIRE };
  },
};
