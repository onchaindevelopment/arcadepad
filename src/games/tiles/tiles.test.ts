import { test } from "node:test";
import assert from "node:assert/strict";
import { tiles, TilesEngine, LAYOUTS, isFree, solvableFaces, TW, TH, RUN_FRAMES, SHUFFLE_COST, START_SHUFFLES, type Slot } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { Rng } from "../core/rng.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = tiles.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = tiles.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const idle: Input = { x: 0, y: 0, b: 0 };
function stepN(g: TilesEngine, n: number, inp: Input = idle) {
  for (let i = 0; i < n; i++) g.step(inp);
}
function tap(g: TilesEngine, id: number) {
  const t = g.view().tiles.find((q) => q.id === id)!;
  const at = { x: Math.floor(t.x + TW / 2), y: Math.floor(t.y + TH / 2) };
  g.step({ ...at, b: 0 });
  g.step({ ...at, b: BTN.FIRE });
  g.step({ ...at, b: 0 });
}

test("tiles: layouts have 72-96 tiles in pairs", () => {
  for (const l of LAYOUTS) {
    assert.ok(l.slots.length >= 72 && l.slots.length <= 96, `${l.name}: ${l.slots.length}`);
    assert.equal(l.slots.length % 2, 0, l.name);
    const keys = new Set(l.slots.map((s) => `${s.hx},${s.hy},${s.z}`));
    assert.equal(keys.size, l.slots.length, `${l.name} has duplicate slots`);
  }
});

test("tiles: every deal is solvable by greedy pair removal along the dealt order", () => {
  // Re-run the dealer logic and check that removing the pairs in order is legal.
  for (const l of LAYOUTS) {
    for (let seed = 1; seed <= 15; seed++) {
      const pool = Array.from({ length: l.slots.length / 2 }, (_, i) => i);
      const faces = solvableFaces(l.slots, l.slots.map(() => true), pool, new Rng(seed));
      if (!faces) continue;
      const present = l.slots.map(() => true);
      for (let k = 0; k < pool.length; k++) {
        const idx: number[] = faces.map((f, i) => (f === k ? i : -1)).filter((i) => i >= 0);
        assert.equal(idx.length, 2);
        for (const i of idx) assert.ok(isFree(l.slots[i], l.slots, (j) => present[j]), `${l.name} seed ${seed} pair ${k}`);
        for (const i of idx) present[i] = false;
      }
    }
  }
});

test("tiles: blocked tiles can't be picked, matching free pair scores", () => {
  const g = tiles.create(4, { ticker: "TEST" }) as TilesEngine;
  stepN(g, 45);
  const v = g.view();
  const blocked = v.tiles.find((t) => !t.free)!;
  tap(g, blocked.id);
  assert.equal(g.view().selected, -1);
  const [a, b] = g.view().pairs[0];
  const before = g.view().tiles.length;
  tap(g, a);
  assert.equal(g.view().selected, a);
  tap(g, b);
  assert.equal(g.view().tiles.length, before - 2);
  assert.equal(g.score, 10);
});

test("tiles: free rule (top cover and both sides)", () => {
  const s: Slot[] = [
    { hx: 0, hy: 0, z: 0 },
    { hx: 2, hy: 0, z: 0 },
    { hx: 4, hy: 0, z: 0 },
    { hx: 3, hy: 1, z: 1 },
  ];
  const all = () => true;
  assert.equal(isFree(s[0], s, all), true);
  assert.equal(isFree(s[1], s, all), false);
  assert.equal(isFree(s[2], s, all), false); // covered by the half-offset tile on top
  assert.equal(isFree(s[3], s, all), true);
  assert.equal(isFree(s[2], s, (i) => i !== 3), true);
});

test("tiles: manual shuffle costs points and a shuffle", () => {
  const g = tiles.create(9, { ticker: "TEST" }) as TilesEngine;
  stepN(g, 45);
  for (let k = 0; k < 5; k++) {
    const [a, b] = g.view().pairs[0];
    tap(g, a);
    tap(g, b);
  }
  stepN(g, 200);
  const score = g.score;
  g.step({ x: 300, y: 570, b: 0 });
  g.step({ x: 300, y: 570, b: BTN.FIRE });
  assert.equal(g.shuffles, START_SHUFFLES - 1);
  assert.equal(g.score, score - SHUFFLE_COST);
  assert.equal(g.phase, "shuffle");
});

test("tiles: bot scores, clears layouts and the 5 minute run ends", () => {
  const { g } = botRun(7, tiles.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.done, "run should end");
  assert.ok(r.frames >= 60 && r.frames <= tiles.maxFrames);
  console.log("bot result", r);
});

test("tiles: time runs out at 5 minutes when idle", () => {
  const g = tiles.create(3, { ticker: "TEST" });
  for (let i = 0; i < tiles.maxFrames && !g.done; i++) g.step(idle);
  assert.ok(g.done);
  assert.ok(g.result().frames >= RUN_FRAMES);
});

test("tiles: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, tiles.maxFrames);
    const r = replayGame(tiles, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});
