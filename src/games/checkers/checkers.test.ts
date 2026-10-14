import { test } from "node:test";
import assert from "node:assert/strict";
import { BEAR, CheckersEngine, KING, N, YOU, applyMove, checkers, genMoves, scoreMoves, sq } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames = checkers.maxFrames) {
  const g = checkers.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = checkers.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("checkers: bot wins matches and scores", () => {
  let total = 0;
  for (const seed of [7, 8]) {
    const { g } = botRun(seed, 40000);
    total += g.result().score;
  }
  assert.ok(total > 0, "bot should score");
});

test("checkers: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 15000);
    const r = replayGame(checkers, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("checkers: opening has 7 moves and captures are forced", () => {
  const b = new Array(N * N).fill(0);
  assert.equal(genMoves(new CheckersEngine(1).board, YOU).length, 7);
  b[sq(5, 2)] = YOU;
  b[sq(4, 3)] = BEAR;
  b[sq(6, 7)] = YOU; // could slide, but the capture is forced
  const m = genMoves(b, YOU);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0], { from: sq(5, 2), path: [sq(3, 4)], caps: [sq(4, 3)] });
});

test("checkers: multi-jumps chain, and reaching the far row crowns and ends the move", () => {
  const b = new Array(N * N).fill(0);
  b[sq(6, 1)] = YOU;
  b[sq(5, 2)] = BEAR;
  b[sq(3, 4)] = BEAR;
  b[sq(1, 4)] = BEAR;
  const m = genMoves(b, YOU);
  assert.equal(m.length, 1);
  assert.deepEqual(m[0].path, [sq(4, 3), sq(2, 5), sq(0, 3)]);
  const nb = Int8Array.from(b);
  assert.equal(applyMove(nb, m[0]), true);
  assert.equal(nb[sq(0, 3)], YOU + KING);
  assert.equal(nb[sq(5, 2)] + nb[sq(3, 4)] + nb[sq(1, 4)], 0);
  // A man crowned mid-jump stops even if a king could jump on.
  const c = new Array(N * N).fill(0);
  c[sq(2, 1)] = YOU;
  c[sq(1, 2)] = BEAR;
  c[sq(1, 4)] = BEAR;
  const cm = genMoves(c, YOU);
  assert.equal(cm.length, 1);
  assert.deepEqual(cm[0].path, [sq(0, 3)]);
});

test("checkers: the Bear avoids hanging a piece; its captures are forced too", () => {
  const b = new Array(N * N).fill(0);
  b[sq(2, 3)] = BEAR;
  b[sq(5, 0)] = BEAR;
  b[sq(4, 3)] = YOU;
  b[sq(7, 6)] = YOU;
  const { moves, scores } = scoreMoves(b, BEAR, 3);
  const best = moves[scores.indexOf(Math.max(...scores))];
  // Both steps from (2,3) walk into a jump, so the safe move is the other man.
  assert.equal(best.from, sq(5, 0));
  b[sq(3, 2)] = YOU;
  const forced = genMoves(b, BEAR);
  assert.ok(forced.every((m) => m.caps.length > 0));
});

test("checkers: tap a coin then a square to move; ALT cancels", () => {
  const g = new CheckersEngine(4);
  let x = 1, y = 1;
  const step = (b = 0) => g.step({ x, y, b });
  const tap = (s: number) => {
    x = CheckersEngine.cx(s); y = CheckersEngine.cy(s);
    step(BTN.FIRE);
    step();
  };
  for (let i = 0; i < 100 && g.phase !== "turn"; i++) step();
  assert.equal(g.phase, "turn");
  tap(sq(5, 2));
  assert.equal(g.selected, sq(5, 2));
  assert.deepEqual(g.view().dests.sort(), [sq(4, 1), sq(4, 3)].sort());
  g.step({ x, y, b: BTN.ALT });
  step();
  assert.equal(g.selected, -1);
  tap(sq(5, 2));
  tap(sq(4, 3));
  for (let i = 0; i < 30 && (g.phase as string) === "anim"; i++) step();
  assert.equal(g.board[sq(4, 3)], YOU);
  assert.equal(g.board[sq(5, 2)], 0);
  assert.equal(g.yourMoves, 1);
});
