import { test } from "node:test";
import assert from "node:assert/strict";
import { snake } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import type { Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = snake.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = snake.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("snake: bot eats and scores", () => {
  const { g } = botRun(7, 6000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("snake: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 4000);
    const r = replayGame(snake, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("snake: reversing into yourself is ignored, walls kill", () => {
  const g = snake.create(5, { ticker: "TEST" });
  // Press LEFT (opposite of the start direction) then idle: worm keeps going right into the wall.
  g.step({ x: 0, y: 0, b: 8 });
  for (let i = 0; i < 2000 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.result().status, "over");
});
