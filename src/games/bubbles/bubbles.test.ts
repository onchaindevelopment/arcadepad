import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bubbles, newGrid, setCell, getCell, findMatches, findOrphans, moveFlight, simulateShot, aimFromPointer, aimDir,
  evaluatePlacement, R, W, LX, LY, AIM_UP, AIM_MIN, AIM_MAX, type Flight,
} from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import type { Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = bubbles.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = bubbles.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("bubbles: bot pops and scores", () => {
  const { g } = botRun(7, 6000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("bubbles: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 5000);
    const r = replayGame(bubbles, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("bubbles: three of a colour pop", () => {
  const g = newGrid();
  setCell(g, 0, 0, 2);
  setCell(g, 0, 1, 2);
  setCell(g, 0, 2, 1);
  // (1,0) on an odd row touches (0,0) and (0,1).
  const e = evaluatePlacement(g, 1, 0, 2);
  assert.equal(e.pop, 3);
  setCell(g, 1, 0, 2);
  assert.equal(findMatches(g, 1, 0).length, 3);
  // Two only: no pop.
  assert.equal(evaluatePlacement(newGrid(), 0, 5, 2).pop, 0);
});

test("bubbles: orphans are detected and dropped by a pop", () => {
  const g = newGrid();
  setCell(g, 0, 0, 0);
  setCell(g, 0, 1, 0);
  setCell(g, 1, 0, 1); // hangs from row 0
  setCell(g, 2, 0, 3); // hangs from (1,0)
  setCell(g, 2, 1, 3);
  assert.equal(findOrphans(g).length, 0);
  setCell(g, 1, 0, -1);
  const o = findOrphans(g);
  assert.equal(o.length, 2);
  // Pop the anchors: everything below falls.
  const g2 = newGrid();
  setCell(g2, 0, 0, 0);
  setCell(g2, 0, 1, 0);
  setCell(g2, 1, 1, 4);
  setCell(g2, 2, 1, 4);
  const e = evaluatePlacement(g2, 1, 0, 0);
  assert.equal(e.pop, 3);
  assert.equal(e.drop, 2);
  assert.equal(getCell(g2, 1, 0), -1, "evaluate leaves the grid untouched");
});

test("bubbles: walls reflect the flight", () => {
  const g = newGrid();
  const f: Flight = { x: R + 1, y: 300, vx: -3, vy: -1 };
  assert.equal(moveFlight(f, g, 0), "wall");
  assert.ok(f.vx > 0 && f.x >= R);
  const f2: Flight = { x: W - R - 1, y: 300, vx: 3, vy: -1 };
  assert.equal(moveFlight(f2, g, 0), "wall");
  assert.ok(f2.vx < 0 && f2.x <= W - R);
  // A shallow shot banks off a wall and still reaches the ceiling.
  const sim = simulateShot(g, 0, AIM_MIN + 20);
  assert.ok(sim.bounces >= 1);
  assert.equal(sim.r, 0);
});

test("bubbles: pointer aiming", () => {
  assert.equal(aimFromPointer(LX, 100), AIM_UP);
  assert.ok(aimFromPointer(0, LY - 10) <= AIM_MAX && aimFromPointer(0, LY - 10) > AIM_UP);
  assert.equal(aimFromPointer(W, LY + 50), AIM_MIN);
  const d = aimDir(AIM_UP);
  assert.ok(Math.abs(d.dx) < 1e-9 && d.dy === -1);
});

test("bubbles: ceiling drops and the run ends without pops", () => {
  const g = bubbles.create(11, { ticker: "TEST" });
  let ceiling = 0;
  let lost = false;
  // Shoot straight up repeatedly, rarely popping, until the stack crosses the line.
  for (let i = 0; i < 20000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: i % 20 === 0 ? 1 : 0 });
    for (const e of g.events) {
      if (e.t === "ceiling") ceiling++;
      if (e.t === "gameover") lost = true;
    }
  }
  assert.ok(ceiling > 0);
  assert.ok(lost && g.done);
});
