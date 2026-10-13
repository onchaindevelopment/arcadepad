/*
 * Rock Blaster: wrap-around space rock shooter.
 * Physics and rules ported (re-scaled, retuned) from "HTML5-Asteroids" game.js,
 * Copyright (c) 2010 Doug McInnes, MIT licence
 * (https://github.com/dmcinnes/HTML5-Asteroids/blob/master/LICENSE).
 * Port: ArcadePad, GPL-3.0-or-later.
 *
 * Kept from the original (scaled from its 800x600 field and 30 ms "units" to
 * 640x480 at 60 fps): ~180 deg/s rotation, ~450 px/s^2 thrust scaled, soft
 * speed cap with 0.95 decay above it, bullets inherit ship velocity and expire,
 * auto-repeat fire with a cooldown and an on-screen bullet limit, rocks wrap
 * and spin, ship/rock collision kills the ship and splits the rock, 2 spare
 * ships, respawn at the centre facing up once the area is clear, waves grow
 * by one rock (capped at 12) after a short pause, the saucer enemy enters
 * from a side edge, drifts vertically with random direction flips, shoots on
 * a fixed timer and scores 200.
 * Changed: rocks split into 2 (not 3), scores 20/50/100, light friction,
 * hyperspace, respawn invulnerability, extra life every 10,000, the enemy is
 * an original "bear drone" that comes sooner and aims (loosely) from wave 3,
 * pointer/touch aiming. No assets, sounds or fonts were copied.
 */
import { Rng } from "../core/rng.ts";
import { angle256, cos256, sin256 } from "../core/trig.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const W = 640;
export const H = 480;

// Heading is stored in 1/16 byte-angle steps so turning can be ~2.1 bytes/frame.
const ANG_FRAC = 16;
const ROT = 34; // 34/16 = 2.125 byte angles per frame = ~179 deg/s
const THRUST = 0.1; // px/frame^2
const SPEED_CAP = 3.2; // px/frame; above it speed decays (soft cap)
const CAP_DECAY = 0.975; // 0.95 per 30 ms unit
const FRICTION = 0.993; // added: ship slowly coasts to a stop
const SHIP_R = 9;
const START_ANGLE = 192 * ANG_FRAC; // facing up

const BULLET_SPEED = 4;
const BULLET_LIFE = 60;
const MAX_BULLETS = 5;
const FIRE_COOLDOWN = 12;

export const ROCK_R = [36, 18, 9] as const; // large, medium, small
export const ROCK_SCORE = [20, 50, 100] as const;
const DRONE_R = 14;
const DRONE_SCORE = 200;
const DRONE_SPEED = 0.6;
const DRONE_FIRE = 44;
const DRONE_BULLET_SPEED = 2.6;
const DRONE_BULLET_LIFE = 100;

const START_LIVES = 3;
const EXTRA_LIFE = 10000;
const RESPAWN_DELAY = 60;
const INVULN = 150;
const HYPER_COOLDOWN = 90;
const WAVE_PAUSE = 60;
const GAMEOVER_DELAY = 90;
const SAFE_R = 90;

export interface RockV { id: number; x: number; y: number; vx: number; vy: number; size: 0 | 1 | 2; r: number; shape: number; spin: number }
export interface BulletV { x: number; y: number; life: number }
export interface RocksView {
  frame: number;
  ship: { x: number; y: number; vx: number; vy: number; angle: number; thrust: boolean; alive: boolean; invuln: number };
  bullets: BulletV[];
  enemyBullets: BulletV[];
  rocks: RockV[];
  drone: { x: number; y: number; dir: number } | null;
  score: number;
  lives: number;
  wave: number; // 0-based
  wavePause: number;
  pointerAim: { x: number; y: number } | null;
  over: boolean;
}

interface Bullet { x: number; y: number; vx: number; vy: number; life: number }

const wrapX = (x: number) => (x < 0 ? x + W : x >= W ? x - W : x);
const wrapY = (y: number) => (y < 0 ? y + H : y >= H ? y - H : y);
/** Shortest wrapped delta. */
const wdx = (d: number) => (d > W / 2 ? d - W : d < -W / 2 ? d + W : d);
const wdy = (d: number) => (d > H / 2 ? d - H : d < -H / 2 ? d + H : d);
/** Signed byte-angle difference in -128..127. */
export const angDiff = (target: number, from: number) => ((((target - from + 128) % 256) + 256) % 256) - 128;

class RocksEngine implements GameEngine<RocksView> {
  private rng: Rng;
  private sx = W / 2;
  private sy = H / 2;
  private svx = 0;
  private svy = 0;
  private ang = START_ANGLE;
  private thrusting = false;
  private alive = true;
  private invuln = INVULN;
  private respawnIn = 0;
  private respawnWait = 0;
  private cooldown = 0;
  private hyperCd = 0;
  private bullets: Bullet[] = [];
  private eBullets: Bullet[] = [];
  private rocks: RockV[] = [];
  private nextId = 1;
  private drone: { x: number; y: number; vx: number; vy: number; fire: number } | null = null;
  private droneTimer: number;
  private score = 0;
  private lives = START_LIVES;
  private nextExtra = EXTRA_LIFE;
  private wave = 0;
  private wavesCleared = 0;
  private wavePause = 0;
  private overIn = 0;
  private over = false;
  private prevB = 0;
  // Pointer aiming
  private px = 0;
  private py = 0;
  private pointerMode = false;
  private aim: { x: number; y: number } | null = null;
  private queuedShot = false;
  private holdFrames = 0;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.droneTimer = 1200 + this.rng.int(1200); // first drone after 20-40 s
    this.spawnWave();
  }

  private rand(lo: number, hi: number) {
    // Uniform in [lo, hi] with 1/1000 resolution, integer RNG only.
    return lo + (this.rng.int(1001) / 1000) * (hi - lo);
  }

  private addRock(x: number, y: number, size: 0 | 1 | 2, speed: number) {
    let vx = this.rand(-speed, speed);
    let vy = this.rand(-speed, speed);
    if (Math.abs(vx) + Math.abs(vy) < speed * 0.5) {
      vx = vx < 0 ? vx - speed * 0.4 : vx + speed * 0.4;
      vy = vy < 0 ? vy - speed * 0.3 : vy + speed * 0.3;
    }
    const rock: RockV = { id: this.nextId++, x, y, vx, vy, size, r: ROCK_R[size], shape: this.rng.int(65536), spin: this.rng.int(5) - 2 };
    this.rocks.push(rock);
    return rock;
  }

  private spawnWave() {
    const n = Math.min(12, 3 + this.wave);
    const speed = 0.8 * (1 + Math.min(this.wave, 8) * 0.06);
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0;
      for (let tries = 0; tries < 20; tries++) {
        // Spawn along the edges, away from the ship.
        if (this.rng.int(2)) { x = this.rng.int(W); y = this.rng.int(2) ? 0 : H - 1; }
        else { x = this.rng.int(2) ? 0 : W - 1; y = this.rng.int(H); }
        const dx = wdx(x - this.sx), dy = wdy(y - this.sy);
        if (dx * dx + dy * dy > 160 * 160) break;
      }
      this.addRock(x, y, 0, speed);
    }
  }

  private emit(e: GameEvent) {
    this.events.push(e);
  }

  private addScore(n: number) {
    this.score += n;
    while (this.score >= this.nextExtra) {
      this.nextExtra += EXTRA_LIFE;
      this.lives++;
      this.emit({ t: "extralife", sfx: "extraGood", mood: "happy", x: this.sx, y: this.sy });
    }
  }

  private fire() {
    if (this.cooldown > 0 || this.bullets.length >= MAX_BULLETS || !this.alive) return;
    const a = this.ang / ANG_FRAC;
    const c = cos256(Math.round(a)), s = sin256(Math.round(a));
    this.bullets.push({
      x: wrapX(this.sx + c * (SHIP_R + 3)),
      y: wrapY(this.sy + s * (SHIP_R + 3)),
      vx: c * BULLET_SPEED + this.svx,
      vy: s * BULLET_SPEED + this.svy,
      life: BULLET_LIFE,
    });
    this.cooldown = FIRE_COOLDOWN;
    this.emit({ t: "shot", sfx: "shot", x: this.sx, y: this.sy });
  }

  private turnToward(tx: number, ty: number): number {
    const target = angle256(wdx(tx - this.sx), wdy(ty - this.sy)) * ANG_FRAC;
    let d = target - this.ang;
    const full = 256 * ANG_FRAC;
    d = ((((d + full / 2) % full) + full) % full) - full / 2;
    if (d > ROT) d = ROT;
    else if (d < -ROT) d = -ROT;
    this.ang = (this.ang + d + full) % full;
    return Math.abs(target - this.ang) % full;
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.over) return;
    const b = inp.b;
    const pressed = b & ~this.prevB;
    this.prevB = b;

    // Pointer mode turns on when the pointer moves, off when arrows are used.
    if (this.frame > 1 && (inp.x !== this.px || inp.y !== this.py)) this.pointerMode = true;
    this.px = inp.x;
    this.py = inp.y;
    if (b & (BTN.LEFT | BTN.RIGHT | BTN.UP)) {
      this.pointerMode = false;
      this.aim = null;
      this.queuedShot = false;
    }

    if (this.cooldown > 0) this.cooldown--;
    if (this.hyperCd > 0) this.hyperCd--;
    this.thrusting = false;

    if (this.alive) {
      if (this.invuln > 0) this.invuln--;
      if (this.pointerMode) {
        if (b & BTN.FIRE) {
          this.aim = { x: inp.x, y: inp.y };
          if (pressed & BTN.FIRE) this.queuedShot = true;
          this.holdFrames++;
        } else this.holdFrames = 0;
        if (this.aim) {
          const err = this.turnToward(this.aim.x, this.aim.y);
          const aligned = err <= 3 * ANG_FRAC || err >= (256 - 3) * ANG_FRAC;
          if (aligned && (this.queuedShot || b & BTN.FIRE)) {
            if (this.cooldown === 0 && this.bullets.length < MAX_BULLETS) this.queuedShot = false;
            this.fire();
          }
          // Holding far from the ship flies toward the pointer.
          if (b & BTN.FIRE && this.holdFrames > 15) {
            const dx = wdx(this.aim.x - this.sx), dy = wdy(this.aim.y - this.sy);
            if (dx * dx + dy * dy > 110 * 110 && (err <= 16 * ANG_FRAC || err >= 240 * ANG_FRAC)) this.thrusting = true;
          }
          if (aligned && !(b & BTN.FIRE) && !this.queuedShot) this.aim = null;
        }
      } else {
        if (b & BTN.LEFT) this.ang -= ROT;
        if (b & BTN.RIGHT) this.ang += ROT;
        this.ang = ((this.ang % (256 * ANG_FRAC)) + 256 * ANG_FRAC) % (256 * ANG_FRAC);
        if (b & BTN.UP) this.thrusting = true;
        if (b & BTN.FIRE) this.fire();
      }
      if (pressed & (BTN.ALT | BTN.DOWN)) this.hyperspace();
      this.moveShip();
    } else if (this.lives > 0) {
      this.tryRespawn();
    } else if (--this.overIn <= 0) {
      this.over = true;
      this.emit({ t: "gameover", sfx: "gameover" });
      return;
    }

    this.moveBullets(this.bullets);
    this.moveBullets(this.eBullets);
    for (const r of this.rocks) {
      r.x = wrapX(r.x + r.vx);
      r.y = wrapY(r.y + r.vy);
    }
    this.updateDrone();
    this.collide();

    if (this.rocks.length === 0) {
      if (this.wavePause === 0) {
        this.wavePause = WAVE_PAUSE;
        this.wavesCleared++;
        this.emit({ t: "levelclear", sfx: "levelclear", toast: "levelClear", mood: "happy", wave: this.wave + 1 });
      } else if (--this.wavePause === 0) {
        this.wave++;
        this.spawnWave();
        this.emit({ t: "wave", wave: this.wave + 1 });
      }
    }
  }

  private moveShip() {
    if (this.thrusting) {
      const a = Math.round(this.ang / ANG_FRAC);
      this.svx += cos256(a) * THRUST;
      this.svy += sin256(a) * THRUST;
    }
    this.svx *= FRICTION;
    this.svy *= FRICTION;
    const sp2 = this.svx * this.svx + this.svy * this.svy;
    if (sp2 > SPEED_CAP * SPEED_CAP) {
      this.svx *= CAP_DECAY;
      this.svy *= CAP_DECAY;
    }
    this.sx = wrapX(this.sx + this.svx);
    this.sy = wrapY(this.sy + this.svy);
  }

  private hyperspace() {
    if (this.hyperCd > 0) return;
    this.hyperCd = HYPER_COOLDOWN;
    const fromX = this.sx, fromY = this.sy;
    let x = 0, y = 0;
    for (let tries = 0; tries < 8; tries++) {
      x = 30 + this.rng.int(W - 60);
      y = 30 + this.rng.int(H - 60);
      if (this.isSafe(x, y, 40)) break;
    }
    this.sx = x; this.sy = y; this.svx = 0; this.svy = 0;
    this.emit({ t: "hyper", sfx: "launch", x, y, fromX, fromY });
  }

  private isSafe(x: number, y: number, margin: number) {
    for (const r of this.rocks) {
      const dx = wdx(r.x - x), dy = wdy(r.y - y), m = r.r + margin;
      if (dx * dx + dy * dy < m * m) return false;
    }
    for (const bl of this.eBullets) {
      const dx = wdx(bl.x - x), dy = wdy(bl.y - y);
      if (dx * dx + dy * dy < 60 * 60) return false;
    }
    if (this.drone) {
      const dx = wdx(this.drone.x - x), dy = wdy(this.drone.y - y);
      if (dx * dx + dy * dy < 100 * 100) return false;
    }
    return true;
  }

  private tryRespawn() {
    if (this.respawnIn > 0) { this.respawnIn--; return; }
    this.respawnWait++;
    if (!this.isSafe(W / 2, H / 2, SAFE_R - 36) && this.respawnWait < 300) return;
    this.alive = true;
    this.sx = W / 2; this.sy = H / 2; this.svx = 0; this.svy = 0;
    this.ang = START_ANGLE;
    this.invuln = INVULN;
    this.aim = null;
    this.queuedShot = false;
    this.emit({ t: "respawn", x: this.sx, y: this.sy });
  }

  private moveBullets(list: Bullet[]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const bl = list[i];
      bl.x = wrapX(bl.x + bl.vx);
      bl.y = wrapY(bl.y + bl.vy);
      if (--bl.life <= 0) list.splice(i, 1);
    }
  }

  private updateDrone() {
    if (!this.drone) {
      if (!this.alive || this.wavePause > 0) return;
      if (--this.droneTimer > 0) return;
      const fromLeft = this.rng.int(2) === 0;
      this.drone = {
        x: fromLeft ? 0 : W - 1,
        y: 40 + this.rng.int(H - 80),
        vx: fromLeft ? DRONE_SPEED : -DRONE_SPEED,
        vy: this.rng.int(2) ? 0.4 : -0.4,
        fire: DRONE_FIRE,
      };
      this.emit({ t: "drone", x: this.drone.x, y: this.drone.y });
      return;
    }
    const d = this.drone;
    if (this.rng.int(200) === 0) d.vy = -d.vy;
    d.x += d.vx;
    d.y = wrapY(d.y + d.vy);
    if (d.x < 0 || d.x >= W) {
      this.drone = null;
      this.droneTimer = 600 + this.rng.int(1200); // next in 10-30 s
      return;
    }
    if (--d.fire <= 0) {
      d.fire = DRONE_FIRE;
      let a: number;
      if (this.wave >= 2 && this.alive) a = angle256(wdx(this.sx - d.x), wdy(this.sy - d.y)) + this.rng.int(33) - 16;
      else a = this.rng.int(256);
      if (this.eBullets.length < 3) {
        this.eBullets.push({ x: d.x, y: d.y, vx: cos256(a) * DRONE_BULLET_SPEED, vy: sin256(a) * DRONE_BULLET_SPEED, life: DRONE_BULLET_LIFE });
        this.emit({ t: "droneshot", x: d.x, y: d.y });
      }
    }
  }

  private splitRock(i: number, byPlayer: boolean) {
    const r = this.rocks[i];
    this.rocks.splice(i, 1);
    if (byPlayer) this.addScore(ROCK_SCORE[r.size]);
    if (r.size < 2) {
      const size = (r.size + 1) as 1 | 2;
      const speed = 1.2 * (1 + Math.min(this.wave, 8) * 0.06);
      for (let k = 0; k < 2; k++) {
        const c = this.addRock(r.x, r.y, size, speed);
        c.vx += r.vx * 0.5;
        c.vy += r.vy * 0.5;
      }
      this.emit({ t: "split", sfx: "brick", x: r.x, y: r.y, size: r.size, shape: r.shape, points: byPlayer ? ROCK_SCORE[r.size] : 0 });
    } else {
      this.emit({ t: "rockgone", sfx: "brickgone", x: r.x, y: r.y, size: r.size, shape: r.shape, points: byPlayer ? ROCK_SCORE[r.size] : 0 });
    }
  }

  private killShip() {
    this.alive = false;
    this.thrusting = false;
    this.lives--;
    this.respawnIn = RESPAWN_DELAY;
    this.respawnWait = 0;
    this.overIn = GAMEOVER_DELAY;
    this.emit({ t: "lost", sfx: "lost", mood: "sad", toast: "lifeLost", shake: 10, x: this.sx, y: this.sy });
  }

  private killDrone(byPlayer: boolean) {
    const d = this.drone!;
    this.drone = null;
    this.droneTimer = 600 + this.rng.int(1200);
    if (byPlayer) this.addScore(DRONE_SCORE);
    this.emit({ t: "explode", sfx: "explode", mood: byPlayer ? "happy" : undefined, shake: 6, x: d.x, y: d.y, points: byPlayer ? DRONE_SCORE : 0 });
  }

  private collide() {
    // Player bullets vs rocks and drone.
    for (let bi = this.bullets.length - 1; bi >= 0; bi--) {
      const bl = this.bullets[bi];
      let hit = false;
      for (let ri = 0; ri < this.rocks.length; ri++) {
        const r = this.rocks[ri];
        const dx = wdx(r.x - bl.x), dy = wdy(r.y - bl.y);
        if (dx * dx + dy * dy < r.r * r.r) {
          this.splitRock(ri, true);
          hit = true;
          break;
        }
      }
      if (!hit && this.drone) {
        const dx = wdx(this.drone.x - bl.x), dy = wdy(this.drone.y - bl.y);
        if (dx * dx + dy * dy < DRONE_R * DRONE_R) {
          this.killDrone(true);
          hit = true;
        }
      }
      if (hit) this.bullets.splice(bi, 1);
    }
    if (!this.alive || this.invuln > 0) return;
    // Ship vs rocks.
    for (let ri = 0; ri < this.rocks.length; ri++) {
      const r = this.rocks[ri];
      const dx = wdx(r.x - this.sx), dy = wdy(r.y - this.sy), m = r.r + SHIP_R - 2;
      if (dx * dx + dy * dy < m * m) {
        this.splitRock(ri, false);
        this.killShip();
        return;
      }
    }
    // Ship vs drone and drone bullets.
    if (this.drone) {
      const dx = wdx(this.drone.x - this.sx), dy = wdy(this.drone.y - this.sy), m = DRONE_R + SHIP_R;
      if (dx * dx + dy * dy < m * m) {
        this.killDrone(false);
        this.killShip();
        return;
      }
    }
    for (let i = 0; i < this.eBullets.length; i++) {
      const bl = this.eBullets[i];
      const dx = wdx(bl.x - this.sx), dy = wdy(bl.y - this.sy);
      if (dx * dx + dy * dy < SHIP_R * SHIP_R) {
        this.eBullets.splice(i, 1);
        this.killShip();
        return;
      }
    }
  }

  view(): RocksView {
    return {
      frame: this.frame,
      ship: { x: this.sx, y: this.sy, vx: this.svx, vy: this.svy, angle: this.ang / ANG_FRAC, thrust: this.thrusting, alive: this.alive, invuln: this.invuln },
      bullets: this.bullets.map((b) => ({ x: b.x, y: b.y, life: b.life })),
      enemyBullets: this.eBullets.map((b) => ({ x: b.x, y: b.y, life: b.life })),
      rocks: this.rocks.map((r) => ({ ...r })),
      drone: this.drone ? { x: this.drone.x, y: this.drone.y, dir: this.drone.vx > 0 ? 1 : -1 } : null,
      score: this.score,
      lives: this.lives,
      wave: this.wave,
      wavePause: this.wavePause,
      pointerAim: this.pointerMode && this.aim ? { ...this.aim } : null,
      over: this.over,
    };
  }
  hud(): Hud {
    return { score: this.score, lives: this.lives, level: this.wave + 1, label: `Wave ${this.wave + 1}` };
  }
  result(): GameResult {
    return { score: this.score, level: this.wave, levelsCleared: this.wavesCleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

export const rocks: GameDef<RocksView> = {
  id: "rocks",
  name: "Rock Blaster",
  tagline: "Blast space rocks into gravel, dodge the bear drone, keep your coin alive.",
  genre: "Space rock shooter",
  session: "2–8 min",
  controls:
    "Keys: LEFT/RIGHT turn, UP thrust, SPACE fire (hold to auto-fire), DOWN or X hyperspace. " +
    "Mouse/touch: tap or click to turn toward that spot and fire; hold far from the ship to fly there; long-press / right-click hyperspace.",
  field: { w: W, h: H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 20 * 60 * 60,
  credits: {
    basedOn: "Doug McInnes' HTML5 canvas rock shooter",
    url: "https://github.com/dmcinnes/HTML5-Asteroids",
    authors: "Doug McInnes (2010)",
    licence: "MIT",
    notes:
      "Ported ship physics (turn rate, thrust, soft speed cap), bullet rules (inherit ship velocity, lifetime, cooldown, pool), rock wrap/split, wave growth, saucer-style enemy timing and movement, respawn rules; re-scaled to 640x480 at 60 fps. " +
      "Changed: 2-way splits, 20/50/100 scoring, friction, hyperspace, invulnerability, extra lives, original bear-drone enemy, pointer aiming. No art, sounds or fonts copied.",
  },
  create: (seed) => new RocksEngine(seed),
  bot(v, frame) {
    // Keyboard-only autoplayer (pointer stays fixed so pointer mode never engages).
    const s = v.ship;
    const out = { x: W / 2, y: H / 2, b: 0 };
    if (!s.alive) return out;
    let best: RockV | null = null;
    let bestD = Infinity;
    let danger = false;
    for (const r of v.rocks) {
      const dx = wdx(r.x - s.x), dy = wdy(r.y - s.y);
      const d = Math.sqrt(dx * dx + dy * dy) - r.r;
      if (d < bestD) { bestD = d; best = r; }
      if (d < 22 && s.invuln === 0) danger = true;
    }
    let tx: number | null = null, ty = 0;
    if (v.drone) {
      const dx = wdx(v.drone.x - s.x), dy = wdy(v.drone.y - s.y);
      if (dx * dx + dy * dy < 200 * 200 || !best) { tx = v.drone.x; ty = v.drone.y; }
    }
    if (tx === null && best) {
      const dx = wdx(best.x - s.x), dy = wdy(best.y - s.y);
      const t = Math.sqrt(dx * dx + dy * dy) / BULLET_SPEED;
      tx = best.x + best.vx * t;
      ty = best.y + best.vy * t;
    }
    if (tx !== null) {
      const target = angle256(wdx(tx - s.x), wdy(ty - s.y));
      const d = angDiff(target, Math.round(s.angle));
      if (d < -1) out.b |= BTN.LEFT;
      else if (d > 1) out.b |= BTN.RIGHT;
      if (Math.abs(d) <= 6) out.b |= BTN.FIRE;
    }
    if (danger && frame % 2 === 0) out.b |= BTN.DOWN;
    else if (bestD < 70 && frame % 40 < 8) out.b |= BTN.UP;
    return out;
  },
};
