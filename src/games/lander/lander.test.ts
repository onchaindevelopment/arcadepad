import { test } from "node:test";
import assert from "node:assert/strict";
import { lander, groundAt, FOOT, START_FUEL, MAX_CRASHES, type LanderView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames = lander.maxFrames) {
  const g = lander.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = lander.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("lander: bot lands, scores and the run ends", () => {
  const { g } = botRun(7);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(r.levelsCleared > 0, "bot should land at least once");
  assert.equal(r.status, "over");
});

test("lander: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(lander, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("lander: terrain has three flat pads x2/x3/x5", () => {
  const v = lander.create(11, { ticker: "TEST" }).view() as LanderView;
  assert.deepEqual(v.pads.map((p) => p.mult).sort(), [2, 3, 5]);
  for (const p of v.pads) for (let i = p.i0; i <= p.i1; i++) assert.equal(v.terrain[i], p.y);
});

test("lander: free fall crashes, three crashes end the run", () => {
  const g = lander.create(3, { ticker: "TEST" });
  let crashes = 0;
  for (let i = 0; i < 20000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) if (e.t === "crash") crashes++;
  }
  assert.equal(crashes, MAX_CRASHES);
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 0);
});

test("lander: thrust burns fuel and pushes the capsule up", () => {
  const g = lander.create(4, { ticker: "TEST" });
  while ((g.view() as LanderView).phase !== "fly") g.step({ x: 0, y: 0, b: 0 });
  for (let i = 0; i < 60; i++) g.step({ x: 0, y: 0, b: 0 });
  const before = g.view() as LanderView;
  for (let i = 0; i < 30; i++) g.step({ x: 0, y: 0, b: BTN.UP });
  const after = g.view() as LanderView;
  assert.equal(after.fuel, START_FUEL - 30);
  assert.ok(after.vy < before.vy, "thrust decelerates the fall");
  assert.ok(groundAt(after.terrain, after.x) > after.y + FOOT);
});
