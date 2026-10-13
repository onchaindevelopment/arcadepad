import { test } from "node:test";
import assert from "node:assert/strict";
import { Cave, GAP_MIN, H, HIT_NONE, PASS_MIN, PLAYER_X, START_Y, cave, speedAt, stepBody } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = cave.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = cave.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("cave: bot flies, collects and scores", () => {
  const { g } = botRun(7, cave.maxFrames);
  assert.ok(g.result().score > 0, "bot should score");
  assert.ok(g.view().metres > 100, "bot should get some distance");
});

test("cave: bot eventually crashes (attract mode ends)", () => {
  for (const seed of [3, 4]) {
    const { g } = botRun(seed, cave.maxFrames);
    assert.equal(g.result().status, "over");
  }
});

test("cave: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000);
    const r = replayGame(cave, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("cave: waits until thrust or 3 s; never thrusting falls into the floor", () => {
  const g = cave.create(9, { ticker: "TEST" });
  for (let i = 0; i < 170; i++) g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().state, "ready");
  assert.equal(g.view().dist, 0);
  const events: { t: string; side?: unknown }[] = [];
  for (let i = 0; i < 2000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) events.push(e);
  }
  assert.equal(g.result().status, "over");
  const crash = events.find((e) => e.t === "crash");
  assert.ok(crash, "crashed");
  assert.equal(crash.side, "floor");
  assert.ok(g.view().y > START_Y, "fell down");
  assert.deepEqual(events.slice(-3).map((e) => e.t), ["crash", "lost", "gameover"]);
});

test("cave: always thrusting hits the ceiling; score = metres + 25 per coin", () => {
  const g = cave.create(9, { ticker: "TEST" });
  let side: unknown;
  for (let i = 0; i < 2000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: BTN.UP });
    for (const e of g.events) if (e.t === "crash") side = e.side;
  }
  assert.equal(side, "ceiling");
  const v = g.view();
  assert.equal(g.result().score, v.metres + v.coins * 25);
});

test("cave: generated tunnels respect the gap and slope limits", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const c = new Cave(seed);
    let prevMid = H / 2;
    for (let x = 0; x < 80000; x += 4000) {
      c.ensure(x + 4000);
      for (let k = 0; k < c.tops.length; k++) {
        const wx = (c.base + k) * 8;
        assert.ok(c.bots[k] - c.tops[k] >= GAP_MIN - 1e-9, `gap at ${wx}`);
        assert.ok(c.tops[k] >= 0 && c.bots[k] <= H, "inside the field");
        const mid = (c.tops[k] + c.bots[k]) / 2;
        if (k > 0) assert.ok(Math.abs(mid - prevMid) <= 8 * 0.7 + 4, `slope at ${wx}`);
        prevMid = mid;
      }
      for (const o of c.obstacles) {
        if (o.x < c.base * 8) continue; // its columns were trimmed already
        const [ceil, floor] = c.span(o.x, o.x + o.w);
        const free = Math.max(o.top - ceil, floor - o.bot);
        assert.ok(free >= PASS_MIN, `obstacle ${o.id} leaves a passage`);
      }
      c.trim(x + 4000 - 64);
    }
  }
});

test("cave: every generated tunnel is passable (reachable-set search)", () => {
  // Breadth-first over (y, vy), merging near-identical states. Every kept state
  // is a real trajectory, so a non-empty set at the end proves a route exists.
  const FRAMES = 14000; // reaches top speed and the minimum gap
  for (const seed of [1, 2, 3, 42]) {
    const c = new Cave(seed); // the engine builds the same cave from the same seed
    let states = new Map<number, [number, number]>([[0, [START_Y, 0]]]);
    let dist = 0;
    for (let f = 0; f < FRAMES; f++) {
      dist += speedAt(dist);
      c.ensure(dist + 700);
      const px = dist + PLAYER_X;
      const next = new Map<number, [number, number]>();
      for (const [y, vy] of states.values()) {
        for (const hold of [false, true]) {
          const [ny, nvy] = stepBody(y, vy, hold);
          const key = Math.round(ny / 2) * 64 + Math.round(nvy * 3) + 32;
          if (next.has(key)) continue;
          if (c.hits(px, ny) === HIT_NONE) next.set(key, [ny, nvy]);
        }
      }
      assert.ok(next.size > 0, `seed ${seed}: no route at frame ${f} (x=${Math.round(px)})`);
      states = next;
      if ((f & 255) === 0) c.trim(dist - 64);
    }
    assert.ok(dist > 60000, "searched a long tunnel");
  }
});
