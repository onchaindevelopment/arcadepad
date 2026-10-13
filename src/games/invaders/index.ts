/*
 * FUD Defense: an original fixed shooter (formation-shooter genre).
 * ArcadePad, GPL-3.0-or-later. Written from scratch; no code or assets ported.
 *
 * Rules: a 10x5 formation of FUD critters (grumpy bears, paper-hand ghosts,
 * rug monsters) marches sideways, steps down at the edges and speeds up as it
 * thins out. The bottom critter of a column drops FUD bolts. The coin mascot
 * rides a hover-pad behind four destructible coin piles. A whale cruises the
 * top now and then for mystery points. Defeated critters sometimes drop a
 * power-up coin: double shot, bubble shield or slow-mo. Waves restart lower
 * and faster. 3 lives; the formation reaching the pad ends the run.
 *
 * Determinism: integer-friendly arithmetic, one seeded Rng, fixed 60 Hz step.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 640;
export const H = 480;

// Formation
export const COLS = 10;
export const ROWS = 5;
export const EW = 30; // critter hitbox
export const EH = 24;
export const SX = 46; // column / row pitch
export const SY = 36;
export const STEP_X = 8;
export const STEP_Y = 14;
const EDGE = 10;
const START_X = Math.floor((W - ((COLS - 1) * SX + EW)) / 2);
const START_Y = 70;
/** Kind by row: 2 = rug monster (top), 1 = paper-hand ghost, 0 = grumpy bear. */
export const ROW_KIND = [2, 1, 1, 0, 0];
export const KIND_POINTS = [10, 20, 30];

// Player
export const PLAYER_Y = 444; // pad centre
export const PW = 40; // pad width
const HIT_W = 30;
const HIT_TOP = PLAYER_Y - 22;
const HIT_BOTTOM = PLAYER_Y + 8;
const PLAYER_SPEED = 6;
const KEY_SPEED = 6;
const BULLET_SPEED = 9;
const FIRE_COOLDOWN = 14;
const INVULN = 120;
const START_LIVES = 3;
const READY_FRAMES = 60;
const INTERMISSION = 120;

// Coin piles (shields)
export const CELL_W = 12;
export const CELL_H = 8;
export const PILE_X = [128, 256, 384, 512];
export const PILE_HEIGHTS = [3, 4, 5, 4, 3];
export const PILE_BOTTOM = 404;
const CELL_HP = 2;

// Whale
export const WHALE_Y = 38;
export const WHALE_W = 56;
export const WHALE_H = 22;
const WHALE_POINTS = [50, 100, 150, 300];

// Power-ups
export const POWER = { DOUBLE: 0, SHIELD: 1, SLOW: 2 } as const;
const POWER_FRAMES = [600, 900, 420];
const DROP_SPEED = 2;

const INVADE_Y = PLAYER_Y - 20;

export interface Critter { x: number; y: number; kind: number; col: number; row: number }
export interface Shot { x: number; y: number; kind: number }
export interface Cell { x: number; y: number; hp: number }
export interface Drop { x: number; y: number; kind: number }
export interface Whale { x: number; dir: number }

export interface InvadersView {
  frame: number;
  wave: number; // 0-based
  score: number;
  lives: number;
  fx: number;
  fy: number;
  dir: number;
  /** Toggles every march step (two-frame walk cycle). */
  pose: number;
  critters: Critter[];
  bullets: Shot[];
  eshots: Shot[];
  cells: Cell[];
  whale: { x: number; y: number; dir: number } | null;
  drops: Drop[];
  player: { x: number; y: number; invuln: number; alive: boolean };
  power: { double: number; shield: number; slow: number };
  ready: number; // frames until the formation starts moving
  intermission: number;
  over: boolean;
}

function hit(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number) {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

class InvadersEngine implements GameEngine<InvadersView> {
  private rng: Rng;
  private alive = new Uint8Array(COLS * ROWS);
  private aliveCount = 0;
  private fx = START_X;
  private fy = START_Y;
  private dir = 1;
  private pose = 0;
  private marchTimer = 0;
  private wave = 0;
  private wavesCleared = 0;
  private score = 0;
  private lives = START_LIVES;
  private px = W / 2;
  private tx = W / 2;
  private lastPointerX = W / 2;
  private cooldown = 0;
  private invuln = 0;
  private bullets: Shot[] = [];
  private eshots: Shot[] = [];
  private eshotTimer = 0;
  private cells: Cell[] = [];
  private whale: Whale | null = null;
  private whaleTimer = 0;
  private drops: Drop[] = [];
  private pDouble = 0;
  private pShield = 0;
  private pSlow = 0;
  private ready = READY_FRAMES;
  private intermission = 0;
  private over = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.buildWave();
    this.whaleTimer = 900 + this.rng.int(600);
  }

  private buildWave() {
    this.alive.fill(1);
    this.aliveCount = COLS * ROWS;
    this.fx = START_X;
    this.fy = START_Y + Math.min(this.wave, 5) * 14; // later waves start lower
    this.dir = 1;
    this.marchTimer = 0;
    this.bullets = [];
    this.eshots = [];
    this.drops = [];
    this.eshotTimer = 50;
    this.cells = [];
    for (const cx of PILE_X) {
      for (let i = 0; i < PILE_HEIGHTS.length; i++) {
        const x = cx - (PILE_HEIGHTS.length * CELL_W) / 2 + i * CELL_W;
        for (let j = 0; j < PILE_HEIGHTS[i]; j++) this.cells.push({ x, y: PILE_BOTTOM - (j + 1) * CELL_H, hp: CELL_HP });
      }
    }
  }

  /** Frames between march steps: fewer critters and later waves march faster. */
  private marchInterval() {
    const base = Math.max(1, 3 + Math.floor((this.aliveCount * 27) / (COLS * ROWS)) - Math.min(this.wave, 2));
    return this.pSlow > 0 ? base * 2 : base;
  }

  private ex(c: number) { return this.fx + c * SX; }
  private ey(r: number) { return this.fy + r * SY; }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;

    this.movePlayer(inp);

    if (this.intermission > 0) {
      if (--this.intermission === 0) {
        this.wave++;
        this.buildWave();
        this.ready = READY_FRAMES;
        this.events.push({ t: "wave", wave: this.wave });
      }
      return;
    }

    if (this.pDouble > 0) this.pDouble--;
    if (this.pShield > 0) this.pShield--;
    if (this.pSlow > 0) this.pSlow--;
    if (this.invuln > 0) this.invuln--;

    this.fire(inp);
    this.moveBullets();
    if (this.aliveCount === 0) return this.clearWave();

    if (this.ready > 0) this.ready--;
    else {
      if (++this.marchTimer >= this.marchInterval()) {
        this.marchTimer = 0;
        this.march();
        if (this.over) return;
      }
      this.enemyFire();
    }
    this.moveEnemyShots();
    if (this.over) return;
    this.moveWhale();
    this.moveDrops();
    if (this.frame >= invaders.maxFrames) this.endGame();
  }

  private movePlayer(inp: Input) {
    // Arrows override; otherwise follow the pointer x when it moves.
    const keys = inp.b & (BTN.LEFT | BTN.RIGHT);
    if (keys) {
      if (inp.b & BTN.LEFT) this.px -= KEY_SPEED;
      if (inp.b & BTN.RIGHT) this.px += KEY_SPEED;
      this.px = Math.max(PW / 2, Math.min(W - PW / 2, this.px));
      this.tx = this.px;
    } else {
      if (inp.x !== this.lastPointerX) this.tx = Math.max(PW / 2, Math.min(W - PW / 2, inp.x));
      const d = this.tx - this.px;
      this.px += Math.max(-PLAYER_SPEED, Math.min(PLAYER_SPEED, d));
    }
    this.lastPointerX = inp.x;
  }

  private fire(inp: Input) {
    if (this.cooldown > 0) this.cooldown--;
    if (!(inp.b & (BTN.FIRE | BTN.UP)) || this.cooldown > 0) return;
    const dbl = this.pDouble > 0;
    const max = dbl ? 4 : 2;
    if (this.bullets.length + (dbl ? 2 : 1) > max) return;
    const y = PLAYER_Y - 24;
    if (dbl) {
      this.bullets.push({ x: this.px - 9, y, kind: 1 }, { x: this.px + 9, y, kind: 1 });
    } else this.bullets.push({ x: this.px, y, kind: 0 });
    this.cooldown = FIRE_COOLDOWN;
    this.events.push({ t: "shot", sfx: "shot", x: this.px, y, double: dbl });
  }

  private moveBullets() {
    const keep: Shot[] = [];
    for (const b of this.bullets) {
      b.y -= BULLET_SPEED;
      if (b.y < -10) continue;
      if (this.bulletHits(b)) continue;
      keep.push(b);
    }
    this.bullets = keep;
  }

  /** Returns true if the bullet was used up. Bullet box: 4x10 around (x, y). */
  private bulletHits(b: Shot): boolean {
    const bx = b.x - 2, by = b.y - 5;
    // Critters
    if (hit(bx, by, 4, 10, this.fx, this.fy, (COLS - 1) * SX + EW, (ROWS - 1) * SY + EH)) {
      for (let r = ROWS - 1; r >= 0; r--) {
        for (let c = 0; c < COLS; c++) {
          if (!this.alive[r * COLS + c]) continue;
          if (!hit(bx, by, 4, 10, this.ex(c), this.ey(r), EW, EH)) continue;
          this.killCritter(c, r);
          return true;
        }
      }
    }
    // Whale
    if (this.whale && hit(bx, by, 4, 10, this.whale.x - WHALE_W / 2, WHALE_Y - WHALE_H / 2, WHALE_W, WHALE_H)) {
      const pts = WHALE_POINTS[this.rng.int(WHALE_POINTS.length)];
      this.score += pts;
      this.events.push({ t: "whale", sfx: "explode", mood: "happy", shake: 6, x: this.whale.x, y: WHALE_Y, points: pts });
      this.whale = null;
      this.whaleTimer = 1200 + this.rng.int(900);
      return true;
    }
    // Coin piles
    return this.chipCell(bx, by, 4, 10);
  }

  private chipCell(x: number, y: number, w: number, h: number): boolean {
    for (let i = 0; i < this.cells.length; i++) {
      const c = this.cells[i];
      if (!hit(x, y, w, h, c.x, c.y, CELL_W, CELL_H)) continue;
      c.hp--;
      const gone = c.hp <= 0;
      if (gone) this.cells.splice(i, 1);
      this.events.push({ t: "chip", sfx: "brick", x: c.x + CELL_W / 2, y: c.y + CELL_H / 2, gone });
      return true;
    }
    return false;
  }

  private killCritter(c: number, r: number) {
    this.alive[r * COLS + c] = 0;
    this.aliveCount--;
    const kind = ROW_KIND[r];
    const pts = KIND_POINTS[kind];
    this.score += pts;
    const x = this.ex(c) + EW / 2, y = this.ey(r) + EH / 2;
    this.events.push({ t: "kill", sfx: "brickgone", x, y, kind, points: pts });
    if (this.drops.length < 2 && this.rng.int(100) < 6 + Math.min(this.wave, 4)) {
      this.drops.push({ x, y, kind: this.rng.int(3) });
    }
  }

  private clearWave() {
    const bonus = 100 * (this.wave + 1);
    this.score += bonus;
    this.wavesCleared++;
    this.intermission = INTERMISSION;
    this.bullets = [];
    this.eshots = [];
    this.drops = [];
    this.whale = null;
    this.events.push({ t: "waveclear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus, x: W / 2, y: H / 2 });
  }

  private march() {
    let minC = COLS, maxC = -1, maxR = -1;
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (!this.alive[r * COLS + c]) continue;
      if (c < minC) minC = c;
      if (c > maxC) maxC = c;
      if (r > maxR) maxR = r;
    }
    const left = this.ex(minC), right = this.ex(maxC) + EW;
    if ((this.dir > 0 && right + STEP_X > W - EDGE) || (this.dir < 0 && left - STEP_X < EDGE)) {
      this.fy += STEP_Y;
      this.dir = -this.dir;
      this.events.push({ t: "stepdown" });
    } else this.fx += this.dir * STEP_X;
    this.pose ^= 1;

    // Critters crush any coins they walk into.
    const bottom = this.ey(maxR) + EH;
    if (bottom >= PILE_BOTTOM - 6 * CELL_H) {
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        if (!this.alive[r * COLS + c]) continue;
        const x = this.ex(c), y = this.ey(r);
        this.cells = this.cells.filter((k) => !hit(x, y, EW, EH, k.x, k.y, CELL_W, CELL_H));
      }
    }
    if (bottom >= INVADE_Y) {
      this.lives = 0;
      this.events.push({ t: "invaded", sfx: "lost", mood: "sad", shake: 12, x: this.px, y: PLAYER_Y });
      this.endGame();
    }
  }

  private enemyFire() {
    if (--this.eshotTimer > 0) return;
    this.eshotTimer = Math.max(14, 70 - this.wave * 7) + this.rng.int(40);
    const maxShots = Math.min(3 + this.wave, 7);
    if (this.eshots.length >= maxShots) return;
    const cols: number[] = [];
    for (let c = 0; c < COLS; c++) for (let r = 0; r < ROWS; r++) if (this.alive[r * COLS + c]) { cols.push(c); break; }
    if (!cols.length) return;
    let c: number;
    if (this.rng.int(3) === 0) {
      // Aimed: the column nearest the player.
      c = cols[0];
      for (const k of cols) if (Math.abs(this.ex(k) + EW / 2 - this.px) < Math.abs(this.ex(c) + EW / 2 - this.px)) c = k;
    } else c = cols[this.rng.int(cols.length)];
    let r = ROWS - 1;
    while (!this.alive[r * COLS + c]) r--;
    const x = this.ex(c) + EW / 2, y = this.ey(r) + EH;
    this.eshots.push({ x, y, kind: ROW_KIND[r] });
    this.events.push({ t: "eshot", x, y, kind: ROW_KIND[r] });
  }

  private moveEnemyShots() {
    const speed = Math.min(5, 3 + Math.floor(this.wave / 2)) / (this.pSlow > 0 ? 2 : 1);
    const keep: Shot[] = [];
    for (const s of this.eshots) {
      s.y += speed;
      if (s.y > H + 10) continue;
      const sx = s.x - 3, sy = s.y - 7;
      if (this.chipCell(sx, sy, 6, 14)) continue;
      if (hit(sx, sy, 6, 14, this.px - HIT_W / 2, HIT_TOP, HIT_W, HIT_BOTTOM - HIT_TOP) && this.invuln === 0) {
        const before = this.lives;
        this.playerHit();
        if (this.lives < before) return; // life lost: playerHit cleared all bolts
        continue;
      }
      keep.push(s);
    }
    this.eshots = keep;
  }

  private playerHit() {
    if (this.pShield > 0) {
      this.pShield = 0;
      this.invuln = 30;
      this.events.push({ t: "shieldpop", sfx: "wall", shake: 3, x: this.px, y: PLAYER_Y - 10 });
      return;
    }
    this.lives--;
    this.invuln = INVULN;
    this.eshots = [];
    this.pDouble = 0;
    this.pSlow = 0;
    const last = this.lives <= 0;
    this.events.push({ t: "hit", sfx: "lost", mood: "sad", toast: last ? undefined : "lifeLost", shake: 10, x: this.px, y: PLAYER_Y - 8 });
    if (last) this.endGame();
  }

  private endGame() {
    this.over = true;
    this.events.push({ t: "gameover", sfx: "gameover" });
  }

  private moveWhale() {
    if (this.whale) {
      this.whale.x += this.whale.dir * (this.pSlow > 0 ? 1 : 2);
      if (this.whale.x < -WHALE_W || this.whale.x > W + WHALE_W) {
        this.whale = null;
        this.whaleTimer = 1200 + this.rng.int(900);
      }
    } else if (--this.whaleTimer <= 0) {
      if (this.aliveCount >= 8) {
        const dir = this.rng.int(2) ? 1 : -1;
        this.whale = { x: dir > 0 ? -WHALE_W / 2 : W + WHALE_W / 2, dir };
        this.events.push({ t: "whalein", x: this.whale.x, y: WHALE_Y });
      } else this.whaleTimer = 300;
    }
  }

  private moveDrops() {
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.y += DROP_SPEED;
      if (d.y > H + 10) continue;
      if (hit(d.x - 8, d.y - 8, 16, 16, this.px - PW / 2, HIT_TOP, PW, HIT_BOTTOM - HIT_TOP)) {
        if (d.kind === POWER.DOUBLE) this.pDouble = POWER_FRAMES[0];
        else if (d.kind === POWER.SHIELD) this.pShield = POWER_FRAMES[1];
        else this.pSlow = POWER_FRAMES[2];
        this.events.push({ t: "power", sfx: "extraGood", mood: "happy", kind: d.kind, x: d.x, y: d.y });
        continue;
      }
      keep.push(d);
    }
    this.drops = keep;
  }

  view(): InvadersView {
    const critters: Critter[] = [];
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if (this.alive[r * COLS + c]) critters.push({ x: this.ex(c), y: this.ey(r), kind: ROW_KIND[r], col: c, row: r });
    }
    return {
      frame: this.frame,
      wave: this.wave,
      score: this.score,
      lives: this.lives,
      fx: this.fx,
      fy: this.fy,
      dir: this.dir,
      pose: this.pose,
      critters,
      bullets: this.bullets.map((b) => ({ ...b })),
      eshots: this.eshots.map((s) => ({ ...s })),
      cells: this.cells.map((c) => ({ ...c })),
      whale: this.whale ? { x: this.whale.x, y: WHALE_Y, dir: this.whale.dir } : null,
      drops: this.drops.map((d) => ({ ...d })),
      player: { x: this.px, y: PLAYER_Y, invuln: this.invuln, alive: this.lives > 0 },
      power: { double: this.pDouble, shield: this.pShield, slow: this.pSlow },
      ready: this.ready,
      intermission: this.intermission,
      over: this.over,
    };
  }
  hud(): Hud {
    const p = this.pDouble > 0 ? " · x2" : this.pSlow > 0 ? " · SLOW" : this.pShield > 0 ? " · SHIELD" : "";
    return { score: this.score, lives: this.lives, level: this.wave + 1, label: `Wave ${this.wave + 1}${p}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.wave, levelsCleared: this.wavesCleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

export const invaders: GameDef<InvadersView> = {
  id: "invaders",
  name: "FUD Defense",
  tagline: "The FUD is marching. Hold the line from your hover-pad and stack those coins.",
  genre: "Fixed shooter",
  session: "2–8 min",
  controls: "Move: mouse / touch or arrows. Fire: click, tap, Space or Up (hold to auto-fire).",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 15 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the fixed-shooter genre. No code, art, sounds or layouts from any commercial game: original FUD critters, coin-pile shields, a bonus whale and power-up coin drops.",
  },
  create: (seed) => new InvadersEngine(seed),
  bot(v) {
    const px = v.player.x;
    let target = px;
    // Prefer a falling power-up, then a whale in reach, then the lowest critter nearest to us.
    const drop = v.drops.find((d) => d.y > 260);
    if (drop) target = drop.x;
    else if (v.whale && Math.abs(v.whale.x - px) < 160) target = v.whale.x + v.whale.dir * 80;
    else if (v.critters.length) {
      let best = v.critters[0];
      for (const c of v.critters) {
        const better = c.y > best.y || (c.y === best.y && Math.abs(c.x + EW / 2 - px) < Math.abs(best.x + EW / 2 - px));
        if (better) best = c;
      }
      target = best.x + EW / 2;
    }
    // Dodge: avoid lanes with bolts that are close above us.
    const threats = v.eshots.filter((s) => s.y > PLAYER_Y - 170 && s.y < PLAYER_Y + 20);
    const safe = (x: number) => threats.every((s) => Math.abs(s.x - x) > 26);
    // Moving to x must not cross the lane of a bolt that is about to land.
    const clear = (x: number) => {
      const lo = Math.min(px, x) - 22, hi = Math.max(px, x) + 22;
      return !threats.some((s) => s.y > PLAYER_Y - 110 && s.x > lo && s.x < hi);
    };
    if (!safe(target) || !safe(px) || !clear(target)) {
      let pick = px;
      let bestCost = Infinity;
      for (let k = -12; k <= 12; k++) {
        const x = px + k * 10;
        if (x < PW / 2 || x > W - PW / 2 || !safe(x) || (k !== 0 && !clear(x))) continue;
        const cost = Math.abs(k) * 2 + Math.abs(x - target) / 30;
        if (cost < bestCost) { bestCost = cost; pick = x; }
      }
      target = pick;
    }
    const x = Math.max(0, Math.min(W - 1, Math.round(target)));
    return { x, y: 400, b: BTN.FIRE };
  },
};
