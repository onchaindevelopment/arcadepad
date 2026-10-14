/*
 * Moon Tiles: original stacked tile-matching solitaire for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Original implementation of the genre (no code,
 * names, layouts or art taken from any existing game).
 *
 * Rules: tiles are stacked in layers. A tile is FREE when no tile lies on top
 * of it and its left or right side is open. Tap two free tiles with the same
 * face to remove them. Clear the layout and the next one is dealt.
 *   - score: 10 per pair, + combo bonus for quick successive matches,
 *     + a time bonus for every cleared layout
 *   - HINT (ALT / button) shows a pair and resets the combo
 *   - SHUFFLE (button, or automatic when stuck) re-deals the remaining faces
 *     into a solvable order and costs points; a few per run
 * The run lasts 5 minutes, or ends when stuck with no shuffles left.
 *
 * Every deal is solvable: faces are assigned by simulating a removal order on
 * the empty layout (two currently-free tiles per step, picked with the Rng)
 * and giving each removed pair the same face, so playing that order backwards
 * rebuilds the deal pair by pair. Integer logic only; randomness only from Rng.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

export const FIELD_W = 360;
export const FIELD_H = 600;
/** Tile face size and per-layer depth offset (px). */
export const TW = 36;
export const TH = 48;
export const DEPTH = 5;
/** Area the layout is centred in. */
export const BOARD_TOP = 84;
export const BOARD_BOTTOM = 546;

/** Faces: 6 symbols x 3 colours, plus 3 mascot poses (faces 18..20). */
export const SYMBOLS = 6;
export const TINTS = 3;
export const FACES = SYMBOLS * TINTS + 3;

export const RUN_FRAMES = 5 * 60 * 60;
export const DEAL_FRAMES = 40;
export const CLEAR_FRAMES = 90;
export const SHUFFLE_FRAMES = 36;
export const STUCK_FRAMES = 75; // pause before an automatic shuffle
export const HINT_FRAMES = 150;
export const COMBO_WINDOW = 150; // frames between matches to keep a combo
export const PAIR_POINTS = 10;
export const SHUFFLE_COST = 30;
export const START_SHUFFLES = 3;
export const MAX_SHUFFLES = 5;
const MAX_FRAMES = RUN_FRAMES + 60 * 60;

/** On-screen buttons (pointer). */
export const BTN_Y = 556;
export const BTN_H = 36;
export const HINT_BTN = { x: 10, y: BTN_Y, w: 104, h: BTN_H };
export const SHUF_BTN = { x: FIELD_W - 114, y: BTN_Y, w: 104, h: BTN_H };

// ---------- Layouts ----------
// Positions in half-tile units: a tile at (hx, hy) covers [hx, hx+2) x [hy, hy+2).

export interface Slot { hx: number; hy: number; z: number }
export interface Layout { name: string; slots: Slot[] }

function rect(out: Slot[], z: number, c: number, r: number, w: number, h: number, skip: [number, number][] = []) {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (skip.some(([sx, sy]) => sx === x && sy === y)) continue;
      out.push({ hx: (c + x) * 2, hy: (r + y) * 2, z });
    }
}

function pyramid(): Layout {
  const s: Slot[] = [];
  rect(s, 0, 0, 0, 7, 8, [[0, 0], [6, 0], [0, 7], [6, 7]]);
  rect(s, 1, 1, 1, 5, 6);
  rect(s, 2, 2, 3, 3, 2);
  rect(s, 3, 2.5, 3.5, 2, 1);
  return { name: "Pyramid", slots: s };
}

function diamond(): Layout {
  const s: Slot[] = [];
  const layers = [
    [2, 4, 6, 8, 8, 6, 4, 2],
    [2, 4, 6, 6, 4, 2],
    [2, 4, 4, 2],
    [2, 2],
  ];
  layers.forEach((rows, z) => rows.forEach((w, i) => rect(s, z, (8 - w) / 2, z + i, w, 1)));
  return { name: "Diamond", slots: s };
}

function twinPeaks(): Layout {
  const s: Slot[] = [];
  rect(s, 0, 0, 0, 3, 8);
  rect(s, 0, 6, 0, 3, 8);
  rect(s, 0, 3, 3, 3, 2);
  rect(s, 1, 0.5, 1, 2, 6);
  rect(s, 1, 6.5, 1, 2, 6);
  rect(s, 1, 3.5, 3.5, 2, 1);
  rect(s, 2, 1, 2, 1, 4);
  rect(s, 2, 7, 2, 1, 4);
  return { name: "Twin Peaks", slots: s };
}

export const LAYOUTS: readonly Layout[] = [pyramid(), diamond(), twinPeaks()];

// ---------- Freeness ----------

export interface Tile { id: number; hx: number; hy: number; z: number; face: number; alive: boolean }

/** A tile is free if nothing overlaps it from the layer above and one side is open. */
export function isFree(t: Slot, tiles: readonly Slot[], alive: (i: number) => boolean): boolean {
  let left = false, right = false;
  for (let i = 0; i < tiles.length; i++) {
    const o = tiles[i];
    if (o === t || !alive(i)) continue;
    const dy = o.hy - t.hy;
    if (dy <= -2 || dy >= 2) continue;
    const dx = o.hx - t.hx;
    if (o.z === t.z + 1 && dx > -2 && dx < 2) return false;
    if (o.z === t.z) {
      if (dx === -2) left = true;
      else if (dx === 2) right = true;
    }
  }
  return !(left && right);
}

/**
 * Assign paired faces to the live slots so they can be cleared: simulate a
 * removal order (two free tiles per step) and give each pair one face from the
 * pool. Returns faces per slot index (-1 for dead slots) or null if the
 * simulation got stuck.
 */
export function solvableFaces(slots: readonly Slot[], live: readonly boolean[], pool: readonly number[], rng: Rng): number[] | null {
  const n = slots.length;
  const present = live.slice();
  const faces = new Array<number>(n).fill(-1);
  let left = 0;
  for (let i = 0; i < n; i++) if (present[i]) left++;
  let k = 0;
  while (left > 0) {
    const free: number[] = [];
    for (let i = 0; i < n; i++) if (present[i] && isFree(slots[i], slots, (j) => present[j])) free.push(i);
    if (free.length < 2) return null;
    const a = free.splice(rng.int(free.length), 1)[0];
    const b = free[rng.int(free.length)];
    faces[a] = faces[b] = pool[k++];
    present[a] = present[b] = false;
    left -= 2;
  }
  return faces;
}

function shuffleInPlace<T>(arr: T[], rng: Rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const t = arr[i];
    arr[i] = arr[j];
    arr[j] = t;
  }
}

// ---------- View ----------

export interface TileView { id: number; hx: number; hy: number; z: number; face: number; free: boolean; x: number; y: number }

export type Phase = "deal" | "play" | "stuck" | "shuffle" | "clear" | "over";

export interface TilesView {
  frame: number;
  phase: Phase;
  /** Frames spent in the current phase. */
  phaseT: number;
  tiles: TileView[];
  /** Pairs of free tiles with equal faces (tile ids). */
  pairs: [number, number][];
  selected: number;
  cursor: number;
  keyCursor: boolean;
  hint: [number, number] | null;
  timeLeft: number;
  score: number;
  combo: number;
  shuffles: number;
  layoutNo: number;
  layoutName: string;
  total: number;
  over: boolean;
}

const NONE: Input = { x: 0, y: 0, b: 0 };

export class TilesEngine implements GameEngine<TilesView> {
  private rng: Rng;
  tiles: Tile[] = [];
  private ox = 0;
  private oy = 0;
  private layoutNo = 0;
  phase: Phase = "deal";
  private phaseT = 0;
  private selected = -1;
  private cursor = -1;
  private keyCursor = false;
  private hint: [number, number] | null = null;
  private hintUntil = 0;
  timeLeft = RUN_FRAMES;
  score = 0;
  private combo = 0;
  private lastMatch = -9999;
  shuffles = START_SHUFFLES;
  private layoutStart = 0;
  private cleared = 0;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private over = false;
  private freeCache: boolean[] = [];
  private pairCache: [number, number][] = [];
  frame = 0;
  events: GameEvent[] = [];

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.deal();
  }

  // ----- setup -----

  private deal() {
    const layout = LAYOUTS[this.layoutNo % LAYOUTS.length];
    const slots = layout.slots;
    const pairs = slots.length >> 1;
    const pool: number[] = [];
    for (let i = 0; i < pairs; i++) pool.push(i % FACES);
    let faces: number[] | null = null;
    while (!faces) {
      shuffleInPlace(pool, this.rng);
      faces = solvableFaces(slots, slots.map(() => true), pool, this.rng);
    }
    this.tiles = slots.map((s, i) => ({ id: i, hx: s.hx, hy: s.hy, z: s.z, face: faces![i], alive: true }));
    // Centre the layout's screen bounding box in the board area.
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
    for (const t of this.tiles) {
      const x = (t.hx * TW) / 2 - t.z * DEPTH, y = (t.hy * TH) / 2 - t.z * DEPTH;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x + TW + DEPTH);
      maxY = Math.max(maxY, y + TH + DEPTH);
    }
    this.ox = Math.floor((FIELD_W - (maxX - minX)) / 2 - minX);
    this.oy = Math.floor(BOARD_TOP + (BOARD_BOTTOM - BOARD_TOP - (maxY - minY)) / 2 - minY);
    this.selected = -1;
    this.hint = null;
    this.layoutStart = this.frame;
    this.refresh();
    this.cursor = this.firstFree();
    this.setPhase("deal");
  }

  private setPhase(p: Phase) {
    this.phase = p;
    this.phaseT = 0;
  }

  tileX(t: Tile) {
    return this.ox + (t.hx * TW) / 2 - t.z * DEPTH;
  }
  tileY(t: Tile) {
    return this.oy + (t.hy * TH) / 2 - t.z * DEPTH;
  }

  private refresh() {
    const alive = (i: number) => this.tiles[i].alive;
    this.freeCache = this.tiles.map((t) => t.alive && isFree(t, this.tiles, alive));
    const pairs: [number, number][] = [];
    for (let i = 0; i < this.tiles.length; i++) {
      if (!this.freeCache[i]) continue;
      for (let j = i + 1; j < this.tiles.length; j++)
        if (this.freeCache[j] && this.tiles[j].face === this.tiles[i].face) pairs.push([i, j]);
    }
    this.pairCache = pairs;
  }

  private firstFree() {
    for (let i = 0; i < this.tiles.length; i++) if (this.freeCache[i]) return i;
    return -1;
  }

  private aliveCount() {
    let n = 0;
    for (const t of this.tiles) if (t.alive) n++;
    return n;
  }

  /** Topmost live tile whose face contains the point, or -1. */
  tileAt(x: number, y: number): number {
    let best = -1;
    for (let i = 0; i < this.tiles.length; i++) {
      const t = this.tiles[i];
      if (!t.alive) continue;
      const tx = this.tileX(t), ty = this.tileY(t);
      if (x < tx || x >= tx + TW || y < ty || y >= ty + TH) continue;
      if (best < 0 || t.z > this.tiles[best].z || (t.z === this.tiles[best].z && i > best)) best = i;
    }
    return best;
  }

  // ----- step -----

  step(inp: Input) {
    this.frame++;
    this.phaseT++;
    this.events = [];
    if (this.over) return;
    if (this.frame >= MAX_FRAMES) return this.finish("time");

    if (this.phase === "deal") {
      this.prevB = inp.b;
      if (this.phaseT >= DEAL_FRAMES) this.setPhase("play");
      return;
    }
    if (this.phase === "clear") {
      this.prevB = inp.b;
      if (this.phaseT >= CLEAR_FRAMES) {
        this.layoutNo++;
        this.deal();
      }
      return;
    }

    this.timeLeft--;
    if (this.timeLeft <= 0) {
      this.timeLeft = 0;
      return this.finish("time");
    }
    if (this.hint && this.frame >= this.hintUntil) this.hint = null;

    if (this.phase === "shuffle") {
      this.prevB = inp.b;
      if (this.phaseT >= SHUFFLE_FRAMES) this.setPhase("play");
      return;
    }

    this.handleInput(inp);
    if (this.over || this.phase !== "play" && this.phase !== "stuck") return;

    if (this.phase === "play" && this.pairCache.length === 0) {
      if (this.shuffles <= 0) return this.finish("stuck");
      this.setPhase("stuck");
      this.selected = -1;
      this.events.push({ t: "stuck", sfx: "extraBad", mood: "sad" });
    } else if (this.phase === "stuck" && this.phaseT >= STUCK_FRAMES) {
      this.doShuffle();
    }
  }

  private handleInput(inp: Input) {
    const pressed = inp.b & ~this.prevB;
    this.prevB = inp.b;
    const moved = inp.x !== this.px || inp.y !== this.py;
    this.px = inp.x;
    this.py = inp.y;
    const here = this.tileAt(inp.x, inp.y);
    if (moved && here >= 0) {
      this.cursor = here;
      this.keyCursor = false;
    } else if (moved) this.keyCursor = false;

    if (pressed & BTN.ALT) this.useHint();

    const dirs: [number, number, number][] = [
      [BTN.UP, 0, -1],
      [BTN.DOWN, 0, 1],
      [BTN.LEFT, -1, 0],
      [BTN.RIGHT, 1, 0],
    ];
    for (const [bit, dx, dy] of dirs) {
      if (!(pressed & bit)) continue;
      this.keyCursor = true;
      this.moveCursor(dx, dy);
      break;
    }

    if (!(pressed & BTN.FIRE)) return;
    if (!this.keyCursor) {
      if (inside(inp.x, inp.y, HINT_BTN)) return this.useHint();
      if (inside(inp.x, inp.y, SHUF_BTN)) {
        if (this.shuffles > 0) this.doShuffle();
        else this.events.push({ t: "noshuffle", sfx: "wall" });
        return;
      }
    }
    const target = this.keyCursor ? this.cursor : here;
    if (target < 0 || !this.tiles[target].alive) {
      if (this.selected >= 0) {
        this.selected = -1;
        this.events.push({ t: "deselect" });
      }
      return;
    }
    this.cursor = target;
    this.tapTile(target);
  }

  private moveCursor(dx: number, dy: number) {
    const cur = this.cursor >= 0 && this.tiles[this.cursor].alive ? this.tiles[this.cursor] : null;
    if (!cur) {
      this.cursor = this.firstFree();
      return;
    }
    const cx = this.tileX(cur) * 2 + TW, cy = this.tileY(cur) * 2 + TH;
    let best = -1, bestScore = 1e9;
    for (let i = 0; i < this.tiles.length; i++) {
      if (i === this.cursor || !this.freeCache[i]) continue;
      const t = this.tiles[i];
      const ex = this.tileX(t) * 2 + TW - cx, ey = this.tileY(t) * 2 + TH - cy;
      const along = ex * dx + ey * dy;
      const across = Math.abs(ex * dy - ey * dx);
      if (along <= 0 || across > along * 2) continue;
      const s = along + across * 2;
      if (s < bestScore) {
        bestScore = s;
        best = i;
      }
    }
    if (best >= 0) this.cursor = best;
  }

  private tapTile(i: number) {
    const t = this.tiles[i];
    const cx = this.tileX(t) + TW / 2, cy = this.tileY(t) + TH / 2;
    if (this.phase === "stuck") return;
    if (!this.freeCache[i]) {
      this.events.push({ t: "blocked", id: i, sfx: "wall", shake: 2, x: cx, y: cy });
      return;
    }
    if (this.selected === i) {
      this.selected = -1;
      this.events.push({ t: "deselect" });
      return;
    }
    if (this.selected >= 0 && this.tiles[this.selected].face === t.face) {
      this.match(this.selected, i);
      return;
    }
    if (this.selected >= 0) this.events.push({ t: "mismatch", id: i, sfx: "paddle", x: cx, y: cy });
    else this.events.push({ t: "select", id: i, sfx: "paddle", x: cx, y: cy });
    this.selected = i;
  }

  private match(a: number, b: number) {
    const ta = this.tiles[a], tb = this.tiles[b];
    ta.alive = tb.alive = false;
    this.selected = -1;
    this.hint = null;
    this.combo = this.frame - this.lastMatch <= COMBO_WINDOW && this.combo > 0 ? this.combo + 1 : 1;
    this.lastMatch = this.frame;
    const bonus = Math.min(50, (this.combo - 1) * 5);
    const gain = PAIR_POINTS + bonus;
    this.score += gain;
    const big = this.combo >= 3;
    this.events.push({
      t: "match",
      sfx: big ? "extraGood" : "brickgone",
      mood: big ? "happy" : undefined,
      shake: big ? 3 : 1,
      face: ta.face,
      gain,
      combo: this.combo,
      ax: this.tileX(ta) + TW / 2, ay: this.tileY(ta) + TH / 2,
      bx: this.tileX(tb) + TW / 2, by: this.tileY(tb) + TH / 2,
      a, b,
      x: (this.tileX(ta) + this.tileX(tb)) / 2 + TW / 2,
      y: (this.tileY(ta) + this.tileY(tb)) / 2 + TH / 2,
    });
    this.refresh();
    if (this.cursor >= 0 && !this.freeCache[this.cursor]) this.cursor = this.nearestFree(ta);
    if (this.aliveCount() === 0) this.clearLayout();
  }

  private nearestFree(from: Tile) {
    let best = -1, bd = 1e9;
    for (let i = 0; i < this.tiles.length; i++) {
      if (!this.freeCache[i]) continue;
      const t = this.tiles[i];
      const d = Math.abs(t.hx - from.hx) + Math.abs(t.hy - from.hy);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    return best;
  }

  private clearLayout() {
    const secs = Math.floor((this.frame - this.layoutStart) / 60);
    const bonus = 100 + Math.max(0, 150 - secs) * 2;
    this.score += bonus;
    this.cleared++;
    this.shuffles = Math.min(MAX_SHUFFLES, this.shuffles + 1);
    this.events.push({ t: "levelclear", sfx: "levelclear", toast: "levelClear", mood: "happy", bonus, x: FIELD_W / 2, y: FIELD_H / 2 });
    this.setPhase("clear");
  }

  private useHint() {
    if (this.phase !== "play") return;
    if (this.pairCache.length === 0) return;
    this.hint = this.pairCache[0];
    this.hintUntil = this.frame + HINT_FRAMES;
    this.combo = 0;
    this.events.push({ t: "hint", sfx: "shot", a: this.hint[0], b: this.hint[1] });
  }

  private doShuffle() {
    if (this.shuffles <= 0) return;
    const live = this.tiles.map((t) => t.alive);
    const faces = this.tiles.filter((t) => t.alive).map((t) => t.face).sort((a, b) => a - b);
    const pool: number[] = [];
    for (let i = 0; i < faces.length; i += 2) pool.push(faces[i]);
    let out: number[] | null = null;
    for (let tries = 0; tries < 40 && !out; tries++) {
      shuffleInPlace(pool, this.rng);
      out = solvableFaces(this.tiles, live, pool, this.rng);
    }
    if (!out) return this.finish("stuck");
    this.shuffles--;
    const cost = Math.min(this.score, SHUFFLE_COST);
    this.score -= cost;
    for (let i = 0; i < this.tiles.length; i++) if (this.tiles[i].alive) this.tiles[i].face = out[i];
    this.selected = -1;
    this.hint = null;
    this.combo = 0;
    this.refresh();
    if (this.cursor < 0 || !this.freeCache[this.cursor]) this.cursor = this.firstFree();
    this.events.push({ t: "shuffle", sfx: "launch", shake: 4, cost });
    this.setPhase("shuffle");
  }

  private finish(reason: "time" | "stuck") {
    this.over = true;
    this.selected = -1;
    this.setPhase("over");
    this.events.push({ t: "gameover", reason, sfx: "gameover", mood: this.score > 0 ? "happy" : "sad", score: this.score });
  }

  // ----- read -----

  view(): TilesView {
    const tiles: TileView[] = [];
    for (const t of this.tiles)
      if (t.alive) tiles.push({ id: t.id, hx: t.hx, hy: t.hy, z: t.z, face: t.face, free: this.freeCache[t.id], x: this.tileX(t), y: this.tileY(t) });
    return {
      frame: this.frame,
      phase: this.phase,
      phaseT: this.phaseT,
      tiles,
      pairs: this.pairCache,
      selected: this.selected,
      cursor: this.cursor,
      keyCursor: this.keyCursor,
      hint: this.hint,
      timeLeft: this.timeLeft,
      score: this.score,
      combo: this.combo,
      shuffles: this.shuffles,
      layoutNo: this.layoutNo,
      layoutName: LAYOUTS[this.layoutNo % LAYOUTS.length].name,
      total: this.tiles.length,
      over: this.over,
    };
  }
  hud(): Hud {
    const s = Math.ceil(this.timeLeft / 60);
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    return { score: this.score, level: this.layoutNo + 1, label: this.combo >= 2 ? `${clock}  x${this.combo}` : clock };
  }
  result(): GameResult {
    return { score: this.score, level: this.layoutNo, levelsCleared: this.cleared, frames: this.frame, status: this.over ? "over" : "playing" };
  }
  get done() {
    return this.over;
  }
}

function inside(x: number, y: number, r: { x: number; y: number; w: number; h: number }) {
  return x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
}

const centre = (v: TilesView, id: number) => {
  const t = v.tiles.find((q) => q.id === id);
  return t ? { x: Math.floor(t.x + TW / 2), y: Math.floor(t.y + TH / 2) } : { x: FIELD_W >> 1, y: BTN_Y - 20 };
};

export const tiles: GameDef<TilesView> = {
  id: "tiles",
  name: "Moon Tiles",
  tagline: "Unstack the tower two by two. Free tiles only, five minutes on the clock.",
  genre: "Tile-matching solitaire",
  session: "5 min",
  controls: "Tap two free matching tiles. Keys: arrows move, Space picks, X for a hint.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: MAX_FRAMES,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of the stacked tile-matching genre: rules, layouts, solvable dealer, scoring and all art written for ArcadePad. No code, names, tile sets, layouts or sounds from any existing game.",
  },
  create: (seed) => new TilesEngine(seed),
  bot(v, frame) {
    // Taps a pair every so often. Takes the pairs in list order (not the
    // smartest choice) and now and then fumbles a wrong tile first.
    if (v.over || v.phase !== "play") return NONE;
    const beat = 24;
    if (frame % beat !== 0) return { ...centre(v, v.selected >= 0 ? v.selected : v.cursor), b: 0 };
    if (v.selected >= 0) {
      const sel = v.tiles.find((t) => t.id === v.selected);
      const mate = sel && v.tiles.find((t) => t.free && t.id !== sel.id && t.face === sel.face);
      return { ...centre(v, mate ? mate.id : v.selected), b: BTN.FIRE };
    }
    if (!v.pairs.length) return NONE;
    const k = Math.floor(frame / beat);
    if (k % 7 === 3) {
      const free = v.tiles.filter((t) => t.free);
      if (free.length) return { ...centre(v, free[k % free.length].id), b: BTN.FIRE };
    }
    const pick = v.pairs[(k * 7) % Math.min(4, v.pairs.length)];
    return { ...centre(v, pick[0]), b: BTN.FIRE };
  },
};
