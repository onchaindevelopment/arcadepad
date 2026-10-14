import { test } from "node:test";
import assert from "node:assert/strict";
import { whack, HEARTS, INTRO, RUN, POINTS, FRIEND_SAFE, holeX, holeY, holeAt, type WhackView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type GameEvent, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames = whack.maxFrames) {
  const g = whack.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = whack.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

/** Step idle (pointer parked at 0,0) until pred(view) or the run ends. */
function idleUntil(g: GameEngine<WhackView>, pred: (v: WhackView) => boolean, max = 5000) {
  for (let i = 0; i < max && !g.done; i++) {
    if (pred(g.view())) return true;
    g.step({ x: 0, y: 0, b: 0 });
  }
  return pred(g.view());
}

function tap(g: GameEngine<WhackView>, hole: number) {
  g.step({ x: holeX(hole), y: holeY(hole), b: BTN.FIRE });
  const ev = [...g.events];
  g.step({ x: holeX(hole), y: holeY(hole), b: 0 });
  return ev;
}

test("whack: holeAt maps hole centres back to their index", () => {
  for (let i = 0; i < 12; i++) assert.equal(holeAt(holeX(i), holeY(i)), i);
  assert.equal(holeAt(10, 20), -1);
});

test("whack: bot scores and the run ends within the clock", () => {
  const { g, events } = botRun(7);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.equal(r.status, "over");
  assert.ok(events.some((e) => e.t === "hit" && e.sfx === "brick"));
  assert.ok(events.some((e) => e.t === "timeup" || e.t === "gameover"));
  assert.ok(r.frames <= INTRO + RUN + 3 * 150 * 20 + 5);
});

test("whack: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed);
    const r = replayGame(whack, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("whack: hitting FUD scores; whacking the friend costs points and a heart", () => {
  const g = whack.create(11, CTX);
  // Hit the first FUD critter that pops.
  assert.ok(idleUntil(g, (v) => v.holes.some((h) => h.hittable && h.kind === "bear")));
  const bi = g.view().holes.findIndex((h) => h.hittable && h.kind === "bear");
  const ev = tap(g, bi);
  const hit = ev.find((e) => e.t === "hit");
  assert.ok(hit, "tap on a bear hits it");
  assert.equal(hit!.value, POINTS.bear);
  assert.equal(g.view().combo, 1);
  // Now wait for the friend and bonk it.
  assert.ok(idleUntil(g, (v) => v.holes.some((h) => h.hittable && h.kind === "friend")), "friend appears");
  const before = g.view();
  const fi = before.holes.findIndex((h) => h.hittable && h.kind === "friend");
  const ev2 = tap(g, fi);
  const ouch = ev2.find((e) => e.t === "ouch");
  assert.ok(ouch);
  assert.equal(ouch!.toast, "lifeLost");
  assert.equal(g.view().hearts, HEARTS - 1);
  assert.equal(g.view().combo, 0);
  assert.equal(g.view().score, Math.max(0, before.score + POINTS.friend));
});

test("whack: letting the friend go pays a small bonus; empty whack breaks combo", () => {
  const g = whack.create(4, CTX);
  let safe = false;
  for (let i = 0; i < 4000 && !g.done && !safe; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    safe = g.events.some((e) => e.t === "safe" && e.value === FRIEND_SAFE);
  }
  assert.ok(safe, "friend leaves safely");

  const g2 = whack.create(9, CTX);
  assert.ok(idleUntil(g2, (v) => v.holes.some((h) => h.hittable && h.kind !== "friend" && h.kind !== "bomb")));
  const hi = g2.view().holes.findIndex((h) => h.hittable && h.kind !== "friend" && h.kind !== "bomb");
  tap(g2, hi);
  assert.equal(g2.view().combo, 1);
  const empty = g2.view().holes.findIndex((h, i) => !h.kind && i !== hi);
  const ev = tap(g2, empty);
  assert.ok(ev.some((e) => e.t === "whiff" && e.broke === true));
  assert.equal(g2.view().combo, 0);
});

test("whack: arrows move the cursor and FIRE whacks the cursor hole", () => {
  const g = whack.create(5, CTX);
  g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().cursor, 4);
  g.step({ x: 0, y: 0, b: BTN.RIGHT });
  g.step({ x: 0, y: 0, b: 0 });
  g.step({ x: 0, y: 0, b: BTN.DOWN });
  g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().cursor, 8);
  assert.equal(g.view().ptrMode, false);
  idleUntil(g, (v) => v.phase === "play");
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  assert.equal(g.view().swing.hole, 8);
});

test("whack: three friendly bonks end the run early", () => {
  const g = whack.create(21, CTX);
  let bonks = 0;
  for (let i = 0; i < 20000 && !g.done; i++) {
    const v = g.view();
    const fi = v.holes.findIndex((h) => h.hittable && h.kind === "friend");
    if (fi >= 0) {
      tap(g, fi);
      bonks++;
    } else g.step({ x: 0, y: 0, b: 0 });
  }
  assert.equal(g.result().status, "over");
  assert.equal(bonks, HEARTS);
  assert.equal(g.view().outOfHearts, true);
  assert.ok(g.view().timeLeft > 0, "ended before the clock ran out");
});
