/*
 * engine.test.ts - tests for the engine (node --test src/engine/).
 * Port of LBreakout2 (C) 2001-2015 Michael Speck and contributors,
 * GPL-2.0-or-later; this file GPL-3.0-or-later.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { Game } from "./game.ts";
import { Rng } from "./rng.ts";
import { parseLevelFile, serializeLevels } from "./level.ts";
import { OWN_LEVELS, RANKED_LEVELS, runLevels, tickerLevel } from "./levels.ts";
import { InputRecorder, decodeInputs, encodeInputs, replay } from "./replay.ts";
import { BRICK_H, BRICK_W, MAP_H } from "./types.ts";
import type { FrameInput, GameView, LevelDef, RunConfig } from "./types.ts";

/** Simple bot: follow the lowest ball, aim a bit off-centre, keep firing. */
function botInput(v: GameView): FrameInput {
  let target = v.paddle.x + v.paddle.w / 2;
  let lowest = -1;
  for (const b of v.balls) {
    if (!b.attached && b.y > lowest) {
      lowest = b.y;
      target = b.x + (((v.frame >> 9) % 5) - 2) * 6;
    }
  }
  return { x: Math.round(target), fire: v.status === "serve" || v.frame % 40 < 20 };
}

function hashView(h: number, v: GameView): number {
  const mix = (n: number): void => {
    h = Math.imul(h ^ (Math.round(n * 1000) | 0), 0x01000193) >>> 0;
  };
  mix(v.frame); mix(v.score); mix(v.lives); mix(v.level); mix(v.bricks.length);
  for (const b of v.balls) { mix(b.x); mix(b.y); }
  mix(v.paddle.x); mix(v.paddle.w);
  for (const e of v.extras) { mix(e.x); mix(e.y); }
  return h;
}

function playBot(cfg: RunConfig, maxFrames: number): { inputs: FrameInput[]; hash: number; game: Game } {
  const game = new Game(cfg);
  const rec = new InputRecorder();
  let v = game.view();
  let h = 0x811c9dc5;
  for (let f = 0; f < maxFrames && !game.done; f++) {
    const raw = botInput(v);
    v = game.step(rec.record(raw.x, raw.fire));
    h = hashView(h, v);
  }
  return { inputs: rec.inputs, hash: h, game };
}

test("level file parse/serialize round-trip", () => {
  const levels: LevelDef[] = [...OWN_LEVELS, tickerLevel("PEPE42"), tickerLevel("$BTC")];
  const text = serializeLevels(levels);
  const parsed = parseLevelFile(text);
  assert.deepEqual(parsed, levels);
  assert.equal(serializeLevels(parsed), text);
  /* CRLF, no version line */
  const crlf = text.split("\n").slice(1).join("\r\n");
  assert.deepEqual(parseLevelFile(crlf), levels);
  for (const l of levels) {
    assert.equal(l.bricks.length, 18);
    assert.equal(l.bonus.length, 18);
    for (const r of [...l.bricks, ...l.bonus]) assert.equal(r.length, 14);
  }
});

test("ticker level spells up to 6 chars and runLevels has 5 levels", () => {
  const l = tickerLevel("doge!!xyz");
  assert.equal(l.title, "$DOGEXY");
  assert.ok(l.bricks.join("").replace(/\./g, "").length > 30);
  assert.equal(runLevels("WIF").length, 5);
  assert.equal(RANKED_LEVELS.length, 5);
});

test("determinism: same seed and inputs give identical runs", () => {
  const cfg: RunConfig = { seed: 12345, levels: runLevels("ABC") };
  const a = playBot(cfg, 20000);
  const b = new Game(cfg);
  let h = 0x811c9dc5;
  for (const inp of a.inputs) h = hashView(h, b.step(inp));
  assert.equal(h, a.hash);
  assert.deepEqual(b.result(), a.game.result());
});

test("replay(encode(recorded)) equals the live result", () => {
  for (const seed of [7, 99]) {
    const cfg: RunConfig = { seed, levels: runLevels("MOON") };
    const live = playBot(cfg, 12000);
    const enc = encodeInputs(live.inputs);
    assert.deepEqual(replay(cfg, enc), live.game.result());
  }
});

test("bot clears the ticker level for several seeds", (t) => {
  for (const seed of [1, 2, 3, 4]) {
    const cfg: RunConfig = { seed, levels: runLevels("PEPE") };
    const { game, inputs } = playBot(cfg, 15 * 60 * 60);
    const r = game.result();
    t.diagnostic(`seed ${seed}: cleared ${r.levelsCleared}, score ${r.score}, frames ${r.frames}, status ${r.status}`);
    assert.ok(r.levelsCleared >= 1, `seed ${seed} did not clear the ticker level`);
    if (seed === 1) {
      const n = Math.min(inputs.length, 3 * 60 * 60);
      const enc = encodeInputs(inputs.slice(0, n));
      t.diagnostic(`encoded replay: ${n} frames -> ${enc.length} chars`);
    }
  }
});

interface BallInternal { x: number; y: number; attached: boolean; movingBack: boolean }

test("no ball escapes through walls or bricks at high speed", () => {
  const rng = new Rng(4242);
  let checked = 0;
  for (let run = 0; run < 16; run++) {
    const first = OWN_LEVELS[run % OWN_LEVELS.length];
    const game = new Game({ seed: 1000 + run, levels: [first, ...OWN_LEVELS], lives: 5 });
    let x = 320;
    for (let f = 0; f < 6000 && !game.done; f++) {
      x += rng.range(-30, 30);
      if (x < 0) x = 0;
      if (x > 640) x = 640;
      if (run % 2 === 0) {
        /* half the runs: mostly keep the ball in play */
        const v0 = game.view();
        const low = v0.balls.reduce((m, b) => (b.y > m.y ? b : m), { x, y: -1 });
        if (low.y > 0) x = Math.round(low.x);
      }
      game.setBallSpeed(0.65); // 1.5x the normal maximum
      const v = game.step({ x, fire: rng.int(4) === 0 });
      const balls = (game as unknown as { balls: BallInternal[] }).balls;
      for (const b of balls) {
        if (b.attached || b.movingBack) continue;
        const cx = b.x + 6;
        const cy = b.y + 6;
        assert.ok(cx >= 40 + 6 - 0.6 && cx <= 600 - 6 + 0.6, `ball left side walls at ${cx},${cy}`);
        assert.ok(cy >= 20 + 6 - 0.6, `ball went through the top wall at ${cx},${cy}`);
        for (const br of v.bricks) {
          if (br.row >= MAP_H - 1) continue;
          const x0 = br.col * BRICK_W;
          const y0 = br.row * BRICK_H;
          const dx = Math.max(x0 - cx, 0, cx - (x0 + BRICK_W));
          const dy = Math.max(y0 - cy, 0, cy - (y0 + BRICK_H));
          assert.ok(dx * dx + dy * dy >= 5 * 5, `ball overlaps brick ${br.col},${br.row} at ${cx},${cy}`);
        }
        checked++;
      }
    }
  }
  assert.ok(checked > 20000, `too few ball positions checked: ${checked}`);
});

test("encode/decode round-trip", () => {
  const rng = new Rng(77);
  const inputs: FrameInput[] = [];
  let x = 320;
  for (let i = 0; i < 5000; i++) {
    const mode = rng.int(4);
    if (mode === 0) x = rng.int(641);
    else if (mode === 1) x = Math.max(0, Math.min(640, x + rng.range(-5, 5)));
    inputs.push({ x, fire: rng.int(3) === 0 });
  }
  inputs.push({ x: 0, fire: false }, { x: 640, fire: true }, { x: 640, fire: true });
  const enc = encodeInputs(inputs);
  assert.match(enc, /^[A-Za-z0-9_-]*$/);
  assert.deepEqual(decodeInputs(enc), inputs);
  assert.deepEqual(decodeInputs(encodeInputs([])), []);
  /* non-integer input is quantised like the engine does */
  assert.deepEqual(decodeInputs(encodeInputs([{ x: 100.6, fire: true }])), [{ x: 101, fire: true }]);
});
