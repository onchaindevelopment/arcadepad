// Moon Jumper renderer: a sky that fades into starry space with height,
// chunky capsule platforms in the coin's palette, the mascot squashing on
// every bounce and stretching on the way up.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { H, PLAT_H, W, BEAR_H, type JumperView, type Plat } from "./index.ts";

function rgb(hex: string): [number, number, number] {
  let h = hex.trim().replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  if (!Number.isFinite(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a);
  const y = rgb(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * k)},${Math.round(x[1] + (y[1] - x[1]) * k)},${Math.round(x[2] + (y[2] - x[2]) * k)})`;
}

const SPACE_AT = 9000; // height where the sky is fully space

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<JumperView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const col = (i: number) => p.bricks[i % p.bricks.length] ?? p.primary;
  const moveCol = col(3);
  const rocketCol = col(4);
  const stars = Array.from({ length: 70 }, (_, i) => ({
    x: Math.random() * W,
    y: Math.random() * (H + 20),
    s: i % 7 === 0 ? 2 : 1,
    depth: 0.05 + Math.random() * 0.25,
    tw: Math.random() * 6.28,
  }));
  let t = 0;
  let happy = 0;
  let face = 1;
  let cam = 0;
  const sy = (h: number) => H - (h - cam);

  function sky(v: JumperView) {
    const space = Math.min(1, v.cam / SPACE_AT);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, mix(p.bg2, p.ink, space * 0.85));
    g.addColorStop(1, mix(mix(p.bg2, p.secondary, 0.35), p.bg, space));
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = g;
    ctx.fillRect(-12, -12, W + 24, H + 24);
    // Parallax stars, more of them the higher you go.
    for (const s of stars) {
      const y = (((s.y + v.cam * s.depth) % (H + 20)) + H + 20) % (H + 20) - 10;
      ctx.globalAlpha = (0.12 + 0.8 * space) * (0.55 + 0.45 * Math.sin(t / 400 + s.tw));
      ctx.fillStyle = s.s > 1 ? p.accent : p.text;
      ctx.fillRect(Math.round(s.x), Math.round(y), s.s, s.s);
    }
    ctx.globalAlpha = 1;
  }

  function markers(v: JumperView) {
    const first = Math.ceil((v.cam - 20) / 1000) * 1000;
    for (let m = Math.max(1000, first); m < v.cam + H + 20; m += 1000) {
      const y = sy(m);
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = p.text;
      for (let x = 0; x < W; x += 12) ctx.fillRect(x, Math.round(y), 6, 1);
      ctx.globalAlpha = 1;
      kit.text(`${m / 10} m`, W - 6, y - 8, 10, p.text, "right");
    }
  }

  function platform(pl: Plat) {
    const y = Math.round(sy(pl.top));
    if (y < -20 || y > H + 20) return;
    if (pl.broken) {
      // Two halves drop and spread.
      const k = pl.broken;
      ctx.globalAlpha = Math.max(0, 1 - k / 40);
      const half = pl.w / 2;
      ctx.save();
      ctx.translate(pl.x + half / 2 - k * 0.6, y + k * k * 0.04);
      ctx.rotate(-k * 0.03);
      kit.block(-half / 2, 0, half, PLAT_H, p.accent, 5);
      ctx.restore();
      ctx.save();
      ctx.translate(pl.x + half * 1.5 + k * 0.6, y + k * k * 0.05);
      ctx.rotate(k * 0.035);
      kit.block(-half / 2, 0, half, PLAT_H, p.accent, 5);
      ctx.restore();
      ctx.globalAlpha = 1;
      return;
    }
    switch (pl.kind) {
      case "base":
        kit.block(-6, y, W + 12, 22, p.wall, 4);
        break;
      case "normal":
        kit.block(pl.x, y, pl.w, PLAT_H, p.primary, 6);
        break;
      case "moving": {
        kit.block(pl.x, y, pl.w, PLAT_H, moveCol, 6);
        // Chevrons point the way it is heading.
        ctx.fillStyle = p.ink;
        const dir = pl.vx >= 0 ? 1 : -1;
        const cx = pl.x + pl.w / 2;
        for (const o of [-8, 0, 8]) {
          ctx.beginPath();
          ctx.moveTo(cx + o + 3 * dir, y + PLAT_H / 2);
          ctx.lineTo(cx + o - 2 * dir, y + 3);
          ctx.lineTo(cx + o - 2 * dir, y + PLAT_H - 3);
          ctx.fill();
        }
        break;
      }
      case "crumble": {
        // Dashed, cracked capsule: clearly fragile.
        ctx.globalAlpha = 0.9;
        kit.block(pl.x, y, pl.w, PLAT_H, mix(p.accent, p.ink, 0.15), 6);
        ctx.globalAlpha = 1;
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 1; i < 3; i++) {
          const cx = pl.x + (pl.w * i) / 3;
          ctx.moveTo(cx - 2, y + 1);
          ctx.lineTo(cx + 2, y + PLAT_H / 2);
          ctx.lineTo(cx - 1, y + PLAT_H - 1);
        }
        ctx.stroke();
        break;
      }
      case "spring": {
        kit.block(pl.x, y, pl.w, PLAT_H, p.secondary, 6);
        // Coil on top, squashed right after a launch, then wobbling back.
        const a = pl.hitAge;
        const ch = a < 6 ? 4 : a < 30 ? 10 + Math.sin(a * 0.9) * 4 * (1 - a / 30) : 10;
        const cx = pl.x + pl.w / 2;
        ctx.strokeStyle = p.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i <= 4; i++) {
          const yy = y - (ch * i) / 4;
          ctx.lineTo(cx + (i % 2 ? 6 : -6), yy);
        }
        ctx.stroke();
        kit.block(cx - 10, y - ch - 5, 20, 6, p.accent, 2);
        break;
      }
    }
  }

  function rocket(x: number, h: number) {
    const y = sy(h) - 26 + Math.sin(t / 220) * 2;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(x, y - 4);
    ctx.lineTo(x + 7, y + 6);
    ctx.lineTo(x - 7, y + 6);
    ctx.fill();
    kit.block(x - 6, y + 4, 12, 16, rocketCol, 3);
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(x, y - 2);
    ctx.lineTo(x + 5, y + 5);
    ctx.lineTo(x - 5, y + 5);
    ctx.fill();
    kit.block(x - 10, y + 13, 5, 8, p.accent, 1);
    kit.block(x + 5, y + 13, 5, 8, p.accent, 1);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 2, y + 8, 4, 4);
  }

  function bear(x: number, h: number, dead: number) {
    const cy = sy(h) - BEAR_H / 2 + (dead ? dead * dead * 0.05 : Math.sin(t / 260 + x) * 2);
    ctx.save();
    ctx.translate(x, cy);
    if (dead) {
      ctx.rotate(dead * 0.12);
      ctx.globalAlpha = Math.max(0, 1 - dead / 50);
    }
    const body = mix(p.wall, p.text, 0.15);
    const disc = (dx: number, dy: number, r: number, c: string) => {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(dx, dy, r + 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(dx, dy, r, 0, Math.PI * 2);
      ctx.fill();
    };
    disc(-10, -10, 5, body);
    disc(10, -10, 5, body);
    disc(0, 0, 14, body);
    disc(0, 5, 6, mix(body, p.text, 0.5));
    ctx.fillStyle = p.ink;
    ctx.fillRect(-2, 2, 4, 3);
    // Angry brows and eyes.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(-8, -5, 5, 5);
    ctx.fillRect(3, -5, 5, 5);
    ctx.fillStyle = p.ink;
    ctx.fillRect(-6, -3, 2, 2);
    ctx.fillRect(4, -3, 2, 2);
    ctx.fillRect(-9, -8, 6, 2);
    ctx.fillRect(3, -8, 6, 2);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function mascot(v: JumperView, dtMs: number) {
    if (Math.abs(v.vx) > 0.4) face = v.vx > 0 ? 1 : -1;
    const sprite = v.dead || v.hit ? kit.sprites.sad : v.jet > 0 || happy > 0 ? kit.sprites.happy : kit.sprites.idle;
    let sx = 1;
    let sy2 = 1;
    if (v.sinceBounce < 10) {
      const q = 1 - v.sinceBounce / 10;
      sx = 1 + 0.32 * q;
      sy2 = 1 - 0.3 * q;
    } else if (v.vy > 0) {
      const s = Math.min(0.16, v.vy / 70);
      sx = 1 - s;
      sy2 = 1 + s;
    } else if (v.vy < -7) {
      sx = 0.95;
      sy2 = 1.05;
    }
    const size = 34;
    const feet = sy(v.h) + 2;
    const draw = (x: number) => {
      ctx.save();
      ctx.translate(x, feet);
      if (v.hit) ctx.rotate(t / 120);
      ctx.scale(face * sx, sy2);
      ctx.drawImage(sprite, -size / 2, -size, size, size);
      ctx.restore();
    };
    draw(v.x);
    if (v.x < size / 2) draw(v.x + W);
    else if (v.x > W - size / 2) draw(v.x - W);
    if (v.jet > 0) {
      // Rocket pack: a small booster and a flame trail.
      kit.block(v.x - face * 14 - 4, feet - 22, 8, 14, rocketCol, 2);
      if (Math.random() < dtMs / 12) kit.fx.burst(v.x - face * 14, feet - 6, Math.random() < 0.5 ? p.accent : rocketCol, 2, 50, 500);
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: JumperView) {
      cam = v.cam;
      for (const e of events) {
        const x = (e.x as number) ?? v.x;
        const y = e.h !== undefined ? sy(e.h as number) : H / 2;
        switch (e.t) {
          case "bounce":
            kit.fx.burst(x, y, p.text, 5, 50, 200);
            break;
          case "spring":
            kit.fx.burst(x, y, p.secondary, 14, 160);
            kit.fx.addShake(2);
            break;
          case "crumble":
            kit.fx.burst(x, y + 4, p.accent, 14, 90, 500);
            break;
          case "rocket":
            happy = 1200;
            kit.fx.burst(x, y - 10, rocketCol, 20, 180);
            kit.fx.popup(x, y - 34, "ROCKET!", rocketCol);
            kit.fx.flash(rgb(rocketCol).join(","));
            break;
          case "milestone":
            happy = 900;
            kit.fx.popup(W / 2, H * 0.3, `${(e.height as number) / 10} m!`, p.primary);
            for (let i = 0; i < 4; i++) kit.fx.burst(40 + i * 93, H * 0.32, col(i), 10, 170);
            break;
          case "stomp":
          case "bearBonk":
            happy = 700;
            kit.fx.burst(x, y, p.wall, 18, 170);
            kit.fx.popup(x, y - 20, "+50", p.primary);
            kit.fx.addShake(4);
            break;
          case "hit":
            kit.fx.burst(x, y, p.accent, 16, 160);
            kit.fx.addShake(8);
            kit.fx.flash();
            break;
          case "fall":
            kit.fx.addShake(10);
            kit.fx.flash();
            break;
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      happy = Math.max(0, happy - dtMs);
      cam = v.cam;
      kit.background(dtMs);
      sky(v);
      markers(v);
      for (const pl of v.platforms) platform(pl);
      for (const r of v.rockets) if (!r.taken) rocket(r.x, r.h);
      for (const b of v.bears) bear(b.x, b.h, b.dead);
      mascot(v, dtMs);
      if (v.frame < 200) kit.text("STEER WITH POINTER OR ARROWS", W / 2, H - 40, 11, p.text);
      kit.fx.draw(kit, dtMs);
    },
  };
}
