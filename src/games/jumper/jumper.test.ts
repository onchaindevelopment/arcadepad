import { test } from "node:test";
import assert from "node:assert/strict";
import { jumper, generateChain, landingIndex, MAX_RISE, SAFE_GAP, MAX_DX, JUMP_V, type Plat } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = jumper.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = jumper.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("jumper: bot climbs and scores", () => {
  const { g } = botRun(7, jumper.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.view().maxH > 500, `bot should climb (maxH ${g.view().maxH})`);
});

test("jumper: bot runs end (attract mode)", () => {
  let ended = 0;
  for (const seed of [1, 2, 3, 4, 5]) if (botRun(seed, jumper.maxFrames).g.done) ended++;
  assert.ok(ended >= 4, `expected most bot runs to end, ${ended}/5 did`);
});

test("jumper: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, jumper.maxFrames);
    const r = replayGame(jumper, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("jumper: generated chain is always reachable", () => {
  assert.ok(SAFE_GAP < MAX_RISE - 20, `SAFE_GAP ${SAFE_GAP} vs MAX_RISE ${MAX_RISE}`);
  for (let seed = 1; seed <= 60; seed++) {
    const chain = generateChain(seed, 40000).filter((p) => p.chain);
    assert.ok(chain.length > 300);
    let solid = chain[0];
    for (let i = 1; i < chain.length; i++) {
      const a = chain[i - 1];
      const b = chain[i];
      const gap = b.top - a.top;
      assert.ok(gap > 0 && gap <= SAFE_GAP, `seed ${seed}: gap ${gap} at ${b.top}`);
      // Crumbles break after one bounce: the next platform must also be in
      // reach from the last platform that stays solid.
      assert.ok(b.top - solid.top <= SAFE_GAP, `seed ${seed}: solid gap ${b.top - solid.top} at ${b.top}`);
      if (b.kind !== "crumble") solid = b;
      if (a.kind !== "moving" && b.kind !== "moving") {
        const dx = Math.abs(a.x + a.w / 2 - (b.x + b.w / 2));
        assert.ok(dx <= MAX_DX, `seed ${seed}: dx ${dx} at ${b.top}`);
      }
      assert.ok(b.x >= 0 && b.x + b.w <= 360);
    }
  }
});

test("jumper: landing from above bounces, passing up through does not", () => {
  const plat: Plat = { id: 1, x: 100, top: 200, w: 60, kind: "normal", vx: 0, broken: 0, hitAge: 999, chain: true };
  // Falling through the top surface while over it: lands.
  assert.equal(landingIndex(130, 203, 196, -4, [plat]), 0);
  // Rising through it from below: no landing.
  assert.equal(landingIndex(130, 196, 203, 4, [plat]), -1);
  // Falling but beside it: no landing; wraps across the edge do count.
  assert.equal(landingIndex(20, 203, 196, -4, [plat]), -1);
  const edge: Plat = { ...plat, x: 0, w: 40 };
  assert.equal(landingIndex(355, 203, 196, -4, [edge]), 0);
  // A crumbled platform is not solid.
  assert.equal(landingIndex(130, 203, 196, -4, [{ ...plat, broken: 3 }]), -1);
});

test("jumper: plain bounce reaches MAX_RISE and auto-bounces on landing", () => {
  const g = jumper.create(9, { ticker: "TEST" });
  for (let i = 0; i < 34; i++) g.step({ x: 180, y: 300, b: 0 });
  const v = g.view();
  assert.ok(Math.abs(v.maxH - MAX_RISE) < 1e-9, `maxH ${v.maxH} vs ${MAX_RISE}`);
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) {
    g.step({ x: 180, y: 300, b: 0 });
    landed = g.events.some((e) => e.t === "bounce" || e.t === "spring");
  }
  assert.ok(landed, "falls back onto something and bounces");
  assert.ok(g.view().vy >= JUMP_V - 1e-9, "bounce sets an upward speed");
  assert.ok(!g.done);
});

test("jumper: arrows steer and the field wraps", () => {
  const g = jumper.create(4, { ticker: "TEST" });
  for (let i = 0; i < 60; i++) g.step({ x: 180, y: 300, b: BTN.RIGHT });
  const v = g.view();
  assert.ok(v.vx > 5, "accelerates right");
  // 60 frames at up to 5.5 px from x=180 must have wrapped past 360.
  assert.ok(v.x < 180, `wrapped x ${v.x}`);
});
