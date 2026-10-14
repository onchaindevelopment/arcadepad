// Moon Putt renderer: moon-turf holes, coin ball with the mascot face,
// cup with a little flag, dotted aim line, power meter and juicy feedback.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import type { Zone } from "./holes.ts";
import {
  BALL_R, BLADE_T, CUP_R, FIELD_H, FIELD_W, HOLES, HUB_R, MAX_STROKES, type Cam, type PuttView,
} from "./index.ts";

function scoreTerm(strokes: number, par: number): string {
  if (strokes === 1) return "HOLE IN ONE!";
  const d = strokes - par;
  if (d <= -3) return "ALBATROSS!";
  if (d === -2) return "EAGLE!";
  if (d === -1) return "BIRDIE!";
  if (d === 0) return "PAR";
  if (d === 1) return "BOGEY";
  if (d === 2) return "DOUBLE BOGEY";
  return `+${d}`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<PuttView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const water = p.bricks[3 % p.bricks.length] ?? p.secondary;
  const sand = p.bricks[4 % p.bricks.length] ?? p.accent;
  let t = 0;
  let cam: Cam = { s: 1, ox: 0, oy: 0 };
  let trail: { x: number; y: number }[] = [];
  let bumpT: number[] = [];
  let spin = 0;
  let lastHole = -1;
  let squash = 0;

  const sx = (x: number) => x * cam.s + cam.ox;
  const sy = (y: number) => y * cam.s + cam.oy;

  function polyPath(pts: readonly number[]) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
  }
  function zonePath(z: Zone) {
    ctx.beginPath();
    if (z.length === 4) ctx.roundRect(z[0], z[1], z[2], z[3], 6);
    else ctx.arc(z[0], z[1], z[2], 0, Math.PI * 2);
  }

  function drawCourse(v: PuttView) {
    const def = HOLES[v.hole];
    const px = 1 / cam.s; // one screen pixel in world units
    // Rim: ink, then a bright edge; the turf fill covers the inner half.
    polyPath(def.outer);
    ctx.lineJoin = "round";
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 16 * px;
    ctx.stroke();
    ctx.strokeStyle = p.secondary;
    ctx.lineWidth = 11 * px;
    ctx.stroke();
    ctx.fillStyle = p.wall;
    ctx.fill();
    // Turf stripes and craters.
    ctx.save();
    polyPath(def.outer);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.045)";
    for (let y = -400; y < 1000; y += 24) {
      ctx.beginPath();
      ctx.moveTo(-50, y);
      ctx.lineTo(600, y + 160);
      ctx.lineTo(600, y + 172);
      ctx.lineTo(-50, y + 12);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(0,0,0,0.12)";
    for (let i = 0; i < 7; i++) {
      const cx = ((i * 97 + v.hole * 61) % 300) + 10, cy = ((i * 173 + v.hole * 89) % 520) + 10;
      ctx.beginPath();
      ctx.arc(cx, cy, 5 + (i % 3) * 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // Slopes: drifting chevrons.
    for (const s of def.slopes) {
      const [x, y, w, h] = s.r;
      ctx.fillStyle = "rgba(255,255,255,0.05)";
      ctx.fillRect(x, y, w, h);
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      const m = Math.sqrt(s.fx * s.fx + s.fy * s.fy) || 1;
      const ux = s.fx / m, uy = s.fy / m;
      const off = ((t / 30) % 28);
      ctx.strokeStyle = "rgba(255,255,255,0.22)";
      ctx.lineWidth = 3;
      for (let gx = x - 28; gx < x + w + 28; gx += 28) {
        for (let gy = y - 28; gy < y + h + 28; gy += 28) {
          const cx = gx + ux * off + 14, cy = gy + uy * off + 14;
          ctx.beginPath();
          ctx.moveTo(cx - ux * 5 - uy * 6, cy - uy * 5 + ux * 6);
          ctx.lineTo(cx + ux * 3, cy + uy * 3);
          ctx.lineTo(cx - ux * 5 + uy * 6, cy - uy * 5 - ux * 6);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
    // Sand.
    for (const z of def.sand) {
      zonePath(z);
      ctx.fillStyle = sand;
      ctx.globalAlpha = 0.55;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5 * px;
      ctx.stroke();
      ctx.save();
      zonePath(z);
      ctx.clip();
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 60; i++) ctx.fillRect(((i * 37) % 300), ((i * 71) % 540), 2, 2);
      ctx.restore();
    }
    // Water with moving ripples.
    for (const z of def.water) {
      zonePath(z);
      ctx.fillStyle = water;
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2 * px;
      ctx.stroke();
      ctx.save();
      zonePath(z);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5;
      for (let y = 0; y < 560; y += 12) {
        ctx.beginPath();
        for (let x = -10; x < 330; x += 6) {
          const yy = y + Math.sin(x / 9 + t / 300 + y) * 2;
          if (x === -10) ctx.moveTo(x, yy);
          else ctx.lineTo(x, yy);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();
    // Blocks.
    for (const b of def.blocks) {
      polyPath(b);
      ctx.fillStyle = p.secondary;
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 3 * px;
      ctx.stroke();
      ctx.save();
      polyPath(b);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.lineWidth = 4 * px;
      ctx.translate(1.5 * px, 1.5 * px);
      polyPath(b);
      ctx.stroke();
      ctx.restore();
    }
    // Cup + flag.
    const [cx, cy] = def.cup;
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.beginPath();
    ctx.arc(cx, cy, CUP_R + 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, CUP_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.5 * px;
    ctx.stroke();
    const lift = v.phase === "sunk" ? Math.min(1, v.phaseT / 20) * 8 : 0;
    const poleTop = cy - 30 - lift;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 3.5 * px;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx, poleTop);
    ctx.stroke();
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.6 * px;
    ctx.stroke();
    const wave = Math.sin(t / 160) * 2;
    ctx.fillStyle = p.accent;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5 * px;
    ctx.beginPath();
    ctx.moveTo(cx, poleTop);
    ctx.quadraticCurveTo(cx + 8, poleTop + 2 + wave, cx + 17, poleTop + 5 + wave);
    ctx.lineTo(cx, poleTop + 11);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Bumpers.
    def.bumpers.forEach((u, i) => {
      const k = Math.max(0, bumpT[i] ?? 0);
      const r = u[2] * (1 + k * 0.35);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(u[0], u[1], r + 2 * px * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = k > 0.3 ? "#ffffff" : p.accent;
      ctx.beginPath();
      ctx.arc(u[0], u[1], r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.7)";
      ctx.lineWidth = 2 * px;
      ctx.beginPath();
      ctx.arc(u[0], u[1], r * 0.55, 0, Math.PI * 2);
      ctx.stroke();
    });
    // Gates.
    for (const g of v.gates) {
      kit.block(g.x - g.w / 2, g.y - g.h / 2, g.w, g.h, p.primary, 2);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      for (let x = g.x - g.w / 2 + 4; x < g.x + g.w / 2 - 4; x += 8) ctx.fillRect(x, g.y - g.h / 2 + 2, 3, g.h - 4);
    }
    // Rotors.
    for (const r of v.rotors) {
      for (let k = 0; k < r.blades; k++) {
        const a = ((r.a + (256 * k) / r.blades) * Math.PI * 2) / 256;
        const tx = r.x + Math.cos(a) * r.len, ty = r.y + Math.sin(a) * r.len;
        ctx.lineCap = "round";
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = BLADE_T * 2 + 3 * px;
        ctx.beginPath();
        ctx.moveTo(r.x, r.y);
        ctx.lineTo(tx, ty);
        ctx.stroke();
        ctx.strokeStyle = k % 2 ? p.primary : p.accent;
        ctx.lineWidth = BLADE_T * 2;
        ctx.stroke();
      }
      ctx.lineCap = "butt";
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(r.x, r.y, HUB_R + 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.secondary;
      ctx.beginPath();
      ctx.arc(r.x, r.y, HUB_R, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(r.x - 2, r.y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawAim(v: PuttView) {
    if (v.phase !== "aim" && v.phase !== "intro") return;
    const b = v.ball;
    const a = v.aim;
    const px = 1 / cam.s;
    // Elastic band from the coin to the finger while pulling.
    if (a.active && a.dragged) {
      const wx = (a.px - cam.ox) / cam.s, wy = (a.py - cam.oy) / cam.s;
      const fx0 = a.grab ? b.x : (a.refX - cam.ox) / cam.s;
      const fy0 = a.grab ? b.y : (a.refY - cam.oy) / cam.s;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2 * px;
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.beginPath();
      ctx.moveTo(fx0, fy0);
      ctx.lineTo(wx, wy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.arc(wx, wy, 5 * px, 0, Math.PI * 2);
      ctx.fill();
    }
    const showing = a.active ? a.power : 0.25;
    const len = (30 + showing * 150) * Math.max(0.8, px * 1.1);
    const dots = Math.max(3, Math.floor(len / (8 * px)));
    const col = a.active ? (a.power > 0.85 ? p.accent : p.primary) : "rgba(255,255,255,0.45)";
    for (let i = 1; i <= dots; i++) {
      const f = i / dots;
      const x = b.x + a.dx * (BALL_R + 4 + f * len), y = b.y + a.dy * (BALL_R + 4 + f * len);
      const r = (2.6 - f * 1.2) * px * (a.active ? 1.2 : 0.9);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(x, y, r + px, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Arrow head
    const hx = b.x + a.dx * (BALL_R + 10 + len), hy = b.y + a.dy * (BALL_R + 10 + len);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(hx + a.dx * 6 * px, hy + a.dy * 6 * px);
    ctx.lineTo(hx - a.dy * 5 * px, hy + a.dx * 5 * px);
    ctx.lineTo(hx + a.dy * 5 * px, hy - a.dx * 5 * px);
    ctx.closePath();
    ctx.fill();
  }

  function drawBall(v: PuttView, dtMs: number) {
    const b = v.ball;
    const def = HOLES[v.hole];
    let scale = 1;
    let bx = b.x, by = b.y;
    if (v.phase === "sunk") {
      scale = Math.max(0, 1 - v.phaseT / 18);
      [bx, by] = def.cup;
    }
    if (v.phase === "splash") scale = Math.min(1, v.phaseT / 20);
    if (scale <= 0) return;
    // Trail
    for (let i = 0; i < trail.length; i++) {
      const q = trail[i];
      ctx.globalAlpha = (i / trail.length) * 0.35;
      ctx.fillStyle = p.primary;
      ctx.beginPath();
      ctx.arc(q.x, q.y, BALL_R * (0.4 + (0.5 * i) / trail.length), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    const sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
    spin += (sp * dtMs) / 120;
    squash = Math.max(0, squash - dtMs / 200);
    const r = BALL_R * scale * (1 + squash * 0.25);
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath();
    ctx.ellipse(bx + 2, by + 3, r, r * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(bx, by, r + 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fill();
    const s = r * 2 + 3;
    ctx.save();
    ctx.translate(bx, by);
    ctx.rotate(Math.sin(spin) * 0.35);
    const sprite = v.phase === "splash" || v.phase === "giveup" ? kit.sprites.sad : v.phase === "sunk" ? kit.sprites.happy : kit.sprites.mini;
    ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(bx, by, r - 0.8, Math.PI * 1.1, Math.PI * 1.5);
    ctx.stroke();
  }

  function drawHud(v: PuttView) {
    kit.text(`HOLE ${v.hole + 1}/${v.holes}`, 12, 16, 12, p.text, "left");
    kit.text(`PAR ${v.par}`, FIELD_W / 2, 16, 12, p.accent);
    kit.text(`${v.score}`, FIELD_W - 12, 16, 12, p.primary, "right");
    // Score card dots.
    for (let i = 0; i < v.holes; i++) {
      const x = FIELD_W / 2 - (v.holes - 1) * 13 + i * 26, y = 40;
      const done = v.cards[i] > 0 && (i < v.hole || v.phase === "sunk" || v.phase === "giveup" || v.phase === "done");
      const cur = i === v.hole && !done;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(x - 11, y - 9, 22, 18, 4);
      ctx.fill();
      ctx.fillStyle = done ? (v.cards[i] <= HOLES[i].par ? p.primary : p.secondary) : cur ? p.wall : "rgba(255,255,255,0.08)";
      ctx.beginPath();
      ctx.roundRect(x - 9.5, y - 7.5, 19, 15, 3);
      ctx.fill();
      if (done) kit.text(v.cards[i] >= MAX_STROKES ? "X" : String(v.cards[i]), x, y + 1, 10, p.ink);
      else if (cur) kit.text(String(v.strokes), x, y + 1, 10, p.text);
    }
    // Bottom: stroke counter and power meter.
    const by = FIELD_H - 44;
    kit.text(`STROKE ${v.strokes}/${MAX_STROKES}`, 12, by, 11, p.text, "left");
    const mx = 150, mw = FIELD_W - mx - 12;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(mx, by - 8, mw, 16, 5);
    ctx.fill();
    const pw = v.phase === "aim" && v.aim.active ? v.aim.power : 0;
    if (pw > 0) {
      const g = ctx.createLinearGradient(mx, 0, mx + mw, 0);
      g.addColorStop(0, p.primary);
      g.addColorStop(1, p.accent);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.roundRect(mx + 2, by - 6, (mw - 4) * pw, 12, 4);
      ctx.fill();
    }
    kit.text("POWER", mx + mw / 2, by + 1, 9, "rgba(255,255,255,0.7)");
    const hint = v.phase === "aim" && !v.aim.active
      ? "PULL BACK FROM THE COIN · OR ←/→ + HOLD SPACE"
      : v.aim.charging ? "RELEASE TO PUTT" : "";
    if (hint) kit.text(hint, FIELD_W / 2, FIELD_H - 18, 9, "rgba(255,255,255,0.75)");
  }

  function banner(lines: [string, number, string][], alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(0, FIELD_H / 2 - 50, FIELD_W, 100);
    let y = FIELD_H / 2 - (lines.length - 1) * 14;
    for (const [s, size, c] of lines) {
      kit.text(s, FIELD_W / 2, y, size, c);
      y += 28;
    }
    ctx.globalAlpha = 1;
  }

  return {
    onEvents(events: readonly GameEvent[], v: PuttView) {
      cam = v.cam;
      for (const e of events) {
        const x = e.x !== undefined ? sx(e.x) : 0, y = e.y !== undefined ? sy(e.y) : 0;
        switch (e.t) {
          case "hole":
            trail = [];
            bumpT = [];
            break;
          case "shot":
            kit.fx.burst(x, y, p.primary, 6 + Math.round((e.power as number) * 10), 60 + (e.power as number) * 120, 0);
            squash = 1;
            break;
          case "wall":
            if ((e.v as number) > 2) kit.fx.burst(x, y, "#ffffff", 4, 60, 0);
            squash = 0.6;
            break;
          case "bump":
            bumpT[e.i as number] = 1;
            kit.fx.burst(x, y, p.accent, 10, 140, 0);
            kit.fx.addShake(3);
            squash = 1;
            break;
          case "mover":
          case "knock":
            kit.fx.burst(x, y, p.secondary, 8, 110, 0);
            kit.fx.addShake(3);
            break;
          case "lip":
            if (Math.random() < 0.3) kit.fx.popup(x, y - 14, "LIP!", p.text);
            break;
          case "splash":
            kit.fx.burst(x, y, water, 26, 160, 260);
            kit.fx.burst(x, y, "#ffffff", 10, 120, 260);
            kit.fx.popup(x, y - 16, "SPLASH +1", p.text);
            kit.fx.addShake(5);
            trail = [];
            break;
          case "sunk": {
            const ace = e.ace as boolean;
            kit.fx.burst(x, y, p.primary, ace ? 40 : 22, ace ? 240 : 170, 200);
            kit.fx.burst(x, y, p.accent, ace ? 30 : 12, 200, 200);
            if ((e.pts as number) > 0) kit.fx.popup(x, y - 22, `+${e.pts as number}`, p.primary);
            kit.fx.addShake(ace ? 7 : 3);
            if (ace) kit.fx.flash("255,255,255");
            trail = [];
            break;
          }
          case "giveup":
            kit.fx.burst(x, y, p.secondary, 14, 120, 200);
            kit.fx.addShake(4);
            break;
          case "won":
            for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * FIELD_W, FIELD_H * (0.3 + Math.random() * 0.4), p.bricks[i % p.bricks.length], 14, 220);
            break;
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      cam = v.cam;
      if (v.hole !== lastHole) {
        lastHole = v.hole;
        trail = [];
      }
      for (let i = 0; i < bumpT.length; i++) if (bumpT[i]) bumpT[i] = Math.max(0, bumpT[i] - dtMs / 250);
      if (v.phase === "roll") {
        trail.push({ x: v.ball.x, y: v.ball.y });
        if (trail.length > 10) trail.shift();
      } else if (trail.length) trail.shift();

      kit.background(dtMs);
      ctx.save();
      ctx.translate(cam.ox, cam.oy);
      ctx.scale(cam.s, cam.s);
      drawCourse(v);
      drawAim(v);
      drawBall(v, dtMs);
      ctx.restore();

      drawHud(v);

      if (v.phase === "intro") {
        const a = Math.min(1, v.phaseT / 10, (50 - v.phaseT) / 12);
        banner([[`HOLE ${v.hole + 1}`, 18, p.primary], [`${v.name} · PAR ${v.par}`, 12, p.text]], Math.max(0, a));
      } else if (v.phase === "sunk" && v.phaseT > 12) {
        const st = v.cards[v.hole];
        banner([[scoreTerm(st, v.par), 20, st <= v.par ? p.primary : p.text], [`${st} STROKE${st === 1 ? "" : "S"} · +${v.lastPts}`, 12, p.text]], Math.min(1, (v.phaseT - 12) / 10));
      } else if (v.phase === "giveup" && v.phaseT > 10) {
        banner([["OUT OF STROKES", 18, p.accent], ["ON TO THE NEXT ONE", 11, p.text]], Math.min(1, (v.phaseT - 10) / 10));
      } else if (v.phase === "done") {
        banner([["ROUND COMPLETE", 18, p.primary], [`SCORE ${v.score}`, 14, p.text]], 1);
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
