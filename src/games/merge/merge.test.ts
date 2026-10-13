import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, MergeEngine, slideValues, LOCK_FRAMES } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const L = 3, R = 1, U = 0, D = 2;
const idle: Input = { x: 0, y: 0, b: 0 };

function botRun(seed: number, frames: number) {
  const g = merge.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = merge.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("merge: starts with two tiles of 2 or 4", () => {
  const v = merge.create(1, { ticker: "TEST" }).view();
  assert.equal(v.tiles.length, 2);
  for (const t of v.tiles) assert.ok(t.value === 2 || t.value === 4);
});

test("merge: bot scores and plays to game over", () => {
  const { g } = botRun(7, 60 * 60 * 10);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.done, "bot game should end");
  assert.ok(r.status === "over" || r.status === "won");
});

test("merge: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 60 * 60 * 10);
    const r = replayGame(merge, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.frames > 0);
  }
});

test("merge: rules from the original (one merge per tile, toward the move)", () => {
  const row = (a: number[], dir: number) => slideValues([...a, ...new Array(12).fill(0)], dir).values.slice(0, 4);
  assert.deepEqual(row([2, 2, 2, 2], L), [4, 4, 0, 0]);
  assert.deepEqual(row([2, 2, 2, 2], R), [0, 0, 4, 4]);
  assert.deepEqual(row([2, 2, 2, 0], L), [4, 2, 0, 0]);
  assert.deepEqual(row([2, 2, 2, 0], R), [0, 0, 2, 4]);
  assert.deepEqual(row([2, 2, 4, 0], L), [4, 4, 0, 0]); // merged 4 does not merge again
  assert.deepEqual(row([4, 0, 0, 4], L), [8, 0, 0, 0]);
  const r = slideValues([2, 2, 2, 2, ...new Array(12).fill(0)], L);
  assert.equal(r.gained, 8);
  assert.equal(slideValues([2, 4, 8, 16, ...new Array(12).fill(0)], L).moved, false);
  // Column down
  const col = slideValues([2, 0, 0, 0, 2, 0, 0, 0, 4, 0, 0, 0, 4, 0, 0, 0], D).values;
  assert.deepEqual([col[0], col[4], col[8], col[12]], [0, 0, 4, 8]);
  assert.deepEqual(slideValues(col, U).values.filter((_, i) => i % 4 === 0), [4, 8, 0, 0]);
});

test("merge: press edges, move lock and one-deep buffer", () => {
  const g = new MergeEngine(9, [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  g.step({ x: 0, y: 0, b: BTN.RIGHT });
  assert.equal(g.view().moves, 1);
  g.step({ x: 0, y: 0, b: BTN.RIGHT }); // held: no new edge
  g.step(idle);
  g.step({ x: 0, y: 0, b: BTN.DOWN }); // buffered during lock
  assert.equal(g.view().moves, 1);
  for (let i = 0; i < LOCK_FRAMES && g.view().moves === 1; i++) g.step(idle);
  assert.equal(g.view().moves, 2, "buffered press fires after the lock");
  assert.equal(g.view().lastDir, D);
});

test("merge: 2048 toasts levelClear, play continues", () => {
  const g = new MergeEngine(4, [1024, 1024, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  const ev = g.events;
  assert.ok(ev.some((e) => e.t === "moon" && e.toast === "levelClear" && e.sfx === "levelclear" && e.mood === "happy"));
  assert.ok(ev.some((e) => e.t === "maxTile" && e.value === 2048));
  assert.equal(g.done, false);
  assert.equal(g.result().status, "playing");
  assert.equal(g.result().score, 2048);
});

test("merge: no moves left ends the game (sad), status over", () => {
  // Sliding row 0 left fills the board; the spawn (2 or 4) sits next to 8 and 32, so no pair remains.
  const g = new MergeEngine(4, [
    0, 8, 16, 8,
    16, 8, 16, 32,
    8, 16, 8, 16,
    16, 8, 16, 8,
  ]);
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  const over = g.events.find((e) => e.t === "gameover");
  assert.ok(g.done);
  assert.ok(over && over.mood === "sad" && over.sfx === "gameover");
  assert.equal(g.result().status, "over");
});
