// Moon Stack renderer: 2.5D slabs in the coin's brick colours, the mascot
// riding the sliding slab, falling offcuts, and a sky that fades to stars and
// a moon as the tower climbs.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { H, MILESTONE, MOON_HEIGHT, SLAB_H, W, milestoneName, type StackView } from "./index.ts";

const DX = 7; // isometric depth offset (right)
const DY = 9; // isometric depth offset (up)
const GROUND = H - 46; // screen y of the base slab's bottom when the camera is at 0
const TOP_SCREEN = 250; // the camera keeps the sliding slab around this screen y
const MOON_Y = (MOON_HEIGHT + 3) * SLAB_H; // world height of the moon's centre

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => (k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k));

interface Piece { x: number; y: number; w: number; vx: number; vy: number; rot: number; vr: number; c: RGB; life: number }
interface Star { x: number; y: number; s: number; p: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<StackView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = (p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent]).map(rgb);
  const ink = rgb(p.ink);
  const sky = rgb(p.secondary);
  const space = rgb(p.bg);
  const moonC = rgb(p.text);
  const stars: Star[] = Array.from({ length: 70 }, () => ({ x: Math.random() * W, y: Math.random() * H * 1.5, s: Math.random() < 0.2 ? 2 : 1, p: Math.random() * 6.28 }));
  const pieces: Piece[] = [];
  let cam = 0; // world height at the bottom of the screen offset
  let t = 0;
  let happyMs = 0;
  let bob = 0;
  let banner: { text: string; ms: number } | null = null;

  const colorAt = (i: number): RGB => {
    // Smooth gradient through the brick colours, 6 slabs per colour.
    const f = i / 6;
    const k = Math.floor(f);
    return mix(bricks[k % bricks.length], bricks[(k + 1) % bricks.length], f - k);
  };
  const sy = (worldY: number) => GROUND - (worldY - cam);

  function slab(x: number, worldY: number, w: number, c: RGB, alpha = 1) {
    const y = sy(worldY); // bottom edge of the front face
    const top = y - SLAB_H;
    ctx.globalAlpha = alpha;
    // Right side face.
    ctx.fillStyle = css(shade(c, -0.38));
    ctx.beginPath();
    ctx.moveTo(x + w, top);
    ctx.lineTo(x + w + DX, top - DY);
    ctx.lineTo(x + w + DX, y - DY);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.fill();
    // Front face with a vertical gradient.
    const g = ctx.createLinearGradient(0, top, 0, y);
    g.addColorStop(0, css(shade(c, 0.08)));
    g.addColorStop(1, css(shade(c, -0.18)));
    ctx.fillStyle = g;
    ctx.fillRect(x, top, w, SLAB_H);
    // Top face.
    ctx.fillStyle = css(shade(c, 0.35));
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + DX, top - DY);
    ctx.lineTo(x + w + DX, top - DY);
    ctx.lineTo(x + w, top);
    ctx.closePath();
    ctx.fill();
    // Ink outline + front highlight.
    ctx.strokeStyle = css(ink, 0.85);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, top);
    ctx.lineTo(x + DX, top - DY);
    ctx.lineTo(x + w + DX, top - DY);
    ctx.lineTo(x + w + DX, y - DY);
    ctx.lineTo(x + w, y);
    ctx.closePath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + w, top);
    ctx.lineTo(x + w + DX, top - DY);
    ctx.moveTo(x + w, top);
    ctx.lineTo(x + w, y);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.fillRect(x + 2, top + 2, Math.max(0, w - 4), 2);
    ctx.globalAlpha = 1;
  }

  function drawSky(v: StackView) {
    // Altitude 0..1: blue-ish theme sky at the ground, deep space near the moon.
    const alt = Math.min(1, cam / (MOON_HEIGHT * SLAB_H));
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, css(mix(sky, space, 0.35 + alt * 0.65), 1 - alt * 0.75));
    g.addColorStop(1, css(mix(shade(sky, 0.25), space, alt), 1 - alt * 0.9));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    // Stars fade in with altitude and drift with a slow parallax.
    const sa = Math.min(1, 0.12 + alt * 1.1);
    for (const s of stars) {
      const y = ((s.y + cam * 0.15) % (H * 1.5)) - H * 0.25;
      ctx.globalAlpha = sa * (0.45 + 0.55 * (0.5 + 0.5 * Math.sin(t / 420 + s.p)));
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(Math.round(s.x), Math.round(y), s.s, s.s);
    }
    ctx.globalAlpha = 1;
    // The moon.
    const my = sy(MOON_Y);
    if (my > -120 && my < H + 120) {
      const r = 64;
      const glow = ctx.createRadialGradient(W * 0.68, my, r * 0.6, W * 0.68, my, r * 2);
      glow.addColorStop(0, css(moonC, 0.35));
      glow.addColorStop(1, css(moonC, 0));
      ctx.fillStyle = glow;
      ctx.fillRect(0, my - r * 2, W, r * 4);
      ctx.fillStyle = css(ink);
      ctx.beginPath();
      ctx.arc(W * 0.68, my, r + 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(moonC);
      ctx.beginPath();
      ctx.arc(W * 0.68, my, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = css(shade(moonC, -0.18));
      for (const [cx, cy, cr] of [[-20, -14, 12], [18, 10, 16], [-6, 26, 8], [26, -24, 7]]) {
        ctx.beginPath();
        ctx.arc(W * 0.68 + cx, my + cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Clouds near the ground.
    const cloudA = Math.max(0, 0.5 - alt * 2.2);
    if (cloudA > 0) {
      ctx.fillStyle = `rgba(255,255,255,${cloudA})`;
      for (let i = 0; i < 5; i++) {
        const cx = ((i * 97 + t * 0.006 * (i + 1)) % (W + 120)) - 60;
        const cy = sy(120 + i * 110);
        ctx.beginPath();
        ctx.ellipse(cx, cy, 34, 9, 0, 0, Math.PI * 2);
        ctx.ellipse(cx + 18, cy - 6, 20, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Milestone lines.
    for (let lv = 1; lv <= Math.floor(v.height / MILESTONE) + 2; lv++) {
      const y = sy(lv * MILESTONE * SLAB_H) - SLAB_H;
      if (y < -10 || y > H + 10) continue;
      ctx.strokeStyle = css(rgb(p.text), 0.35);
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
      ctx.setLineDash([]);
      kit.text(`${lv * MILESTONE} · ${milestoneName(lv)}`, 8, y - 8, 9, p.text, "left");
    }
  }

  function drawGround() {
    const y = sy(0);
    if (y > H + 40) return;
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.moveTo(0, y + 8);
    ctx.quadraticCurveTo(W / 2, y - 14, W, y + 8);
    ctx.lineTo(W, H + 40);
    ctx.lineTo(0, H + 40);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  function drawMeter(v: StackView) {
    // Altitude meter: a thin bar on the right edge with the mascot's mini head.
    const x = W - 10, y0 = 70, y1 = H - 70;
    ctx.fillStyle = css(ink, 0.55);
    ctx.fillRect(x - 2, y0, 4, y1 - y0);
    const f = Math.min(1, v.height / MOON_HEIGHT);
    ctx.fillStyle = p.accent;
    ctx.fillRect(x - 2, y1 - (y1 - y0) * f, 4, (y1 - y0) * f);
    ctx.fillStyle = css(moonC);
    ctx.beginPath();
    ctx.arc(x, y0 - 6, 5, 0, Math.PI * 2);
    ctx.fill();
    const s = 14;
    ctx.drawImage(kit.sprites.mini, x - s / 2, y1 - (y1 - y0) * f - s / 2, s, s);
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const level = (e.level as number) ?? v.height;
        if (e.t === "drop") {
          bob = 1;
        } else if (e.t === "slice" || e.t === "miss") {
          const side = e.side as number;
          pieces.push({
            x: e.x!, y: level * SLAB_H, w: e.w as number,
            vx: side * (0.5 + Math.random() * 0.8), vy: 0,
            rot: 0, vr: side * (0.02 + Math.random() * 0.03),
            c: colorAt(level), life: 0,
          });
          if (e.t === "miss") {
            kit.fx.addShake(10);
            kit.fx.flash();
            banner = { text: "MISSED!", ms: 99999 };
          } else {
            kit.fx.burst(side < 0 ? (e.x as number) + (e.w as number) : e.x!, sy(level * SLAB_H) - SLAB_H / 2, css(shade(colorAt(level), 0.4)), 6, 80);
          }
        } else if (e.t === "perfect") {
          happyMs = 900;
          const y = sy(level * SLAB_H) - SLAB_H;
          const streak = e.streak as number;
          for (let i = 0; i < 3; i++) kit.fx.burst(e.x! - 40 + i * 40, y, p.bricks[(level + i) % p.bricks.length] ?? p.accent, 8, 130, 300);
          kit.fx.popup(e.x!, y - 22, streak > 1 ? `PERFECT x${streak}` : "PERFECT", p.primary);
          if (e.grew) kit.fx.popup(e.x!, y - 8, "WIDER!", p.accent);
        } else if (e.t === "milestone") {
          happyMs = 1600;
          banner = { text: e.name as string, ms: 1800 };
          for (let i = 0; i < 6; i++) kit.fx.burst(30 + Math.random() * (W - 60), 120 + Math.random() * 160, p.bricks[i % p.bricks.length] ?? p.accent, 14, 200);
          kit.fx.flash("255,255,255");
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const dt = Math.min(50, dtMs);
      happyMs = Math.max(0, happyMs - dtMs);
      bob = Math.max(0, bob - dtMs / 220);
      // Camera: keep the sliding slab near TOP_SCREEN.
      const target = Math.max(0, (v.slabs.length + 1) * SLAB_H - (GROUND - TOP_SCREEN));
      cam += (target - cam) * Math.min(1, dt / 160);

      kit.background(dtMs);
      drawSky(v);
      drawGround();

      // Tower: only the visible slabs.
      const lo = Math.max(0, Math.floor((cam - 40) / SLAB_H));
      const hi = Math.min(v.slabs.length - 1, Math.ceil((cam + H) / SLAB_H) + 1);
      for (let i = lo; i <= hi; i++) {
        const s = v.slabs[i];
        slab(s.x, i * SLAB_H, s.w, i === 0 ? rgb(p.wall) : colorAt(i));
      }

      const level = v.slabs.length;
      const top = v.slabs[level - 1];
      if (v.moving) {
        const m = v.moving;
        // Drop shadow on the slab below.
        const l = Math.max(m.x, top.x), r = Math.min(m.x + m.w, top.x + top.w);
        if (r > l) {
          ctx.fillStyle = css(ink, 0.25);
          ctx.fillRect(l, sy(level * SLAB_H) - 3, r - l, 3);
        }
        slab(m.x, level * SLAB_H, m.w, colorAt(level));
      }

      // Falling offcuts.
      for (let i = pieces.length - 1; i >= 0; i--) {
        const q = pieces[i];
        q.life += dt;
        q.vy += 0.0009 * dt * 16;
        q.x += q.vx * dt / 16;
        q.y -= q.vy * dt;
        q.rot += q.vr * dt / 16;
        const y = sy(q.y);
        if (y > H + 200 || q.life > 4000) {
          pieces.splice(i, 1);
          continue;
        }
        ctx.save();
        ctx.translate(q.x + q.w / 2, y - SLAB_H / 2);
        ctx.rotate(q.rot);
        ctx.translate(-(q.x + q.w / 2), -(y - SLAB_H / 2));
        slab(q.x, q.y, q.w, q.c, Math.max(0.2, 1 - q.life / 3000));
        ctx.restore();
      }

      // Mascot rides the sliding slab; after a miss it sits sad on the tower.
      const host = v.moving ?? top;
      const hostLevel = v.moving ? level : level - 1;
      const sprite = v.dead ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.idle;
      const size = Math.min(36, Math.max(24, host.w * 0.5));
      const hop = happyMs > 0 ? Math.abs(Math.sin(t / 110)) * 6 : bob * 4;
      const mx = host.x + host.w / 2 + DX / 2 - size / 2;
      const my = sy(hostLevel * SLAB_H) - SLAB_H - DY / 2 - size + 2 - hop;
      ctx.drawImage(sprite, Math.round(mx), Math.round(my), size, size);

      drawMeter(v);

      if (banner) {
        banner.ms -= dtMs;
        const a = Math.min(1, banner.ms / 400);
        ctx.globalAlpha = Math.max(0, a);
        kit.text(banner.text, W / 2, 120, 24, v.dead ? p.accent : p.primary);
        ctx.globalAlpha = 1;
        if (banner.ms <= 0) banner = null;
      }
      if (v.height === 0 && !v.dead) kit.text("TAP OR SPACE TO DROP", W / 2, H - 18, 12, p.text);

      kit.fx.draw(kit, dtMs);
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    },
  };
}
