// Moon Sling renderer: parallax moon sky and hills in the coin's palette, a
// spring-loaded catapult cup, chunky outlined candle/chart/vault blocks that
// crack as they weaken, grumpy FUD blobs, and the coin mascot spinning
// through the air with a trail. Dust, debris, popups and shake on every hit.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CUP_X, CUP_Y, FIELD_H, FIELD_W, GROUND_Y, SHOT_R, trajectory, type BodyView, type Mat, type SlingView } from "./index.ts";

/** Small deterministic hash -> 0..1 for crack layouts. */
function h01(a: number, b: number): number {
  const n = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be5ab, 0xc2b2ae35);
  return ((n >>> 0) % 1000) / 1000;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SlingView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary];
  const matColor: Record<Mat, string> = {
    candle: p.primary,
    chart: bricks[3 % bricks.length],
    vault: p.secondary,
  };
  const cupColor = bricks[4 % bricks.length];
  const spins = new Map<number, number>();
  let trail: { x: number; y: number }[] = [];
  let t = 0;
  let par = 0; // parallax offset, eased toward the shot
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;

  const disc = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    ctx.fill();
  };
  const line = (pts: number[], w: number, color: string) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.stroke();
  };

  function hills(base: number, amp1: number, f1: number, amp2: number, f2: number, off: number, color: string, alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    for (let x = 0; x <= FIELD_W; x += 8) {
      ctx.lineTo(x, base - amp1 * Math.sin((x + off) / f1 + 1) - amp2 * Math.sin((x + off) / f2));
    }
    ctx.lineTo(FIELD_W, GROUND_Y);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  function scenery() {
    // Moon (far layer).
    const mx = 548 - par * 0.1, my = 62;
    ctx.globalAlpha = 0.15;
    disc(mx, my, 34, p.text);
    ctx.globalAlpha = 0.9;
    disc(mx, my, 24, p.text);
    ctx.globalAlpha = 0.12;
    disc(mx - 8, my - 5, 6, p.ink);
    disc(mx + 7, my + 6, 4, p.ink);
    disc(mx + 9, my - 9, 3, p.ink);
    ctx.globalAlpha = 1;
    hills(232, 26, 70, 12, 31, par * 0.25 + t * 0.002, p.secondary, 0.22);
    hills(282, 16, 52, 8, 23, par * 0.5, p.wall, 0.85);
    // Ground.
    ctx.fillStyle = p.wall;
    ctx.fillRect(0, GROUND_Y, FIELD_W, FIELD_H - GROUND_Y);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let x = ((-par * 0.9) % 24) - 24; x < FIELD_W; x += 24) ctx.fillRect(x, GROUND_Y + 10, 12, 3);
    ctx.fillStyle = p.primary;
    ctx.fillRect(0, GROUND_Y, FIELD_W, 3);
    ctx.fillStyle = p.ink;
    ctx.fillRect(0, GROUND_Y + 3, FIELD_W, 1);
  }

  function cracks(b: BodyView, x: number, y: number, w: number, h: number) {
    const dmg = 1 - b.hp / b.maxHp;
    const n = dmg > 0.66 ? 3 : dmg > 0.33 ? 2 : dmg > 0.04 ? 1 : 0;
    for (let k = 0; k < n; k++) {
      const sx = x + 2 + h01(b.id, k) * (w - 4), sy = y + 2 + h01(k, b.id) * (h - 4);
      const pts = [sx, sy];
      let cx = sx, cy = sy;
      for (let s = 0; s < 3; s++) {
        cx += (h01(b.id + s, k * 3) - 0.5) * Math.min(14, w * 0.6);
        cy += (h01(k * 5 + s, b.id) - 0.5) * Math.min(14, h * 0.6);
        cx = Math.max(x + 1.5, Math.min(x + w - 1.5, cx));
        cy = Math.max(y + 1.5, Math.min(y + h - 1.5, cy));
        pts.push(cx, cy);
      }
      line(pts, 1.2, p.ink);
    }
  }

  function drawBlock(b: BodyView) {
    const w = b.hw * 2, h = b.hh * 2, x = b.x - b.hw, y = b.y - b.hh;
    const mat = b.mat ?? "candle";
    const color = matColor[mat];
    if (mat === "chart") {
      ctx.globalAlpha = 0.78;
      kit.block(x, y, w, h, color, 2);
      ctx.globalAlpha = 0.7;
      // Little price chart etched in the pane.
      if (w >= 8 && h >= 8) {
        const pts: number[] = [];
        const steps = Math.max(3, Math.min(6, Math.floor(Math.max(w, h) / 8)));
        for (let i = 0; i <= steps; i++) {
          const fx = i / steps;
          pts.push(x + 3 + fx * (w - 6), y + h - 3 - (h - 6) * (0.2 + 0.6 * h01(b.id, i) * fx + 0.2 * fx));
        }
        line(pts, 1, "#ffffff");
      }
      ctx.globalAlpha = 1;
    } else if (mat === "candle") {
      kit.block(x, y, w, h, color, 2);
      // Grain along the long axis and a wick on upright candles.
      ctx.fillStyle = "rgba(0,0,0,0.16)";
      if (w >= h) for (let gy = y + 4; gy < y + h - 3; gy += 4) ctx.fillRect(x + 4, gy, w - 8, 1);
      else for (let gx = x + 3; gx < x + w - 2; gx += 4) ctx.fillRect(gx, y + 4, 1, h - 8);
      if (h > w * 2) {
        ctx.fillStyle = p.ink;
        ctx.fillRect(b.x - 0.75, y - 3, 1.5, 3);
      }
    } else {
      kit.block(x, y, w, h, color, 1);
      ctx.fillStyle = p.ink;
      if (w >= 12 && h >= 10) {
        for (const [rx, ry] of [[x + 4, y + 4], [x + w - 5, y + 4], [x + 4, y + h - 5], [x + w - 5, y + h - 5]]) ctx.fillRect(rx, ry, 1.5, 1.5);
      }
      if (w >= 18 && h >= 18) {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(b.x, b.y, Math.min(w, h) * 0.22, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    cracks(b, x, y, w, h);
  }

  function drawCritter(b: BodyView) {
    const r = b.r;
    const sq = b.asleep ? Math.sin(t / 260 + b.id) * 0.05 : 0;
    const rx = r * (1 + sq), ry = r * (1 - sq);
    const x = b.x, y = b.y + r * sq;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(x, y, rx + 1.5, ry + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    disc(x - r * 0.4, y - r * 0.45, r * 0.25, "#ffffff");
    ctx.globalAlpha = 1;
    // Eyes glaring at the launcher.
    for (const s of [-1, 1]) {
      const ex = x + s * r * 0.36, ey = y - r * 0.12;
      disc(ex, ey, r * 0.27, "#ffffff");
      disc(ex - r * 0.09, ey + r * 0.03, r * 0.13, p.ink);
      line([x + s * r * 0.7, ey - r * 0.42, x + s * r * 0.12, ey - r * 0.22], Math.max(1.2, r * 0.13), p.ink);
    }
    // Frown.
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = Math.max(1.2, r * 0.12);
    ctx.beginPath();
    ctx.arc(x, y + r * 0.62, r * 0.32, Math.PI * 1.2, Math.PI * 1.8);
    ctx.stroke();
    if (b.hp < b.maxHp) {
      ctx.globalAlpha = 0.8;
      disc(x + r * 0.8, y - r * 0.6, r * 0.14, "#ffffff"); // sweat drop
      ctx.globalAlpha = 1;
    }
  }

  function drawMascot(x: number, y: number, size: number, spin: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(spin);
    ctx.drawImage(kit.sprites.mini, -size / 2, -size / 2, size, size);
    ctx.restore();
  }

  function drawLauncher(v: SlingView) {
    const loaded = v.phase === "aim" && v.shotsLeft > 0;
    const cx = CUP_X + (loaded ? v.aim.pullX : 0), cy = CUP_Y + (loaded ? v.aim.pullY : 0);
    // Foot.
    kit.block(CUP_X - 20, GROUND_Y - 20, 40, 22, p.wall, 4);
    ctx.fillStyle = p.ink;
    ctx.fillRect(CUP_X - 12, GROUND_Y - 13, 24, 2);
    // Coil spring from the foot to the cup.
    const ax = CUP_X, ay = GROUND_Y - 20, bx = cx, by = cy + 14;
    const dx = bx - ax, dy = by - ay;
    const len = Math.max(1, Math.hypot(dx, dy));
    const nx = -dy / len, ny = dx / len;
    const pts: number[] = [ax, ay];
    const coils = 9;
    for (let i = 1; i < coils; i++) {
      const f = i / coils, s = i & 1 ? 6 : -6;
      pts.push(ax + dx * f + nx * s, ay + dy * f + ny * s);
    }
    pts.push(bx, by);
    line(pts, 4.5, p.ink);
    line(pts, 2, p.text);
    // Cup: back rim, mascot, front bowl.
    ctx.fillStyle = p.ink;
    ctx.fillRect(cx - 17, cy + 1, 34, 4);
    if (loaded) drawMascot(cx, cy - 2, SHOT_R * 2 + 6, 0);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 18, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = cupColor;
    ctx.beginPath();
    ctx.arc(cx, cy + 3, 15.5, 0, Math.PI);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(cx - 12, cy + 5, 24, 2);
    // Waiting launches and the mood loader.
    const queue = Math.max(0, v.shotsLeft - (loaded ? 1 : 0));
    for (let i = 0; i < Math.min(queue, 3); i++) ctx.drawImage(kit.sprites.mini, 38 + i * 13, GROUND_Y - 13, 13, 13);
    const big = moodT > 0 && mood === "happy" ? kit.sprites.happy : moodT > 0 && mood === "sad" ? kit.sprites.sad : kit.sprites.idle;
    const bob = Math.sin(t / 300) * 1;
    ctx.drawImage(big, 4, GROUND_Y - 32 + bob, 32, 32);
  }

  function drawDots(v: SlingView) {
    if (v.phase !== "aim" || v.shotsLeft <= 0 || !v.aim.valid) return;
    const pts = trajectory(v.aim.vx, v.aim.vy, 38);
    for (let i = 2; i < pts.length; i += 3) {
      const q = pts[i];
      if (q.y > GROUND_Y) break;
      const f = 1 - i / pts.length;
      ctx.globalAlpha = 0.25 + 0.6 * f;
      disc(q.x + 0.6, q.y + 0.6, 1.5 + 1.5 * f, p.ink);
      disc(q.x, q.y, 1.5 + 1.5 * f, "#ffffff");
    }
    ctx.globalAlpha = 1;
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.mood) { mood = e.mood; moodT = 1600; }
        const x = e.x ?? 0, y = e.y ?? 0;
        if (e.t === "launch") {
          kit.fx.burst(CUP_X, CUP_Y + 6, p.text, 10, 90, 200);
          kit.fx.addShake(2);
          trail = [];
        } else if (e.t === "brick") {
          kit.fx.burst(x, y, matColor[(e.mat as Mat) ?? "candle"], 5, 70);
        } else if (e.t === "brickgone") {
          const c = matColor[(e.mat as Mat) ?? "candle"];
          kit.fx.burst(x, y, c, 16, 150);
          kit.fx.burst(x, y, p.ink, 5, 110);
          kit.fx.popup(x, y - 8, `+${e.pts as number}`, p.text);
          kit.fx.addShake(3);
        } else if (e.t === "pop") {
          kit.fx.burst(x, y, p.accent, 24, 170);
          kit.fx.burst(x, y, "#ffffff", 8, 120);
          kit.fx.popup(x, y - 12, `+${e.pts as number}`, p.primary);
          kit.fx.addShake(5);
        } else if (e.t === "dust") {
          kit.fx.burst(x, y, "rgba(255,255,255,0.55)", 4, 45, 40);
        } else if (e.t === "levelclear") {
          for (let i = 0; i < 6; i++) kit.fx.burst(340 + i * 50, 140 + (i % 2) * 40, bricks[i % bricks.length], 14, 200);
          kit.fx.flash("255,255,255");
        } else if (e.t === "lost") {
          kit.fx.addShake(6);
          kit.fx.flash();
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      if (moodT > 0) moodT -= dtMs;
      const shot = v.active >= 0 ? v.bodies.find((b) => b.id === v.active) : undefined;
      const target = shot ? (shot.x - FIELD_W / 2) * 0.12 : 0;
      par += (target - par) * Math.min(1, dtMs / 250);

      kit.background(dtMs);
      scenery();
      drawLauncher(v);
      drawDots(v);

      // Trail behind the shot in flight.
      if (shot) {
        trail.push({ x: shot.x, y: shot.y });
        if (trail.length > 14) trail.shift();
      } else if (trail.length) trail.shift();
      for (let i = 0; i < trail.length; i++) {
        const f = (i + 1) / trail.length;
        ctx.globalAlpha = 0.35 * f;
        disc(trail[i].x, trail[i].y, SHOT_R * (0.4 + 0.5 * f), p.primary);
      }
      ctx.globalAlpha = 1;

      for (const b of v.bodies) if (b.kind === "block") drawBlock(b);
      for (const b of v.bodies) if (b.kind === "critter") drawCritter(b);
      for (const b of v.bodies) {
        if (b.kind !== "shot") continue;
        let s = spins.get(b.id) ?? 0;
        if (!b.asleep) s += (b.vx * dtMs) / 1000 / SHOT_R;
        spins.set(b.id, s);
        drawMascot(b.x, b.y, SHOT_R * 2 + 6, s);
      }
      if (spins.size > 64) for (const id of [...spins.keys()]) if (!v.bodies.some((b) => b.id === id)) spins.delete(id);

      kit.fx.draw(kit, dtMs);

      // Overlays.
      ctx.globalAlpha = 1;
      kit.text(`FUD x${v.critters}`, FIELD_W - 8, 14, 10, p.text, "right");
      if (v.phase === "aim" && v.levelT < 150) {
        kit.text(`LEVEL ${v.level + 1}`, FIELD_W / 2, 52, 18, p.text);
        kit.text(v.name, FIELD_W / 2, 74, 11, p.primary);
      }
      if (v.phase === "aim" && v.level === 0 && v.turn <= 1 && !v.aim.dragging) {
        kit.text("DRAG BACK FROM THE CUP - OR ARROWS + SPACE", FIELD_W / 2, FIELD_H - 12, 8, p.text);
      }
      if (v.phase === "clear") {
        kit.text("LEVEL CLEAR!", FIELD_W / 2, 70, 20, p.primary);
        if (v.bonus > 0) kit.text(`SPARE LAUNCHES +${v.bonus}`, FIELD_W / 2, 96, 11, p.text);
      } else if (v.phase === "over") {
        kit.text("OUT OF LAUNCHES", FIELD_W / 2, 80, 18, p.accent);
      }
    },
  };
}
