// Blob Grow renderer: scrolling, zooming arena camera, wobbly palette blobs
// with names, the mascot inside the player's blobs, a leaderboard and a
// minimap. Visual only (may use Math.random/sin/cos; the engine never does).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { H, W, WORLD, type BlobView } from "./index.ts";

const TAU = Math.PI * 2;

function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BlobView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const { ctx } = kit;
  // Bot colours: the coin's brick colours, skipping the player's primary when possible.
  const botCols = p.bricks.filter((c) => c.toLowerCase() !== p.primary.toLowerCase());
  const botColor = (i: number) => (botCols.length ? botCols[i % botCols.length] : p.secondary);
  const pelletCols = [p.primary, p.secondary, p.accent, ...p.bricks];
  let t = 0;
  let zoom = 1;
  let camX = WORLD / 2, camY = WORLD / 2;
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let banner = "";
  let bannerT = 0;
  const shown = new Map<number, number>(); // smoothed radius per id (grow animation)

  const toScreen = (wx: number, wy: number): [number, number] => [W / 2 + (wx - camX) * zoom, H / 2 + (wy - camY) * zoom];
  const onScreen = (wx: number, wy: number, r: number) => {
    const [sx, sy] = toScreen(wx, wy);
    const sr = r * zoom;
    return sx > -sr && sx < W + sr && sy > -sr && sy < H + sr;
  };

  function blobPath(x: number, y: number, r: number, seed: number, wob: number) {
    const n = 24;
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const rr = r * (1 + wob * Math.sin(a * 3 + t / 260 + seed) * 0.5 + wob * Math.sin(a * 5 - t / 370 + seed * 2) * 0.35);
      const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
  }

  function drawBlob(x: number, y: number, r: number, color: string, seed: number) {
    const wob = Math.min(0.06, 2.5 / Math.max(6, r));
    ctx.fillStyle = p.ink;
    blobPath(x, y, r + Math.max(1.5, r * 0.06), seed, wob);
    ctx.fill();
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    g.addColorStop(0, shade(color, 1.25));
    g.addColorStop(0.7, color);
    g.addColorStop(1, shade(color, 0.7));
    ctx.fillStyle = g;
    blobPath(x, y, r, seed, wob);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(x - r * 0.38, y - r * 0.45, r * 0.22, r * 0.12, -0.6, 0, TAU);
    ctx.fill();
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const wx = e.wx as number | undefined, wy = e.wy as number | undefined;
        const [sx, sy] = wx !== undefined && wy !== undefined ? toScreen(wx, wy) : [W / 2, H / 2];
        if (e.t === "pellet") {
          kit.fx.burst(sx, sy, pelletCols[(e.c as number) % pelletCols.length], 2, 50, 0);
        } else if (e.t === "coin") {
          kit.fx.burst(sx, sy, p.accent, 8, 90, 0);
          kit.fx.popup(sx, sy - 8, "+5", p.accent);
        } else if (e.t === "eatBot") {
          const col = botColor(e.color as number);
          kit.fx.burst(sx, sy, col, 18, 170, 0);
          kit.fx.burst(sx, sy, "#ffffff", 6, 120, 0);
          kit.fx.popup(sx, sy - 12, `+${e.mass as number}`, p.primary);
          kit.fx.addShake((e.shake as number) ?? 3);
          mood = "happy"; moodT = 900;
        } else if (e.t === "botEat") {
          if (sx > -20 && sx < W + 20 && sy > -20 && sy < H + 20) kit.fx.burst(sx, sy, botColor(e.color as number), 10, 120, 0);
        } else if (e.t === "cellLost") {
          kit.fx.burst(sx, sy, p.primary, 26, 220, 0);
          kit.fx.addShake((e.shake as number) ?? 5);
          kit.fx.flash();
          mood = "sad"; moodT = 1200;
        } else if (e.t === "split") {
          kit.fx.burst(W / 2, H / 2, p.primary, 10, 140, 0);
        } else if (e.t === "merge") {
          kit.fx.burst(sx, sy, p.secondary, 10, 100, 0);
        } else if (e.t === "milestone") {
          banner = `MASS ${e.mass as number}!`;
          bannerT = 1600;
          for (let i = 0; i < 4; i++) kit.fx.burst(W * (0.2 + 0.2 * i), H * 0.3, p.bricks[i % p.bricks.length] ?? p.accent, 10, 180);
        } else if (e.t === "won") {
          banner = "TOP BLOB!";
          bannerT = 3000;
          for (let i = 0; i < 6; i++) kit.fx.burst(Math.random() * W, H * 0.5, p.bricks[i % p.bricks.length] ?? p.accent, 14, 220);
        }
      }
      void v;
    },

    draw(v, dtMs) {
      t += dtMs;
      // Camera: follow the engine camera (pointer maths uses it), smoothed a touch.
      const k = Math.min(1, dtMs / 60);
      zoom += (v.zoom - zoom) * k;
      if (v.cells.length) {
        camX += (v.cx - camX) * Math.min(1, dtMs / 30);
        camY += (v.cy - camY) * Math.min(1, dtMs / 30);
      }
      if (moodT > 0) moodT -= dtMs;
      else mood = "idle";

      kit.background(dtMs);

      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(zoom, zoom);
      ctx.translate(-camX, -camY);

      // World grid + border.
      const vw = W / zoom / 2 + 60, vh = H / zoom / 2 + 60;
      const x0 = Math.max(0, camX - vw), x1 = Math.min(WORLD, camX + vw);
      const y0 = Math.max(0, camY - vh), y1 = Math.min(WORLD, camY + vh);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, 0, WORLD, WORLD);
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth = 1 / zoom;
      ctx.beginPath();
      const step = 50;
      for (let gx = Math.ceil(x0 / step) * step; gx <= x1; gx += step) { ctx.moveTo(gx, y0); ctx.lineTo(gx, y1); }
      for (let gy = Math.ceil(y0 / step) * step; gy <= y1; gy += step) { ctx.moveTo(x0, gy); ctx.lineTo(x1, gy); }
      ctx.stroke();
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 4 / zoom;
      ctx.strokeRect(0, 0, WORLD, WORLD);

      // Pellets.
      const coinS = 12;
      for (const pl of v.pellets) {
        if (!pl.alive || pl.x < x0 || pl.x > x1 || pl.y < y0 || pl.y > y1) continue;
        if (pl.coin) {
          const bob = Math.sin(t / 220 + pl.x) * 1.5;
          ctx.drawImage(kit.sprites.mini, pl.x - coinS / 2, pl.y - coinS / 2 + bob, coinS, coinS);
        } else {
          const r = 4 + Math.sin(t / 300 + pl.x * 0.1 + pl.y) * 0.6;
          ctx.fillStyle = p.ink;
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, r + 1, 0, TAU);
          ctx.fill();
          ctx.fillStyle = pelletCols[pl.c % pelletCols.length];
          ctx.beginPath();
          ctx.arc(pl.x, pl.y, r, 0, TAU);
          ctx.fill();
        }
      }

      // Blobs, small first so big ones cover them.
      type D = { id: number; x: number; y: number; r: number; mass: number; me: boolean; name: string; color: number; merge: number };
      const list: D[] = [];
      for (const b of v.bots) if (b.alive) list.push({ id: b.id, x: b.x, y: b.y, r: b.r, mass: b.mass, me: false, name: b.name, color: b.color, merge: 0 });
      for (const c of v.cells) list.push({ id: c.id, x: c.x, y: c.y, r: c.r, mass: c.mass, me: true, name: theme.mascot.name, color: 0, merge: c.merge });
      list.sort((a, b) => a.mass - b.mass);
      const seen = new Set<number>();
      let myBig = 0;
      for (const c of v.cells) myBig = Math.max(myBig, c.mass);
      for (const d of list) {
        seen.add(d.id);
        const prev = shown.get(d.id) ?? d.r * 0.6;
        const r = prev + (d.r - prev) * Math.min(1, dtMs / 90);
        shown.set(d.id, r);
        if (!onScreen(d.x, d.y, r + 20)) continue;
        if (d.me) {
          drawBlob(d.x, d.y, r, p.primary, d.id);
          const sprite = v.dead ? kit.sprites.sad : mood === "happy" ? kit.sprites.happy : mood === "sad" ? kit.sprites.sad : kit.sprites.idle;
          const s = r * 1.25;
          ctx.drawImage(sprite, d.x - s / 2, d.y - s / 2, s, s);
          if (d.merge > 0 && v.cells.length > 1) {
            ctx.strokeStyle = "rgba(255,255,255,0.5)";
            ctx.lineWidth = 2 / zoom;
            ctx.beginPath();
            ctx.arc(d.x, d.y, r + 4 / zoom, -Math.PI / 2, -Math.PI / 2 + TAU * (d.merge / 600));
            ctx.stroke();
          }
        } else {
          const col = botColor(d.color);
          drawBlob(d.x, d.y, r, col, d.id);
          // Simple face: eyes look toward the player; angry brows if it can eat you.
          const danger = myBig > 0 && d.mass >= myBig * 1.1;
          const prey = myBig > 0 && myBig >= d.mass * 1.1;
          const ex = r * 0.28, ey = -r * 0.12, er = Math.max(1.5, r * 0.14);
          let lx = v.cx - d.x, ly = v.cy - d.y;
          const ll = Math.hypot(lx, ly) || 1;
          lx = (lx / ll) * er * 0.45; ly = (ly / ll) * er * 0.45;
          for (const sgn of [-1, 1]) {
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.arc(d.x + sgn * ex, d.y + ey, er, 0, TAU);
            ctx.fill();
            ctx.fillStyle = p.ink;
            ctx.beginPath();
            ctx.arc(d.x + sgn * ex + lx, d.y + ey + ly, er * (prey ? 0.7 : 0.5), 0, TAU);
            ctx.fill();
            if (danger) {
              ctx.strokeStyle = p.ink;
              ctx.lineWidth = Math.max(1, er * 0.45);
              ctx.beginPath();
              ctx.moveTo(d.x + sgn * (ex + er), d.y + ey - er * 1.5);
              ctx.lineTo(d.x + sgn * (ex - er * 0.6), d.y + ey - er * 0.9);
              ctx.stroke();
            }
          }
          // Name.
          const fs = Math.max(8, Math.min(r * 0.42, 40)) ;
          if (r * zoom > 9) {
            ctx.font = `bold ${fs}px ${kit.font}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "middle";
            ctx.lineWidth = Math.max(2, fs * 0.22);
            ctx.strokeStyle = p.ink;
            ctx.strokeText(d.name, d.x, d.y + r * 0.42);
            ctx.fillStyle = "#ffffff";
            ctx.fillText(d.name, d.x, d.y + r * 0.42);
          }
        }
      }
      for (const id of shown.keys()) if (!seen.has(id)) shown.delete(id);
      ctx.restore();

      kit.fx.draw(kit, dtMs);

      // Leaderboard (top right).
      const lb = v.leaderboard.slice(0, 5);
      const meIdx = v.leaderboard.findIndex((e) => e.me);
      const rows = lb.length + (meIdx >= 5 ? 1 : 0);
      const bw = 128, bx = W - bw - 6, by = 6;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, 18 + rows * 13, 6);
      ctx.fill();
      kit.text("TOP BLOBS", bx + bw / 2, by + 9, 9, p.accent);
      const row = (i: number, e: { name: string; mass: number; me: boolean }, rank: number) => {
        const y = by + 22 + i * 13;
        const col = e.me ? p.primary : p.text;
        const nm = e.me ? theme.mascot.name : e.name;
        kit.text(`${rank}. ${nm.length > 10 ? nm.slice(0, 10) : nm}`, bx + 6, y, 9, col, "left");
        kit.text(String(e.mass), bx + bw - 6, y, 9, col, "right");
      };
      lb.forEach((e, i) => row(i, e, i + 1));
      if (meIdx >= 5) row(5, v.leaderboard[meIdx], meIdx + 1);

      // Minimap (bottom left).
      const ms = 64, mx = 6, my = H - ms - 6;
      ctx.fillStyle = "rgba(0,0,0,0.45)";
      ctx.fillRect(mx, my, ms, ms);
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 1;
      ctx.strokeRect(mx + 0.5, my + 0.5, ms - 1, ms - 1);
      for (const b of v.bots) {
        if (!b.alive) continue;
        ctx.fillStyle = botColor(b.color);
        const s = Math.max(1.5, (b.r / WORLD) * ms * 2);
        ctx.fillRect(mx + (b.x / WORLD) * ms - s / 2, my + (b.y / WORLD) * ms - s / 2, s, s);
      }
      if (v.cells.length) {
        ctx.fillStyle = p.primary;
        ctx.beginPath();
        ctx.arc(mx + (v.cx / WORLD) * ms, my + (v.cy / WORLD) * ms, 3 + Math.sin(t / 150), 0, TAU);
        ctx.fill();
      }

      // Mass readout (bottom right).
      kit.text(`MASS ${v.mass}`, W - 8, H - 14, 12, p.primary, "right");

      if (!v.started && !v.dead) {
        kit.text("MOVE TO STEER", W / 2, H * 0.72, 14, p.text);
        kit.text("TAP / SPACE TO SPLIT", W / 2, H * 0.72 + 18, 10, p.accent);
      }
      if (bannerT > 0) {
        bannerT -= dtMs;
        const s = 1 + Math.max(0, (bannerT - 1300) / 300) * 0.4;
        kit.text(banner, W / 2, H * 0.25, 20 * s, p.accent);
      }
      if (v.dead) {
        kit.text("EATEN!", W / 2, H * 0.42, 26, p.accent);
        if (v.killer) kit.text(`BY ${v.killer.toUpperCase()}`, W / 2, H * 0.42 + 26, 12, p.text);
        kit.text(`BEST MASS ${v.maxMass}`, W / 2, H * 0.42 + 46, 12, p.primary);
      }
    },
  };
}
