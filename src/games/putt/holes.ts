/*
 * Moon Putt hole data: nine original holes, designed for ArcadePad.
 * World units (the camera scales each hole to fit the portrait field).
 * ArcadePad, GPL-3.0-or-later.
 *
 * Polygons are flat [x0, y0, x1, y1, ...] lists. Zones are rects
 * [x, y, w, h] or circles [cx, cy, r]. Slopes push the ball by (fx, fy)
 * per frame while its centre is inside the rect.
 */

export type Zone = readonly [number, number, number, number] | readonly [number, number, number];

export interface RotorDef {
  x: number; y: number;
  /** Blade length from the hub centre. */
  len: number;
  blades: number;
  /** Byte angles per frame (256 = one turn); negative spins the other way. */
  speed: number;
  phase: number;
}

export interface GateDef {
  /** Centre path endpoints. */
  x1: number; y1: number; x2: number; y2: number;
  w: number; h: number;
  /** Frames for a full there-and-back trip. */
  period: number;
  /** Start offset in frames. */
  phase: number;
}

export interface HoleDef {
  name: string;
  par: number;
  tee: readonly [number, number];
  cup: readonly [number, number];
  outer: readonly number[];
  blocks: readonly (readonly number[])[];
  sand: readonly Zone[];
  water: readonly Zone[];
  slopes: readonly { r: readonly [number, number, number, number]; fx: number; fy: number }[];
  /** [x, y, radius]. */
  bumpers: readonly (readonly [number, number, number])[];
  rotors: readonly RotorDef[];
  gates: readonly GateDef[];
}

/** Axis-aligned rectangle as a polygon. */
function box(x: number, y: number, w: number, h: number): number[] {
  return [x, y, x + w, y, x + w, y + h, x, y + h];
}
/** Rectangle with all four corners cut by c. */
function chamfer(x: number, y: number, w: number, h: number, c: number): number[] {
  return [x + c, y, x + w - c, y, x + w, y + c, x + w, y + h - c, x + w - c, y + h, x + c, y + h, x, y + h - c, x, y + c];
}

export const HOLES: readonly HoleDef[] = [
  {
    name: "FIRST STEP", par: 2,
    tee: [100, 350], cup: [100, 66],
    outer: [30, 0, 170, 0, 200, 30, 200, 400, 0, 400, 0, 30],
    blocks: [[100, 186, 122, 208, 100, 230, 78, 208]],
    sand: [], water: [], slopes: [], bumpers: [], rotors: [], gates: [],
  },
  {
    name: "DOGLEG", par: 3,
    tee: [65, 395], cup: [255, 72],
    outer: [0, 0, 300, 0, 300, 150, 130, 150, 130, 440, 0, 440],
    blocks: [],
    sand: [[180, 112, 56, 38]],
    water: [],
    slopes: [],
    bumpers: [[34, 34, 11]],
    rotors: [], gates: [],
  },
  {
    name: "THE GATE", par: 3,
    tee: [110, 410], cup: [110, 60],
    outer: chamfer(0, 0, 220, 460, 24),
    blocks: [box(0, 222, 75, 16), box(145, 222, 75, 16)],
    sand: [[16, 36, 50, 50], [154, 36, 50, 50]],
    water: [],
    slopes: [],
    bumpers: [],
    rotors: [],
    gates: [{ x1: 85, y1: 230, x2: 135, y2: 230, w: 50, h: 12, period: 180, phase: 0 }],
  },
  {
    name: "CRATER SLOPE", par: 3,
    tee: [200, 400], cup: [80, 60],
    outer: chamfer(0, 0, 260, 440, 40),
    blocks: [],
    sand: [[0, 170, 44, 110]],
    water: [[190, 96, 28]],
    slopes: [{ r: [0, 160, 260, 130], fx: -0.07, fy: 0 }],
    bumpers: [],
    rotors: [], gates: [],
  },
  {
    name: "ROTOR", par: 3,
    tee: [120, 410], cup: [120, 56],
    outer: chamfer(0, 0, 240, 460, 30),
    blocks: [[0, 170, 70, 230, 0, 290], [240, 170, 240, 290, 170, 230]],
    sand: [],
    water: [],
    slopes: [],
    bumpers: [],
    rotors: [{ x: 120, y: 230, len: 46, blades: 3, speed: 0.9, phase: 10 }],
    gates: [],
  },
  {
    name: "BUMPER BOWL", par: 3,
    tee: [160, 340], cup: [160, 66],
    outer: [80, 0, 240, 0, 320, 80, 320, 300, 240, 380, 80, 380, 0, 300, 0, 80],
    blocks: [box(100, 170, 120, 18)],
    sand: [],
    water: [],
    slopes: [],
    bumpers: [[62, 140, 12], [258, 140, 12], [160, 262, 12], [72, 250, 10], [248, 250, 10]],
    rotors: [], gates: [],
  },
  {
    name: "ZIGZAG", par: 4,
    tee: [60, 470], cup: [210, 66],
    outer: chamfer(0, 0, 260, 520, 20),
    blocks: [box(0, 340, 180, 16), box(80, 170, 180, 16)],
    sand: [[100, 24, 56, 40]],
    water: [],
    slopes: [{ r: [0, 186, 260, 154], fx: -0.06, fy: 0 }],
    bumpers: [[226, 262, 10]],
    rotors: [], gates: [],
  },
  {
    name: "TIDE POOL", par: 4,
    tee: [60, 430], cup: [238, 58],
    outer: chamfer(0, 0, 300, 480, 30),
    blocks: [box(196, 96, 74, 12)],
    sand: [[20, 30, 60, 50]],
    water: [[0, 220, 120, 60], [180, 220, 120, 60], [96, 124, 24]],
    slopes: [],
    bumpers: [],
    rotors: [],
    gates: [{ x1: 110, y1: 176, x2: 190, y2: 176, w: 40, h: 10, period: 200, phase: 50 }],
  },
  {
    name: "MOON SHOT", par: 4,
    tee: [130, 500], cup: [130, 66],
    outer: chamfer(0, 0, 260, 540, 30),
    blocks: [[0, 190, 60, 250, 0, 310], [260, 190, 260, 310, 200, 250]],
    sand: [[94, 22, 72, 16]],
    water: [[0, 330, 40, 50]],
    slopes: [{ r: [0, 380, 260, 100], fx: 0, fy: -0.06 }],
    bumpers: [[60, 124, 10], [200, 124, 10]],
    rotors: [{ x: 130, y: 250, len: 50, blades: 4, speed: -0.7, phase: 0 }],
    gates: [],
  },
];
