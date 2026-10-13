import { test } from "node:test";
import assert from "node:assert/strict";
import { target, FLIGHT, angDist, impactLocal, sin4096 } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEvent, type Input } from "../core/types.ts";
import { SIN256 } from "../core/trig.ts";

const CTX = { ticker: "TEST" };
const IDLE: Input = { x: 0, y: 0, b: 0 };
const FIRE: Input = { x: 0, y: 0, b: BTN.FIRE };

function botRun(seed: number, frames: number) {
  const g = target.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = target.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

/** Fresh engine with the given inputs applied. */
function play(seed: number, inputs: Input[]) {
  const g = target.create(seed, CTX);
  const events: GameEvent[] = [];
  for (const inp of inputs) {
    g.step(inp);
    events.push(...g.events);
  }
  return { g, events };
}

/** Outcome of pressing FIRE now (after `prefix`) and waiting for the pin to land. */
function tryThrow(seed: number, prefix: Input[]) {
  const seq = [...prefix, FIRE, ...Array(FLIGHT + 1).fill(IDLE)];
  return { seq, ...play(seed, seq) };
}

test("target: sin4096 interpolates the byte table", () => {
  for (let i = 0; i < 256; i++) assert.equal(sin4096(i * 16), SIN256[i]);
  assert.ok(Math.abs(sin4096(1024) - 1) < 1e-12);
  assert.ok(sin4096(8) > 0 && sin4096(8) < SIN256[1]);
});

test("target: bot throws, scores, clears a level and eventually misses", () => {
  const { g, events } = botRun(7, target.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(r.levelsCleared >= 1, `bot should clear a level (got ${r.levelsCleared})`);
  assert.equal(r.status, "over", "mistimed throws should end the run");
  assert.ok(events.some((e) => e.t === "throw" && e.sfx === "shot"));
  assert.ok(events.some((e) => e.t === "stick" && e.sfx === "paddle"));
  assert.ok(events.some((e) => e.t === "clear" && e.sfx === "levelclear" && e.toast === "levelClear" && e.mood === "happy"));
  const tail = events.slice(-2).map((e) => e.t);
  assert.deepEqual(tail, ["fail", "gameover"]);
});

test("target: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, target.maxFrames);
    const r = replayGame(target, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("target: hitting a stuck pin fails the run", () => {
  const seed = 11;
  // First pin always sticks on an empty level-1 disc.
  const first = tryThrow(seed, [IDLE]);
  assert.equal(first.g.view().pins.length, 1);
  assert.equal(first.g.result().status, "playing");
  // Find a later moment where the stuck pin is at the impact point.
  let prefix = first.seq;
  let failed = false;
  for (let k = 0; k < 600 && !failed; k++) {
    const tr = tryThrow(seed, prefix);
    const v0 = play(seed, prefix).g.view();
    const pinNearSlot = angDist(v0.pins[0], impactLocal(tr.g.view().rot)) < 60;
    if (pinNearSlot) {
      assert.ok(tr.events.some((e) => e.t === "fail" && e.sfx === "lost" && e.mood === "sad"), "throw onto a stuck pin must fail");
      for (let i = 0; i < 80; i++) tr.g.step(IDLE);
      assert.equal(tr.g.result().status, "over");
      assert.equal(tr.g.view().pins.length, 1);
      failed = true;
    }
    prefix = [...prefix, IDLE];
  }
  assert.ok(failed, "should find a colliding throw within 600 frames");
});

test("target: sticking N pins clears the level", () => {
  const seed = 5;
  const g0 = target.create(seed, CTX);
  const need = g0.view().need;
  assert.equal(g0.view().obstacles.length, 0, "level 1 has no obstacles");
  let seq: Input[] = [IDLE];
  let stuck = 0;
  for (let guard = 0; stuck < need && guard < 3000; guard++) {
    const tr = tryThrow(seed, seq);
    if (tr.g.view().pins.length === stuck + 1 || tr.g.view().phase === "clear") {
      seq = tr.seq;
      stuck++;
    } else seq = [...seq, IDLE];
  }
  assert.equal(stuck, need);
  const { g, events } = play(seed, seq);
  assert.equal(g.view().phase, "clear");
  assert.equal(g.result().levelsCleared, 1);
  assert.ok(events.some((e) => e.t === "clear" && e.toast === "levelClear"));
  for (let i = 0; i < 100; i++) g.step(IDLE);
  const v = g.view();
  assert.equal(v.level, 1);
  assert.equal(v.phase, "play");
  assert.equal(v.pins.length, 0);
  assert.ok(g.result().score >= need * 10 + 100);
});

test("target: every 5th level is a boss disc", () => {
  const { events } = botRun(1, target.maxFrames);
  const lv = events.filter((e) => e.t === "level");
  assert.ok(lv.length >= 5, `bot should reach level 6 (got ${lv.length + 1})`);
  for (const e of lv) assert.equal(e.boss, (e.level as number) % 5 === 4, `level ${e.level}`);
});
