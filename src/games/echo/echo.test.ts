import { test } from "node:test";
import assert from "node:assert/strict";
import { echo, FIVE_ROUND, SIX_ROUND, HEART_ROUND, LAYOUTS, PAD_BTN, PAD_SFX, padAt, inputTimeout, type EchoView } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type GameEngine, type GameEvent, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };
type G = GameEngine<EchoView>;

function botRun(seed: number, frames = echo.maxFrames) {
  const g = echo.create(seed, CTX);
  const inputs: Input[] = [];
  const events: GameEvent[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = echo.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
    events.push(...g.events);
  }
  return { g, inputs, events };
}

/** Idle (pointer parked, no buttons) until pred or the run ends. */
function idleUntil(g: G, pred: (v: EchoView) => boolean, max = 20000) {
  for (let i = 0; i < max && !g.done; i++) {
    if (pred(g.view())) return true;
    g.step({ x: 180, y: 300, b: 0 });
  }
  return pred(g.view());
}

/** Press a pad with its key (arrows, Space, X) and release. */
function key(g: G, pad: number) {
  g.step({ x: 180, y: 300, b: PAD_BTN[pad] });
  const ev = [...g.events];
  g.step({ x: 180, y: 300, b: 0 });
  return ev;
}

/** Play the current round perfectly with keys. */
function playRound(g: G) {
  assert.ok(idleUntil(g, (v) => v.phase === "input"));
  const seq = g.view().seq;
  for (const p of seq) key(g, p);
}

test("echo: padAt maps every pad centre back to its index", () => {
  for (let l = 0; l < LAYOUTS.length; l++) {
    LAYOUTS[l].forEach((p, i) => assert.equal(padAt(l, p.x, p.y), i));
    assert.equal(padAt(l, 2, 2), -1);
  }
  assert.equal(new Set(PAD_SFX).size, PAD_SFX.length, "every pad has its own sound");
});

test("echo: bot scores and the run ends", () => {
  const { g, events } = botRun(7);
  const r = g.result();
  assert.ok(r.score > 0, "bot should score");
  assert.notEqual(r.status, "playing");
  assert.ok(events.some((e) => e.t === "flash"));
  assert.ok(events.some((e) => e.t === "clear"));
});

test("echo: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed);
    const r = replayGame(echo, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("echo: each cleared round adds one step; score is the sum of lengths", () => {
  const g = echo.create(5, CTX);
  for (let r = 1; r <= 5; r++) {
    assert.equal(g.view().round, r);
    playRound(g);
    assert.ok(idleUntil(g, (v) => v.phase === "watch" || v.phase === "show"));
  }
  assert.equal(g.view().round, 6);
  assert.equal(g.result().score, 1 + 2 + 3 + 4 + 5);
  // The old steps are kept: the sequence only grows.
  assert.equal(g.view().seq.length, 6);
});

test("echo: one wrong pad ends the run before round 10", () => {
  const g = echo.create(9, CTX);
  playRound(g);
  playRound(g);
  assert.ok(idleUntil(g, (v) => v.phase === "input"));
  const want = g.view().seq[0];
  const ev = key(g, (want + 1) % 4);
  assert.ok(ev.some((e) => e.t === "miss" && e.why === "wrong"));
  assert.equal(g.done, true);
  assert.equal(g.result().status, "over");
  assert.equal(g.result().score, 3);
});

test("echo: waiting too long is a miss", () => {
  const g = echo.create(4, CTX);
  assert.ok(idleUntil(g, (v) => v.phase === "input"));
  const f0 = g.frame;
  idleUntil(g, () => false, 1000);
  assert.equal(g.done, true);
  assert.equal(g.view().missWhy, "timeout");
  assert.equal(g.frame - f0, inputTimeout(1));
});

test("echo: second-chance heart at round 10 saves exactly one mistake", () => {
  const g = echo.create(12, CTX);
  for (let r = 1; r < HEART_ROUND; r++) playRound(g);
  assert.ok(idleUntil(g, (v) => v.round === HEART_ROUND));
  assert.equal(g.view().hearts, 1);
  assert.ok(idleUntil(g, (v) => v.phase === "input"));
  const want = g.view().seq[0];
  key(g, (want + 2) % 4);
  assert.equal(g.done, false);
  assert.equal(g.view().hearts, 0);
  assert.equal(g.view().phase, "miss");
  // The same sequence plays again; a second mistake ends it.
  assert.ok(idleUntil(g, (v) => v.phase === "input"));
  assert.equal(g.view().round, HEART_ROUND);
  key(g, (g.view().seq[0] + 1) % 4);
  assert.equal(g.done, true);
});

test("echo: 5th pad from round 12 (Space), 6th from round 18 (X); pointer taps work", () => {
  const g = echo.create(3, CTX);
  for (let r = 1; r < FIVE_ROUND; r++) {
    playRound(g);
    if (g.view().hearts === 0 && g.view().heartGiven) assert.fail("should not have missed");
  }
  assert.ok(idleUntil(g, (v) => v.round === FIVE_ROUND));
  let v = g.view();
  assert.equal(v.layout, 1);
  assert.equal(v.pads.length, 5);
  assert.equal(v.seq[FIVE_ROUND - 1], 4, "first new step uses the new pad");
  for (let r = FIVE_ROUND; r < SIX_ROUND; r++) playRound(g);
  assert.ok(idleUntil(g, (v) => v.round === SIX_ROUND));
  v = g.view();
  assert.equal(v.layout, 2);
  assert.equal(v.seq[SIX_ROUND - 1], 5);
  assert.equal(g.result().score, ((SIX_ROUND - 1) * SIX_ROUND) / 2);

  // Pointer: move onto each required pad, then tap.
  assert.ok(idleUntil(g, (v) => v.phase === "input"));
  for (const p of g.view().seq) {
    const pad = g.view().pads[p];
    g.step({ x: pad.x + 5, y: pad.y - 5, b: 0 });
    g.step({ x: pad.x + 5, y: pad.y - 5, b: BTN.FIRE });
    assert.ok(g.events.some((e) => e.t === "tap" && e.pad === p), `pointer tap on pad ${p}`);
    g.step({ x: pad.x + 5, y: pad.y - 5, b: 0 });
  }
  assert.equal(g.result().score, (SIX_ROUND * (SIX_ROUND + 1)) / 2);
});
