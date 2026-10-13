import { test } from "node:test";
import assert from "node:assert/strict";
import { runner, GROUND_Y } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = runner.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = runner.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("runner: bot clears obstacles and scores", () => {
  const { g } = botRun(7, 6000);
  assert.ok(g.result().score > 100, `bot should pass a milestone, got ${g.result().score}`);
});

test("runner: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    // Mix bot play with some random-ish button mashing so jumps, ducks and drops are all replayed.
    const g = runner.create(seed, { ticker: "TEST" });
    const inputs: Input[] = [];
    for (let i = 0; i < 5000 && !g.done; i++) {
      let inp = runner.bot!(g.view(), i);
      if (i > 3000 && i % 97 < 6) inp = { x: 0, y: 0, b: i % 2 ? BTN.DOWN : BTN.UP };
      inputs.push(inp);
      g.step(inp);
    }
    const r = replayGame(runner, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.frames > 0);
  }
});

test("runner: running into a candle without jumping ends the game", () => {
  const g = runner.create(4, { ticker: "TEST" });
  g.step({ x: 0, y: 0, b: BTN.FIRE }); // start (and one jump)
  let sawHit = false;
  for (let i = 0; i < 5000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    if (g.events.some((e) => e.t === "hit" && e.sfx === "lost" && e.mood === "sad")) sawHit = true;
  }
  const v = g.view();
  // Either a ground obstacle got us or a low plane; never a high plane we run under.
  assert.equal(g.result().status, "over");
  assert.ok(sawHit, "hit event emitted");
  assert.ok(v.obstacles.some((o) => o.x < 100 && o.y + o.h > GROUND_Y - 50));
});

test("runner: jump physics and milestones", () => {
  const g = runner.create(1, { ticker: "TEST" });
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  assert.ok(g.events.some((e) => e.t === "jump" && e.sfx === "launch"));
  // Held jump rises higher than a tapped one.
  let peakHeld = 999;
  for (let i = 0; i < 80; i++) { g.step({ x: 0, y: 0, b: BTN.FIRE }); peakHeld = Math.min(peakHeld, g.view().y); }
  const h = runner.create(1, { ticker: "TEST" });
  h.step({ x: 0, y: 0, b: BTN.FIRE });
  // A short press (~65 ms) is cut to the drop velocity once past the minimum height.
  let peakTap = 999;
  for (let i = 0; i < 80; i++) { h.step({ x: 0, y: 0, b: i < 3 ? BTN.FIRE : 0 }); peakTap = Math.min(peakTap, h.view().y); }
  assert.ok(peakHeld < peakTap - 10, `held ${peakHeld} vs tap ${peakTap}`);
  // Bot run reaches at least one 100-point milestone with a happy extraGood event.
  const b = runner.create(9, { ticker: "TEST" });
  let milestone = false;
  for (let i = 0; i < 4000 && !b.done; i++) {
    b.step(runner.bot!(b.view(), i));
    if (b.events.some((e) => e.t === "milestone" && e.sfx === "extraGood" && e.mood === "happy")) milestone = true;
  }
  assert.ok(milestone);
});
