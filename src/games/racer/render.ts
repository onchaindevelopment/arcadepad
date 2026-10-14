// Drift Circuit renderer: top-down track with kerbs and tyre barriers, a
// non-rotating follow camera, skid marks, boost flames, minimap and
// race / results overlays. Client only; may use Math freely.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BOOST_COST, CARS, FIELD_H, FIELD_W, HALF_W, LAPS, POINTS, RACES, TRACKS, WALL, type CarView, type RacerView } from "./index.ts";

function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [128, 128, 128];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = rgb(a), y = rgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
function rgba(hex: string, a: number): string {
  const c = rgb(hex);
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}
const fmtTime = (f: number) => {
  if (!f) return "--.--";
  const s = f / 60;
  const m = Math.floor(s / 60);
  const r = (s - m * 60).toFixed(2).padStart(5, "0");
  return m ? `${m}:${r}` : r;
};
const ORD = ["1ST", "2ND", "3RD", "4TH", "5TH", "6TH"];

interface Part { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number }
interface Skid { x0: number; y0: number; x1: number; y1: number; a: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<RacerView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const ink = p.ink;
  const grass = mix(p.bg, p.primary, 0.16);
  const grassDark = mix(p.bg, p.primary, 0.1);
  const asphalt = mix(ink, p.bg2, 0.45);
  const carColors = [p.primary, ...[1, 2, 3, 4, 5].map((i) => p.bricks[i % p.bricks.length] ?? p.secondary)];
  let t = 0;
  let camX = 0, camY = 0, camInit = false, camTrack = -1;
  let parts: Part[] = [];
  let skids: Skid[] = [];
  const prevRear: { x: number; y: number }[][] = [];
  let banner = "", bannerT = 0, bannerC = p.text;

  function setBanner(s: string, c: string, ms = 1200) {
    banner = s;
    bannerC = c;
    bannerT = ms;
  }
  function spawn(x: number, y: number, c: string, n: number, sp: number, life = 500, size = 3) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, v = sp * (0.3 + Math.random() * 0.8);
      parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0, max: life * (0.6 + Math.random() * 0.6), c, s: size * (0.6 + Math.random() * 0.7) });
    }
  }

  function tracePath(ti: number, off = 0) {
    const tr = TRACKS[ti];
    ctx.beginPath();
    for (let i = 0; i <= tr.n; i++) {
      const k = i % tr.n;
      const x = tr.x[k] + tr.nx[k] * off, y = tr.y[k] + tr.ny[k] * off;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }
  function strokeTrack(ti: number, w: number, color: string, dash?: number[], off = 0) {
    tracePath(ti, off);
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    ctx.lineJoin = "round";
    ctx.setLineDash(dash ?? []);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawTrack(ti: number) {
    const tr = TRACKS[ti];
    // Barrier band, run-off grass, kerbs, asphalt.
    strokeTrack(ti, WALL * 2 + 12, ink);
    strokeTrack(ti, WALL * 2 + 7, p.wall);
    strokeTrack(ti, WALL * 2 + 7, "rgba(255,255,255,0.8)", [6, 10]);
    strokeTrack(ti, WALL * 2, grass);
    strokeTrack(ti, WALL * 2 - 18, grassDark, [14, 14]);
    strokeTrack(ti, HALF_W * 2 + 8, "#ffffff");
    strokeTrack(ti, HALF_W * 2 + 8, p.accent, [10, 10]);
    strokeTrack(ti, HALF_W * 2, asphalt);
    strokeTrack(ti, 2, "rgba(255,255,255,0.18)", [14, 18]);
    // Start / finish checkers across sample 0.
    const nx = tr.nx[0], ny = tr.ny[0], tx = tr.tx[0], ty = tr.ty[0];
    const cell = 6;
    for (let r = 0; r < 2; r++)
      for (let k = -HALF_W / cell; k < HALF_W / cell; k++) {
        ctx.fillStyle = (k + r) & 1 ? ink : "#ffffff";
        const cx = tr.x[0] + nx * (k * cell) + tx * (r * cell - cell);
        const cy = tr.y[0] + ny * (k * cell) + ty * (r * cell - cell);
        ctx.save();
        ctx.translate(cx, cy);
        ctx.transform(tx, ty, nx, ny, 0, 0);
        ctx.fillRect(0, 0, cell, cell);
        ctx.restore();
      }
    // Grid boxes.
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    for (let slot = 0; slot < CARS; slot++) {
      const row = slot >> 1, col = slot & 1;
      const idx = (tr.n - 3 - row * 5 - col * 2) % tr.n;
      const lat = col ? 18 : -18;
      const cx = tr.x[idx] + tr.nx[idx] * lat, cy = tr.y[idx] + tr.ny[idx] * lat;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.transform(tr.tx[idx], tr.ty[idx], tr.nx[idx], tr.ny[idx], 0, 0);
      ctx.beginPath();
      ctx.moveTo(14, -9);
      ctx.lineTo(-12, -9);
      ctx.moveTo(14, 9);
      ctx.lineTo(-12, 9);
      ctx.moveTo(14, -9);
      ctx.lineTo(14, 9);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawCar(c: CarView) {
    const a = (c.hd / 4096) * Math.PI * 2;
    const L = c.player ? 24 : 21, W = c.player ? 14 : 12;
    // shadow
    ctx.save();
    ctx.translate(c.x + 2, c.y + 3);
    ctx.rotate(a);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.roundRect(-L / 2, -W / 2, L, W, 4);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(c.x, c.y);
    ctx.rotate(a);
    ctx.fillStyle = ink;
    for (const [wx, wy] of [[-L / 2 + 3, -W / 2 - 2], [-L / 2 + 3, W / 2 - 1], [L / 2 - 8, -W / 2 - 2], [L / 2 - 8, W / 2 - 1]]) ctx.fillRect(wx, wy, 5, 3);
    kit.block(-L / 2, -W / 2, L, W, carColors[c.id], 3);
    ctx.fillStyle = rgba(ink, 0.65);
    ctx.fillRect(L / 2 - 9, -W / 2 + 3, 3, W - 6);
    ctx.fillStyle = ink;
    ctx.fillRect(-L / 2 - 1, -W / 2 + 1, 3, W - 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(L / 2 - 2, -W / 2 + 2, 2, 2);
    ctx.fillRect(L / 2 - 2, W / 2 - 4, 2, 2);
    ctx.restore();
    if (c.player) {
      const spr = c.place === 1 ? kit.sprites.happy : kit.sprites.mini;
      const s = c.place === 1 ? 17 : 15;
      ctx.drawImage(spr, Math.round(c.x - s / 2), Math.round(c.y - s / 2 - 1), s, s);
    } else {
      ctx.font = `bold 8px ${kit.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = ink;
      ctx.fillText(c.name[0], c.x, c.y + 0.5);
    }
  }

  function drawMinimap(v: RacerView) {
    const tr = TRACKS[v.track];
    const bw = 78, bh = 104, x0 = FIELD_W - bw - 8, y0 = FIELD_H - bh - 8;
    ctx.fillStyle = rgba(ink, 0.55);
    ctx.beginPath();
    ctx.roundRect(x0, y0, bw, bh, 6);
    ctx.fill();
    const s = Math.min((bw - 12) / (tr.maxX - tr.minX), (bh - 12) / (tr.maxY - tr.minY));
    const ox = x0 + bw / 2 - ((tr.minX + tr.maxX) / 2) * s, oy = y0 + bh / 2 - ((tr.minY + tr.maxY) / 2) * s;
    ctx.beginPath();
    for (let i = 0; i <= tr.n; i += 4) {
      const k = i % tr.n;
      if (i === 0) ctx.moveTo(ox + tr.x[k] * s, oy + tr.y[k] * s);
      else ctx.lineTo(ox + tr.x[k] * s, oy + tr.y[k] * s);
    }
    ctx.closePath();
    ctx.strokeStyle = "rgba(255,255,255,0.75)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.strokeStyle = asphalt;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(ox + tr.x[0] * s - 2, oy + tr.y[0] * s - 2, 4, 4);
    for (const c of [...v.cars].reverse()) {
      ctx.fillStyle = ink;
      const r = c.player ? 4 : 3;
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oy + c.y * s, r + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = carColors[c.id];
      ctx.beginPath();
      ctx.arc(ox + c.x * s, oy + c.y * s, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawHud(v: RacerView) {
    const me = v.cars[v.me];
    // Position + lap
    kit.text(`P${v.place}`, 12, 26, 26, v.place === 1 ? p.accent : p.text, "left");
    kit.text(`/${CARS}`, 12 + (v.place >= 1 ? 30 : 0), 32, 11, p.text, "left");
    kit.text(`LAP ${v.lap}/${LAPS}`, FIELD_W - 12, 20, 13, p.text, "right");
    kit.text(fmtTime(v.raceT), FIELD_W - 12, 36, 10, p.text, "right");
    if (v.bestLap) kit.text(`BEST ${fmtTime(v.bestLap)}`, FIELD_W - 12, 50, 9, p.primary, "right");
    kit.text(`RACE ${v.race + 1}/${RACES}  ${TRACKS[v.track].name}`, 12, 50, 9, p.text, "left");
    // Boost meter: three charges
    const bx = 10, by = FIELD_H - 30, seg = 30;
    kit.text(me.boostT > 0 ? "BOOST!" : "BOOST", bx, by - 10, 9, me.boostT > 0 ? p.accent : p.text, "left");
    for (let i = 0; i < 3; i++) {
      const x = bx + i * (seg + 4);
      const fill = Math.max(0, Math.min(1, (v.boost - i * BOOST_COST) / BOOST_COST));
      ctx.fillStyle = ink;
      ctx.fillRect(x, by, seg, 12);
      ctx.fillStyle = rgba(p.secondary, 0.35);
      ctx.fillRect(x + 2, by + 2, seg - 4, 8);
      ctx.fillStyle = fill >= 1 ? (Math.sin(t / 120) > 0 ? p.accent : p.primary) : p.secondary;
      ctx.fillRect(x + 2, by + 2, (seg - 4) * fill, 8);
    }
    // Speed bar
    const sp = Math.hypot(me.vx, me.vy);
    ctx.fillStyle = ink;
    ctx.fillRect(bx, by + 16, seg * 3 + 8, 5);
    ctx.fillStyle = me.boostT > 0 ? p.accent : p.primary;
    ctx.fillRect(bx + 1, by + 17, Math.min(1, sp / 6.2) * (seg * 3 + 6), 3);
  }

  function drawCountdown(v: RacerView) {
    const n = 3 - Math.floor(v.phaseT / 60);
    const cx = FIELD_W / 2, cy = 170;
    ctx.fillStyle = rgba(ink, 0.8);
    ctx.beginPath();
    ctx.roundRect(cx - 62, cy - 22, 124, 44, 10);
    ctx.fill();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i < 4 - n ? p.accent : rgba(p.text, 0.15);
      ctx.beginPath();
      ctx.arc(cx - 36 + i * 36, cy, 13, 0, Math.PI * 2);
      ctx.fill();
    }
    kit.text(String(Math.max(1, n)), cx, cy + 50, 34, p.text);
    if (v.race === 0 && v.phaseT < 170) {
      kit.text("GAS IS AUTOMATIC", cx, 270, 12, p.text);
      kit.text("< > STEER   v BRAKE / DRIFT", cx, 290, 9, p.text);
      kit.text("DRIFT TO CHARGE BOOST (X / DOUBLE TAP)", cx, 306, 8, p.text);
    }
  }

  function drawResults(v: RacerView) {
    ctx.fillStyle = rgba(ink, 0.82);
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    const done = v.phase === "done";
    const title = done ? (v.champion ? "CHAMPION!" : "CHAMPIONSHIP OVER") : `RACE ${v.race + 1} RESULT`;
    kit.text(title, FIELD_W / 2, 70, done ? 20 : 17, done && v.champion ? p.accent : p.text);
    if (done || v.champion) {
      const s = 64;
      ctx.drawImage(v.champion ? kit.sprites.happy : kit.sprites.sad, FIELD_W / 2 - s / 2, 96, s, s);
    }
    const rows = done
      ? [0, 1, 2, 3, 4, 5].sort((a, b) => v.points[b] - v.points[a] || a - b)
      : v.lastOrder;
    const y0 = done ? 190 : 120;
    kit.text(done ? "FINAL STANDINGS" : "POS  DRIVER      +PTS  TOTAL", FIELD_W / 2, y0 - 16, 9, p.text);
    rows.forEach((id, i) => {
      const y = y0 + i * 34;
      const me = id === v.me;
      kit.block(26, y, FIELD_W - 52, 28, me ? p.primary : rgba(p.secondary, 0.6) as string, 6);
      const tc = me ? ink : p.text;
      ctx.fillStyle = carColors[id];
      ctx.fillRect(40, y + 9, 10, 10);
      kit.text(ORD[i], 62, y + 14, 11, tc, "left");
      kit.text(me ? "YOU" : v.cars[id].name, 104, y + 14, 12, tc, "left");
      if (!done) kit.text(`+${POINTS[i]}`, 240, y + 14, 11, tc, "right");
      kit.text(String(v.points[id]), FIELD_W - 40, y + 14, 12, tc, "right");
    });
    const by = y0 + 6 * 34 + 16;
    kit.text(`BEST LAP ${fmtTime(v.bestLap)}`, FIELD_W / 2, by, 11, p.text);
    kit.text(`SCORE ${v.score}`, FIELD_W / 2, by + 22, 16, p.accent);
    if (!done && v.phaseT > 90 && Math.sin(t / 200) > -0.3) kit.text("TAP FOR NEXT RACE", FIELD_W / 2, FIELD_H - 40, 11, p.text);
  }

  return {
    onEvents(events: readonly GameEvent[], v: RacerView) {
      const me = v.cars[v.me];
      for (const e of events) {
        if (e.t === "count") setBanner(String(e.n), p.text, 700);
        else if (e.t === "go") {
          setBanner("GO!", p.primary, 900);
          kit.fx.flash("255,255,255");
        } else if (e.t === "lap") {
          setBanner((e.lap as number) === LAPS ? "FINAL LAP!" : `LAP ${e.lap}`, p.accent, 1300);
          if (e.best) kit.fx.popup(FIELD_W / 2, 230, `BEST LAP ${fmtTime(e.frames as number)}`, p.primary);
          spawn(me.x, me.y, p.accent, 16, 2.5);
        } else if (e.t === "wall") {
          kit.fx.addShake(e.shake as number);
          spawn(e.x!, e.y!, "#ffffff", 8, 2.2, 300, 2);
          spawn(e.x!, e.y!, p.accent, 6, 1.6, 300, 2);
        } else if (e.t === "bump") {
          kit.fx.addShake(3);
          spawn(e.x!, e.y!, "#ffffff", 8, 1.8, 300, 2);
        } else if (e.t === "boost") {
          kit.fx.addShake(3);
          kit.fx.flash(rgb(p.accent).join(","));
          spawn(me.x, me.y, p.accent, 14, 2.4);
        } else if (e.t === "charge") {
          kit.fx.popup(60, FIELD_H - 56, "BOOST READY", p.accent);
        } else if (e.t === "overtake") {
          kit.fx.popup(40, 70, `P${e.place}`, p.primary);
        } else if (e.t === "finish") {
          const pl = e.place as number;
          setBanner(pl === 1 ? "WINNER!" : `${ORD[pl - 1]} PLACE`, pl <= 3 ? p.accent : p.text, 2000);
          if (pl <= 3) for (let i = 0; i < 4; i++) spawn(me.x + (Math.random() - 0.5) * 80, me.y + (Math.random() - 0.5) * 80, p.bricks[i % p.bricks.length], 14, 3, 900);
        } else if (e.t === "timeout") {
          setBanner("TIME UP", p.text, 1500);
        } else if (e.t === "champion") {
          for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * FIELD_W, FIELD_H * 0.4, p.bricks[i % p.bricks.length], 14, 220);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const dt = Math.min(50, dtMs);
      const me = v.cars[v.me];
      if (camTrack !== v.track) {
        camTrack = v.track;
        camInit = false;
        skids = [];
        parts = [];
        prevRear.length = 0;
      }
      const tx = me.x + me.vx * 14, ty = me.y + me.vy * 14;
      if (!camInit) {
        camX = tx;
        camY = ty;
        camInit = true;
      } else {
        const k = 1 - Math.pow(0.0005, dt / 1000);
        camX += (tx - camX) * k;
        camY += (ty - camY) * k;
      }
      kit.background(dtMs);
      ctx.save();
      ctx.translate(Math.round(FIELD_W / 2 - camX), Math.round(FIELD_H * 0.54 - camY));

      drawTrack(v.track);

      // Skid marks
      for (const c of v.cars) {
        const a = (c.hd / 4096) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        const rear = [
          { x: c.x - ca * 8 - sa * 5, y: c.y - sa * 8 + ca * 5 },
          { x: c.x - ca * 8 + sa * 5, y: c.y - sa * 8 - ca * 5 },
        ];
        const pr = prevRear[c.id];
        const sliding = Math.abs(c.slip) > 0.45;
        if (pr && sliding && v.phase !== "countdown") {
          for (let w = 0; w < 2; w++) skids.push({ x0: pr[w].x, y0: pr[w].y, x1: rear[w].x, y1: rear[w].y, a: Math.min(0.45, Math.abs(c.slip) * 0.4) });
          if (c.player && Math.random() < 0.5) parts.push({ x: rear[0].x, y: rear[0].y, vx: (Math.random() - 0.5) * 0.6, vy: (Math.random() - 0.5) * 0.6, life: 0, max: 600, c: "rgba(255,255,255,0.5)", s: 5 });
        }
        prevRear[c.id] = rear;
        if (c.off && Math.hypot(c.vx, c.vy) > 0.8 && Math.random() < 0.6)
          parts.push({ x: rear[0].x, y: rear[0].y, vx: -c.vx * 0.2 + (Math.random() - 0.5), vy: -c.vy * 0.2 + (Math.random() - 0.5), life: 0, max: 450, c: grassDark, s: 4 });
        if (c.boostT > 0)
          for (let i = 0; i < 2; i++)
            parts.push({ x: c.x - ca * 13, y: c.y - sa * 13, vx: -ca * 2 + (Math.random() - 0.5), vy: -sa * 2 + (Math.random() - 0.5), life: 0, max: 260, c: i ? p.accent : "#ffffff", s: 4 });
      }
      if (skids.length > 900) skids = skids.slice(skids.length - 900);
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      for (const s of skids) {
        ctx.strokeStyle = `rgba(0,0,0,${s.a})`;
        ctx.beginPath();
        ctx.moveTo(s.x0, s.y0);
        ctx.lineTo(s.x1, s.y1);
        ctx.stroke();
      }

      // Particles (world space)
      parts = parts.filter((q) => (q.life += dt) < q.max);
      if (parts.length > 500) parts = parts.slice(parts.length - 500);
      for (const q of parts) {
        q.x += q.vx * (dt / 16.7);
        q.y += q.vy * (dt / 16.7);
        ctx.globalAlpha = 1 - q.life / q.max;
        ctx.fillStyle = q.c;
        const s = q.s * (0.5 + q.life / q.max);
        ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
      }
      ctx.globalAlpha = 1;

      // Cars, player last (on top)
      for (const c of v.cars) if (!c.player) drawCar(c);
      drawCar(me);
      // Player marker arrow during the countdown
      if (v.phase === "countdown") {
        const bob = Math.sin(t / 150) * 3;
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(me.x - 6, me.y - 24 + bob);
        ctx.lineTo(me.x + 6, me.y - 24 + bob);
        ctx.lineTo(me.x, me.y - 16 + bob);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();

      if (v.phase === "results" || v.phase === "done") drawResults(v);
      else {
        drawHud(v);
        drawMinimap(v);
        if (v.phase === "countdown") drawCountdown(v);
        if (bannerT > 0 && v.phase !== "countdown") {
          bannerT -= dtMs;
          const sc = 1 + Math.max(0, (bannerT - 1000) / 600);
          ctx.globalAlpha = Math.min(1, bannerT / 300);
          kit.text(banner, FIELD_W / 2, 150, Math.round(26 * Math.min(1.4, sc)), bannerC);
          ctx.globalAlpha = 1;
        }
      }
      kit.fx.draw(kit, dtMs);
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    },
  };
}
