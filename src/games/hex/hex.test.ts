import { test } from "node:test";
import assert from "node:assert/strict";
import { hex, PATTERNS, transformMask, PR, SECTOR_U, STAGE_FRAMES, type HexView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = hex.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = hex.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}
const idle = { x: 180, y: 300, b: 0 };

test("hex: bot survives a while and scores", () => {
  let best = 0;
  for (const seed of [7, 8, 9]) best = Math.max(best, botRun(seed, 20000).g.result().score);
  assert.ok(best > 100, `bot should survive past 10 s, best ${best}`);
});

test("hex: bot runs end (attract mode)", () => {
  let ended = 0;
  for (const seed of [11, 12, 13]) if (botRun(seed, hex.maxFrames).g.done) ended++;
  assert.equal(ended, 3);
});

test("hex: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(hex, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("hex: every pattern row leaves a gap, transforms keep wall counts", () => {
  const bits = (m: number) => [0, 1, 2, 3, 4, 5].filter((i) => m & (1 << i)).length;
  for (const p of PATTERNS)
    for (const [, mask] of p.rows) {
      assert.ok(bits(mask) < 6, p.name);
      for (let r = 0; r < 6; r++) for (const mir of [false, true]) assert.equal(bits(transformMask(mask, r, mir)), bits(mask));
    }
  assert.equal(transformMask(0b000001, 1, false), 0b000010);
  assert.equal(transformMask(0b000001, 0, true), 0b100000);
  assert.equal(transformMask(0b100000, 1, false), 0b000001);
});

test("hex: idling gets run over head-on; score is time in tenths", () => {
  const g = hex.create(4, { ticker: "TEST" });
  for (let i = 0; i < 20000 && !g.done; i++) g.step(idle);
  const r = g.result();
  assert.equal(r.status, "over");
  assert.equal(r.score, Math.floor(r.frames / 6));
  assert.ok(g.events.some((e) => e.t === "die"));
});

test("hex: a wall beside the mascot blocks turning instead of killing", () => {
  const g = hex.create(5, { ticker: "TEST" });
  const v = g.view() as HexView;
  v.walls.length = 0;
  const s0 = v.sector;
  const right = (s0 + 1) % 6;
  // A long wall sitting across the orbit in the next sector, far from our own.
  v.walls.push({ s: right, d: PR - 40, th: 400 });
  for (let i = 0; i < 40; i++) {
    g.step({ x: 180, y: 300, b: BTN.RIGHT });
    (g.view() as HexView).walls.length = 1; // keep only our test wall
  }
  const after = g.view() as HexView;
  assert.equal(g.done, false);
  assert.equal(after.sector, s0);
  assert.equal(after.pa, s0 * SECTOR_U + SECTOR_U - 1);
});

test("hex: touch halves turn like arrows; stages advance every 10 s", () => {
  const a = hex.create(6, { ticker: "TEST" });
  const b = hex.create(6, { ticker: "TEST" });
  a.step({ x: 40, y: 300, b: BTN.FIRE });
  b.step({ x: 180, y: 300, b: BTN.LEFT });
  assert.equal((a.view() as HexView).pa, (b.view() as HexView).pa);

  const g = hex.create(7, { ticker: "TEST" });
  let stages = 0;
  for (let i = 0; i < STAGE_FRAMES * 2; i++) {
    (g.view() as HexView).walls.length = 0;
    g.step(idle);
    if (g.events.some((e) => e.t === "stage")) stages++;
  }
  assert.equal(stages, 2);
  assert.equal((g.view() as HexView).stage, 2);
  assert.equal(g.result().score, 200);
});
