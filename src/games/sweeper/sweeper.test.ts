import { test } from "node:test";
import assert from "node:assert/strict";
import { sweeper, layoutFor, HIDDEN, FLAG, LONG_PRESS, LADDER, type SweeperView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = sweeper.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = sweeper.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const centre = (cell: number, board = 0) => {
  const L = layoutFor(board);
  return { x: L.x0 + (cell % L.cols) * L.cell + (L.cell >> 1), y: L.y0 + Math.floor(cell / L.cols) * L.cell + (L.cell >> 1) };
};

function tap(g: GameEngine<SweeperView>, cell: number, hold = 1) {
  const at = centre(cell, g.view().board);
  g.step({ ...at, b: 0 });
  for (let i = 0; i < hold; i++) g.step({ ...at, b: BTN.FIRE });
  g.step({ ...at, b: 0 });
}

test("sweeper: bot reveals and scores, runs end", () => {
  let ended = 0;
  for (const seed of [11, 12, 13, 14]) {
    const { g } = botRun(seed, 60000);
    assert.ok(g.result().score > 0, `bot should score (seed ${seed})`);
    if (g.done) ended++;
  }
  assert.ok(ended >= 3, "most bot runs should end");
});

test("sweeper: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 20000);
    const r = replayGame(sweeper, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("sweeper: first tap is safe and opens an area", () => {
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const g = sweeper.create(seed, { ticker: "TEST" });
    const first = 0; // a corner: its whole neighbourhood is rug-free, so it's a zero
    tap(g, first);
    const v = g.view();
    assert.equal(v.phase, "play");
    assert.equal(v.vis[first], 0);
    assert.ok(v.revealed >= 4, "a zero opens its neighbours");
    assert.equal(v.score, v.revealed * 5);
  }
});

test("sweeper: long press flags, short tap on a flag does nothing, flag toggles off", () => {
  const g = sweeper.create(3, { ticker: "TEST" });
  tap(g, 40); // centre of 9x9
  const v = g.view();
  const hidden = Array.from(v.vis).findIndex((s) => s === HIDDEN);
  assert.ok(hidden >= 0);
  tap(g, hidden, LONG_PRESS + 2);
  assert.equal(g.view().vis[hidden], FLAG);
  assert.equal(g.view().flags, 1);
  tap(g, hidden, 1);
  assert.equal(g.view().vis[hidden], FLAG, "tap on a flag must not reveal");
  // ALT toggles it off again
  const at = centre(hidden);
  g.step({ ...at, b: BTN.ALT });
  g.step({ ...at, b: 0 });
  assert.equal(g.view().vis[hidden], HIDDEN);
});

test("sweeper: revealing a rug ends the run; clearing all safe tiles advances", () => {
  // Find the rugs by peeking at a twin engine (same seed and first tap).
  const seed = 9;
  const probe = sweeper.create(seed, { ticker: "TEST" }) as unknown as { rug: Uint8Array };
  const g1 = probe as unknown as GameEngine<SweeperView>;
  tap(g1, 40);
  const rugs = probe.rug;

  const dead = sweeper.create(seed, { ticker: "TEST" });
  tap(dead, 40);
  tap(dead, rugs.indexOf(1));
  assert.equal(dead.view().phase, "dead");
  for (let i = 0; i < 200 && !dead.done; i++) dead.step({ x: 0, y: 0, b: 0 });
  assert.equal(dead.result().status, "over");
  assert.equal(dead.result().levelsCleared, 0);

  const win = sweeper.create(seed, { ticker: "TEST" });
  tap(win, 40);
  for (let i = 0; i < rugs.length; i++) if (!rugs[i] && win.view().vis[i] === HIDDEN) tap(win, i);
  assert.equal(win.view().phase, "clear");
  assert.equal(win.result().levelsCleared, 1);
  assert.ok(win.result().score >= (81 - 10) * 5 + LADDER[0].bonus);
  for (let i = 0; i < 200; i++) win.step({ x: 0, y: 0, b: 0 });
  assert.equal(win.view().board, 1);
  assert.equal(win.view().phase, "play");
});

test("sweeper: chord reveals around a satisfied number", () => {
  const seed = 21;
  const g = sweeper.create(seed, { ticker: "TEST" }) as unknown as GameEngine<SweeperView> & { rug: Uint8Array };
  tap(g, 40);
  const v = g.view();
  const { cols, rows } = v.layout;
  const nbs = (i: number) => {
    const out: number[] = [];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      const c = (i % cols) + dc, r = Math.floor(i / cols) + dr;
      if ((dr || dc) && c >= 0 && c < cols && r >= 0 && r < rows) out.push(r * cols + c);
    }
    return out;
  };
  // A revealed number with at least one hidden safe neighbour.
  const num = Array.from(v.vis).findIndex((s, i) => s > 0 && s <= 8 && nbs(i).some((k) => v.vis[k] === HIDDEN && !g.rug[k]));
  assert.ok(num >= 0, "board should have a chordable number");
  for (const k of nbs(num)) if (g.rug[k]) {
    const at = centre(k);
    g.step({ ...at, b: BTN.ALT });
    g.step({ ...at, b: 0 });
  }
  const before = g.view().revealed;
  tap(g, num);
  assert.ok(g.view().revealed > before);
  for (const k of nbs(num)) assert.notEqual(g.view().vis[k], HIDDEN);
});
