// Moon Helix renderer: pseudo-3D tower (central pole + elliptical ring
// slices seen slightly from above), mascot-head ball, splats, shards and juice.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { ANG, BALL_R, DANGER, FIELD_H, FIELD_W, FRONT, GAP, SEGS, SEG_U, type HelixView } from "./index.ts";

const CX = FIELD_W / 2;
const RO = 132; // outer ring radius
const RP = 30; // pole radius
const RM = (RO + RP) / 2 + 6; // where the ball touches the ring
const K = 0.34; // ellipse squash (view from slightly above)
const TH = 13; // ring slice thickness
const ANCHOR = 300; // screen y of the ring the ball is heading to
const TAU = Math.PI * 2;

interface Shard { y: number; segs: number[]; rot: number; t: number; color: string; smash: boolean }
interface Splat { ring: number; a: number; s: number; color: string }

function shade(hex: string, f: number): string {
  let rgb: number[];
  if (hex.startsWith("rgb")) rgb = (hex.match(/\d+/g) ?? ["0", "0", "0"]).slice(0, 3).map(Number);
  else {
    const n = parseInt(hex.slice(1, 7), 16);
    rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(f < 0 ? v * (1 + f) : v + (255 - v) * f)));
  return `rgb(${ch(rgb[0])},${ch(rgb[1])},${ch(rgb[2])})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<HelixView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const p = theme.palette;
  const { ctx } = kit;
  const safeColors = p.bricks.filter((c) => c.toLowerCase() !== p.accent.toLowerCase());
  if (safeColors.length === 0) safeColors.push(p.primary);
  let t = 0;
  let cam = -ANCHOR + 40;
  let level = -1;
  let squash = 0;
  let shards: Shard[] = [];
  let splats: Splat[] = [];
  const trail: number[] = [];

  const safeColor = (lvl: number) => safeColors[(lvl + 1) % safeColors.length];
  const rad = (u: number) => (u / ANG) * TAU;
  const ex = (phi: number, r: number) => CX + Math.cos(phi) * r;
  const ey = (phi: number, r: number, y: number) => y + Math.sin(phi) * r * K;

  /** Annular sector top face + (front-facing) outer side face. */
  function slice(y: number, a0: number, a1: number, ro: number, ri: number, top: string, kind: number) {
    const n = 7;
    // Side face (only where the outer rim faces the viewer).
    if (Math.sin((a0 + a1) / 2) > -0.15) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        ctx.lineTo(ex(a, ro), ey(a, ro, y));
      }
      for (let i = n; i >= 0; i--) {
        const a = a0 + ((a1 - a0) * i) / n;
        ctx.lineTo(ex(a, ro), ey(a, ro, y) + TH);
      }
      ctx.closePath();
      ctx.fillStyle = shade(top, -0.38);
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      ctx.lineTo(ex(a, ro), ey(a, ro, y));
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / n;
      ctx.lineTo(ex(a, ri), ey(a, ri, y));
    }
    ctx.closePath();
    ctx.fillStyle = top;
    ctx.fill();
    if (kind === DANGER) {
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = p.ink;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 3;
      const xm = ex((a0 + a1) / 2, (ro + ri) / 2);
      const ym = ey((a0 + a1) / 2, (ro + ri) / 2, y);
      for (let k = -60; k <= 60; k += 9) {
        ctx.beginPath();
        ctx.moveTo(xm + k - 20, ym + 20);
        ctx.lineTo(xm + k + 20, ym - 20);
        ctx.stroke();
      }
      ctx.restore();
    } else {
      // soft highlight along the outer rim
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const a = a0 + ((a1 - a0) * i) / n;
        ctx.lineTo(ex(a, ro - 3), ey(a, ro - 3, y) + 1);
      }
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n;
      ctx.lineTo(ex(a, ro), ey(a, ro, y));
    }
    for (let i = n; i >= 0; i--) {
      const a = a0 + ((a1 - a0) * i) / n;
      ctx.lineTo(ex(a, ri), ey(a, ri, y));
    }
    ctx.closePath();
    ctx.stroke();
  }

  /** Draw the segments of one ring whose mid-angle is in the back (front=false) or front half. */
  function ringHalf(y: number, segs: number[], rot: number, front: boolean, lvl: number, pad: boolean, scale = 1) {
    const order: { a0: number; a1: number; s: number; k: number }[] = [];
    for (let s = 0; s < SEGS; s++) {
      const kind = segs[s];
      if (kind === GAP) continue;
      const a0 = rad(s * SEG_U + rot);
      const a1 = rad((s + 1) * SEG_U + rot);
      const m = Math.sin((a0 + a1) / 2);
      if (m >= 0 !== front) continue;
      order.push({ a0, a1, s: m, k: kind });
    }
    order.sort((u, v) => u.s - v.s);
    const pulse = 0.5 + 0.5 * Math.sin(t / 160);
    for (const o of order) {
      const col = pad ? (o.k === DANGER ? p.accent : p.secondary) : o.k === DANGER ? shade(p.accent, 0.12 * pulse) : safeColor(lvl);
      slice(y, o.a0, o.a1, RO * scale, RP * (pad ? 0.2 : 1) * scale, col, o.k);
    }
  }

  function pole(y0: number, y1: number, rot: number) {
    if (y1 < y0) return;
    const g = ctx.createLinearGradient(CX - RP, 0, CX + RP, 0);
    g.addColorStop(0, shade(p.wall, -0.3));
    g.addColorStop(0.35, shade(p.wall, 0.25));
    g.addColorStop(1, shade(p.wall, -0.45));
    ctx.fillStyle = g;
    ctx.fillRect(CX - RP, y0, RP * 2, y1 - y0);
    // rotating stripes so spinning reads even without rings
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    for (let k = 0; k < 6; k++) {
      const a = rad(rot) + (k * TAU) / 6;
      if (Math.sin(a) <= 0) continue;
      const x = CX + Math.cos(a) * RP;
      ctx.fillRect(x - 2, y0, 4, y1 - y0);
    }
    ctx.fillStyle = p.ink;
    ctx.fillRect(CX - RP - 1.5, y0, 1.5, y1 - y0);
    ctx.fillRect(CX + RP, y0, 1.5, y1 - y0);
  }

  return {
    onEvents(events: readonly GameEvent[], v: HelixView) {
      for (const e of events) {
        const sy = (e.y as number | undefined) !== undefined ? (e.y as number) - cam + K * RM : 0;
        if (e.t === "bounce") {
          squash = 1;
          kit.fx.burst(CX, sy, safeColor(v.level), 6, 70, 300);
          splats.push({ ring: e.ring as number, a: FRONT - v.rot, s: 6 + ((v.frame * 7) % 4), color: p.primary });
          if (splats.length > 60) splats.shift();
        } else if (e.t === "pass") {
          const ring = v.rings[e.ring as number];
          shards.push({ y: ring.y, segs: ring.segs.slice(), rot: v.rot, t: 0, color: safeColor(v.level), smash: false });
          const combo = e.combo as number;
          kit.fx.popup(CX + 70, sy - 10, `+${e.pts as number}`, p.text);
          if (combo >= 2) kit.fx.popup(CX - 70, sy - 10, `x${combo}`, combo >= 3 ? p.accent : p.primary);
          kit.fx.burst(CX + 60, sy, safeColor(v.level), 5, 90, 200);
          kit.fx.burst(CX - 60, sy, safeColor(v.level), 5, 90, 200);
        } else if (e.t === "smash") {
          const ring = v.rings[e.ring as number];
          shards.push({ y: ring.y, segs: ring.segs.slice(), rot: v.rot, t: 0, color: safeColor(v.level), smash: true });
          kit.fx.addShake(8);
          kit.fx.flash("255,255,255");
          for (let i = 0; i < 4; i++) kit.fx.burst(CX + (i - 1.5) * 50, sy, i % 2 ? p.accent : safeColor(v.level), 12, 220, 500);
          kit.fx.popup(CX, sy - 24, `SMASH +${e.pts as number}`, p.accent);
          squash = 1;
        } else if (e.t === "die") {
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(CX, sy, p.accent, 26, 220);
          kit.fx.burst(CX, sy, p.primary, 12, 160);
        } else if (e.t === "clear") {
          kit.fx.popup(CX, sy - 40, `LEVEL CLEAR +${e.pts as number}`, p.primary);
          for (let i = 0; i < 6; i++) kit.fx.burst(40 + Math.random() * (FIELD_W - 80), sy - 40 - Math.random() * 80, p.bricks[i % p.bricks.length], 14, 220);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (v.level !== level) {
        level = v.level;
        splats = [];
        shards = [];
        trail.length = 0;
        cam = v.rings[0].y - ANCHOR;
      }
      // Camera: keep the ring the ball is heading to near ANCHOR, never scroll back up.
      const tgtRing = v.rings[Math.min(v.ringsPassed, v.rings.length - 1)];
      const target = Math.max(tgtRing.y - ANCHOR, v.ballY - ANCHOR - 40);
      // Snap when far behind (e.g. after a fast-forward), otherwise ease.
      if (Math.abs(target - cam) > FIELD_H) cam = target;
      else cam += (target - cam) * (1 - Math.exp(-dtMs / 110));

      kit.background(dtMs);

      // Rings, bottom to top: back half, pole slab, front half, splats.
      const top = cam - 80;
      const bottom = cam + FIELD_H + 80;
      const firstY = v.rings[0].y - cam;
      // Pole above the first ring.
      pole(Math.max(0, firstY - 1000), firstY + TH, v.rot);
      for (let i = v.rings.length - 1; i >= 0; i--) {
        const r = v.rings[i];
        if (r.y < top || r.y - 110 > bottom) continue;
        const y = r.y - cam;
        if (r.passed) {
          if (!r.pad) pole(y - 110, y + TH, v.rot);
          continue;
        }
        if (r.pad) {
          // Goal pad: a full disc with a glowing rim.
          ringHalf(y, r.segs, v.rot, false, v.level, true);
          pole(y - 110, y, v.rot);
          ringHalf(y, r.segs, v.rot, true, v.level, true);
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t / 200);
          ctx.strokeStyle = p.primary;
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.ellipse(CX, y, RO + 4, (RO + 4) * K, 0, 0, TAU);
          ctx.stroke();
          ctx.globalAlpha = 1;
          kit.text("GOAL", CX, y + RO * K * 0.55, 12, p.text);
          continue;
        }
        ringHalf(y, r.segs, v.rot, false, v.level, false);
        pole(y - 110, y + TH, v.rot);
        ringHalf(y, r.segs, v.rot, true, v.level, false);
        for (const s of splats) {
          if (s.ring !== i) continue;
          const a = rad(s.a + v.rot);
          if (Math.sin(a) < -0.1) continue;
          const sx = ex(a, RM);
          const sy = ey(a, RM, y);
          const w = s.s * (0.55 + 0.45 * Math.abs(Math.sin(a)));
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.ellipse(sx, sy, w, w * K * 1.2, 0, 0, TAU);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      }

      // Shards of passed / smashed rings fly outward and fade.
      shards = shards.filter((s) => (s.t += dtMs) < (s.smash ? 600 : 420));
      for (const s of shards) {
        const k = s.t / (s.smash ? 600 : 420);
        ctx.globalAlpha = 1 - k;
        const y = s.y - cam + k * (s.smash ? -10 : 18);
        const sc = 1 + k * (s.smash ? 0.9 : 0.45);
        ringHalf(y, s.segs, s.rot + k * 120, false, v.level, false, sc);
        ringHalf(y, s.segs, s.rot + k * 120, true, v.level, false, sc);
        ctx.globalAlpha = 1;
      }

      // Ball shadow on the ring below.
      const ballSy = v.ballY - cam + K * RM;
      const below = v.rings[Math.min(v.ringsPassed, v.rings.length - 1)];
      if (!v.dead && below) {
        const gy = below.y - cam + K * RM;
        const d = Math.max(0, Math.min(1, (below.y - v.ballY) / 110));
        ctx.globalAlpha = 0.35 * (1 - d * 0.7);
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.ellipse(CX, gy, 11 * (1 - d * 0.4), 4 * (1 - d * 0.4), 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      // Super trail.
      trail.push(ballSy);
      if (trail.length > 10) trail.shift();
      if (v.superBall && !v.dead) {
        for (let i = 0; i < trail.length; i++) {
          const a = (i + 1) / trail.length;
          ctx.globalAlpha = 0.5 * a;
          ctx.fillStyle = i % 2 ? p.accent : "#ffffff";
          ctx.beginPath();
          ctx.arc(CX, trail[i] - 4, BALL_R * (0.5 + 0.7 * a), 0, TAU);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        if (Math.random() < 0.6) kit.fx.burst(CX, ballSy, Math.random() < 0.5 ? p.accent : "#ffffff", 1, 60, -80);
      }

      // Ball: mascot head with squash & stretch.
      squash = Math.max(0, squash - dtMs / 140);
      const stretch = v.vy > 0 ? Math.min(0.25, v.vy * 0.025) : 0;
      const sxk = 1 + squash * 0.3 - stretch * 0.4;
      const syk = 1 - squash * 0.3 + stretch;
      const size = BALL_R * 3.2;
      const sprite = v.dead ? kit.sprites.sad : v.superBall || v.clearing > 0 ? kit.sprites.happy : kit.sprites.mini;
      if (v.superBall && !v.dead) {
        ctx.globalAlpha = 0.45 + 0.25 * Math.sin(t / 60);
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(CX, ballSy - BALL_R, size * 0.75, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.drawImage(sprite, CX - (size * sxk) / 2, ballSy - size * syk, size * sxk, size * syk);

      // Progress bar: rings passed this level.
      const bw = FIELD_W - 120;
      const frac = v.ringsTotal > 0 ? Math.min(1, v.ringsPassed / v.ringsTotal) : 0;
      kit.block(60, 10, bw, 12, p.wall, 5);
      if (frac > 0) kit.block(60, 10, Math.max(12, bw * frac), 12, p.primary, 5);
      kit.text(String(v.level + 1), 44, 16, 11, p.text);
      kit.text(String(v.level + 2), FIELD_W - 44, 16, 11, p.text);

      if (v.combo >= 2 && !v.dead) kit.text(v.superBall ? `SUPER x${v.combo}` : `x${v.combo}`, CX, 44, v.superBall ? 18 : 14, v.superBall ? p.accent : p.primary);
      if (v.clearing > 0) kit.text(`LEVEL ${v.level + 1} CLEAR!`, CX, FIELD_H * 0.32, 22, p.primary);
      if (v.level === 0 && v.ringsPassed === 0 && v.frame < 400) {
        kit.text("DRAG OR ← → TO SPIN", CX, FIELD_H - 40, 13, p.text);
        kit.text("AVOID THE STRIPED ZONES", CX, FIELD_H - 22, 10, p.accent);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
