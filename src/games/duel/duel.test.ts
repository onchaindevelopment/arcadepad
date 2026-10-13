import { test } from "node:test";
import assert from "node:assert/strict";
import { DuelEngine, duel, H, PLAYER_Y, W } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import type { Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
const IDLE: Input = { x: W / 2, y: 0, b: 0 };

function botRun(seed: number, frames: number) {
  const g = duel.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = duel.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

function playing(seed = 1) {
  const g = new DuelEngine(seed);
  g.s.phase = "play";
  g.s.coinTimer = 1e9;
  return g;
}

test("duel: bot scores", () => {
  const { g } = botRun(7, 20000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("duel: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 12000);
    const r = replayGame(duel, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("duel: ball reflects off side walls", () => {
  const g = playing();
  g.s.balls = [{ x: 12, y: H / 2, vx: -5, vy: -1, speed: Math.sqrt(26), owner: "player" }];
  let wall = false;
  for (let i = 0; i < 3; i++) {
    g.step(IDLE);
    wall ||= g.events.some((e) => e.t === "wall" && e.sfx === "wall");
  }
  assert.ok(wall, "wall event");
  assert.ok(g.s.balls[0].vx > 0, "vx flipped");
  g.s.balls = [{ x: W - 12, y: H / 2, vx: 5, vy: -1, speed: Math.sqrt(26), owner: "player" }];
  for (let i = 0; i < 3; i++) g.step(IDLE);
  assert.ok(g.s.balls[0].vx < 0, "vx flipped on right wall");
});

test("duel: a missed ball gives the Bear a point", () => {
  const g = playing();
  // Player paddle sits in the centre; ball drops past it on the far left.
  g.s.balls = [{ x: 20, y: PLAYER_Y + 20, vx: 0, vy: 6, speed: 6, owner: "cpu" }];
  let ev = false;
  for (let i = 0; i < 20 && g.s.bear === 0; i++) {
    g.step(IDLE);
    ev ||= g.events.some((e) => e.t === "point" && e.sfx === "extraBad" && e.mood === "sad");
  }
  assert.equal(g.s.bear, 1);
  assert.equal(g.s.you, 0);
  assert.ok(ev);
  assert.equal(g.hud().label, "You 0 – 1 Bear");
});

test("duel: 5 points wins the match and climbs a level; 5 for the Bear ends the run", () => {
  const g = playing();
  g.s.you = 4;
  g.s.balls = [{ x: W - 12, y: 4, vx: 0, vy: -6, speed: 6, owner: "player" }];
  let clear = false;
  for (let i = 0; i < 5; i++) {
    g.step(IDLE);
    clear ||= g.events.some((e) => e.t === "levelclear" && e.toast === "levelClear");
  }
  assert.ok(clear);
  assert.equal(g.s.level, 2);
  assert.equal(g.s.you, 0);
  assert.equal(g.s.score, 1100);
  assert.equal(g.result().levelsCleared, 1);

  const h = playing();
  h.s.bear = 4;
  h.s.balls = [{ x: 20, y: H - 2, vx: 0, vy: 6, speed: 6, owner: "cpu" }];
  const seen: string[] = [];
  for (let i = 0; i < 5 && !h.done; i++) {
    h.step(IDLE);
    seen.push(...h.events.map((e) => e.t));
  }
  assert.ok(h.done);
  assert.deepEqual(seen.slice(-2), ["lost", "gameover"]);
  assert.equal(h.result().status, "over");
});
