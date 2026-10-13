import { test } from "node:test";
import assert from "node:assert/strict";
import { blocks, COLS, ROWS } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = blocks.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = blocks.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const idle = { x: 0, y: 0, b: 0 };

test("blocks: bot clears rows and scores", () => {
  const { g } = botRun(7, 8000);
  const v = g.view();
  assert.ok(v.lines >= 4, `bot should clear rows (got ${v.lines})`);
  assert.ok(g.result().score > 0);
});

test("blocks: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 5000);
    const r = replayGame(blocks, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("blocks: bag deals all nine clusters before repeating", () => {
  const g = blocks.create(11, CTX);
  const seen: number[] = [g.view().piece!.kind];
  for (let i = 0; seen.length < 9 && i < 2000; i++) {
    const before = g.view().pieceId;
    g.step({ x: 0, y: 0, b: i & 1 ? 0 : BTN.FIRE });
    const v = g.view();
    if (v.piece && v.pieceId !== before) seen.push(v.piece.kind);
  }
  assert.deepEqual([...seen].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
});

test("blocks: a full row pops, scores and the stack falls", () => {
  const g = blocks.create(3, CTX);
  // Build an almost-full bottom row via the engine's private board, then drop a cluster into the gap.
  const eng = g as unknown as { board: Uint8Array; kind: number; rot: number; px: number; py: number };
  for (let c = 0; c < COLS; c++) eng.board[(ROWS - 1) * COLS + c] = 2;
  eng.board[(ROWS - 2) * COLS + 0] = 3; // a coin above that must fall one row
  // Leave a 3-wide gap at columns 4..6 and use the straight three (kind 8).
  for (const c of [4, 5, 6]) eng.board[(ROWS - 1) * COLS + c] = 0;
  eng.kind = 8;
  eng.rot = 0;
  eng.px = 4;
  eng.py = 0;
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  const clear = g.events.find((e) => e.t === "clear");
  assert.ok(clear, "row should clear");
  assert.equal(clear!.count, 1);
  assert.equal(g.result().score, 100 + 2 * (ROWS - 2));
  for (let i = 0; i < 30; i++) g.step(idle);
  const v = g.view();
  for (let c = 1; c < COLS; c++) assert.equal(v.board[(ROWS - 1) * COLS + c], 0);
  assert.equal(v.board[(ROWS - 1) * COLS + 0], 3, "coin above dropped into the cleared row");
});

test("blocks: blocked moves bump, auto-repeat slides after a delay", () => {
  const g = blocks.create(4, CTX);
  const x0 = g.view().piece!.x;
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  assert.equal(g.view().piece!.x, x0 - 1);
  for (let i = 0; i < 9; i++) g.step({ x: 0, y: 0, b: BTN.LEFT });
  assert.equal(g.view().piece!.x, x0 - 1, "no repeat before the delay");
  let bumped = false;
  for (let i = 0; i < 40; i++) {
    g.step({ x: 0, y: 0, b: BTN.LEFT });
    if (g.events.some((e) => e.t === "bump")) bumped = true;
  }
  assert.ok(g.view().piece!.cells.some(([c]) => c === 0), "slid to the wall");
  assert.equal(bumped, false, "held auto-repeat into the wall stays silent");
  g.step(idle);
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  assert.ok(g.events.some((e) => e.t === "bump" && e.sfx === "wall"));
});

test("blocks: game over when the jar is full", () => {
  const g = blocks.create(9, CTX);
  for (let i = 0; i < 4000 && !g.done; i++) g.step({ x: 0, y: 0, b: i & 1 ? 0 : BTN.FIRE });
  assert.equal(g.result().status, "over");
  assert.ok(g.events.some((e) => e.t === "gameover" && e.sfx === "gameover"));
});
