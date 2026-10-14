import { test } from "node:test";
import assert from "node:assert/strict";
import { crawler, BAG_HP, COLS, ROWS, POINTS, type Seg } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import type { Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = crawler.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = crawler.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

// Test access to engine internals.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
const idle = { x: 180, y: 580, b: 0 };

test("crawler: bot shoots candles and scores", () => {
  const { g } = botRun(7, 20000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("crawler: bot run eventually ends", () => {
  const { g } = botRun(4, crawler.maxFrames);
  assert.ok(g.done, "attract run should end");
});

test("crawler: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000);
    const r = replayGame(crawler, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("crawler: candle drops a row and reverses at the wall and at a bag", () => {
  const g = crawler.create(5, { ticker: "TEST" }) as Any;
  g.bags.fill(0);
  g.ready = 0;
  const s: Seg = { c: COLS - 2, r: 5, pc: COLS - 2, pr: 5, dir: 1, vdir: 1 };
  const bagSeg: Seg = { c: 3, r: 10, pc: 3, pr: 10, dir: 1, vdir: 1 };
  g.bags[10 * COLS + 4] = BAG_HP;
  g.chains = [[s], [bagSeg]];
  g.counter = 0;
  const tick = () => { for (let i = 0; i < g.interval(); i++) g.step(idle); };
  tick();
  assert.deepEqual([s.c, s.r, s.dir], [COLS - 1, 5, 1]);
  assert.deepEqual([bagSeg.c, bagSeg.r, bagSeg.dir], [3, 11, -1], "bag turns it down");
  tick();
  assert.deepEqual([s.c, s.r, s.dir], [COLS - 1, 6, -1], "wall turns it down");
  tick();
  assert.deepEqual([s.c, s.r], [COLS - 2, 6]);
});

test("crawler: shooting a middle candle splits the chain and leaves a bag", () => {
  const g = crawler.create(6, { ticker: "TEST" }) as Any;
  const before = g.chains[0].length;
  const victim: Seg = g.chains[0][3];
  const score0 = g.score;
  g.killSeg(0, 3);
  assert.equal(g.chains[0].length, 3);
  assert.equal(g.chains[1].length, before - 4, "tail becomes its own chain");
  assert.equal(g.bags[victim.pr * COLS + victim.pc], BAG_HP, "bag where it died");
  assert.equal(g.score - score0, POINTS.body);
  g.killSeg(1, 0);
  assert.equal(g.score - score0, POINTS.body + POINTS.head, "head worth more");
});

test("crawler: losing a life restores damaged bags for a bonus", () => {
  const g = crawler.create(8, { ticker: "TEST" }) as Any;
  g.bags.fill(0);
  g.bags[5 * COLS + 5] = 1;
  g.bags[6 * COLS + 7] = 3;
  g.bags[7 * COLS + 9] = BAG_HP;
  g.ready = 0;
  // Put a candle right on the player.
  const c = Math.floor(g.px / 15), r = ROWS - 2;
  g.chains = [[{ c, r, pc: c, pr: r, dir: 1, vdir: 1 }]];
  g.py = r * 15 + 7.5; g.ty = g.py; g.lastPY = g.py;
  g.step({ x: g.lastPX, y: g.lastPY, b: 0 });
  assert.equal(g.lives, 2);
  const score0 = g.score;
  let restored = 0;
  for (let i = 0; i < 100; i++) {
    g.step({ x: g.lastPX, y: g.lastPY, b: 0 });
    for (const e of g.events) if (e.t === "restore") restored = e.bonus;
  }
  assert.equal(restored, 2 * POINTS.restore);
  assert.ok(g.score - score0 >= 2 * POINTS.restore);
  assert.equal(g.bags[5 * COLS + 5], BAG_HP);
  assert.equal(g.bags[6 * COLS + 7], BAG_HP);
});
