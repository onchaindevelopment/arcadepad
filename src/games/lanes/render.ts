// Moon Dash 3 renderer: pseudo-3D track seen from behind the runner.
// Client only; may use Math.random / trig freely (purely visual).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BAR_DEPTH, FIELD_H, FIELD_W, HIGH_Y0, HIGH_Y1, HOVER_FRAMES, LOW_Y0, LOW_Y1, MAGNET_FRAMES, DOUBLE_FRAMES,
  RAMP_LEN, WALL_H, surface, type Coin, type LanesView, type Obstacle, type PowerUp,
} from "./index.ts";

// ---------------------------------------------------------------- camera
const CX = FIELD_W / 2;
const HORIZON = 205;
const CAM_BACK = 5.5; // camera distance behind the runner
const CAM_H = 2.6; // camera height (render units)
const F = ((FIELD_H - 70 - HORIZON) * CAM_BACK) / CAM_H; // runner's feet land at y = FIELD_H - 70
const LW = 0.8; // lane width in render units
const RY = 0.75; // world height -> render height
const NEAR = 0.7;
const FAR = 95;
const ROAD_HALF = 1.5 * LW + 0.12;

/** Parse #rrggbb and lighten (amt > 0) or darken (amt < 0). */
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amt >= 0 ? c + (255 - c) * amt : c * (1 + amt)),
  );
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}
function hash(n: number): number {
  let h = Math.imul(n ^ 0x27d4eb2d, 0x165667b1);
  h ^= h >>> 15;
  return (Math.imul(h, 0x2c1b3c6d) >>> 0) / 4294967296;
}

type Drawable = { z: number; draw: () => void };

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<LanesView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const ink = p.ink;
  let t = 0;
  let camZ = 0;
  let camX = 0;
  let camH = CAM_H;
  let dustT = 0;

  const laneX = (lane: number) => (lane - 1) * LW;
  const scaleAt = (z: number) => F / Math.max(NEAR, z - camZ);
  const P = (x: number, y: number, z: number): [number, number, number] => {
    const s = scaleAt(z);
    return [CX + (x - camX) * s, HORIZON + (camH - y * RY) * s, s];
  };

  function poly(pts: number[][], fill: string, stroke = true) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();
    }
  }

  /** Chunky outlined box: front face via kit.block, plus visible top and side faces. */
  function box(xc: number, hw: number, y0: number, y1: number, zNear: number, zFar: number, color: string, radius = 3) {
    const zn = Math.max(zNear, camZ + NEAR);
    if (zFar <= zn || zn - camZ > FAR) return;
    const zf = Math.min(zFar, camZ + FAR);
    const xl = xc - hw, xr = xc + hw;
    const [nlx, nby] = P(xl, y0, zn), [nrx, nty] = P(xr, y1, zn);
    const [flx, fby] = P(xl, y0, zf), [frx, fty] = P(xr, y1, zf);
    if (y1 * RY < camH) poly([[nlx, nty], [nrx, nty], [frx, fty], [flx, fty]], shade(color, 0.25));
    if (xr < camX) poly([[nrx, nty], [nrx, nby], [frx, fby], [frx, fty]], shade(color, -0.3));
    if (xl > camX) poly([[nlx, nty], [nlx, nby], [flx, fby], [flx, fty]], shade(color, -0.3));
    const w = nrx - nlx, h = nby - nty;
    if (w > 4 && h > 4) kit.block(nlx, nty, w, h, color, Math.min(radius, w / 4, h / 4));
    else {
      ctx.fillStyle = color;
      ctx.fillRect(nlx, nty, Math.max(1, w), Math.max(1, h));
    }
  }

  // ---------------------------------------------------------------- scenery
  function drawSky(v: LanesView) {
    // Moon with craters.
    const mx = 290 - camX * 6, my = 78, r = 30;
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.arc(mx, my, r + 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(mx, my, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(p.text, -0.15);
    for (const [dx, dy, cr] of [[-10, -6, 6], [9, 8, 5], [6, -12, 3], [-4, 13, 3]]) {
      ctx.beginPath();
      ctx.arc(mx + dx, my + dy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Far skyline of candle towers (slow parallax).
    const off = (v.dist * 0.4) % 40;
    for (let i = -1; i < 11; i++) {
      const seed = Math.floor(v.dist * 0.4 / 40) + i;
      const x = i * 40 - off - camX * 10;
      const h = 20 + hash(seed) * 50;
      const w = 14 + hash(seed + 99) * 12;
      ctx.fillStyle = shade(p.wall, -0.2);
      ctx.fillRect(x, HORIZON - h, w, h);
      ctx.fillRect(x + w / 2 - 1, HORIZON - h - 8, 2, 8);
      ctx.fillStyle = hash(seed + 7) > 0.5 ? p.primary : p.accent;
      ctx.globalAlpha = 0.5;
      for (let wy = HORIZON - h + 5; wy < HORIZON - 4; wy += 7) ctx.fillRect(x + 3, wy, 2, 2);
      ctx.globalAlpha = 1;
    }
  }

  function drawGround() {
    const g = ctx.createLinearGradient(0, HORIZON, 0, FIELD_H);
    g.addColorStop(0, shade(p.wall, -0.4));
    g.addColorStop(1, shade(p.wall, -0.1));
    ctx.fillStyle = g;
    ctx.fillRect(-20, HORIZON, FIELD_W + 40, FIELD_H - HORIZON + 20);
    // Road bands that rush toward the camera.
    const band = 3;
    const start = Math.floor((camZ + NEAR) / band) * band;
    for (let z = start + band * Math.ceil(FAR / band); z >= start; z -= band) {
      const z0 = Math.max(z, camZ + NEAR), z1 = z + band;
      if (z1 <= z0) continue;
      const [ax, ay] = P(-ROAD_HALF, 0, z0), [bx] = P(ROAD_HALF, 0, z0);
      const [cx, cy] = P(ROAD_HALF, 0, z1), [dx] = P(-ROAD_HALF, 0, z1);
      const even = Math.floor(z / band) % 2 === 0;
      poly([[ax, ay], [bx, ay], [cx, cy], [dx, cy]], even ? p.bg2 : shade(p.bg2, 0.08), false);
    }
    // Road edges and dashed lane lines.
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      const [nx, ny, ns] = P(side * ROAD_HALF, 0, camZ + NEAR), [fx, fy] = P(side * ROAD_HALF, 0, camZ + FAR);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = Math.max(1, ns * 0.06);
      ctx.beginPath();
      ctx.moveTo(nx, ny);
      ctx.lineTo(fx, fy);
      ctx.stroke();
    }
    ctx.strokeStyle = p.text;
    ctx.globalAlpha = 0.35;
    const dash = 4;
    const dstart = Math.floor(camZ / dash) * dash;
    for (const lx of [-0.5 * LW, 0.5 * LW]) {
      for (let z = dstart; z < camZ + FAR; z += dash) {
        if (z + 1.6 < camZ + NEAR) continue;
        const [ax, ay, as] = P(lx, 0, Math.max(z, camZ + NEAR)), [bx, by] = P(lx, 0, z + 1.6);
        ctx.lineWidth = Math.max(0.6, as * 0.03);
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(bx, by);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  /** Roadside candles (green/red chart candles), deterministic per slot. */
  function sideScenery(out: Drawable[]) {
    const step = 7;
    const first = Math.floor((camZ + NEAR) / step);
    for (let k = first; k < first + Math.ceil(FAR / step); k++) {
      for (const side of [-1, 1]) {
        const seed = k * 2 + (side > 0 ? 1 : 0);
        if (hash(seed) < 0.25) continue;
        const z = k * step + hash(seed + 5) * 3;
        const x = side * (ROAD_HALF + 0.7 + hash(seed + 11) * 1.4);
        const h = 0.8 + hash(seed + 17) * 2.6;
        const y0 = hash(seed + 23) * 0.8;
        const up = hash(seed + 31) > 0.45;
        out.push({
          z: z + 0.5,
          draw: () => {
            // Wick then body.
            box(x, 0.03, 0, y0 + h + 0.5, z + 0.22, z + 0.28, shade(p.text, -0.3), 0);
            box(x, 0.25, y0, y0 + h, z, z + 0.5, up ? p.primary : p.accent, 2);
          },
        });
      }
    }
  }

  // ---------------------------------------------------------------- track objects
  function drawObstacle(o: Obstacle) {
    const x = laneX(o.lane);
    const hw = LW * 0.46;
    const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
    if (o.kind === "low") {
      box(x - hw + 0.05, 0.04, 0, LOW_Y1, o.z + 0.1, o.z + 0.3, shade(p.text, -0.25), 1);
      box(x + hw - 0.05, 0.04, 0, LOW_Y1, o.z + 0.1, o.z + 0.3, shade(p.text, -0.25), 1);
      box(x, hw, LOW_Y0, LOW_Y1, o.z, o.z + BAR_DEPTH, p.secondary, 3);
      stripes(x, hw, LOW_Y0, LOW_Y1, o.z);
    } else if (o.kind === "high") {
      box(x - hw + 0.04, 0.05, 0, HIGH_Y1, o.z + 0.1, o.z + 0.3, shade(p.text, -0.25), 1);
      box(x + hw - 0.04, 0.05, 0, HIGH_Y1, o.z + 0.1, o.z + 0.3, shade(p.text, -0.25), 1);
      box(x, hw, HIGH_Y0, HIGH_Y0 + 0.8, o.z, o.z + BAR_DEPTH, p.accent, 4);
      box(x, hw, HIGH_Y1 - 0.12, HIGH_Y1, o.z, o.z + BAR_DEPTH, shade(p.accent, -0.2), 2);
      // Down-arrow hint on the sign.
      const [ax, ay, s] = P(x, HIGH_Y0 + 0.4, o.z);
      if (o.z - camZ > NEAR && s > 12) {
        ctx.fillStyle = ink;
        ctx.beginPath();
        ctx.moveTo(ax - 0.14 * s, ay - 0.08 * s);
        ctx.lineTo(ax + 0.14 * s, ay - 0.08 * s);
        ctx.lineTo(ax, ay + 0.14 * s);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      const color = bricks[o.id % bricks.length];
      const bodyStart = o.kind === "ramp" ? o.z + RAMP_LEN : o.z;
      box(x, hw, 0, WALL_H, bodyStart, o.z1, color, 5);
      // Wick on the front of the candle wall.
      if (bodyStart > camZ + NEAR) box(x, 0.03, WALL_H, WALL_H + 0.45, bodyStart + 0.2, bodyStart + 0.26, ink, 0);
      if (o.kind === "ramp") drawRamp(x, hw, o, color);
    }
  }

  function stripes(x: number, hw: number, y0: number, y1: number, z: number) {
    if (z - camZ < NEAR) return;
    const [lx, ty, s] = P(x - hw, y1, z), [rx, by] = P(x + hw, y0, z);
    if (s < 10) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(lx + 2, ty + 2, rx - lx - 4, by - ty - 4);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    const w = (by - ty) * 0.8;
    for (let sx = lx - w; sx < rx; sx += w * 2) {
      ctx.beginPath();
      ctx.moveTo(sx, by);
      ctx.lineTo(sx + w, by);
      ctx.lineTo(sx + w * 2, ty);
      ctx.lineTo(sx + w, ty);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  function drawRamp(x: number, hw: number, o: Obstacle, color: string) {
    const z0 = Math.max(o.z, camZ + NEAR);
    const z1 = o.z + RAMP_LEN;
    if (z1 <= z0) return;
    const h0 = surface(o, z0);
    const xl = x - hw, xr = x + hw;
    const a = P(xl, h0, z0), b = P(xr, h0, z0), c = P(xr, WALL_H, z1), d = P(xl, WALL_H, z1);
    const bl = P(xl, 0, z0), br = P(xr, 0, z0), fl = P(xl, 0, z1), fr = P(xr, 0, z1);
    if (xr < camX) poly([b, br, fr, c], shade(color, -0.35));
    if (xl > camX) poly([a, bl, fl, d], shade(color, -0.35));
    if (h0 > 0.02) poly([a, b, br, bl], shade(color, -0.1));
    poly([a, b, c, d], shade(color, 0.15));
    // Chevrons up the ramp.
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    for (let i = 1; i < 4; i++) {
      const zz = o.z + (RAMP_LEN * i) / 4;
      if (zz <= z0) continue;
      const hh = surface(o, zz);
      const l = P(xl + 0.08, hh, zz), m = P(x, hh, zz + 0.4), r = P(xr - 0.08, hh, zz);
      ctx.lineWidth = Math.max(1, l[2] * 0.04);
      ctx.beginPath();
      ctx.moveTo(l[0], l[1]);
      ctx.lineTo(m[0], m[1]);
      ctx.lineTo(r[0], r[1]);
      ctx.stroke();
    }
  }

  function drawCoin(c: Coin) {
    const [x, y, s] = P(laneX(c.lane), c.y, c.z);
    const r = 0.2 * s;
    if (r < 0.6) return;
    const spin = Math.cos(t / 140 + c.z * 0.6);
    const rx = Math.max(r * 0.12, Math.abs(spin) * r);
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 1.5, r + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = spin > 0 ? p.accent : shade(p.accent, -0.2);
    ctx.beginPath();
    ctx.ellipse(x, y, rx, r, 0, 0, Math.PI * 2);
    ctx.fill();
    if (rx > 3) {
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x - rx * 0.4, y - r * 0.55, Math.max(1, rx * 0.35), r * 0.5);
    }
  }

  const POWER_LABEL: Record<PowerUp["kind"], string> = { magnet: "M", double: "2X", hover: "UP", shield: "S" };
  function drawPower(pw: PowerUp) {
    const bob = Math.sin(t / 200 + pw.z) * 0.1;
    const [x, y, s] = P(laneX(pw.lane), 0.6 + bob, pw.z);
    const r = 0.3 * s;
    if (r < 1) return;
    ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t / 120);
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = ink;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.secondary;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (r > 5) kit.text(POWER_LABEL[pw.kind], x, y + 1, Math.max(6, Math.round(r * 0.9)), p.text);
  }

  // ---------------------------------------------------------------- runner
  function floorUnder(v: LanesView): number {
    let f = 0;
    for (const o of v.obstacles) if (o.lane === v.lane) f = Math.max(f, surface(o, v.dist));
    return f;
  }

  function runnerScreen(v: LanesView) {
    return P((v.laneX - 1) * LW, v.y + 0.35, v.dist);
  }

  function drawRunner(v: LanesView) {
    const x = (v.laneX - 1) * LW;
    // Shadow on the floor below.
    const [sx, sy, ss] = P(x, floorUnder(v), v.dist);
    const lift = Math.min(1, (v.y - floorUnder(v)) / 3);
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.ellipse(sx, sy, 0.3 * ss * (1 - lift * 0.5), 0.08 * ss * (1 - lift * 0.5), 0, 0, Math.PI * 2);
    ctx.fill();

    const [px, py, s] = P(x, v.y, v.dist);
    const size = 0.62 * s;
    const sprite = v.dead ? kit.sprites.sad : v.hover > 0 || v.magnet > 0 || v.double > 0 ? kit.sprites.happy : kit.sprites.mini;
    if (v.invuln > 0 && Math.floor(t / 70) % 2 === 0) ctx.globalAlpha = 0.45;
    ctx.save();
    if (v.hover > 0) {
      // Jet flames.
      for (const fx of [-0.2, 0.2]) {
        const fl = (0.25 + Math.random() * 0.2) * s;
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(px + fx * size - 4, py - 2);
        ctx.lineTo(px + fx * size + 4, py - 2);
        ctx.lineTo(px + fx * size, py - 2 + fl);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = p.text;
        ctx.fillRect(px + fx * size - 1.5, py - 2, 3, fl * 0.4);
      }
    }
    if (v.roll > 0 && !v.dead) {
      const rs = size * 0.72;
      ctx.translate(px, py - rs / 2);
      ctx.rotate(t / 45);
      ctx.drawImage(sprite, -rs / 2, -rs / 2, rs, rs);
    } else {
      const run = !v.airborne && !v.dead && v.hover === 0;
      const bounce = run ? Math.abs(Math.sin(t / 55)) : 0;
      const squash = v.dead ? 0.55 : run ? 1 - 0.08 * (1 - bounce) : 1 + Math.max(-0.12, Math.min(0.15, v.vy * 0.8));
      const w = size / Math.sqrt(squash), h = size * squash;
      ctx.translate(px, py - bounce * 0.08 * s);
      ctx.rotate((v.lane - v.laneX) * 0.35 + (v.hover > 0 ? Math.sin(t / 160) * 0.08 : 0));
      ctx.drawImage(sprite, -w / 2, -h, w, h);
      // Little legs while running.
      if (run) {
        ctx.fillStyle = ink;
        const step = Math.sin(t / 55) * 0.08 * size;
        ctx.fillRect(-0.18 * w - 2, -2 + step, 4, 0.12 * size);
        ctx.fillRect(0.18 * w - 2, -2 - step, 4, 0.12 * size);
      }
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    if (v.shield) {
      const [bx, by] = P(x, v.y + (v.roll > 0 ? 0.25 : 0.42), v.dist);
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 2.5;
      ctx.globalAlpha = 0.55 + 0.3 * Math.sin(t / 150);
      ctx.beginPath();
      ctx.arc(bx, by, size * 0.62, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  // ---------------------------------------------------------------- juice
  function speedLines(v: LanesView) {
    const n = Math.floor((v.speed - 0.26) * 40) + (v.hover > 0 ? 8 : 0);
    if (n <= 0) return;
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r0 = 150 + Math.random() * 120;
      const len = 20 + Math.random() * 50;
      const ox = CX + Math.cos(a) * r0, oy = HORIZON + Math.sin(a) * r0 * 1.2;
      ctx.globalAlpha = 0.12 + Math.random() * 0.15;
      ctx.beginPath();
      ctx.moveTo(ox, oy);
      ctx.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len * 1.2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function powerBars(v: LanesView) {
    const items: [string, number, string][] = [];
    if (v.magnet > 0) items.push(["M", v.magnet / MAGNET_FRAMES, p.secondary]);
    if (v.double > 0) items.push(["2X", v.double / DOUBLE_FRAMES, p.accent]);
    if (v.hover > 0) items.push(["UP", v.hover / HOVER_FRAMES, p.primary]);
    if (v.shield) items.push(["S", 1, p.primary]);
    let y = FIELD_H - 22;
    for (const [label, f, color] of items) {
      kit.block(10, y - 8, 70, 16, shade(p.bg, 0.1), 4);
      ctx.fillStyle = color;
      ctx.fillRect(34, y - 3, 42 * f, 6);
      kit.text(label, 21, y + 1, 8, p.text);
      y -= 20;
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: LanesView) {
      const [rx, ry] = runnerScreen(v);
      for (const e of events) {
        if (e.t === "coin") {
          kit.fx.burst(rx, ry - 18, p.accent, 4, 90, 200);
          if ((e.value as number) > 1) kit.fx.popup(rx + 16, ry - 40, "x2", p.accent);
        } else if (e.t === "jump" || e.t === "land") {
          kit.fx.burst(rx, ry + 10, shade(p.text, -0.3), 6, 60, 120);
        } else if (e.t === "bump") {
          kit.fx.addShake(3);
          kit.fx.burst(rx + (e.dir as number) * 30, ry - 10, p.text, 6, 80);
        } else if (e.t === "power") {
          const names: Record<string, string> = { magnet: "MAGNET!", double: "2X COINS!", hover: "LIFT OFF!", shield: "SHIELD!" };
          kit.fx.popup(CX, HORIZON + 60, names[e.kind as string] ?? "POWER!", p.primary);
          kit.fx.burst(rx, ry - 20, p.primary, 18, 160);
        } else if (e.t === "smash") {
          kit.fx.addShake(6);
          kit.fx.flash("255,255,255");
          for (const c of p.bricks.slice(0, 3)) kit.fx.burst(rx, ry - 20, c, 10, 220);
        } else if (e.t === "milestone") {
          kit.fx.popup(CX, HORIZON + 30, `${e.value as number}!`, p.accent);
          kit.fx.flash("255,255,255");
        } else if (e.t === "crash") {
          kit.fx.addShake(12);
          kit.fx.flash();
          kit.fx.burst(rx, ry - 20, p.secondary, 26, 230);
          kit.fx.burst(rx, ry - 20, p.accent, 14, 180);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      // Camera follows the runner loosely (lane and height).
      camZ = v.dist - CAM_BACK;
      const targetX = (v.laneX - 1) * LW * 0.45;
      camX += (targetX - camX) * Math.min(1, dtMs / 90);
      const targetH = CAM_H + Math.max(0, v.y - 0.3) * RY * 0.55;
      camH += (targetH - camH) * Math.min(1, dtMs / 150);

      kit.background(dtMs);
      drawSky(v);
      drawGround();

      const items: Drawable[] = [];
      sideScenery(items);
      for (const o of v.obstacles) {
        if (o.z1 < camZ + NEAR || o.z > camZ + FAR) continue;
        items.push({ z: Math.max(o.z, camZ + NEAR) + (o.kind === "wall" || o.kind === "ramp" ? 0 : BAR_DEPTH / 2), draw: () => drawObstacle(o) });
      }
      for (const c of v.coins) if (c.z > camZ + NEAR && c.z < camZ + FAR) items.push({ z: c.z, draw: () => drawCoin(c) });
      for (const pw of v.powers) if (pw.z > camZ + NEAR && pw.z < camZ + FAR) items.push({ z: pw.z, draw: () => drawPower(pw) });
      items.push({ z: v.dist + 0.31, draw: () => drawRunner(v) });
      items.sort((a, b) => b.z - a.z);
      for (const it of items) it.draw();

      // Dust puffs while running on a surface.
      dustT += dtMs;
      if (!v.dead && !v.airborne && v.hover === 0 && dustT > 90) {
        dustT = 0;
        const [rx, ry] = P((v.laneX - 1) * LW, v.y, v.dist);
        kit.fx.burst(rx + (Math.random() - 0.5) * 20, ry, shade(p.text, -0.35), 2, 40, 60);
      }
      if (!v.dead) speedLines(v);
      kit.fx.draw(kit, dtMs);
      powerBars(v);
      if (v.frame < 150) {
        ctx.globalAlpha = Math.min(1, (150 - v.frame) / 40);
        kit.text("SWIPE OR ARROWS", CX, HORIZON + 40, 12, p.text);
        kit.text("< > LANE   ^ JUMP   v ROLL", CX, HORIZON + 58, 8, p.text);
        ctx.globalAlpha = 1;
      }
    },
  };
}
