import { test } from "node:test";
import assert from "node:assert/strict";
import { racer, TRACKS, COUNTDOWN, POINTS, HALF_W, WALL, type RacerView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames = racer.maxFrames) {
  const g = racer.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = racer.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("racer: bot finishes the championship and scores", () => {
  const { g } = botRun(7);
  assert.ok(g.done, "championship should end");
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.equal(r.levelsCleared, 3);
});

test("racer: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 9000);
    const r = replayGame(racer, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("racer: tracks are closed loops with separated sections", () => {
  for (const tr of TRACKS) {
    assert.ok(tr.n > 200);
    // Non-adjacent samples never closer than two barrier distances.
    for (let i = 0; i < tr.n; i += 2)
      for (let j = i + 40; j < tr.n; j += 2) {
        if (tr.n - (j - i) < 40) continue;
        const d = Math.hypot(tr.x[i] - tr.x[j], tr.y[i] - tr.y[j]);
        assert.ok(d > 2 * WALL, `${tr.name}: samples ${i}/${j} only ${d.toFixed(0)} apart`);
      }
  }
});

test("racer: nobody moves during the countdown; auto-gas drives after GO", () => {
  const g = racer.create(4, { ticker: "TEST" });
  const v0 = g.view() as RacerView;
  const x0 = v0.cars[0].x, y0 = v0.cars[0].y;
  for (let i = 0; i < COUNTDOWN - 1; i++) g.step({ x: 180, y: 300, b: BTN.UP });
  let v = g.view() as RacerView;
  assert.equal(v.cars[0].x, x0);
  assert.equal(v.cars[0].y, y0);
  for (let i = 0; i < 120; i++) g.step({ x: 180, y: 300, b: 0 });
  v = g.view() as RacerView;
  assert.ok(Math.hypot(v.cars[0].x - x0, v.cars[0].y - y0) > 100, "auto-gas should move the car");
});

test("racer: walls keep the car in, grass slows it, braking works", () => {
  const g = racer.create(9, { ticker: "TEST" });
  for (let i = 0; i < COUNTDOWN; i++) g.step({ x: 180, y: 300, b: 0 });
  let maxOff = 0, sawOff = false, minGrassSpeed = 99;
  for (let i = 0; i < 400; i++) {
    g.step({ x: 180, y: 300, b: BTN.RIGHT });
    const v = g.view() as RacerView;
    const c = v.cars[0];
    const tr = TRACKS[v.track];
    const lat = Math.abs((c.x - tr.x[c.idx]) * tr.nx[c.idx] + (c.y - tr.y[c.idx]) * tr.ny[c.idx]);
    maxOff = Math.max(maxOff, lat);
    if (lat > HALF_W + 4 && i > 100) {
      sawOff = true;
      minGrassSpeed = Math.min(minGrassSpeed, Math.hypot(c.vx, c.vy));
    }
  }
  assert.ok(maxOff <= WALL + 1, `car escaped the barrier (${maxOff})`);
  assert.ok(sawOff && minGrassSpeed < 3, "grass should slow the car");
  for (let i = 0; i < 120; i++) g.step({ x: 180, y: 300, b: BTN.DOWN });
  const v = g.view() as RacerView;
  assert.ok(Math.hypot(v.cars[0].vx, v.cars[0].vy) < 2, "brake should stop/reverse slowly");
});

test("racer: points table awarded after a race", () => {
  const { g } = botRun(5, 20000);
  const v = g.view() as RacerView;
  const total = v.points.reduce((a, b) => a + b, 0);
  const per = POINTS.reduce((a, b) => a + b, 0);
  assert.equal(total % per, 0);
  assert.ok(total >= per);
});
