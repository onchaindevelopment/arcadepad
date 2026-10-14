import { test } from "node:test";
import assert from "node:assert/strict";
import { H, MALLET_R, MID, PUCK_R, PuckEngine, W, puck } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import type { Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = puck.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = puck.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

function playing(seed = 1) {
  const g = new PuckEngine(seed);
  g.step({ x: W / 2, y: H - 80, b: 0 });
  g.s.phase = "play";
  g.s.timer = 0;
  return g;
}

test("puck: bot scores goals", () => {
  const { g } = botRun(7, 30000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("puck: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 15000);
    const r = replayGame(puck, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("puck: puck in the top goal scores 100 for the player", () => {
  const g = playing();
  g.s.cpu.x = 40; // out of the way
  g.s.puck = { x: W / 2, y: 60, vx: 0, vy: -10 };
  let goal = false;
  for (let i = 0; i < 30 && !goal; i++) {
    g.step({ x: W / 2, y: H - 80, b: 0 });
    goal = g.events.some((e) => e.t === "goal" && e.side === "player");
  }
  assert.ok(goal);
  assert.equal(g.s.score, 100);
  assert.equal(g.s.you, 1);
});

test("puck: rail outside the goal mouth bounces", () => {
  const g = playing();
  g.s.puck = { x: 30, y: 300, vx: 0, vy: 8 };
  for (let i = 0; i < 60; i++) g.step({ x: W - 30, y: H - 30, b: 0 });
  assert.equal(g.s.bear, 0);
  assert.ok(g.s.puck.y < H, "puck stays on the table");
});

test("puck: moving mallet transfers velocity to the puck", () => {
  const g = playing();
  g.s.cpu.x = 40;
  g.s.puck = { x: W / 2, y: MID + 60, vx: 0, vy: 0 };
  g.s.player = { x: W / 2, y: MID + 60 + PUCK_R + MALLET_R + 30, vx: 0, vy: 0 };
  g.step({ x: W / 2 + 1, y: MID + 60 + PUCK_R + MALLET_R + 30, b: 0 });
  for (let i = 0; i < 4; i++) g.step({ x: W / 2, y: MID, b: 0 });
  assert.ok(g.s.puck.vy < -8, `puck should fly up fast, vy=${g.s.puck.vy}`);
});

test("puck: mallet stays in its own half", () => {
  const g = playing();
  for (let i = 0; i < 60; i++) g.step({ x: 0, y: 0, b: i === 0 ? 0 : 0 });
  for (let i = 0; i < 60; i++) g.step({ x: W, y: 10 + (i & 1), b: 0 });
  assert.ok(g.s.player.y >= MID + MALLET_R);
  assert.ok(g.s.player.x <= W - MALLET_R);
});

test("puck: 7 bear goals end the run, 7 player goals climb a level", () => {
  const g = playing();
  g.s.you = 6;
  g.s.cpu.x = 40;
  g.s.puck = { x: W / 2, y: 40, vx: 0, vy: -10 };
  for (let i = 0; i < 20; i++) g.step({ x: W / 2, y: H - 80, b: 0 });
  assert.equal(g.s.level, 2);
  assert.equal(g.s.score, 1100);
  const h = playing();
  h.s.bear = 6;
  h.s.player.x = 40;
  h.s.puck = { x: W / 2, y: H - 40, vx: 0, vy: 10 };
  for (let i = 0; i < 20 && !h.done; i++) h.step({ x: 40, y: H - 80, b: 0 });
  assert.equal(h.result().status, "over");
});
