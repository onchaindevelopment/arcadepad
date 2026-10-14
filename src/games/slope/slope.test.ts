import { test } from "node:test";
import assert from "node:assert/strict";
import {
  slope, SlopeEngine, TrackGen, BLOCK, COLS, FLIGHT_MAX, FLIGHT_MIN, FLOOR, HOLE, MAX_SPEED, R, RAMP, ROW_LEN,
  START_SPEED, BASE_SLOPE, isSafe, type Row,
} from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

const CTX = { ticker: "TEST" };

function botRun(seed: number, frames: number, mash = false) {
  const g = slope.create(seed, CTX);
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    let inp = slope.bot!(g.view(), i);
    // Mix in pointer steering so replays cover both input paths.
    if (mash && i > 300 && i % 211 < 30) inp = { x: 40 + ((i * 7) % 280), y: 300, b: 0 };
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

test("slope: bot rolls, collects coins and scores", () => {
  let best = 0;
  for (const seed of [1, 5, 7]) {
    const { g } = botRun(seed, 12000);
    const r = g.result();
    assert.ok(r.score > 0, "bot should score");
    best = Math.max(best, r.score);
  }
  assert.ok(best > 1000, `bot should get well past the start, best ${best}`);
});

test("slope: bot eventually crashes (attract mode ends)", () => {
  const { g } = botRun(11, slope.maxFrames);
  assert.equal(g.result().status, "over");
  assert.ok(g.result().frames < slope.maxFrames);
});

test("slope: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, 8000, true);
    const r = replayGame(slope, seed, CTX, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
    assert.ok(r.frames > 0);
  }
});

/**
 * Independent reachability search over generated rows. A ball at (row, col)
 * can roll on to the next row in the same column, shift one column if both
 * columns stay safe for m+1 rows (m = rows needed to move one unit sideways
 * in 16 frames at this speed), or fly off a ramp and land in the same column
 * after the gap, provided the gap ends before the shortest flight and the
 * whole landing window is safe.
 */
function passable(rows: Row[], speeds: number[]): { ok: boolean; at: number } {
  const n = rows.length;
  const reach: Set<number>[] = Array.from({ length: n }, () => new Set<number>());
  for (let c = 0; c < COLS; c++) if (isSafe(rows[0].cells[c])) reach[0].add(c);
  const safe = (r: number, c: number) => r >= n || (c >= 0 && c < COLS && isSafe(rows[r].cells[c]));
  for (let r = 0; r < n - 1; r++) {
    const sp = speeds[r];
    const m = Math.max(1, Math.ceil((16 * sp) / ROW_LEN));
    for (const c of reach[r]) {
      if (rows[r].cells[c] === RAMP && rows[r + 1].cells[c] === HOLE) {
        const zEnd = (rows[r].i + 1) * ROW_LEN;
        let rf = r + 1;
        while (rf < n && rows[rf].cells[c] === HOLE) rf++;
        if (rf >= n) continue;
        if (rows[rf].i * ROW_LEN + R > zEnd + FLIGHT_MIN * sp) continue; // gap too long to clear
        const zLast = zEnd + FLIGHT_MAX * (sp + 0.03);
        let ok = true, rl = rf;
        for (; rl < n && rows[rl].i * ROW_LEN < zLast; rl++) if (!safe(rl, c)) ok = false;
        if (ok && rl < n) reach[rl].add(c);
        continue;
      }
      if (safe(r + 1, c)) reach[r + 1].add(c);
      for (const d of [-1, 1]) {
        const c2 = c + d;
        let ok = c2 >= 0 && c2 < COLS;
        for (let j = 0; ok && j <= m; j++) if (!safe(r + j, c) || !safe(r + j, c2)) ok = false;
        if (ok && r + m < n) reach[r + m].add(c2);
      }
    }
    if (reach[r + 1].size === 0) {
      // Allow rows only reachable by flight further on.
      let any = false;
      for (let q = r + 1; q < Math.min(n, r + 40); q++) if (reach[q].size) any = true;
      if (!any) return { ok: false, at: r };
    }
    reach[r] = new Set(); // free memory as we go
  }
  return { ok: reach[n - 1].size > 0, at: n - 1 };
}

test("slope: generated tracks always have a passable path over long distances", () => {
  const kinds = new Set<string>();
  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    const gen = new TrackGen(seed);
    const rows: Row[] = [];
    const speeds: number[] = [];
    let speed = START_SPEED;
    while (rows.length < 4000) {
      const c = gen.chunk(speed);
      kinds.add(c.kind);
      for (const r of c.rows) {
        assert.equal(r.cells.length, COLS);
        assert.equal(r.i, rows.length);
        rows.push(r);
        speeds.push(speed);
      }
      speed = Math.min(MAX_SPEED + 0.01, speed + 0.004);
    }
    const res = passable(rows, speeds);
    assert.ok(res.ok, `seed ${seed}: no passable path at row ${res.at}`);
  }
  for (const k of ["plain", "holes", "blocks", "bridge", "ramp", "gates"]) assert.ok(kinds.has(k), `chunk kind ${k} never generated`);
});

// ---------------------------------------------------------------- scripted rule tests
function flat(i: number, cells?: number[], walls = false): Row {
  return { i, cells: cells ?? new Array(COLS).fill(FLOOR), e0: BASE_SLOPE * ROW_LEN * i, e1: BASE_SLOPE * ROW_LEN * (i + 1), wallL: walls, wallR: walls };
}
const idle = { x: 180, y: 300, b: 0 };

test("slope: steering off the edge ends the run", () => {
  const g = new SlopeEngine(1, { track: (i) => flat(i) });
  for (let i = 0; i < 600 && !g.done; i++) g.step({ x: 180, y: 300, b: BTN.LEFT });
  assert.equal(g.result().status, "over");
  assert.equal(g.view().crash?.kind, "fall");
  assert.ok(g.x < -3.5, "fell off the left edge");
});

test("slope: side walls bounce instead of dropping the ball", () => {
  const g = new SlopeEngine(1, { track: (i) => flat(i, undefined, true) });
  let bumps = 0;
  for (let i = 0; i < 600 && !g.done; i++) {
    g.step({ x: 180, y: 300, b: BTN.LEFT });
    bumps += g.events.filter((e) => e.t === "wall").length;
  }
  assert.equal(g.result().status, "playing");
  assert.ok(bumps >= 1);
});

test("slope: hitting a block head-on ends the run; steering around it survives", () => {
  const track = (i: number) => {
    const cells = new Array(COLS).fill(FLOOR);
    if (i === 15) cells[3] = BLOCK; // straight ahead of the start position
    return flat(i, cells);
  };
  const g = new SlopeEngine(1, { track });
  for (let i = 0; i < 600 && !g.done; i++) g.step(idle);
  assert.equal(g.result().status, "over");
  assert.equal(g.view().crash?.kind, "block");

  const s = new SlopeEngine(1, { track });
  for (let i = 0; i < 600 && !s.done; i++) s.step({ x: 180, y: 300, b: i < 12 ? BTN.RIGHT : 0 });
  assert.equal(s.result().status, "playing");
  assert.ok(s.z > 40);
});

test("slope: holes swallow the ball; ramps launch it over gaps", () => {
  const hole = new SlopeEngine(1, { track: (i) => flat(i, new Array(COLS).fill(i >= 10 && i < 12 ? HOLE : FLOOR)) });
  for (let i = 0; i < 600 && !hole.done; i++) hole.step(idle);
  assert.equal(hole.view().crash?.kind, "fall");

  const ramp = new SlopeEngine(1, {
    track: (i) => flat(i, new Array(COLS).fill(i === 10 ? RAMP : i === 11 ? HOLE : FLOOR)),
  });
  let launched = false;
  for (let i = 0; i < 600 && !ramp.done; i++) {
    ramp.step(idle);
    if (ramp.events.some((e) => e.t === "launch")) launched = true;
  }
  assert.ok(launched);
  assert.equal(ramp.result().status, "playing");
});

test("slope: pointer steers toward its x position", () => {
  const g = new SlopeEngine(1, { track: (i) => flat(i) });
  for (let i = 0; i < 120; i++) g.step({ x: 290, y: 300, b: 0 });
  const tx = ((290 - 180) * 7.6) / 360;
  assert.ok(Math.abs(g.x - tx) < 0.1, `x ${g.x} should approach ${tx}`);
});
