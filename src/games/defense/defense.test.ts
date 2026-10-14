import { test } from "node:test";
import assert from "node:assert/strict";
import { AMMO, BASE_X, BASE_Y, defense } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = defense.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  let kills = 0;
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = defense.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    for (const e of g.events) if (e.t === "kill") kills++;
  }
  return { g, inputs, kills };
}

test("defense: bot intercepts, clears waves and the run ends", () => {
  const { g, kills } = botRun(7, defense.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(kills > 10, "bot should shoot rockets down");
  assert.ok(r.levelsCleared >= 2, "bot should clear a few waves");
  assert.equal(r.status, "over", "attract run should end");
});

test("defense: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 15000);
    const r = replayGame(defense, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("defense: a tap fires from the nearest base and the blast grows where you aimed", () => {
  const g = defense.create(3, { ticker: "TEST" });
  g.step({ x: 180, y: 300, b: 0 });
  g.step({ x: 40, y: 300, b: BTN.FIRE });
  let v = g.view();
  assert.equal(v.shots.length, 1);
  assert.equal(v.shots[0].base, 0, "left base is nearest to x=40");
  assert.equal(v.sites[0].ammo, AMMO - 1);
  assert.equal(v.shots[0].sx, BASE_X[0]);
  assert.equal(v.shots[0].sy, BASE_Y);
  let blastAt: { x: number; y: number } | null = null;
  for (let i = 0; i < 200 && !blastAt; i++) {
    g.step({ x: 40, y: 300, b: 0 });
    for (const e of g.events) if (e.t === "blast") blastAt = { x: e.x as number, y: e.y as number };
  }
  assert.deepEqual(blastAt, { x: 40, y: 300 });
  v = g.view();
  assert.equal(v.booms.length, 1);
  const r0 = v.booms[0].r;
  g.step({ x: 40, y: 300, b: 0 });
  assert.ok(g.view().booms[0].r > r0, "blast expands");
});

test("defense: keyboard crosshair, ALT picks a base, and an empty base falls back to the nearest", () => {
  const g = defense.create(4, { ticker: "TEST" });
  g.step({ x: 0, y: 0, b: 0 });
  const c0 = g.view().cross;
  for (let i = 0; i < 10; i++) g.step({ x: 0, y: 0, b: BTN.RIGHT });
  assert.ok(g.view().cross.x > c0.x, "RIGHT moves the crosshair");
  g.step({ x: 0, y: 0, b: 0 });
  g.step({ x: 0, y: 0, b: BTN.ALT }); // auto -> base 0
  g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().sel, 0);
  for (let k = 0; k < AMMO + 1; k++) {
    g.step({ x: 0, y: 0, b: BTN.FIRE });
    for (let i = 0; i < 60; i++) g.step({ x: 0, y: 0, b: 0 }); // let it land (max 10 in flight)
  }
  const v = g.view();
  assert.equal(v.sites[0].ammo, 0, "selected base spent first");
  assert.equal(v.sites[1].ammo, AMMO - 1, "then nearest base takes over");
});

test("defense: doing nothing loses every city and ends the run", () => {
  const g = defense.create(9, { ticker: "TEST" });
  let lost = 0;
  for (let i = 0; i < defense.maxFrames && !g.done; i++) {
    g.step({ x: 0, y: 0, b: 0 });
    for (const e of g.events) if (e.t === "cityLost") lost++;
  }
  assert.equal(g.result().status, "over");
  assert.equal(g.view().citiesLeft, 0);
  assert.equal(lost, 6);
});
