import { test } from "node:test";
import assert from "node:assert/strict";
import { pins, buildStage, angDist, isBoss, neededFor, SEP, BOTTOM, wrapA, PAT_BOSS_LURCH, PAT_BOSS_SWING, type PinsView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { Rng } from "../core/rng.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = pins.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = pins.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("pins: bot sticks pins and scores", () => {
  let best = 0;
  for (const seed of [7, 8, 9]) best = Math.max(best, botRun(seed, 20000).g.result().score);
  assert.ok(best > 0, "bot should score");
});

test("pins: bot runs end (attract mode)", () => {
  let ended = 0;
  const cleared: number[] = [];
  for (const seed of [11, 12, 13, 14]) {
    const { g } = botRun(seed, pins.maxFrames);
    if (g.done) ended++;
    cleared.push(g.result().levelsCleared);
  }
  assert.ok(ended > 0);
  assert.ok(cleared.some((c) => c > 0), `bot should clear some stages: ${cleared}`);
});

test("pins: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(pins, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("pins: stages keep pins apart, every 5th is a boss", () => {
  for (let s = 1; s <= 30; s++) {
    for (let st = 0; st < 12; st++) {
      const setup = buildStage(new Rng(s * 100 + st), st);
      for (let i = 0; i < setup.pins.length; i++)
        for (let j = i + 1; j < setup.pins.length; j++) assert.ok(angDist(setup.pins[i].a, setup.pins[j].a) >= SEP * 2);
      if (st === 0) assert.equal(setup.pins.length, 0);
      if (isBoss(st)) assert.ok(setup.pattern === PAT_BOSS_LURCH || setup.pattern === PAT_BOSS_SWING);
    }
  }
  assert.ok(isBoss(4) && isBoss(9) && !isBoss(5));
  assert.ok(neededFor(4) > neededFor(3));
});

test("pins: one pin sticks for +1; throwing into the same spot ends the run", () => {
  const g = pins.create(3, { ticker: "TEST" });
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  for (let i = 0; i < 40; i++) g.step({ x: 0, y: 0, b: 0 });
  const v = g.view() as PinsView;
  assert.equal(v.pins.length, 1);
  assert.ok(g.result().score >= 1);
  // Wait until that pin comes round to the bottom again just as the next pin arrives, then throw.
  let guard = 0;
  while (!g.done && guard++ < 5000) {
    const w = g.view() as PinsView;
    const fut = wrapA(BOTTOM - (w.rot + w.vel * 15));
    const throwNow = w.flyY < 0 && angDist(fut, v.pins[0].a) < 200;
    g.step({ x: 0, y: 0, b: throwNow ? BTN.FIRE : 0 });
    if (throwNow) {
      for (let i = 0; i < 20 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
      break;
    }
  }
  assert.equal(g.result().status, "over");
});

test("pins: holding fire throws only one pin", () => {
  const g = pins.create(5, { ticker: "TEST" });
  for (let i = 0; i < 120; i++) g.step({ x: 0, y: 0, b: BTN.FIRE });
  assert.equal((g.view() as PinsView).throws, 1);
});
