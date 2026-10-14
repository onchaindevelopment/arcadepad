// Moon Slope renderer: neon tile track rolling downhill into the distance,
// seen from behind and above the ball. Client only; may use Math freely.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BLOCK, BLOCK_H, BLOCK_HW, BLOCK_Z0, BLOCK_Z1, COLS, FIELD_H, FIELD_W, HALF, HOLE, R, RAMP, RAMP_H, ROW_LEN,
  START_SPEED, MAX_SPEED, colX, rowElev, type Coin, type Row, type SlopeView,
} from "./index.ts";

// ---------------------------------------------------------------- camera
const CX = FIELD_W / 2;
const HORIZON = 175;
const CAM_BACK = 5.5;
const CAM_H = 5.6;
const F = 290; // ~53 px per unit at the ball, so the 7-wide track just fits
const NEAR = 0.6;
const FAR = 152;
const FOG_START = 45;
const BALL_SCREEN_Y = HORIZON + (CAM_H * F) / CAM_BACK;

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number, alpha = 1): string {
  const x = rgb(a), y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return alpha >= 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
}
function rgba(hex: string, a: number): string {
  const c = rgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

type Pt = [number, number, number];

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SlopeView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const ink = p.ink;
  const coinColor = p.bricks[4] ?? p.accent;
  const tileA = mix(p.bg, p.secondary, 0.28);
  const tileB = mix(p.bg, p.secondary, 0.38);
  const slab = mix(p.bg, p.secondary, 0.12);
  const slabSide = mix(slab, ink, 0.2);
  const rampCol = mix(p.bg, p.primary, 0.45);
  const stars = Array.from({ length: 70 }, () => ({
    x: Math.random() * FIELD_W,
    y: Math.random() * (HORIZON + 10),
    s: Math.random() < 0.15 ? 2 : 1,
    p: Math.random() * 6.28,
  }));
  let t = 0;
  let camZ = 0, camX = 0, camY = CAM_H, tilt = 0;
  let lastFrame = -1;
  const trail: { x: number; y: number; z: number }[] = [];

  const P = (x: number, y: number, z: number): Pt => {
    const s = F / Math.max(NEAR, z - camZ);
    return [CX + (x - camX) * s, HORIZON + (camY - y) * s, s];
  };
  const fog = (z: number) => {
    const dz = z - camZ;
    if (dz <= FOG_START) return 1;
    const f = 1 - (dz - FOG_START) / (FAR - FOG_START);
    return f <= 0 ? 0 : f * f * (3 - 2 * f);
  };

  function poly(pts: Pt[] | number[][], fill: string | null, stroke?: string, lw = 1) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  /** Several quads in one path (one fill, optional one stroke). */
  function polys(list: Pt[][], fill: string, stroke?: string, lw = 1) {
    if (!list.length) return;
    ctx.beginPath();
    for (const q of list) {
      ctx.moveTo(q[0][0], q[0][1]);
      for (let i = 1; i < q.length; i++) ctx.lineTo(q[i][0], q[i][1]);
      ctx.closePath();
    }
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = lw;
      ctx.stroke();
    }
  }
  /** Neon segments (pairs of points) in two batched strokes. */
  function glowSegs(pts: Pt[], color: string, w: number) {
    if (!pts.length) return;
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 2) {
      ctx.moveTo(pts[i][0], pts[i][1]);
      ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
    }
    ctx.strokeStyle = rgba(color, 0.28);
    ctx.lineWidth = w * 3.2;
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  }
  /** Neon line: a wide soft stroke under a thin bright one. */
  function glow(a: Pt, b: Pt, color: string, w: number) {
    ctx.lineCap = "round";
    ctx.strokeStyle = rgba(color, 0.28);
    ctx.lineWidth = w * 3.2;
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.stroke();
  }

  // ---------------------------------------------------------------- sky + void
  function drawSky(v: SlopeView) {
    const g = ctx.createLinearGradient(0, -10, 0, HORIZON + 40);
    g.addColorStop(0, mix(p.bg, ink, 0.5));
    g.addColorStop(0.6, p.bg);
    g.addColorStop(0.9, p.bg2);
    g.addColorStop(1, mix(p.bg2, p.accent, 0.35));
    ctx.fillStyle = g;
    ctx.fillRect(-20, -20, FIELD_W + 40, HORIZON + 60);
    const below = ctx.createLinearGradient(0, HORIZON + 40, 0, FIELD_H);
    below.addColorStop(0, p.bg2);
    below.addColorStop(1, mix(p.bg, ink, 0.4));
    ctx.fillStyle = below;
    ctx.fillRect(-20, HORIZON + 40, FIELD_W + 40, FIELD_H);
    // Stars (twinkle, slight parallax with steering).
    for (const s of stars) {
      ctx.globalAlpha = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(t / 420 + s.p));
      ctx.fillStyle = s.s > 1 ? p.text : p.primary;
      const x = (((s.x - camX * 3) % FIELD_W) + FIELD_W) % FIELD_W;
      ctx.fillRect(Math.round(x), Math.round(s.y), s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // Ringed planet low on the horizon.
    const px = 92 - camX * 5, py = HORIZON - 34, r = 34;
    ctx.save();
    ctx.globalAlpha = 0.9;
    const pg = ctx.createLinearGradient(px, py - r, px, py + r);
    pg.addColorStop(0, p.accent);
    pg.addColorStop(1, p.secondary);
    ctx.fillStyle = pg;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgba(p.bg, 0.35);
    for (let i = 0; i < 4; i++) ctx.fillRect(px - r, py + 4 + i * 8, r * 2, 2 + i);
    ctx.strokeStyle = rgba(p.primary, 0.8);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(px, py, r * 1.7, r * 0.32, -0.25, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Horizon glow line.
    const hy = HORIZON + 6;
    const hg = ctx.createLinearGradient(0, hy - 14, 0, hy + 14);
    hg.addColorStop(0, rgba(p.accent, 0));
    hg.addColorStop(0.5, rgba(p.accent, 0.35));
    hg.addColorStop(1, rgba(p.accent, 0));
    ctx.fillStyle = hg;
    ctx.fillRect(-20, hy - 14, FIELD_W + 40, 28);
    void v;
  }

  /** A deep neon grid far below the track: the void you fall into. */
  function drawVoid() {
    const yPlane = camY - 26;
    ctx.lineWidth = 1;
    const step = 6;
    const start = Math.ceil((camZ + 2) / step) * step;
    for (let z = start; z < camZ + FAR; z += step) {
      const [, sy] = P(0, yPlane, z);
      if (sy > FIELD_H + 10) continue;
      ctx.strokeStyle = rgba(p.secondary, 0.3 * fog(z));
      ctx.beginPath();
      ctx.moveTo(-20, sy);
      ctx.lineTo(FIELD_W + 20, sy);
      ctx.stroke();
    }
    ctx.strokeStyle = rgba(p.secondary, 0.22);
    for (let k = -14; k <= 14; k++) {
      const x = Math.round(camX / 5) * 5 + k * 5;
      const a = P(x, yPlane, camZ + 3), b = P(x, yPlane, camZ + FAR);
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
    }
  }

  // ---------------------------------------------------------------- track
  function cellOf(row: Row | undefined, c: number) {
    if (!row || c < 0 || c >= COLS) return HOLE;
    return row.cells[c];
  }

  function drawRow(row: Row, nearer: Row | undefined, farther: Row | undefined) {
    const zr0 = row.i * ROW_LEN, zr1 = zr0 + ROW_LEN;
    const zA = Math.max(zr0, camZ + NEAR);
    if (zr1 <= zA) return;
    const zB = zr1;
    const a = fog(zA);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    const eA = rowElev(row, zA), eB = row.e1;
    const fA = (zA - zr0) / ROW_LEN;
    const lw = Math.max(0.6, Math.min(2.2, (F / (zA - camZ)) * 0.035));
    // Slab faces first (under the tiles' glowing edges), batched per colour.
    const front: Pt[][] = [], sides: Pt[][] = [];
    for (let c = 0; c < COLS; c++) {
      const k = row.cells[c];
      if (k === HOLE) continue;
      const xl = c - HALF, xr = xl + 1;
      const hA = k === RAMP ? RAMP_H * fA : 0, hB = k === RAMP ? RAMP_H : 0;
      if (cellOf(nearer, c) === HOLE && zA === zr0) front.push([P(xl, eA, zA), P(xr, eA, zA), P(xr, eA - 0.45, zA), P(xl, eA - 0.45, zA)]);
      if (cellOf(row, c - 1) === HOLE && xl > camX) sides.push([P(xl, eA + hA, zA), P(xl, eB + hB, zB), P(xl, eB - 0.45, zB), P(xl, eA - 0.45, zA)]);
      if (cellOf(row, c + 1) === HOLE && xr < camX) sides.push([P(xr, eA + hA, zA), P(xr, eB + hB, zB), P(xr, eB - 0.45, zB), P(xr, eA - 0.45, zA)]);
    }
    polys(front, slab);
    polys(sides, slabSide);
    // Flat tile tops: two checker colours, one path each, faint grid outline.
    const tops: Pt[][][] = [[], []];
    for (let c = 0; c < COLS; c++) {
      if (row.cells[c] === HOLE || row.cells[c] === RAMP) continue;
      const xl = c - HALF, xr = xl + 1;
      tops[(row.i + c) & 1].push([P(xl, eA, zA), P(xr, eA, zA), P(xr, eB, zB), P(xl, eB, zB)]);
    }
    polys(tops[0], tileB, rgba(p.primary, 0.22), lw * 0.6);
    polys(tops[1], tileA, rgba(p.primary, 0.22), lw * 0.6);
    // Ramps.
    for (let c = 0; c < COLS; c++) {
      const k = row.cells[c];
      if (k !== RAMP) continue;
      const xl = c - HALF, xr = xl + 1;
      const a0 = P(xl, eA + RAMP_H * fA, zA), b0 = P(xr, eA + RAMP_H * fA, zA);
      const b1 = P(xr, eB + RAMP_H, zB), a1 = P(xl, eB + RAMP_H, zB);
      poly([a0, b0, b1, a1], rampCol);
      // Chevrons up the ramp.
      ctx.strokeStyle = rgba(p.primary, 0.9);
      ctx.lineWidth = lw;
      for (let q = 1; q < 4; q++) {
        const zz = zr0 + (ROW_LEN * q) / 4;
        if (zz <= zA) continue;
        const hh = rowElev(row, zz) + (RAMP_H * q) / 4;
        const l = P(xl + 0.15, hh, zz), m = P(xl + 0.5, hh, zz + 0.3), r = P(xr - 0.15, hh, zz);
        ctx.beginPath();
        ctx.moveTo(l[0], l[1]);
        ctx.lineTo(m[0], m[1]);
        ctx.lineTo(r[0], r[1]);
        ctx.stroke();
      }
      glow(a1, b1, p.primary, lw);
    }
    // Glowing boundaries (edges next to holes / off the track), one batched stroke.
    const segs: Pt[] = [];
    for (let c = 0; c < COLS; c++) {
      const k = row.cells[c];
      if (k === HOLE) continue;
      const xl = c - HALF, xr = xl + 1;
      const hA = k === RAMP ? RAMP_H * fA : 0, hB = k === RAMP ? RAMP_H : 0;
      if (cellOf(row, c - 1) === HOLE) segs.push(P(xl, eA + hA, zA), P(xl, eB + hB, zB));
      if (cellOf(row, c + 1) === HOLE) segs.push(P(xr, eA + hA, zA), P(xr, eB + hB, zB));
      if (cellOf(nearer, c) === HOLE && zA === zr0) segs.push(P(xl, eA, zA), P(xr, eA, zA));
      if (cellOf(farther, c) === HOLE && k !== RAMP) segs.push(P(xl, eB, zB), P(xr, eB, zB));
    }
    glowSegs(segs, p.primary, lw);
    // Side walls.
    for (const side of [-1, 1]) {
      if (side < 0 ? !row.wallL : !row.wallR) continue;
      const x = side * HALF;
      const top = 0.6;
      poly([P(x, eA, zA), P(x, eB, zB), P(x, eB + top, zB), P(x, eA + top, zA)], rgba(p.secondary, 0.35));
      glow(P(x, eA + top, zA), P(x, eB + top, zB), p.accent, lw);
    }
    ctx.globalAlpha = 1;
  }

  function drawBlock(row: Row, c: number) {
    const z0 = row.i * ROW_LEN + BLOCK_Z0, z1 = row.i * ROW_LEN + BLOCK_Z1;
    if (z1 <= camZ + NEAR) return;
    const zn = Math.max(z0, camZ + NEAR);
    const a = fog(zn);
    if (a <= 0.01) return;
    ctx.globalAlpha = a;
    const bx = colX(c);
    const xl = bx - BLOCK_HW, xr = bx + BLOCK_HW;
    const en = rowElev(row, z0), ef = rowElev(row, z1);
    const top = en + BLOCK_H;
    const nl = P(xl, top, zn), nr = P(xr, top, zn), fl = P(xl, top, z1), fr = P(xr, top, z1);
    const nlb = P(xl, en, zn), nrb = P(xr, en, zn), flb = P(xl, ef, z1), frb = P(xr, ef, z1);
    if (xl > camX) poly([nl, fl, flb, nlb], mix(p.secondary, ink, 0.25), ink, 1.2);
    if (xr < camX) poly([nr, fr, frb, nrb], mix(p.secondary, ink, 0.25), ink, 1.2);
    poly([nl, nr, fr, fl], mix(p.accent, "#ffffff", 0.3), ink, 1.2);
    const w = nr[0] - nl[0], h = nlb[1] - nl[1];
    if (zn === z0 && w > 5 && h > 5) kit.block(nl[0], nl[1], w, h, p.accent, Math.min(4, w / 5));
    else poly([nl, nr, nrb, nlb], p.accent, ink, 1);
    const lw = Math.max(0.6, Math.min(2, nl[2] * 0.03));
    glow(nl, nr, p.accent, lw);
    glow(fl, fr, p.accent, lw * 0.7);
    ctx.globalAlpha = 1;
  }

  function drawCoin(cn: Coin, row: Row) {
    if (cn.z <= camZ + NEAR + 0.5) return;
    const [x, y, s] = P(cn.x, rowElev(row, cn.z) + cn.h, cn.z);
    const r = 0.24 * s;
    if (r < 0.5) return;
    ctx.globalAlpha = fog(cn.z);
    const spin = Math.cos(t / 150 + cn.z * 0.7);
    const rx = Math.max(r * 0.15, Math.abs(spin) * r);
    ctx.fillStyle = rgba(coinColor, 0.25);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 1.2, r + 1.2, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = spin > 0 ? coinColor : mix(coinColor, ink, 0.25);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, r, 0, 0, Math.PI * 2);
    ctx.fill();
    if (rx > 3) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(x - rx * 0.4, y - r * 0.55, Math.max(1, rx * 0.35), r * 0.5);
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- ball
  function groundUnder(v: SlopeView, rows: Map<number, Row>): number | null {
    const row = rows.get(Math.floor(v.z / ROW_LEN));
    const k = cellOf(row, Math.floor(v.x + HALF));
    if (!row || k === HOLE) return null;
    const g = rowElev(row, v.z);
    return k === RAMP ? g + (RAMP_H * (v.z - row.i * ROW_LEN)) / ROW_LEN : g;
  }

  function drawBall(v: SlopeView, rows: Map<number, Row>) {
    // Shadow.
    const gu = groundUnder(v, rows);
    if (gu !== null && v.y >= gu - 0.05) {
      const [sx, sy, ss] = P(v.x, gu, v.z);
      const lift = Math.min(1, (v.y - gu) / 3);
      ctx.fillStyle = `rgba(0,0,0,${0.45 * (1 - lift * 0.6)})`;
      ctx.beginPath();
      ctx.ellipse(sx, sy, R * ss * (1 - lift * 0.4), R * 0.35 * ss * (1 - lift * 0.4), 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Glow trail.
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < trail.length - 1; i++) {
      const q = trail[i];
      if (q.z <= camZ + NEAR) continue;
      const [tx, ty, ts] = P(q.x, q.y, q.z);
      const f = (i + 1) / trail.length;
      ctx.fillStyle = rgba(p.primary, 0.16 * f);
      ctx.beginPath();
      ctx.arc(tx, ty, R * ts * (0.45 + 0.5 * f), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    const [bx, by, s] = P(v.x, v.y + R, v.z);
    const r = R * s * 1.08;
    // Halo.
    const halo = ctx.createRadialGradient(bx, by, r * 0.6, bx, by, r * 1.9);
    halo.addColorStop(0, rgba(p.primary, 0.45));
    halo.addColorStop(1, rgba(p.primary, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(bx, by, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
    // Body + mascot face, clipped to the circle.
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(bx, by, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = p.primary;
    ctx.fillRect(bx - r, by - r, r * 2, r * 2);
    ctx.translate(bx, by);
    ctx.rotate(v.x / R * 0.25 + v.vx * 2.5);
    const sprite = v.dead ? kit.sprites.sad : kit.sprites.mini;
    const sz = r * 2.15;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(sprite, -sz / 2, -sz / 2, sz, sz);
    ctx.restore();
    // Rolling bands sweep down the ball to show forward spin.
    ctx.save();
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.clip();
    const phase = (v.dist / (2 * Math.PI * R)) % 1;
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = Math.max(1, r * 0.12);
    for (let k = 0; k < 2; k++) {
      const f = (phase + k * 0.5) % 1; // 0 top -> 1 bottom
      const yy = by - r + f * 2 * r;
      const ry = r * 0.35 * Math.sin(f * Math.PI);
      ctx.beginPath();
      ctx.ellipse(bx, yy, r, Math.max(0.5, ry), 0, 0, Math.PI);
      ctx.stroke();
    }
    // Sphere shading.
    const sh = ctx.createRadialGradient(bx - r * 0.4, by - r * 0.45, r * 0.1, bx, by, r * 1.05);
    sh.addColorStop(0, "rgba(255,255,255,0.35)");
    sh.addColorStop(0.5, "rgba(255,255,255,0)");
    sh.addColorStop(1, "rgba(0,0,0,0.35)");
    ctx.fillStyle = sh;
    ctx.fillRect(bx - r, by - r, r * 2, r * 2);
    ctx.restore();
  }

  // ---------------------------------------------------------------- juice
  function speedLines(v: SlopeView) {
    const f = (v.speed - START_SPEED) / (MAX_SPEED - START_SPEED);
    const n = Math.floor(4 + f * 22);
    const vx = CX, vy = HORIZON + 20;
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 170 + Math.random() * 140;
      const len = 25 + Math.random() * 60 * (0.5 + f);
      const ox = vx + Math.cos(a) * r0, oy = vy + Math.sin(a) * r0;
      if (oy < HORIZON + 30) continue;
      ctx.globalAlpha = 0.08 + Math.random() * 0.14;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function ballScreen(v: SlopeView): Pt {
    return P(v.x, v.y + R, v.z);
  }

  return {
    onEvents(events: readonly GameEvent[], v: SlopeView) {
      const [bx, by] = ballScreen(v);
      for (const e of events) {
        if (e.t === "coin") {
          kit.fx.burst(bx, by - 10, coinColor, 6, 100, 200);
          kit.fx.popup(bx + 18, by - 34, "+10", coinColor);
        } else if (e.t === "launch") {
          kit.fx.burst(bx, by + 12, p.primary, 12, 140, 300);
        } else if (e.t === "land") {
          kit.fx.burst(bx, by + 12, mix(p.text, p.bg, 0.3), 5, 70, 150);
        } else if (e.t === "wall") {
          kit.fx.addShake(2);
          kit.fx.burst(bx + (e.side as number) * 18, by, p.accent, 7, 110);
        } else if (e.t === "milestone") {
          kit.fx.popup(CX, HORIZON + 50, `${e.value as number}M!`, p.primary);
          kit.fx.flash("255,255,255");
        } else if (e.t === "crash") {
          kit.fx.addShake(12);
          kit.fx.flash();
          kit.fx.burst(bx, by, p.accent, 24, 230);
          kit.fx.burst(bx, by, p.primary, 14, 180);
        } else if (e.t === "fall") {
          kit.fx.addShake(8);
          kit.fx.flash();
          kit.fx.burst(bx, by, p.primary, 16, 120, 600);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (v.frame < lastFrame) trail.length = 0;
      lastFrame = v.frame;
      // Camera: behind the ball, follows terrain and (loosely) steering.
      camZ = v.z - CAM_BACK;
      const k = Math.min(1, dtMs / 110);
      camX += (v.x * 0.65 - camX) * k;
      const air = Math.max(0, v.y - v.elev);
      const targetY = v.elev + CAM_H + Math.min(air, 4) * 0.4;
      camY = Math.abs(targetY - camY) > 8 ? targetY : camY + (targetY - camY) * Math.min(1, dtMs / 140);
      tilt += (-v.vx * 0.9 - tilt) * Math.min(1, dtMs / 120);
      if (!v.dead) {
        trail.push({ x: v.x, y: v.y + R, z: v.z });
        while (trail.length > 14) trail.shift();
      }

      kit.background(dtMs);
      ctx.save();
      ctx.translate(CX, BALL_SCREEN_Y);
      ctx.rotate(tilt);
      ctx.translate(-CX, -BALL_SCREEN_Y);
      drawSky(v);
      drawVoid();

      const rows = new Map<number, Row>();
      for (const r of v.rows) rows.set(r.i, r);
      const coinsByRow = new Map<number, Coin[]>();
      for (const cn of v.coins) {
        const i = Math.floor(cn.z / ROW_LEN);
        const list = coinsByRow.get(i);
        if (list) list.push(cn);
        else coinsByRow.set(i, [cn]);
      }
      const ballRow = Math.floor(v.z / ROW_LEN);
      let ballDrawn = false;
      for (let ri = v.rows.length - 1; ri >= 0; ri--) {
        const row = v.rows[ri];
        if (row.i * ROW_LEN > camZ + FAR) continue;
        if ((row.i + 1) * ROW_LEN <= camZ + NEAR) continue;
        drawRow(row, rows.get(row.i - 1), rows.get(row.i + 1));
        const objs: { z: number; draw: () => void }[] = [];
        for (let c = 0; c < COLS; c++) if (row.cells[c] === BLOCK) objs.push({ z: row.i * ROW_LEN + BLOCK_Z0, draw: () => drawBlock(row, c) });
        for (const cn of coinsByRow.get(row.i) ?? []) objs.push({ z: cn.z, draw: () => drawCoin(cn, row) });
        if (row.i === ballRow) objs.push({ z: v.z - R, draw: () => drawBall(v, rows) });
        objs.sort((a, b) => b.z - a.z);
        for (const o of objs) o.draw();
        if (row.i === ballRow) ballDrawn = true;
      }
      if (!ballDrawn) drawBall(v, rows);
      ctx.restore();

      if (!v.dead) speedLines(v);
      kit.fx.draw(kit, dtMs);
      if (v.frame < 180) {
        ctx.globalAlpha = Math.min(1, (180 - v.frame) / 40);
        kit.text("DRAG OR ARROWS TO STEER", CX, HORIZON + 70, 11, p.text);
        kit.text("RAMPS JUMP GAPS  -  DODGE BLOCKS", CX, HORIZON + 88, 8, p.text);
        ctx.globalAlpha = 1;
      }
    },
  };
}
