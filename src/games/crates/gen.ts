/*
 * Crate Push: deterministic level generator (reverse search).
 * ArcadePad, GPL-3.0-or-later. Original code.
 *
 * Carve a small room and put the crates on their pads. Then search
 * backwards: breadth-first over *pulls* (a push played in reverse) from the
 * solved position. Every state found at depth d needs exactly d pushes to
 * solve, so the deepest state with no crate on a pad is a solvable,
 * puzzle whose optimal push count is known; walking the search tree back
 * up gives a reference solution (used by the bot).
 */
import type { Rng } from "../core/rng.ts";
import { DX, DY, FLOOR, OUTSIDE, WALL, liveCells, walkPath, type Level, type Solution } from "./solver.ts";

export interface Generated {
  level: Level;
  solution: Solution;
}

function carveRoom(rng: Rng, w: number, h: number, density: number): Uint8Array | null {
  const n = w * h;
  const cell = new Uint8Array(n).fill(WALL);
  for (let r = 1; r < h - 1; r++) for (let c = 1; c < w - 1; c++) {
    if (rng.int(100) >= density) cell[r * w + c] = FLOOR;
  }
  // Fill dead ends (floor with 3+ solid sides): tighter, cleaner rooms.
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < n; i++) {
      if (cell[i] !== FLOOR) continue;
      let solid = 0;
      for (let d = 0; d < 4; d++) if (cell[i + DX[d] + DY[d] * w] !== FLOOR) solid++;
      if (solid >= 3) cell[i] = WALL;
    }
  }
  // Keep the largest connected area.
  const comp = new Int16Array(n).fill(-1);
  let best = -1, bestSize = 0, id = 0;
  for (let i = 0; i < n; i++) {
    if (cell[i] !== FLOOR || comp[i] >= 0) continue;
    const st = [i];
    comp[i] = id;
    let size = 0;
    while (st.length) {
      const x = st.pop()!;
      size++;
      for (let d = 0; d < 4; d++) {
        const y = x + DX[d] + DY[d] * w;
        if (cell[y] === FLOOR && comp[y] < 0) { comp[y] = id; st.push(y); }
      }
    }
    if (size > bestSize) { bestSize = size; best = id; }
    id++;
  }
  if (best < 0) return null;
  for (let i = 0; i < n; i++) if (cell[i] === FLOOR && comp[i] !== best) cell[i] = WALL;
  // Walls not touching the room become OUTSIDE (drawn as empty space).
  for (let i = 0; i < n; i++) {
    if (cell[i] !== WALL) continue;
    const c = i % w, r = (i - c) / w;
    let touches = false;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cc = c + dx, rr = r + dy;
      if (cc >= 0 && rr >= 0 && cc < w && rr < h && cell[rr * w + cc] === FLOOR) touches = true;
    }
    if (!touches) cell[i] = OUTSIDE;
  }
  return cell;
}

/**
 * Reverse BFS from the solved position. Returns the deepest start found
 * (crates all off their pads) and its depth in pushes.
 */
function deepestStart(rng: Rng, w: number, cell: Uint8Array, goal: Uint8Array, maxNodes: number): { crates: number[]; player: number; depth: number; pushes: { at: number; dir: number }[] } | null {
  const n = cell.length;
  const occ = new Uint8Array(n);
  const stamp = new Int32Array(n);
  const fq = new Int32Array(n);
  let mark = 0;
  const flood = (start: number) => {
    mark++;
    let head = 0, tail = 0, min = start;
    fq[tail++] = start;
    stamp[start] = mark;
    while (head < tail) {
      const x = fq[head++];
      if (x < min) min = x;
      for (let d = 0; d < 4; d++) {
        const y = x + DX[d] + DY[d] * w;
        if (stamp[y] === mark || cell[y] !== FLOOR || occ[y]) continue;
        stamp[y] = mark;
        fq[tail++] = y;
      }
    }
    return min;
  };
  const keyOf = (cr: number[], norm: number) => {
    let key = 0;
    for (const c of cr) key = key * n + c;
    return key * n + norm;
  };

  const goals: number[] = [];
  for (let i = 0; i < n; i++) if (goal[i]) goals.push(i);
  const stCrates: number[][] = [];
  const stPlayer: number[] = [];
  const stDepth: number[] = [];
  const stParent: number[] = [];
  const stAt: number[] = [];
  const stDir: number[] = [];
  const seen = new Set<number>();
  // Every player area around the solved position is a start.
  for (const g of goals) occ[g] = 1;
  for (let i = 0; i < n; i++) {
    if (cell[i] !== FLOOR || occ[i]) continue;
    const norm = flood(i);
    const key = keyOf(goals, norm);
    if (seen.has(key)) continue;
    seen.add(key);
    stCrates.push(goals.slice()); stPlayer.push(i); stDepth.push(0); stParent.push(-1); stAt.push(-1); stDir.push(-1);
  }
  for (const g of goals) occ[g] = 0;

  const reachSet = new Uint8Array(n);
  for (let s = 0; s < stCrates.length && stCrates.length < maxNodes; s++) {
    const cr = stCrates[s];
    for (const c of cr) occ[c] = 1;
    flood(stPlayer[s]);
    const m = mark;
    for (let i = 0; i < n; i++) reachSet[i] = stamp[i] === m ? 1 : 0;
    for (let ci = 0; ci < cr.length; ci++) {
      const c = cr[ci];
      for (let d = 0; d < 4; d++) {
        const o = DX[d] + DY[d] * w;
        const p = c + o, q = p + o; // player stands at p, steps back to q, crate follows to p
        if (!reachSet[p] || cell[q] !== FLOOR || occ[q]) continue;
        occ[c] = 0; occ[p] = 1;
        const next = cr.slice();
        next[ci] = p;
        next.sort((a, b) => a - b);
        const key = keyOf(next, flood(q));
        occ[p] = 0; occ[c] = 1;
        if (seen.has(key)) continue;
        seen.add(key);
        stCrates.push(next); stPlayer.push(q); stDepth.push(stDepth[s] + 1); stParent.push(s); stAt.push(p); stDir.push((d + 2) & 3);
      }
    }
    for (const c of cr) occ[c] = 0;
  }
  // Deepest states with every crate off its pad; pick one with the rng.
  for (let depth = stDepth[stDepth.length - 1]; depth > 0; depth--) {
    const pick: number[] = [];
    for (let s = stDepth.length - 1; s >= 0 && stDepth[s] >= depth; s--) {
      if (stDepth[s] !== depth) continue;
      if (stCrates[s].every((c) => !goal[c])) pick.push(s);
    }
    if (pick.length) {
      const s = pick[rng.int(pick.length)];
      // Forward pushes: from s back up to a solved root.
      const pushes: { at: number; dir: number }[] = [];
      for (let x = s; stParent[x] >= 0; x = stParent[x]) pushes.push({ at: stAt[x], dir: stDir[x] });
      return { crates: stCrates[s], player: stPlayer[s], depth, pushes };
    }
  }
  return null;
}

/** Settings per difficulty tier (0 = first generated level). */
export function tierSpec(tier: number) {
  return {
    crates: Math.min(4, 2 + Math.floor(tier / 3)),
    w: Math.min(9, 7 + Math.floor(tier / 4)),
    h: Math.min(10, 7 + Math.floor(tier / 3)),
  };
}

/** Trim rows/columns that hold only OUTSIDE cells. */
function crop(lv: Level, pushes: { at: number; dir: number }[]): { level: Level; pushes: { at: number; dir: number }[] } {
  const { w, h, cell } = lv;
  let c0 = w, c1 = -1, r0 = h, r1 = -1;
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === OUTSIDE) continue;
    const c = i % w, r = (i - c) / w;
    c0 = Math.min(c0, c); c1 = Math.max(c1, c); r0 = Math.min(r0, r); r1 = Math.max(r1, r);
  }
  const nw = c1 - c0 + 1, nh = r1 - r0 + 1;
  const map = (i: number) => {
    const c = i % w, r = (i - c) / w;
    return (r - r0) * nw + (c - c0);
  };
  const ncell = new Uint8Array(nw * nh).fill(OUTSIDE);
  const ngoal = new Uint8Array(nw * nh);
  for (let i = 0; i < cell.length; i++) {
    if (cell[i] === OUTSIDE) continue;
    ncell[map(i)] = cell[i];
    ngoal[map(i)] = lv.goal[i];
  }
  return {
    level: { w: nw, h: nh, cell: ncell, goal: ngoal, crates: lv.crates.map(map).sort((a, b) => a - b), player: map(lv.player) },
    pushes: pushes.map((p) => ({ at: map(p.at), dir: p.dir })),
  };
}

function attempt(rng: Rng, tier: number): Generated | null {
  const spec = tierSpec(tier);
  const w = spec.w + rng.int(2), h = spec.h;
  const cell = carveRoom(rng, w, h, 22 + rng.int(12));
  if (!cell) return null;
  const n = w * h;
  const floors: number[] = [];
  for (let i = 0; i < n; i++) if (cell[i] === FLOOR) floors.push(i);
  if (floors.length < spec.crates * 4 + 6 || floors.length > 40) return null;
  const goal = new Uint8Array(n);
  for (let k = 0; k < spec.crates; k++) {
    let g = -1;
    for (let tries = 0; tries < 30 && g < 0; tries++) {
      const c = floors[rng.int(floors.length)];
      if (!goal[c]) g = c;
    }
    if (g < 0) return null;
    goal[g] = 1;
  }
  const tmp: Level = { w, h, cell, goal, crates: [], player: floors[0] };
  // Pads must be able to receive crates from somewhere.
  const live = liveCells(tmp);
  let liveCount = 0;
  for (let i = 0; i < n; i++) if (live[i]) liveCount++;
  if (liveCount < spec.crates * 3) return null;
  const start = deepestStart(rng, w, cell, goal, 30000);
  if (!start || start.depth < 4) return null;
  const cropped = crop({ w, h, cell, goal, crates: start.crates, player: start.player }, start.pushes);
  const level = cropped.level;
  const lw = level.w;
  const occ = new Uint8Array(level.cell.length);
  for (const c of level.crates) occ[c] = 1;
  const moves: number[] = [];
  let pos = level.player;
  for (const pu of cropped.pushes) {
    const o = DX[pu.dir] + DY[pu.dir] * lw;
    const walk = walkPath(level, occ, pos, pu.at - o);
    if (!walk) return null; // cannot happen (reverse search guarantees it)
    moves.push(...walk, pu.dir);
    occ[pu.at] = 0;
    occ[pu.at + o] = 1;
    pos = pu.at;
  }
  const solution: Solution = { pushes: start.depth, moves };
  return { level, solution };
}

/**
 * A solvable level for the given tier. Tries a few rooms and keeps the one
 * needing the most pushes. Null only if every attempt failed (caller falls
 * back to a hand-made level).
 */
export function generateLevel(rng: Rng, tier: number): Generated | null {
  let best: Generated | null = null;
  let found = 0;
  const want = Math.min(30, 10 + tier * 2);
  for (let i = 0; i < 40 && found < 4; i++) {
    const g = attempt(rng, tier);
    if (!g) continue;
    found++;
    if (!best || g.solution.pushes > best.solution.pushes) best = g;
    if (best.solution.pushes >= want) break;
  }
  return best;
}
