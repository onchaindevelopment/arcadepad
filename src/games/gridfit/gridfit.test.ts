import { test } from "node:test";
import assert from "node:assert/strict";
import {
  gridfit, GridFitEngine, SHAPES, N, clearPoints, dropPoint, fullGroups, slotCenter, canPlaceAnywhere,
} from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const shapeIdx = (pattern: string) => {
  const rows = pattern.split("/");
  const i = SHAPES.findIndex((s) => s.h === rows.length && s.w === rows[0].length &&
    s.cells.length === [...pattern].filter((c) => c === "#").length &&
    s.cells.every(([c, r]) => rows[r][c] === "#"));
  assert.ok(i >= 0, `shape ${pattern}`);
  return i;
};
const DOT = shapeIdx("#");
const I3 = shapeIdx("###");
const SQ = shapeIdx("##/##");

function botRun(seed: number, frames: number) {
  const g = gridfit.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = gridfit.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

/** Drag tray[slot] onto anchor (c, r) with the pointer. */
function dragTo(g: GridFitEngine, slot: number, c: number, r: number) {
  const s = slotCenter(slot);
  const piece = g.tray[slot]!;
  const t = dropPoint(piece, c, r);
  g.step({ x: s.x, y: s.y, b: 0 });
  g.step({ x: s.x, y: s.y, b: BTN.FIRE });
  g.step({ x: t.x, y: t.y, b: BTN.FIRE });
  g.step({ x: t.x, y: t.y, b: 0 });
}

test("gridfit: bot scores and plays to game over", () => {
  const { g } = botRun(7, gridfit.maxFrames);
  assert.ok(g.result().score > 0, "bot should score");
  assert.ok(g.done, "bot run should end");
  assert.equal(g.result().status, "over");
});

test("gridfit: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, gridfit.maxFrames);
    const r = replayGame(gridfit, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.frames > 0);
  }
});

test("gridfit: a full row clears and scores", () => {
  const board = new Array(N * N).fill(0);
  for (let c = 0; c < 6; c++) board[4 * N + c] = 1; // row 4, cols 0-5
  const g = new GridFitEngine(1, board, [I3, DOT, DOT]);
  dragTo(g, 0, 6, 4);
  const clear = g.events.find((e) => e.t === "clear");
  assert.ok(clear, "row should clear");
  assert.deepEqual(clear!.groups, [4]);
  assert.ok(g.board.every((v) => v === 0));
  // 3 for the cells + one group at streak 1 + all-clear bonus
  assert.equal(g.result().score, 3 + clearPoints(1, 1) + 300);
});

test("gridfit: a 3x3 box clears (and a column at the same time counts double)", () => {
  const board = new Array(N * N).fill(0);
  // Box 4 (rows 3-5, cols 3-5) full except (3,3),(4,3),(3,4),(4,4)
  for (let r = 3; r < 6; r++) for (let c = 3; c < 6; c++) board[r * N + c] = 2;
  for (const [c, r] of [[3, 3], [4, 3], [3, 4], [4, 4]]) board[r * N + c] = 0;
  // Column 3 full except rows 3 and 4
  for (let r = 0; r < N; r++) if (r !== 3 && r !== 4) board[r * N + 3] = 3;
  board[8 * N + 8] = 5; // keep the board from becoming empty
  const g = new GridFitEngine(2, board, [SQ, DOT, DOT]);
  dragTo(g, 0, 3, 3);
  const clear = g.events.find((e) => e.t === "clear");
  assert.ok(clear);
  assert.deepEqual([...(clear!.groups as number[])].sort((a, b) => a - b), [12, 22]); // column 3, box 4
  assert.equal(fullGroups(g.board).length, 0);
  assert.equal(g.board[8 * N + 8], 5);
  assert.equal(g.result().score, 4 + clearPoints(2, 1));
});

test("gridfit: a drop that does not fit returns the piece", () => {
  const board = new Array(N * N).fill(0);
  board[0] = 1;
  const g = new GridFitEngine(3, board, [SQ, DOT, DOT]);
  dragTo(g, 0, 0, 0);
  assert.ok(g.events.some((e) => e.t === "return"));
  assert.ok(g.tray[0], "piece is back in the tray");
  assert.equal(g.result().score, 0);
});

test("gridfit: keyboard select, move ghost and place", () => {
  const g = new GridFitEngine(4, undefined, [I3, SQ, DOT]);
  const press = (b: number) => { g.step({ x: 0, y: 0, b }); g.step({ x: 0, y: 0, b: 0 }); };
  press(BTN.RIGHT); // select first available (slot 0)
  press(BTN.RIGHT); // -> slot 1 (square)
  press(BTN.FIRE); // lift: ghost at centre (3,3)
  press(BTN.LEFT);
  press(BTN.LEFT);
  press(BTN.LEFT);
  press(BTN.UP);
  press(BTN.FIRE);
  assert.equal(g.tray[1], null);
  for (const i of [2 * N, 2 * N + 1, 3 * N, 3 * N + 1]) assert.ok(g.board[i] !== 0, `cell ${i}`);
});

test("gridfit: tap a piece, then tap a cell", () => {
  const g = new GridFitEngine(5, undefined, [DOT, I3, DOT]);
  const s = slotCenter(2);
  g.step({ x: s.x, y: s.y, b: BTN.FIRE });
  g.step({ x: s.x, y: s.y, b: 0 });
  assert.equal(g.view().sel, 2);
  const tx = 18 + 7 * 36 + 18, ty = 80 + 1 * 36 + 18; // cell (7,1)
  g.step({ x: tx, y: ty, b: BTN.FIRE });
  assert.ok(g.board[1 * N + 7] !== 0);
  assert.equal(g.tray[2], null);
});

test("gridfit: game over when no offered piece fits; deals are fair", () => {
  // Checkerboard-ish board: only single holes, no two adjacent empties.
  const board = new Array(N * N).fill(0).map((_, i) => ((i % N) + Math.floor(i / N)) % 2 === 0 ? 1 : 0);
  board[1] = 1;
  const g = new GridFitEngine(6, board, [I3, SQ]);
  assert.ok(g.done, "no offered piece fits");
  assert.equal(g.result().status, "over");
  // Fairness: a fresh deal on a board where only the dot fits always offers a dot.
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const e = new GridFitEngine(seed, board);
    assert.ok(e.tray.some((t) => t && canPlaceAnywhere(board, SHAPES[t.shape])), `seed ${seed}`);
    assert.equal(e.done, false);
  }
});
