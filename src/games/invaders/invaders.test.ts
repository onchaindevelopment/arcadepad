import { test } from "node:test";
import assert from "node:assert/strict";
import { invaders, STEP_Y, ROWS, COLS, W, PLAYER_Y } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = invaders.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = invaders.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("invaders: bot shoots critters and scores", () => {
  const { g } = botRun(7, 8000);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
});

test("invaders: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(invaders, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("invaders: formation steps down and reverses at the edge", () => {
  const g = invaders.create(5, { ticker: "TEST" });
  const v0 = g.view();
  assert.equal(v0.critters.length, ROWS * COLS);
  assert.equal(v0.dir, 1);
  let prev = v0;
  for (let i = 0; i < 3000 && !g.done; i++) {
    g.step({ x: W / 2, y: 0, b: 0 });
    const v = g.view();
    if (v.dir !== prev.dir) {
      assert.equal(v.fy, prev.fy + STEP_Y, "steps down by STEP_Y");
      assert.equal(v.fx, prev.fx, "no sideways move on the step-down");
      const right = Math.max(...v.critters.map((c) => c.x + 30));
      assert.ok(right > W - 30, "reversed near the right edge");
      return;
    }
    assert.equal(v.fy, prev.fy, "no vertical move before the edge");
    prev = v;
  }
  assert.fail("formation never reached the edge");
});

test("invaders: player follows pointer at capped speed, arrows override", () => {
  const g = invaders.create(9, { ticker: "TEST" });
  g.step({ x: 600, y: 0, b: 0 });
  assert.equal(g.view().player.x, W / 2 + 6);
  g.step({ x: 600, y: 0, b: BTN.LEFT });
  assert.equal(g.view().player.x, W / 2);
  // Pointer did not move, so the arrows' position sticks.
  g.step({ x: 600, y: 0, b: 0 });
  assert.equal(g.view().player.x, W / 2);
  assert.equal(g.view().player.y, PLAYER_Y);
});

test("invaders: at most two bullets on screen, idle player loses all lives", () => {
  const g = invaders.create(11, { ticker: "TEST" });
  for (let i = 0; i < 60; i++) {
    g.step({ x: W / 2, y: 0, b: BTN.FIRE });
    assert.ok(g.view().bullets.length <= 2);
  }
  let lost = 0;
  for (let i = 0; i < 40000 && !g.done; i++) {
    g.step({ x: W / 2, y: 0, b: 0 });
    if (g.events.some((e) => e.t === "hit")) lost++;
  }
  assert.ok(g.done);
  assert.equal(g.result().status, "over");
  assert.ok(g.events.some((e) => e.t === "gameover" && e.sfx === "gameover"));
  assert.ok(lost >= 1);
});
