/*
 * Moon Defense: an original "protect your cities from falling rockets" game
 * for ArcadePad. Rules, numbers and art written from scratch; no code, names,
 * art or sounds from any commercial game.
 * ArcadePad, GPL-3.0-or-later.
 *
 * FUD rockets fall from the sky toward six coin-cities and three launch
 * bases on the moon's surface. Tap anywhere to fire an interceptor from the
 * nearest base that still has ammo; it flies to the point and blooms into an
 * expanding blast that destroys anything inside (and destroyed rockets pop in
 * a small chain blast). Splitters fork into several rockets mid-flight, smart
 * bombs sidestep blasts, and bombers cross the sky dropping more rockets.
 * After each wave: bonus for remaining ammo and cities, then bases are rebuilt
 * and ammo refilled. Every 10,000 points banks an extra city. The run ends
 * when the last city falls.
 *
 * Determinism: plain IEEE + - * / and Math.sqrt on doubles, randomness only
 * from Rng, no transcendental Math.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- constants

export const W = 360;
export const H = 600;
export const GROUND = 560; // surface line
export const BASE_X = [28, 180, 332];
export const BASE_Y = GROUND - 14; // launch point (top of the mound)
export const CITY_X = [66, 102, 138, 222, 258, 294];
export const CITY_Y = GROUND - 4; // impact point of a city
export const AIM_MAX_Y = GROUND - 34; // lowest point you can target
export const AMMO = 10; // per base per wave
export const SHOT_SPEED = 7.5; // px per frame
export const SHOT_SPEED_MID = 9.5; // centre base is quicker
export const BLAST_R = 28;
export const CHAIN_R = 14;
export const BOMBER_CHAIN_R = 22;
const GROW = 16;
const HOLD = 10;
const SHRINK = 16;
const MAX_SHOTS = 10;
const INTRO = 90; // frames before a wave starts dropping rockets
const TALLY = 160; // bonus screen length
const LOSE_DELAY = 100; // frames between the last city falling and the end
const EXTRA_CITY = 10000;
const BOMBER_W = 26;

export type Phase = "play" | "tally" | "over";

/** Sites 0..2 are bases (left, mid, right), 3..8 are cities. */
export interface SiteV {
  kind: "base" | "city";
  x: number;
  alive: boolean;
  ammo: number;
}
export interface RocketV {
  id: number;
  kind: 0 | 1 | 2; // 0 rocket, 1 splitter, 2 smart bomb
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
}
export interface BomberV {
  id: number;
  x: number;
  y: number;
  dir: number;
}
export interface ShotV {
  id: number;
  base: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
}
export interface BoomV {
  id: number;
  x: number;
  y: number;
  r: number;
  max: number;
  t: number;
  kind: 0 | 1 | 2; // 0 interceptor blast, 1 chain blast, 2 ground impact (harmless)
}
export interface DefenseView {
  frame: number;
  phase: Phase;
  phaseT: number;
  wave: number; // 1-based
  mult: number;
  score: number;
  /** Frames left before the wave starts dropping rockets (0 once it runs). */
  intro: number;
  cross: { x: number; y: number };
  pointerMode: boolean;
  /** Selected base for keyboard fire, -1 = nearest. */
  sel: number;
  sites: SiteV[];
  rockets: RocketV[];
  bombers: BomberV[];
  shots: ShotV[];
  booms: BoomV[];
  citiesLeft: number;
  bank: number;
  bonus: { ammo: number; ammoPts: number; cities: number; cityPts: number; total: number } | null;
}

interface Rocket {
  id: number;
  kind: 0 | 1 | 2;
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  speed: number;
  site: number;
  splitY: number;
  dead: boolean;
}
interface Bomber {
  id: number;
  x: number;
  y: number;
  dir: number;
  speed: number;
  drop: number;
  dead: boolean;
}
interface Shot {
  id: number;
  base: number;
  x: number;
  y: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  vx: number;
  vy: number;
  speed: number;
}
interface Boom {
  id: number;
  x: number;
  y: number;
  max: number;
  t: number;
  kind: 0 | 1 | 2;
}

export function boomRadius(max: number, t: number): number {
  if (t < GROW) return (max * (t + 1)) / GROW;
  if (t < GROW + HOLD) return max;
  return (max * (GROW + HOLD + SHRINK - t)) / SHRINK;
}
const BOOM_LIFE = GROW + HOLD + SHRINK;

export function siteX(i: number): number {
  return i < 3 ? BASE_X[i] : CITY_X[i - 3];
}
function siteY(i: number): number {
  return i < 3 ? BASE_Y + 2 : CITY_Y;
}

export function waveCfg(w: number) {
  return {
    count: Math.min(36, 8 + w * 2),
    speed: Math.min(1.75, 0.55 + 0.08 * (w - 1)),
    gap: Math.max(34, 110 - 7 * w),
    salvo: Math.min(4, 1 + (w >> 1)),
    split: w >= 2 ? Math.min(30, 6 + 3 * w) : 0, // percent
    smart: w >= 5 ? Math.min(6, w - 4) : 0,
    bombers: w >= 3 ? Math.min(4, (w - 1) >> 1) : 0,
  };
}
export const multFor = (w: number) => Math.min(6, 1 + ((w - 1) >> 1));

// ---------------------------------------------------------------- engine

class DefenseEngine implements GameEngine<DefenseView> {
  private rng: Rng;
  private alive: boolean[] = [true, true, true, true, true, true, true, true, true];
  private ammo = [AMMO, AMMO, AMMO];
  private rockets: Rocket[] = [];
  private bombers: Bomber[] = [];
  private shots: Shot[] = [];
  private booms: Boom[] = [];
  private nextId = 1;
  private phase: Phase = "play";
  private phaseT = 0;
  private wave = 1;
  private cleared = 0;
  private score = 0;
  private nextExtra = EXTRA_CITY;
  private bank = 0;
  // wave spawning
  private toSpawn = 0;
  private smartLeft = 0;
  private bombersLeft = 0;
  private spawnT = 0;
  private bomberT = 0;
  // input
  private prevB = 0;
  private px = 0;
  private py = 0;
  private pointerMode = false;
  private cx = W / 2;
  private cy = 300;
  private hold = 0;
  private sel = -1;
  private loseT = -1;
  private ended = false;
  private bonus: DefenseView["bonus"] = null;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.startWave();
  }

  private startWave() {
    const c = waveCfg(this.wave);
    this.toSpawn = c.count;
    this.smartLeft = c.smart;
    this.bombersLeft = c.bombers;
    this.spawnT = INTRO;
    this.bomberT = INTRO + 240 + this.rng.int(240);
    this.ammo = [AMMO, AMMO, AMMO];
    for (let i = 0; i < 3; i++) this.alive[i] = true;
    while (this.bank > 0 && this.restoreCity()) this.bank--;
    this.phase = "play";
    this.phaseT = 0;
    this.bonus = null;
    this.events.push({ t: "wave", wave: this.wave, mult: multFor(this.wave), sfx: "launch" });
  }

  private restoreCity(): boolean {
    for (let i = 3; i < 9; i++) {
      if (!this.alive[i]) {
        this.alive[i] = true;
        this.events.push({ t: "cityBack", site: i, x: siteX(i), y: CITY_Y - 10, sfx: "extraGood", mood: "happy" });
        return true;
      }
    }
    return false;
  }

  private citiesLeft() {
    let n = 0;
    for (let i = 3; i < 9; i++) if (this.alive[i]) n++;
    return n;
  }

  private addScore(n: number) {
    this.score += n;
    while (this.score >= this.nextExtra) {
      this.nextExtra += EXTRA_CITY;
      this.bank++;
      this.events.push({ t: "extraCity", sfx: "extraGood", mood: "happy", x: W / 2, y: 200 });
    }
  }

  // -------------------------------------------------------------- input

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.ended) return;
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    if (this.frame === 1) {
      this.px = inp.x;
      this.py = inp.y;
    }
    if (inp.x !== this.px || inp.y !== this.py) this.pointerMode = true;
    this.px = inp.x;
    this.py = inp.y;
    const arrows = inp.b & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN);
    if (arrows) {
      this.pointerMode = false;
      this.hold++;
      const d = this.hold > 24 ? 6 : this.hold > 8 ? 4 : 2;
      if (inp.b & BTN.LEFT) this.cx -= d;
      if (inp.b & BTN.RIGHT) this.cx += d;
      if (inp.b & BTN.UP) this.cy -= d;
      if (inp.b & BTN.DOWN) this.cy += d;
    } else this.hold = 0;
    if (this.pointerMode) {
      this.cx = inp.x;
      this.cy = inp.y;
    }
    this.cx = Math.max(4, Math.min(W - 4, this.cx));
    this.cy = Math.max(8, Math.min(AIM_MAX_Y, this.cy));

    if (pressed & BTN.ALT) {
      this.sel = this.sel >= 2 ? -1 : this.sel + 1;
      this.events.push({ t: "select", sel: this.sel, sfx: "wall" });
    }

    this.phaseT++;
    if (this.phase === "play") {
      if (pressed & BTN.FIRE && this.loseT < 0) this.fire(this.cx, this.cy);
      this.stepPlay();
    } else if (this.phase === "tally") {
      this.stepWorld();
      if (this.phaseT >= TALLY) {
        this.wave++;
        this.startWave();
      }
    }
  }

  private pickBase(tx: number): number {
    if (this.sel >= 0 && this.alive[this.sel] && this.ammo[this.sel] > 0) return this.sel;
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < 3; i++) {
      if (!this.alive[i] || this.ammo[i] <= 0) continue;
      const d = Math.abs(BASE_X[i] - tx);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  private fire(tx: number, ty: number) {
    if (this.shots.length >= MAX_SHOTS) return;
    const b = this.pickBase(tx);
    if (b < 0) {
      this.events.push({ t: "dry", sfx: "wall", x: tx, y: ty });
      return;
    }
    this.ammo[b]--;
    const sx = BASE_X[b];
    const sy = BASE_Y;
    const dx = tx - sx;
    const dy = ty - sy;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = b === 1 ? SHOT_SPEED_MID : SHOT_SPEED;
    this.shots.push({ id: this.nextId++, base: b, x: sx, y: sy, sx, sy, tx, ty, vx: (dx / len) * speed, vy: (dy / len) * speed, speed });
    this.events.push({ t: "fire", base: b, sfx: "shot", x: sx, y: sy, ammo: this.ammo[b] });
  }

  // -------------------------------------------------------------- world

  private aimRocket(r: Rocket) {
    const dx = r.tx - r.x;
    const dy = r.ty - r.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    r.vx = (dx / len) * r.speed;
    r.vy = (dy / len) * r.speed;
  }

  private pickTarget(): number {
    // Mostly aim at standing targets, sometimes at rubble.
    if (this.rng.int(100) < 80) {
      const live: number[] = [];
      for (let i = 0; i < 9; i++) if (this.alive[i]) live.push(i);
      if (live.length) return live[this.rng.int(live.length)];
    }
    return this.rng.int(9);
  }

  private spawnRocket(x: number, y: number, kind: 0 | 1 | 2, speed: number) {
    const site = this.pickTarget();
    const r: Rocket = {
      id: this.nextId++,
      kind,
      x,
      y,
      sx: x,
      sy: y,
      tx: siteX(site),
      ty: siteY(site),
      vx: 0,
      vy: 0,
      speed,
      site,
      splitY: kind === 1 ? Math.max(y + 40, 150 + this.rng.int(180)) : 0,
      dead: false,
    };
    this.aimRocket(r);
    this.rockets.push(r);
  }

  private stepPlay() {
    const c = waveCfg(this.wave);
    // Salvos from the top.
    if (this.toSpawn > 0 && --this.spawnT <= 0) {
      const n = Math.min(this.toSpawn, 1 + this.rng.int(c.salvo));
      for (let k = 0; k < n; k++) {
        let kind: 0 | 1 | 2 = 0;
        if (this.smartLeft > 0 && this.rng.int(this.toSpawn) < this.smartLeft) {
          kind = 2;
          this.smartLeft--;
        } else if (this.rng.int(100) < c.split) kind = 1;
        this.spawnRocket(8 + this.rng.int(W - 16), -4, kind, c.speed * (kind === 2 ? 0.85 : 1));
        this.toSpawn--;
      }
      this.spawnT = c.gap + this.rng.int(30);
    }
    // Bombers.
    if (this.bombersLeft > 0 && --this.bomberT <= 0) {
      this.bombersLeft--;
      const dir = this.rng.int(2) ? 1 : -1;
      this.bombers.push({
        id: this.nextId++,
        x: dir > 0 ? -BOMBER_W : W + BOMBER_W,
        y: 100 + this.rng.int(130),
        dir,
        speed: Math.min(1.6, 0.7 + 0.05 * this.wave),
        drop: 50 + this.rng.int(40),
        dead: false,
      });
      this.events.push({ t: "bomber", sfx: "extraBad" });
      this.bomberT = 360 + this.rng.int(300);
    }
    this.stepWorld();

    if (this.loseT >= 0) {
      if (++this.loseT >= LOSE_DELAY) {
        this.phase = "over";
        this.ended = true;
        this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
      }
      return;
    }
    // Wave cleared?
    if (this.toSpawn === 0 && this.bombersLeft === 0 && !this.rockets.length && !this.bombers.length && !this.shots.length && !this.booms.length) {
      this.endWave();
    }
  }

  private endWave() {
    const m = multFor(this.wave);
    let ammo = 0;
    for (let i = 0; i < 3; i++) if (this.alive[i]) ammo += this.ammo[i];
    const cities = this.citiesLeft();
    const ammoPts = ammo * 5 * m;
    const cityPts = cities * 100 * m;
    this.bonus = { ammo, ammoPts, cities, cityPts, total: ammoPts + cityPts };
    this.cleared++;
    this.phase = "tally";
    this.phaseT = 0;
    this.addScore(ammoPts + cityPts);
    this.events.push({ t: "waveClear", wave: this.wave, bonus: ammoPts + cityPts, sfx: "levelclear", toast: "levelClear", mood: "happy" });
  }

  private boom(x: number, y: number, max: number, kind: 0 | 1 | 2) {
    this.booms.push({ id: this.nextId++, x, y, max, t: 0, kind });
  }

  private stepWorld() {
    // Interceptors.
    for (const s of this.shots) {
      const dx = s.tx - s.x;
      const dy = s.ty - s.y;
      if (dx * dx + dy * dy <= s.speed * s.speed) {
        s.x = s.tx;
        s.y = s.ty;
        s.speed = 0;
        this.boom(s.tx, s.ty, BLAST_R, 0);
        this.events.push({ t: "blast", sfx: "brick", x: s.tx, y: s.ty });
      } else {
        s.x += s.vx;
        s.y += s.vy;
      }
    }
    this.shots = this.shots.filter((s) => s.speed > 0);

    // Bombers.
    for (const b of this.bombers) {
      b.x += b.dir * b.speed;
      if (b.x > 20 && b.x < W - 20 && --b.drop <= 0) {
        b.drop = 70 + this.rng.int(60);
        this.spawnRocket(b.x, b.y + 6, 0, waveCfg(this.wave).speed);
        this.events.push({ t: "drop", x: b.x, y: b.y });
      }
      if ((b.dir > 0 && b.x > W + BOMBER_W) || (b.dir < 0 && b.x < -BOMBER_W)) b.dead = true;
    }

    // Rockets.
    const born: Rocket[] = [];
    for (const r of this.rockets) {
      if (r.dead) continue;
      if (r.kind === 2) this.dodge(r);
      r.x += r.vx;
      r.y += r.vy;
      if (r.kind === 1 && r.y >= r.splitY && r.splitY > 0) {
        r.splitY = 0;
        const n = 1 + (this.wave >= 6 ? this.rng.int(3) : this.rng.int(2));
        const before = this.rockets.length;
        for (let k = 0; k < n; k++) this.spawnRocket(r.x, r.y, 0, r.speed);
        born.push(...this.rockets.splice(before));
        this.events.push({ t: "split", x: r.x, y: r.y, sfx: "extraBad" });
      }
      if (r.y >= r.ty) this.impact(r);
    }
    for (const r of born) this.rockets.push(r);

    // Blasts.
    for (const e of this.booms) {
      e.t++;
      if (e.kind === 2) continue;
      const rad = boomRadius(e.max, e.t);
      for (const r of this.rockets) {
        if (r.dead) continue;
        const dx = r.x - e.x;
        const dy = r.y - e.y;
        const rr = rad + 2;
        if (dx * dx + dy * dy <= rr * rr) this.kill(r);
      }
      for (const b of this.bombers) {
        if (b.dead) continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const rr = rad + 9;
        if (dx * dx + dy * dy <= rr * rr) {
          b.dead = true;
          const m = multFor(this.wave);
          this.addScore(100 * m);
          this.boom(b.x, b.y, BOMBER_CHAIN_R, 1);
          this.events.push({ t: "killBomber", x: b.x, y: b.y, pts: 100 * m, sfx: "explode", shake: 4 });
        }
      }
    }
    this.booms = this.booms.filter((e) => e.t < BOOM_LIFE);
    this.rockets = this.rockets.filter((r) => !r.dead);
    this.bombers = this.bombers.filter((b) => !b.dead);
  }

  private dodge(r: Rocket) {
    for (const e of this.booms) {
      if (e.kind === 2) continue;
      const dx = r.x - e.x;
      const dy = r.y - e.y;
      const near = e.max + 18;
      if (dy < 6 && dx * dx + dy * dy < near * near) {
        r.x += dx >= 0 ? 1.6 : -1.6;
        r.x = Math.max(4, Math.min(W - 4, r.x));
        this.aimRocket(r);
        return;
      }
    }
  }

  private kill(r: Rocket) {
    r.dead = true;
    const m = multFor(this.wave);
    const pts = (r.kind === 2 ? 125 : 25) * m;
    this.addScore(pts);
    this.boom(r.x, r.y, CHAIN_R, 1);
    this.events.push({ t: "kill", kind: r.kind, x: r.x, y: r.y, pts, sfx: "brickgone" });
  }

  private impact(r: Rocket) {
    r.dead = true;
    this.boom(r.tx, r.ty, 18, 2);
    const s = r.site;
    if (!this.alive[s]) {
      this.events.push({ t: "thud", x: r.tx, y: r.ty, sfx: "wall", shake: 2 });
      return;
    }
    this.alive[s] = false;
    if (s < 3) {
      this.ammo[s] = 0;
      this.events.push({ t: "baseLost", site: s, x: r.tx, y: r.ty, sfx: "explode", shake: 7 });
      return;
    }
    this.events.push({ t: "cityLost", site: s, x: r.tx, y: r.ty, sfx: "lost", mood: "sad", shake: 9, toast: "lifeLost" });
    if (this.citiesLeft() === 0) {
      if (this.bank > 0) {
        this.bank--;
        this.restoreCity();
      } else if (this.loseT < 0) this.loseT = 0;
    }
  }

  // -------------------------------------------------------------- output

  view(): DefenseView {
    const sites: SiteV[] = [];
    for (let i = 0; i < 9; i++) sites.push({ kind: i < 3 ? "base" : "city", x: siteX(i), alive: this.alive[i], ammo: i < 3 ? this.ammo[i] : 0 });
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      wave: this.wave,
      mult: multFor(this.wave),
      score: this.score,
      intro: this.phase === "play" && this.toSpawn === waveCfg(this.wave).count ? Math.max(0, this.spawnT) : 0,
      cross: { x: this.cx, y: this.cy },
      pointerMode: this.pointerMode,
      sel: this.sel,
      sites,
      rockets: this.rockets.map((r) => ({ id: r.id, kind: r.kind, x: r.x, y: r.y, sx: r.sx, sy: r.sy, tx: r.tx, ty: r.ty, vx: r.vx, vy: r.vy })),
      bombers: this.bombers.map((b) => ({ id: b.id, x: b.x, y: b.y, dir: b.dir })),
      shots: this.shots.map((s) => ({ id: s.id, base: s.base, x: s.x, y: s.y, sx: s.sx, sy: s.sy, tx: s.tx, ty: s.ty })),
      booms: this.booms.map((e) => ({ id: e.id, x: e.x, y: e.y, r: boomRadius(e.max, e.t), max: e.max, t: e.t, kind: e.kind })),
      citiesLeft: this.citiesLeft(),
      bank: this.bank,
      bonus: this.bonus,
    };
  }
  hud(): Hud {
    let ammo = 0;
    for (let i = 0; i < 3; i++) if (this.alive[i]) ammo += this.ammo[i];
    const m = multFor(this.wave);
    return { score: this.score, lives: this.citiesLeft(), level: this.wave, label: `Ammo ${ammo}${m > 1 ? ` · x${m}` : ""}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.wave - 1, levelsCleared: this.cleared, frames: this.frame, status: this.ended ? "over" : "playing" };
  }
  get done() {
    return this.ended;
  }
}

// ---------------------------------------------------------------- bot

/** Where a rocket will be when a shot from base b reaches it (one refinement pass). */
function lead(r: RocketV, b: number): { x: number; y: number } {
  const sp = b === 1 ? SHOT_SPEED_MID : SHOT_SPEED;
  let x = r.x;
  let y = r.y;
  for (let k = 0; k < 2; k++) {
    const dx = x - BASE_X[b];
    const dy = y - BASE_Y;
    const t = Math.sqrt(dx * dx + dy * dy) / sp + GROW * 0.5;
    x = r.x + r.vx * t;
    y = r.y + r.vy * t;
  }
  return { x, y };
}

export const defense: GameDef<DefenseView> = {
  id: "defense",
  name: "Moon Defense",
  tagline: "FUD is raining on the moon. Pop it mid-air and keep the coin-cities standing.",
  genre: "Missile-intercept defense",
  session: "3–12 min",
  controls:
    "Tap or click anywhere to fire an interceptor from the nearest base; it bursts where you aimed. Keyboard: arrows move the crosshair, Space fires, X / Shift picks a base. Lead your shots and catch several rockets in one blast.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 40 * 60 * 60,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original game in the protect-your-cities intercept genre: rules, wave tables, scoring and art written from scratch. No code, names, art or sounds from any commercial game.",
  },
  create: (seed) => new DefenseEngine(seed),
  bot(v, frame) {
    const idle = { x: v.cross.x | 0, y: v.cross.y | 0, b: 0 };
    if (v.phase !== "play" || frame % 9 !== 0) return idle;
    // Most urgent first: lowest rockets, smart bombs a bit earlier.
    const threats = v.rockets.filter((r) => r.y > 90).sort((a, b) => b.y + (b.kind === 2 ? 40 : 0) - (a.y + (a.kind === 2 ? 40 : 0)));
    for (const r of threats) {
      let base = -1;
      let bd = Infinity;
      for (let i = 0; i < 3; i++) {
        const s = v.sites[i];
        if (!s.alive || s.ammo <= 0) continue;
        const d = Math.abs(s.x - r.x);
        if (d < bd) {
          bd = d;
          base = i;
        }
      }
      if (base < 0) break;
      const p = lead(r, base);
      if (p.y > AIM_MAX_Y) continue;
      const covered =
        v.shots.some((s) => (s.tx - p.x) * (s.tx - p.x) + (s.ty - p.y) * (s.ty - p.y) < 30 * 30) ||
        v.booms.some((e) => e.kind !== 2 && (e.x - p.x) * (e.x - p.x) + (e.y - p.y) * (e.y - p.y) < (e.max + 4) * (e.max + 4) && e.t < 26);
      if (covered) continue;
      // Imperfect: a little aim wobble.
      const jx = ((frame * 29) % 23) - 11;
      const jy = ((frame * 17) % 19) - 9;
      return {
        x: Math.round(Math.max(0, Math.min(W - 1, p.x + jx))),
        y: Math.round(Math.max(0, Math.min(AIM_MAX_Y, p.y + jy))),
        b: BTN.FIRE,
      };
    }
    return idle;
  },
};
