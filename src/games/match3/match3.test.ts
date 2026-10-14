import { test } from "node:test";
import assert from "node:assert/strict";
import { match3, Match3Engine, findRuns, findMoves, KIND, N, CELL, cellX, cellY, START_TIME, type Grid } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = match3.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = match3.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const at = (r: number, c: number) => ({ x: cellX(c) + CELL / 2, y: cellY(r) + CELL / 2 });
const toGrid = (layout: number[]): Grid => layout.map((color, i) => ({ id: i, color, kind: color < 0 ? KIND.BOMB : 0, clock: false, born: 0 }));

/** Base layout without any line: colours shift by 2 every row. */
function base(): number[] {
  const out: number[] = [];
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) out.push((c + 2 * (r % 3)) % 6);
  return out;
}

function stepUntil(g: Match3Engine, pred: () => boolean, input: Input = { x: 0, y: 0, b: 0 }, max = 600) {
  for (let i = 0; i < max && !pred(); i++) g.step(input);
}

test("match3: fresh boards have no ready lines and at least one move", () => {
  for (let seed = 1; seed <= 40; seed++) {
    const v = match3.create(seed, { ticker: "TEST" }).view();
    assert.equal(findRuns(v.cells).length, 0, `seed ${seed} has a ready line`);
    assert.ok(v.moves.length > 0, `seed ${seed} has no moves`);
  }
});

test("match3: bot scores and the 60 s run ends", () => {
  const { g } = botRun(7, match3.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.done, "run should end");
  assert.equal(r.status, "over");
  assert.ok(r.frames >= START_TIME && r.frames <= match3.maxFrames);
});

test("match3: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, match3.maxFrames);
    const r = replayGame(match3, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("match3: a non-matching swap swaps back and scores nothing", () => {
  const layout = base();
  assert.equal(findRuns(toGrid(layout)).length, 0);
  const g = new Match3Engine(1, layout);
  const before = g.view().cells.map((t) => t!.id);
  // Tap (0,0) then tap (0,1): swapping two different colours in a clean pattern.
  g.step({ ...at(0, 0), b: BTN.FIRE });
  g.step({ ...at(0, 0), b: 0 });
  g.step({ ...at(0, 1), b: BTN.FIRE });
  assert.ok(g.events.some((e) => e.t === "badswap"));
  stepUntil(g, () => g.view().phase === "idle");
  assert.deepEqual(g.view().cells.map((t) => t!.id), before);
  assert.equal(g.result().score, 0);
});

test("match3: dragging into a line of 4 scores and leaves a LINE token", () => {
  const layout = base();
  const X = 5;
  // Bottom row: X X _ X, with an X above the gap; drag it down.
  layout[7 * N + 0] = X;
  layout[7 * N + 1] = X;
  layout[7 * N + 3] = X;
  layout[6 * N + 2] = X;
  layout[7 * N + 2] = 0;
  layout[7 * N + 4] = 1;
  layout[6 * N + 1] = 2;
  layout[6 * N + 3] = 3;
  assert.equal(findRuns(toGrid(layout)).length, 0, "test layout must start clean");
  assert.ok(findMoves(toGrid(layout)).some((m) => m.a === 6 * N + 2 && m.b === 7 * N + 2));
  const g = new Match3Engine(3, layout);
  const p = at(6, 2);
  g.step({ ...p, b: BTN.FIRE });
  g.step({ x: p.x, y: p.y + 25, b: BTN.FIRE });
  assert.ok(g.events.some((e) => e.t === "swap"), "drag should swap");
  stepUntil(g, () => g.view().phase === "fall", { x: p.x, y: p.y + 25, b: 0 });
  assert.ok(g.result().score > 0);
  const t = g.view().cells[7 * N + 2]!;
  assert.equal(t.kind, KIND.LINE_H);
  assert.equal(t.color, X);
});

test("match3: swapping the MOON token clears every token of that colour", () => {
  const layout = base();
  layout[0] = -1; // MOON at (0,0); neighbour (0,1) has colour 1
  assert.equal(findRuns(toGrid(layout)).length, 0);
  const colour = layout[1];
  const count = layout.filter((c) => c === colour).length;
  const g = new Match3Engine(4, layout);
  // Keyboard: cursor to (0,0), FIRE selects, RIGHT swaps.
  for (let i = 0; i < 4; i++) {
    g.step({ x: 0, y: 0, b: BTN.LEFT });
    g.step({ x: 0, y: 0, b: 0 });
    g.step({ x: 0, y: 0, b: BTN.UP });
    g.step({ x: 0, y: 0, b: 0 });
  }
  assert.equal(g.view().cursor, 0);
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  g.step({ x: 0, y: 0, b: 0 });
  g.step({ x: 0, y: 0, b: BTN.RIGHT });
  stepUntil(g, () => g.view().phase === "clear");
  const v = g.view();
  assert.equal(v.clearing.length, count + 1);
  assert.ok(g.events.some((e) => e.t === "bomb"));
});

test("match3: idle player runs out of time", () => {
  const g = match3.create(9, { ticker: "TEST" });
  for (let i = 0; i < START_TIME + 5 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.ok(g.done);
  assert.equal(g.result().score, 0);
});
