import { test } from "node:test";
import assert from "node:assert/strict";
import { bridge, HERO_HALF, PERFECT_HALF, type BridgeView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type GameEvent, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
const I = (b: number): Input => ({ x: 0, y: 0, b });

function botRun(seed: number, frames: number) {
  const g = bridge.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = bridge.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

/** Hold FIRE until the plank reaches `len` (or more), then release; run until the walk ends. */
function buildTo(g: GameEngine<BridgeView>, len: number, during?: (v: BridgeView, ev: readonly GameEvent[]) => Input | void) {
  const all: GameEvent[] = [];
  g.step(I(0));
  g.step(I(BTN.FIRE));
  while (g.view().phase === "grow" && g.view().plank.len < len) g.step(I(BTN.FIRE));
  for (let i = 0; i < 2000 && !g.done; i++) {
    const v = g.view();
    if (v.phase === "ready") break;
    const inp = (during && during(v, all)) || I(0);
    g.step(inp);
    all.push(...g.events);
  }
  return all;
}

test("bridge: bot crosses pillars, scores and eventually falls", () => {
  const { g, events } = botRun(7, bridge.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(g.view().crossed >= 3, `bot should cross a few pillars (got ${g.view().crossed})`);
  assert.equal(r.status, "over");
  assert.ok(events.some((e) => e.t === "arrive"));
  assert.deepEqual(events.slice(-1).map((e) => e.t), ["gameover"]);
});

test("bridge: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, bridge.maxFrames);
    const r = replayGame(bridge, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("bridge: a short plank drops the mascot", () => {
  const g = bridge.create(5, CTX);
  const ev = buildTo(g, 1);
  assert.equal(g.done, true);
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 0);
  assert.ok(ev.some((e) => e.t === "fall" && e.why === "short" && e.sfx === "lost" && e.mood === "sad"));
});

test("bridge: too long a plank also falls", () => {
  const g = bridge.create(6, CTX);
  const v = g.view();
  buildTo(g, v.next.x + v.next.w - v.plank.x + 6);
  assert.equal(g.done, true);
  assert.equal(g.result().score, 0);
});

test("bridge: hitting the centre zone is a perfect (+1 pillar +1 perfect), held FIRE does not regrow", () => {
  const g = bridge.create(9, CTX);
  const v = g.view();
  const centre = v.next.x + v.next.w / 2 - v.plank.x;
  const ev = buildTo(g, centre - PERFECT_HALF + 1);
  assert.ok(ev.some((e) => e.t === "perfect"), "should be a perfect");
  assert.ok(ev.some((e) => e.t === "arrive"));
  const after = g.view();
  assert.equal(after.crossed, 1);
  assert.equal(after.score, 2);
  assert.equal(after.phase, "ready");
  // Holding FIRE from the previous turn needs a fresh press.
  g.step(I(BTN.FIRE));
  g.step(I(BTN.FIRE));
  assert.equal(g.view().phase, "grow");
});

test("bridge: hanging under the plank grabs coins but crashes into the next pillar", () => {
  // Find a seed whose first gap has a coin.
  let seed = 1;
  for (; seed < 200; seed++) if (bridge.create(seed, CTX).view().coin) break;
  const g = bridge.create(seed, CTX);
  const v0 = g.view();
  const ev = buildTo(g, v0.next.x + v0.next.w / 2 - v0.plank.x, (v, all) => {
    if (v.phase === "walk" && !v.flipped && !all.some((e) => e.t === "flip") && v.heroX >= v.plank.x && (v.frame & 1) === 0) return I(BTN.DOWN);
  });
  assert.ok(ev.some((e) => e.t === "flip"));
  assert.ok(ev.some((e) => e.t === "coin"), "coin collected while hanging");
  const fall = ev.find((e) => e.t === "fall");
  assert.ok(fall && fall.why === "crash", "crash into the pillar while hanging");
  assert.equal(g.view().heroX, v0.next.x - HERO_HALF);
  assert.equal(g.result().score, 1 + (ev.some((e) => e.t === "perfect") ? 1 : 0));
});
