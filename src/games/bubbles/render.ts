// Bubble Pop renderer: glossy face bubbles in the coin's colours, a ceiling
// bar counting shots to the next drop, the mascot running the launcher, a
// dotted aim guide with one bank preview, pop bursts and falling orphans.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  AIM_UP, COLS, DEATH_Y, H, LX, LY, MAX_ROWS, R, ROW_H, W, aimDir, ceilY, cellX, getCell, rowCols, simulateShot,
  type BubblesView, type Cell,
} from "./index.ts";

interface Faller { x: number; y: number; vx: number; vy: number; col: number; spin: number; life: number }
interface Ring { x: number; y: number; col: number; life: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BubblesView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const colour = (i: number) => p.bricks[((i % p.bricks.length) + p.bricks.length) % p.bricks.length];
  let t = 0;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;
  let shownCeil = 0;
  let fallers: Faller[] = [];
  let rings: Ring[] = [];
  let recoil = 0;
  let collapsed = false; // cluster has fallen after game over

  function bubble(x: number, y: number, col: number, r = R, face = true, seed = 0) {
    const c = colour(col);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r - 1.5, 0, Math.PI * 2);
    ctx.fill();
    // Lower shade
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.arc(x, y, r - 1.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.fill();
    // Coin rim
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, r - 4, 0, Math.PI * 2);
    ctx.stroke();
    // Shine
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(x - r * 0.38, y - r * 0.42, r * 0.28, r * 0.16, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(x + r * 0.25, y - r * 0.55, 2, 2);
    if (!face || r < 8) return;
    // Tiny face (blinks now and then)
    const blink = ((t / 16 + seed * 37) | 0) % 260 < 6;
    ctx.fillStyle = p.ink;
    const ey = y - 1;
    if (blink) {
      ctx.fillRect(x - 6, ey, 4, 1.5);
      ctx.fillRect(x + 2, ey, 4, 1.5);
    } else {
      ctx.fillRect(x - 5, ey - 1.5, 2.5, 3);
      ctx.fillRect(x + 2.5, ey - 1.5, 2.5, 3);
    }
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.arc(x, y + 2.5, 3, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  function addCells(cells: Cell[], drop: boolean) {
    for (const c of cells) {
      if (drop) {
        fallers.push({ x: c.x, y: c.y, vx: (Math.random() - 0.5) * 80, vy: -60 - Math.random() * 80, col: c.col, spin: (Math.random() - 0.5) * 6, life: 0 });
      } else {
        rings.push({ x: c.x, y: c.y, col: c.col, life: 0 });
        kit.fx.burst(c.x, c.y, colour(c.col), 7, 130, 300);
      }
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        switch (e.t) {
          case "shot":
            recoil = 1;
            break;
          case "pop":
            addCells(e.cells as Cell[], false);
            kit.fx.popup(e.x!, e.y! - 12, `+${e.pts as number}`, p.text);
            break;
          case "bigpop":
            mood = "happy"; moodT = 1000;
            kit.fx.flash("255,255,255");
            break;
          case "drop":
            addCells(e.cells as Cell[], true);
            kit.fx.addShake((e.shake as number) ?? 3);
            kit.fx.popup(e.x!, e.y!, `DROP +${e.bonus as number}`, p.primary);
            if ((e.n as number) >= 4) { mood = "happy"; moodT = 1000; }
            break;
          case "ceiling":
            kit.fx.addShake(5);
            kit.fx.flash();
            for (let x = 20; x < W; x += 40) kit.fx.burst(x, e.y!, p.wall, 3, 80);
            break;
          case "levelclear":
            mood = "happy"; moodT = 1600;
            for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * W, H * 0.4 + Math.random() * 100, colour(i), 14, 220);
            kit.fx.popup(W / 2, H / 2 + 20, `CLEAR +${e.bonus as number}`, p.primary);
            break;
          case "lost":
            mood = "sad"; moodT = 1e9;
            collapsed = true;
            kit.fx.flash();
            kit.fx.addShake(8);
            for (let r = 0; r < MAX_ROWS; r++)
              for (let c = 0; c < rowCols(r); c++) {
                const col = getCell(v.grid, r, c);
                if (col >= 0) fallers.push({ x: cellX(r, c), y: ceilY(v.ceil) + R + r * ROW_H, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 120, col, spin: (Math.random() - 0.5) * 6, life: 0 });
              }
            break;
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      const dt = dtMs / 1000;
      kit.background(dtMs);
      if (moodT > 0) { moodT -= dtMs; if (moodT <= 0) mood = null; }
      // Smooth ceiling drops (cells are positioned from the ceiling, so they slide too).
      shownCeil += (v.ceil - shownCeil) * Math.min(1, dtMs / 120);
      if (Math.abs(v.ceil - shownCeil) < 0.01 || v.ceil < shownCeil) shownCeil = v.ceil;
      const top = ceilY(shownCeil);

      // Side rails
      ctx.fillStyle = p.wall;
      ctx.globalAlpha = 0.6;
      ctx.fillRect(0, 0, 2, H);
      ctx.fillRect(W - 2, 0, 2, H);
      ctx.globalAlpha = 1;

      // Danger line
      ctx.strokeStyle = p.accent;
      ctx.globalAlpha = 0.35 + 0.15 * Math.sin(t / 250);
      ctx.setLineDash([6, 6]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, DEATH_Y);
      ctx.lineTo(W, DEATH_Y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // Aim guide: dotted, up to one wall bounce.
      if (!v.over && !v.clearing) {
        const sim = simulateShot(v.grid, v.ceil, v.aim);
        const pts = sim.path.slice(0, Math.min(sim.path.length, sim.bounces >= 1 ? 3 : 2));
        const phase = (t / 40) % 14;
        ctx.fillStyle = colour(v.cur);
        let carry = phase;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i], b = pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          for (let d = carry; d < len; d += 14) {
            const k = d / len;
            const x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
            if (Math.hypot(x - LX, y - LY) < R + 6) continue;
            ctx.globalAlpha = i === 0 ? 0.85 : 0.5;
            ctx.beginPath();
            ctx.arc(x, y, 2.2, 0, Math.PI * 2);
            ctx.fill();
          }
          carry = 14 - ((len - carry) % 14);
        }
        ctx.globalAlpha = 1;
        // Landing ghost
        if (sim.bounces <= 1) {
          ctx.globalAlpha = 0.25;
          ctx.strokeStyle = colour(v.cur);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cellX(sim.r, sim.c), ceilY(v.ceil) + R + sim.r * ROW_H, R - 2, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Cluster
      for (let r = 0; r < MAX_ROWS; r++)
        for (let c = 0; c < rowCols(r); c++) {
          const col = getCell(v.grid, r, c);
          if (col < 0 || collapsed) continue;
          const wob = Math.sin(t / 400 + r * 0.7 + c * 0.9) * 0.6;
          bubble(cellX(r, c), top + R + r * ROW_H + wob, col, R, true, r * COLS + c);
        }

      // Ceiling bar with shots-until-drop pips
      kit.block(-4, -6, W + 8, top + 6, p.wall, 4);
      const n = v.shotsPerDrop;
      const gap = 18;
      const x0 = W / 2 - ((n - 1) * gap) / 2;
      const py = top - 13;
      for (let i = 0; i < n; i++) {
        const live = i < v.shotsLeft;
        const warn = v.shotsLeft <= 1 && live;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(x0 + i * gap, py, 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = live ? (warn && Math.sin(t / 90) > 0 ? p.accent : p.primary) : "rgba(255,255,255,0.12)";
        ctx.beginPath();
        ctx.arc(x0 + i * gap, py, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
      kit.text(`LV ${v.level + 1}`, 8, py, 10, p.text, "left");

      // Pop rings
      rings = rings.filter((q) => (q.life += dtMs) < 220);
      for (const q of rings) {
        const k = q.life / 220;
        ctx.globalAlpha = 1 - k;
        bubble(q.x, q.y, q.col, R * (1 + k * 0.6), false);
      }
      ctx.globalAlpha = 1;

      // Falling orphans
      fallers = fallers.filter((f) => f.y < H + R * 2);
      for (const f of fallers) {
        f.life += dtMs;
        f.vy += 900 * dt;
        f.x += f.vx * dt;
        f.y += f.vy * dt;
        if (f.x < R || f.x > W - R) f.vx = -f.vx;
        ctx.save();
        ctx.translate(f.x, f.y);
        ctx.rotate((f.life / 1000) * f.spin);
        bubble(0, 0, f.col, R, true, 3);
        ctx.restore();
      }

      // Flying bubble
      if (v.flight) bubble(v.flight.x, v.flight.y, v.flight.col, R, true, 1);

      // Launcher: base, barrel along the aim, loaded bubble
      const d = aimDir(v.aim);
      recoil = Math.max(0, recoil - dtMs / 150);
      const len = 34 - recoil * 6;
      ctx.save();
      ctx.translate(LX, LY);
      ctx.rotate(Math.atan2(d.dy, d.dx));
      ctx.fillStyle = p.ink;
      ctx.fillRect(0, -9, len + 2, 18);
      ctx.fillStyle = p.secondary;
      ctx.fillRect(1.5, -7.5, len - 1, 15);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(3, -6, len - 4, 3);
      ctx.restore();
      kit.block(LX - 34, LY + 10, 68, 26, p.wall, 6);
      if (!v.flight && !v.over) bubble(LX, LY, v.cur, R, true, 2);
      else {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(LX, LY, 8, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mascot operator, cranking beside the launcher
      const sprite = mood === "happy" ? kit.sprites.happy : mood === "sad" || v.over ? kit.sprites.sad : kit.sprites.idle;
      const bob = mood === "happy" ? Math.abs(Math.sin(t / 90)) * -5 : Math.sin(t / 300) * 1.5;
      const lean = (v.aim - AIM_UP) / 2000;
      ctx.save();
      ctx.translate(LX - 74, LY + 6 + bob);
      ctx.rotate(lean);
      ctx.drawImage(sprite, -24, -24, 48, 48);
      ctx.restore();
      // Lever from mascot to the launcher
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(LX - 54, LY + 10 + bob);
      ctx.lineTo(LX - 34, LY + 20);
      ctx.stroke();

      // Next bubble + swap hint
      kit.text("NEXT", LX + 74, LY - 14, 9, p.text);
      bubble(LX + 74, LY + 10, v.next, 11, true, 4);
      kit.text("SWAP: DOWN/X", LX + 74, LY + 36, 7, p.text);

      if (v.clearing) {
        kit.text("BOARD CLEAR!", W / 2, H / 2 - 20, 22, p.primary);
        kit.text(`LEVEL ${v.level + 1} NEXT`, W / 2, H / 2 + 6, 12, p.text);
      }
      if (v.frame < 150 && !v.over) kit.text("AIM + TAP TO SHOOT", W / 2, DEATH_Y + 18, 10, p.text);
      kit.fx.draw(kit, dtMs);
    },
  };
}
