// Turf Paint renderer: camera follows the mascot head over a painted grid,
// raised territory slabs, striped trails, minimap, leaderboard and timer.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CELL, COLS, DIRS, H, NCELLS, ROWS, W, type ActorView, type TurfView } from "./index.ts";

const MINI = 84; // minimap size in field px

function actorColors(p: ThemePack["palette"], n: number): string[] {
  const norm = (c: string) => c.trim().toLowerCase();
  const out = [p.primary];
  const pool = [p.secondary, p.accent, ...p.bricks, p.wall, p.text];
  for (const c of pool) if (!out.some((o) => norm(o) === norm(c))) out.push(c);
  while (out.length < n) out.push(pool[out.length % pool.length]);
  return out.slice(0, n);
}

function headPos(a: ActorView): [number, number] {
  const d = DIRS[a.dir];
  return [(a.c + 0.5 + d.dx * a.t) * CELL, (a.r + 0.5 + d.dy * a.t) * CELL];
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<TurfView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const colors = actorColors(p, 8);
  const mini = document.createElement("canvas");
  mini.width = COLS;
  mini.height = ROWS;
  const mctx = mini.getContext("2d")!;
  let miniAge = 999;
  let t = 0;
  let camX = 0, camY = 0;
  let deadAt: [number, number] | null = null;
  const pulses: { x: number; y: number; life: number; color: string; r: number }[] = [];

  function drawMini(v: TurfView) {
    mctx.clearRect(0, 0, COLS, ROWS);
    for (let k = 0; k < NCELLS; k++) {
      const o = v.owner[k];
      if (o < 0) continue;
      mctx.fillStyle = colors[o];
      mctx.fillRect(k % COLS, (k / COLS) | 0, 1, 1);
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: TurfView) {
      for (const e of events) {
        const x = e.x ?? 0, y = e.y ?? 0;
        if (e.t === "capture") {
          const who = e.who as number;
          const n = e.n as number;
          if (who === 0) {
            const big = n >= 60;
            kit.fx.burst(x, y, p.primary, big ? 30 : 14, big ? 220 : 140, 0);
            kit.fx.burst(x, y, "#ffffff", big ? 10 : 4, 90, 0);
            kit.fx.popup(x, y - 8, `+${((n * 100) / NCELLS).toFixed(1)}%`, big ? p.accent : p.text);
            pulses.push({ x, y, life: 1, color: p.primary, r: Math.sqrt(n) * CELL * 0.7 });
            if (big) kit.fx.addShake(4);
          } else kit.fx.burst(x, y, colors[who], 6, 80, 0);
          miniAge = 999;
        } else if (e.t === "kill") {
          const victim = e.victim as number;
          kit.fx.burst(x, y, colors[victim], 22, 200, 200);
          kit.fx.burst(x, y, p.ink, 8, 120, 200);
          if (e.killer === 0) {
            kit.fx.popup(x, y - 10, "KO!", p.accent);
            kit.fx.addShake(5);
            pulses.push({ x, y, life: 1, color: p.accent, r: 40 });
          }
          miniAge = 999;
        } else if (e.t === "die") {
          deadAt = [x, y];
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(x, y, p.primary, 34, 240, 260);
          kit.fx.burst(x, y, p.secondary, 16, 160, 260);
        } else if (e.t === "spawn") {
          kit.fx.burst(x, y, colors[e.who as number], 10, 90, 0);
        } else if (e.t === "timeup") {
          const me = v.actors[0];
          const [hx, hy] = headPos(me);
          for (let i = 0; i < 6; i++) kit.fx.burst(hx + (Math.random() - 0.5) * 200, hy + (Math.random() - 0.5) * 300, p.bricks[i % p.bricks.length], 14, 200);
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      const me = v.actors[0];
      const [px, py] = me.alive || !deadAt ? headPos(me) : deadAt;
      camX = px - W / 2;
      camY = py - H / 2;
      kit.background(dtMs);
      ctx.save();
      ctx.translate(-Math.round(camX), -Math.round(camY));

      const c0 = Math.max(0, Math.floor(camX / CELL) - 1), c1 = Math.min(COLS - 1, Math.ceil((camX + W) / CELL) + 1);
      const r0 = Math.max(0, Math.floor(camY / CELL) - 1), r1 = Math.min(ROWS - 1, Math.ceil((camY + H) / CELL) + 1);

      // Floor: soft checker inside the world, wall around it.
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      for (let r = r0; r <= r1; r++) for (let c = c0 + ((c0 + r) & 1); c <= c1; c += 2) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
      ctx.strokeStyle = p.wall;
      ctx.lineWidth = 6;
      ctx.strokeRect(-3, -3, COLS * CELL + 6, ROWS * CELL + 6);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.strokeRect(-7, -7, COLS * CELL + 14, ROWS * CELL + 14);

      // Territory slabs
      const { owner, trail } = v;
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const o = owner[r * COLS + c];
          if (o < 0) continue;
          ctx.fillStyle = colors[o];
          ctx.fillRect(c * CELL, r * CELL, CELL, CELL);
        }
      }
      // Edges: light on top, shadow below, ink outline between owners.
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const k = r * COLS + c;
          const o = owner[k];
          if (o < 0) continue;
          const up = r > 0 ? owner[k - COLS] : -2;
          const down = r < ROWS - 1 ? owner[k + COLS] : -2;
          const left = c > 0 ? owner[k - 1] : -2;
          const right = c < COLS - 1 ? owner[k + 1] : -2;
          if (up !== o) {
            ctx.fillStyle = "rgba(255,255,255,0.45)";
            ctx.fillRect(c * CELL, r * CELL, CELL, 2);
          }
          if (down !== o) {
            ctx.fillStyle = "rgba(0,0,0,0.35)";
            ctx.fillRect(c * CELL, r * CELL + CELL - 3, CELL, 3);
            ctx.fillStyle = p.ink;
            ctx.globalAlpha = 0.35;
            ctx.fillRect(c * CELL, r * CELL + CELL, CELL, 3);
            ctx.globalAlpha = 1;
          }
          if (left !== o) {
            ctx.fillStyle = "rgba(0,0,0,0.18)";
            ctx.fillRect(c * CELL, r * CELL, 1, CELL);
          }
          if (right !== o) {
            ctx.fillStyle = "rgba(0,0,0,0.25)";
            ctx.fillRect(c * CELL + CELL - 1, r * CELL, 1, CELL);
          }
        }
      }

      // Trails: inset tiles with a pulsing glow.
      const glow = 0.65 + 0.25 * Math.sin(t / 120);
      for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
          const o = trail[r * COLS + c];
          if (o < 0) continue;
          ctx.fillStyle = p.ink;
          ctx.globalAlpha = 0.6;
          ctx.fillRect(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2);
          ctx.globalAlpha = glow;
          ctx.fillStyle = colors[o];
          ctx.fillRect(c * CELL + 2, r * CELL + 2, CELL - 4, CELL - 4);
          ctx.globalAlpha = 1;
          if (((c + r + ((t / 90) | 0)) & 3) === 0) {
            ctx.fillStyle = "rgba(255,255,255,0.7)";
            ctx.fillRect(c * CELL + CELL / 2 - 1, r * CELL + CELL / 2 - 1, 2, 2);
          }
        }
      }

      // Capture pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const q = pulses[i];
        q.life -= dtMs / 500;
        if (q.life <= 0) {
          pulses.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = q.life;
        ctx.strokeStyle = q.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (1.4 - q.life * 0.6), 0, Math.PI * 2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Rival heads: round blobs with eyes looking where they go.
      for (const a of v.actors) {
        if (a.id === 0 || !a.alive) continue;
        const [x, y] = headPos(a);
        if (x < camX - 20 || x > camX + W + 20 || y < camY - 20 || y > camY + H + 20) continue;
        const d = DIRS[a.dir];
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(x, y + 1, 9, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colors[a.id];
        ctx.beginPath();
        ctx.arc(x, y, 7.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.4)";
        ctx.fillRect(x - 4, y - 5, 4, 2);
        for (const s of [-1, 1]) {
          const ex = x + d.dx * 3 + (d.dy !== 0 ? s * 3 : 0);
          const ey = y + d.dy * 3 + (d.dx !== 0 ? s * 3 : -1);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(ex - 2, ey - 2, 4, 4);
          ctx.fillStyle = p.ink;
          ctx.fillRect(ex - 1 + d.dx, ey - 1 + d.dy, 2, 2);
        }
        if (a.aggr) {
          ctx.fillStyle = p.ink;
          ctx.fillRect(x - 6, y - 7 + d.dy, 4, 1);
          ctx.fillRect(x + 2, y - 7 + d.dy, 4, 1);
        }
      }

      // Player: the coin mascot.
      if (me.alive) {
        const bob = Math.sin(t / 110) * 1.2;
        const s = 24;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.ellipse(px, py + 9, 9, 3, 0, 0, Math.PI * 2);
        ctx.fill();
        const sprite = me.trailLen > 0 ? kit.sprites.mini : kit.sprites.happy;
        ctx.drawImage(sprite, px - s / 2, py - s / 2 + bob - 2, s, s);
      } else if (deadAt) {
        ctx.drawImage(kit.sprites.sad, deadAt[0] - 14, deadAt[1] - 14, 28, 28);
      }

      kit.fx.draw(kit, dtMs);
      ctx.restore();

      // ---------- HUD (screen space) ----------
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

      // Timer
      const secs = Math.ceil(v.timeLeft / 60);
      const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      const urgent = secs <= 10;
      kit.text(clock, W / 2, 18, urgent ? 18 + Math.sin(t / 80) * 2 : 16, urgent ? p.accent : p.text);

      // Leaderboard (top 3 + you)
      const ranked = v.actors.filter((a) => a.alive || a.id === 0).slice().sort((a, b) => b.cells - a.cells || a.id - b.id);
      const rows = ranked.slice(0, 3);
      if (!rows.includes(me)) rows.push(me);
      ctx.fillStyle = p.ink;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.roundRect(6, 6, 92, 10 + rows.length * 14, 5);
      ctx.fill();
      ctx.globalAlpha = 1;
      rows.forEach((a, i) => {
        const y = 18 + i * 14;
        const rank = ranked.indexOf(a) + 1;
        ctx.fillStyle = p.ink;
        ctx.fillRect(11, y - 5, 10, 10);
        ctx.fillStyle = colors[a.id];
        ctx.fillRect(12, y - 4, 8, 8);
        const pct = ((a.cells * 100) / NCELLS).toFixed(1);
        kit.text(`${rank}.${a.id === 0 ? "YOU" : "BOT"}`, 25, y + 1, 9, a.id === 0 ? p.primary : p.text, "left");
        kit.text(`${pct}%`, 94, y + 1, 9, a.id === 0 ? p.primary : p.text, "right");
      });

      // Minimap
      if ((miniAge += dtMs) > 250) {
        drawMini(v);
        miniAge = 0;
      }
      const mx = W - MINI - 8, my = H - MINI - 8;
      ctx.fillStyle = p.ink;
      ctx.globalAlpha = 0.7;
      ctx.fillRect(mx - 2, my - 2, MINI + 4, MINI + 4);
      ctx.globalAlpha = 0.85;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mini, mx, my, MINI, MINI);
      ctx.globalAlpha = 1;
      const k = MINI / (COLS * CELL);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + camX * k, my + camY * k, W * k, H * k);
      for (const a of v.actors) {
        if (!a.alive) continue;
        const [x, y] = headPos(a);
        const blink = a.id === 0 && (t / 250) % 2 < 1;
        ctx.fillStyle = a.id === 0 ? (blink ? "#ffffff" : p.primary) : p.ink;
        const s = a.id === 0 ? 4 : 2;
        ctx.fillRect(mx + x * k - s / 2, my + y * k - s / 2, s, s);
      }
      kit.text(`${(v.pct10 / 10).toFixed(1)}%`, mx + MINI / 2, my - 10, 12, p.primary);

      if (!v.started) {
        ctx.fillStyle = p.ink;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(0, H * 0.7 - 22, W, 44);
        ctx.globalAlpha = 1;
        kit.text("SWIPE, ARROWS OR POINT", W / 2, H * 0.7 - 7, 12, p.text);
        kit.text("LOOP BACK HOME TO PAINT", W / 2, H * 0.7 + 9, 12, p.primary);
      }
    },
  };
}
