import { test } from "node:test";
import assert from "node:assert/strict";
import {
  putt, PuttEngine, HOLES, BALL_R, course, newBall, rollFrame, holePoints, camFor, shotFromPointer,
  REST, SUNK, WATER, ROLL, type PuttView,
} from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
const idle: Input = { x: 0, y: 0, b: 0 };

function botRun(seed: number, frames: number) {
  const g = putt.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = putt.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

function waitAim(g: PuttEngine) {
  for (let i = 0; i < 2000 && g.view().phase !== "aim"; i++) g.step(idle);
  assert.equal(g.view().phase, "aim");
}

test("putt: bot plays a full round and scores", () => {
  const { g } = botRun(7, putt.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.equal(r.status, "won");
  assert.equal(r.levelsCleared, HOLES.length);
});

test("putt: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, putt.maxFrames);
    const r = replayGame(putt, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("putt: every hole has tee and cup inside the course, clear of walls", () => {
  for (let h = 0; h < HOLES.length; h++) {
    const c = course(h);
    for (const [x, y] of [c.def.tee, c.def.cup]) {
      const b = newBall(x, y);
      rollFrame(c, b, 0);
      assert.equal(b.x, x, `hole ${h + 1} point not pushed by walls`);
      assert.equal(b.y, y);
    }
    const cam = camFor(h);
    assert.ok(cam.s > 0.6, `hole ${h + 1} camera scale ${cam.s}`);
  }
});

test("putt: scoring rule", () => {
  assert.equal(holePoints(3, 1, true), 500 + 500); // ace
  assert.equal(holePoints(3, 3, true), 300);
  assert.equal(holePoints(3, 6, true), 0);
  assert.equal(holePoints(4, 8, false), 0);
});

test("putt: ball rests on flat ground and sinks when rolled gently into the cup", () => {
  const c = course(0);
  const [cx, cy] = c.def.cup;
  const b = newBall(cx, cy + 40);
  b.vy = -3;
  let code = ROLL;
  for (let i = 0; i < 600 && code === ROLL; i++) code = rollFrame(c, b, i);
  assert.equal(code, SUNK);
  // Too fast: lips out instead of sinking on the first pass.
  const f = newBall(cx, cy + 20);
  f.vy = -12;
  const first = rollFrame(c, f, 0);
  assert.notEqual(first, SUNK);
  // A soft shot sideways comes to rest.
  const s = newBall(100, 300);
  s.vx = 1;
  code = ROLL;
  for (let i = 0; i < 600 && code === ROLL; i++) code = rollFrame(c, s, i);
  assert.equal(code, REST);
  assert.ok(s.x > 100 && s.x < 120);
});

test("putt: walls reflect the ball and keep it inside", () => {
  const c = course(0);
  const b = newBall(180, 300);
  b.vx = 8;
  for (let i = 0; i < 10; i++) rollFrame(c, b, i);
  assert.ok(b.vx < 0, "bounced back off the right wall");
  assert.ok(b.x <= 200 - BALL_R + 1e-9);
});

test("putt: rolling into water is detected", () => {
  const c = course(3); // CRATER SLOPE has a pond at (190, 96)
  const b = newBall(190, 160);
  b.vy = -4;
  let code = ROLL;
  for (let i = 0; i < 200 && code === ROLL; i++) code = rollFrame(c, b, i);
  assert.equal(code, WATER);

});

test("putt: pointer pull shoots opposite to the drag and counts a stroke", () => {
  const g = new PuttEngine(1, 0);
  waitAim(g);
  const v = g.view();
  const bx = Math.round(v.ball.x * v.cam.s + v.cam.ox), by = Math.round(v.ball.y * v.cam.s + v.cam.oy);
  g.step({ x: bx, y: by, b: BTN.FIRE });
  for (let k = 1; k <= 10; k++) g.step({ x: bx, y: by + k * 6, b: BTN.FIRE });
  const before = g.view();
  assert.ok(before.aim.dragged && before.aim.dy < -0.99, "aim points up");
  g.step({ x: bx, y: by + 60, b: 0 });
  const after = g.view();
  assert.equal(after.strokes, 1);
  assert.equal(after.phase, "roll");
  assert.ok(after.ball.vy < 0, "ball moves up");
  const shot = shotFromPointer(0, 0, 0, 60);
  assert.ok(shot.power > 0.4 && shot.power < 0.6);
});

test("putt: keyboard charge shot and 8-stroke limit auto-advances", () => {
  const g = new PuttEngine(1, 0);
  for (let stroke = 0; stroke < 8 && g.view().hole === 0; stroke++) {
    waitAim(g);
    // Aim away from the cup (rotate half a turn) and tap a soft shot.
    for (let i = 0; i < 60; i++) g.step({ x: 0, y: 0, b: BTN.LEFT });
    g.step(idle);
    for (let i = 0; i < 8; i++) g.step({ x: 0, y: 0, b: BTN.FIRE });
    g.step(idle);
    const v: PuttView = g.view();
    if (v.hole === 0 && v.phase !== "sunk") assert.ok(v.strokes === stroke + 1 || v.phase === "giveup");
  }
  for (let i = 0; i < 3000 && g.view().hole === 0; i++) g.step(idle);
  const v = g.view();
  assert.equal(v.hole, 1, "advanced to hole 2");
  assert.equal(v.cards[0], 8);
  assert.equal(v.score, 0);
});
