import { test } from "node:test";
import assert from "node:assert/strict";
import { chain, createChain, TRACKS, trackPos, aimFromPointer, aimDir, D, LX, LY, W, H } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import type { Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = chain.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = chain.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("chain: bot pops and scores", () => {
  const { g } = botRun(7, 8000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("chain: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(chain, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("chain: idle run ends when the chain reaches the pit", () => {
  const g = chain.create(4, { ticker: "TEST" });
  for (let i = 0; i < chain.maxFrames && !g.done; i++) g.step({ x: LX, y: LY, b: 0 });
  assert.equal(g.result().status, "over");
});

test("chain: tracks are inside the field and long enough", () => {
  for (const tr of TRACKS) {
    assert.ok(tr.len > 1200, `${tr.name} length ${tr.len}`);
    const end = trackPos(tr, tr.len);
    assert.ok(end.x > 0 && end.x < W && end.y > 0 && end.y < H);
    // Track keeps clear of the turret.
    for (let s = 0; s <= tr.len; s += 5) {
      const p = trackPos(tr, s);
      assert.ok((p.x - LX) ** 2 + (p.y - LY) ** 2 > 70 * 70, `${tr.name} too close to the turret at s=${s}`);
    }
  }
});

test("chain: three of a colour pop", () => {
  const g = createChain(1);
  g.setChain([0, 1, 1, 2, 3], 400);
  assert.equal(g.insertSettled(2, 1), true); // 1,1 + 1 -> pop
  assert.deepEqual(g.rawCoins.map((c) => c.col), [0, 2, 3]);
  assert.equal(g.insertSettled(0, 3), false); // 0,3,2,3: no run of 3
});

test("chain: a gap with matching ends pulls back and chain-pops", () => {
  const g = createChain(2);
  // Front part [2,2] then a gap, then [2,0,...]: matching ends retract and pop as one run of 3.
  g.setChain([2, 2, 2, 0, 1, 0], 500, 1, 60);
  const before = g.result().score;
  let popped = false;
  for (let i = 0; i < 60 && !popped; i++) {
    g.step({ x: LX, y: LY, b: 0 });
    popped = g.events.some((e) => e.t === "pop" && e.chain === true);
  }
  assert.ok(popped, "joined gap should pop");
  assert.ok(g.result().score > before);
  assert.deepEqual(g.rawCoins.map((c) => c.col), [0, 1, 0]);
});

test("chain: pointer aim round-trips", () => {
  for (const a of [0, 100, 256, 400, 512, 700, 768, 900]) {
    const d = aimDir(a);
    const b = aimFromPointer(Math.round(LX + d.dx * 200), Math.round(LY + d.dy * 200));
    assert.ok(Math.abs(((b - a + 1536) % 1024) - 512) <= 2, `aim ${a} -> ${b}`);
  }
  assert.ok(D === 22);
});
