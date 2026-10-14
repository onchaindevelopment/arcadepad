/*
 * Tank Duel: an original turn-based artillery game for ArcadePad.
 * Original design and code (genre: two tanks lob shells over hills). No code,
 * names, art or sounds from any commercial artillery game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * The coin mascot peeks out of the hatch of a round little coin-tank on the
 * left; a grumpy bear tank sits on the right. Take turns: aim (angle +
 * power), pick a weapon, fire. Explosions carve craters into a heightmap and
 * the dirt above a hole settles down; tanks fall into craters (long falls
 * hurt). Wind changes every turn. Knock the bear out to win the duel and face
 * a tougher bear (more HP, better aim, stronger wind) on new terrain; lose
 * your tank and the run is over.
 *
 * Score: damage dealt to the bear by your shots + 1000 per duel won.
 *
 * Determinism: positions are floats updated only with + - * / and Math.sqrt;
 * angles are byte angles (core/trig tables); all randomness comes from Rng.
 */
import { Rng } from "../core/rng.ts";
import { angle256, cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- constants

export const FIELD_W = 640;
export const FIELD_H = 360;
/** Bedrock: craters never go deeper than this. */
export const FLOOR = FIELD_H - 6;
const G = 0.12; // gravity, px/frame^2
export const VK = 0.095; // launch speed per power unit, px/frame
const WIND_K = 0.0012; // wind acceleration per wind unit, px/frame^2
const SUB = 4;
export const TANK_HW = 12;
export const TANK_H = 14;
/** Turret pivot height above the tank's base. */
export const TURRET_DY = 10;
export const BARREL = 14;
/** Press within this of the turret to drag-aim; a press elsewhere fires. */
export const GRAB_R = 48;
/** Drag distance for full power. */
export const DRAG_FULL = 110;
const DRAG_MIN = 14;
export const ANG_MIN = 130;
export const ANG_MAX = 254;
export const P_MIN = 5;
export const P_MAX = 100;
const REPEAT_DELAY = 12;
const ROLL_SPEED = 2;
const ROLL_MAX = 160;
const FLY_MAX = 900;
const SETTLE_SPEED = 2;
const MAX_WINS = 10;
const PLAYER_HP = 100;

export const W_SHELL = 0;
export const W_TRIPLE = 1;
export const W_ROLLER = 2;
export const W_BOMB = 3;
export const WEAPONS = [
  { name: "SHELL", r: 18, dmg: 35, ammo: -1 },
  { name: "TRIPLE", r: 12, dmg: 20, ammo: 2 },
  { name: "ROLLER", r: 16, dmg: 30, ammo: 2 },
  { name: "BIG BOMB", r: 34, dmg: 60, ammo: 1 },
] as const;

// ---------------------------------------------------------------- shared physics

export interface Terrain {
  /** Surface y per column (dirt from top down to the field bottom). */
  top: Float64Array;
  /** Optional hole [gapA, gapB) inside a column while dirt above it settles (gapA === gapB: none). */
  gapA: Float64Array;
  gapB: Float64Array;
}
interface TankPos { x: number; y: number }
export interface Shell { x: number; y: number; vx: number; vy: number; w: number; owner: number; roll: number; t: number }
interface Impact { x: number; y: number; tank: number; out: boolean }

function solidAt(t: Terrain, x: number, y: number): boolean {
  const c = Math.floor(x);
  if (c < 0 || c >= FIELD_W) return false;
  if (y < t.top[c]) return false;
  return !(y >= t.gapA[c] && y < t.gapB[c]);
}

function tankAt(tanks: readonly TankPos[], x: number, y: number): number {
  for (let i = 0; i < tanks.length; i++) {
    const k = tanks[i];
    if (Math.abs(x - k.x) < TANK_HW && y >= k.y - TANK_H && y <= k.y + 1) return i;
  }
  return -1;
}

const colOf = (x: number) => Math.max(0, Math.min(FIELD_W - 1, Math.floor(x)));

/** Advance a shell by one frame. Returns the impact (or exit) if it ended. */
export function shellFrame(s: Shell, wind: number, terr: Terrain, tanks: readonly TankPos[]): Impact | null {
  if (s.roll !== 0) {
    const nx = s.x + s.roll * ROLL_SPEED;
    if (nx < 0 || nx >= FIELD_W) return { x: nx, y: s.y, tank: -1, out: true };
    const h0 = terr.top[colOf(s.x)], h1 = terr.top[colOf(nx)];
    if (h1 < h0 - 1.5 || s.t > ROLL_MAX) return { x: s.x, y: s.y, tank: -1, out: false };
    s.x = nx;
    s.y = h1 - 1;
    s.t++;
    const ti = tankAt(tanks, s.x, s.y - 3);
    if (ti >= 0) return { x: s.x, y: s.y, tank: ti, out: false };
    return null;
  }
  const ax = (wind * WIND_K) / SUB, ay = G / SUB;
  for (let k = 0; k < SUB; k++) {
    s.vx += ax;
    s.vy += ay;
    s.x += s.vx / SUB;
    s.y += s.vy / SUB;
    if (s.x < -20 || s.x > FIELD_W + 20 || s.y > FIELD_H + 20) return { x: s.x, y: s.y, tank: -1, out: true };
    const ti = tankAt(tanks, s.x, s.y);
    if (ti >= 0) return { x: s.x, y: s.y, tank: ti, out: false };
    if (solidAt(terr, s.x, s.y)) {
      if (s.w === W_ROLLER) {
        const c = colOf(s.x);
        const l = terr.top[colOf(c - 4)], r = terr.top[colOf(c + 4)];
        s.roll = r > l + 0.5 ? 1 : l > r + 0.5 ? -1 : s.vx < 0 ? -1 : 1;
        s.y = terr.top[c] - 1;
        s.t = 0;
        return null;
      }
      return { x: s.x, y: s.y, tank: -1, out: false };
    }
  }
  s.t++;
  if (s.t > FLY_MAX) return { x: s.x, y: s.y, tank: -1, out: true };
  return null;
}

/** Barrel tip and launch velocity for a tank's aim. */
export function launch(tx: number, ty: number, angle: number, power: number, w: number, owner: number): Shell {
  const c = cos256(angle), s = sin256(angle);
  const v = power * VK;
  return { x: tx + c * BARREL, y: ty - TURRET_DY + s * BARREL, vx: c * v, vy: s * v, w, owner, roll: 0, t: 0 };
}

/** Full flight of a shell (no carving): where it lands. */
export function simulate(terr: Terrain, wind: number, tanks: readonly TankPos[], from: number, angle: number, power: number, w = W_SHELL): Impact {
  const s = launch(tanks[from].x, tanks[from].y, angle, power, w, from);
  for (let i = 0; i < FLY_MAX + ROLL_MAX + 10; i++) {
    const imp = shellFrame(s, wind, terr, tanks);
    if (imp) return imp;
  }
  return { x: s.x, y: s.y, tank: -1, out: true };
}

/** First short stretch of the arc (no wind), for the aim guide. */
export function aimPreview(tx: number, ty: number, angle: number, power: number, frames = 16): number[] {
  const s = launch(tx, ty, angle, power, W_SHELL, 0);
  const out: number[] = [s.x, s.y];
  for (let i = 0; i < frames; i++) {
    s.vy += G;
    s.x += s.vx;
    s.y += s.vy;
    out.push(s.x, s.y);
  }
  return out;
}

/** Deterministic search over elevation and power for the shot landing nearest the target. */
export function searchShot(terr: Terrain, wind: number, tanks: readonly TankPos[], from: number, to: number): { angle: number; power: number } {
  const me = tanks[from], tgt = tanks[to];
  const right = tgt.x > me.x;
  let best = { angle: right ? 224 : 160, power: 60 };
  let bestS = Infinity;
  for (let e = 4; e <= 60; e += 2) {
    const angle = right ? 256 - e : 128 + e;
    for (let p = 20; p <= P_MAX; p += 2) {
      const imp = simulate(terr, wind, tanks, from, angle, p);
      let s = imp.out ? 5000 + Math.abs(imp.x - tgt.x) : Math.abs(imp.x - tgt.x) + (imp.tank === to ? -100 : 0);
      if (!imp.out && (imp.tank === from || Math.abs(imp.x - me.x) < 40)) s += 2000;
      if (s < bestS) {
        bestS = s;
        best = { angle, power: p };
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------- engine

interface Tank {
  x: number;
  y: number;
  vy: number;
  falling: boolean;
  fallFrom: number;
  hp: number;
  maxHp: number;
  angle: number;
  power: number;
  weapon: number;
  ammo: number[];
}

export type Phase = "aim" | "fly" | "settle" | "duelWon" | "dying";

export interface TankView {
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  angle: number;
  power: number;
  weapon: number;
  ammo: readonly number[];
  falling: boolean;
}

export interface TanksView {
  frame: number;
  phase: Phase;
  phaseT: number;
  /** 0 = player, 1 = CPU. */
  turn: number;
  turnNo: number;
  duel: number;
  wins: number;
  score: number;
  wind: number;
  terr: Terrain;
  /** Bumped whenever the terrain changes (renderer cache key). */
  terrVer: number;
  tanks: TankView[];
  shells: { x: number; y: number; w: number; roll: number }[];
  dragging: boolean;
  dead: boolean;
  won: boolean;
}

export class TanksEngine implements GameEngine<TanksView> {
  private rng: Rng;
  terr: Terrain = { top: new Float64Array(FIELD_W), gapA: new Float64Array(FIELD_W), gapB: new Float64Array(FIELD_W) };
  private terrVer = 0;
  tanks: Tank[] = [];
  private shells: Shell[] = [];
  wind = 0;
  private turn = 0;
  private turnNo = 0;
  phase: Phase = "aim";
  private phaseT = 0;
  duel = 0;
  private wins = 0;
  private score = 0;
  private prevB = 0;
  private holdT = 0;
  private dragging = false;
  private cpuPlan = { angle: 160, power: 60, weapon: 0 };
  private cpuShots = 0;
  private over = false;
  private won = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number, duel = 0) {
    this.rng = new Rng(seed);
    this.duel = duel;
    this.newDuel();
  }

  // ------------------------------------------------------------ setup

  private newDuel() {
    const rng = this.rng;
    const t = this.terr;
    const base = 250 - rng.int(40);
    const pts: number[] = [];
    for (let i = 0; i <= 10; i++) pts.push(base + rng.range(-50, 40));
    const fine: number[] = [];
    for (let i = 0; i <= 40; i++) fine.push(rng.range(-6, 6));
    const hill = 30 + Math.min(this.duel * 12, 80) + rng.int(30);
    const hx = 250 + rng.int(140);
    const hw = 80 + rng.int(60);
    for (let x = 0; x < FIELD_W; x++) {
      const i = Math.floor(x / 64), f = (x % 64) / 64;
      const sm = f * f * (3 - 2 * f);
      let h = pts[i] + (pts[i + 1] - pts[i]) * sm;
      const j = Math.floor(x / 16), g = (x % 16) / 16;
      h += fine[j] + (fine[j + 1] - fine[j]) * g * g * (3 - 2 * g);
      const d = (x - hx) / hw;
      if (d > -1 && d < 1) h -= hill * (1 - d * d) * (1 - d * d);
      t.top[x] = Math.max(70, Math.min(FLOOR - 20, Math.round(h)));
      t.gapA[x] = 0;
      t.gapB[x] = 0;
    }
    const px = 46 + rng.int(70), cx = 524 + rng.int(70);
    for (const x of [px, cx]) {
      const h = t.top[x];
      for (let c = x - 15; c <= x + 15; c++) if (c >= 0 && c < FIELD_W) t.top[c] = h;
    }
    this.terrVer++;
    const cpuHp = Math.min(220, 60 + 25 * this.duel);
    const fresh = () => WEAPONS.map((w) => w.ammo);
    this.tanks = [
      { x: px, y: t.top[px], vy: 0, falling: false, fallFrom: 0, hp: PLAYER_HP, maxHp: PLAYER_HP, angle: 224, power: 60, weapon: 0, ammo: fresh() },
      { x: cx, y: t.top[cx], vy: 0, falling: false, fallFrom: 0, hp: cpuHp, maxHp: cpuHp, angle: 160, power: 60, weapon: 0, ammo: fresh() },
    ];
    this.shells = [];
    this.cpuShots = 0;
    this.turn = 0;
    this.dragging = false;
    this.newWind();
    this.setPhase("aim");
    this.events.push({ t: "duel", duel: this.duel });
  }

  private newWind() {
    const m = Math.min(10, 3 + this.duel * 2);
    this.wind = this.rng.range(-m, m);
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  // ------------------------------------------------------------ step

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over || this.won) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    this.phaseT++;
    this.settleTerrain();
    this.dropTanks();
    switch (this.phase) {
      case "aim":
        if (this.turn === 0) this.playerAim(inp, pressed);
        else this.cpuAim();
        break;
      case "fly":
        this.flyShells();
        if (this.shells.length === 0) this.setPhase("settle");
        break;
      case "settle":
        if (this.phaseT >= 30 && !this.unsettled()) this.endTurn();
        break;
      case "duelWon":
        if (this.phaseT >= 150) {
          if (this.wins >= MAX_WINS) {
            this.won = true;
            this.events.push({ t: "won", sfx: "won", mood: "happy" });
          } else {
            this.duel++;
            this.newDuel();
          }
        }
        break;
      case "dying":
        if (this.phaseT >= 90) {
          this.over = true;
          this.events.push({ t: "gameover", sfx: "gameover" });
        }
        break;
    }
  }

  // ------------------------------------------------------------ aiming

  private playerAim(inp: Input, pressed: number) {
    const tk = this.tanks[0];
    if (pressed & BTN.ALT) this.cycleWeapon(tk);
    if (this.dragging) {
      const dx = inp.x - tk.x, dy = inp.y - (tk.y - TURRET_DY);
      const len = Math.sqrt(dx * dx + dy * dy);
      if (inp.b & BTN.FIRE) {
        if (len >= DRAG_MIN) {
          let a = angle256(dx, dy);
          if (a < 64) a = ANG_MAX;
          else if (a < ANG_MIN) a = ANG_MIN;
          tk.angle = Math.min(ANG_MAX, a);
          tk.power = Math.max(P_MIN, Math.min(P_MAX, Math.round((len * P_MAX) / DRAG_FULL)));
        }
      } else {
        this.dragging = false;
        if (len >= DRAG_MIN) this.fire(0);
      }
      return;
    }
    if (pressed & BTN.FIRE) {
      const dx = inp.x - tk.x, dy = inp.y - (tk.y - TURRET_DY);
      if (dx * dx + dy * dy <= GRAB_R * GRAB_R) this.dragging = true;
      else this.fire(0);
      return;
    }
    const arrows = inp.b & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN);
    this.holdT = arrows ? this.holdT + 1 : 0;
    const rep = this.holdT > REPEAT_DELAY;
    const go = (bit: number) => (pressed & bit) !== 0 || (rep && (inp.b & bit) !== 0);
    if (go(BTN.LEFT)) tk.angle = Math.max(ANG_MIN, tk.angle - 1);
    if (go(BTN.RIGHT)) tk.angle = Math.min(ANG_MAX, tk.angle + 1);
    if (go(BTN.UP)) tk.power = Math.min(P_MAX, tk.power + 1);
    if (go(BTN.DOWN)) tk.power = Math.max(P_MIN, tk.power - 1);
  }

  private cycleWeapon(tk: Tank) {
    for (let k = 1; k <= WEAPONS.length; k++) {
      const w = (tk.weapon + k) % WEAPONS.length;
      if (tk.ammo[w] !== 0) {
        tk.weapon = w;
        break;
      }
    }
    this.events.push({ t: "weapon", sfx: "wall", weapon: tk.weapon });
  }

  private planCpu() {
    const me = this.tanks[1], foe = this.tanks[0];
    const best = searchShot(this.terr, this.wind, this.tanks, 1, 0);
    const first = this.cpuShots === 0 ? 2 : 0;
    const errA = Math.max(0, 4 - this.duel) + first;
    const errP = Math.max(2, 9 - 2 * this.duel) + first * 2;
    const angle = Math.max(ANG_MIN, Math.min(ANG_MAX, best.angle + this.rng.range(-errA, errA)));
    const power = Math.max(P_MIN, Math.min(P_MAX, best.power + this.rng.range(-errP, errP)));
    let weapon = W_SHELL;
    if (this.duel >= 1 && me.ammo[W_BOMB] > 0 && foe.hp >= 50 && this.cpuShots >= 1) weapon = W_BOMB;
    else if (this.duel >= 1 && me.ammo[W_TRIPLE] > 0 && this.rng.int(3) === 0) weapon = W_TRIPLE;
    this.cpuPlan = { angle, power, weapon };
  }

  private cpuAim() {
    const tk = this.tanks[1], P = this.cpuPlan;
    if (this.phaseT < 30) return;
    if (tk.weapon !== P.weapon) {
      tk.weapon = P.weapon;
      this.events.push({ t: "weapon", sfx: "wall", weapon: tk.weapon });
    }
    if (tk.angle !== P.angle) tk.angle += tk.angle < P.angle ? 1 : -1;
    if (tk.power !== P.power) tk.power += tk.power < P.power ? 1 : -1;
    if (tk.angle === P.angle && tk.power === P.power) {
      if (this.holdT++ >= 15) this.fire(1);
    } else this.holdT = 0;
  }

  private fire(i: number) {
    const tk = this.tanks[i];
    const w = tk.weapon;
    if (tk.ammo[w] > 0) tk.ammo[w]--;
    const angles = w === W_TRIPLE ? [tk.angle - 4, tk.angle, tk.angle + 4] : [tk.angle];
    for (const a of angles) this.shells.push(launch(tk.x, tk.y, a, tk.power, w, i));
    const s = this.shells[0];
    this.events.push({ t: "fire", sfx: w === W_BOMB ? "launch" : "shot", x: s.x, y: s.y, owner: i, weapon: w });
    if (tk.ammo[w] === 0) tk.weapon = W_SHELL;
    if (i === 1) this.cpuShots++;
    this.dragging = false;
    this.holdT = 0;
    this.setPhase("fly");
  }

  // ------------------------------------------------------------ flight + damage

  private flyShells() {
    const keep: Shell[] = [];
    for (const s of this.shells) {
      const imp = shellFrame(s, this.wind, this.terr, this.tanks);
      if (!imp) keep.push(s);
      else if (imp.out) this.events.push({ t: "miss", x: imp.x, y: imp.y });
      else this.explode(imp.x, imp.y, s.w, s.owner);
    }
    this.shells = keep;
  }

  private explode(x: number, y: number, w: number, owner: number) {
    const W = WEAPONS[w];
    this.carve(x, y, W.r);
    this.events.push({ t: "boom", sfx: "explode", shake: Math.round(W.r / 3), x, y, r: W.r, big: w === W_BOMB });
    for (let i = 0; i < this.tanks.length; i++) {
      const tk = this.tanks[i];
      if (tk.hp <= 0) continue;
      const dx = tk.x - x, dy = tk.y - 7 - y;
      const d = Math.sqrt(dx * dx + dy * dy);
      const reach = W.r + 12;
      if (d >= reach) continue;
      const f = 1 - Math.max(0, d - 6) / reach;
      this.damage(i, Math.max(1, Math.round(W.dmg * f)), owner);
    }
  }

  private damage(i: number, amount: number, owner: number) {
    const tk = this.tanks[i];
    const dmg = Math.min(amount, tk.hp);
    if (dmg <= 0) return;
    tk.hp -= dmg;
    if (owner === 0 && i === 1) this.score += dmg;
    this.events.push({ t: "hit", sfx: "brick", mood: i === 1 ? "happy" : "sad", x: tk.x, y: tk.y - 22, dmg, tank: i, killed: tk.hp <= 0 });
  }

  private carve(cx: number, cy: number, r: number) {
    const t = this.terr;
    for (let c = Math.floor(cx - r); c <= Math.ceil(cx + r); c++) {
      if (c < 0 || c >= FIELD_W) continue;
      const dx = c + 0.5 - cx;
      if (dx * dx >= r * r) continue;
      // Finish any pending settle in this column first.
      if (t.gapB[c] > t.gapA[c]) t.top[c] += t.gapB[c] - t.gapA[c];
      t.gapA[c] = 0;
      t.gapB[c] = 0;
      const h = Math.sqrt(r * r - dx * dx);
      const a = cy - h;
      const b = Math.min(FLOOR, cy + h);
      const top = t.top[c];
      if (b <= top || a >= b) continue;
      if (a <= top) t.top[c] = b;
      else {
        t.gapA[c] = a;
        t.gapB[c] = b;
      }
    }
    this.terrVer++;
  }

  private settleTerrain() {
    const t = this.terr;
    let changed = false;
    for (let c = 0; c < FIELD_W; c++) {
      const g = t.gapB[c] - t.gapA[c];
      if (g <= 0) continue;
      const d = Math.min(SETTLE_SPEED, g);
      t.top[c] += d;
      t.gapA[c] += d;
      if (t.gapB[c] - t.gapA[c] <= 1e-6) {
        t.gapA[c] = 0;
        t.gapB[c] = 0;
      }
      changed = true;
    }
    if (changed) this.terrVer++;
  }

  private support(x: number): number {
    let m = FLOOR;
    for (let c = Math.floor(x) - 9; c <= Math.floor(x) + 9; c++) {
      if (c < 0 || c >= FIELD_W) continue;
      if (this.terr.top[c] < m) m = this.terr.top[c];
    }
    return m;
  }

  private dropTanks() {
    for (let i = 0; i < this.tanks.length; i++) {
      const tk = this.tanks[i];
      const sup = this.support(tk.x);
      if (tk.y < sup - 0.01) {
        if (!tk.falling) {
          tk.falling = true;
          tk.fallFrom = tk.y;
          tk.vy = 0;
        }
        tk.vy += 0.25;
        tk.y = Math.min(sup, tk.y + tk.vy);
        if (tk.y >= sup) this.land(i);
      } else {
        tk.y = sup;
        if (tk.falling) this.land(i);
      }
    }
  }

  private land(i: number) {
    const tk = this.tanks[i];
    const fell = tk.y - tk.fallFrom;
    tk.falling = false;
    tk.vy = 0;
    if (fell > 6) this.events.push({ t: "land", sfx: "wall", x: tk.x, y: tk.y, shake: fell > 20 ? 4 : 0 });
    if (fell > 20 && tk.hp > 0) this.damage(i, Math.floor((fell - 20) / 3) + 1, -1);
  }

  private unsettled(): boolean {
    for (const tk of this.tanks) if (tk.falling) return true;
    const t = this.terr;
    for (let c = 0; c < FIELD_W; c++) if (t.gapB[c] > t.gapA[c]) return true;
    return false;
  }

  private endTurn() {
    const me = this.tanks[0], cpu = this.tanks[1];
    if (me.hp <= 0) {
      this.setPhase("dying");
      this.events.push({ t: "dead", sfx: "lost", mood: "sad", shake: 10, x: me.x, y: me.y - 8 });
      return;
    }
    if (cpu.hp <= 0) {
      this.wins++;
      this.score += 1000;
      this.setPhase("duelWon");
      this.events.push({ t: "duelWon", sfx: "levelclear", toast: "levelClear", mood: "happy", x: cpu.x, y: cpu.y - 8 });
      return;
    }
    this.turn ^= 1;
    this.turnNo++;
    this.newWind();
    this.holdT = 0;
    this.dragging = false;
    if (this.turn === 1) this.planCpu();
    this.setPhase("aim");
    this.events.push({ t: "turn", turn: this.turn, wind: this.wind });
  }

  // ------------------------------------------------------------ host API

  view(): TanksView {
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      turn: this.turn,
      turnNo: this.turnNo,
      duel: this.duel,
      wins: this.wins,
      score: this.score,
      wind: this.wind,
      terr: this.terr,
      terrVer: this.terrVer,
      tanks: this.tanks.map((k) => ({ x: k.x, y: k.y, hp: k.hp, maxHp: k.maxHp, angle: k.angle, power: k.power, weapon: k.weapon, ammo: k.ammo.slice(), falling: k.falling })),
      shells: this.shells.map((s) => ({ x: s.x, y: s.y, w: s.w, roll: s.roll })),
      dragging: this.dragging,
      dead: this.phase === "dying" || this.over,
      won: this.won,
    };
  }
  hud(): Hud {
    const tk = this.tanks[0];
    const w = WEAPONS[tk.weapon];
    return { score: this.score, level: this.duel + 1, label: `HP ${tk.hp} · ${w.name}${w.ammo >= 0 ? ` x${tk.ammo[tk.weapon]}` : ""}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.duel, levelsCleared: this.wins, frames: this.frame, status: this.won ? "won" : this.over ? "over" : "playing" };
  }
  get done() {
    return this.over || this.won;
  }
}

// ---------------------------------------------------------------- bot

let botKey = "";
let botPlan = { angle: 224, power: 60, weapon: 0 };

function botTarget(v: TanksView) {
  const key = `${v.duel}|${v.turnNo}|${v.terrVer}|${v.score}|${v.tanks[0].x}|${v.tanks[1].x}|${v.wind}`;
  if (key !== botKey) {
    botKey = key;
    const best = searchShot(v.terr, v.wind, v.tanks, 0, 1);
    const me = v.tanks[0];
    const weapon = me.ammo[W_BOMB] > 0 ? W_BOMB : me.ammo[W_TRIPLE] > 0 ? W_TRIPLE : W_SHELL;
    // Imperfect on purpose: a small deterministic aim error per turn.
    const ea = ((v.turnNo * 3) % 5) - 2, ep = ((v.turnNo * 5) % 9) - 4;
    botPlan = {
      angle: Math.max(ANG_MIN, Math.min(ANG_MAX, best.angle + ea)),
      power: Math.max(P_MIN, Math.min(P_MAX, best.power + ep)),
      weapon,
    };
  }
  return botPlan;
}

export const tanks: GameDef<TanksView> = {
  id: "tanks",
  name: "Tank Duel",
  tagline: "Lob shells over the hills and blast the bear tank before it blasts you.",
  genre: "Turn-based artillery",
  session: "3–10 min",
  controls:
    "Drag from your tank to aim: direction sets the angle, distance sets the power (a short dotted guide shows the first part of the arc); release to fire. Keyboard: ← / → angle, ↑ / ↓ power, Space fires, X (or Shift / right click) switches weapon: shell, triple shot, roller, big bomb (limited ammo). Watch the wind; it changes every turn.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 30 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original turn-based artillery game: rules, destructible heightmap terrain, weapons, CPU aiming and art written from scratch. No code, names, characters, art or sounds from any commercial game.",
  },
  create: (seed) => new TanksEngine(seed),
  bot(v) {
    const idle = { x: 320, y: 20, b: 0 };
    if (v.phase !== "aim" || v.turn !== 0) return idle;
    const P = botTarget(v);
    const me = v.tanks[0];
    if (me.weapon !== P.weapon) return { ...idle, b: v.frame & 1 ? 0 : BTN.ALT };
    if (me.angle !== P.angle) return { ...idle, b: me.angle < P.angle ? BTN.RIGHT : BTN.LEFT };
    if (me.power !== P.power) return { ...idle, b: me.power < P.power ? BTN.UP : BTN.DOWN };
    return { ...idle, b: v.phaseT >= 40 && (v.frame & 1) ? BTN.FIRE : 0 };
  },
};
