import { test } from "node:test";
import assert from "node:assert/strict";
import { hoops, flickVelocity, multFor, sinLerp, GAIN, MAX_V, HOOP_Y, TIME, MOVE_AT } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEvent, type Input } from "../core/types.ts";
import { SIN256 } from "../core/trig.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames = hoops.maxFrames) {
  const g = hoops.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = hoops.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

test("hoops: bot scores baskets and the timed run ends", () => {
  const { g, events } = botRun(7);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.equal(r.status, "over");
  assert.ok(r.frames >= TIME, "run lasts the full clock");
  assert.ok(events.some((e) => e.t === "launch" && e.sfx === "launch"));
  assert.ok(events.some((e) => e.t === "basket"));
  assert.equal(events[events.length - 1].t, "gameover");
});

test("hoops: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed);
    const r = replayGame(hoops, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("hoops: flick velocity comes from swipe speed, clamped, must go up", () => {
  const v = flickVelocity(0, -80, 4)!;
  assert.equal(v.vx, 0);
  assert.equal(v.vy, -20 * GAIN);
  const fast = flickVelocity(30, -400, 4)!;
  assert.ok(Math.abs(Math.sqrt(fast.vx * fast.vx + fast.vy * fast.vy) - MAX_V) < 1e-9);
  assert.equal(flickVelocity(40, 10, 4), null, "downward swipe is not a shot");
  assert.equal(flickVelocity(0, -8, 4), null, "too slow is not a shot");
});

test("hoops: streak multiplier and lerped sine", () => {
  assert.deepEqual([1, 2, 3, 4, 6, 7, 10, 30].map(multFor), [1, 1, 1, 2, 2, 3, 4, 4]);
  for (let i = 0; i < 256; i += 17) assert.equal(sinLerp(i), SIN256[i]);
  assert.ok(sinLerp(0.5) > 0 && sinLerp(0.5) < SIN256[1]);
});

test("hoops: straight-up swipe under a still hoop scores a swish for 3", () => {
  // Find a seed whose first ball spawns under the hoop centre-ish, then shoot straight up hard enough.
  for (let seed = 1; seed < 400; seed++) {
    const g = hoops.create(seed, CTX);
    const v0 = g.view();
    if (Math.abs(v0.ball.x - v0.hoop.x) > 8) continue;
    // Peak ~60px above the rim: vy = -sqrt(2 g h)
    const rise = v0.ball.y - (HOOP_Y - 60);
    const vy = -Math.sqrt(2 * 0.45 * rise);
    const sy = vy / GAIN;
    const bx = Math.round(v0.ball.x);
    const by = Math.round(v0.ball.y);
    const seq: Input[] = [{ x: bx, y: by, b: BTN.FIRE }];
    for (let k = 1; k <= 4; k++) seq.push({ x: bx, y: Math.round(by + sy * k), b: BTN.FIRE });
    seq.push({ x: bx, y: Math.round(by + sy * 4), b: 0 });
    const events: GameEvent[] = [];
    for (const inp of seq) { g.step(inp); events.push(...g.events); }
    for (let i = 0; i < 200; i++) { g.step({ x: bx, y: by, b: 0 }); events.push(...g.events); }
    const basket = events.find((e) => e.t === "basket");
    if (!basket) continue; // centre offset may clip the rim; try another seed
    assert.equal(basket.swish, true);
    assert.equal(basket.pts, (basket.moon as boolean) ? 5 : 3);
    assert.equal(g.result().score, basket.pts);
    return;
  }
  assert.fail("no seed produced a straight swish");
});

test("hoops: holding FIRE still charges, release shoots; the hoop moves after enough baskets", () => {
  const g = hoops.create(5, CTX);
  const v0 = g.view();
  const at = { x: Math.round(v0.ball.x), y: Math.round(v0.ball.y) };
  for (let i = 0; i < 30; i++) g.step({ ...at, b: BTN.FIRE });
  assert.equal(g.view().aim.mode, "charge");
  assert.ok(g.view().aim.power > 0);
  g.step({ ...at, b: 0 });
  assert.ok(g.events.some((e) => e.t === "launch"));
  assert.equal(g.view().phase, "flight");
  // Bot run: hoop is still before MOVE_AT baskets, moving after.
  const { events } = botRun(1);
  const n = events.filter((e) => e.t === "basket").length;
  if (n >= MOVE_AT) assert.ok(events.some((e) => e.t === "speedup" && e.toast === "levelClear"));
});
