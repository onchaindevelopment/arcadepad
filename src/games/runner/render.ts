// Candle Run renderer: parallax chart skyline, scrolling ground, red/green
// candles, rocks, paper planes and a squashy coin mascot. All colours come
// from the coin theme (candle red/green are picked from the theme palette).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { FIELD_H, FIELD_W, GROUND_Y, PLAYER_H, PLAYER_W, type ObstacleView, type RunnerView } from "./index.ts";

interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function hue(hex: string): { h: number; s: number } {
  const [r, g, b] = hexRgb(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  if (d === 0) return { h: 0, s: 0 };
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h, s: max === 0 ? 0 : d / max };
}
/** Theme colour closest to a target hue (0 = red, 120 = green), ignoring greys. */
function pickHue(colors: string[], target: number, avoid?: string): string {
  let best = colors[0], bestD = Infinity;
  for (const c of colors) {
    if (c === avoid) continue;
    const { h, s } = hue(c);
    if (s < 0.25) continue;
    const d = Math.min(Math.abs(h - target), 360 - Math.abs(h - target));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<RunnerView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const pool = [p.primary, p.secondary, p.accent, ...p.bricks];
  const green = pickHue(pool, 120);
  const red = pickHue(pool, 355, green);
  let t = 0;
  let sx = 1, sy = 1; // mascot squash/stretch
  let lastFrame = -1;
  let runDust = 0;
  let happyMs = 0;
  let puffs: Puff[] = [];
  const stars = Array.from({ length: 30 }, () => ({ x: Math.random() * FIELD_W, y: Math.random() * (GROUND_Y - 60), p: Math.random() * 6.28 }));

  function puff(x: number, y: number, n: number, spread: number, drift: number) {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      puffs.push({ x: x + dir * Math.random() * 8, y: y - 2, vx: dir * spread * (0.4 + Math.random() * 0.8) + drift, vy: -10 - Math.random() * 25, r: 2 + Math.random() * 3, life: 0, max: 300 + Math.random() * 300 });
    }
  }

  // Deterministic-looking skyline: a wavy "price chart" ridge.
  function ridge(x: number, seed: number, amp: number): number {
    return Math.sin(x * 0.013 + seed) * amp + Math.sin(x * 0.037 + seed * 2.1) * amp * 0.5 + Math.sin(x * 0.11 + seed * 0.7) * amp * 0.15;
  }

  function drawLayer(scroll: number, base: number, amp: number, seed: number, color: string, candles: boolean) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    const off = scroll;
    for (let x = 0; x <= FIELD_W + 8; x += 8) ctx.lineTo(x, base + ridge(x + off, seed, amp));
    ctx.lineTo(FIELD_W, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    if (candles) {
      // Faint background candle chart riding on the far ridge.
      const step = 22;
      const first = Math.floor(off / step);
      for (let i = first; i < first + FIELD_W / step + 2; i++) {
        const x = i * step - off;
        const k = Math.sin(i * 12.9898) * 43758.5453;
        const r = k - Math.floor(k);
        const up = r > 0.45;
        const top = base - 22 + ridge(i * step, seed, amp) - r * 18;
        const hgt = 6 + r * 14;
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = up ? green : red;
        ctx.fillRect(x + 2, top, 6, hgt);
        ctx.fillRect(x + 4.5, top - 4, 1, hgt + 8);
        ctx.globalAlpha = 1;
      }
    }
  }

  function drawCandle(x: number, y: number, w: number, h: number, color: string) {
    // Wick, then a chunky body.
    ctx.fillStyle = p.ink;
    ctx.fillRect(x + w / 2 - 1.5, y, 3, 10);
    ctx.fillStyle = rgba(color, 0.9);
    ctx.fillRect(x + w / 2 - 0.5, y + 1, 1, 8);
    kit.block(x + 1, y + 7, w - 2, h - 7, color, 2);
  }

  function drawRock(o: ObstacleView) {
    const { x, y, w, h } = o;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(x, y + h);
    ctx.lineTo(x + 3, y + 7);
    ctx.lineTo(x + 9, y + 1);
    ctx.lineTo(x + w - 9, y);
    ctx.lineTo(x + w - 2, y + 8);
    ctx.lineTo(x + w, y + h);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + h - 1);
    ctx.lineTo(x + 4.5, y + 8);
    ctx.lineTo(x + 10, y + 2.5);
    ctx.lineTo(x + w - 10, y + 1.5);
    ctx.lineTo(x + w - 3.5, y + 9);
    ctx.lineTo(x + w - 2, y + h - 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(x + 8, y + 4, w - 18, 2);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x + 4, y + h - 5, w - 8, 3);
  }

  function drawPlane(o: ObstacleView, frame: number) {
    const { x, y } = o;
    const flap = Math.floor(frame / 10) % 2 === 0 ? 0 : 5; // 6 fps wing beat, like the original flyer
    const cy = y + 20;
    // Speed streaks behind.
    ctx.fillStyle = rgba(p.text, 0.25);
    ctx.fillRect(x + 48, cy - 6, 10, 1);
    ctx.fillRect(x + 50, cy + 2, 14, 1);
    // Body outline.
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(x - 1, cy);
    ctx.lineTo(x + 47, y + 8 + flap);
    ctx.lineTo(x + 47, y + 31);
    ctx.closePath();
    ctx.fill();
    // Top wing (light) and under-fold (shaded).
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.moveTo(x + 1, cy);
    ctx.lineTo(x + 45, y + 10 + flap);
    ctx.lineTo(x + 34, cy + 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(x + 1, cy);
    ctx.lineTo(x + 34, cy + 2);
    ctx.lineTo(x + 45, y + 29);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + 2, cy);
    ctx.lineTo(x + 34, cy + 2);
    ctx.stroke();
  }

  return {
    onEvents(events: readonly GameEvent[], v: RunnerView) {
      for (const e of events) {
        if (e.t === "jump") {
          sx = 0.72;
          sy = 1.32;
          puff(e.x!, e.y!, 4, 30, -v.speed * 20);
        } else if (e.t === "land") {
          const hard = e.hard as boolean;
          sx = hard ? 1.45 : 1.3;
          sy = hard ? 0.62 : 0.72;
          puff(e.x!, e.y!, hard ? 12 : 7, hard ? 70 : 45, -v.speed * 25);
        } else if (e.t === "hit") {
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.accent, 22, 220);
          kit.fx.burst(e.x!, e.y!, p.primary, 14, 160);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 8, 260);
          sx = 1.4;
          sy = 0.7;
        } else if (e.t === "milestone") {
          kit.fx.popup(e.x!, e.y! - 6, String(e.score as number), p.primary);
          kit.fx.burst(e.x!, e.y!, p.primary, 10, 120, 200);
          kit.fx.burst(e.x!, e.y!, p.accent, 8, 100, 200);
          happyMs = 900;
        } else if (e.t === "night") {
          kit.fx.flash("255,255,255");
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const dt = dtMs / 1000;
      kit.background(dtMs);
      const night = v.night;

      // Night stars (fade in with the inversion).
      if (night > 0) {
        for (const s of stars) {
          ctx.globalAlpha = night * (0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t / 300 + s.p)));
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(Math.round(s.x), Math.round(s.y), 1.5, 1.5);
        }
        ctx.globalAlpha = 1;
      }
      // Moon.
      const mx = FIELD_W - 70;
      ctx.globalAlpha = 0.35 + 0.55 * night;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(mx, 34, 13, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.bg2;
      ctx.beginPath();
      ctx.arc(mx + 6, 30, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      // Parallax layers.
      drawLayer(v.distance * 0.12, GROUND_Y - 58, 16, 1.3, rgba(p.wall, 0.55), true);
      drawLayer(v.distance * 0.35, GROUND_Y - 22, 9, 4.1, rgba(p.wall, 0.9), false);

      // Ground.
      ctx.fillStyle = p.ink;
      ctx.fillRect(0, GROUND_Y, FIELD_W, FIELD_H - GROUND_Y);
      ctx.fillStyle = rgba(p.wall, 0.8);
      ctx.fillRect(0, GROUND_Y + 2, FIELD_W, FIELD_H - GROUND_Y);
      ctx.fillStyle = p.primary;
      ctx.fillRect(0, GROUND_Y, FIELD_W, 2);
      // Scrolling dashes and pebbles at full speed.
      const g = v.distance % 40;
      ctx.fillStyle = rgba(p.text, 0.25);
      for (let x = -g; x < FIELD_W; x += 40) {
        ctx.fillRect(x, GROUND_Y + 6, 14, 2);
        ctx.fillRect(x + 23, GROUND_Y + 12, 4, 2);
      }
      const g2 = v.distance % 97;
      ctx.fillStyle = rgba(p.secondary, 0.5);
      for (let x = -g2; x < FIELD_W; x += 97) ctx.fillRect(x + 50, GROUND_Y + 15, 6, 2);

      // Night tint behind the action (the original inverts the whole page).
      if (night > 0) {
        ctx.fillStyle = rgba(p.ink, 0.45 * night);
        ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      }

      // Speed streaks once things get fast.
      if (v.speed > 10 && !v.dead) {
        ctx.fillStyle = rgba(p.text, Math.min(0.25, (v.speed - 10) * 0.06));
        for (let i = 0; i < 6; i++) {
          const y = 20 + ((i * 37) % (GROUND_Y - 30));
          const x = FIELD_W - ((t * (0.6 + i * 0.13) + i * 140) % (FIELD_W + 80));
          ctx.fillRect(x, y, 30 + i * 4, 1);
        }
      }

      // Obstacles.
      for (const o of v.obstacles) {
        if (o.kind === "plane") drawPlane(o, v.frame);
        else if (o.kind === "rock") drawRock(o);
        else {
          const each = o.w / o.size;
          for (let i = 0; i < o.size; i++) drawCandle(o.x + i * each, o.y, each, o.h, (o.up ? i % 2 === 0 : i % 2 === 1) ? green : red);
        }
      }

      // Dust puffs.
      if (v.started && !v.jumping && !v.dead && v.frame !== lastFrame) {
        runDust += dtMs;
        if (runDust > 140) {
          runDust = 0;
          puffs.push({ x: v.x + 8, y: GROUND_Y - 2, vx: -v.speed * 18, vy: -8 - Math.random() * 10, r: 1.5 + Math.random() * 1.5, life: 0, max: 280 });
        }
      }
      lastFrame = v.frame;
      puffs = puffs.filter((q) => (q.life += dtMs) < q.max);
      for (const q of puffs) {
        q.x += q.vx * dt;
        q.y += q.vy * dt;
        q.vy += 30 * dt;
        const k = q.life / q.max;
        ctx.globalAlpha = 0.45 * (1 - k);
        ctx.fillStyle = p.text;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (1 + k * 1.6), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Mascot: shadow, then a squashy coin anchored at its feet.
      const cx = v.x + v.w / 2;
      const feet = v.y + v.h;
      const air = Math.max(0, GROUND_Y - feet);
      ctx.fillStyle = rgba(p.ink, Math.max(0.12, 0.4 - air / 250));
      ctx.beginPath();
      ctx.ellipse(cx, GROUND_Y + 1, Math.max(8, 20 - air / 8), 3, 0, 0, Math.PI * 2);
      ctx.fill();

      const tx = v.ducking ? 1.2 : 1;
      const ty = v.ducking ? 0.6 : 1;
      const ease = Math.min(1, dtMs / 70);
      sx += (tx - sx) * ease;
      sy += (ty - sy) * ease;
      if (v.jumping && !v.speedDrop) {
        // Stretch on the way up, round out at the top.
        const k = Math.max(-1, Math.min(1, v.vy / 10));
        sx += (1 - 0.08 * -k - sx) * ease * 0.5;
        sy += (1 + 0.1 * -k - sy) * ease * 0.5;
      }
      const bob = v.started && !v.jumping && !v.dead && !v.ducking ? -Math.abs(Math.sin(v.distance / 14)) * 2 : 0;
      const tilt = v.dead ? 0.5 : v.jumping ? Math.max(-0.35, Math.min(0.35, v.vy * 0.03)) : v.ducking ? 0 : Math.sin(v.distance / 14) * 0.05;
      if (happyMs > 0) happyMs -= dtMs;
      const sprite = v.dead ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.mini;
      const size = sprite === kit.sprites.mini ? PLAYER_W + 2 : PLAYER_W + 10;
      ctx.save();
      ctx.translate(cx, feet + bob);
      ctx.rotate(tilt);
      ctx.scale(sx, sy);
      ctx.drawImage(sprite, -size / 2, -size + (size - PLAYER_H) / 2 + 1, size, size);
      ctx.restore();

      if (!v.started) {
        const a = 0.6 + 0.4 * Math.sin(t / 250);
        ctx.globalAlpha = a;
        kit.text("SPACE / TAP TO JUMP", FIELD_W / 2, 70, 14, p.text);
        ctx.globalAlpha = 1;
        kit.text("DOWN TO DUCK", FIELD_W / 2, 92, 10, p.primary);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
