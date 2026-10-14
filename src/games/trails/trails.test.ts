import { test } from "node:test";
import assert from "node:assert/strict";
import { COLS, cpusForRound, Filler, ROUND_SCORE, speedForRound, trails } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const ctx = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = trails.create(seed, ctx);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = trails.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("trails: bot survives, scores and the run ends", () => {
  let total = 0;
  for (const seed of [11, 12, 13]) {
    const { g } = botRun(seed, trails.maxFrames);
    const r = g.result();
    assert.ok(r.score > 0, "bot should score");
    assert.ok(g.done, "run should end with a lost round");
    total += r.levelsCleared;
  }
  assert.ok(total >= 1, "bot should win at least one round over three runs");
});

test("trails: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000);
    const r = replayGame(trails, seed, ctx, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("trails: idling straight up hits the top wall and ends the run", () => {
  const g = trails.create(5, ctx);
  for (let i = 0; i < 3000 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.result().status, "over");
  assert.ok(g.events.some((e) => e.t === "gameover"));
});

test("trails: LEFT turns relative to heading and leaves a trail", () => {
  const g = trails.create(9, ctx);
  const start = g.view().riders[0];
  assert.equal(start.dir, 0);
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  for (let i = 0; i < 200; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    if (g.view().riders[0].x !== start.x) break;
  }
  const me = g.view().riders[0];
  assert.equal(me.dir, 3, "up + left turn = heading left");
  assert.equal(me.x, start.x - 1);
  assert.equal(g.view().grid[start.y * COLS + start.x], 1, "spawn cell is trail");
});

test("trails: boost drains the meter and moves faster", () => {
  const a = trails.create(4, ctx);
  const b = trails.create(4, ctx);
  for (let i = 0; i < 200; i++) {
    a.step({ x: 0, y: 0, b: 0 });
    b.step({ x: 0, y: 0, b: BTN.ALT });
  }
  assert.ok(b.view().meter < a.view().meter);
  assert.ok(b.view().riders[0].y < a.view().riders[0].y, "boosted rider is further up");
});

test("trails: ladder ramps up and flood fill is bounded", () => {
  assert.equal(cpusForRound(0), 3);
  assert.equal(cpusForRound(4), 5);
  assert.equal(cpusForRound(20), 5);
  assert.ok(speedForRound(5) > speedForRound(0));
  assert.equal(ROUND_SCORE, 500);
  const grid = new Uint8Array(COLS * 92);
  const f = new Filler();
  assert.equal(f.fill(grid, 10, 10, 50), 50);
  assert.equal(f.fill(grid, 10, 10, 1e9), COLS * 92);
});
