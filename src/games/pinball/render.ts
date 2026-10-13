// Moon Pinball renderer: dark themed playfield, the coin mascot as centre
// artwork, chunky bumpers/slings/flippers with ink outlines, lit ticker lanes,
// a shiny ball with a glow trail, popups, particles and shake.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  ARC, BALL_R, BUMPERS, FIELD_H, FIELD_W, GATE, LANE_X, MID_X, PLUNGER_Y, SLINGS, SPINNER, WALLS,
  type FlipperView, type PinballView,
} from "./index.ts";

function rgbOf(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<PinballView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const trails = new Map<number, { x: number; y: number }[]>();
  let t = 0;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;

  const line = (ax: number, ay: number, bx: number, by: number, w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
  };
  const disc = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  };

  function drawWalls(v: PinballView) {
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const segs: { ax: number; ay: number; bx: number; by: number; r: number }[] = WALLS.filter(
      (w) => w.kind !== "sling" && w.kind !== "kicker" && w.kind !== "plunger",
    ).slice();
    for (const x of v.lanePosts) segs.push({ ax: x, ay: v.laneTop, bx: x, by: v.laneBot, r: 3 });
    for (const s of segs) line(s.ax, s.ay, s.bx, s.by, 2 * s.r + 6, p.ink);
    for (const s of segs) line(s.ax, s.ay, s.bx, s.by, 2 * s.r + 3, p.wall);
    ctx.globalAlpha = 0.25;
    for (const s of segs) line(s.ax - 0.5, s.ay - 0.5, s.bx - 0.5, s.by - 0.5, 1, "#ffffff");
    ctx.globalAlpha = 1;
    // One-way gate at the top of the plunger lane.
    line(GATE.ax, GATE.ay, GATE.bx, GATE.by, 5, p.ink);
    line(GATE.ax, GATE.ay, GATE.bx, GATE.by, 2.5, v.gateOpen ? p.wall : p.accent);
  }

  function drawFlipper(f: FlipperView, color: string) {
    const dx = f.ex - f.px, dy = f.ey - f.py;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    const shape = (grow: number, fill: string) => {
      const r0 = f.r0 + grow, r1 = f.r1 + grow;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(f.px + nx * r0, f.py + ny * r0);
      ctx.lineTo(f.ex + nx * r1, f.ey + ny * r1);
      ctx.lineTo(f.ex - nx * r1, f.ey - ny * r1);
      ctx.lineTo(f.px - nx * r0, f.py - ny * r0);
      ctx.closePath();
      ctx.fill();
      disc(f.px, f.py, r0, fill);
      disc(f.ex, f.ey, r1, fill);
    };
    shape(2.5, p.ink);
    shape(0, color);
    // Bevel highlight on the top edge.
    const up = ny < 0 ? 1 : -1;
    ctx.globalAlpha = 0.45;
    line(f.px + nx * up * (f.r0 - 3), f.py + ny * up * (f.r0 - 3), f.ex + nx * up * (f.r1 - 2.5), f.ey + ny * up * (f.r1 - 2.5), 2, "#ffffff");
    ctx.globalAlpha = 1;
    disc(f.px, f.py, 3, p.ink);
  }

  function drawBall(x: number, y: number) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, BALL_R * 2.6);
    g.addColorStop(0, `rgba(${rgbOf(p.accent)},0.45)`);
    g.addColorStop(1, `rgba(${rgbOf(p.accent)},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - BALL_R * 3, y - BALL_R * 3, BALL_R * 6, BALL_R * 6);
    disc(x, y, BALL_R + 1.5, p.ink);
    const m = ctx.createRadialGradient(x - 3, y - 3, 1, x, y, BALL_R);
    m.addColorStop(0, "#ffffff");
    m.addColorStop(0.45, p.text);
    m.addColorStop(1, `rgba(${rgbOf(p.text)},0.55)`);
    disc(x, y, BALL_R, p.wall);
    ctx.fillStyle = m;
    ctx.beginPath();
    ctx.arc(x, y, BALL_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(x + 1.5, y + 1.5, BALL_R - 1, 0.1, Math.PI * 0.9);
    ctx.fill();
    disc(x - 3, y - 3, 2, "#ffffff");
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        const x = e.x ?? MID_X, y = e.y ?? FIELD_H / 2;
        const pts = typeof e.pts === "number" && e.pts > 0 ? `+${e.pts}` : "";
        if (e.mood) { mood = e.mood; moodT = 1600; }
        switch (e.t) {
          case "bumper":
            kit.fx.burst(x, y, (e.i as number) % 2 ? p.secondary : p.primary, 10, 160, 200);
            if (pts) kit.fx.popup(x, y - 24, pts, p.text);
            kit.fx.addShake(2);
            break;
          case "sling":
            kit.fx.burst(x, y, p.accent, 8, 140);
            if (pts) kit.fx.popup(x, y - 12, pts, p.text);
            kit.fx.addShake(1.5);
            break;
          case "lane":
            kit.fx.burst(x, y - 14, p.primary, 12, 120, 160);
            kit.fx.popup(x, y + 18, `${e.letter as string}!`, p.primary);
            break;
          case "laneAgain":
            if (pts) kit.fx.popup(x, y + 14, pts, p.text);
            break;
          case "lanesComplete":
            for (let i = 0; i < 6; i++) kit.fx.burst(MID_X - 100 + i * 40, 100, p.bricks[i % p.bricks.length], 10, 200);
            kit.fx.popup(MID_X, 160, `BONUS x${e.mult as number}`, p.primary);
            kit.fx.flash(rgbOf(p.primary));
            kit.fx.addShake(5);
            break;
          case "spinner":
            kit.fx.burst(x, y, p.accent, 6, 90, 0);
            break;
          case "loop":
            kit.fx.burst(x, y, p.primary, 16, 180);
            kit.fx.popup(x - 30, y + 10, `LOOP ${pts}`, p.primary);
            break;
          case "moonLit":
            kit.fx.popup(MID_X, 200, "MOON IS LIT!", p.accent);
            kit.fx.popup(x + 30, y, "SHOOT HERE", p.accent);
            kit.fx.flash(rgbOf(p.accent));
            break;
          case "multiball":
            kit.fx.popup(MID_X, y, "MOON BALL!", p.accent);
            for (let i = 0; i < 5; i++) kit.fx.burst(60 + i * 60, 380, p.bricks[i % p.bricks.length], 14, 240);
            kit.fx.flash(rgbOf(p.accent));
            kit.fx.addShake(6);
            break;
          case "launch":
            kit.fx.burst(LANE_X, PLUNGER_Y - 6, p.accent, 8 + Math.round((e.power as number) * 10), 120, 300);
            kit.fx.addShake(1 + (e.power as number) * 3);
            break;
          case "save":
            kit.fx.popup(MID_X, FIELD_H - 60, "SAVED!", p.primary);
            kit.fx.burst(x, FIELD_H - 20, p.primary, 14, 200);
            break;
          case "drain":
            kit.fx.flash(rgbOf(p.accent));
            kit.fx.addShake(5);
            trails.clear();
            break;
          case "tiltWarn":
            kit.fx.popup(MID_X, 360, "DANGER!", p.accent);
            break;
          case "tilt":
            kit.fx.flash(rgbOf(p.accent));
            kit.fx.addShake(8);
            break;
          case "nudge":
            kit.fx.addShake(4);
            break;
          case "unstick":
            kit.fx.addShake(3);
            kit.fx.burst(x, y, p.text, 6, 100);
            break;
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      if (moodT > 0) moodT -= dtMs;
      kit.background(dtMs);

      // Playfield glass: darken inside the cabinet outline.
      ctx.fillStyle = "rgba(0,0,0,0.28)";
      ctx.beginPath();
      ctx.moveTo(ARC[0][0], ARC[0][1]);
      for (const [x, y] of ARC) ctx.lineTo(x, y);
      ctx.lineTo(390, FIELD_H);
      ctx.lineTo(10, FIELD_H);
      ctx.closePath();
      ctx.fill();

      // Centre artwork: the mascot, big and faint, inside a moon ring.
      const pulse = v.moonLit ? 0.5 + 0.5 * Math.sin(t / 160) : 0;
      ctx.globalAlpha = 0.1 + pulse * 0.25;
      ctx.strokeStyle = p.accent;
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(MID_X, 430, 92, 0, Math.PI * 2);
      ctx.stroke();
      const sprite = moodT > 0 && mood === "happy" ? kit.sprites.happy : moodT > 0 && mood === "sad" ? kit.sprites.sad : kit.sprites.idle;
      ctx.globalAlpha = 0.2 + pulse * 0.15;
      ctx.drawImage(sprite, MID_X - 80, 350 + Math.sin(t / 900) * 3, 160, 160);
      ctx.globalAlpha = 1;

      // Bonus multiplier lights under the lanes.
      for (let m = 2; m <= 6; m++) {
        const lx = MID_X - 80 + (m - 2) * 40;
        const on = v.multiplier >= m;
        kit.block(lx - 14, 140, 28, 16, on ? p.primary : p.wall, 4);
        kit.text(`${m}X`, lx, 148.5, 8, on ? p.ink : p.bg2);
      }

      drawWalls(v);

      // Ticker rollover lanes.
      for (const l of v.lanes) {
        const cx = (l.x0 + l.x1) / 2;
        const cy = (v.laneTop + v.laneBot) / 2;
        if (l.lit) {
          ctx.shadowColor = p.primary;
          ctx.shadowBlur = 10;
        }
        disc(cx, cy, 11, p.ink);
        disc(cx, cy, 9, l.lit ? p.primary : p.bg2);
        ctx.shadowBlur = 0;
        kit.text(l.letter, cx, cy + 1, 11, l.lit ? p.ink : p.wall);
      }

      // Spinner lane: spinning plate, moon progress and the moon light.
      const sx = (SPINNER.x0 + SPINNER.x1) / 2, sy = (SPINNER.y0 + SPINNER.y1) / 2;
      const open = Math.abs(Math.sin((v.spinnerAngle * Math.PI * 2) / 256));
      line(SPINNER.x0 + 2, sy, SPINNER.x1 - 2, sy, 1.5, p.ink);
      kit.block(SPINNER.x0 + 6, sy - 2 - open * 5, SPINNER.x1 - SPINNER.x0 - 12, 4 + open * 10, p.accent, 2);
      for (let k = 0; k < 3; k++) {
        const on = v.moonLit || v.moonProgress > k;
        disc(sx, 338 + k * 16, 6, p.ink);
        disc(sx, 338 + k * 16, 4.5, on ? p.accent : p.bg2);
      }
      const moonGlow = v.moonLit ? 0.6 + 0.4 * Math.sin(t / 120) : 0.35;
      ctx.globalAlpha = moonGlow;
      disc(sx, 266, 9, p.accent);
      disc(sx + 4, 263, 7.5, p.bg2);
      ctx.globalAlpha = 1;

      // Pop bumpers.
      BUMPERS.forEach((u, i) => {
        const hit = v.bumperFlash[i] > 0;
        const ring = i % 2 ? p.secondary : p.primary;
        const r = u.r + (hit ? 2 : 0);
        if (hit) {
          ctx.shadowColor = ring;
          ctx.shadowBlur = 16;
        }
        disc(u.x, u.y + 3, r + 3, "rgba(0,0,0,0.35)");
        disc(u.x, u.y, r + 3, p.ink);
        disc(u.x, u.y, r, hit ? "#ffffff" : ring);
        ctx.shadowBlur = 0;
        disc(u.x, u.y, r - 5, p.ink);
        disc(u.x, u.y, r - 6.5, hit ? ring : p.bg2);
        disc(u.x, u.y, 4, hit ? "#ffffff" : p.accent);
        ctx.globalAlpha = 0.4;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(u.x, u.y, r - 2, Math.PI * 1.1, Math.PI * 1.5);
        ctx.stroke();
        ctx.globalAlpha = 1;
      });

      // Slingshots.
      SLINGS.forEach((s, i) => {
        const hit = v.slingFlash[i] > 0;
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(s.a[0], s.a[1]);
        ctx.lineTo(s.b[0], s.b[1]);
        ctx.lineTo(s.c[0], s.c[1]);
        ctx.closePath();
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 9;
        ctx.stroke();
        ctx.fillStyle = p.secondary;
        ctx.fill();
        ctx.strokeStyle = p.secondary;
        ctx.lineWidth = 5;
        ctx.stroke();
        line(s.a[0], s.a[1], s.c[0], s.c[1], hit ? 7 : 5, hit ? "#ffffff" : p.accent);
      });

      // Plunger.
      const rodY = PLUNGER_Y + 3 + v.plunger.charge * 22;
      kit.block(LANE_X - 8, rodY, 16, FIELD_H - rodY + 4, p.wall, 3);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let k = 0; k <= 6; k++) ctx.lineTo(LANE_X + (k % 2 ? 5 : -5), rodY + 6 + ((FIELD_H - rodY - 8) * k) / 6);
      ctx.stroke();
      if (v.plunger.charge > 0) {
        ctx.fillStyle = p.accent;
        ctx.fillRect(364, PLUNGER_Y - 4 - v.plunger.charge * 60, 3, v.plunger.charge * 60);
      }

      // Flippers.
      for (const f of v.flippers) drawFlipper(f, p.primary);

      // Balls with glow trails.
      const seen = new Set<number>();
      for (const b of v.balls) {
        seen.add(b.id);
        let tr = trails.get(b.id);
        if (!tr) trails.set(b.id, (tr = []));
        tr.push({ x: b.x, y: b.y });
        if (tr.length > 10) tr.shift();
        for (let k = 0; k < tr.length - 1; k++) {
          const a = (k + 1) / tr.length;
          ctx.globalAlpha = a * 0.35;
          disc(tr[k].x, tr[k].y, BALL_R * a, p.accent);
        }
        ctx.globalAlpha = 1;
        drawBall(b.x, b.y);
      }
      for (const id of [...trails.keys()]) if (!seen.has(id)) trails.delete(id);

      // Status text.
      if (v.saveLeft > 0 && v.state === "play" && Math.floor(t / (v.saveLeft < 120 ? 120 : 260)) % 2 === 0) {
        kit.text("BALL SAVE", MID_X, 672, 10, p.primary);
      }
      if (v.multiball) kit.text("MOON BALL", MID_X, 180, 12, p.accent);
      else if (v.moonLit) kit.text("MOON LIT - SHOOT LEFT LANE", MID_X, 180, 9, p.accent);
      if (v.plunger.ready && !v.balls.some((b) => !b.inLane) && v.state === "play") {
        kit.text("HOLD DOWN / FIRE", MID_X, 660, 10, p.text);
        kit.text("RELEASE TO LAUNCH", MID_X, 674, 10, p.text);
      }
      if (v.tilted) kit.text("TILT", MID_X, 420, 40, p.accent);
      else if (v.tiltWarn) kit.text("CAREFUL!", MID_X, 420, 16, p.accent);
      if (v.state === "between") {
        kit.block(MID_X - 110, 380, 220, 70, p.bg2, 8);
        kit.text(v.ballsLeft > 0 ? `BALL ${v.ballNo - 1} OVER` : "LAST BALL OVER", MID_X, 398, 12, p.text);
        kit.text(`BONUS ${v.lastBonus.toLocaleString("en-US")}`, MID_X, 424, 14, p.primary);
      }
      kit.text(`BALL ${v.ballNo}/3`, 14, 690, 9, p.text, "left");

      kit.fx.draw(kit, dtMs);
    },
  };
}
