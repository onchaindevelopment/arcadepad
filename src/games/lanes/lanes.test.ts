import { test } from "node:test";
import assert from "node:assert/strict";
import { lanes, LanesEngine, TrackGen, rowGap, START_SPEED, MAX_SPEED, type Obstacle } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number, mash = false) {
  const g = lanes.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    let inp = lanes.bot!(g.view(), i);
    if (mash && i > 2000 && i % 89 < 4) inp = { x: 0, y: 0, b: [BTN.LEFT, BTN.RIGHT, BTN.UP, BTN.DOWN][i % 4] };
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("lanes: bot runs, collects coins and scores", () => {
  let best = 0;
  for (const seed of [7, 8, 9]) {
    const { g } = botRun(seed, 12000);
    const r = g.result();
    assert.ok(r.score > 0, "bot should score");
    best = Math.max(best, r.score);
  }
  assert.ok(best > 500, `bot should get well past the start, best ${best}`);
});

test("lanes: bot eventually crashes (attract mode ends)", () => {
  const { g } = botRun(11, lanes.maxFrames);
  assert.equal(g.result().status, "over");
  assert.ok(g.result().frames < lanes.maxFrames, "bot should crash before the time cap");
});

test("lanes: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000, true);
    const r = replayGame(lanes, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.frames > 0);
  }
});

test("lanes: every obstacle row leaves a passable lane, with reaction distance", () => {
  let rows = 0;
  for (const seed of [1, 2, 3, 4, 5]) {
    const gen = new TrackGen(seed);
    let prevZ = -Infinity;
    let speed = START_SPEED;
    let n = 0;
    while (n < 1000) {
      const c = gen.chunk(speed, true);
      for (const row of c.rows) {
        assert.equal(row.cells.length, 3);
        assert.ok(row.cells.some((k) => k !== "wall"), `seed ${seed}: row at ${row.z} is all walls`);
        assert.ok(row.z - prevZ >= rowGap(speed) - 1e-9, `seed ${seed}: rows too close at ${row.z}`);
        prevZ = row.z;
        n++;
      }
      // Long walls never overlap another obstacle in the same lane.
      const walls = c.obstacles.filter((o) => o.kind === "wall" || o.kind === "ramp");
      for (const w of walls) {
        for (const o of c.obstacles) if (o !== w && o.lane === w.lane) assert.ok(o.z1 < w.z || o.z > w.z1, "obstacle inside a wall");
      }
      speed = Math.min(0.6, speed + (MAX_SPEED - START_SPEED) / 300);
    }
    rows += n;
  }
  assert.ok(rows >= 5000);
});

function scripted(obstacles: Omit<Obstacle, "id">[]) {
  return new LanesEngine(1, { track: { obstacles: obstacles.map((o, i) => ({ ...o, id: i + 1 })) } });
}
/** Run until the player is `lead` units in front of z, pressing nothing. */
function runTo(g: LanesEngine, z: number) {
  while (!g.done && g.dist + 0.3 < z) g.step({ x: 0, y: 0, b: 0 });
}
function runFrames(g: LanesEngine, n: number, b = 0) {
  for (let i = 0; i < n && !g.done; i++) g.step({ x: 0, y: 0, b: i === 0 ? b : 0 });
}

test("lanes: a low hurdle kills when run into, but can be jumped or rolled under", () => {
  const hurdle = [{ lane: 1, z: 20, z1: 20.4, kind: "low" as const }];
  const idle = scripted(hurdle);
  runFrames(idle, 300);
  assert.equal(idle.result().status, "over");

  const jumper = scripted(hurdle);
  runTo(jumper, 20 - 3); // ~14 frames before contact at start speed
  runFrames(jumper, 300, BTN.UP);
  assert.equal(jumper.result().status, "playing");
  assert.ok(jumper.dist > 25);

  const roller = scripted(hurdle);
  runTo(roller, 20 - 1);
  runFrames(roller, 300, BTN.DOWN);
  assert.equal(roller.result().status, "playing");
});

test("lanes: a high sign must be rolled under; jumping into it crashes", () => {
  const sign = [{ lane: 1, z: 20, z1: 20.4, kind: "high" as const }];
  const jumper = scripted(sign);
  runTo(jumper, 20 - 1.5);
  runFrames(jumper, 300, BTN.UP);
  assert.equal(jumper.result().status, "over");

  const roller = scripted(sign);
  runTo(roller, 20 - 1);
  runFrames(roller, 300, BTN.DOWN);
  assert.equal(roller.result().status, "playing");
});

test("lanes: walls block lane changes from the side; ramps can be run along", () => {
  const g = scripted([
    { lane: 1, z: 20, z1: 40, kind: "wall" },
    { lane: 0, z: 5, z1: 60, kind: "wall" },
  ]);
  runTo(g, 10);
  g.step({ x: 0, y: 0, b: BTN.LEFT }); // lane 0 is a wall beside us: bump
  assert.equal(g.lane, 1);
  assert.ok(g.events.some((e) => e.t === "bump"));
  g.step({ x: 0, y: 0, b: 0 });
  g.step({ x: 0, y: 0, b: BTN.RIGHT });
  assert.equal(g.lane, 2);
  runFrames(g, 300);
  assert.equal(g.result().status, "playing");

  const r = scripted([{ lane: 1, z: 20, z1: 40, kind: "ramp" }]);
  runTo(r, 30);
  assert.equal(r.result().status, "playing");
  assert.ok(r.y > 1.5, `should be on top of the ramp wall, y=${r.y}`);
  runFrames(r, 300);
  assert.equal(r.result().status, "playing");
  assert.equal(r.y, 0);

  const w = scripted([{ lane: 1, z: 20, z1: 40, kind: "wall" }]);
  runFrames(w, 300);
  assert.equal(w.result().status, "over");
});
