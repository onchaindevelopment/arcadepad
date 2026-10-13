import { test } from "node:test";
import assert from "node:assert/strict";
import { sling, SlingEngine, LEVELS, CUP_X, CUP_Y, MAX_PULL, VMAX, predictShot, type SlingView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number) {
  const g = sling.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = sling.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const idle: Input = { x: 0, y: 0, b: 0 };

function overlaps(v: SlingView): string[] {
  const bad: string[] = [];
  const bs = v.bodies;
  for (let i = 0; i < bs.length; i++) {
    for (let j = i + 1; j < bs.length; j++) {
      const a = bs[i], b = bs[j];
      let pen: number;
      if (a.kind === "block" && b.kind === "block") {
        pen = Math.min(a.hw + b.hw - Math.abs(a.x - b.x), a.hh + b.hh - Math.abs(a.y - b.y));
      } else if (a.kind !== "block" && b.kind !== "block") {
        pen = a.r + b.r - Math.hypot(a.x - b.x, a.y - b.y);
      } else {
        const c = a.kind === "block" ? b : a, k = a.kind === "block" ? a : b;
        const qx = Math.max(k.x - k.hw, Math.min(k.x + k.hw, c.x));
        const qy = Math.max(k.y - k.hh, Math.min(k.y + k.hh, c.y));
        pen = c.r - Math.hypot(qx - c.x, qy - c.y);
      }
      if (pen > 0.01) bad.push(`${a.id}/${b.id} overlap ${pen.toFixed(2)}`);
    }
  }
  return bad;
}

test("sling: every level starts without overlaps and has critters", () => {
  for (let l = 0; l < LEVELS.length; l++) {
    const v = new SlingEngine(1, l).view();
    assert.deepEqual(overlaps(v), [], `level ${l + 1}`);
    assert.ok(v.critters > 0, `level ${l + 1} has critters`);
  }
});

test("sling: an untouched level stays perfectly still for 600 frames", () => {
  for (let l = 0; l < LEVELS.length; l++) {
    const g = new SlingEngine(3, l);
    const before = JSON.stringify(g.view().bodies);
    for (let i = 0; i < 600; i++) g.step(idle);
    assert.equal(JSON.stringify(g.view().bodies), before, `level ${l + 1}`);
  }
});

test("sling: woken stacks settle in place and fall asleep again (no jitter, no collapse)", () => {
  for (let l = 0; l < LEVELS.length * 2; l++) {
    const g = new SlingEngine(5, l);
    const start = g.view().bodies;
    g.wakeAll();
    for (let i = 0; i < 600; i++) g.step(idle);
    const end = g.view();
    assert.equal(end.bodies.length, start.length, `level ${l + 1}: nothing breaks`);
    for (let i = 0; i < start.length; i++) {
      const d = Math.hypot(end.bodies[i].x - start[i].x, end.bodies[i].y - start[i].y);
      assert.ok(d < 0.3, `level ${l + 1} body ${start[i].id} drifted ${d}`);
      assert.ok(end.bodies[i].asleep, `level ${l + 1} body ${start[i].id} asleep`);
    }
  }
});

test("sling: a direct hit pops a critter", () => {
  const g = new SlingEngine(9, 0);
  const v = g.view();
  // Find a drag point whose free flight hits a critter first.
  let pick: { x: number; y: number } | null = null;
  for (let py = CUP_Y; py <= CUP_Y + MAX_PULL && !pick; py++) {
    for (let px = CUP_X - MAX_PULL; px <= CUP_X && !pick; px++) {
      const dx = CUP_X - px, dy = CUP_Y - py;
      if (dx * dx + dy * dy > MAX_PULL * MAX_PULL || dx * dx + dy * dy < 30 * 30) continue;
      const h = predictShot(v.bodies, (dx * VMAX) / MAX_PULL, (dy * VMAX) / MAX_PULL);
      if (h.kind === "critter") pick = { x: px, y: py };
    }
  }
  assert.ok(pick, "some aim hits a critter directly");
  g.step({ x: CUP_X, y: CUP_Y, b: BTN.FIRE });
  g.step({ x: pick.x, y: pick.y, b: BTN.FIRE });
  g.step({ x: pick.x, y: pick.y, b: 0 });
  let popped = false;
  for (let i = 0; i < 300 && !popped; i++) {
    g.step({ x: pick.x, y: pick.y, b: 0 });
    if (g.events.some((e) => e.t === "pop")) popped = true;
  }
  assert.ok(popped, "critter popped");
  assert.equal(g.view().critters, v.critters - 1);
  assert.ok(g.result().score >= 5000);
});

test("sling: keyboard aim and Space launch", () => {
  const g = new SlingEngine(2, 0);
  for (let i = 0; i < 10; i++) g.step({ x: 0, y: 0, b: BTN.UP });
  const a0 = g.view().aim;
  assert.equal(a0.power, 85);
  g.step({ x: 0, y: 0, b: BTN.LEFT });
  assert.equal(g.view().aim.angle, a0.angle - 1);
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  g.step({ x: 0, y: 0, b: 0 });
  assert.equal(g.view().phase, "fly");
  assert.ok(g.events.some((e) => e.t === "launch"));
  assert.equal(g.hud().lives, LEVELS[0].shots - 1);
});

test("sling: idle run never ends; a run of misses fails the level", () => {
  const g = new SlingEngine(4, 0);
  for (let i = 0; i < 2000; i++) g.step(idle);
  assert.equal(g.done, false);
  // Fire straight up-left-ish (low power, steep) so it lands near the launcher, three times.
  let ev: string[] = [];
  for (let i = 0; i < 6000 && !g.done; i++) {
    const v = g.view();
    let b = 0;
    if (v.phase === "aim") b = v.aim.power > 20 ? BTN.DOWN : (i & 1 ? BTN.FIRE : 0);
    g.step({ x: 0, y: 0, b });
    ev = ev.concat(g.events.map((e) => e.t));
  }
  assert.equal(g.done, true);
  assert.equal(g.result().status, "over");
  assert.ok(ev.includes("lost") && ev.includes("gameover"));
  assert.equal(g.result().score, 0);
});

test("sling: bot clears levels and scores", () => {
  const { g } = botRun(7, 60000);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  console.log("bot result", r);
});

test("sling: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 15000);
    const r = replayGame(sling, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});
