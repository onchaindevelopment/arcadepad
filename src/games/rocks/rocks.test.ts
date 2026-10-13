import { test } from "node:test";
import assert from "node:assert/strict";
import { rocks, ROCK_R, W, H } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = rocks.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = rocks.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("rocks: bot shoots rocks and scores", () => {
  const { g } = botRun(7, 6000);
  assert.ok(g.result().score > 0, "bot should score");
});

test("rocks: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 5000);
    const r = replayGame(rocks, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("rocks: a large rock splits into two mediums and scores 20", () => {
  const g = rocks.create(11, CTX);
  // Let the bot aim and fire until a bullet hits a large rock.
  let split: { size: number } | null = null;
  for (let i = 0; i < 4000 && !split && !g.done; i++) {
    const v = g.view();
    const before = v.rocks.length;
    g.step(rocks.bot!(v, i));
    const e = g.events.find((ev) => ev.t === "split" && ev.size === 0 && ev.points === 20);
    if (e) {
      split = { size: e.size as number };
      const after = g.view().rocks;
      assert.equal(after.length, before + 1, "one large removed, two mediums added");
      const mediums = after.filter((r) => r.size === 1 && r.r === ROCK_R[1]);
      assert.ok(mediums.length >= 2);
      assert.equal(e.sfx, "brick");
    }
  }
  assert.ok(split, "a large rock should have been split");
});

test("rocks: idle ship eventually dies 3 times and the game ends", () => {
  const g = rocks.create(3, CTX);
  let lost = 0;
  let over = false;
  for (let i = 0; i < rocks.maxFrames && !g.done; i++) {
    g.step({ x: W / 2, y: H / 2, b: 0 });
    for (const e of g.events) {
      if (e.t === "lost") {
        lost++;
        assert.equal(e.toast, "lifeLost");
        assert.equal(e.mood, "sad");
      }
      if (e.t === "gameover") over = true;
    }
  }
  assert.equal(lost, 3);
  assert.ok(over && g.result().status === "over");
});

test("rocks: pointer tap turns the ship toward the tap and fires", () => {
  const g = rocks.create(5, CTX);
  g.step({ x: W / 2, y: H / 2, b: 0 });
  // Move pointer (enables pointer mode), then tap to the right of the ship.
  g.step({ x: W / 2 + 100, y: H / 2, b: 0 });
  g.step({ x: W / 2 + 100, y: H / 2, b: BTN.FIRE });
  let shot = false;
  for (let i = 0; i < 60 && !shot; i++) {
    g.step({ x: W / 2 + 100, y: H / 2, b: 0 });
    shot = g.events.some((e) => e.t === "shot");
  }
  assert.ok(shot, "queued tap shot fires once aligned");
  const a = g.view().ship.angle;
  assert.ok(a <= 4 || a >= 252, `ship faces right, got ${a}`);
});
