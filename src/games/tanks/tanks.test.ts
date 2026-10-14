import { test } from "node:test";
import assert from "node:assert/strict";
import { tanks, TanksEngine, FIELD_W, TURRET_DY, WEAPONS, W_SHELL, W_TRIPLE, W_ROLLER, W_BOMB, searchShot, simulate } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
const idle: Input = { x: 320, y: 20, b: 0 };

function botRun(seed: number, frames: number) {
  const g = tanks.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = tanks.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

function runUntil(g: TanksEngine, pred: () => boolean, max = 3000, inp: Input = idle) {
  for (let i = 0; i < max && !pred(); i++) g.step(inp);
}

test("tanks: terrain is solid ground and tanks start on it", () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const g = new TanksEngine(seed);
    const v = g.view();
    for (let x = 0; x < FIELD_W; x++) assert.ok(v.terr.top[x] >= 70 && v.terr.top[x] <= 360, `seed ${seed} col ${x}`);
    for (const t of v.tanks) assert.equal(t.y, v.terr.top[t.x]);
    assert.ok(v.tanks[0].x < 200 && v.tanks[1].x > 440);
  }
});

test("tanks: keyboard aim, weapon cycle and Space fire", () => {
  const g = new TanksEngine(2);
  const a0 = g.view().tanks[0].angle, p0 = g.view().tanks[0].power;
  g.step({ ...idle, b: BTN.LEFT });
  g.step(idle);
  g.step({ ...idle, b: BTN.UP });
  g.step(idle);
  assert.equal(g.view().tanks[0].angle, a0 - 1);
  assert.equal(g.view().tanks[0].power, p0 + 1);
  for (const want of [W_TRIPLE, W_ROLLER, W_BOMB, W_SHELL]) {
    g.step({ ...idle, b: BTN.ALT });
    g.step(idle);
    assert.equal(g.view().tanks[0].weapon, want);
  }
  g.step({ ...idle, b: BTN.FIRE });
  assert.equal(g.view().phase, "fly");
  assert.ok(g.events.some((e) => e.t === "fire"));
});

test("tanks: drag from the tank sets angle and power, release fires", () => {
  const g = new TanksEngine(3);
  const t = g.view().tanks[0];
  const tx = t.x, ty = t.y - TURRET_DY;
  g.step({ x: tx, y: ty, b: BTN.FIRE });
  assert.equal(g.view().dragging, true);
  g.step({ x: tx + 55, y: ty - 55, b: BTN.FIRE }); // up-right, ~78 px
  const v = g.view();
  assert.equal(v.tanks[0].angle, 224);
  assert.equal(v.tanks[0].power, 71);
  g.step({ x: tx + 55, y: ty - 55, b: 0 });
  assert.equal(g.view().phase, "fly");
});

test("tanks: explosions carve craters, damage nearby tanks, and the turn passes to the CPU", () => {
  const g = new TanksEngine(4);
  const v0 = g.view();
  const best = searchShot(v0.terr, v0.wind, v0.tanks, 0, 1);
  const imp = simulate(v0.terr, v0.wind, v0.tanks, 0, best.angle, best.power);
  assert.ok(Math.abs(imp.x - v0.tanks[1].x) < 20, "search finds a near hit");
  const tk = g.tanks[0];
  tk.angle = best.angle;
  tk.power = best.power;
  const before = Float64Array.from(g.terr.top);
  g.step({ ...idle, b: BTN.FIRE });
  let hit = false, boom = false;
  for (let i = 0; i < 2000 && g.view().phase !== "aim"; i++) {
    g.step(idle);
    if (g.events.some((e) => e.t === "boom")) boom = true;
    if (g.events.some((e) => e.t === "hit" && e.tank === 1)) hit = true;
  }
  assert.ok(boom && hit, "shell exploded and hurt the bear");
  let dug = 0;
  for (let x = 0; x < FIELD_W; x++) if (g.terr.top[x] > before[x] + 0.5) dug++;
  assert.ok(dug > 0, "crater carved");
  assert.ok(g.result().score > 0 && g.result().score <= WEAPONS[W_SHELL].dmg);
  assert.equal(g.view().turn, 1);
});

test("tanks: ammo is limited; empty weapons are skipped", () => {
  const g = new TanksEngine(5);
  g.tanks[0].weapon = W_BOMB;
  g.step({ ...idle, b: BTN.FIRE });
  assert.equal(g.tanks[0].ammo[W_BOMB], 0);
  assert.equal(g.tanks[0].weapon, W_SHELL);
  runUntil(g, () => g.view().phase === "aim" && g.view().turn === 0, 5000);
  for (let k = 0; k < 6; k++) {
    g.step({ ...idle, b: BTN.ALT });
    g.step(idle);
    assert.notEqual(g.tanks[0].weapon, W_BOMB);
  }
});

test("tanks: losing your tank ends the run; idle never ends on its own turn", () => {
  const g = new TanksEngine(6);
  for (let i = 0; i < 1500; i++) g.step(idle);
  assert.equal(g.done, false);
  g.tanks[0].hp = 1;
  // Fire straight up: it comes down on our own tank (or the CPU finishes us).
  g.tanks[0].angle = 192;
  g.tanks[0].power = 30;
  g.step({ ...idle, b: BTN.FIRE });
  runUntil(g, () => g.done, 20000);
  assert.equal(g.result().status, "over");
});

test("tanks: winning a duel gives 1000 and a tougher bear on new terrain", () => {
  const g = new TanksEngine(7);
  const top0 = Float64Array.from(g.terr.top);
  const hp0 = g.tanks[1].maxHp;
  g.tanks[1].hp = 1;
  const v0 = g.view();
  const best = searchShot(v0.terr, v0.wind, v0.tanks, 0, 1);
  g.tanks[0].angle = best.angle;
  g.tanks[0].power = best.power;
  g.tanks[0].weapon = W_BOMB;
  g.step({ ...idle, b: BTN.FIRE });
  runUntil(g, () => g.duel === 1, 3000);
  assert.equal(g.duel, 1);
  assert.equal(g.result().levelsCleared, 1);
  assert.equal(g.result().score, 1001);
  assert.ok(g.tanks[1].maxHp > hp0);
  assert.notDeepEqual(Float64Array.from(g.terr.top), top0);
});

test("tanks: bot scores", () => {
  const { g } = botRun(11, 30000);
  const r = g.result();
  console.log("bot result", r);
  assert.ok(r.score > 0, "bot should score");
});

test("tanks: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 15000);
    const r = replayGame(tanks, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});
