import { test } from "node:test";
import assert from "node:assert/strict";
import { beat, distPx, laneCenter, LANE_BTNS, PENDING, HELD, BROKEN, PERFECT_PX, type BeatView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type GameEvent, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = beat.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = beat.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

const idle = { x: 180, y: 300, b: 0 };
/** Step idle until the first pending tile matching `pred` is within `px` of the line. */
function waitFor(g: GameEngine<BeatView>, px: number, pred: (n: BeatView["notes"][number]) => boolean = () => true) {
  for (let i = 0; i < 5000; i++) {
    const v = g.view();
    const n = v.notes.find((q) => q.state === PENDING);
    if (n && pred(n) && distPx(n.six, v.beatPos) <= px) return n;
    if (n && !pred(n)) {
      // play it perfectly-ish so we can move on
      if (distPx(n.six, v.beatPos) <= 2) {
        g.step({ x: laneCenter(n.lane), y: 500, b: BTN.FIRE });
        let hv = g.view();
        while (hv.hold && !g.done) { g.step({ x: 0, y: 0, b: BTN.FIRE }); hv = g.view(); }
        g.step(idle);
        continue;
      }
    }
    g.step(idle);
    assert.ok(!g.done, "should not die while waiting");
  }
  throw new Error("tile never arrived");
}

test("beat: bot plays, scores and eventually lapses", () => {
  const { g, events } = botRun(7, beat.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(events.some((e) => e.t === "hit" && e.judge === "perfect" && e.sfx === "paddle"));
  assert.ok(events.some((e) => e.t === "hit" && e.judge === "good" && e.sfx === "brick"));
  assert.ok(events.some((e) => e.t === "holdDone"), "bot should complete a long tile");
  assert.equal(r.status, "over", "bot lapses should end the run");
  assert.deepEqual(events.slice(-1).map((e) => e.t), ["gameover"]);
});

test("beat: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, beat.maxFrames);
    const r = replayGame(beat, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("beat: tapping an empty lane ends the run", () => {
  const g = beat.create(4, CTX);
  for (let i = 0; i < 10; i++) g.step(idle);
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  assert.equal(g.done, true);
  assert.equal(g.result().status, "over");
  assert.ok(g.events.some((e) => e.t === "wrongtap" && e.sfx === "lost" && e.mood === "sad"));
  assert.deepEqual(g.view().fail, { lane: 0, kind: "wrongtap" });
});

test("beat: letting a tile pass ends the run", () => {
  const g = beat.create(5, CTX);
  let i = 0;
  for (; i < 2000 && !g.done; i++) g.step(idle);
  assert.equal(g.done, true);
  assert.ok(g.events.some((e) => e.t === "miss"));
  assert.equal(g.view().fail!.kind, "miss");
});

test("beat: keyboard lanes map LEFT/DOWN/UP/RIGHT, perfect beats good, pointer picks quarter", () => {
  const g = beat.create(11, CTX);
  // Tap tile 1 perfectly with its arrow key.
  let n = waitFor(g, 1, (q) => q.len === 0);
  g.step({ x: 0, y: 0, b: LANE_BTNS[n.lane] });
  let hit = g.events.find((e) => e.t === "hit")!;
  assert.ok(hit, "arrow key should hit");
  assert.equal(hit.lane, n.lane);
  assert.equal(hit.judge, "perfect");
  assert.equal(g.view().score, 3);
  g.step(idle);
  // Next tap tile: pointer, early (good window, outside perfect).
  n = waitFor(g, PERFECT_PX + 14, (q) => q.len === 0);
  const before = g.view().score;
  g.step({ x: n.lane * 90 + 5, y: 100, b: BTN.FIRE });
  hit = g.events.find((e) => e.t === "hit")!;
  assert.ok(hit, "pointer tap in the lane quarter should hit");
  assert.equal(hit.judge, "good");
  assert.ok(g.view().score - before < 3);
  assert.equal(g.view().combo >= 2, true);
});

test("beat: long tiles must be held; early release breaks, holding completes", () => {
  const g = beat.create(3, CTX);
  // Hold one long tile to the end.
  let n = waitFor(g, 0, (q) => q.len > 0);
  g.step({ x: 0, y: 0, b: LANE_BTNS[n.lane] });
  assert.ok(g.view().hold);
  while (g.view().hold) g.step({ x: 0, y: 0, b: LANE_BTNS[n.lane] });
  assert.equal(g.view().notes.find((q) => q.id === n.id)!.state, HELD);
  assert.ok(g.events.some((e) => e.t === "holdDone"));
  g.step(idle);
  // Release the next long tile immediately.
  n = waitFor(g, 0, (q) => q.len > 0);
  g.step({ x: laneCenter(n.lane), y: 0, b: BTN.FIRE });
  assert.ok(g.view().hold);
  g.step(idle);
  assert.equal(g.view().notes.find((q) => q.id === n.id)!.state, BROKEN);
  assert.equal(g.view().combo, 0);
  assert.ok(!g.done, "a broken hold is not fatal");
});
