import { test } from "node:test";
import assert from "node:assert/strict";
import { helix, buildTower, segUnder, GAP, SAFE, DANGER, SUPER_AT, type HelixView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { Rng } from "../core/rng.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = helix.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = helix.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("helix: bot passes rings and scores", () => {
  let best = 0;
  for (const seed of [7, 8, 9]) {
    const { g } = botRun(seed, 20000);
    best = Math.max(best, g.result().score);
  }
  assert.ok(best > 0, "bot should score");
});

test("helix: bot runs end (attract mode)", () => {
  let ended = 0;
  for (const seed of [11, 12, 13, 14]) if (botRun(seed, 15 * 60 * 60).g.done) ended++;
  assert.ok(ended > 0);
});

test("helix: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 6000);
    const r = replayGame(helix, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("helix: towers have gaps, safe ground and a pad; later levels have more danger", () => {
  const count = (lvl: number) => {
    let d = 0;
    for (let s = 1; s <= 20; s++) {
      const rings = buildTower(new Rng(s), lvl);
      const last = rings[rings.length - 1];
      assert.ok(last.pad && last.segs.every((k) => k === SAFE));
      for (const r of rings.slice(0, -1)) {
        assert.ok(r.segs.includes(GAP));
        assert.ok(r.segs.filter((k) => k === SAFE).length >= 3);
        d += r.segs.filter((k) => k === DANGER).length;
      }
      // Starter ring is safe under the ball.
      assert.equal(rings[0].segs[segUnder(0)], SAFE);
    }
    return d / (20 * (rings0(lvl)));
  };
  const rings0 = (lvl: number) => buildTower(new Rng(1), lvl).length - 1;
  assert.ok(count(6) > count(0));
});

test("helix: idling bounces forever on the starter ring", () => {
  const g = helix.create(3, { ticker: "TEST" });
  for (let i = 0; i < 1200; i++) g.step({ x: 180, y: 300, b: 0 });
  assert.equal(g.done, false);
  const v = g.view() as HelixView;
  assert.equal(v.ringsPassed, 0);
  assert.ok(g.events !== undefined);
});

test("helix: rotating a gap under the ball drops it through and scores", () => {
  const g = helix.create(4, { ticker: "TEST" });
  const v0 = g.view() as HelixView;
  const gapSeg = v0.rings[0].segs.indexOf(GAP);
  // Drag the tower (FIRE held + pointer moves) until the gap is under the ball.
  let x = 300;
  g.step({ x, y: 300, b: BTN.FIRE });
  for (let i = 0; i < 2000 && segUnder((g.view() as HelixView).rot) !== gapSeg; i++) {
    if (x <= 20) {
      x = 300; // lift the finger and grab again on the right
      g.step({ x, y: 300, b: 0 });
      g.step({ x, y: 300, b: BTN.FIRE });
      continue;
    }
    x -= 1; // drag left 1px
    g.step({ x, y: 300, b: BTN.FIRE });
  }
  assert.equal(segUnder((g.view() as HelixView).rot), gapSeg);
  for (let i = 0; i < 300 && (g.view() as HelixView).ringsPassed === 0; i++) g.step({ x, y: 300, b: 0 });
  assert.ok((g.view() as HelixView).ringsPassed >= 1);
  assert.ok(g.result().score >= 10);
});

test("helix: landing on danger ends the run", () => {
  const g = helix.create(5, { ticker: "TEST" });
  const v = g.view() as HelixView;
  v.rings[0].segs.fill(DANGER);
  for (let i = 0; i < 300 && !g.done; i++) g.step({ x: 180, y: 300, b: 0 });
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 0);
});

test("helix: falling through SUPER_AT rings makes a super ball that smashes danger", () => {
  const g = helix.create(6, { ticker: "TEST" });
  const v = g.view() as HelixView;
  for (let k = 0; k < SUPER_AT; k++) v.rings[k].segs.fill(GAP);
  v.rings[SUPER_AT].segs.fill(DANGER);
  let smashed = false;
  for (let i = 0; i < 400 && !g.done && !smashed; i++) {
    g.step({ x: 180, y: 300, b: 0 });
    if (g.events.some((e) => e.t === "smash")) smashed = true;
  }
  assert.ok(smashed);
  assert.equal(g.done, false);
  const after = g.view() as HelixView;
  assert.ok(after.rings[SUPER_AT].smashed);
  assert.equal(after.combo, 0);
  assert.ok(g.result().score > SUPER_AT * 10);
});
