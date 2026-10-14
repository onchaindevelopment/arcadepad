// Light Trails renderer: dark arena, neon glow trails in the coin's palette,
// mascot head for the player, glowing chevron heads for CPU riders.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CELL, COLS, DX, DY, H, METER_MAX, OX, OY, ROWS, W, type TrailsView } from "./index.ts";

const AW = COLS * CELL;
const AH = ROWS * CELL;

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<TrailsView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const { ctx } = kit;
  const br = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const colors = [p.primary, p.secondary, p.accent, br[3 % br.length], br[4 % br.length], br[5 % br.length]];

  // Trails are painted incrementally (one segment per rider per step) onto an offscreen canvas.
  const trail = document.createElement("canvas");
  trail.width = W * RENDER_SCALE;
  trail.height = H * RENDER_SCALE;
  const tctx = trail.getContext("2d")!;
  tctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
  tctx.lineCap = "square";

  let heads: { x: number; y: number }[] = [];
  let trackedRound = -1;
  let t = 0;
  let goFlash = 0;
  let wonAt = 0;

  const cx = (c: number) => OX + c * CELL + CELL / 2;
  const cy = (r: number) => OY + r * CELL + CELL / 2;

  function segment(x0: number, y0: number, x1: number, y1: number, color: string) {
    tctx.save();
    tctx.shadowColor = color;
    tctx.shadowBlur = 7;
    tctx.strokeStyle = color;
    tctx.lineWidth = 3.2;
    tctx.beginPath();
    tctx.moveTo(cx(x0), cy(y0));
    tctx.lineTo(cx(x1), cy(y1));
    tctx.stroke();
    tctx.shadowBlur = 0;
    tctx.strokeStyle = "rgba(255,255,255,0.75)";
    tctx.lineWidth = 1.1;
    tctx.beginPath();
    tctx.moveTo(cx(x0), cy(y0));
    tctx.lineTo(cx(x1), cy(y1));
    tctx.stroke();
    tctx.restore();
  }

  function resetTrails(v: TrailsView) {
    tctx.clearRect(0, 0, W, H);
    heads = v.riders.map((r) => ({ x: r.x, y: r.y }));
    for (const r of v.riders) segment(r.x, r.y, r.x, r.y, colors[r.color % colors.length]);
    trackedRound = v.round;
  }

  /** Repaint every trail from the grid (used when steps were skipped, e.g. fast-forwarded thumbnails). */
  function rebuild(v: TrailsView) {
    tctx.clearRect(0, 0, W, H);
    const g = v.grid;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = g[y * COLS + x];
        if (!c) continue;
        const col = colors[(c - 1) % colors.length];
        let linked = false;
        if (x + 1 < COLS && g[y * COLS + x + 1] === c) { segment(x, y, x + 1, y, col); linked = true; }
        if (y + 1 < ROWS && g[(y + 1) * COLS + x] === c) { segment(x, y, x, y + 1, col); linked = true; }
        if (!linked) segment(x, y, x, y, col);
      }
    }
    heads = v.riders.map((r) => ({ x: r.x, y: r.y }));
    trackedRound = v.round;
  }

  function track(v: TrailsView) {
    if (v.round !== trackedRound || heads.length !== v.riders.length) {
      rebuild(v);
      return;
    }
    let skipped = false;
    v.riders.forEach((r, i) => {
      const h = heads[i];
      if (h.x === r.x && h.y === r.y) return;
      const col = colors[r.color % colors.length];
      if (Math.abs(h.x - r.x) + Math.abs(h.y - r.y) === 1) segment(h.x, h.y, r.x, r.y, col);
      else skipped = true;
      heads[i] = { x: r.x, y: r.y };
    });
    if (skipped) rebuild(v);
  }

  return {
    onEvents(events: readonly GameEvent[], v: TrailsView) {
      for (const e of events) {
        if (e.t === "round") resetTrails(v);
      }
      track(v);
      for (const e of events) {
        const col = colors[((e.color as number) ?? 0) % colors.length];
        if (e.t === "crash") {
          kit.fx.burst(e.x!, e.y!, col, 18, 150, 0);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 6, 90, 0);
          kit.fx.popup(e.x!, e.y! - 10, "OUT!", col);
          kit.fx.addShake(4);
        } else if (e.t === "die") {
          kit.fx.burst(e.x!, e.y!, p.primary, 30, 210, 0);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 10, 120, 0);
          kit.fx.addShake(10);
          kit.fx.flash();
        } else if (e.t === "roundwon") {
          wonAt = t;
          kit.fx.popup(e.x!, e.y! - 16, "+500", p.primary);
          for (let i = 0; i < 6; i++) kit.fx.burst(OX + Math.random() * AW, OY + AH * (0.3 + Math.random() * 0.4), colors[i % colors.length], 12, 200, 0);
          kit.fx.flash("255,255,255");
        } else if (e.t === "go") {
          goFlash = 700;
        } else if (e.t === "boost") {
          const me = v.riders[0];
          kit.fx.burst(cx(me.x), cy(me.y), p.accent, 8, 80, 0);
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      track(v);
      kit.background(dtMs);

      // Arena floor + grid
      ctx.fillStyle = p.ink;
      ctx.globalAlpha = 0.72;
      ctx.fillRect(OX, OY, AW, AH);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.wall;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 0.5;
      ctx.beginPath();
      for (let c = 4; c < COLS; c += 4) {
        ctx.moveTo(OX + c * CELL, OY);
        ctx.lineTo(OX + c * CELL, OY + AH);
      }
      for (let r = 4; r < ROWS; r += 4) {
        ctx.moveTo(OX, OY + r * CELL);
        ctx.lineTo(OX + AW, OY + r * CELL);
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Neon border
      ctx.save();
      ctx.shadowColor = p.secondary;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = p.secondary;
      ctx.lineWidth = 2;
      ctx.strokeRect(OX - 1, OY - 1, AW + 2, AH + 2);
      ctx.restore();

      // Trails (offscreen)
      ctx.drawImage(trail, 0, 0, W, H);

      // Live stubs + heads, interpolated toward the next cell
      const live = v.phase === "run";
      for (let i = v.riders.length - 1; i >= 0; i--) {
        const r = v.riders[i];
        const col = colors[r.color % colors.length];
        const k = live && r.alive ? Math.min(1, r.t) : 0;
        const hx = cx(r.x) + DX[r.dir] * CELL * k;
        const hy = cy(r.y) + DY[r.dir] * CELL * k;
        if (r.alive && k > 0) {
          ctx.save();
          ctx.shadowColor = col;
          ctx.shadowBlur = 7;
          ctx.strokeStyle = col;
          ctx.lineWidth = 3.2;
          ctx.beginPath();
          ctx.moveTo(cx(r.x), cy(r.y));
          ctx.lineTo(hx, hy);
          ctx.stroke();
          ctx.restore();
        }
        if (r.boost && Math.random() < 0.6) kit.fx.burst(hx - DX[r.dir] * 4, hy - DY[r.dir] * 4, col, 1, 40, 0);
        if (!r.cpu) {
          // Player: glowing ring + mascot head
          const pulse = 1 + Math.sin(t / 120) * 0.12;
          ctx.save();
          ctx.globalAlpha = r.alive ? 0.45 : 0.25;
          ctx.shadowColor = col;
          ctx.shadowBlur = 14;
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.arc(hx, hy, 9 * pulse + (r.boost ? 2 : 0), 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
          const s = 20;
          const spr = !r.alive ? kit.sprites.sad : v.phase === "between" ? kit.sprites.happy : kit.sprites.mini;
          ctx.drawImage(spr, Math.round(hx - s / 2), Math.round(hy - s / 2), s, s);
        } else if (r.alive) {
          // CPU: glowing chevron pointing along its heading
          ctx.save();
          ctx.translate(hx, hy);
          ctx.rotate((r.dir * Math.PI) / 2);
          ctx.shadowColor = col;
          ctx.shadowBlur = 10;
          ctx.fillStyle = p.ink;
          ctx.beginPath();
          ctx.moveTo(0, -7);
          ctx.lineTo(6, 5);
          ctx.lineTo(0, 2);
          ctx.lineTo(-6, 5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = col;
          ctx.beginPath();
          ctx.moveTo(0, -5.5);
          ctx.lineTo(4.5, 3.5);
          ctx.lineTo(0, 1);
          ctx.lineTo(-4.5, 3.5);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(-1, -3, 2, 3);
          ctx.restore();
        } else {
          // Wreck marker
          ctx.strokeStyle = col;
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(hx - 4, hy - 4);
          ctx.lineTo(hx + 4, hy + 4);
          ctx.moveTo(hx + 4, hy - 4);
          ctx.lineTo(hx - 4, hy + 4);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      kit.fx.draw(kit, dtMs);
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

      // Top band: round + rider roster
      kit.text(`ROUND ${v.round + 1}`, OX + 2, 18, 13, p.text, "left");
      const n = v.riders.length;
      for (let i = 0; i < n; i++) {
        const r = v.riders[i];
        const x = W - OX - (n - i) * 18 + 4;
        if (!r.cpu) {
          ctx.globalAlpha = r.alive ? 1 : 0.4;
          ctx.drawImage(kit.sprites.mini, x - 1, 9, 16, 16);
          ctx.globalAlpha = 1;
        } else {
          ctx.globalAlpha = r.alive ? 1 : 0.3;
          kit.block(x, 10, 14, 14, colors[r.color % colors.length], 3);
          ctx.globalAlpha = 1;
          if (!r.alive) kit.text("x", x + 7, 17, 11, p.text);
        }
      }

      // Boost meter
      const mw = AW - 52;
      const my = OY + AH + 4;
      kit.text("BOOST", OX + 1, my + 4, 8, p.text, "left");
      ctx.fillStyle = p.ink;
      ctx.fillRect(OX + 48, my, mw + 2, 8);
      const f = v.meter / METER_MAX;
      ctx.save();
      const boosting = v.riders[0]?.boost;
      ctx.shadowColor = p.accent;
      ctx.shadowBlur = boosting ? 10 : 4;
      ctx.fillStyle = f < 0.15 && Math.floor(t / 150) % 2 ? p.secondary : p.accent;
      ctx.fillRect(OX + 49, my + 1, mw * f, 6);
      ctx.restore();

      // Overlays
      const mx = W / 2;
      const midY = OY + AH * 0.42;
      if (v.phase === "count") {
        const num = Math.max(1, Math.ceil(v.phaseT / 40));
        const k = (v.phaseT % 40) / 40;
        kit.text(`ROUND ${v.round + 1}`, mx, midY - 44, 18, p.text);
        kit.text(`${v.riders.length - 1} RIVALS`, mx, midY - 24, 10, p.accent);
        kit.text(String(num), mx, midY + 12, 34 + k * 14, p.primary);
        if (v.round === 0) {
          kit.text("ARROWS / SWIPE: TURN", mx, midY + 58, 10, p.text);
          kit.text("HOLD SPACE OR TAP: BOOST", mx, midY + 74, 10, p.text);
        }
      } else if (goFlash > 0) {
        goFlash -= dtMs;
        ctx.globalAlpha = Math.min(1, goFlash / 300);
        kit.text("GO!", mx, midY + 12, 36, p.primary);
        ctx.globalAlpha = 1;
      }
      if (v.phase === "between") {
        const a = Math.min(1, (t - wonAt) / 200);
        ctx.fillStyle = p.ink;
        ctx.globalAlpha = a * 0.55;
        ctx.fillRect(OX, midY - 70, AW, 130);
        ctx.globalAlpha = a;
        const s = 64 + Math.sin(t / 140) * 4;
        ctx.drawImage(kit.sprites.happy, mx - s / 2, midY - 66, s, s);
        kit.text("LAST ONE RIDING!", mx, midY + 14, 16, p.primary);
        kit.text(`+500  ·  NEXT: ROUND ${v.round + 2}`, mx, midY + 36, 10, p.text);
        ctx.globalAlpha = 1;
      } else if (v.phase === "over") {
        kit.text("CRASHED!", mx, midY, 22, p.secondary);
        kit.text(`${v.roundsWon} ROUND${v.roundsWon === 1 ? "" : "S"} WON`, mx, midY + 24, 11, p.text);
      }
    },
  };
}
