import { test } from "node:test";
import assert from "node:assert/strict";
import { BEAR, BOARD_X, CELL, COLS, FourEngine, YOU, four, lineThrough, scoreMoves } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames = four.maxFrames) {
  const g = four.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = four.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("four: bot wins matches and the run ends", () => {
  let total = 0;
  for (const seed of [7, 8, 9]) {
    const { g } = botRun(seed);
    assert.ok(g.done, "run should end");
    total += g.result().score;
  }
  assert.ok(total > 0, "bot should score");
});

test("four: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed);
    const r = replayGame(four, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("four: search takes an immediate win and blocks an immediate loss", () => {
  const b = new Array(COLS * 6).fill(0);
  // Bear has three in the bottom row at columns 0..2; you have three stacked in column 6.
  for (const c of [0, 1, 2]) b[5 * COLS + c] = BEAR;
  for (const r of [5, 4, 3]) b[r * COLS + 6] = YOU;
  const bear = scoreMoves(b, BEAR, 4);
  const bestBear = Math.max(...bear.map((s) => s ?? -Infinity));
  assert.equal(bear.indexOf(bestBear), 3, "Bear completes its row");
  // Remove Bear's threat: now Bear must block column 6.
  b[5 * COLS + 2] = 0;
  const block = scoreMoves(b, BEAR, 4);
  const bestBlock = Math.max(...block.map((s) => s ?? -Infinity));
  assert.equal(block.indexOf(bestBlock), 6, "Bear blocks your column");
});

test("four: pointer aims, FIRE drops, full columns refuse, and four in a row wins with a highlight", () => {
  const g = new FourEngine(3);
  const step = (x: number, b = 0) => g.step({ x, y: 300, b });
  step(10);
  for (let i = 0; i < 90 && g.phase !== "turn"; i++) step(10);
  assert.equal(g.phase, "turn");
  step(BOARD_X + 5 * CELL + 20); // aim at column 5
  assert.equal(g.cursor, 5);
  step(BOARD_X + 5 * CELL + 20, BTN.LEFT); // nudge to 4
  assert.equal(g.cursor, 4);
  // A full column refuses the drop.
  for (let r = 0; r < 6; r++) g.board[r * COLS + 4] = r % 2 ? YOU : BEAR;
  step(BOARD_X + 5 * CELL + 20, BTN.FIRE);
  assert.equal(g.phase, "turn");
  assert.ok(g.events.some((e) => e.t === "full"));
  for (let r = 0; r < 6; r++) g.board[r * COLS + 4] = 0;
  // Rig the board: you have three on the bottom row, columns 0..2; drop into 3.
  for (const c of [0, 1, 2]) g.board[5 * COLS + c] = YOU;
  g.cursor = 3;
  step(BOARD_X + 5 * CELL + 20, 0);
  step(BOARD_X + 5 * CELL + 20, BTN.FIRE);
  assert.equal(g.phase, "drop");
  for (let i = 0; i < 200 && g.phase === "drop"; i++) step(BOARD_X + 5 * CELL + 20);
  assert.equal(g.phase, "end");
  assert.equal(g.outcome, "win");
  assert.deepEqual(g.winLine, [35, 36, 37, 38]);
  assert.ok(g.score >= 1000);
  assert.deepEqual(lineThrough(g.board, 38, YOU), [35, 36, 37, 38]);
});

test("four: a loss ends the run, a draw replays the same rung", () => {
  const g = new FourEngine(4);
  g.outcome = "draw";
  g.phase = "end";
  for (let i = 0; i < 200 && g.phase === "end"; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.level, 1);
  assert.equal(g.phase, "intro");
  assert.equal(g.youFirst, false, "the other side starts the replay");
  g.outcome = "lose";
  g.phase = "end";
  for (let i = 0; i < 200 && !g.done; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.result().status, "over");
});
