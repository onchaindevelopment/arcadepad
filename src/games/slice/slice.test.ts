import { test } from "node:test";
import assert from "node:assert/strict";
import { slice, SliceEngine, segHitsCircle, H, LIVES } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = slice.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = slice.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("slice: bot slices and scores", () => {
  const { g } = botRun(7, 6000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("slice: bot runs end before the frame cap", () => {
  for (const seed of [11, 12]) {
    const { g } = botRun(seed, slice.maxFrames);
    assert.equal(g.result().status, "over");
  }
});

test("slice: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000);
    const r = replayGame(slice, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("slice: segment-circle intersection", () => {
  assert.ok(segHitsCircle(0, 0, 100, 0, 50, 10, 12));
  assert.ok(!segHitsCircle(0, 0, 100, 0, 50, 20, 12));
  assert.ok(!segHitsCircle(0, 0, 30, 0, 50, 0, 12)); // stops short
  assert.ok(segHitsCircle(0, 0, 40, 0, 50, 0, 12)); // reaches the rim
});

test("slice: a blade crossing a coin slices it", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  g.inject("coin", 300, 200);
  g.step({ x: 250, y: 200, b: BTN.FIRE });
  assert.equal(g.view().objects.length, 1, "first FIRE frame has no blade segment yet");
  g.step({ x: 350, y: 200, b: BTN.FIRE });
  assert.ok(g.events.some((e) => e.t === "slice" && e.sfx === "brickgone"));
  assert.equal(g.view().objects.length, 0);
  assert.ok(g.result().score > 0);
});

test("slice: moving without the button does not cut", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  g.inject("coin", 300, 200);
  g.step({ x: 250, y: 200, b: 0 });
  g.step({ x: 350, y: 200, b: 0 });
  assert.equal(g.view().objects.length, 1);
});

test("slice: three in one stroke is a combo", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  g.inject("coin", 200, 200);
  g.inject("candle", 300, 200);
  g.inject("gem", 400, 200);
  g.step({ x: 150, y: 200, b: BTN.FIRE });
  g.step({ x: 450, y: 200, b: BTN.FIRE });
  const before = g.result().score;
  g.step({ x: 450, y: 200, b: 0 });
  assert.ok(g.events.some((e) => e.t === "combo" && e.n === 3 && e.sfx === "extraGood" && e.mood === "happy"));
  assert.ok(g.result().score > before);
});

test("slice: crossing a rug bomb ends the game", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  g.inject("bomb", 300, 200);
  g.step({ x: 250, y: 200, b: BTN.FIRE });
  g.step({ x: 350, y: 200, b: BTN.FIRE });
  assert.ok(g.events.some((e) => e.t === "bomb" && e.sfx === "explode"));
  assert.ok(g.events.some((e) => e.t === "gameover"));
  assert.equal(g.result().status, "over");
  assert.ok(g.done);
});

test("slice: arrows move the blade, FIRE cuts (keyboard)", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  g.step({ x: 0, y: 0, b: 0 }); // cursor jumps to pointer (0,0)
  g.inject("coin", 30, 0);
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  for (let i = 0; i < 8 && g.view().objects.length; i++) g.step({ x: 0, y: 0, b: BTN.FIRE | BTN.RIGHT });
  assert.ok(g.result().score > 0);
});

test("slice: letting a coin fall costs a life; bombs falling are free", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  g.inject("bomb", 100, H - 20, 0, 2);
  for (let i = 0; i < 60; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().lives, LIVES);
  g.inject("coin", 300, H - 20, 0, 2);
  let missed = false;
  for (let i = 0; i < 60; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    if (g.events.some((e) => e.t === "miss" && e.sfx === "extraBad" && e.mood === "sad")) missed = true;
  }
  assert.ok(missed);
  assert.equal(g.view().lives, LIVES - 1);
  assert.equal(g.view().objects.length, 0);
});

test("slice: three misses end the game", () => {
  const g = new SliceEngine(1, { noSpawn: true });
  for (let k = 0; k < LIVES; k++) g.inject("coin", 100 + k * 100, H - 10, 0, 3);
  for (let i = 0; i < 60 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.result().status, "over");
});
