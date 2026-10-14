import { test } from "node:test";
import assert from "node:assert/strict";
import { turf, COLS, H, W, type TurfView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = turf.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = turf.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const IDLE: Input = { x: W / 2, y: H / 2, b: 0 };

/** Idle until the player's cell satisfies `cond`, then tap `b` for one frame. */
function until(g: GameEngine<TurfView>, cond: (c: number, r: number) => boolean, b: number) {
  for (let i = 0; i < 2000; i++) {
    const me = g.view().actors[0];
    if (!me.alive) return;
    if (cond(me.c, me.r)) {
      g.step({ ...IDLE, b });
      return;
    }
    g.step(IDLE);
  }
  throw new Error("condition never met");
}

test("turf: bot claims land and scores", () => {
  const { g } = botRun(7, 6000);
  const v = g.view();
  assert.ok(g.result().score > 0, "bot should score");
  assert.ok(v.actors[0].cells > 25 || v.dead, "bot should grow beyond the start patch (or die trying)");
});

test("turf: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 4000);
    const r = replayGame(turf, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("turf: full bot runs end by death or time-up", () => {
  for (const seed of [11, 12]) {
    const { g } = botRun(seed, turf.maxFrames);
    assert.ok(g.done, "run should end");
    assert.ok(g.result().frames <= turf.maxFrames);
  }
});

test("turf: closing a loop claims the trail and the area it encloses", () => {
  const g = turf.create(5, { ticker: "TEST" }) as GameEngine<TurfView>;
  const s = g.view().actors[0];
  const pc = s.c, pr = s.r;
  assert.equal(s.cells, 25);
  g.step({ ...IDLE, b: BTN.UP }); // start heading up
  until(g, (c, r) => r === pr - 5, BTN.RIGHT);
  until(g, (c) => c === pc + 2, BTN.DOWN);
  until(g, (c, r) => r === pr - 1, 0);
  const v = g.view();
  assert.ok(v.actors[0].alive);
  // 3 trail cells up, 2 right, 2 down, plus 2 enclosed cells = 9 new cells.
  assert.equal(v.actors[0].cells, 34);
  assert.equal(v.owner[(pr - 4) * COLS + pc + 1], 0, "enclosed cell is ours");
  assert.equal(v.actors[0].trailLen, 0);
});

test("turf: running into your own trail ends the run", () => {
  const g = turf.create(5, { ticker: "TEST" }) as GameEngine<TurfView>;
  const s = g.view().actors[0];
  const pc = s.c, pr = s.r;
  g.step({ ...IDLE, b: BTN.UP });
  until(g, (c, r) => r === pr - 5, BTN.RIGHT);
  until(g, (c) => c === pc + 1, BTN.DOWN);
  until(g, (c, r) => r === pr - 4, BTN.LEFT);
  for (let i = 0; i < 60 && !g.done; i++) g.step(IDLE);
  assert.equal(g.result().status, "over");
});

test("turf: pointer resting to the right steers right", () => {
  const g = turf.create(9, { ticker: "TEST" }) as GameEngine<TurfView>;
  g.step(IDLE);
  for (let i = 0; i < 12; i++) g.step({ x: W / 2 + 100, y: H / 2 + 10, b: 0 });
  assert.equal(g.view().actors[0].dir, 1);
});

test("turf: cutting a rival's trail knocks it out and scores a KO", () => {
  let found = false;
  for (let seed = 1; seed <= 12 && !found; seed++) {
    const g = turf.create(seed, { ticker: "TEST" }) as GameEngine<TurfView>;
    for (let i = 0; i < turf.maxFrames && !g.done && !found; i++) {
      g.step(turf.bot!(g.view(), i));
      const ko = g.events.find((e) => e.t === "kill" && e.killer === 0);
      if (ko) {
        found = true;
        const v = g.view();
        const victim = v.actors[ko.victim as number];
        assert.equal(victim.alive, false);
        assert.equal(victim.cells, 0, "a knocked-out rival loses its land");
        assert.ok(v.actors[0].kills >= 1);
        assert.equal(v.score, v.pct10 * 10 + v.actors[0].kills * 100);
      }
    }
  }
  assert.ok(found, "the bot should knock out a rival in some run");
});
