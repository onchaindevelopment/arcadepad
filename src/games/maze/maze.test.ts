import { test } from "node:test";
import assert from "node:assert/strict";
import { maze, MAZES, COLS, ROWS, isOpen, wrapC, enemyPoints, type MazeView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = maze.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = maze.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("maze: bot collects coins and scores", () => {
  const { g } = botRun(7, 8000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("maze: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(maze, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("maze: every layout is 28x20, connected, has no dead ends, 4 vents and power coins", () => {
  for (const m of MAZES) {
    assert.equal(m.grid.length, ROWS, m.name);
    for (const row of m.grid) assert.equal(row.length, COLS, m.name);
    assert.equal(m.vents.length, 4, m.name);
    assert.ok(isOpen(m.grid, m.start[0], m.start[1]), `${m.name} start`);
    assert.ok(m.grid.join("").split("o").length - 1 >= 4, `${m.name} power coins`);
    let total = 0;
    let first = -1;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!isOpen(m.grid, c, r)) continue;
        total++;
        if (first < 0) first = r * COLS + c;
        let n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (isOpen(m.grid, c + dx, r + dy)) n++;
        assert.ok(n >= 2, `${m.name} dead end at ${c},${r}`);
      }
    const seen = new Set([first]);
    const q = [first];
    while (q.length) {
      const cur = q.pop()!;
      const c = cur % COLS;
      const r = (cur - c) / COLS;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nc = wrapC(c + dx);
        const nr = r + dy;
        if (!isOpen(m.grid, nc, nr) || seen.has(nr * COLS + nc)) continue;
        seen.add(nr * COLS + nc);
        q.push(nr * COLS + nc);
      }
    }
    assert.equal(seen.size, total, `${m.name} connected`);
  }
});

test("maze: an early turn is buffered until the next gap, and coins score 10", () => {
  // Order Book: start (13,10); the first gap upwards to the left is column 12.
  const g = maze.create(9, CTX);
  const press = (b: number) => {
    g.step({ x: 0, y: 0, b });
    g.step({ x: 0, y: 0, b: 0 });
  };
  press(BTN.LEFT);
  let v: MazeView = g.view();
  while (v.phase === "ready") {
    g.step({ x: 0, y: 0, b: 0 });
    v = g.view();
  }
  g.step({ x: 0, y: 0, b: 0 }); // start moving left
  assert.equal(g.view().player.dir, 3);
  press(BTN.UP); // early: (13,9) is wall, so the turn must wait for column 12
  for (let i = 0; i < 60 && g.view().player.r === 10; i++) g.step({ x: 0, y: 0, b: 0 });
  v = g.view();
  assert.equal(v.player.c, 12);
  assert.equal(v.player.dir, 0);
  assert.ok(v.score >= 10 && v.score % 10 === 0);
});

test("maze: idling loses all 3 lives, combo points double", () => {
  const g = maze.create(4, CTX);
  let lost = 0;
  for (let i = 0; i < 20000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) if (e.t === "die") lost++;
  }
  assert.equal(lost, 3);
  assert.equal(g.result().status, "over");
  assert.deepEqual([0, 1, 2, 3, 4].map(enemyPoints), [200, 400, 800, 1600, 1600]);
});
