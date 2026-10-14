/*
 * Coin Quest: an original side-scrolling platformer (ArcadePad,
 * GPL-3.0-or-later). The coin mascot runs and jumps through eight
 * hand-authored tile levels (levels.ts) that loop with faster enemies and
 * extra foes each lap.
 *
 * Feel: variable jump height (hold jump for a floatier rise, release to cut
 * it short), coyote time, a jump buffer, bounce pads, one-way ledges and
 * moving lifts. Bears and ghosts can be stomped (stomps chain while airborne),
 * spiky rugs can't. Three lives, a checkpoint per level, a level timer whose
 * leftover seconds pay a bonus. Camera follows with lookahead.
 *
 * Input: keyboard LEFT/RIGHT run, UP or FIRE jump. Pointer/touch: while the
 * button/finger is down, the mascot runs toward the pointer when it is more
 * than ~18 px to either side; pressing on or above the mascot is a jump
 * (held = higher). Keys and pointer switch mode automatically.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";
import { LEVELS } from "./levels.ts";

// ---------------------------------------------------------------- constants
export const FIELD_W = 640;
export const FIELD_H = 360;
export const TILE = 20;
export const ROWS = 18;
export const PW = 14; // player hitbox
export const PH = 18;

const MAX_VX = 2.5;
const ACC_GROUND = 0.22;
const FRICTION = 0.3;
const ACC_AIR = 0.15;
const DRAG_AIR = 0.05;
export const JUMP_V = -7.4;
const G_HOLD = 0.3;
const G_FALL = 0.6;
const MAX_FALL = 7.5;
const CUT_V = -3;
const BOUNCE_V = -10.5;
const STOMP_V = -5.5;
export const COYOTE = 6;
export const BUFFER = 7;
const LEVEL_TIME = 150 * 60;
const START_LIVES = 3;
const INVULN = 100;
const DYING = 70;
const CLEAR = 150;
const MAX_FRAMES = 30 * 60 * 60;
const PLAT_W = 60;
const PLAT_H = 8;
const PTR_DEAD = 18; // pointer steering dead zone (px from mascot centre)
const PTR_JUMP = 28; // presses this close to the mascot (or above it) jump

// Tile codes (char codes from the maps).
const T_EMPTY = 46; // .
const T_GROUND = 35; // #
const T_STONE = 88; // X
const T_LEDGE = 61; // =
const T_BLOCK = 66; // B
const T_USED = 85; // U
const T_PAD = 84; // T
const T_SPIKE = 94; // ^
const T_COIN = 111; // o
export const TILES = { EMPTY: T_EMPTY, GROUND: T_GROUND, STONE: T_STONE, LEDGE: T_LEDGE, BLOCK: T_BLOCK, USED: T_USED, PAD: T_PAD, SPIKE: T_SPIKE, COIN: T_COIN };

export function isSolid(t: number): boolean {
  return t === T_GROUND || t === T_STONE || t === T_BLOCK || t === T_USED || t === T_PAD;
}

export type EnemyKind = "bear" | "ghost" | "rug";

export interface Enemy {
  id: number;
  kind: EnemyKind;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  face: number;
  onGround: boolean;
  alive: boolean;
  /** Frames since defeat (stomp); -1 while alive. Fallen enemies get 999. */
  deadT: number;
  active: boolean;
  hopT: number;
}

export interface Platform {
  x: number;
  y: number;
  w: number;
  h: number;
  x0: number;
  y0: number;
  vertical: boolean;
  range: number;
  dir: number;
  dx: number;
  dy: number;
}

export interface Player {
  x: number;
  y: number;
  vx: number;
  vy: number;
  face: number;
  onGround: boolean;
  plat: number;
  jumping: boolean;
  invuln: number;
  coyote: number;
  buffer: number;
  chain: number;
}

export type QuestState = "play" | "dying" | "clear" | "over";

export interface QuestView {
  frame: number;
  state: QuestState;
  /** Levels played so far (0-based), idx into LEVELS = level % LEVELS.length. */
  level: number;
  levelIdx: number;
  lap: number;
  name: string;
  cols: number;
  /** Tile char codes, row-major (cols x ROWS). Valid until the next step. */
  tiles: Uint8Array;
  camX: number;
  player: Player;
  enemies: readonly Enemy[];
  platforms: readonly Platform[];
  checkpoint: { c: number; r: number; active: boolean };
  flag: { c: number; r: number };
  /** Bumped blocks for a little hop animation: frame of the bump. */
  bumps: readonly { c: number; r: number; at: number }[];
  timeLeft: number; // frames
  lives: number;
  score: number;
  coins: number;
  stateT: number; // frames into dying/clear, or into the level while playing
  pointerMode: boolean;
  /** Frames since the player last made forward progress (helps the bot). */
  stuck: number;
}

interface StartOpts {
  startLevel?: number;
  /** Tests only: never lose lives. */
  god?: boolean;
}

class QuestEngine implements GameEngine<QuestView> {
  private rng: Rng;
  private opts: StartOpts;
  frame = 0;
  events: GameEvent[] = [];
  private state: QuestState = "play";
  private stateT = 0;
  private level = 0;
  private levelsCleared = 0;
  private cols = 0;
  private tiles = new Uint8Array(0);
  private enemies: Enemy[] = [];
  private plats: Platform[] = [];
  private bumps: { c: number; r: number; at: number }[] = [];
  private start = { x: 0, y: 0 };
  private cp = { c: 0, r: 0, active: false };
  private flag = { c: 0, r: 0 };
  private pl: Player = { x: 0, y: 0, vx: 0, vy: 0, face: 1, onGround: false, plat: -1, jumping: false, invuln: 0, coyote: 0, buffer: 0, chain: 0 };
  private camX = 0;
  private look = 0;
  private timeLeft = LEVEL_TIME;
  private lives = START_LIVES;
  private score = 0;
  private coins = 0;
  private prevB = 0;
  private px = 0;
  private py = 0;
  private pointerMode = false;
  private ptrJump = false;
  private best = 0;
  private stuck = 0;
  private nextId = 1;

  constructor(seed: number, opts: StartOpts = {}) {
    this.rng = new Rng(seed);
    this.opts = opts;
    this.level = opts.startLevel ?? 0;
    this.load();
  }

  // ------------------------------------------------------------ level setup
  private speedMul(): number {
    return Math.min(1.8, 1 + 0.2 * this.lap());
  }
  private lap(): number {
    return Math.floor(this.level / LEVELS.length);
  }

  private load() {
    const def = LEVELS[this.level % LEVELS.length];
    const cols = def.map[0].length;
    this.cols = cols;
    this.tiles = new Uint8Array(cols * ROWS);
    this.enemies = [];
    this.plats = [];
    this.bumps = [];
    const mul = this.speedMul();
    for (let r = 0; r < ROWS; r++) {
      const row = def.map[r];
      for (let c = 0; c < cols; c++) {
        const ch = c < row.length ? row[c] : ".";
        let code = ch.charCodeAt(0);
        const x = c * TILE;
        const y = r * TILE;
        if (ch === "P") this.start = { x: x + (TILE - PW) / 2, y: y + TILE - PH };
        else if (ch === "C") this.cp = { c, r, active: false };
        else if (ch === "F") this.flag = { c, r };
        else if (ch === "M" || ch === "V") {
          this.plats.push({ x, y, w: PLAT_W, h: PLAT_H, x0: x, y0: y, vertical: ch === "V", range: ch === "V" ? 100 : 80, dir: ch === "V" ? -1 : 1, dx: 0, dy: 0 });
        } else if (ch === "b" || ch === "g" || ch === "r") this.spawnEnemy(ch === "b" ? "bear" : ch === "g" ? "ghost" : "rug", c, r, mul);
        if (ch === "P" || ch === "C" || ch === "F" || ch === "M" || ch === "V" || ch === "b" || ch === "g" || ch === "r") code = T_EMPTY;
        this.tiles[r * cols + c] = code;
      }
    }
    // Later laps: extra foes on open ground, never near start, checkpoint or flag.
    const extra = Math.min(8, this.lap() * 3);
    if (extra > 0) {
      const cands: [number, number][] = [];
      for (let c = 14; c < cols - 12; c++) {
        if (Math.abs(c - this.cp.c) < 5 || Math.abs(c - this.flag.c) < 6) continue;
        for (let r = 1; r < ROWS; r++) {
          const t = this.tiles[r * cols + c];
          if (isSolid(t) || t === T_LEDGE) {
            const above = this.tiles[(r - 1) * cols + c];
            if (above === T_EMPTY || above === T_COIN) cands.push([c, r - 1]);
            break;
          }
          if (t === T_SPIKE) break;
        }
      }
      for (let i = 0; i < extra && cands.length; i++) {
        const k = this.rng.int(cands.length);
        const [c, r] = cands[k];
        cands.splice(k, 1);
        const kind: EnemyKind = this.lap() >= 2 ? (["bear", "ghost", "rug"] as const)[this.rng.int(3)] : this.rng.int(2) ? "ghost" : "bear";
        this.spawnEnemy(kind, c, r, mul);
      }
    }
    this.timeLeft = LEVEL_TIME;
    this.best = 0;
    this.stuck = 0;
    this.respawn();
    this.state = "play";
    this.stateT = 0;
  }

  private spawnEnemy(kind: EnemyKind, c: number, r: number, mul: number) {
    const w = kind === "rug" ? 20 : kind === "bear" ? 18 : 16;
    const h = kind === "rug" ? 10 : kind === "bear" ? 18 : 16;
    this.enemies.push({
      id: this.nextId++, kind, x: c * TILE + (TILE - w) / 2, y: (r + 1) * TILE - h, w, h,
      vx: 0, vy: 0, face: -1, onGround: false, alive: true, deadT: -1, active: false,
      hopT: 30 + (c % 3) * 12 + Math.floor(20 / mul),
    });
  }

  private respawn() {
    const p = this.pl;
    if (this.cp.active) {
      p.x = this.cp.c * TILE + (TILE - PW) / 2;
      p.y = (this.cp.r + 1) * TILE - PH;
    } else {
      p.x = this.start.x;
      p.y = this.start.y;
    }
    p.vx = 0; p.vy = 0; p.face = 1; p.onGround = false; p.plat = -1; p.jumping = false;
    p.coyote = 0; p.buffer = 0; p.chain = 0;
    this.look = 0;
    this.camX = this.clampCam(p.x + PW / 2 - FIELD_W * 0.4);
  }

  private clampCam(x: number) {
    return Math.max(0, Math.min(this.cols * TILE - FIELD_W, x));
  }

  // ------------------------------------------------------------ tiles
  private tileAt(c: number, r: number): number {
    if (c < 0 || c >= this.cols) return T_STONE; // side walls
    if (r < 0 || r >= ROWS) return T_EMPTY;
    return this.tiles[r * this.cols + c];
  }
  private setTile(c: number, r: number, t: number) {
    this.tiles[r * this.cols + c] = t;
  }

  /** Move a box horizontally against solid tiles. Returns true if blocked. */
  private sweepX(b: { x: number; y: number }, w: number, h: number, dx: number): boolean {
    if (dx === 0) return false;
    b.x += dx;
    const r0 = Math.floor(b.y / TILE);
    const r1 = Math.floor((b.y + h - 0.001) / TILE);
    if (dx > 0) {
      const c = Math.floor((b.x + w - 0.001) / TILE);
      for (let r = r0; r <= r1; r++) if (isSolid(this.tileAt(c, r))) { b.x = c * TILE - w; return true; }
    } else {
      const c = Math.floor(b.x / TILE);
      for (let r = r0; r <= r1; r++) if (isSolid(this.tileAt(c, r))) { b.x = (c + 1) * TILE; return true; }
    }
    return false;
  }

  /** Landing test for a box whose bottom moved from prevBottom down to b.y + h. Returns the tile row landed on or -1. */
  private landTiles(b: { x: number; y: number }, w: number, h: number, prevBottom: number): number {
    const bottom = b.y + h;
    const r = Math.floor((bottom - 0.001) / TILE);
    const c0 = Math.floor(b.x / TILE);
    const c1 = Math.floor((b.x + w - 0.001) / TILE);
    for (let c = c0; c <= c1; c++) {
      const t = this.tileAt(c, r);
      if (isSolid(t) || (t === T_LEDGE && prevBottom <= r * TILE + 0.001)) {
        b.y = r * TILE - h;
        return r;
      }
    }
    return -1;
  }

  // ------------------------------------------------------------ step
  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.state === "over") return;
    const b = inp.b;
    const pressed = b & ~this.prevB;
    this.prevB = b;
    const moved = inp.x !== this.px || inp.y !== this.py;
    this.px = inp.x;
    this.py = inp.y;
    if (pressed & (BTN.LEFT | BTN.RIGHT | BTN.UP | BTN.DOWN)) this.pointerMode = false;
    else if (moved && b & BTN.FIRE) this.pointerMode = true; // a press or drag somewhere new; mere hovering never switches

    if (this.frame >= MAX_FRAMES) {
      this.state = "over";
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }
    this.stateT++;

    if (this.state === "dying") {
      this.updatePlatforms();
      if (this.stateT >= DYING) {
        if (this.lives <= 0) {
          this.state = "over";
          this.events.push({ t: "gameover", sfx: "gameover", mood: "sad" });
        } else {
          this.state = "play";
          this.stateT = 0;
          this.timeLeft = LEVEL_TIME;
          this.respawn();
          this.pl.invuln = INVULN;
          this.events.push({ t: "respawn", x: this.pl.x + PW / 2, y: this.pl.y + PH / 2 });
        }
      }
      return;
    }
    if (this.state === "clear") {
      this.updatePlatforms();
      // Walk off toward the right edge for the outro.
      this.pl.vx = 1.2;
      this.pl.face = 1;
      this.sweepX(this.pl, PW, PH, this.pl.vx);
      this.pl.vy = Math.min(this.pl.vy + G_FALL, MAX_FALL);
      const prev = this.pl.y + PH;
      this.pl.y += this.pl.vy;
      if (this.pl.vy > 0 && this.landTiles(this.pl, PW, PH, prev) >= 0) this.pl.vy = 0;
      if (this.stateT >= CLEAR) {
        this.level++;
        this.load();
        this.events.push({ t: "levelstart", name: LEVELS[this.level % LEVELS.length].name });
      }
      return;
    }

    // ---- play
    this.updatePlatforms();
    this.updatePlayer(b, pressed);
    if (this.state !== "play") return;
    this.updateEnemies();
    if (this.state !== "play") return;
    this.updateCamera();

    const p = this.pl;
    if (p.x > this.best + 2) {
      this.best = p.x;
      this.stuck = 0;
    } else this.stuck++;

    if (--this.timeLeft <= 0) {
      this.events.push({ t: "timeout", x: p.x + PW / 2, y: p.y });
      this.die();
      return;
    }
    if (this.timeLeft === 30 * 60) this.events.push({ t: "hurry", sfx: "extraBad" });
  }

  private updatePlatforms() {
    const mul = this.speedMul();
    const sp = 0.7 * mul;
    for (const m of this.plats) {
      const ox = m.x, oy = m.y;
      if (m.vertical) {
        m.y += m.dir * sp;
        if (m.y <= m.y0 - m.range) { m.y = m.y0 - m.range; m.dir = 1; }
        else if (m.y >= m.y0) { m.y = m.y0; m.dir = -1; }
      } else {
        m.x += m.dir * sp;
        if (m.x >= m.x0 + m.range) { m.x = m.x0 + m.range; m.dir = -1; }
        else if (m.x <= m.x0) { m.x = m.x0; m.dir = 1; }
      }
      m.dx = m.x - ox;
      m.dy = m.y - oy;
    }
  }

  private updatePlayer(b: number, pressed: number) {
    const p = this.pl;
    // Carried by a lift.
    if (p.plat >= 0) {
      const m = this.plats[p.plat];
      this.sweepX(p, PW, PH, m.dx);
      p.y += m.dy;
    }

    // ---- input
    let dir = 0;
    let jumpPress = (pressed & BTN.UP) !== 0;
    let jumpHeld = (b & BTN.UP) !== 0;
    if (this.pointerMode) {
      const sx = p.x + PW / 2 - this.camX;
      const fire = (b & BTN.FIRE) !== 0;
      if (pressed & BTN.FIRE) {
        this.ptrJump = this.py < p.y - 6 || Math.abs(this.px - sx) <= PTR_JUMP;
        if (this.ptrJump) jumpPress = true;
      }
      if (fire) {
        const dx = this.px - sx;
        dir = dx > PTR_DEAD ? 1 : dx < -PTR_DEAD ? -1 : 0;
        if (this.ptrJump) jumpHeld = true;
      } else this.ptrJump = false;
    } else {
      if (pressed & BTN.FIRE) jumpPress = true;
      if (b & BTN.FIRE) jumpHeld = true;
    }
    if (b & BTN.RIGHT) dir = 1;
    if (b & BTN.LEFT) dir = b & BTN.RIGHT ? 0 : -1;

    // ---- horizontal
    const target = dir * MAX_VX;
    const acc = p.onGround ? (dir !== 0 ? ACC_GROUND : FRICTION) : dir !== 0 ? ACC_AIR : DRAG_AIR;
    if (p.vx < target) p.vx = Math.min(target, p.vx + acc);
    else if (p.vx > target) p.vx = Math.max(target, p.vx - acc);
    if (dir !== 0) p.face = dir;

    // ---- jump (buffer + coyote)
    if (jumpPress) p.buffer = BUFFER;
    else if (p.buffer > 0) p.buffer--;
    if (p.onGround) p.coyote = COYOTE;
    else if (p.coyote > 0) p.coyote--;
    if (p.buffer > 0 && p.coyote > 0) {
      p.vy = JUMP_V;
      p.jumping = true;
      p.onGround = false;
      p.plat = -1;
      p.buffer = 0;
      p.coyote = 0;
      this.events.push({ t: "jump", sfx: "launch", x: p.x + PW / 2, y: p.y + PH });
    }
    if (p.jumping && !jumpHeld && p.vy < CUT_V) p.vy = CUT_V;
    const g = p.vy < 0 && p.jumping && jumpHeld ? G_HOLD : G_FALL;
    p.vy = Math.min(p.vy + g, MAX_FALL);

    // ---- move
    if (this.sweepX(p, PW, PH, p.vx)) p.vx = 0;
    if (p.x < 0) { p.x = 0; p.vx = 0; }
    const prevBottom = p.y + PH;
    const wasGround = p.onGround;
    const fallV = p.vy;
    p.y += p.vy;
    p.onGround = false;
    p.plat = -1;
    if (p.vy > 0) {
      const r = this.landTiles(p, PW, PH, prevBottom);
      if (r >= 0) {
        p.vy = 0;
        p.onGround = true;
        // Bounce pad under the centre (or any foot)?
        const c0 = Math.floor(p.x / TILE), c1 = Math.floor((p.x + PW - 0.001) / TILE);
        let pad = -1;
        for (let c = c0; c <= c1; c++) if (this.tileAt(c, r) === T_PAD) pad = c;
        if (pad >= 0) {
          p.vy = BOUNCE_V;
          p.jumping = true;
          p.onGround = false;
          p.coyote = 0;
          this.events.push({ t: "bounce", sfx: "extraGood", c: pad, r, x: pad * TILE + TILE / 2, y: r * TILE });
        }
      } else {
        // Lifts (one-way from above).
        for (let i = 0; i < this.plats.length; i++) {
          const m = this.plats[i];
          if (p.x + PW <= m.x || p.x >= m.x + m.w) continue;
          if (p.y + PH >= m.y && prevBottom <= m.y + 1 + Math.max(0, -m.dy)) {
            p.y = m.y - PH;
            p.vy = 0;
            p.onGround = true;
            p.plat = i;
            break;
          }
        }
      }
      if (p.onGround) {
        p.jumping = false;
        p.chain = 0;
        if (!wasGround && fallV > 3) this.events.push({ t: "land", x: p.x + PW / 2, y: p.y + PH, v: fallV });
      }
    } else if (p.vy < 0) {
      const rt = Math.floor(p.y / TILE);
      const c0 = Math.floor(p.x / TILE), c1 = Math.floor((p.x + PW - 0.001) / TILE);
      let hit = -1;
      for (let c = c0; c <= c1; c++) if (isSolid(this.tileAt(c, rt))) { if (hit < 0 || this.tileAt(c, rt) === T_BLOCK) hit = c; }
      if (hit >= 0) {
        // Prefer the block under the mascot's centre.
        const cc = Math.max(c0, Math.min(c1, Math.floor((p.x + PW / 2) / TILE)));
        if (isSolid(this.tileAt(cc, rt)) && (this.tileAt(cc, rt) === T_BLOCK || this.tileAt(hit, rt) !== T_BLOCK)) hit = cc;
        p.y = (rt + 1) * TILE;
        p.vy = 0;
        this.bump(hit, rt);
      }
    }
    if (p.invuln > 0) p.invuln--;

    // ---- pickups and hazards
    const c0 = Math.floor(p.x / TILE), c1 = Math.floor((p.x + PW - 0.001) / TILE);
    const r0 = Math.floor(p.y / TILE), r1 = Math.floor((p.y + PH - 0.001) / TILE);
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const t = this.tileAt(c, r);
        if (t === T_COIN) {
          if (overlap(p.x, p.y, PW, PH, c * TILE + 3, r * TILE + 3, 14, 14)) {
            this.setTile(c, r, T_EMPTY);
            this.score += 50;
            this.coins++;
            this.events.push({ t: "coin", sfx: "brick", x: c * TILE + TILE / 2, y: r * TILE + TILE / 2, pts: 50 });
          }
        } else if (t === T_SPIKE && p.invuln === 0) {
          if (overlap(p.x + 1, p.y, PW - 2, PH, c * TILE + 3, r * TILE + 10, 14, 10)) {
            this.events.push({ t: "spiked", x: p.x + PW / 2, y: p.y + PH });
            this.die();
            return;
          }
        }
      }
    }
    if (p.y > FIELD_H + 24) {
      this.events.push({ t: "fell", x: p.x + PW / 2, y: FIELD_H });
      this.die();
      return;
    }

    // ---- checkpoint & goal
    if (!this.cp.active && p.x + PW / 2 >= this.cp.c * TILE + 4) {
      this.cp.active = true;
      this.score += 100;
      this.events.push({ t: "checkpoint", sfx: "extraGood", mood: "happy", x: this.cp.c * TILE + TILE / 2, y: this.cp.r * TILE, pts: 100 });
    }
    if (p.x + PW >= this.flag.c * TILE + 8) this.clearLevel();
  }

  private bump(c: number, r: number) {
    const t = this.tileAt(c, r);
    this.bumps = this.bumps.filter((q) => this.frame - q.at < 12);
    this.bumps.push({ c, r, at: this.frame });
    if (t === T_BLOCK) {
      this.setTile(c, r, T_USED);
      this.score += 100;
      this.coins++;
      this.events.push({ t: "block", sfx: "brickgone", x: c * TILE + TILE / 2, y: r * TILE, pts: 100 });
      // Knock out foes standing on the block.
      for (const e of this.enemies) {
        if (!e.alive) continue;
        if (Math.abs(e.y + e.h - r * TILE) < 2 && e.x + e.w > c * TILE && e.x < (c + 1) * TILE) this.defeat(e, 200);
      }
    } else this.events.push({ t: "head", sfx: "wall", x: c * TILE + TILE / 2, y: (r + 1) * TILE });
  }

  private updateEnemies() {
    const mul = this.speedMul();
    const p = this.pl;
    const edge = this.camX + FIELD_W + 40;
    for (const e of this.enemies) {
      if (!e.alive) {
        if (e.deadT >= 0 && e.deadT < 999) e.deadT++;
        continue;
      }
      if (!e.active) {
        if (e.x < edge) e.active = true;
        else continue;
      }
      if (e.kind === "ghost") {
        if (e.onGround) {
          e.vx = 0;
          if (--e.hopT <= 0) {
            e.face = p.x + PW / 2 < e.x + e.w / 2 ? -1 : 1;
            e.vy = -6.2;
            e.vx = e.face * 1.1 * mul;
            e.hopT = Math.floor(55 / mul);
            e.onGround = false;
          }
        }
      } else {
        e.vx = e.face * (e.kind === "bear" ? 0.55 : 0.4) * mul;
        if (e.onGround) {
          const fc = e.face > 0 ? Math.floor((e.x + e.w + 1) / TILE) : Math.floor((e.x - 1) / TILE);
          const br = Math.floor((e.y + e.h + 1) / TILE);
          const below = this.tileAt(fc, br);
          if (!isSolid(below) && below !== T_LEDGE) {
            e.face = -e.face;
            e.vx = -e.vx;
          }
        }
      }
      if (this.sweepX(e, e.w, e.h, e.vx)) {
        e.face = -e.face;
        if (e.kind === "ghost") e.vx = -e.vx;
      }
      e.vy = Math.min(e.vy + 0.5, MAX_FALL);
      const prev = e.y + e.h;
      e.y += e.vy;
      e.onGround = false;
      if (e.vy > 0 && this.landTiles(e, e.w, e.h, prev) >= 0) {
        e.vy = 0;
        e.onGround = true;
      } else if (e.vy < 0) {
        const rt = Math.floor(e.y / TILE);
        const c0 = Math.floor(e.x / TILE), c1 = Math.floor((e.x + e.w - 0.001) / TILE);
        for (let c = c0; c <= c1; c++) if (isSolid(this.tileAt(c, rt))) { e.y = (rt + 1) * TILE; e.vy = 0; break; }
      }
      if (e.y > FIELD_H + 40) {
        e.alive = false;
        e.deadT = 999;
        continue;
      }

      // ---- player contact
      if (!overlap(p.x + 1, p.y + 1, PW - 2, PH - 1, e.x + 1, e.y + 1, e.w - 2, e.h - 1)) continue;
      const stompable = e.kind !== "rug";
      const pPrevBottom = p.y + PH - p.vy;
      if (stompable && p.vy > 0 && pPrevBottom <= e.y + 6 + Math.max(0, -e.vy)) {
        this.defeat(e, 200 << Math.min(p.chain, 4));
        p.chain++;
        const held = (this.prevB & (BTN.UP | BTN.FIRE)) !== 0;
        p.y = e.y - PH;
        p.vy = held ? JUMP_V : STOMP_V;
        p.jumping = true;
        p.onGround = false;
        p.plat = -1;
      } else if (p.invuln === 0) {
        this.events.push({ t: "hit", x: p.x + PW / 2, y: p.y + PH / 2, kind: e.kind });
        this.die();
        return;
      }
    }
  }

  private defeat(e: Enemy, pts: number) {
    e.alive = false;
    e.deadT = 0;
    this.score += pts;
    this.events.push({ t: "stomp", sfx: "explode", shake: 3, kind: e.kind, x: e.x + e.w / 2, y: e.y + e.h / 2, pts });
  }

  private updateCamera() {
    const p = this.pl;
    const want = p.face * 70;
    this.look += Math.max(-2, Math.min(2, want - this.look));
    const target = this.clampCam(p.x + PW / 2 - FIELD_W * 0.42 + this.look);
    this.camX += (target - this.camX) * 0.1;
    this.camX = this.clampCam(this.camX);
  }

  private die() {
    if (this.opts.god) {
      this.respawn();
      this.pl.invuln = INVULN;
      return;
    }
    this.lives--;
    this.state = "dying";
    this.stateT = 0;
    const p = this.pl;
    this.events.push({ t: "die", sfx: "lost", mood: "sad", toast: "lifeLost", shake: 8, x: p.x + PW / 2, y: Math.min(p.y + PH / 2, FIELD_H - 10) });
  }

  private clearLevel() {
    const secs = Math.ceil(this.timeLeft / 60);
    const bonus = secs * 10;
    this.score += 1000 + bonus;
    this.levelsCleared++;
    this.state = "clear";
    this.stateT = 0;
    this.events.push({ t: "clear", sfx: "levelclear", mood: "happy", toast: "levelClear", x: this.flag.c * TILE + TILE / 2, y: this.flag.r * TILE, bonus, secs });
  }

  // ------------------------------------------------------------ outputs
  view(): QuestView {
    return {
      frame: this.frame,
      state: this.state,
      level: this.level,
      levelIdx: this.level % LEVELS.length,
      lap: this.lap(),
      name: LEVELS[this.level % LEVELS.length].name,
      cols: this.cols,
      tiles: this.tiles,
      camX: this.camX,
      player: this.pl,
      enemies: this.enemies,
      platforms: this.plats,
      checkpoint: this.cp,
      flag: this.flag,
      bumps: this.bumps,
      timeLeft: this.timeLeft,
      lives: this.lives,
      score: this.score,
      coins: this.coins,
      stateT: this.stateT,
      pointerMode: this.pointerMode,
      stuck: this.stuck,
    };
  }
  hud(): Hud {
    return { score: this.score, lives: Math.max(0, this.lives), level: this.level + 1, label: `${LEVELS[this.level % LEVELS.length].name} · ${Math.ceil(this.timeLeft / 60)}s` };
  }
  result(): GameResult {
    return { score: this.score, level: this.level, levelsCleared: this.levelsCleared, frames: this.frame, status: this.state === "over" ? "over" : "playing" };
  }
  get done() {
    return this.state === "over";
  }
}

function overlap(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

/** Tests: start on any level, optionally without losing lives. */
export function createQuest(seed: number, opts: StartOpts = {}): GameEngine<QuestView> {
  return new QuestEngine(seed, opts);
}

// ---------------------------------------------------------------- bot
function standable(v: QuestView, c: number, r: number): boolean {
  if (c < 0 || c >= v.cols || r < 0 || r >= ROWS) return false;
  const t = v.tiles[r * v.cols + c];
  return isSolid(t) || t === T_LEDGE;
}
function tileV(v: QuestView, c: number, r: number): number {
  if (c < 0 || c >= v.cols) return T_STONE;
  if (r < 0 || r >= ROWS) return T_EMPTY;
  return v.tiles[r * v.cols + c];
}

/** Decent but imperfect: runs right, jumps at walls, gaps, spikes and foes, waits for lifts. */
export function questBot(v: QuestView, frame: number): Input {
  const none = { x: 0, y: 0, b: 0 };
  if (v.state !== "play") return none;
  const p = v.player;
  const R = BTN.RIGHT, J = BTN.UP;
  if (!p.onGround) {
    // Hopping onto a bounce pad: let go once the feet clear its top, stop over it.
    if (p.vy > -7.45) {
      const cc = Math.floor((p.x + PW / 2) / TILE);
      const fr = Math.floor((p.y + PH) / TILE);
      for (let c = cc - 1; c <= cc + 2; c++) {
        for (let rr = fr; rr <= fr + 2; rr++) {
          if (tileV(v, c, rr) !== T_PAD) continue;
          const top = rr * TILE;
          const gap = top - (p.y + PH);
          if (gap >= 1 && gap < 26) return { x: 0, y: 0, b: p.x + PW / 2 < c * TILE + 14 ? R : 0 };
        }
      }
    }
    // Hold jump while rising; release early now and then (imperfect).
    const hold = p.vy < 0 && frame % 700 > 4;
    return { x: 0, y: 0, b: R | (hold ? J : 0) };
  }
  const front = p.x + PW;
  const feet = p.y + PH;
  const r = Math.floor((feet - 1) / TILE); // row the body bottom is in
  const nc = Math.floor((front + 4) / TILE);
  const nc2 = Math.floor((front + 16) / TILE);
  let jump = false;
  let stop = false;

  // Walls (1-4 tiles high) in front.
  if (isSolid(tileV(v, nc, r)) || isSolid(tileV(v, nc, r - 1))) jump = true;
  // Spikes ahead.
  if (tileV(v, nc, r) === T_SPIKE || tileV(v, nc2, r) === T_SPIKE) jump = true;
  // Foes ahead.
  for (const e of v.enemies) {
    if (!e.alive || !e.active) continue;
    const dx = e.x - front;
    const reach = e.kind === "rug" ? 40 : 34;
    if (dx > -6 && dx < reach && Math.abs(e.y + e.h - feet) < 34) jump = true;
  }
  // Gaps.
  const groundAhead = (c: number) => standable(v, c, r + 1) || standable(v, c, r + 2) || standable(v, c, r + 3);
  if (p.plat >= 0) {
    // Riding a lift: jump once ground or another lift is close ahead.
    const m = v.platforms[p.plat];
    let target = false;
    for (let k = 1; k <= 4 && !target; k++) {
      const c = Math.floor((front + k * TILE - 10) / TILE);
      for (let rr = r - 2; rr <= r + 2; rr++) if (standable(v, c, rr) && !standable(v, c, rr - 1)) target = true;
    }
    for (const o of v.platforms) {
      if (o === m) continue;
      if (o.x > m.x + m.w - 4 && o.x - (m.x + m.w) < 40 && Math.abs(o.y - m.y) < 50) target = true;
    }
    if (target) jump = true;
    else stop = front + 6 > m.x + m.w;
  } else if (!groundAhead(nc)) {
    // Is it a wide pit with a lift to wait for?
    let far = false;
    for (let k = 1; k <= 5; k++) if (groundAhead(nc + k)) far = true;
    if (far) jump = true;
    else {
      let lift = false;
      for (const m of v.platforms) {
        if (m.x - front < 280 && m.x + m.w > front - 10 && m.y > feet - 110 && m.y < feet + 60) {
          lift = true;
          if (m.x <= front + 36 && m.x + m.w >= front + 14 && m.y > feet - 70) jump = true;
        }
      }
      if (!lift) jump = true;
      else if (!jump) stop = true;
    }
  }
  if (v.stuck > 120 && (frame & 31) === 0) jump = true;
  // Need a fresh press: only press on frames where we weren't holding.
  return { x: 0, y: 0, b: (stop ? 0 : R) | (jump ? J : 0) };
}

export const quest: GameDef<QuestView> = {
  id: "quest",
  name: "Coin Quest",
  tagline: "Run, hop and stomp through eight sunny stages. Bump blocks, grab coins, beat the clock.",
  genre: "Side-scrolling platformer",
  session: "3–15 min",
  controls:
    "Left/Right or A/D to run, Up / W / Space to jump (hold for higher). Touch or mouse: hold to the left or right of the mascot to run that way; press on or above it to jump (hold for higher, drag sideways to steer). Stomp bears and ghosts, never the spiky rugs.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original platformer engine, enemies and eight hand-authored levels. No code, art, sounds, characters or level layouts from any other game.",
  },
  create: (seed) => new QuestEngine(seed),
  bot: questBot,
};
