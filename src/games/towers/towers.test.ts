import { test } from "node:test";
import assert from "node:assert/strict";
import {
  towers, TowersEngine, MAPS, parseMap, rankSpots, cellCX, cellCY, TOWERS, TILE, START_COINS, START_LIVES, GO_BTN, COLS, ROWS,
} from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = towers.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = towers.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const idle: Input = { x: 0, y: 0, b: 0 };
function tap(g: TowersEngine, x: number, y: number, b: number = BTN.FIRE) {
  g.step({ x, y, b });
  g.step({ x, y, b: 0 });
}

test("towers: all maps trace a single path from row 0 to the base", () => {
  for (const rows of MAPS) {
    const m = parseMap(rows);
    assert.ok(m.cells.length >= 25, "path long enough");
    assert.equal(m.tiles[m.cells[m.cells.length - 1]], TILE.BASE);
    assert.ok(m.tiles.filter((t) => t === TILE.FREE).length > 50);
  }
});

test("towers: bot scores and the run ends", () => {
  const { g } = botRun(7, towers.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(r.levelsCleared >= 3, "bot should survive a few waves");
  assert.ok(g.done, "run should end");
});

test("towers: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, towers.maxFrames);
    const r = replayGame(towers, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.score > 0);
  }
});

test("towers: tapping a free cell opens the build menu and builds; path cells can't be built", () => {
  const g = new TowersEngine(1, 0);
  const v = g.view();
  const pathCell = v.pathCells[3];
  tap(g, cellCX(pathCell), cellCY(pathCell));
  assert.equal(g.view().menu, null);
  const spot = rankSpots(v, 80)[0].cell;
  tap(g, cellCX(spot), cellCY(spot));
  const menu = g.view().menu!;
  assert.equal(menu.cell, spot);
  assert.equal(menu.options.length, 4);
  const opt = menu.options[0]; // Coin Blaster
  tap(g, opt.x, opt.y);
  const after = g.view();
  assert.equal(after.towers.length, 1);
  assert.equal(after.towers[0].type, 0);
  assert.equal(after.coins, START_COINS - TOWERS[0].cost[0]);
  assert.equal(after.menu, null);
  // Upgrade then sell via keyboard: FIRE opens, RIGHT -> sell, FIRE confirms.
  g.step({ x: cellCX(spot), y: cellCY(spot), b: BTN.LEFT }); // keyboard mode, cursor moves left
  g.step({ x: cellCX(spot), y: cellCY(spot), b: 0 });
  g.step({ x: cellCX(spot), y: cellCY(spot), b: BTN.RIGHT });
  g.step({ x: cellCX(spot), y: cellCY(spot), b: 0 });
  assert.equal(g.view().cursor, spot);
  tap(g, cellCX(spot), cellCY(spot)); // FIRE in keyboard mode opens the tower menu
  assert.equal(g.view().menu!.options[0].kind, "upgrade");
  tap(g, cellCX(spot), cellCY(spot)); // confirm upgrade (sel 0)
  assert.equal(g.view().towers[0].level, 1);
  const coins = g.view().coins;
  tap(g, cellCX(spot), cellCY(spot)); // open
  g.step({ x: cellCX(spot), y: cellCY(spot), b: BTN.RIGHT });
  g.step({ x: cellCX(spot), y: cellCY(spot), b: 0 });
  tap(g, cellCX(spot), cellCY(spot)); // confirm sell
  const sold = g.view();
  assert.equal(sold.towers.length, 0);
  assert.equal(sold.coins, coins + Math.floor(((TOWERS[0].cost[0] + TOWERS[0].cost[1]) * 7) / 10));
});

test("towers: unaffordable builds are refused", () => {
  const g = new TowersEngine(1, 0);
  const spot = rankSpots(g.view(), 80)[0].cell;
  g.coins = 10;
  tap(g, cellCX(spot), cellCY(spot));
  const opt = g.view().menu!.options[3]; // Laser, 50
  assert.equal(opt.ok, false);
  tap(g, opt.x, opt.y);
  assert.equal(g.view().towers.length, 0);
  assert.equal(g.view().coins, 10);
});

test("towers: starting early pays a bonus; undefended creeps cost lives", () => {
  const g = new TowersEngine(3, 1);
  const before = g.view();
  assert.ok(before.earlyBonus > 0);
  tap(g, GO_BTN.x + 10, GO_BTN.y + 10);
  const v = g.view();
  assert.equal(v.wave, 1);
  assert.equal(v.coins, START_COINS + before.earlyBonus);
  for (let i = 0; i < 4000 && g.view().lives === START_LIVES; i++) g.step(idle);
  assert.ok(g.view().lives < START_LIVES);
});

test("towers: targeting picks the creep nearest to the base", () => {
  const g = new TowersEngine(1, 0);
  g.step({ x: 0, y: 0, b: BTN.ALT });
  // Let two creeps spawn and walk, then place a laser covering both.
  for (let i = 0; i < 200; i++) g.step(idle);
  const cs = g.view().creeps;
  assert.ok(cs.length >= 2);
  const lead = cs.reduce((a, b) => (b.d > a.d ? b : a));
  let best = -1;
  for (let cell = 0; cell < COLS * ROWS; cell++) {
    if (g.view().tiles[cell] !== TILE.FREE) continue;
    const ok = cs.every((c) => (c.x - cellCX(cell)) ** 2 + (c.y - cellCY(cell)) ** 2 <= 110 * 110);
    if (ok) { best = cell; break; }
  }
  assert.ok(best >= 0);
  g.coins = 500;
  tap(g, cellCX(best), cellCY(best));
  const opt = g.view().menu!.options[3];
  g.step({ x: opt.x, y: opt.y, b: BTN.FIRE });
  for (let i = 0; i < 12; i++) {
    const hit = g.events.find((e) => e.t === "beam");
    if (hit) {
      const tgt = g.view().creeps.find((c) => c.id === lead.id) ?? lead;
      assert.ok(Math.abs((hit.tx as number) - tgt.x) < 2 && Math.abs((hit.ty as number) - tgt.y) < 2);
      return;
    }
    g.step(idle);
  }
  assert.fail("laser never fired");
});
