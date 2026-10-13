import { test } from "node:test";
import assert from "node:assert/strict";
import { pinball, PinballEngine, FIELD_W, FLIPPERS, BALL_R } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";
import { Rng } from "../core/rng.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = pinball.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = pinball.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("pinball: bot launches, flips and scores", () => {
  const { g } = botRun(7, 20000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("pinball: a full game ends with 3 balls drained", () => {
  const g = pinball.create(11, CTX);
  let drains = 0;
  for (let i = 0; i < pinball.maxFrames && !g.done; i++) {
    g.step({ x: 200, y: 350, b: 0 });
    for (const e of g.events) if (e.t === "drain") drains++;
  }
  assert.equal(g.done, true);
  assert.equal(drains, 3);
  assert.equal(g.result().status, "over");
});

test("pinball: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 9000);
    const r = replayGame(pinball, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("pinball: ball never leaves the table over a long random run", () => {
  const rng = new Rng(99);
  let total = 0;
  for (let seed = 4; total < 120000; seed++) {
    const g = pinball.create(seed, { ticker: ["GLORP", "AB", "WOBBL"][seed % 3] });
    let b = 0;
    for (let i = 0; i < pinball.maxFrames && !g.done; i++, total++) {
      // Mostly bot play (keeps balls alive), mashed with random buttons and nudges.
      if (i % 7 === 0) b = rng.int(64) & (BTN.LEFT | BTN.RIGHT | BTN.DOWN | BTN.FIRE | BTN.UP);
      const inp = rng.int(3) === 0 ? { x: rng.int(FIELD_W), y: 300, b } : pinball.bot!(g.view(), i);
      g.step(inp);
      for (const ball of g.view().balls) {
        assert.ok(Number.isFinite(ball.x) && Number.isFinite(ball.y), "finite position");
        assert.ok(ball.x >= 10 && ball.x <= 390, `x in table at frame ${i}: ${ball.x}`);
        assert.ok(ball.y >= 0, `y in table at frame ${i}: ${ball.y}`);
      }
    }
  }
});

test("pinball: plunger launch sends the ball out of the lane", () => {
  const g = new PinballEngine(1, "TEST");
  for (let i = 0; i < 20; i++) g.step({ x: 0, y: 0, b: BTN.DOWN });
  g.step({ x: 0, y: 0, b: 0 });
  assert.ok(g.events.some((e) => e.t === "launch"));
  let left = false;
  for (let i = 0; i < 120; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    if (!g.view().balls[0].inLane) left = true;
  }
  assert.ok(left, "a weak launch still reaches the playfield");
});

function aboveFlipper(g: PinballEngine, i: number) {
  const ball = g.view().balls[0];
  const f = g.view().flippers[i];
  // Signed side of the ball relative to the flipper line (negative = above for both).
  const dx = f.ex - f.px, dy = f.ey - f.py;
  const cross = (ball.x - f.px) * dy - (ball.y - f.py) * dx;
  return i === 0 ? cross > 0 : cross < 0;
}

test("pinball: a ball resting on a raised flipper does not fall through", () => {
  for (const i of [0, 1]) {
    const g = new PinballEngine(3, "TEST");
    const btn = i === 0 ? BTN.LEFT : BTN.RIGHT;
    for (let k = 0; k < 10; k++) g.step({ x: 0, y: 0, b: btn });
    const f = FLIPPERS[i];
    const x = f.px + (i === 0 ? 40 : -40);
    g.placeBall(x, f.py - 50, 0, 0);
    for (let k = 0; k < 400; k++) {
      g.step({ x: 0, y: 0, b: btn });
      assert.equal(g.view().balls.length, 1, `ball drained at frame ${k}`);
      assert.ok(aboveFlipper(g, i), `ball below flipper ${i} at frame ${k}`);
    }
    // Also a fast drop straight onto the raised flipper.
    g.placeBall(x, f.py - 160, 0, 1500);
    for (let k = 0; k < 120; k++) {
      g.step({ x: 0, y: 0, b: btn });
      assert.equal(g.view().balls.length, 1);
      assert.ok(aboveFlipper(g, i), `fast ball tunnelled through flipper ${i}`);
    }
  }
});

test("pinball: a flip shoots a resting ball up the table", () => {
  const g = new PinballEngine(3, "TEST");
  const f = FLIPPERS[0];
  g.placeBall(f.px + 38, f.py - 20, 0, 0);
  for (let k = 0; k < 8; k++) g.step({ x: 0, y: 0, b: 0 }); // drop onto the lowered flipper
  let minY = Infinity;
  for (let k = 0; k < 60; k++) {
    g.step({ x: 0, y: 0, b: BTN.LEFT });
    const b = g.view().balls[0];
    if (b) minY = Math.min(minY, b.y);
  }
  assert.ok(minY < 300, `flip should reach the upper table (got ${minY.toFixed(0)})`);
  assert.ok(BALL_R > 0);
});

test("pinball: ball save returns the first drain", () => {
  const g = new PinballEngine(8, "TEST");
  for (let i = 0; i < 20; i++) g.step({ x: 0, y: 0, b: BTN.DOWN });
  g.step({ x: 0, y: 0, b: 0 });
  // Drop the ball straight down the middle drain within the save window.
  g.placeBall(185, 660, 0, 300);
  let saved = false, drained = false;
  for (let i = 0; i < 60; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) {
      if (e.t === "save") saved = true;
      if (e.t === "drain") drained = true;
    }
  }
  assert.ok(saved && !drained);
});
