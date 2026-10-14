import { test } from "node:test";
import assert from "node:assert/strict";
import { hill, FIELD_W } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = hill.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = hill.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("hill: bot drives, collects and the run ends", () => {
  const { g } = botRun(7, hill.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.view().meters > 100, `bot should drive a while, got ${g.view().meters}m`);
  assert.ok(g.view().coins > 0, "bot should pick up coins");
  assert.equal(r.status, "over");
  assert.ok(g.done);
});

test("hill: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    // Bot play mixed with pointer holds on both halves and some air mashing.
    const g = hill.create(seed, CTX);
    const inputs: Input[] = [];
    for (let i = 0; i < 6000 && !g.done; i++) {
      let inp = hill.bot!(g.view(), i);
      if (i % 211 < 25) inp = { x: i % 2 ? FIELD_W - 20 : 20, y: 100, b: BTN.FIRE };
      else if (i % 157 < 8) inp = { x: 0, y: 0, b: BTN.UP };
      inputs.push(inp);
      g.step(inp);
    }
    const r = replayGame(hill, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.frames > 0);
  }
});

test("hill: gas moves forward, pointer halves pick gas or brake", () => {
  const a = hill.create(4, CTX);
  for (let i = 0; i < 180; i++) a.step({ x: FIELD_W - 10, y: 50, b: BTN.FIRE });
  assert.equal(a.view().pedal, 1);
  assert.ok(a.view().meters > 20, `gas should move us, got ${a.view().meters}m`);
  const b = hill.create(4, CTX);
  for (let i = 0; i < 180; i++) b.step({ x: 10, y: 50, b: BTN.FIRE });
  assert.equal(b.view().pedal, -1);
  assert.ok(b.view().meters <= 1, "brake/reverse should not gain distance");
});

test("hill: idling burns the tank and the run ends out of fuel", () => {
  const g = hill.create(2, CTX);
  let empty = false;
  for (let i = 0; i < 5000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    if (g.events.some((e) => e.t === "empty" && e.sfx === "lost")) empty = true;
  }
  assert.ok(empty, "empty event");
  assert.ok(g.done);
  assert.equal(g.view().outOfFuel, true);
  assert.equal(g.view().crashed, false);
  assert.equal(g.result().status, "over");
});

test("hill: landing on the roof (mascot's head) is a crash", () => {
  const g = hill.create(3, CTX);
  g.step({ x: 0, y: 0, b: 0 });
  // Turn the buggy upside down a little above the flat start road.
  const pts = (g as unknown as { pts: { x: number; y: number; ox: number; oy: number; vx: number; vy: number }[] }).pts;
  const cx = (pts[0].x + pts[1].x + pts[2].x + pts[3].x) / 4;
  const cy = (pts[0].y + pts[1].y + pts[2].y + pts[3].y) / 4;
  for (const q of pts) {
    // Rotate 180 degrees about the centre and lift it.
    q.x = cx - (q.x - cx);
    q.ox = q.x;
    q.y = cy - (q.y - cy) - 40;
    q.oy = q.y;
    q.vx = 0;
    q.vy = 0;
  }
  let crash = false;
  for (let i = 0; i < 200 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    if (g.events.some((e) => e.t === "crash" && e.sfx === "explode" && e.mood === "sad")) crash = true;
  }
  assert.ok(crash, "crash event");
  assert.ok(g.done);
  assert.equal(g.view().crashed, true);
});

test("hill: a full turn in the air pays a flip bonus", () => {
  const g = hill.create(5, CTX);
  g.step({ x: 0, y: 0, b: 0 });
  // Launch the buggy high and spin it with the gas until it lands.
  const pts = (g as unknown as { pts: { y: number; oy: number; vy: number; vx: number }[] }).pts;
  for (const q of pts) {
    q.y -= 400;
    q.oy = q.y;
    q.vy = -4;
    q.vx = 0;
  }
  let flip: { flips: number; back: boolean } | undefined;
  let crashed = false;
  for (let i = 0; i < 400 && !g.done && !flip; i++) {
    // Hold the gas (nose up = backflip) while high above the road, then let go.
    const spinning = -10 - g.view().cy > 120;
    g.step({ x: 0, y: 0, b: spinning ? BTN.RIGHT : 0 });
    for (const e of g.events) {
      if (e.t === "flip") flip = e as unknown as { flips: number; back: boolean };
      if (e.t === "crash") crashed = true;
    }
  }
  assert.equal(crashed, false);
  assert.ok(flip && flip.flips >= 1 && flip.back, "backflip bonus on landing");
  assert.ok(g.result().score >= 100);
});
