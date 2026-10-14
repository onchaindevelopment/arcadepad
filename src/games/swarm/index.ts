/*
 * Star Swarm: an original vertical scrolling shooter for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Written from scratch; no code or assets ported.
 *
 * Rules: the coin mascot flies a cockpit ship that fires on its own. It
 * follows the pointer (held a little above the finger so it stays visible)
 * or the arrow keys. Squads of FUD drones fly in on scripted curves (Bezier
 * swoops, sine weaves, loops and hover-and-leave runs) and shoot aimed shots,
 * fans and rings. Wiping out a whole squad drops a power-up: spread shot,
 * laser, shield, coin magnet or a smart bomb (ALT). Kills in quick
 * succession build a chain multiplier. Every fourth wave is a boss with three
 * phases and a health bar. Drones drop coins. 3 lives.
 *
 * Determinism: one seeded Rng, core/trig byte angles, only + - * / and
 * Math.sqrt/floor/min/max/abs, fixed 60 Hz step. Paths use integer params.
 */
import { Rng } from "../core/rng.ts";
import { angle256, cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 360;
export const H = 600;

// Ship
/** The ship flies this far above the pointer so the finger never hides it. */
export const POINTER_OFFSET = 56;
export const SHIP_MIN_X = 16;
export const SHIP_MAX_X = W - 16;
export const SHIP_MIN_Y = 160;
export const SHIP_MAX_Y = H - 36;
export const SHIP_START_X = W / 2;
export const SHIP_START_Y = 500;
const SHIP_SPEED = 8;
const KEY_SPEED = 5;
const HIT_R = 4; // tiny core hitbox around the cockpit
export const START_LIVES = 3;
export const START_BOMBS = 2;
const MAX_BOMBS = 5;
const INVULN = 150;
const PB_SPEED = 11;
const MAX_PBULLETS = 70;
const MAX_EBULLETS = 170;

// Scoring
export const CHAIN_FRAMES = 90;
export const MAX_MULT = 8;
const COIN_POINTS = 25;

// Enemies: 0 gnat, 1 spinner, 2 brute, 3 darter
export const E_RADIUS = [10, 12, 20, 11];
const E_HP = [1, 3, 14, 2];
export const E_POINTS = [100, 300, 1000, 200];
const E_COINS = [1, 2, 6, 2];
const E_DROP_PCT = [2, 8, 35, 6];

// Weapons and drops
export const WEAPON = { SHOT: 0, SPREAD: 1, LASER: 2 } as const;
export const DROP = { SPREAD: 0, LASER: 1, SHIELD: 2, MAGNET: 3, BOMB: 4 } as const;
export const SHIELD_FRAMES = 900;
export const MAGNET_FRAMES = 720;
const DROP_WEIGHTS = [25, 20, 20, 20, 15];

// Boss
export const BOSS_HW = 52; // hit half-width
export const BOSS_HH = 30; // hit half-height
const BOSS_Y = 110;

const INTERMISSION = 150;

/*
 * Path segments (integer params):
 *   [0, x0, y0, x1, y1, x2, y2, x3, y3, dur]   cubic Bezier
 *   [1, x0, y0, vy10, amp, freq, phase, dur]   sine weave: x = x0 + amp*sin(phase + t*freq), y = y0 + t*vy10/10
 *   [2, cx, cy, r, a0, spd, dur]               orbit: angle a0 + t*spd (byte angles)
 * Mirrored squads flip x around the field centre.
 */
type Seg = number[];

function segDur(s: Seg): number {
  return s[0] === 0 ? s[9] : s[0] === 1 ? s[7] : s[6];
}

function segPos(s: Seg, t: number): [number, number] {
  if (s[0] === 0) {
    const u = t / s[9];
    const iu = 1 - u;
    const a = iu * iu * iu, b = 3 * iu * iu * u, c = 3 * iu * u * u, d = u * u * u;
    return [a * s[1] + b * s[3] + c * s[5] + d * s[7], a * s[2] + b * s[4] + c * s[6] + d * s[8]];
  }
  if (s[0] === 1) return [s[1] + s[4] * sin256(s[6] + t * s[5]), s[2] + (t * s[3]) / 10];
  const a = s[4] + t * s[5];
  return [s[1] + s[3] * cos256(a), s[2] + s[3] * sin256(a)];
}

interface Template {
  kind: number;
  n: number;
  spacing: number;
  path(i: number, n: number): Seg[];
}

/** Squad templates. Index = template id. */
export const TEMPLATES: Template[] = [
  // 0: S-swoop across the field
  { kind: 0, n: 6, spacing: 9, path: () => [[0, -20, 40, 320, 20, 40, 460, 380, 420, 230]] },
  // 1: drop in, hover in a line, peel off sideways
  {
    kind: 1, n: 4, spacing: 16,
    path: (i) => {
      const sx = 60 + i * 80, hy = 90 + (i % 2) * 30;
      return [
        [0, 180, -30, 180, 60, sx, 20, sx, hy, 70],
        [1, sx, hy, 0, 14, 3, 0, 256],
        [0, sx, hy, sx, hy - 30, sx < 180 ? -60 : 420, 300, sx < 180 ? -40 : 400, 500, 140],
      ];
    },
  },
  // 2: sine rain
  { kind: 0, n: 5, spacing: 22, path: (i) => [[1, 40 + i * 70, -20, 16, 36, 2, i * 32, 420]] },
  // 3: slow weaving brute
  { kind: 2, n: 1, spacing: 0, path: () => [[0, 180, -40, 180, 20, 180, 40, 180, 80, 90], [1, 180, 80, 4, 110, 1, 0, 1400]] },
  // 4: darters dive and U-turn back up
  { kind: 3, n: 3, spacing: 26, path: (i) => { const x = 60 + i * 120; return [[0, x, -30, x, 380, 360 - x, 380, 360 - x, -40, 200]]; } },
  // 5: loop-the-loop chain
  {
    kind: 0, n: 7, spacing: 8,
    path: () => [
      [0, -20, 220, 60, 220, 120, 160, 180, 160, 60],
      [2, 180, 100, 60, 64, -2, 128],
      [0, 180, 160, 240, 160, 320, 260, 380, 300, 70],
    ],
  },
  // 6: slow spinner wall
  { kind: 1, n: 5, spacing: 0, path: (i) => [[1, 40 + i * 70, -20, 8, 20, 2, 0, 800]] },
  // 7: darter cross-swoop from the low sides
  { kind: 3, n: 4, spacing: 14, path: () => [[0, -20, 300, 120, 120, 240, 120, 380, 60, 160]] },
];

export interface Enemy {
  id: number;
  kind: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  segs: Seg[];
  seg: number;
  t: number;
  mirror: boolean;
  fire: number;
  squad: number;
  flash: number;
}
export interface Bullet { x: number; y: number; vx: number; vy: number; kind: number }
export interface Coin { x: number; y: number; vx: number; vy: number }
export interface Drop { x: number; y: number; kind: number }
export interface Boss {
  x: number;
  y: number;
  hp: number;
  max: number;
  phase: number;
  t: number;
  ang: number;
  spin: number;
  entering: boolean;
  flash: number;
}
interface Squad { size: number; kills: number; escaped: number }
interface Pending { at: number; tpl: number; i: number; mirror: boolean; squad: number; kind: number }

export interface SwarmView {
  frame: number;
  wave: number; // 0-based
  waveT: number;
  bossWave: boolean;
  score: number;
  lives: number;
  coins: number;
  ship: { x: number; y: number; invuln: number; alive: boolean };
  weapon: number;
  level: number;
  shield: number;
  magnet: number;
  bombs: number;
  chain: number;
  chainT: number;
  mult: number;
  laser: { x: number; top: number; half: number } | null;
  enemies: { id: number; kind: number; x: number; y: number; vx: number; vy: number; hp: number; maxHp: number; r: number; flash: number }[];
  boss: { x: number; y: number; hp: number; max: number; phase: number; entering: boolean; flash: number } | null;
  pbullets: Bullet[];
  ebullets: Bullet[];
  coinsList: Coin[];
  drops: Drop[];
  intermission: number;
  over: boolean;
}

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

class SwarmEngine implements GameEngine<SwarmView> {
  private rng: Rng;
  private sx = SHIP_START_X;
  private sy = SHIP_START_Y;
  private tx = SHIP_START_X;
  private ty = SHIP_START_Y;
  private lastPX = 0;
  private lastPY = 0;
  private havePointer = false;
  private prevB = 0;
  private cooldown = 0;
  private volleys = 0;
  private weapon: number = WEAPON.SHOT;
  private level = 1;
  private shield = 0;
  private magnet = 0;
  private bombs = START_BOMBS;
  private invuln = 0;
  private lives = START_LIVES;
  private score = 0;
  private coins = 0;
  private chain = 0;
  private chainT = 0;
  private wave = 0;
  private wavesCleared = 0;
  private waveT = 0;
  private intermission = 0;
  private over = false;
  private enemies: Enemy[] = [];
  private nextId = 1;
  private pending: Pending[] = [];
  private squads: Squad[] = [];
  private boss: Boss | null = null;
  private pbullets: Bullet[] = [];
  private ebullets: Bullet[] = [];
  private coinList: Coin[] = [];
  private drops: Drop[] = [];
  private laser: { x: number; top: number; half: number } | null = null;
  private lastHitSfx = -99;
  private lastCoinSfx = -99;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.startWave();
  }

  private cycle() { return Math.floor(this.wave / 4); }
  private isBossWave() { return this.wave % 4 === 3; }
  private bulletSpeed() { return 2 + Math.min(this.wave, 12) * 0.12; }
  private mult() { return Math.min(MAX_MULT, 1 + Math.floor(this.chain / 6)); }

  // ------------------------------------------------------------ waves

  private startWave() {
    this.waveT = 0;
    this.pending = [];
    this.squads = [];
    if (this.isBossWave()) {
      const max = 260 + this.cycle() * 120;
      this.boss = { x: W / 2, y: -70, hp: max, max, phase: 0, t: 0, ang: 0, spin: 0, entering: true, flash: 0 };
      this.events.push({ t: "bossin", sfx: "launch", shake: 4, x: W / 2, y: 0 });
      return;
    }
    const n = this.wave;
    const pool = [0, 5, 2];
    if (n >= 1) pool.push(1, 4);
    if (n >= 2) pool.push(3);
    if (n >= 4) pool.push(6, 7);
    const count = 4 + Math.min(this.cycle(), 3) + (n % 4);
    let at = 50;
    let last = -1;
    for (let k = 0; k < count; k++) {
      let tpl = pool[this.rng.int(pool.length)];
      if (tpl === last) tpl = pool[this.rng.int(pool.length)];
      last = tpl;
      this.queueSquad(tpl, at, this.rng.int(2) === 1);
      at += Math.max(70, 170 - n * 6) + this.rng.int(40);
    }
    this.events.push({ t: "wave", wave: n });
  }

  private queueSquad(tpl: number, at: number, mirror: boolean) {
    const T = TEMPLATES[tpl];
    const c = this.cycle();
    let n = T.n;
    if (tpl === 3 && c >= 1) n = 2;
    const squad = this.squads.length;
    this.squads.push({ size: n, kills: 0, escaped: 0 });
    for (let i = 0; i < n; i++) {
      // Later cycles upgrade some gnats into darters.
      const kind = T.kind === 0 && c >= 2 && i % 3 === 2 ? 3 : T.kind;
      // Two brutes come one after the other on mirrored sides.
      const m = tpl === 3 && i === 1 ? !mirror : mirror;
      this.pending.push({ at: at + i * (tpl === 3 ? 120 : T.spacing), tpl, i, mirror: m, squad, kind });
    }
  }

  private spawnPending() {
    if (!this.pending.length) return;
    const keep: Pending[] = [];
    for (const p of this.pending) {
      if (p.at > this.waveT) { keep.push(p); continue; }
      const T = TEMPLATES[p.tpl];
      const segs = T.path(p.i, T.n);
      const [x0, y0] = segPos(segs[0], 0);
      const hp = Math.round(E_HP[p.kind] * (1 + this.cycle() * 0.5));
      this.enemies.push({
        id: this.nextId++, kind: p.kind, x: p.mirror ? W - x0 : x0, y: y0, vx: 0, vy: 0, hp, maxHp: hp,
        segs, seg: 0, t: 0, mirror: p.mirror, fire: 40 + this.rng.int(90), squad: p.squad, flash: 0,
      });
    }
    this.pending = keep;
  }

  private waveClear(viaBoss: boolean) {
    const bonus = 200 * (this.wave + 1);
    this.score += bonus;
    this.wavesCleared++;
    this.intermission = INTERMISSION;
    this.ebullets = [];
    this.events.push({
      t: "waveclear", sfx: "levelclear", mood: "happy", toast: viaBoss ? "levelClear" : undefined,
      bonus, boss: viaBoss, x: W / 2, y: H / 2,
    });
  }

  // ------------------------------------------------------------ step

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;

    this.moveShip(inp);
    if (pressed & BTN.ALT) this.smartBomb();

    if (this.invuln > 0) this.invuln--;
    if (this.shield > 0) this.shield--;
    if (this.magnet > 0) this.magnet--;
    if (this.chainT > 0 && --this.chainT === 0) {
      if (this.chain >= 6) this.events.push({ t: "chainend", chain: this.chain, x: this.sx, y: this.sy - 30 });
      this.chain = 0;
    }

    this.fire();
    this.movePBullets();
    this.updateLaser();

    if (this.intermission > 0) {
      if (--this.intermission === 0) {
        this.wave++;
        this.startWave();
      }
    } else {
      this.waveT++;
      this.spawnPending();
      if (this.boss) this.updateBoss();
    }
    if (this.over) return;
    this.moveEnemies();
    if (this.over) return;
    this.moveEBullets();
    if (this.over) return;
    this.moveCoins();
    this.moveDrops();

    if (this.intermission === 0 && !this.isBossWave() && this.waveT > 60 && !this.pending.length && !this.enemies.length) {
      this.waveClear(false);
    }
    if (this.frame >= swarm.maxFrames) this.endGame();
  }

  private moveShip(inp: Input) {
    const keys = inp.b & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN);
    const moved = this.havePointer && (inp.x !== this.lastPX || inp.y !== this.lastPY);
    this.havePointer = true;
    this.lastPX = inp.x;
    this.lastPY = inp.y;
    if (keys) {
      if (inp.b & BTN.LEFT) this.sx -= KEY_SPEED;
      if (inp.b & BTN.RIGHT) this.sx += KEY_SPEED;
      if (inp.b & BTN.UP) this.sy -= KEY_SPEED;
      if (inp.b & BTN.DOWN) this.sy += KEY_SPEED;
      this.sx = clamp(this.sx, SHIP_MIN_X, SHIP_MAX_X);
      this.sy = clamp(this.sy, SHIP_MIN_Y, SHIP_MAX_Y);
      this.tx = this.sx;
      this.ty = this.sy;
      return;
    }
    if (moved) {
      this.tx = clamp(inp.x, SHIP_MIN_X, SHIP_MAX_X);
      this.ty = clamp(inp.y - POINTER_OFFSET, SHIP_MIN_Y, SHIP_MAX_Y);
    }
    const dx = this.tx - this.sx, dy = this.ty - this.sy;
    const d2 = dx * dx + dy * dy;
    if (d2 <= SHIP_SPEED * SHIP_SPEED) {
      this.sx = this.tx;
      this.sy = this.ty;
    } else {
      const k = SHIP_SPEED / Math.sqrt(d2);
      this.sx += dx * k;
      this.sy += dy * k;
    }
  }

  // ------------------------------------------------------------ player weapons

  private fire() {
    if (this.lives <= 0) return;
    if (this.cooldown > 0) { this.cooldown--; return; }
    if (this.weapon === WEAPON.LASER) return;
    const y = this.sy - 16;
    if (this.pbullets.length >= MAX_PBULLETS) return;
    if (this.weapon === WEAPON.SHOT) {
      const xs = this.level === 1 ? [0] : this.level === 2 ? [-6, 6] : [-9, 0, 9];
      for (const ox of xs) this.pbullets.push({ x: this.sx + ox, y, vx: 0, vy: -PB_SPEED, kind: 0 });
      this.cooldown = 6;
    } else {
      const n = 1 + 2 * this.level;
      const da = this.level === 1 ? 10 : this.level === 2 ? 8 : 7;
      for (let j = 0; j < n; j++) {
        const a = (j - (n - 1) / 2) * da;
        this.pbullets.push({ x: this.sx, y, vx: sin256(a) * 10, vy: -cos256(a) * 10, kind: 1 });
      }
      this.cooldown = 9;
    }
    this.volleys++;
    this.events.push({ t: "shot", sfx: this.volleys % 4 === 1 ? "shot" : undefined, x: this.sx, y, weapon: this.weapon });
  }

  private movePBullets() {
    const keep: Bullet[] = [];
    outer: for (const b of this.pbullets) {
      b.x += b.vx;
      b.y += b.vy;
      if (b.y < -12 || b.x < -12 || b.x > W + 12) continue;
      for (const e of this.enemies) {
        if (e.hp <= 0) continue;
        const r = E_RADIUS[e.kind] + 3;
        const dx = b.x - e.x, dy = b.y - e.y;
        if (dx * dx + dy * dy < r * r) {
          this.damageEnemy(e, 1);
          continue outer;
        }
      }
      const bo = this.boss;
      if (bo && bo.hp > 0 && bo.y > -20 && Math.abs(b.x - bo.x) < BOSS_HW && Math.abs(b.y - bo.y) < BOSS_HH) {
        this.damageBoss(1, b.x, b.y);
        continue;
      }
      keep.push(b);
    }
    this.pbullets = keep;
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  private updateLaser() {
    if (this.weapon !== WEAPON.LASER || this.lives <= 0) { this.laser = null; return; }
    const half = 3 + this.level * 2;
    let top = 0;
    let target: Enemy | null = null;
    for (const e of this.enemies) {
      if (e.hp <= 0 || e.y > this.sy - 10 || e.y < -10) continue;
      if (Math.abs(e.x - this.sx) >= E_RADIUS[e.kind] + half) continue;
      const ey = e.y + E_RADIUS[e.kind] * 0.6;
      if (ey > top) { top = ey; target = e; }
    }
    let hitBoss = false;
    const bo = this.boss;
    if (bo && bo.hp > 0 && bo.y > -20 && bo.y < this.sy && Math.abs(bo.x - this.sx) < BOSS_HW + half) {
      const by = bo.y + BOSS_HH;
      if (by > top) { top = by; target = null; hitBoss = true; }
    }
    this.laser = { x: this.sx, top, half };
    if (this.frame % (5 - this.level) !== 0) return;
    if (target) {
      this.damageEnemy(target, 1);
      this.enemies = this.enemies.filter((e) => e.hp > 0);
    } else if (hitBoss) this.damageBoss(1, this.sx, top);
    this.volleys++;
    if (this.volleys % 8 === 1) this.events.push({ t: "laser", sfx: "shot", x: this.sx, y: top });
  }

  private smartBomb() {
    if (this.bombs <= 0 || this.lives <= 0) return;
    this.bombs--;
    const cleared = this.ebullets.length;
    this.ebullets = [];
    this.invuln = Math.max(this.invuln, 60);
    this.events.push({ t: "bomb", sfx: "explode", shake: 14, x: this.sx, y: this.sy, cleared });
    for (const e of this.enemies) if (e.hp > 0 && e.y > -20) this.damageEnemy(e, 12);
    this.enemies = this.enemies.filter((e) => e.hp > 0);
    if (this.boss && this.boss.hp > 0 && !this.boss.entering) this.damageBoss(Math.max(1, Math.floor(this.boss.max * 0.08)), this.boss.x, this.boss.y);
  }

  // ------------------------------------------------------------ enemies

  private damageEnemy(e: Enemy, d: number) {
    e.hp -= d;
    e.flash = 4;
    if (e.hp <= 0) this.killEnemy(e);
    else if (this.frame - this.lastHitSfx > 6) {
      this.lastHitSfx = this.frame;
      this.events.push({ t: "ehit", sfx: "brick", x: e.x, y: e.y, kind: e.kind });
    }
  }

  private killEnemy(e: Enemy) {
    e.hp = 0;
    this.chain++;
    this.chainT = CHAIN_FRAMES;
    const mult = this.mult();
    const pts = E_POINTS[e.kind] * mult;
    this.score += pts;
    const big = e.kind === 2;
    this.events.push({ t: "kill", sfx: big ? "explode" : "brickgone", shake: big ? 6 : undefined, x: e.x, y: e.y, kind: e.kind, points: pts, mult });
    this.spawnCoins(e.x, e.y, E_COINS[e.kind]);
    const sq = this.squads[e.squad];
    let dropped = false;
    if (sq) {
      sq.kills++;
      if (sq.kills === sq.size && sq.size >= 3) {
        const bonus = 50 * sq.size * mult;
        this.score += bonus;
        this.events.push({ t: "squad", sfx: "extraGood", mood: "happy", x: e.x, y: e.y, points: bonus });
        this.spawnDrop(e.x, e.y);
        dropped = true;
      }
    }
    if (!dropped && this.drops.length < 3 && this.rng.int(100) < E_DROP_PCT[e.kind]) this.spawnDrop(e.x, e.y);
  }

  private spawnCoins(x: number, y: number, n: number) {
    for (let i = 0; i < n; i++) {
      if (this.coinList.length >= 80) return;
      this.coinList.push({ x, y, vx: (this.rng.int(9) - 4) * 0.35, vy: -1.2 - this.rng.int(4) * 0.4 });
    }
  }

  private spawnDrop(x: number, y: number) {
    let k = this.rng.int(100);
    let kind = 0;
    while (kind < DROP_WEIGHTS.length - 1 && k >= DROP_WEIGHTS[kind]) k -= DROP_WEIGHTS[kind++];
    this.drops.push({ x: clamp(x, 16, W - 16), y, kind });
  }

  private moveEnemies() {
    const es = this.bulletSpeed();
    for (const e of this.enemies) {
      if (e.flash > 0) e.flash--;
      e.t++;
      while (e.seg < e.segs.length && e.t >= segDur(e.segs[e.seg])) {
        e.t -= segDur(e.segs[e.seg]);
        e.seg++;
      }
      if (e.seg >= e.segs.length) {
        e.hp = 0; // escaped
        const sq = this.squads[e.squad];
        if (sq) sq.escaped++;
        continue;
      }
      const [px, py] = segPos(e.segs[e.seg], e.t);
      const nx = e.mirror ? W - px : px;
      e.vx = nx - e.x;
      e.vy = py - e.y;
      e.x = nx;
      e.y = py;
      if (this.lives > 0) this.enemyFire(e, es);
      // Ramming the ship hurts both.
      const r = E_RADIUS[e.kind] + 6;
      const dx = e.x - this.sx, dy = e.y - this.sy;
      if (this.invuln === 0 && this.lives > 0 && dx * dx + dy * dy < r * r) {
        this.damageEnemy(e, 6);
        this.playerHit();
        if (this.over) return;
      }
    }
    this.enemies = this.enemies.filter((e) => e.hp > 0);
  }

  private enemyFire(e: Enemy, es: number) {
    if (--e.fire > 0) return;
    const onScreen = e.y > 16 && e.y < this.sy - 70 && e.x > 8 && e.x < W - 8;
    const n = this.wave;
    if (e.kind === 0) {
      e.fire = Math.max(110, 260 - n * 12) + this.rng.int(120);
      if (onScreen && n >= 1) this.aimed(e.x, e.y, es, 0, 1, 0);
    } else if (e.kind === 1) {
      e.fire = Math.max(60, 110 - n * 4) + this.rng.int(40);
      if (onScreen) this.aimed(e.x, e.y, es, 0, n >= 6 ? 2 : 1, 10);
    } else if (e.kind === 2) {
      e.fire = Math.max(80, 130 - n * 4) + this.rng.int(30);
      if (onScreen) this.ring(e.x, e.y, 8 + Math.min(4, this.cycle() * 2), this.rng.int(32), es * 0.85, 1);
    } else {
      e.fire = Math.max(50, 90 - n * 3) + this.rng.int(40);
      if (onScreen) this.aimed(e.x, e.y, es + 0.4, 0, 3, 12);
    }
  }

  /** n-way fan aimed at the ship (n = 1 for a single shot). */
  private aimed(x: number, y: number, speed: number, kind: number, n: number, spread: number) {
    const a = angle256(this.sx - x, this.sy - y);
    for (let j = 0; j < n; j++) this.shoot(x, y, a + Math.round((j - (n - 1) / 2) * spread), speed, kind);
  }

  private ring(x: number, y: number, n: number, a0: number, speed: number, kind: number) {
    for (let j = 0; j < n; j++) this.shoot(x, y, a0 + Math.floor((j * 256) / n), speed, kind);
  }

  private shoot(x: number, y: number, a: number, speed: number, kind: number) {
    if (this.ebullets.length >= MAX_EBULLETS) return;
    this.ebullets.push({ x, y, vx: cos256(a) * speed, vy: sin256(a) * speed, kind });
  }

  private moveEBullets() {
    const keep: Bullet[] = [];
    for (const b of this.ebullets) {
      b.x += b.vx;
      b.y += b.vy;
      if (b.x < -10 || b.x > W + 10 || b.y < -10 || b.y > H + 10) continue;
      const r = HIT_R + (b.kind === 1 ? 4 : 3);
      const dx = b.x - this.sx, dy = b.y - this.sy;
      if (this.invuln === 0 && this.lives > 0 && dx * dx + dy * dy < r * r) {
        this.playerHit();
        if (this.over) return;
        // A hit clears or thins the bullets; restart with what remains.
        return;
      }
      keep.push(b);
    }
    this.ebullets = keep;
  }

  // ------------------------------------------------------------ boss

  private updateBoss() {
    const b = this.boss!;
    if (b.flash > 0) b.flash--;
    if (b.entering) {
      b.y += 1.5;
      if (b.y >= BOSS_Y) {
        b.y = BOSS_Y;
        b.entering = false;
        b.t = 0;
      }
      return;
    }
    b.t++;
    b.ang += b.phase === 2 ? 2 : 1;
    b.x = W / 2 + 100 * sin256(b.ang);
    b.y = BOSS_Y + 16 * sin256(b.ang * 2);
    const es = this.bulletSpeed();
    const t = b.t;
    if (this.lives <= 0) return;
    if (b.phase === 0) {
      if (t % 50 === 0) this.aimed(b.x, b.y + 26, es + 0.4, 0, 5, 12);
      if (t % 130 === 65) {
        this.ring(b.x - 44, b.y + 10, 10, b.spin, es * 0.8, 1);
        this.ring(b.x + 44, b.y + 10, 10, b.spin + 13, es * 0.8, 1);
        b.spin += 7;
      }
    } else if (b.phase === 1) {
      if (t % 6 === 0) {
        for (let j = 0; j < 3; j++) this.shoot(b.x, b.y + 10, b.spin + j * 85, es, 0);
        b.spin += 9;
      }
      if (t % 100 === 50) this.aimed(b.x, b.y + 26, es + 0.8, 1, 3, 14);
    } else {
      if (t % 44 === 0) {
        this.ring(b.x, b.y, 16, b.spin, es * 0.9, 1);
        b.spin += 8;
      }
      if (t % 24 === 12) this.aimed(b.x, b.y + 26, es + 1.2, 0, 1, 0);
      if (t % 260 === 130) {
        this.queueSquad(0, this.waveT + 1, Math.floor(t / 260) % 2 === 0);
      }
    }
    // Ramming the boss.
    if (this.invuln === 0 && Math.abs(b.x - this.sx) < BOSS_HW - 4 && Math.abs(b.y - this.sy) < BOSS_HH - 2) this.playerHit();
  }

  private damageBoss(d: number, x: number, y: number) {
    const b = this.boss!;
    if (b.entering || b.hp <= 0) return;
    b.hp -= d;
    b.flash = 3;
    if (this.frame - this.lastHitSfx > 8) {
      this.lastHitSfx = this.frame;
      this.events.push({ t: "bosshit", sfx: "brick", x, y });
    }
    if (b.hp <= 0) return this.bossDie();
    const phase = b.hp * 3 > b.max * 2 ? 0 : b.hp * 3 > b.max ? 1 : 2;
    if (phase !== b.phase) {
      b.phase = phase;
      b.t = 0;
      this.ebullets = [];
      this.spawnCoins(b.x, b.y, 6);
      this.score += 500 * phase;
      this.events.push({ t: "bossphase", sfx: "explode", shake: 8, phase, x: b.x, y: b.y });
    }
  }

  private bossDie() {
    const b = this.boss!;
    b.hp = 0;
    const pts = 5000 * (this.cycle() + 1) * this.mult();
    this.score += pts;
    this.chain++;
    this.chainT = CHAIN_FRAMES;
    this.events.push({ t: "bossdie", sfx: "explode", mood: "happy", shake: 16, x: b.x, y: b.y, points: pts });
    this.spawnCoins(b.x, b.y, 24);
    this.spawnDrop(b.x - 20, b.y);
    this.spawnDrop(b.x + 20, b.y);
    for (const e of this.enemies) if (e.hp > 0) this.killEnemy(e);
    this.enemies = [];
    this.pending = [];
    this.boss = null;
    this.waveClear(true);
  }

  // ------------------------------------------------------------ pickups

  private moveCoins() {
    const keep: Coin[] = [];
    for (const c of this.coinList) {
      const dx = this.sx - c.x, dy = this.sy - c.y;
      const d2 = dx * dx + dy * dy;
      if (this.lives > 0 && (this.magnet > 0 || d2 < 56 * 56)) {
        const d = Math.sqrt(d2) || 1;
        const sp = this.magnet > 0 ? 7 : 4;
        c.vx = (dx / d) * sp;
        c.vy = (dy / d) * sp;
      } else {
        c.vy = Math.min(2.6, c.vy + 0.06);
        c.vx *= 0.98;
      }
      c.x += c.vx;
      c.y += c.vy;
      if (this.lives > 0 && d2 < 18 * 18) {
        this.coins++;
        this.score += COIN_POINTS;
        const loud = this.frame - this.lastCoinSfx > 4;
        if (loud) this.lastCoinSfx = this.frame;
        this.events.push({ t: "coin", sfx: loud ? "paddle" : undefined, x: c.x, y: c.y });
        continue;
      }
      if (c.y > H + 10) continue;
      keep.push(c);
    }
    this.coinList = keep;
  }

  private moveDrops() {
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.y += 1.2;
      if (d.y > H + 12) continue;
      const dx = d.x - this.sx, dy = d.y - this.sy;
      if (this.lives > 0 && dx * dx + dy * dy < 20 * 20) {
        this.collect(d.kind);
        this.events.push({ t: "power", sfx: "extraGood", mood: "happy", kind: d.kind, x: d.x, y: d.y });
        continue;
      }
      keep.push(d);
    }
    this.drops = keep;
  }

  private collect(kind: number) {
    if (kind === DROP.SPREAD || kind === DROP.LASER) {
      const w = kind === DROP.SPREAD ? WEAPON.SPREAD : WEAPON.LASER;
      if (this.weapon === w) this.level = Math.min(3, this.level + 1);
      else {
        this.weapon = w;
        this.level = Math.max(1, Math.min(3, this.level));
      }
    } else if (kind === DROP.SHIELD) this.shield = SHIELD_FRAMES;
    else if (kind === DROP.MAGNET) this.magnet = MAGNET_FRAMES;
    else this.bombs = Math.min(MAX_BOMBS, this.bombs + 1);
  }

  // ------------------------------------------------------------ damage

  private playerHit() {
    if (this.shield > 0) {
      this.shield = 0;
      this.invuln = 45;
      this.ebullets = this.ebullets.filter((b) => {
        const dx = b.x - this.sx, dy = b.y - this.sy;
        return dx * dx + dy * dy > 70 * 70;
      });
      this.events.push({ t: "shieldpop", sfx: "wall", shake: 4, x: this.sx, y: this.sy });
      return;
    }
    this.lives--;
    this.invuln = INVULN;
    this.chain = 0;
    this.chainT = 0;
    this.level = Math.max(1, this.level - 1);
    this.magnet = 0;
    this.ebullets = [];
    const last = this.lives <= 0;
    this.events.push({ t: "hit", sfx: "lost", mood: "sad", toast: last ? undefined : "lifeLost", shake: 12, x: this.sx, y: this.sy });
    if (last) this.endGame();
  }

  private endGame() {
    if (this.over) return;
    this.over = true;
    this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
  }

  // ------------------------------------------------------------ outputs

  view(): SwarmView {
    const b = this.boss;
    return {
      frame: this.frame,
      wave: this.wave,
      waveT: this.waveT,
      bossWave: this.isBossWave(),
      score: this.score,
      lives: this.lives,
      coins: this.coins,
      ship: { x: this.sx, y: this.sy, invuln: this.invuln, alive: this.lives > 0 },
      weapon: this.weapon,
      level: this.level,
      shield: this.shield,
      magnet: this.magnet,
      bombs: this.bombs,
      chain: this.chain,
      chainT: this.chainT,
      mult: this.mult(),
      laser: this.laser ? { ...this.laser } : null,
      enemies: this.enemies.map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, vx: e.vx, vy: e.vy, hp: e.hp, maxHp: e.maxHp, r: E_RADIUS[e.kind], flash: e.flash })),
      boss: b ? { x: b.x, y: b.y, hp: b.hp, max: b.max, phase: b.phase, entering: b.entering, flash: b.flash } : null,
      pbullets: this.pbullets.map((q) => ({ ...q })),
      ebullets: this.ebullets.map((q) => ({ ...q })),
      coinsList: this.coinList.map((q) => ({ ...q })),
      drops: this.drops.map((q) => ({ ...q })),
      intermission: this.intermission,
      over: this.over,
    };
  }
  hud(): Hud {
    const m = this.mult();
    return {
      score: this.score,
      lives: this.lives,
      level: this.wave + 1,
      label: `${this.isBossWave() ? "BOSS" : `Wave ${this.wave + 1}`}${m > 1 ? ` · x${m}` : ""}`,
    };
  }
  result(): GameResult {
    return { score: this.score, level: this.wave, levelsCleared: this.wavesCleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

export const swarm: GameDef<SwarmView> = {
  id: "swarm",
  name: "Star Swarm",
  tagline: "Auto-fire, weave through the swarm, chain kills and grab every coin.",
  genre: "Vertical scrolling shooter",
  session: "3–10 min",
  controls: "Drag / mouse to fly (ship hovers above your finger) or arrows. Fires on its own. Bomb: X / Shift / right click / long press.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the vertical scrolling shooter genre. Original FUD drones, flight paths, boss, power-ups and art; no code, art, sounds, names or enemy designs from any commercial game.",
  },
  create: (seed) => new SwarmEngine(seed),
  bot(v, frame) {
    const sx = v.ship.x, sy = v.ship.y;
    let tx = sx, ty = 500;
    const drop = v.drops.find((d) => d.y > 180 && d.y < 560);
    if (drop) {
      tx = drop.x;
      ty = clamp(drop.y + 30, 380, 540);
    } else if (v.boss && !v.boss.entering) tx = v.boss.x;
    else {
      let best: SwarmView["enemies"][number] | null = null;
      for (const e of v.enemies) {
        if (e.y < 10 || e.y > sy - 70 || e.x < 0 || e.x > W) continue;
        if (!best || e.y > best.y) best = e;
      }
      if (best) tx = best.x + best.vx * 6;
      else {
        const c = v.coinsList.find((q) => q.y > 200);
        if (c) { tx = c.x; ty = clamp(c.y, 400, 540); }
      }
    }
    const near = v.ebullets.filter((b) => Math.abs(b.x - sx) < 110 && Math.abs(b.y - sy) < 140);
    const danger = (cx: number, cy: number) => {
      let d = 0;
      for (const b of near) {
        for (let k = 3; k <= 15; k += 4) {
          const bx = b.x + b.vx * k - cx, by = b.y + b.vy * k - cy;
          if (bx * bx + by * by < 16 * 16) d += 20 - k;
        }
      }
      for (const e of v.enemies) {
        const ex = e.x + e.vx * 6 - cx, ey = e.y + e.vy * 6 - cy;
        const r = e.r + 20;
        if (ex * ex + ey * ey < r * r) d += 30;
      }
      if (v.boss) {
        if (Math.abs(v.boss.x - cx) < BOSS_HW + 16 && Math.abs(v.boss.y - cy) < BOSS_HH + 40) d += 40;
      }
      return d;
    };
    let px = sx, py = sy, bestCost = Infinity, bestDanger = 0;
    for (let ix = -4; ix <= 4; ix++) {
      for (let iy = -2; iy <= 2; iy++) {
        const cx = clamp(sx + ix * 12, SHIP_MIN_X, SHIP_MAX_X);
        const cy = clamp(sy + iy * 12, 300, H - 1 - POINTER_OFFSET);
        const d = danger(cx, cy);
        const cost = d * 100 + Math.abs(cx - tx) + Math.abs(cy - ty) * 0.5;
        if (cost < bestCost) { bestCost = cost; px = cx; py = cy; bestDanger = d; }
      }
    }
    // Panic button: bomb when every option looks bad.
    const b = bestDanger >= 16 && v.bombs > 0 && v.ship.invuln === 0 && frame % 2 === 0 ? BTN.ALT : 0;
    return { x: Math.round(px), y: clamp(Math.round(py + POINTER_OFFSET), 0, H - 1), b };
  },
};
