import { test } from "node:test";
import assert from "node:assert/strict";
import { crates, MOVE_FR, RESTART_COST, RESTART_FR, UNDOS, type CratesView } from "./index.ts";
import { LEVELS } from "./levels.ts";
import { generateLevel } from "./gen.ts";
import { parseLevel, playMoves, solve } from "./solver.ts";
import { Rng } from "../core/rng.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
const DIR_BTN = [BTN.UP, BTN.RIGHT, BTN.DOWN, BTN.LEFT];

function botRun(seed: number, frames: number) {
  const g = crates.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = crates.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

/** Press a button for one frame, then wait for the slide to finish. */
function press(g: GameEngine<CratesView>, b: number) {
  g.step({ x: 0, y: 0, b });
  g.step({ x: 0, y: 0, b: 0 });
  for (let i = 0; i < MOVE_FR + 1; i++) g.step({ x: 0, y: 0, b: 0 });
}

test("crates: at least 20 original levels, all within 10x10 and solvable", () => {
  assert.ok(LEVELS.length >= 20);
  let prev = 0;
  for (const def of LEVELS) {
    const lv = parseLevel(def.rows);
    assert.ok(lv.w <= 10 && lv.h <= 10, `${def.name} too big`);
    const s = solve(lv);
    assert.ok(s, `${def.name} must be solvable`);
    const play = playMoves(lv, s.moves);
    assert.ok(play.valid && play.solved, `${def.name}: solution replays`);
    assert.equal(play.pushes, s.pushes);
    // Roughly easy -> hard: optimal pushes never drop by much.
    assert.ok(s.pushes >= prev - 3, `${def.name} out of order`);
    prev = Math.max(prev, s.pushes);
  }
});

test("crates: generator makes solvable, deterministic levels", () => {
  for (const seed of [1, 2]) {
    const a = new Rng(seed), b = new Rng(seed);
    for (let tier = 6; tier < 12; tier++) {
      const g = generateLevel(a, tier);
      assert.ok(g, `tier ${tier} generated`);
      assert.ok(g.level.w <= 10 && g.level.h <= 10);
      const play = playMoves(g.level, g.solution.moves);
      assert.ok(play.valid && play.solved, "reference solution works");
      assert.equal(solve(g.level, 400000)?.pushes, g.solution.pushes, "reverse depth is the optimal push count");
      const g2 = generateLevel(b, tier)!;
      assert.deepEqual([...g2.level.cell], [...g.level.cell]);
      assert.deepEqual(g2.level.crates, g.level.crates);
    }
  }
});

test("crates: bot scores and runs end", () => {
  const { g } = botRun(7, 200000);
  assert.ok(g.result().score > 0, "bot should score");
  assert.ok(g.result().levelsCleared >= 5, "bot clears early levels");
  assert.ok(g.done, "bot run should end (clock)");
});

test("crates: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 30000);
    const r = replayGame(crates, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("crates: solving level 1 with the optimal pushes scores the full bonus", () => {
  const g = crates.create(1, CTX);
  // "#@ $ .#": right x3 pushes the crate onto the pad.
  for (let i = 0; i < 3; i++) press(g, BTN.RIGHT);
  const v = g.view();
  assert.equal(v.phase, "clear");
  assert.equal(v.pushes, v.optimal);
  assert.ok(v.score >= 50 + 25 + 10 + 200, "base + full efficiency bonus");
  for (let i = 0; i < 120; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().level, 1);
  assert.equal(g.result().levelsCleared, 1);
});

test("crates: walls block, undo restores and is limited", () => {
  const g = crates.create(1, CTX);
  press(g, BTN.LEFT); // wall
  assert.equal(g.view().moves, 0);
  press(g, BTN.RIGHT);
  press(g, BTN.RIGHT); // pushes the crate
  let v = g.view();
  assert.equal(v.pushes, 1);
  const crateAfter = v.crates[0].cell;
  press(g, BTN.ALT);
  for (let i = 0; i < 20; i++) g.step({ x: 0, y: 0, b: 0 }); // no double-tap
  v = g.view();
  assert.equal(v.pushes, 0);
  assert.equal(v.crates[0].cell, crateAfter - 1);
  assert.equal(v.undos, UNDOS - 1);
  // Spend every undo: walk left/right and undo, spaced out.
  for (let k = 0; k < UNDOS + 2; k++) {
    press(g, BTN.LEFT);
    press(g, BTN.ALT);
    for (let i = 0; i < 20; i++) g.step({ x: 0, y: 0, b: 0 });
  }
  v = g.view();
  assert.equal(v.undos, 0);
  assert.ok(v.moves > 1, "undos stopped working when used up");
});

test("crates: holding FIRE for a second restarts and costs points", () => {
  const g = crates.create(1, CTX);
  for (let i = 0; i < 3; i++) press(g, BTN.RIGHT);
  for (let i = 0; i < 120; i++) g.step({ x: 0, y: 0, b: 0 }); // level 2 loads
  const before = g.view();
  assert.equal(before.level, 1);
  press(g, DIR_BTN[0]);
  press(g, DIR_BTN[3]);
  assert.ok(g.view().moves > 0);
  for (let i = 0; i < RESTART_FR - 1; i++) g.step({ x: 0, y: 0, b: BTN.FIRE });
  assert.ok(g.view().moves > 0, "not yet");
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  const v = g.view();
  assert.equal(v.moves, 0);
  assert.equal(v.player, before.player);
  assert.equal(v.undos, UNDOS);
  assert.equal(v.score, before.score - RESTART_COST);
});

test("crates: running out of time ends the run", () => {
  const g = crates.create(1, CTX);
  const limit = g.view().timeLimit;
  for (let i = 0; i < limit + 5 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.result().status, "over");
});

test("crates: a perfect player clears every hand-made level, then gets generated ones", () => {
  const g = crates.create(5, CTX);
  let safety = 0;
  while (g.view().level < LEVELS.length + 2 && !g.done && safety++ < 200000) {
    const v = g.view();
    if (v.phase !== "play") {
      g.step({ x: 0, y: 0, b: 0 });
      continue;
    }
    assert.equal(v.timeLeft > 0, true);
    press(g, DIR_BTN[v.solution[v.path.length]]);
  }
  const v = g.view();
  assert.equal(v.level, LEVELS.length + 2);
  assert.ok(v.generated);
  assert.equal(g.result().levelsCleared, LEVELS.length + 2);
  assert.ok(v.solution.length > 0 && v.optimal > 0);
});
