import { test } from "node:test";
import assert from "node:assert/strict";
import { bomber, BomberEngine, BOMB_T, CLOSE_EVERY, CLOSE_ORDER, HURRY_AT, COLS, CRATE, EMPTY, PILLAR, INTRO_T, dangerMap, escapeRoute, framesPerCell, type PlanBoard } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = bomber.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = bomber.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const idle: Input = { x: 0, y: 0, b: 0 };

/** Engine in play phase with frozen rivals and an empty board. */
function sandbox() {
  const g = new BomberEngine(1);
  g.freezeBots = true;
  for (let i = 0; i < INTRO_T; i++) g.step(idle);
  assert.equal(g.phase, "play");
  for (let i = 0; i < g.grid.length; i++) if (g.grid[i] !== PILLAR) g.grid[i] = EMPTY;
  g.hidden.fill(0);
  return g;
}

test("bomber: bot plays, scores and the run ends", () => {
  const { g } = botRun(7, bomber.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.equal(r.status, "over", "attract runs must end");
});

test("bomber: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000);
    const r = replayGame(bomber, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("bomber: bomb explodes after 2.5 s in a + shape, pillars stop it, crates break", () => {
  const g = sandbox();
  const me = g.actors[0];
  // Player at (0,0). Crate two cells right, pillar below-right is at (1,1).
  g.grid[2] = CRATE;
  g.grid[3] = CRATE;
  me.power = 3;
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  assert.equal(g.bombs.length, 1);
  // Walk away down two cells, then right one (around the pillar at (1,1)) out of the blast.
  me.c = 2; me.r = 2; me.tc = 2; me.tr = 2; // teleport to safety (column 2 row 2 is out of the + from (0,0))
  for (let i = 1; i < BOMB_T; i++) g.step(idle);
  assert.equal(g.bombs.length, 1, "not yet");
  g.step(idle);
  assert.equal(g.bombs.length, 0, "exploded at 150 frames");
  assert.ok(g.flame[0] > 0 && g.flame[1] > 0 && g.flame[COLS] > 0 && g.flame[2 * COLS] > 0, "+ shape");
  assert.ok(g.flame[2] > 0, "crate cell burns");
  assert.equal(g.flame[3], 0, "blast stops at the first crate");
  assert.equal(g.flame[COLS + 1], 0, "pillar never burns");
  assert.equal(g.score, 10, "crate scored");
  assert.ok(me.alive, "player outside the blast survives");
});

test("bomber: chain reaction and getting caught ends the round", () => {
  const g = sandbox();
  const me = g.actors[0];
  // Two bombs: player's at (0,0); a rival bomb at (0,1) with a long fuse gets chained.
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  g.bombs.push({ id: 99, c: 0, r: 1, owner: 1, timer: 999, power: 2, done: false });
  for (let i = 0; i < BOMB_T && g.phase === "play"; i++) g.step(idle);
  assert.equal(g.bombs.length, 0, "chained bomb went off too");
  assert.ok(g.flame[3 * COLS] > 0, "chained blast reaches (0,3)");
  assert.equal(me.alive, false, "player standing on the bomb is out");
  assert.equal(g.phase, "roundEnd");
  assert.ok(g.roundWinner > 0, "a rival takes the round");
});

test("bomber: planner finds an escape off its own bomb", () => {
  const grid = new Array(COLS * 11).fill(EMPTY);
  for (let r = 0; r < 11; r++) for (let c = 0; c < COLS; c++) if (c % 2 === 1 && r % 2 === 1) grid[r * COLS + c] = PILLAR;
  const b: PlanBoard = {
    grid,
    flame: new Array(grid.length).fill(0),
    item: new Array(grid.length).fill(0),
    bombs: [{ c: 2, r: 0, timer: BOMB_T, power: 2 }],
    actors: [{ alive: true, c: 2, r: 0, power: 2, bombsLeft: 0, speed: 7 }],
  };
  const dg = dangerMap(b, null);
  const e = escapeRoute(b, 2, dg, framesPerCell(7), 0);
  assert.ok(e && e.dir >= 0, "escape exists");
  assert.equal(e!.dist, 3, "pillars block (2,1) sideways; nearest safe cell is three steps away");
});

test("bomber: sudden death walls close in from the corner and crush whoever stands there", () => {
  const g = sandbox();
  assert.equal(CLOSE_ORDER[0], 0, "first wall drops on the top-left corner");
  while (g.roundT < HURRY_AT + CLOSE_EVERY && g.phase === "play") g.step(idle);
  assert.equal(g.grid[0], PILLAR);
  assert.equal(g.actors[0].alive, false);
  assert.equal(g.phase, "roundEnd");
});
