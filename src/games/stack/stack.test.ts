import { test } from "node:test";
import assert from "node:assert/strict";
import { stack, SLAB_H, BASE_W, PERFECT_PX } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEvent, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = stack.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = stack.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

test("stack: bot stacks, scores and eventually misses", () => {
  const { g, events } = botRun(7, stack.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.view().height >= 5, `bot should stack a few slabs (got ${g.view().height})`);
  assert.equal(r.status, "over", "deliberate bot error should end the run");
  assert.ok(events.some((e) => e.t === "slice" && e.sfx === "brick"));
  assert.ok(events.some((e) => e.t === "perfect" && e.sfx === "extraGood" && e.mood === "happy"));
  const tail = events.slice(-2).map((e) => e.t);
  assert.deepEqual(tail, ["miss", "gameover"]);
});

test("stack: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, stack.maxFrames);
    const r = replayGame(stack, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("stack: a complete miss ends the game", () => {
  const g = stack.create(5, CTX);
  // Idle until the slab is entirely clear of the base, then drop.
  let i = 0;
  for (; i < 2000; i++) {
    const v = g.view();
    const m = v.moving!, base = v.slabs[0];
    if (m.x + m.w < base.x - 2 || m.x > base.x + base.w + 2) break;
    g.step({ x: 0, y: 0, b: 0 });
  }
  assert.ok(i < 2000, "slab should leave the base area");
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  assert.equal(g.done, true);
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 0);
  assert.ok(g.events.some((e) => e.t === "miss" && e.sfx === "lost" && e.mood === "sad" && (e.shake ?? 0) > 0));
});

test("stack: overhang is sliced, perfect snaps, held button drops once", () => {
  const g = stack.create(9, CTX);
  // Wait until the slab is partly over the base (offset > perfect window), then drop.
  for (let i = 0; i < 2000; i++) {
    const v = g.view();
    const d = Math.abs(v.moving!.x - v.slabs[0].x);
    if (d > PERFECT_PX + 5 && d < 60) break;
    g.step({ x: 0, y: 0, b: 0 });
  }
  const before = g.view();
  const off = Math.abs(before.moving!.x - before.slabs[0].x);
  g.step({ x: 0, y: 0, b: BTN.UP });
  let v = g.view();
  assert.equal(v.height, 1);
  assert.ok(Math.abs(v.slabs[1].w - (BASE_W - off)) < 1e-9, "width shrinks by the overhang");
  assert.ok(g.events.some((e) => e.t === "slice"));
  // Holding the button does not drop again.
  for (let i = 0; i < 30; i++) g.step({ x: 0, y: 0, b: BTN.UP });
  assert.equal(g.view().height, 1);

  // Release, then drop within the perfect window: snaps to the slab below.
  g.step({ x: 0, y: 0, b: 0 });
  for (let i = 0; i < 4000; i++) {
    v = g.view();
    if (Math.abs(v.moving!.x - v.slabs[1].x) <= PERFECT_PX) break;
    g.step({ x: 0, y: 0, b: 0 });
  }
  const s1 = g.view().slabs[1];
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  v = g.view();
  assert.equal(v.height, 2);
  assert.deepEqual(v.slabs[2], { x: s1.x, w: s1.w });
  assert.equal(v.streak, 1);
  assert.equal(v.score, 1 + 2); // +1 slab, then +1 slab +1 perfect bonus
  assert.equal(g.hud().label, "Height 2");
  assert.ok(SLAB_H > 0);
});
