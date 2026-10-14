import { test } from "node:test";
import assert from "node:assert/strict";
import { barrage, FIELD_W, LAUNCH_Y, ROWS } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = barrage.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  let maxBalls = 1;
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = barrage.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    maxBalls = Math.max(maxBalls, g.view().balls);
  }
  return { g, inputs, maxBalls };
}

test("barrage: bot scores, collects balls and the run ends", () => {
  const { g, maxBalls } = botRun(7, barrage.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(maxBalls > 1, "+1 rings should add balls");
  assert.equal(r.status, "over", "attract run should end");
  const v = g.view();
  assert.equal(r.score, v.turnsSurvived + v.broken, "score = turns survived + blocks broken");
});

test("barrage: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 15000);
    const r = replayGame(barrage, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("barrage: keyboard fire straight up, blocks descend and a block on the bottom row ends the run", () => {
  const g = barrage.create(11, { ticker: "TEST" });
  let turns = 0;
  for (let i = 0; i < 200000 && !g.done; i++) {
    const v = g.view();
    // Tap FIRE on the first aim frame, never aim: the side columns are never touched.
    const b = v.phase === "aim" && v.phaseT === 1 ? BTN.FIRE : 0;
    g.step({ x: 0, y: 0, b });
    turns = g.view().turnsSurvived;
  }
  assert.equal(g.result().status, "over");
  assert.ok(g.view().blocks.some((b) => b.r === ROWS - 1), "a block sits on the bottom row");
  assert.ok(turns >= ROWS - 3, "survived several turns before the wall came down");
});

test("barrage: launcher moves to where the first ball landed; releasing below the launcher cancels", () => {
  const g = barrage.create(5, { ticker: "TEST" });
  // Drag below the launcher and release: no shot.
  g.step({ x: 100, y: 100, b: 0 });
  g.step({ x: 100, y: LAUNCH_Y + 20, b: BTN.FIRE });
  g.step({ x: 100, y: LAUNCH_Y + 20, b: 0 });
  assert.equal(g.view().phase, "aim");
  // Now a steep shot to the right.
  g.step({ x: FIELD_W - 20, y: 200, b: BTN.FIRE });
  g.step({ x: FIELD_W - 20, y: 200, b: 0 });
  assert.equal(g.view().phase, "fly");
  let landX = -1;
  for (let i = 0; i < 5000 && g.view().phase !== "aim"; i++) {
    g.step({ x: FIELD_W - 20, y: 200, b: 0 });
    for (const e of g.events) if (e.t === "land" && landX < 0) landX = e.x as number;
  }
  assert.ok(landX > 0, "a ball landed");
  assert.equal(g.view().launcherX, landX);
  assert.equal(g.view().turn, 2);
});
