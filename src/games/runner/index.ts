/*
 * Candle Run: endless runner, a logic port of the Chromium network-error
 * page runner game (components/neterror/resources/dino_game/: offline.ts,
 * trex.ts, horizon.ts, obstacle.ts, offline_sprite_definitions.ts,
 * distance_meter.ts). Copyright The Chromium Authors, BSD-3-Clause
 * (see /licenses). Ported from commit 644979367abdf38df19730eac6754da5871f867d.
 * Port: ArcadePad, GPL-3.0-or-later.
 *
 * Kept from the original (constants quoted below where they are used):
 * jump physics with hold-for-higher and speed-drop on DOWN, ducking,
 * start speed / acceleration / max speed, obstacle sizes, grouping of up to
 * three, minimum gaps scaled by speed, max two of a kind in a row, flyers
 * only above speed 8.5 at three heights with a +-0.8 speed offset, 3 s of
 * clear road at the start, score = distance * 0.025 with a milestone every
 * 100, and the night inversion every 700 points.
 *
 * Changed / ours: art and hitboxes (coin mascot, candles, rocks, paper
 * planes, all drawn with the kit), a rock obstacle type, a 600x200 field
 * (everything shifted down 40 px from the 600x150 original), a gentle
 * extra ramp past the original max speed, an auto start, fixed 60 Hz steps
 * (the original scaled by wall-clock delta time) and seeded randomness.
 * No sprites, sounds, character or name from the original are used.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---------------------------------------------------------------- field
export const FIELD_W = 600; // original DEFAULT_DIMENSIONS.width = 600
export const FIELD_H = 200; // original height 150; we add 40 px of sky
/** Ground line: feet of the runner and bottom of ground obstacles. Original: 140 (yPos 105 + height 35). */
export const GROUND_Y = 180;
const Y_SHIFT = GROUND_Y - 140;

// ---------------------------------------------------------------- runner (trex.ts)
/** Original defaultTrexConfig.startXPos = 50. */
export const PLAYER_X = 50;
/** Our mascot is a 44x44 coin (original sprite 44x47). */
export const PLAYER_W = 44;
export const PLAYER_H = 44;
/** Ducking box (original heightDuck = 25, widthDuck = 59; our squashed coin is 50x26). */
export const DUCK_W = 50;
export const DUCK_H = 26;
const GROUND_Y_POS = GROUND_Y - PLAYER_H; // top of the standing runner

// normalJumpConfig
const GRAVITY = 0.6; // gravity: 0.6
const INITIAL_JUMP_VELOCITY = -10; // initialJumpVelocity: -10 (startJump subtracts speed / 10)
const MIN_JUMP_HEIGHT = 30; // minJumpHeight: 30 (px above ground before a release can cut the jump)
// maxJumpHeight: 30 is an absolute y in the original (ground top 93), i.e. 63 px of rise.
const MAX_JUMP_Y = GROUND_Y_POS - (93 - 30);
const DROP_VELOCITY = -5; // defaultTrexConfig.dropVelocity: -5
const SPEED_DROP_COEFFICIENT = 3; // speedDropCoefficient: 3

// ---------------------------------------------------------------- speed (offline.ts normalModeConfig)
const START_SPEED = 6; // speed: 6
const ACCELERATION = 0.001; // acceleration: 0.001 per frame
const MAX_SPEED = 13; // maxSpeed: 13
// Ours: after the original cap, keep creeping up so long runs still end.
const LATE_ACCELERATION = 0.0002;
const LATE_MAX_SPEED = 16;
const GAP_COEFFICIENT = 0.6; // gapCoefficient: 0.6
const MAX_GAP_COEFFICIENT = 1.5; // maxGapCoefficient: 1.5
const MAX_OBSTACLE_LENGTH = 3; // maxObstacleLength: 3
const MAX_OBSTACLE_DUPLICATION = 2; // maxObstacleDuplication: 2
const CLEAR_FRAMES = 180; // clearTime: 3000 ms of empty road
const DISTANCE_COEFFICIENT = 0.025; // distance_meter.ts COEFFICIENT: 0.025
const MILESTONE = 100; // ACHIEVEMENT_DISTANCE: 100
const INVERT_DISTANCE = 700; // invertDistance: 700
const INVERT_FRAMES = 720; // invertFadeDuration: 12000 ms
const AUTO_START = 180; // ours: start running on our own after 3 s
const MAX_FRAMES = 15 * 60 * 60; // ours: 15 min hard cap (server replay limit)

// ---------------------------------------------------------------- obstacles
export type ObstacleKind = "candleSmall" | "candleLarge" | "plane" | "rock";

interface Box { x: number; y: number; w: number; h: number }

interface ObstacleType {
  kind: ObstacleKind;
  width: number;
  height: number;
  yPos: number[];
  multipleSpeed: number;
  minGap: number;
  minSpeed: number;
  speedOffset: number;
}

/*
 * Sizes, yPos, multipleSpeed, minGap, minSpeed and speedOffset are the
 * original's (cactusSmall 17x35 @105, cactusLarge 25x50 @90, pterodactyl
 * 46x40 @[100,75,50], minSpeed 8.5, speedOffset .8), shifted by Y_SHIFT.
 * The rock is ours. Hitboxes are ours, fitted to our drawings (see boxesFor).
 */
const TYPES: ObstacleType[] = [
  { kind: "candleSmall", width: 17, height: 35, yPos: [105 + Y_SHIFT], multipleSpeed: 4, minGap: 120, minSpeed: 0, speedOffset: 0 },
  { kind: "candleLarge", width: 25, height: 50, yPos: [90 + Y_SHIFT], multipleSpeed: 7, minGap: 120, minSpeed: 0, speedOffset: 0 },
  { kind: "plane", width: 46, height: 40, yPos: [100 + Y_SHIFT, 75 + Y_SHIFT, 50 + Y_SHIFT], multipleSpeed: 999, minGap: 150, minSpeed: 8.5, speedOffset: 0.8 },
  { kind: "rock", width: 30, height: 22, yPos: [GROUND_Y - 22], multipleSpeed: 999, minGap: 120, minSpeed: 0, speedOffset: 0 },
];

/** Hitboxes relative to the obstacle's top-left, for our art. */
function boxesFor(kind: ObstacleKind, size: number, width: number, height: number): Box[] {
  if (kind === "plane") {
    // Paper plane pointing left: a long thin hull plus the folded wing.
    return [{ x: 2, y: 17, w: 42, h: 7 }, { x: 14, y: 9, w: 24, h: 20 }];
  }
  if (kind === "rock") return [{ x: 3, y: 6, w: width - 6, h: height - 6 }, { x: 8, y: 1, w: width - 16, h: 6 }];
  // Candles: bodies (below the wick) plus one wick per candle.
  const each = width / size;
  const boxes: Box[] = [{ x: 2, y: 7, w: width - 4, h: height - 7 }];
  for (let i = 0; i < size; i++) boxes.push({ x: Math.floor(i * each + each / 2) - 1, y: 0, w: 3, h: 8 });
  return boxes;
}

export interface ObstacleView {
  id: number;
  kind: ObstacleKind;
  x: number;
  y: number;
  w: number;
  h: number;
  size: number;
  /** Candle colour: true = green (up) candle. */
  up: boolean;
}

export interface RunnerView {
  frame: number;
  started: boolean;
  /** Runner box (top-left), already in ducking size when ducking. */
  x: number;
  y: number;
  w: number;
  h: number;
  jumping: boolean;
  ducking: boolean;
  speedDrop: boolean;
  vy: number;
  speed: number;
  /** Raw distance in px, for parallax. */
  distance: number;
  score: number;
  obstacles: ObstacleView[];
  /** 0..1 night strength (inversion every 700 points). */
  night: number;
  dead: boolean;
}

class Obstacle {
  id: number;
  type: ObstacleType;
  size: number;
  width: number;
  x: number;
  y: number;
  gap: number;
  speedOffset = 0;
  followingCreated = false;
  boxes: Box[];
  up: boolean;

  constructor(id: number, type: ObstacleType, speed: number, rng: Rng) {
    this.id = id;
    this.type = type;
    // obstacle.ts: size = getRandomNum(1, maxObstacleLength), 1 unless speed >= multipleSpeed.
    this.size = rng.range(1, MAX_OBSTACLE_LENGTH);
    if (this.size > 1 && type.multipleSpeed > speed) this.size = 1;
    this.width = type.width * this.size;
    // horizon.ts passes obstacleType.width as xOffset: starts just off the right edge.
    this.x = FIELD_W + type.width;
    this.y = type.yPos.length > 1 ? type.yPos[rng.range(0, type.yPos.length - 1)] : type.yPos[0];
    if (type.speedOffset) this.speedOffset = rng.int(2) ? type.speedOffset : -type.speedOffset;
    // obstacle.ts getGap: minGap = round(width * speed + type.minGap * gapCoefficient), max = minGap * 1.5.
    const minGap = Math.round(this.width * speed + type.minGap * GAP_COEFFICIENT);
    const maxGap = Math.round(minGap * MAX_GAP_COEFFICIENT);
    this.gap = rng.range(minGap, maxGap);
    this.boxes = boxesFor(type.kind, this.size, this.width, type.height);
    this.up = (rng.next() & 1) === 1;
  }
}

function overlap(a: Box, b: Box): boolean {
  // offline.ts boxCompare (axis-aligned).
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.h + a.y > b.y;
}

// Our runner hitboxes (a round coin), relative to the runner's top-left.
const RUN_BOXES: Box[] = [
  { x: 11, y: 3, w: 22, h: 39 },
  { x: 4, y: 11, w: 36, h: 23 },
];
const DUCK_BOXES: Box[] = [{ x: 3, y: 4, w: DUCK_W - 6, h: DUCK_H - 4 }];

class RunnerEngine implements GameEngine<RunnerView> {
  private rng: Rng;
  private prevB = 0;
  private started = false;
  private y = GROUND_Y_POS;
  private vy = 0;
  private jumping = false;
  private ducking = false;
  private speedDrop = false;
  private reachedMinHeight = false;
  private speed = START_SPEED;
  private distance = 0;
  private runFrames = 0;
  private obstacles: Obstacle[] = [];
  private history: ObstacleKind[] = [];
  private nextId = 1;
  private score = 0;
  private milestone = 0;
  private nightTimer = 0;
  private nightMark = 0;
  private dead = false;
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.dead) return;
    const b = inp.b;
    const pressed = b & ~this.prevB;
    const released = this.prevB & ~b;
    this.prevB = b;
    const JUMP = BTN.FIRE | BTN.UP;

    if (!this.started) {
      if (pressed & JUMP || this.frame >= AUTO_START) this.started = true;
      else return;
    }

    // ---- input (offline.ts onKeyDown / onKeyUp)
    if (pressed & JUMP && !this.jumping && !this.ducking) this.startJump();
    if (released & JUMP && this.jumping) this.endJump();
    if (b & BTN.DOWN) {
      if (this.jumping) {
        // "Speed drop, activated only when jump key is not pressed."
        if (pressed & BTN.DOWN) this.setSpeedDrop();
      } else this.ducking = true;
    } else {
      this.ducking = false;
      this.speedDrop = false;
    }

    // ---- runner physics
    if (this.jumping) this.updateJump();

    // ---- horizon / obstacles
    this.runFrames++;
    const hasObstacles = this.runFrames > CLEAR_FRAMES;
    if (hasObstacles) this.updateObstacles();

    // ---- collision
    if (hasObstacles && this.checkCollision()) {
      this.dead = true;
      const pb = this.playerBox();
      this.events.push({ t: "hit", sfx: "lost", mood: "sad", shake: 10, x: pb.x + pb.w / 2, y: pb.y + pb.h / 2 });
      this.events.push({ t: "gameover", sfx: "gameover" });
      return;
    }

    // ---- distance and speed (offline.ts update)
    this.distance += this.speed;
    if (this.speed < MAX_SPEED) this.speed += ACCELERATION;
    else if (this.speed < LATE_MAX_SPEED) this.speed += LATE_ACCELERATION;

    // distance_meter.ts getActualDistance(ceil(distanceRan)) = round(d * 0.025)
    this.score = Math.round(Math.ceil(this.distance) * DISTANCE_COEFFICIENT);
    const m = Math.floor(this.score / MILESTONE);
    if (m > this.milestone) {
      this.milestone = m;
      this.events.push({ t: "milestone", sfx: "extraGood", mood: "happy", score: m * MILESTONE, x: PLAYER_X + PLAYER_W / 2, y: this.y - 8 });
    }
    // Night: inverts for 12 s every 700 points.
    if (this.nightTimer > 0) this.nightTimer--;
    const n = Math.floor(this.score / INVERT_DISTANCE);
    if (n > this.nightMark) {
      this.nightMark = n;
      this.nightTimer = INVERT_FRAMES;
      this.events.push({ t: "night" });
    }

    if (this.frame >= MAX_FRAMES) {
      this.dead = true;
      this.events.push({ t: "gameover", sfx: "gameover" });
    }
  }

  // trex.ts startJump: jumpVelocity = initialJumpVelocity - speed / 10
  private startJump() {
    this.ducking = false;
    this.jumping = true;
    this.vy = INITIAL_JUMP_VELOCITY - this.speed / 10;
    this.reachedMinHeight = false;
    this.speedDrop = false;
    this.events.push({ t: "jump", sfx: "launch", x: PLAYER_X + PLAYER_W / 2, y: GROUND_Y });
  }

  // trex.ts endJump: cut the jump to dropVelocity once the minimum height is reached.
  private endJump() {
    if (this.reachedMinHeight && this.vy < DROP_VELOCITY) this.vy = DROP_VELOCITY;
  }

  // trex.ts setSpeedDrop: jumpVelocity = 1, then falls 3x faster.
  private setSpeedDrop() {
    this.speedDrop = true;
    this.vy = 1;
  }

  // trex.ts updateJump with framesElapsed = 1 (fixed 60 Hz).
  private updateJump() {
    if (this.speedDrop) this.y += Math.round(this.vy * SPEED_DROP_COEFFICIENT);
    else this.y += Math.round(this.vy);
    this.vy += GRAVITY;
    if (this.y < GROUND_Y_POS - MIN_JUMP_HEIGHT || this.speedDrop) this.reachedMinHeight = true;
    if (this.y < MAX_JUMP_Y || this.speedDrop) this.endJump();
    if (this.y > GROUND_Y_POS) {
      const hard = this.speedDrop;
      this.y = GROUND_Y_POS;
      this.vy = 0;
      this.jumping = false;
      this.speedDrop = false;
      this.events.push({ t: "land", hard, x: PLAYER_X + PLAYER_W / 2, y: GROUND_Y });
    }
  }

  // horizon.ts updateObstacles / addNewObstacle
  private updateObstacles() {
    for (const o of this.obstacles) {
      // obstacle.ts: xPos -= floor(speed * FPS / 1000 * deltaTime); one 60 Hz frame = floor(speed).
      o.x -= Math.floor(this.speed + o.speedOffset);
    }
    while (this.obstacles.length && this.obstacles[0].x + this.obstacles[0].width <= 0) this.obstacles.shift();
    const last = this.obstacles[this.obstacles.length - 1];
    if (!last) this.addObstacle();
    else if (!last.followingCreated && last.x + last.width + last.gap < FIELD_W) {
      this.addObstacle();
      last.followingCreated = true;
    }
  }

  private addObstacle() {
    // Re-roll (the original recurses) while the type repeats too often or is too fast for now.
    for (let tries = 0; tries < 50; tries++) {
      const type = TYPES[this.rng.range(0, TYPES.length - 1)];
      if (this.duplicate(type.kind) || this.speed < type.minSpeed) continue;
      this.obstacles.push(new Obstacle(this.nextId++, type, this.speed, this.rng));
      this.history.unshift(type.kind);
      if (this.history.length > MAX_OBSTACLE_DUPLICATION) this.history.length = MAX_OBSTACLE_DUPLICATION;
      return;
    }
  }

  // horizon.ts duplicateObstacleCheck
  private duplicate(kind: ObstacleKind): boolean {
    let n = 0;
    for (const k of this.history) n = k === kind ? n + 1 : 0;
    return n >= MAX_OBSTACLE_DUPLICATION;
  }

  private playerBox(): Box {
    return this.ducking
      ? { x: PLAYER_X - (DUCK_W - PLAYER_W) / 2, y: GROUND_Y - DUCK_H, w: DUCK_W, h: DUCK_H }
      : { x: PLAYER_X, y: this.y, w: PLAYER_W, h: PLAYER_H };
  }

  // offline.ts checkForCollision: outer boxes (1 px inset) then detailed boxes.
  private checkCollision(): boolean {
    const p = this.playerBox();
    const outerP = { x: p.x + 1, y: p.y + 1, w: p.w - 2, h: p.h - 2 };
    const pBoxes = this.ducking ? DUCK_BOXES : RUN_BOXES;
    for (const o of this.obstacles) {
      const outerO = { x: o.x + 1, y: o.y + 1, w: o.width - 2, h: o.type.height - 2 };
      if (!overlap(outerP, outerO)) continue;
      for (const a of pBoxes) {
        const pa = { x: a.x + outerP.x, y: a.y + outerP.y, w: a.w, h: a.h };
        for (const c of o.boxes) {
          if (overlap(pa, { x: c.x + outerO.x, y: c.y + outerO.y, w: c.w, h: c.h })) return true;
        }
      }
    }
    return false;
  }

  view(): RunnerView {
    const p = this.playerBox();
    let night = 0;
    if (this.nightTimer > 0) {
      const fade = 60;
      const t = INVERT_FRAMES - this.nightTimer;
      night = Math.min(1, t / fade, this.nightTimer / fade);
    }
    return {
      frame: this.frame,
      started: this.started,
      x: p.x,
      y: p.y,
      w: p.w,
      h: p.h,
      jumping: this.jumping,
      ducking: this.ducking,
      speedDrop: this.speedDrop,
      vy: this.vy,
      speed: this.speed,
      distance: this.distance,
      score: this.score,
      obstacles: this.obstacles.map((o) => ({ id: o.id, kind: o.type.kind, x: o.x, y: o.y, w: o.width, h: o.type.height, size: o.size, up: o.up })),
      night,
      dead: this.dead,
    };
  }
  hud(): Hud {
    return { score: this.score, label: `Speed ${(this.speed / START_SPEED).toFixed(1)}x` };
  }
  result(): GameResult {
    return { score: this.score, level: 0, levelsCleared: 0, frames: this.frame, status: this.dead ? "over" : "playing" };
  }
  get done() {
    return this.dead;
  }
}

export const runner: GameDef<RunnerView> = {
  id: "runner",
  name: "Candle Run",
  tagline: "The chart never sleeps. Hop the candles, duck the paper planes, run forever.",
  genre: "Endless runner",
  session: "1–3 min",
  controls: "Space / Up / tap to jump (hold for higher), Down to duck or drop fast.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: false, swipe: true, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Chromium network-error page runner game",
    url: "https://github.com/chromium/chromium/tree/644979367abdf38df19730eac6754da5871f867d/components/neterror/resources/dino_game",
    authors: "The Chromium Authors",
    licence: "BSD-3-Clause",
    notes:
      "Gameplay logic ported from offline.ts, trex.ts, horizon.ts, obstacle.ts, offline_sprite_definitions.ts and distance_meter.ts: jump physics (velocity -10 minus speed/10, gravity 0.6, hold for higher, speed drop), ducking, speed 6 + 0.001/frame up to 13, obstacle sizes and groups, speed-scaled gaps, flyers above speed 8.5, distance score and night inversion. Hitboxes, a rock obstacle and a late speed ramp are ours. No sprites, sounds, character or name from the original are used; all art is new and drawn from the coin theme.",
  },
  create: (seed) => new RunnerEngine(seed),
  bot(v) {
    // Look at the first obstacle not yet behind the runner.
    const right = PLAYER_X + PLAYER_W;
    const next = v.obstacles.find((o) => o.x + o.w > PLAYER_X - 2);
    if (!v.started) return { x: 0, y: 0, b: BTN.FIRE };
    if (v.jumping) {
      // Hold while rising for a full jump; once past the obstacle, drop fast.
      if (v.speedDrop) return { x: 0, y: 0, b: BTN.DOWN };
      if (next && next.x > right + 40 && next.x - right < v.speed * 22 && v.vy > 0) return { x: 0, y: 0, b: BTN.DOWN };
      return { x: 0, y: 0, b: v.vy < 0 ? BTN.FIRE : 0 };
    }
    if (!next) return { x: 0, y: 0, b: 0 };
    const dx = next.x - right;
    const bottom = next.y + next.h;
    if (next.kind === "plane" && bottom < GROUND_Y - DUCK_H - 6) {
      // High plane runs over us; mid plane: duck under it.
      if (bottom > GROUND_Y - PLAYER_H - 8 && dx < v.speed * 14) return { x: 0, y: 0, b: BTN.DOWN };
      return { x: 0, y: 0, b: 0 };
    }
    // Ground obstacle or low plane: jump with a lead that grows with speed and width.
    const lead = v.speed * 5 + 10 + (next.w > 40 ? 6 : 0);
    if (dx < lead && dx > -4) return { x: 0, y: 0, b: BTN.FIRE };
    return { x: 0, y: 0, b: 0 };
  },
};
