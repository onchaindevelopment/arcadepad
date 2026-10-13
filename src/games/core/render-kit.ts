// Shared helpers for game renderers (client only): canvas setup, theme
// sprites, particles, popups, shake and backdrops. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { gridToCanvas } from "../../themes/pixel.ts";

export const RENDER_SCALE = 2;

export interface Kit {
  ctx: CanvasRenderingContext2D;
  w: number;
  h: number;
  theme: ThemePack;
  font: string; // pixel font family for canvas text
  sprites: { idle: HTMLCanvasElement; happy: HTMLCanvasElement; sad: HTMLCanvasElement; mini: HTMLCanvasElement };
  fx: Fx;
  /** Clear + background gradient + animated backdrop. */
  background(dtMs: number): void;
  /** Pixel-font text with a 1px ink shadow. */
  text(s: string, x: number, y: number, size: number, color: string, align?: CanvasTextAlign): void;
  /** Rounded chunky block (ink outline + bevel), used for bricks/tiles/platforms. */
  block(x: number, y: number, w: number, h: number, color: string, radius?: number): void;
}

/** Prepare a canvas for a w x h field. Call once per renderer. */
export function makeKit(canvas: HTMLCanvasElement, theme: ThemePack, w: number, h: number): Kit {
  canvas.width = w * RENDER_SCALE;
  canvas.height = h * RENDER_SCALE;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  ctx.imageSmoothingEnabled = false;
  const silk = getComputedStyle(document.documentElement).getPropertyValue("--font-silk").trim();
  const font = silk ? `${silk}, monospace` : "monospace";
  const p = theme.palette;
  const fx = new Fx();
  const motes = Array.from({ length: 40 }, (_, i) => ({
    x: Math.random() * w,
    y: Math.random() * h,
    s: 1 + Math.random() * 2.5,
    v: 6 + Math.random() * 18,
    p: Math.random() * 6.28,
    c: [p.primary, p.secondary, p.accent, "#ffffff"][i % 4],
  }));
  let t = 0;

  const kit: Kit = {
    ctx,
    w,
    h,
    theme,
    font,
    sprites: {
      idle: gridToCanvas(theme.mascot.idle, theme.pixels, 4),
      happy: gridToCanvas(theme.mascot.happy, theme.pixels, 4),
      sad: gridToCanvas(theme.mascot.sad, theme.pixels, 4),
      mini: gridToCanvas(theme.mascot.mini, theme.pixels, 4),
    },
    fx,
    background(dtMs) {
      t += dtMs;
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      ctx.imageSmoothingEnabled = false;
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, p.bg2);
      g.addColorStop(1, p.bg);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
      for (const m of motes) {
        if (theme.backdrop === "bubbles") {
          m.y -= (m.v * dtMs) / 1000;
          if (m.y < -6) m.y = h + 6;
          ctx.strokeStyle = m.c;
          ctx.globalAlpha = 0.2;
          ctx.beginPath();
          ctx.arc(m.x + Math.sin(t / 900 + m.p) * 4, m.y, m.s * 2, 0, Math.PI * 2);
          ctx.stroke();
        } else if (theme.backdrop === "confetti") {
          m.y += (m.v * dtMs) / 1000;
          if (m.y > h + 6) m.y = -6;
          ctx.fillStyle = m.c;
          ctx.globalAlpha = 0.25;
          ctx.save();
          ctx.translate(m.x + Math.sin(t / 700 + m.p) * 6, m.y);
          ctx.rotate(t / 600 + m.p);
          ctx.fillRect(-m.s, -m.s / 2, m.s * 2, m.s);
          ctx.restore();
        } else {
          ctx.fillStyle = m.c;
          ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(t / 500 + m.p));
          const s = m.s > 2.5 ? 2 : 1;
          ctx.fillRect(Math.round(m.x), Math.round(m.y), s, s);
        }
      }
      ctx.globalAlpha = 1;
      fx.applyShake(ctx, dtMs);
    },
    text(s, x, y, size, color, align = "center") {
      ctx.font = `bold ${size}px ${font}`;
      ctx.textAlign = align;
      ctx.textBaseline = "middle";
      ctx.fillStyle = p.ink;
      ctx.fillText(s, x + 1, y + 1);
      ctx.fillStyle = color;
      ctx.fillText(s, x, y);
    },
    block(x, y, bw, bh, color, radius = 3) {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(x, y, bw, bh, radius + 1);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, bw - 3, bh - 3, radius);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x + 3, y + 3, Math.max(0, bw - 6), Math.min(3, bh / 5));
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(x + 3, y + bh - 3 - Math.min(3, bh / 5), Math.max(0, bw - 6), Math.min(3, bh / 5));
    },
  };
  return kit;
}

interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number; g: number }
interface Popup { x: number; y: number; text: string; life: number; color: string }

/** Particles, score popups, screen shake and flash. Call draw() after the scene. */
export class Fx {
  private ps: Particle[] = [];
  private pops: Popup[] = [];
  private shake = 0;
  private flashA = 0;
  private flashC = "255,60,100";

  burst(x: number, y: number, color: string, n = 10, speed = 120, gravity = 420) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = speed * (0.4 + Math.random() * 0.8);
      this.ps.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: 350 + Math.random() * 400, color, size: 2 + Math.random() * 3, g: gravity });
    }
  }
  popup(x: number, y: number, text: string, color: string) {
    this.pops.push({ x, y, text, life: 900, color });
  }
  addShake(n: number) {
    this.shake = Math.max(this.shake, n);
  }
  flash(rgb = "255,60,100") {
    this.flashA = 1;
    this.flashC = rgb;
  }
  applyShake(ctx: CanvasRenderingContext2D, dtMs: number) {
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dtMs * 0.03);
    }
  }
  draw(kit: Kit, dtMs: number) {
    const { ctx } = kit;
    const dt = dtMs / 1000;
    this.ps = this.ps.filter((q) => (q.life += dtMs) < q.max);
    for (const q of this.ps) {
      q.vy += q.g * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      ctx.globalAlpha = 1 - q.life / q.max;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, q.size, q.size);
    }
    ctx.globalAlpha = 1;
    this.pops = this.pops.filter((q) => (q.life -= dtMs) > 0);
    for (const q of this.pops) {
      q.y -= 30 * dt;
      ctx.globalAlpha = Math.min(1, q.life / 400);
      kit.text(q.text, q.x, q.y, 12, q.color);
    }
    ctx.globalAlpha = 1;
    if (this.flashA > 0) {
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      ctx.fillStyle = `rgba(${this.flashC},${this.flashA * 0.35})`;
      ctx.fillRect(0, 0, kit.w, kit.h);
      this.flashA = Math.max(0, this.flashA - dtMs / 400);
    }
  }
}
