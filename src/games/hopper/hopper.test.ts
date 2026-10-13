import { test } from "node:test";
import assert from "node:assert/strict";
import {
  hopper, HopperEngine, RowGen, grassBlockOk, HOP, START_ROW, TILE, TRAM_PASS, TRAM_WARN, LOG,
  type Row,
} from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
const IDLE: Input = { x: 0, y: 0, b: 0 };
const UP: Input = { x: 0, y: 0, b: BTN.UP };

function botRun(seed: number, frames: number) {
  const g = hopper.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = hopper.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

function riverRow(r: number, speed: number, objs: { off: number; w: number }[]): Row {
  return { r, kind: "river", stumps: 0, coins: 0, speed, period: 680, objs: objs.map((o) => ({ ...o, kind: LOG })), tram: null };
}

test("hopper: bot crosses rows and scores", () => {
  const { g } = botRun(7, 8000);
  assert.ok(g.result().score > 0, "bot should score");
  assert.ok((g.view() as { best: number }).best > 10, "bot should get past a few lanes");
});

test("hopper: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 5000);
    const r = replayGame(hopper, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("hopper: generated rows are fair", () => {
  for (let seed = 1; seed <= 20; seed++) {
    const gen = new RowGen(seed);
    const rows: Row[] = [];
    for (let i = 0; i < 1500; i++) rows.push(gen.next());
    let block: Row[] = [];
    let hazardRun = 0;
    rows.forEach((row, i) => {
      assert.equal(row.r, i);
      if (i < 5) assert.ok(row.kind === "grass" && row.stumps === 0, "safe start rows");
      if (row.kind === "grass") {
        block.push(row);
        hazardRun = 0;
      } else {
        if (block.length) assert.ok(grassBlockOk(block), `grass block before row ${i} (seed ${seed}) is connected`);
        block = [];
        hazardRun++;
        assert.ok(hazardRun <= 5, "at most 5 hazard rows in a row");
      }
      if (row.kind === "road" || row.kind === "river") {
        const objs = [...row.objs].sort((a, b) => a.off - b.off);
        assert.ok(objs.length >= 1);
        assert.ok(row.period >= 680);
        for (let k = 0; k < objs.length; k++) {
          const a = objs[k];
          const b = objs[(k + 1) % objs.length];
          const gap = k + 1 < objs.length ? b.off - (a.off + a.w) : b.off + row.period - (a.off + a.w);
          if (row.kind === "road") {
            const min = Math.abs(row.speed) > 1.6 ? 3 : 2;
            assert.ok(gap >= min * TILE, `road gap ${gap} >= ${min} tiles (row ${i}, seed ${seed})`);
          } else {
            assert.ok(gap >= TILE && gap <= 3 * TILE, `river gap ${gap} within 1..3 tiles (row ${i})`);
          }
        }
        assert.ok(Math.abs(row.speed) >= 0.4 && Math.abs(row.speed) <= 2.75);
      }
      if (row.kind === "river" && rows[i - 1]?.kind === "river") {
        assert.ok(Math.sign(row.speed) === -Math.sign(rows[i - 1].speed), "adjacent rivers flow opposite ways");
      }
      if (row.kind === "rail") {
        assert.ok(row.tram!.period - TRAM_PASS - TRAM_WARN >= 100, "long tram-free window");
      }
    });
  }
});

test("hopper: hopping into water without a log kills", () => {
  const g = new HopperEngine(4);
  g.rows[START_ROW + 1 - g.base] = riverRow(START_ROW + 1, 1, []);
  g.step(UP);
  for (let i = 0; i < HOP + 2 && !g.done; i++) g.step(IDLE);
  assert.ok(g.done);
  assert.equal(g.view().player.cause, "water");
});

test("hopper: a log carries the player", () => {
  const g = new HopperEngine(4);
  // Landing happens on frame HOP; place a 4-tile log so its left edge is at x=100 then.
  const off = 100 + 160 - 1 * HOP;
  g.rows[START_ROW + 1 - g.base] = riverRow(START_ROW + 1, 1, [{ off, w: 4 * TILE }]);
  const x0 = g.view().player.x;
  g.step(UP);
  for (let i = 1; i < HOP; i++) g.step(IDLE);
  let v = g.view();
  assert.equal(v.player.row, START_ROW + 1);
  assert.ok(v.player.riding && !v.player.dead);
  for (let i = 0; i < 10; i++) g.step(IDLE);
  v = g.view();
  assert.ok(!v.player.dead);
  assert.equal(v.player.x, x0 + 10);
});

test("hopper: idling gets caught by the creeping edge", () => {
  const g = hopper.create(9, CTX);
  for (let i = 0; i < 3000 && !g.done; i++) g.step(IDLE);
  assert.ok(g.done);
  assert.equal(g.view().player.cause, "edge");
});

test("hopper: buffered input hops again right after landing", () => {
  const g = new HopperEngine(4);
  g.step(UP);
  g.step(IDLE);
  g.step(UP); // pressed mid-hop: buffered
  for (let i = 0; i < 2 * HOP && !g.done; i++) g.step(IDLE);
  assert.equal(g.view().player.row, START_ROW + 2);
});
