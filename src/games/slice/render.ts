// Coin Slash renderer: spinning coins, candles and gems in the coin's palette,
// split halves, juice splats, a fading blade trail, fizzing rug bombs.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { H, LIVES, W, type ObjKind, type SliceView } from "./index.ts";

interface Half { kind: ObjKind; color: number; r: number; x: number; y: number; vx: number; vy: number; rot: number; vr: number; side: 1 | -1; cut: number; life: number }
interface Splat { x: number; y: number; color: string; life: number; blobs: { dx: number; dy: number; s: number }[] }
interface TrailPt { x: number; y: number; age: number }
interface Spark { x: number; y: number; vx: number; vy: number; life: number }

const TAU = Math.PI * 2;
const TRAIL_MS = 160;

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SliceView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const glyph = (theme.coin.ticker || theme.coin.name || "$").slice(0, 1).toUpperCase();
  let t = 0;
  let halves: Half[] = [];
  let splats: Splat[] = [];
  let trail: TrailPt[] = [];
  let sparks: Spark[] = [];
  let lastBladeFrame = -1;
  const xPop = [0, 0, 0]; // per-life pop animation
  let waveBanner = { n: 0, life: 0 };
  let mood: { sprite: HTMLCanvasElement; life: number } | null = null;

  const colorOf = (kind: ObjKind, c: number) =>
    kind === "candle" ? (c === 0 ? p.primary : p.accent) : kind === "slow" ? p.secondary : kind === "bomb" ? p.ink : bricks[c % bricks.length];

  function disc(r: number, fill: string) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
  }

  /** Draw one object centred at the current transform origin. */
  function shape(kind: ObjKind, color: number, r: number, flip: number) {
    const fill = colorOf(kind, color);
    if (kind === "coin") {
      ctx.scale(flip, 1);
      disc(r, fill);
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, r - 4, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.arc(-r * 0.35, -r * 0.35, r * 0.28, 0, TAU);
      ctx.fill();
      ctx.font = `bold ${Math.round(r * 1.05)}px ${kit.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillText(glyph, 1, 2);
    } else if (kind === "candle") {
      const bw = r * 0.95;
      const bh = r * 1.6;
      ctx.fillStyle = p.ink;
      ctx.fillRect(-1.5, -r - 3, 3, r * 2 + 6); // wick
      kit.block(-bw / 2, -bh / 2, bw, bh, fill, 2);
    } else if (kind === "gem") {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.moveTo(0, -r - 3); ctx.lineTo(r + 3, -r * 0.2); ctx.lineTo(0, r + 3); ctx.lineTo(-r - 3, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(r, -r * 0.2); ctx.lineTo(0, r); ctx.lineTo(-r, -r * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.beginPath();
      ctx.moveTo(0, -r); ctx.lineTo(-r, -r * 0.2); ctx.lineTo(0, -r * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.moveTo(0, r); ctx.lineTo(r, -r * 0.2); ctx.lineTo(0, -r * 0.1);
      ctx.closePath();
      ctx.fill();
    } else if (kind === "slow") {
      disc(r, fill);
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(0, 0, r - 4, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0); ctx.lineTo(0, -r * 0.55);
      ctx.moveTo(0, 0); ctx.lineTo(r * 0.4, 0);
      ctx.stroke();
    } else {
      // Rug bomb: dark ball with a woven rug band and a glowing rim.
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(0, 0, r + 3.5, 0, TAU);
      ctx.fill();
      disc(r, p.ink);
      ctx.save();
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.clip();
      ctx.fillStyle = p.wall;
      ctx.fillRect(-r, -4, r * 2, 8);
      ctx.fillStyle = p.accent;
      for (let i = -r; i < r; i += 6) ctx.fillRect(i, -1, 3, 2);
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(-r * 0.4, -r * 0.4, r * 0.22, 0, TAU);
      ctx.fill();
    }
  }

  function fuse(x: number, y: number, r: number) {
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + r * 0.3, y - r * 0.85);
    ctx.quadraticCurveTo(x + r * 0.9, y - r * 1.5, x + r * 0.5, y - r * 1.7);
    ctx.stroke();
    const sx = x + r * 0.5;
    const sy = y - r * 1.7;
    const fl = 2.5 + Math.random() * 2.5;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(sx, sy, fl + 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(sx, sy, fl * 0.5, 0, TAU);
    ctx.fill();
    if (Math.random() < 0.6) sparks.push({ x: sx, y: sy, vx: (Math.random() - 0.5) * 80, vy: -20 - Math.random() * 60, life: 250 });
  }

  function addSplat(x: number, y: number, color: string, r: number) {
    const blobs = Array.from({ length: 7 }, () => {
      const a = Math.random() * TAU;
      const d = Math.random() * r * 1.4;
      return { dx: Math.cos(a) * d, dy: Math.sin(a) * d, s: 2 + Math.random() * r * 0.45 };
    });
    splats.push({ x, y, color, life: 1800, blobs });
    if (splats.length > 24) splats.shift();
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        const x = e.x ?? W / 2;
        const y = e.y ?? H / 2;
        if (e.t === "slice") {
          const kind = e.kind as ObjKind;
          const color = e.color as number;
          const r = e.r as number;
          const dx = e.dx as number;
          const dy = e.dy as number;
          const len = Math.hypot(dx, dy) || 1;
          const nx = -dy / len;
          const ny = dx / len;
          const cut = Math.atan2(dy, dx);
          const vx = (e.vx as number) * 60;
          const vy = (e.vy as number) * 60;
          for (const side of [1, -1] as const) {
            halves.push({ kind, color, r, x, y, vx: vx + nx * 70 * side + (dx / len) * 40, vy: vy + ny * 70 * side - 40, rot: 0, vr: side * (2 + Math.random() * 3), side, cut, life: 1300 });
          }
          const c = colorOf(kind, color);
          addSplat(x, y, kind === "slow" ? p.text : c, r);
          kit.fx.burst(x, y, c, 14, 170);
          kit.fx.burst(x, y, "#ffffff", 4, 120);
          kit.fx.popup(x, y - r - 6, `+${e.pts as number}`, p.text);
        } else if (e.t === "combo") {
          kit.fx.popup(x, y - 34, `COMBO x${e.n as number} +${e.bonus as number}`, p.primary);
          for (let i = 0; i < 3; i++) kit.fx.burst(x, y, bricks[i % bricks.length], 10, 220);
          mood = { sprite: kit.sprites.happy, life: 900 };
        } else if (e.t === "slowmo") {
          kit.fx.popup(x, y - 30, "SLOW-MO", p.secondary);
          kit.fx.flash("255,255,255");
        } else if (e.t === "miss") {
          const lost = LIVES - (e.lives as number) - 1;
          if (lost >= 0 && lost < LIVES) xPop[lost] = 500;
          kit.fx.burst(x, H - 4, p.accent, 10, 140);
          kit.fx.addShake(3);
          mood = { sprite: kit.sprites.sad, life: 1200 };
        } else if (e.t === "bomb") {
          kit.fx.addShake(14);
          kit.fx.flash();
          kit.fx.burst(x, y, p.accent, 40, 300);
          kit.fx.burst(x, y, p.text, 20, 220);
          kit.fx.burst(x, y, p.wall, 20, 180);
          mood = { sprite: kit.sprites.sad, life: 4000 };
        } else if (e.t === "wave") {
          waveBanner = { n: e.n as number, life: 1200 };
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const dt = dtMs / 1000;
      kit.background(dtMs);

      // Slow-mo tint
      if (v.slow > 0) {
        ctx.fillStyle = p.secondary;
        ctx.globalAlpha = 0.12 + 0.04 * Math.sin(t / 120);
        ctx.fillRect(0, 0, W, H);
        ctx.globalAlpha = 1;
      }

      // Splats (behind everything)
      splats = splats.filter((s) => (s.life -= dtMs) > 0);
      for (const s of splats) {
        ctx.globalAlpha = Math.min(0.55, s.life / 1800);
        ctx.fillStyle = s.color;
        for (const b of s.blobs) {
          ctx.beginPath();
          ctx.arc(s.x + b.dx, s.y + b.dy, b.s, 0, TAU);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;

      // Halves
      halves = halves.filter((h) => (h.life -= dtMs) > 0);
      for (const h of halves) {
        h.vy += 600 * dt;
        h.x += h.vx * dt;
        h.y += h.vy * dt;
        h.rot += h.vr * dt;
        ctx.save();
        ctx.globalAlpha = Math.min(1, h.life / 400);
        ctx.translate(h.x, h.y);
        ctx.rotate(h.cut + h.rot);
        ctx.beginPath();
        ctx.rect(-h.r - 6, h.side > 0 ? 0 : -h.r - 6, h.r * 2 + 12, h.r + 6);
        ctx.clip();
        ctx.rotate(-h.cut);
        shape(h.kind, h.color, h.r, 1);
        ctx.restore();
      }

      // Objects
      for (const o of v.objects) {
        const age = v.frame + o.id * 13;
        ctx.save();
        ctx.translate(o.x, o.y);
        if (o.kind === "coin") {
          const flip = Math.cos(age * 0.03 * (o.spin || 1));
          shape(o.kind, o.color, o.r, Math.max(0.25, Math.abs(flip)));
        } else {
          ctx.rotate(age * 0.02 * o.spin);
          if (o.kind === "slow") {
            ctx.globalAlpha = 0.35;
            ctx.fillStyle = p.secondary;
            ctx.beginPath();
            ctx.arc(0, 0, o.r + 6 + 2 * Math.sin(t / 90), 0, TAU);
            ctx.fill();
            ctx.globalAlpha = 1;
          }
          shape(o.kind, o.color, o.r, 1);
        }
        ctx.restore();
        if (o.kind === "bomb") fuse(o.x, o.y, o.r);
      }

      // Fuse sparks
      sparks = sparks.filter((s) => (s.life -= dtMs) > 0);
      ctx.fillStyle = p.accent;
      for (const s of sparks) {
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        ctx.globalAlpha = s.life / 250;
        ctx.fillRect(s.x, s.y, 2, 2);
      }
      ctx.globalAlpha = 1;
      if (sparks.length > 200) sparks.splice(0, sparks.length - 200);

      // Blade trail, fed from the engine's blade cursor
      for (const q of trail) q.age += dtMs;
      if (v.blade.on && v.frame !== lastBladeFrame) {
        const last = trail[trail.length - 1];
        if (!last || last.age > TRAIL_MS / 2) trail.push({ x: v.blade.px, y: v.blade.py, age: 0 });
        trail.push({ x: v.blade.x, y: v.blade.y, age: 0 });
        lastBladeFrame = v.frame;
      }
      trail = trail.filter((q) => q.age < TRAIL_MS);
      if (trail.length > 1) {
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        for (let i = 1; i < trail.length; i++) {
          const a = trail[i - 1];
          const b = trail[i];
          if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) > 200) continue; // pointer jump
          const k = 1 - b.age / TRAIL_MS;
          ctx.globalAlpha = k * 0.6;
          ctx.strokeStyle = p.primary;
          ctx.lineWidth = 2 + 7 * k;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
          ctx.globalAlpha = k;
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 1 + 3 * k;
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }

      // Blade tip: tiny mascot
      if (!v.over) {
        const s = 16;
        ctx.globalAlpha = v.blade.on ? 1 : 0.55;
        ctx.drawImage(kit.sprites.mini, v.blade.x - s / 2, v.blade.y - s / 2, s, s);
        ctx.globalAlpha = 1;
      }

      // Lives as X marks
      for (let i = 0; i < LIVES; i++) {
        const lost = i < LIVES - v.lives;
        xPop[i] = Math.max(0, xPop[i] - dtMs);
        const sz = 9 + (xPop[i] / 500) * 6;
        const cx = W - 20 - (LIVES - 1 - i) * 26;
        const cy = 20;
        ctx.lineCap = "round";
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 7;
        ctx.beginPath();
        ctx.moveTo(cx - sz / 2, cy - sz / 2); ctx.lineTo(cx + sz / 2, cy + sz / 2);
        ctx.moveTo(cx + sz / 2, cy - sz / 2); ctx.lineTo(cx - sz / 2, cy + sz / 2);
        ctx.stroke();
        ctx.strokeStyle = lost ? p.accent : "rgba(255,255,255,0.25)";
        ctx.lineWidth = 4;
        ctx.stroke();
      }

      // Mascot reaction, bottom left
      if (mood) {
        mood.life -= dtMs;
        if (mood.life <= 0) mood = null;
      }
      ctx.globalAlpha = 0.9;
      ctx.drawImage(mood ? mood.sprite : kit.sprites.idle, 8, H - 40, 32, 32);
      ctx.globalAlpha = 1;

      if (waveBanner.life > 0) {
        waveBanner.life -= dtMs;
        ctx.globalAlpha = Math.min(1, waveBanner.life / 300);
        kit.text(`WAVE ${waveBanner.n}`, W / 2, H / 2 - 40, 22, p.text);
        ctx.globalAlpha = 1;
      }
      if (v.wave === 0) kit.text("HOLD AND DRAG TO SLASH. AVOID RUG BOMBS!", W / 2, H - 22, 12, p.text);
      if (v.slow > 0) kit.text("SLOW-MO", W / 2, 20, 12, p.secondary);

      kit.fx.draw(kit, dtMs);
    },
  };
}
