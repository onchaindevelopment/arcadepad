import { test } from "node:test";
import assert from "node:assert/strict";
import { quest, createQuest, TILE, ROWS, PW, COYOTE, type QuestView } from "./index.ts";
import { LEVELS } from "./levels.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = quest.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = quest.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

const key = (b: number): Input => ({ x: 0, y: 0, b });
function run(g: GameEngine<QuestView>, b: number, n: number) {
  for (let i = 0; i < n; i++) g.step(key(b));
}
const tileAt = (v: QuestView, c: number, r: number) => String.fromCharCode(v.tiles[r * v.cols + c]);

test("quest: levels are well formed", () => {
  assert.ok(LEVELS.length >= 8);
  for (const l of LEVELS) {
    assert.equal(l.map.length, ROWS, l.name);
    const w = l.map[0].length;
    for (const row of l.map) assert.equal(row.length, w, `${l.name}: ragged row`);
    const all = l.map.join("");
    for (const ch of ["P", "C", "F"]) assert.equal(all.split(ch).length - 1, 1, `${l.name}: exactly one ${ch}`);
    assert.match(all, /^[.#X=BT^oMVbgrPCF]+$/, `${l.name}: unknown tile`);
  }
});

test("quest: bot scores and clears levels", () => {
  const { g } = botRun(7, quest.maxFrames);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.ok(r.levelsCleared >= 1, `bot should clear a level (cleared ${r.levelsCleared})`);
});

test("quest: bot runs end (attract mode)", () => {
  let ended = 0;
  for (const seed of [1, 2, 3]) if (botRun(seed, quest.maxFrames).g.done) ended++;
  assert.ok(ended >= 2, `expected bot runs to end, ${ended}/3 did`);
});

test("quest: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, quest.maxFrames);
    const r = replayGame(quest, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("quest: holding jump goes higher than tapping it", () => {
  function apex(holdFrames: number) {
    const g = createQuest(1);
    run(g, 0, 10);
    const y0 = g.view().player.y;
    let top = y0;
    for (let i = 0; i < 60; i++) {
      g.step(key(i < holdFrames ? BTN.UP : 0));
      top = Math.min(top, g.view().player.y);
    }
    return y0 - top;
  }
  const tap = apex(2);
  const hold = apex(40);
  assert.ok(tap > 5 && tap < 40, `tap height ${tap}`);
  assert.ok(hold > 80, `held height ${hold}`);
});

test("quest: jump buffer and coyote time", () => {
  // Buffer: press jump a few frames before landing and it fires on touchdown.
  const g = createQuest(1);
  run(g, 0, 10);
  run(g, BTN.UP, 3); // small hop
  run(g, 0, 1);
  let landedJump = false;
  for (let i = 0; i < 60 && !landedJump; i++) {
    const p = g.view().player;
    const nearGround = p.vy > 0 && p.y > 282 - 8;
    g.step(key(nearGround ? BTN.UP : 0));
    if (g.events.some((e) => e.t === "jump")) landedJump = true;
  }
  assert.ok(landedJump, "buffered press should jump on landing");

  // Coyote: run off the first ledge of Sunny Start (ground ends at column 34) and jump just after.
  const c = createQuest(1);
  let offFor = -1;
  for (let i = 0; i < 1200; i++) {
    const v = c.view();
    if (v.player.x > 34 * TILE + TILE && !v.player.onGround && offFor < 0) offFor = 0;
    if (offFor >= 0) {
      offFor++;
      if (offFor === COYOTE - 2) {
        c.step(key(BTN.RIGHT | BTN.UP));
        assert.ok(c.events.some((e) => e.t === "jump"), "late jump within coyote time");
        return;
      }
    }
    // Hop over the stone steps and foes on the way, otherwise just run.
    const p = v.player;
    const ahead = p.x + PW + 6;
    const col = Math.floor(ahead / TILE);
    const wall = tileAt(v, col, 14) === "X" || tileAt(v, col, 13) === "X";
    const foe = v.enemies.some((e) => e.alive && e.x - (p.x + PW) > -4 && e.x - (p.x + PW) < 36);
    const jump = p.onGround && (wall || foe) && p.x < 30 * TILE;
    c.step(key(BTN.RIGHT | (jump || (!p.onGround && p.vy < 0) ? BTN.UP : 0)));
    if (c.done || c.view().state !== "play") break;
  }
  assert.fail("never reached the ledge");
});

test("quest: bumping a coin block from below pays and uses it up", () => {
  const g = createQuest(1);
  // Sunny Start has a coin block at column 12, row 11.
  while (g.view().player.x + PW / 2 < 12 * TILE + 10) g.step(key(BTN.RIGHT));
  const before = g.view().score;
  run(g, BTN.UP, 30);
  const v = g.view();
  assert.equal(tileAt(v, 12, 11), "U");
  assert.ok(v.score >= before + 100);
});

test("quest: idling loses all three lives", () => {
  const g = createQuest(1);
  for (let i = 0; i < quest.maxFrames && !g.done; i++) g.step(key(0));
  assert.equal(g.result().status, "over");
  assert.equal(g.hud().lives, 0);
});

test("quest: pointer scheme (hold beside to run, press above to jump)", () => {
  const g = createQuest(1);
  run(g, 0, 10);
  const v0 = g.view();
  const sx = v0.player.x + PW / 2 - v0.camX;
  const x0 = v0.player.x;
  // Hold to the right of the mascot at its own height: runs right, no jump.
  for (let i = 0; i < 30; i++) g.step({ x: Math.round(sx + 120), y: Math.round(v0.player.y + 10), b: BTN.FIRE });
  assert.ok(g.view().player.x > x0 + 30, "should run toward the pointer");
  assert.ok(g.view().player.onGround, "pressing beside the mascot must not jump");
  g.step({ x: Math.round(sx + 120), y: Math.round(v0.player.y + 10), b: 0 });
  // Press above the mascot: jumps.
  const v1 = g.view();
  g.step({ x: Math.round(v1.player.x + PW / 2 - v1.camX), y: Math.round(v1.player.y - 60), b: BTN.FIRE });
  assert.ok(g.events.some((e) => e.t === "jump"), "pressing above the mascot jumps");
});
