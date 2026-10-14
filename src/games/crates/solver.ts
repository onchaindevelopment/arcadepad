/*
 * Crate Push: level parsing, dead-cell analysis and a push-optimal BFS solver.
 * ArcadePad, GPL-3.0-or-later. Original code.
 *
 * Deterministic and integer-only, so the engine can run it at level start
 * (optimal push count for scoring, a reference path for the bot) and the
 * server replay gets the same numbers.
 */

/** 0 up, 1 right, 2 down, 3 left. */
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];

export const FLOOR = 0;
export const WALL = 1;
export const OUTSIDE = 2;

export interface Level {
  w: number;
  h: number;
  /** FLOOR / WALL / OUTSIDE per cell (index = r * w + c). */
  cell: Uint8Array;
  goal: Uint8Array;
  crates: number[];
  player: number;
}

/**
 * Rows use '#' wall, ' ' floor, '.' pad, '$' crate, '*' crate on pad,
 * '@' player, '+' player on pad. Floor not reachable from the player becomes
 * OUTSIDE. Throws if the player's area is not enclosed by walls.
 */
export function parseLevel(rows: readonly string[]): Level {
  const h = rows.length;
  let w = 0;
  for (const r of rows) w = Math.max(w, r.length);
  const n = w * h;
  const cell = new Uint8Array(n);
  const goal = new Uint8Array(n);
  const crates: number[] = [];
  let player = -1;
  for (let r = 0; r < h; r++) {
    for (let c = 0; c < w; c++) {
      const ch = rows[r][c] ?? " ";
      const i = r * w + c;
      if (ch === "#") cell[i] = WALL;
      if (ch === "." || ch === "*" || ch === "+") goal[i] = 1;
      if (ch === "$" || ch === "*") crates.push(i);
      if (ch === "@" || ch === "+") player = i;
    }
  }
  if (player < 0) throw new Error("level has no player");
  const seen = new Uint8Array(n);
  const stack = [player];
  seen[player] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const c = i % w, r = (i - c) / w;
    if (c === 0 || r === 0 || c === w - 1 || r === h - 1) throw new Error("level is not enclosed");
    for (let d = 0; d < 4; d++) {
      const j = i + DX[d] + DY[d] * w;
      if (!seen[j] && cell[j] !== WALL) {
        seen[j] = 1;
        stack.push(j);
      }
    }
  }
  let goals = 0;
  for (let i = 0; i < n; i++) {
    if (cell[i] === FLOOR && !seen[i]) {
      cell[i] = OUTSIDE;
      if (goal[i]) throw new Error("pad outside the room");
    }
    if (goal[i]) goals++;
  }
  for (const c of crates) if (cell[c] !== FLOOR) throw new Error("crate outside the room");
  if (goals !== crates.length) throw new Error(`pads (${goals}) != crates (${crates.length})`);
  crates.sort((a, b) => a - b);
  return { w, h, cell, goal, crates, player };
}

/** Level back to rows (for tests and debugging). */
export function levelRows(lv: Level, crates = lv.crates, player = lv.player): string[] {
  const out: string[] = [];
  const cs = new Set(crates);
  for (let r = 0; r < lv.h; r++) {
    let s = "";
    for (let c = 0; c < lv.w; c++) {
      const i = r * lv.w + c;
      if (lv.cell[i] === WALL) s += "#";
      else if (lv.cell[i] === OUTSIDE) s += " ";
      else if (i === player) s += lv.goal[i] ? "+" : "@";
      else if (cs.has(i)) s += lv.goal[i] ? "*" : "$";
      else s += lv.goal[i] ? "." : " ";
    }
    out.push(s.replace(/\s+$/, ""));
  }
  return out;
}

/** Cells a crate can stand on and still reach some pad (reverse pulls from every pad). */
export function liveCells(lv: Level): Uint8Array {
  const { w, cell, goal } = lv;
  const live = new Uint8Array(cell.length);
  const q: number[] = [];
  for (let i = 0; i < cell.length; i++) if (goal[i]) { live[i] = 1; q.push(i); }
  for (let k = 0; k < q.length; k++) {
    const x = q[k];
    for (let d = 0; d < 4; d++) {
      const o = DX[d] + DY[d] * w;
      const y = x + o, z = y + o;
      if (y < 0 || z < 0 || y >= cell.length || z >= cell.length) continue;
      if (!live[y] && cell[y] === FLOOR && cell[z] === FLOOR) {
        live[y] = 1;
        q.push(y);
      }
    }
  }
  return live;
}

/** True when a crate off its pad sits in a frozen 2x2 block of walls and crates. */
export function blockDeadlock(lv: Level, occ: Uint8Array, at: number): boolean {
  const { w, cell, goal } = lv;
  const solid = (i: number) => cell[i] !== FLOOR || occ[i] === 1;
  for (const [ox, oy] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) {
    const a = at + ox + oy * w;
    const sq = [a, a + 1, a + w, a + w + 1];
    let ok = true;
    let loose = false;
    for (const s of sq) {
      if (!solid(s)) { ok = false; break; }
      if (occ[s] && !goal[s]) loose = true;
    }
    if (ok && loose) return true;
  }
  return false;
}

/** Walk (no pushes) from a to b avoiding walls and crates; returns dirs or null. */
export function walkPath(lv: Level, occ: Uint8Array, a: number, b: number): number[] | null {
  if (a === b) return [];
  const { w, cell } = lv;
  const prev = new Int16Array(cell.length).fill(-1);
  const q = [a];
  prev[a] = a;
  for (let k = 0; k < q.length; k++) {
    const x = q[k];
    for (let d = 0; d < 4; d++) {
      const y = x + DX[d] + DY[d] * w;
      if (prev[y] !== -1 || cell[y] !== FLOOR || occ[y]) continue;
      prev[y] = x;
      if (y === b) {
        const out: number[] = [];
        let cur = y;
        while (cur !== a) {
          const p = prev[cur];
          const diff = cur - p;
          out.push(diff === -w ? 0 : diff === 1 ? 1 : diff === w ? 2 : 3);
          cur = p;
        }
        return out.reverse();
      }
      q.push(y);
    }
  }
  return null;
}

export interface Solution {
  pushes: number;
  /** Player steps (dirs) that solve the level from its start. */
  moves: number[];
}

/**
 * Breadth-first search over pushes: the first solved state found has the
 * minimum number of pushes. Returns null if unsolvable or over maxNodes.
 */
export function solve(lv: Level, maxNodes = 200000): Solution | null {
  const { w, cell, goal } = lv;
  const n = cell.length;
  const k = lv.crates.length;
  const live = liveCells(lv);
  const occ = new Uint8Array(n);
  const stamp = new Int32Array(n);
  let mark = 0;
  const fq = new Int32Array(n);

  // Flood the player's area; returns the smallest reachable cell (canonical).
  const flood = (start: number): number => {
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
  const solved = (cr: number[]) => {
    for (const c of cr) if (!goal[c]) return false;
    return true;
  };

  const stCrates: number[][] = [];
  const stPlayer: number[] = [];
  const stParent: number[] = [];
  const stFrom: number[] = [];
  const stDir: number[] = [];
  const stDepth: number[] = [];
  const seen = new Set<number>();

  const start = lv.crates.slice().sort((a, b) => a - b);
  for (const c of start) occ[c] = 1;
  const norm0 = flood(lv.player);
  for (const c of start) occ[c] = 0;
  seen.add(keyOf(start, norm0));
  stCrates.push(start); stPlayer.push(lv.player); stParent.push(-1); stFrom.push(-1); stDir.push(-1); stDepth.push(0);

  let found = solved(start) ? 0 : -1;
  for (let s = 0; s < stCrates.length && found < 0; s++) {
    const cr = stCrates[s];
    for (const c of cr) occ[c] = 1;
    flood(stPlayer[s]);
    const reachMark = mark;
    // Copy reachability because flood() is reused for children.
    const reach: number[] = [];
    for (let i = 0; i < n; i++) if (stamp[i] === reachMark) reach.push(i);
    const reachSet = new Uint8Array(n);
    for (const i of reach) reachSet[i] = 1;
    for (let ci = 0; ci < k && found < 0; ci++) {
      const c = cr[ci];
      for (let d = 0; d < 4; d++) {
        const o = DX[d] + DY[d] * w;
        const from = c - o, to = c + o;
        if (!reachSet[from] || cell[to] !== FLOOR || occ[to] || !live[to]) continue;
        occ[c] = 0; occ[to] = 1;
        const dead = blockDeadlock(lv, occ, to);
        let key = 0;
        let next: number[] = [];
        if (!dead) {
          next = cr.slice();
          next[ci] = to;
          next.sort((a, b) => a - b);
          key = keyOf(next, flood(c));
        }
        occ[to] = 0; occ[c] = 1;
        if (dead || seen.has(key)) continue;
        seen.add(key);
        stCrates.push(next); stPlayer.push(c); stParent.push(s); stFrom.push(c); stDir.push(d); stDepth.push(stDepth[s] + 1);
        if (solved(next)) { found = stCrates.length - 1; break; }
        if (stCrates.length > maxNodes) {
          for (const x of cr) occ[x] = 0;
          return null;
        }
      }
    }
    for (const c of cr) occ[c] = 0;
  }
  if (found < 0) return null;

  // Rebuild the player path push by push.
  const chain: number[] = [];
  for (let s = found; s > 0; s = stParent[s]) chain.push(s);
  chain.reverse();
  const moves: number[] = [];
  let pos = lv.player;
  let prevState = 0;
  for (const s of chain) {
    const before = stCrates[prevState];
    for (const c of before) occ[c] = 1;
    const d = stDir[s];
    const from = stFrom[s] - (DX[d] + DY[d] * w);
    const walk = walkPath(lv, occ, pos, from)!;
    for (const c of before) occ[c] = 0;
    moves.push(...walk, d);
    pos = stFrom[s];
    prevState = s;
  }
  return { pushes: stDepth[found], moves };
}

/** Play moves from the level start; returns pushes made and whether it ends solved. */
export function playMoves(lv: Level, moves: readonly number[]): { solved: boolean; pushes: number; valid: boolean } {
  const { w, cell, goal } = lv;
  const occ = new Uint8Array(cell.length);
  for (const c of lv.crates) occ[c] = 1;
  let p = lv.player, pushes = 0;
  for (const d of moves) {
    const o = DX[d] + DY[d] * w;
    const t = p + o;
    if (cell[t] !== FLOOR) return { solved: false, pushes, valid: false };
    if (occ[t]) {
      const u = t + o;
      if (cell[u] !== FLOOR || occ[u]) return { solved: false, pushes, valid: false };
      occ[t] = 0; occ[u] = 1; pushes++;
    }
    p = t;
  }
  let solved = true;
  for (let i = 0; i < cell.length; i++) if (occ[i] && !goal[i]) solved = false;
  return { solved, pushes, valid: true };
}
