import { test } from "node:test";
import assert from "node:assert/strict";
import { pulse, LEVELS, newSim, physStep, plan, T, P } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = pulse.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = pulse.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("pulse: every level is beatable at every loop speed", () => {
  for (const lvl of LEVELS) {
    for (const k of [1, 1.3, 1.6]) {
      const s = newSim();
      for (let f = 0; f < 5000 && !s.dead && !s.cleared; f++) {
        const h = plan(s, lvl, k, f, 60, 40000, 1);
        physStep(s, lvl, h ?? true, k, null);
      }
      assert.ok(s.cleared, `${lvl.name} at speed ${k} (died at column ${Math.floor(s.x / T)})`);
    }
  }
});

test("pulse: bot scores and the run eventually ends", () => {
  const { g } = botRun(7, pulse.maxFrames);
  assert.ok(g.result().score > 0, "bot should score");
  assert.equal(g.result().status, "over");
});

test("pulse: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 5000);
    const r = replayGame(pulse, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("pulse: never pressing runs into the first spike", () => {
  const g = pulse.create(4, { ticker: "TEST" });
  const seen: string[] = [];
  for (let i = 0; i < 2000 && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) seen.push(e.t);
  }
  assert.equal(g.result().status, "over");
  assert.ok(seen.includes("spiked"));
  const v = g.view();
  // First spike is at column 17 of Warm Up.
  assert.ok(Math.abs(v.sim.x + P / 2 - 17.5 * T) < T, `died near the spike (x=${v.sim.x})`);
  assert.ok(g.result().score > 0 && g.result().score < 20);
});

test("pulse: holding jumps again on landing", () => {
  const g = pulse.create(5, { ticker: "TEST" });
  let jumps = 0;
  for (let i = 0; i < 70 + 60; i++) {
    g.step({ x: 0, y: 0, b: BTN.FIRE });
    jumps += g.events.filter((e) => e.t === "jump").length;
  }
  assert.ok(jumps >= 3, `held jumps: ${jumps}`);
});

test("pulse: running into the side of a block crashes, landing on top does not", () => {
  const lvl = { name: "t", cols: 20, rows: Array.from({ length: 12 }, (_, r) => (r >= 10 ? "#".repeat(20) : r === 9 ? "......##" + ".".repeat(12) : ".".repeat(20))), endX: 15 * T, portals: [] };
  const s = newSim();
  for (let i = 0; i < 200 && !s.dead; i++) physStep(s, lvl, false, 1, null);
  assert.ok(s.dead && s.x < 6 * T, "crashed into the block");
  // Jumping early enough lands on it.
  const s2 = newSim();
  for (let i = 0; i < 200 && !s2.dead && !s2.cleared; i++) physStep(s2, lvl, s2.x > 3.6 * T && s2.x < 4 * T, 1, null);
  assert.ok(s2.cleared, "jumped onto the block and finished");
});
