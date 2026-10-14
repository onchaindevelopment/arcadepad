import { test } from "node:test";
import assert from "node:assert/strict";
import { digger, DiggerEngine, generateCave, reach, caveSpec, COLS, COIN, EMPTY, GHOST, PLAYER, ROCK, BOOM, START_LIVES } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = digger.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = digger.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const idle: Input = { x: 0, y: 0, b: 0 };
const idx = (c: number, r: number) => r * COLS + c;

test("digger: bot digs, scores and the run ends", () => {
  const { g } = botRun(7, digger.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.notEqual(r.status, "playing", "attract runs must end");
});

test("digger: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 12000);
    const r = replayGame(digger, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("digger: every generated cave has a dug route to the exit and enough coins", () => {
  for (let seed = 1; seed <= 60; seed++) {
    for (const level of [0, 3, 7]) {
      const cave = generateCave(seed * 7919, level);
      const seen = reach(cave.grid, cave.start, cave.exit);
      assert.ok(seen[cave.exit], `exit reachable (seed ${seed}, level ${level})`);
      let coins = 0;
      for (let i = 0; i < seen.length; i++) if (seen[i] && cave.grid[i] === COIN) coins++;
      assert.ok(coins >= caveSpec(level).need, `enough coins (seed ${seed}, level ${level})`);
    }
  }
});

test("digger: a falling rock on the mascot costs a life", () => {
  const g = new DiggerEngine(1);
  g.loadMap([
    "#####",
    "#.o.#",
    "#. .#",
    "#. .#",
    "#.P.#",
    "#####",
  ]);
  for (let i = 0; i < 200 && g.phase === "play"; i++) g.step(idle);
  assert.equal(g.phase, "dead");
  assert.equal(g.lives, START_LIVES - 1);
});

test("digger: a resting rock does not hurt; stepping out lets it drop", () => {
  const g = new DiggerEngine(1);
  g.loadMap([
    "#####",
    "#.o.#",
    "#.P.#",
    "#####",
  ]);
  for (let i = 0; i < 60; i++) g.step(idle);
  assert.equal(g.phase, "play");
  for (let i = 0; i < 20; i++) g.step({ x: 0, y: 0, b: BTN.RIGHT });
  for (let i = 0; i < 30; i++) g.step(idle);
  assert.equal(g.phase, "play");
  assert.equal(g.grid[idx(2, 2)], ROCK, "rock fell into the vacated cell");
});

test("digger: rocks roll off rounded things", () => {
  const g = new DiggerEngine(1);
  g.loadMap([
    "######",
    "#.o ##",
    "#.o ##",
    "#.. ##",
    "#.P..#",
    "######",
  ]);
  for (let i = 0; i < 60; i++) g.step(idle);
  assert.equal(g.grid[idx(3, 3)], ROCK, "top rock rolled right and fell");
});

test("digger: pushing a rock needs space behind it", () => {
  const g = new DiggerEngine(1);
  g.loadMap([
    "#######",
    "#.....#",
    "#.Po .#",
    "#######",
  ]);
  for (let i = 0; i < 40; i++) g.step({ x: 0, y: 0, b: BTN.RIGHT });
  assert.equal(g.grid[idx(4, 2)], ROCK, "rock pushed one cell");
  assert.equal(g.grid[idx(3, 2)], PLAYER);
  for (let i = 0; i < 40; i++) g.step({ x: 0, y: 0, b: BTN.RIGHT });
  assert.equal(g.grid[idx(4, 2)], ROCK, "no space behind: rock stays");
  assert.equal(g.grid[idx(3, 2)], PLAYER);
});

test("digger: a crushed ghost bursts into coins", () => {
  const g = new DiggerEngine(1);
  g.loadMap([
    "#########",
    "#....o..#",
    "#.... ..#",
    "#.... ..#",
    "#....G..#",
    "#.......#",
    "#P......#",
    "#########",
  ]);
  for (let i = 0; i < 120; i++) g.step(idle);
  let coins = 0;
  for (let i = 0; i < g.grid.length; i++) if (g.grid[i] === COIN) coins++;
  assert.ok(coins >= 5, "explosion left coins");
  assert.equal(g.grid.indexOf(GHOST), -1);
  assert.equal(g.grid.indexOf(BOOM), -1);
  assert.ok(g.score >= 150);
});

test("digger: collecting the quota opens the exit and clears the cave", () => {
  const g = new DiggerEngine(1);
  g.loadMap([
    "#######",
    "#P$$.E#",
    "#######",
  ]);
  g.need = 2;
  for (let i = 0; i < 80 && g.phase === "play"; i++) g.step({ x: 0, y: 0, b: BTN.RIGHT });
  assert.equal(g.coins, 2);
  assert.ok(g.exitOpen);
  assert.equal(g.phase, "clear");
  assert.equal(g.levelsCleared, 1);
  assert.equal(g.grid[idx(4, 1)], EMPTY);
});
