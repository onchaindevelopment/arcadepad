// Soft Landing renderer: rounded capsule with the mascot in its porthole,
// layered jagged terrain in the coin's colours, glowing pads with multiplier
// tags, exhaust plume, dust, wreck debris and a zooming camera supplied by the
// engine. Visual only (may use Math.random/sin/cos; the engine never does).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { FOOT, H, LAND_TILT, LAND_VX, LAND_VY, LEG, NPTS, SEG, W, START_FUEL, FUEL_CAP, type LanderView } from "./index.ts";

const TAU = Math.PI * 2;
const byteToRad = (a: number) => (a / 256) * TAU;

function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}
function rgba(hex: string, a: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number }
interface Debris { x: number; y: number; vx: number; vy: number; a: number; va: number; w: number; h: number; c: string; life: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<LanderView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const { ctx } = kit;
  let t = 0;
  const puffs: Puff[] = [];
  const debris: Debris[] = [];
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let wreck: { x: number; y: number } | null = null;
  let fuelFlash = 0;
  let lastSite = -1;
  // Far ridge silhouette (decorative parallax), regenerated per site.
  let farRidge: number[] = [];
  const padColor = (mult: number) => (mult >= 5 ? p.accent : mult >= 3 ? p.secondary : p.primary);

  function makeRidge() {
    farRidge = [];
    let h = 150 + Math.random() * 60;
    for (let i = 0; i <= 32; i++) {
      h = Math.max(90, Math.min(240, h + (Math.random() - 0.5) * 50));
      farRidge.push(h);
    }
  }
  makeRidge();

  function feet(v: LanderView) {
    const a = byteToRad(v.tilt);
    const c = Math.cos(a), s = Math.sin(a);
    const pt = (lx: number, ly: number) => [v.x + lx * c - ly * s, v.y + lx * s + ly * c];
    return { l: pt(-LEG, FOOT), r: pt(LEG, FOOT), noz: pt(0, FOOT - 2) };
  }

  function drawTerrain(v: LanderView) {
    const tr = v.terrain;
    // Ground body
    ctx.beginPath();
    ctx.moveTo(0, H + 40);
    for (let i = 0; i < NPTS; i++) ctx.lineTo(i * SEG, tr[i]);
    ctx.lineTo(W, H + 40);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, 140, 0, H);
    g.addColorStop(0, shade(p.wall, 1.15));
    g.addColorStop(1, shade(p.wall, 0.55));
    ctx.fillStyle = g;
    ctx.fill();
    // Strata lines
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = rgba(p.bg, 0.35);
    ctx.lineWidth = 1;
    for (let k = 1; k <= 4; k++) {
      ctx.beginPath();
      for (let i = 0; i < NPTS; i++) {
        const y = tr[i] + k * 14 + Math.sin(i * 1.7 + k) * 3;
        if (i === 0) ctx.moveTo(0, y);
        else ctx.lineTo(i * SEG, y);
      }
      ctx.stroke();
    }
    // Craters
    for (let i = 2; i < NPTS - 2; i += 5) {
      const cx = i * SEG + 6, cy = tr[i] + 26 + (i % 3) * 8;
      ctx.fillStyle = rgba(p.ink, 0.25);
      ctx.beginPath();
      ctx.ellipse(cx, cy, 6, 2.5, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
    // Rim: ink outline + light top edge
    ctx.beginPath();
    for (let i = 0; i < NPTS; i++) {
      if (i === 0) ctx.moveTo(0, tr[i]);
      else ctx.lineTo(i * SEG, tr[i]);
    }
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.strokeStyle = rgba("#ffffff", 0.35);
    ctx.translate(0, 1.5);
    ctx.stroke();
    ctx.translate(0, -1.5);
  }

  function drawPads(v: LanderView) {
    for (const pad of v.pads) {
      const x0 = pad.i0 * SEG, x1 = pad.i1 * SEG, col = padColor(pad.mult);
      const glow = 0.25 + 0.2 * Math.sin(t / 250 + pad.mult);
      ctx.fillStyle = rgba(col, glow);
      ctx.fillRect(x0 - 2, pad.y - 10, x1 - x0 + 4, 10);
      kit.block(x0 - 1, pad.y - 1, x1 - x0 + 2, 7, col, 2);
      // Landing lights
      for (const lx of [x0 + 2, x1 - 4]) {
        const on = Math.floor(t / 300 + lx) % 2 === 0;
        ctx.fillStyle = on ? "#ffffff" : p.ink;
        ctx.fillRect(lx, pad.y - 3, 2, 2);
      }
      kit.text(`x${pad.mult}`, (x0 + x1) / 2, pad.y + 15, pad.mult >= 5 ? 12 : 11, col);
    }
  }

  function drawCapsule(v: LanderView) {
    ctx.save();
    ctx.translate(v.x, v.y);
    ctx.rotate(byteToRad(v.tilt));
    // Legs
    ctx.lineCap = "round";
    for (const sx of [-1, 1]) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(sx * 6, 4);
      ctx.lineTo(sx * LEG, FOOT);
      ctx.stroke();
      ctx.strokeStyle = shade(p.secondary, 1.2);
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = p.ink;
      ctx.fillRect(sx * LEG - 3, FOOT - 1, 6, 3);
      ctx.fillStyle = p.secondary;
      ctx.fillRect(sx * LEG - 2, FOOT - 0.5, 4, 1.5);
    }
    // Nozzle
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(-5, 5);
    ctx.lineTo(5, 5);
    ctx.lineTo(7, 11);
    ctx.lineTo(-7, 11);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = shade(p.secondary, 0.8);
    ctx.fillRect(-4.5, 6.5, 9, 3);
    // Hull: dome + skirt
    ctx.beginPath();
    ctx.moveTo(-11, 6);
    ctx.lineTo(-12, 0);
    ctx.arc(0, 0, 12, Math.PI, 0);
    ctx.lineTo(11, 6);
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = p.primary;
    ctx.fill();
    ctx.fillStyle = shade(p.primary, 0.75);
    ctx.fillRect(-11, 2, 22, 4);
    ctx.fillStyle = p.secondary;
    ctx.fillRect(-11, 0, 22, 2);
    // Antenna
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(4, -11);
    ctx.lineTo(7, -16);
    ctx.stroke();
    ctx.fillStyle = Math.floor(t / 400) % 2 ? p.accent : "#ffffff";
    ctx.fillRect(6, -18, 3, 3);
    // Porthole with mascot
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, -3, 8.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.bg2;
    ctx.beginPath();
    ctx.arc(0, -3, 7, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.clip();
    const spr = mood === "happy" ? kit.sprites.happy : mood === "sad" ? kit.sprites.sad : kit.sprites.idle;
    ctx.rotate(-byteToRad(v.tilt) * 0.6); // mascot leans back against the turn a bit
    ctx.drawImage(spr, -7, -10, 14, 14);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-5, -8, 3, 2);
    ctx.restore();
  }

  function spawnExhaust(v: LanderView) {
    const f = feet(v);
    const a = byteToRad(v.angle) + Math.PI; // opposite to thrust
    for (let i = 0; i < 3; i++) {
      const spread = (Math.random() - 0.5) * 0.5;
      const sp = 1.6 + Math.random() * 1.4;
      puffs.push({
        x: f.noz[0], y: f.noz[1],
        vx: Math.cos(a + spread) * sp + v.vx, vy: Math.sin(a + spread) * sp + v.vy,
        life: 0, max: 18 + Math.random() * 14,
        c: [p.accent, "#ffffff", p.primary][i % 3], s: 2 + Math.random() * 2,
      });
    }
    // Dust kicked off the ground near the surface
    if (v.alt < 45) {
      const gy = v.y + FOOT + v.alt;
      for (let i = 0; i < 2; i++) {
        const dir = Math.random() < 0.5 ? -1 : 1;
        puffs.push({ x: v.x + dir * Math.random() * 6, y: gy - 1, vx: dir * (1 + Math.random() * 2), vy: -Math.random() * 0.6, life: 0, max: 30 + Math.random() * 20, c: shade(p.wall, 1.6), s: 2 + Math.random() * 2 });
      }
    }
  }

  function stepPuffs() {
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.x += q.vx; q.y += q.vy;
      q.vx *= 0.94; q.vy *= 0.94;
      if (++q.life >= q.max) puffs.splice(i, 1);
    }
    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.vy += 0.08;
      d.x += d.vx; d.y += d.vy; d.a += d.va;
      d.vx *= 0.99;
      if (d.y > H + 20 || ++d.life > 240) debris.splice(i, 1);
    }
  }

  function drawPuffs() {
    for (const q of puffs) {
      ctx.globalAlpha = 1 - q.life / q.max;
      ctx.fillStyle = q.c;
      const s = q.s * (1 + q.life / q.max);
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
    for (const d of debris) {
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.rotate(d.a);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-d.w / 2 - 1, -d.h / 2 - 1, d.w + 2, d.h + 2);
      ctx.fillStyle = d.c;
      ctx.fillRect(-d.w / 2, -d.h / 2, d.w, d.h);
      ctx.restore();
    }
  }

  function gauge(x: number, y: number, w: number, label: string, frac: number, ok: boolean, txt: string) {
    kit.text(label, x, y, 9, p.text, "left");
    ctx.fillStyle = p.ink;
    ctx.fillRect(x, y + 6, w, 7);
    ctx.fillStyle = ok ? p.primary : p.accent;
    ctx.fillRect(x + 1, y + 7, Math.max(0, Math.min(1, frac)) * (w - 2), 5);
    kit.text(txt, x + w + 4, y + 9, 9, ok ? p.text : p.accent, "left");
  }

  function drawHud(v: LanderView) {
    // Fuel
    const lowBlink = v.lowFuel && Math.floor(t / 200) % 2 === 0;
    const ff = v.fuel / Math.max(START_FUEL, Math.min(FUEL_CAP, v.fuel));
    if (fuelFlash > 0) {
      ctx.fillStyle = rgba(p.primary, fuelFlash * 0.4);
      ctx.fillRect(8, 8, 104, 18);
    }
    gauge(10, 10, 90, lowBlink ? "FUEL LOW" : "FUEL", ff, !v.lowFuel, String(v.fuel));
    // Readouts: green when within landing limits
    const vy = v.vy, vx = Math.abs(v.vx), tl = Math.abs(v.tilt);
    const okV = vy <= LAND_VY, okH = vx <= LAND_VX, okT = tl <= LAND_TILT;
    const rx = W - 118;
    kit.text(`DROP ${(vy * 60).toFixed(0).padStart(3, " ")}`, rx, 14, 9, okV ? p.primary : p.accent, "left");
    kit.text(`SIDE ${(vx * 60).toFixed(0).padStart(3, " ")}`, rx, 26, 9, okH ? p.primary : p.accent, "left");
    kit.text(`TILT ${(tl * 1.40625).toFixed(0).padStart(3, " ")}`, rx, 38, 9, okT ? p.primary : p.accent, "left");
    kit.text(`ALT ${Math.max(0, Math.round(v.alt)).toString().padStart(3, " ")}`, rx + 62, 14, 9, p.text, "left");
    kit.text(`SITE ${v.site + 1}`, 10, 34, 9, p.text, "left");
    // Crash pips
    for (let i = 0; i < 3; i++) {
      const used = i < v.crashes;
      ctx.drawImage(used ? kit.sprites.sad : kit.sprites.mini, 64 + i * 13, 28, 11, 11);
      if (used) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(64 + i * 13, 28, 11, 11);
      }
    }
  }

  function banners(v: LanderView) {
    if (v.phase === "ready") {
      const a = Math.min(1, v.phaseT / 15);
      ctx.globalAlpha = a;
      kit.text(`SITE ${v.site + 1}`, W / 2, H / 2 - 24, 22, p.primary);
      kit.text(`GRAVITY ${(v.gravity * 3600 / 10).toFixed(1)}`, W / 2, H / 2 + 2, 11, p.text);
      ctx.globalAlpha = 1;
      if (v.site === 0 && v.frame < 60) kit.text(v.pointer ? "TILT WITH POINTER, HOLD TO THRUST" : "ARROWS TILT, UP/SPACE THRUST", W / 2, H / 2 + 24, 10, p.text);
    } else if (v.phase === "landed" && v.last) {
      const k = 1 + Math.max(0, (v.phaseT - 80) / 20) * 0.4;
      kit.text(v.last.perfect ? "PERFECT TOUCHDOWN!" : "SOFT LANDING!", W / 2, 70, Math.round(20 * k), padColor(v.last.mult));
      kit.text(`x${v.last.mult}  +${v.last.points}`, W / 2, 96, 14, p.text);
      kit.text(`+${v.last.refuel} FUEL`, W / 2, 114, 11, p.primary);
    } else if (v.phase === "crashed") {
      kit.text("CRASHED", W / 2, 70, 22, p.accent);
      if (v.crashes < 3 && v.fuel > 0) kit.text(`${3 - v.crashes} LEFT`, W / 2, 96, 12, p.text);
    } else if (v.phase === "over") {
      kit.text(v.fuel <= 0 ? "OUT OF FUEL" : "MISSION OVER", W / 2, H / 2 - 10, 22, p.accent);
      kit.text(`SCORE ${v.score}`, W / 2, H / 2 + 16, 14, p.text);
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: LanderView) {
      for (const e of events) {
        if (e.t === "landed") {
          mood = "happy"; moodT = 1600;
          const col = padColor(e.mult as number);
          kit.fx.burst(e.x! - LEG, e.y!, shade(p.wall, 1.6), 8, 60, 120);
          kit.fx.burst(e.x! + LEG, e.y!, shade(p.wall, 1.6), 8, 60, 120);
          kit.fx.burst(e.x!, e.y! - 20, col, 18, 150);
          kit.fx.popup(e.x!, e.y! - 34, `+${e.points as number}`, col);
          fuelFlash = 1;
          if (e.perfect) for (let i = 0; i < 4; i++) kit.fx.burst(e.x! + (Math.random() - 0.5) * 60, e.y! - 40, p.bricks[i % p.bricks.length], 10, 180);
        } else if (e.t === "crash") {
          mood = "sad"; moodT = 1800;
          wreck = { x: e.x!, y: e.y! };
          kit.fx.addShake(12);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.accent, 26, 200);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 12, 140);
          const cols = [p.primary, p.secondary, p.ink, p.primary];
          for (let i = 0; i < 10; i++) {
            const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
            const sp = 1.5 + Math.random() * 2.5;
            debris.push({ x: e.x!, y: e.y!, vx: Math.cos(a) * sp + (e.vx as number) * 0.5, vy: Math.sin(a) * sp, a: Math.random() * TAU, va: (Math.random() - 0.5) * 0.4, w: 3 + Math.random() * 4, h: 2 + Math.random() * 3, c: cols[i % cols.length], life: 0 });
          }
        } else if (e.t === "start") {
          mood = "idle";
          wreck = null;
        } else if (e.t === "nofuel" || e.t === "lowfuel") {
          kit.fx.popup(v.x, v.y - 24, e.t === "nofuel" ? "EMPTY!" : "LOW FUEL", p.accent);
        } else if (e.t === "wall") {
          kit.fx.addShake(3);
        } else if (e.t === "gameover") {
          kit.fx.addShake(6);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (v.site !== lastSite) {
        makeRidge();
        lastSite = v.site;
      }
      if (moodT > 0 && (moodT -= dtMs) <= 0) mood = "idle";
      if (fuelFlash > 0) fuelFlash = Math.max(0, fuelFlash - dtMs / 600);
      if (v.phase !== "crashed" && v.phase !== "over") wreck = null;
      kit.background(dtMs);

      // Big planet + far ridge (parallax, screen space).
      const z = v.cam.zoom;
      const par = (v.cam.x - W / 2) * 0.15;
      ctx.fillStyle = rgba(p.secondary, 0.25);
      ctx.beginPath();
      ctx.arc(W * 0.78 - par, 70, 38, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(p.accent, 0.18);
      ctx.beginPath();
      ctx.arc(W * 0.78 - par - 10, 62, 26, 0, TAU);
      ctx.fill();
      ctx.fillStyle = rgba(p.wall, 0.45);
      ctx.beginPath();
      ctx.moveTo(-20, H);
      for (let i = 0; i < farRidge.length; i++) ctx.lineTo(i * 22 - 20 - par * 2, farRidge[i] + (z - 1) * 30);
      ctx.lineTo(W + 40, H);
      ctx.closePath();
      ctx.fill();

      // World, through the engine's camera.
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.scale(z, z);
      ctx.translate(-v.cam.x, -v.cam.y);

      if (v.thrust) spawnExhaust(v);
      stepPuffs();
      drawTerrain(v);
      drawPads(v);
      // Shadow / guide line under the capsule.
      if (v.phase === "fly" && v.alt > 0) {
        const gy = v.y + FOOT + v.alt;
        ctx.fillStyle = rgba(p.ink, Math.max(0.1, 0.45 - v.alt / 300));
        const sw = Math.max(4, 14 - v.alt / 12);
        ctx.beginPath();
        ctx.ellipse(v.x, gy, sw, 2, 0, 0, TAU);
        ctx.fill();
      }
      // Thrust flame
      if (v.thrust) {
        const f = feet(v);
        const a = byteToRad(v.angle) + Math.PI;
        const len = 10 + Math.random() * 8;
        ctx.save();
        ctx.translate(f.noz[0], f.noz[1]);
        ctx.rotate(a);
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(0, -5); ctx.lineTo(len, 0); ctx.lineTo(0, 5); ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(0, -2.5); ctx.lineTo(len * 0.55, 0); ctx.lineTo(0, 2.5); ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
      drawPuffs();
      if (wreck) {
        // Smouldering wreck
        if (Math.random() < 0.4) puffs.push({ x: wreck.x + (Math.random() - 0.5) * 8, y: wreck.y, vx: (Math.random() - 0.5) * 0.3, vy: -0.4 - Math.random() * 0.5, life: 0, max: 50, c: rgba(p.ink, 0.6), s: 3 });
        ctx.drawImage(kit.sprites.sad, wreck.x - 8, wreck.y - 6, 16, 16);
      } else if (v.phase !== "over") {
        drawCapsule(v);
      }
      kit.fx.draw(kit, dtMs);
      ctx.restore();

      drawHud(v);
      banners(v);
    },
  };
}
