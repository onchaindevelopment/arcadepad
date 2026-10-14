import { test } from "node:test";
import assert from "node:assert/strict";
import { swarm, POINTER_OFFSET, SHIP_START_X, SHIP_START_Y, START_BOMBS, START_LIVES, W } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = swarm.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  let sawBoss = false;
  let maxMult = 1;
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = swarm.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    const v = g.view();
    if (v.boss) sawBoss = true;
    if (v.mult > maxMult) maxMult = v.mult;
  }
  return { g, inputs, sawBoss, maxMult };
}

test("swarm: bot shoots drones and scores", () => {
  const { g } = botRun(7, 9000);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(r.levelsCleared >= 1, "bot should clear a wave");
});

test("swarm: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 7000);
    const r = replayGame(swarm, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("swarm: ship flies above the pointer at capped speed; arrows override", () => {
  const g = swarm.create(4, { ticker: "TEST" });
  g.step({ x: 0, y: 0, b: 0 }); // first pointer sample is only a reference
  assert.equal(g.view().ship.x, SHIP_START_X);
  assert.equal(g.view().ship.y, SHIP_START_Y);
  g.step({ x: 100, y: 500, b: 0 });
  const v1 = g.view().ship;
  assert.ok(v1.x < SHIP_START_X && v1.x > SHIP_START_X - 9, "capped speed");
  for (let i = 0; i < 40; i++) g.step({ x: 100, y: 500, b: 0 });
  assert.equal(g.view().ship.x, 100);
  assert.equal(g.view().ship.y, 500 - POINTER_OFFSET);
  g.step({ x: 100, y: 500, b: BTN.RIGHT });
  assert.equal(g.view().ship.x, 105);
  g.step({ x: 100, y: 500, b: 0 }); // pointer unchanged: stay put
  assert.equal(g.view().ship.x, 105);
});

test("swarm: smart bomb clears enemy bullets and uses one bomb per press", () => {
  const g = swarm.create(8, { ticker: "TEST" });
  // Dodge nothing, just wait until something is shooting.
  let i = 0;
  for (; i < 3000 && g.view().ebullets.length < 3; i++) g.step({ x: W - 20, y: 300, b: 0 });
  assert.ok(g.view().ebullets.length >= 3, "enemies should shoot");
  const before = g.view().bombs;
  assert.ok(before >= START_BOMBS);
  g.step({ x: W - 20, y: 300, b: BTN.ALT });
  assert.equal(g.view().bombs, before - 1);
  assert.ok(g.events.some((e) => e.t === "bomb" && e.sfx === "explode"));
  assert.equal(g.view().ebullets.length, 0);
  g.step({ x: W - 20, y: 300, b: BTN.ALT }); // held, not a new press
  assert.equal(g.view().bombs, before - 1);
});

test("swarm: chain kills raise the multiplier, the boss shows up on wave 4", () => {
  const { sawBoss, maxMult } = botRun(11, 14000);
  assert.ok(maxMult >= 2, `multiplier should climb (got ${maxMult})`);
  assert.ok(sawBoss, "boss should appear");
});

test("swarm: an idle ship loses all lives and the run ends", () => {
  const g = swarm.create(5, { ticker: "TEST" });
  let hits = 0;
  for (let i = 0; i < 60000 && !g.done; i++) {
    g.step({ x: W / 2, y: 0, b: 0 });
    if (g.events.some((e) => e.t === "hit")) hits++;
  }
  assert.ok(g.done);
  assert.equal(g.result().status, "over");
  assert.equal(hits, START_LIVES);
});
