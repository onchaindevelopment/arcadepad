import { test } from "node:test";
import assert from "node:assert/strict";
import { flap, GROUND_Y } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = flap.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = flap.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("flap: bot passes candles and scores", () => {
  const { g } = botRun(7, flap.maxFrames);
  assert.ok(g.result().score > 0, "bot should score");
});

test("flap: bot eventually fails (attract mode ends)", () => {
  const { g } = botRun(3, flap.maxFrames);
  assert.equal(g.result().status, "over");
});

test("flap: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(flap, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("flap: waits in get-ready, auto-starts after 3 s, never flapping hits the ground", () => {
  const g = flap.create(9, { ticker: "TEST" });
  for (let i = 0; i < 170; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().state, "ready");
  const events: string[] = [];
  for (let i = 0; i < 2000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) events.push(e.t);
  }
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 0);
  assert.ok(g.view().y >= GROUND_Y - 20, "died on the ground");
  assert.deepEqual(events.slice(-2), ["hit", "gameover"]);
});

test("flap: holding the button flaps only once (press edges)", () => {
  const g = flap.create(4, { ticker: "TEST" });
  let flaps = 0;
  for (let i = 0; i < 60; i++) {
    g.step({ x: 0, y: 0, b: BTN.FIRE });
    flaps += g.events.filter((e) => e.t === "flap").length;
  }
  assert.equal(flaps, 1);
});
