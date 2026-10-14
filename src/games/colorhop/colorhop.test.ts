import { test } from "node:test";
import assert from "node:assert/strict";
import { BALL_X, colorhop, colourAt, findHit, H, TURN, type Group, type Part } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = colorhop.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = colorhop.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("colorhop: bot hops through obstacles and scores", () => {
  const { g } = botRun(7, 8000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("colorhop: bot eventually fails (attract mode ends)", () => {
  for (const seed of [3, 11]) {
    const { g } = botRun(seed, colorhop.maxFrames);
    assert.equal(g.result().status, "over");
  }
});

test("colorhop: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(colorhop, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("colorhop: ring segments rotate with their angle", () => {
  const ring: Part = { k: "ring", cx: 100, cy: 100, size: 80, thick: 16, n: 0, phase: 0, speed: 0 };
  assert.equal(colourAt(ring, 0, 180 - 1, 101), 0); // just below +x axis: first segment
  assert.equal(colourAt(ring, 0, 100, 180), 1); // straight down (a quarter turn on)
  assert.equal(colourAt(ring, 0, 20, 99), 2);
  assert.equal(colourAt(ring, 0, 101, 20), 3);
  assert.equal(colourAt(ring, 0, 100, 100), -1); // hole in the middle
  // Rotate a quarter turn: the segment at the bottom becomes the previous one.
  assert.equal(colourAt(ring, TURN / 4, 100, 181), 0);
  const bar: Part = { k: "bar", cx: 0, cy: 50, size: 90, thick: 18, n: 0, phase: 0, speed: 0 };
  assert.equal(colourAt(bar, 0, 10, 50), 0);
  assert.equal(colourAt(bar, 0, 100, 50), 1);
  assert.equal(colourAt(bar, 16 * 90, 100, 50), 0); // slid one segment right
  assert.equal(colourAt(bar, 0, 100, 70), -1);
});

test("colorhop: matching colour passes, other colours kill", () => {
  const part: Part = { k: "bar", cx: 0, cy: 0, size: 400, thick: 18, n: 0, phase: 0, speed: 0 };
  const g: Group = { id: 0, kind: "bars", top: -9, bottom: 9, parts: [part], coinY: -60, coinTaken: false, orbY: -200, orbColour: 1, orbTaken: false, passed: false };
  assert.equal(BALL_X < 400, true);
  assert.equal(findHit([g], 0, 0, 0), null);
  assert.equal(findHit([g], 0, 0, 2)?.colour, 0);
  assert.equal(findHit([g], 0, 40, 2), null);
});

test("colorhop: idles in ready, auto-starts and falls off the screen with no taps", () => {
  const g = colorhop.create(9, { ticker: "TEST" });
  for (let i = 0; i < 100; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().state, "ready");
  const seen: string[] = [];
  for (let i = 0; i < 2000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) seen.push(e.t);
  }
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 0);
  assert.ok(g.view().y > g.view().camY + H, "fell off the bottom");
  assert.deepEqual(seen.slice(-2), ["hit", "gameover"]);
});

test("colorhop: holding the button only hops once; colour orbs switch colour", () => {
  const g = colorhop.create(4, { ticker: "TEST" });
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  let hops = 0;
  for (let i = 0; i < 30; i++) {
    g.step({ x: 0, y: 0, b: BTN.FIRE });
    hops += g.events.filter((e) => e.t === "hop").length;
  }
  assert.equal(hops, 0);
  // Colour orbs always switch to a different colour.
  const run = colorhop.create(5, { ticker: "TEST" });
  let swapped = false;
  for (let i = 0; i < 8000 && !run.done; i++) {
    const before = run.view().colour;
    run.step(colorhop.bot!(run.view(), i));
    for (const e of run.events) if (e.t === "swap") {
      swapped = true;
      assert.notEqual(run.view().colour, before);
      assert.equal(run.view().colour, e.colour);
    }
  }
  assert.ok(swapped, "bot should reach a colour orb");
});
