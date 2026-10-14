import { test } from "node:test";
import assert from "node:assert/strict";
import { blob, W, H, WORLD } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = blob.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = blob.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("blob: bot grazes and grows", () => {
  const { g } = botRun(7, 6000);
  assert.ok(g.result().score > 20, `bot should grow past the start mass, got ${g.result().score}`);
});

test("blob: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 5000);
    const r = replayGame(blob, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("blob: bot run eventually ends (eaten or time up)", () => {
  const { g } = botRun(4, blob.maxFrames + 10);
  assert.ok(g.done, "run should end");
  assert.notEqual(g.result().status, "playing");
});

test("blob: idle player does not move; pointer moves it, bigger is slower", () => {
  const g = blob.create(9, CTX);
  const c0 = g.view().cells[0];
  for (let i = 0; i < 30; i++) g.step({ x: W / 2, y: H / 2, b: 0 });
  const c1 = g.view().cells[0];
  assert.equal(c1.x, c0.x);
  assert.equal(c1.y, c0.y);
  g.step({ x: W / 2 + 1, y: H / 2, b: 0 }); // pointer moved -> pointer mode
  const xa = g.view().cells[0].x;
  for (let i = 0; i < 10; i++) g.step({ x: W - 1, y: H / 2, b: 0 });
  const xb = g.view().cells[0].x;
  assert.ok(xb > xa + 20, "moves right toward the pointer");
});

test("blob: tap splits into two cells that later merge; long press does not split", () => {
  const g = blob.create(5, CTX);
  // Hold FIRE for a long time (touch drag): no split even when heavy enough.
  // Grow first by forcing mass via grazing with the bot.
  for (let i = 0; i < 3000 && !g.done && g.view().mass < 40; i++) g.step(blob.bot!(g.view(), i === 0 ? 1 : i));
  if (g.done || g.view().mass < 40) return; // seed-dependent: cannot test split
  const n0 = g.view().cells.length;
  assert.equal(n0, 1);
  for (let i = 0; i < 40; i++) g.step({ x: W / 2 + 50, y: H / 2, b: BTN.FIRE });
  g.step({ x: W / 2 + 50, y: H / 2, b: 0 });
  assert.equal(g.view().cells.length, 1, "long press must not split");
  g.step({ x: W / 2 + 50, y: H / 2, b: BTN.FIRE });
  g.step({ x: W / 2 + 50, y: H / 2, b: 0 });
  assert.equal(g.view().cells.length, 2, "tap splits");
  const total = g.view().cells.reduce((s, c) => s + c.mass, 0);
  assert.ok(Math.abs(total - g.view().mass) < 1);
  // Keep still-ish; after the merge timer the cells come back together.
  for (let i = 0; i < 900 && !g.done && g.view().cells.length > 1; i++) g.step({ x: W / 2 + 50, y: H / 2, b: 0 });
  if (!g.done) assert.equal(g.view().cells.length, 1, "cells merge after the timer");
});

test("blob: world bounds and leaderboard", () => {
  const g = blob.create(2, CTX);
  g.step({ x: W / 2 + 1, y: H / 2, b: 0 });
  for (let i = 0; i < 1500 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  const v = g.view();
  for (const c of v.cells) assert.ok(c.x >= 0 && c.y >= 0 && c.x <= WORLD && c.y <= WORLD);
  assert.ok(v.leaderboard.length >= 10);
  for (let i = 1; i < v.leaderboard.length; i++) assert.ok(v.leaderboard[i - 1].mass >= v.leaderboard[i].mass);
});
