// Coin Chain renderer: a grooved track in the coin's colours, rolling coins
// with a symbol per colour (readable without colour), the mascot riding a
// spinning turret in the middle, a dotted aim guide, and the rug pit that
// glows as the chain gets close. Pops burst, combos flash, a loss sucks the
// whole chain into the pit.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { H, LX, LY, MUZZLE, R, TRACKS, W, aimDir, simulateShot, trackPos, type ChainView, type Coin } from "./index.ts";

interface Ring { x: number; y: number; col: number; life: number }
interface Sucked { x: number; y: number; col: number; delay: number; life: number }
interface Trail { x: number; y: number; col: number; life: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<ChainView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const colour = (i: number) => p.bricks[((i % p.bricks.length) + p.bricks.length) % p.bricks.length];
  let t = 0;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;
  let recoil = 0;
  let rings: Ring[] = [];
  let sucked: Sucked[] = [];
  let trails: Trail[] = [];
  let lostAt = -1;
  let comboBanner = 0;
  let comboN = 0;
  let swapT = 0;

  function symbol(col: number, r: number) {
    // Small ink glyph per colour index so colours stay distinguishable.
    const k = r * 0.42;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.strokeStyle = "rgba(0,0,0,0.42)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    switch (col % 6) {
      case 0: ctx.arc(0, 0, k * 0.75, 0, Math.PI * 2); ctx.fill(); break;
      case 1: ctx.moveTo(0, -k); ctx.lineTo(k, 0); ctx.lineTo(0, k); ctx.lineTo(-k, 0); ctx.closePath(); ctx.fill(); break;
      case 2: ctx.moveTo(0, -k); ctx.lineTo(k * 0.95, k * 0.75); ctx.lineTo(-k * 0.95, k * 0.75); ctx.closePath(); ctx.fill(); break;
      case 3: ctx.fillRect(-k * 0.75, -k * 0.75, k * 1.5, k * 1.5); break;
      case 4: ctx.moveTo(-k, 0); ctx.lineTo(k, 0); ctx.moveTo(0, -k); ctx.lineTo(0, k); ctx.stroke(); break;
      default: ctx.moveTo(-k * 0.8, -k * 0.8); ctx.lineTo(k * 0.8, k * 0.8); ctx.moveTo(k * 0.8, -k * 0.8); ctx.lineTo(-k * 0.8, k * 0.8); ctx.stroke(); break;
    }
  }

  function coin(x: number, y: number, col: number, rot = 0, r = R) {
    ctx.save();
    ctx.translate(x, y);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = colour(col);
    ctx.beginPath();
    ctx.arc(0, 0, r - 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.arc(0, 0, r - 1.5, 0.1 * Math.PI, 0.9 * Math.PI);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r - 4, 0, Math.PI * 2);
    ctx.stroke();
    ctx.rotate(rot);
    if (r >= 7) symbol(col, r);
    ctx.rotate(-rot);
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.beginPath();
    ctx.ellipse(-r * 0.38, -r * 0.42, r * 0.28, r * 0.15, -0.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function strokeTrack(pts: { x: number; y: number }[], width: number, style: string) {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }

  function drawTrack(v: ChainView) {
    const tr = TRACKS[v.track];
    strokeTrack(tr.pts, 30, p.ink);
    strokeTrack(tr.pts, 25, p.wall);
    ctx.globalAlpha = 0.35;
    strokeTrack(tr.pts, 15, p.bg);
    ctx.globalAlpha = 1;
    // Danger stretch: the last part of the track glows.
    const from = tr.len * 0.78;
    const dz: { x: number; y: number }[] = [];
    for (let s = from; s <= tr.len; s += 6) dz.push(trackPos(tr, s));
    dz.push(trackPos(tr, tr.len));
    ctx.globalAlpha = 0.25 + (v.danger > 0.7 ? 0.35 * (0.5 + 0.5 * Math.sin(t / 120)) : 0);
    ctx.setLineDash([4, 6]);
    strokeTrack(dz, 3, p.accent);
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
    // Rolling direction chevrons.
    ctx.fillStyle = p.text;
    ctx.globalAlpha = 0.18;
    const off = (t / 30) % 60;
    for (let s = off; s < tr.len * 0.78; s += 60) {
      const a = trackPos(tr, s), b = trackPos(tr, s + 4);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      ctx.save();
      ctx.translate(a.x, a.y);
      ctx.rotate(ang);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(-2, -4);
      ctx.lineTo(-2, 4);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function drawPit(v: ChainView) {
    const tr = TRACKS[v.track];
    const e = trackPos(tr, tr.len);
    const hot = v.danger > 0.7 ? (v.danger - 0.7) / 0.3 : 0;
    // Rug
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.sin(t / 700) * 0.05);
    const s = 25;
    ctx.fillStyle = p.ink;
    ctx.fillRect(-s - 2, -s - 2, 2 * s + 4, 2 * s + 4);
    for (let i = 0; i < 5; i++) {
      ctx.fillStyle = i % 2 ? p.secondary : p.accent;
      ctx.fillRect(-s, -s + (i * 2 * s) / 5, 2 * s, (2 * s) / 5);
    }
    // Fringe
    ctx.fillStyle = p.text;
    for (let i = -s; i <= s; i += 5) {
      ctx.fillRect(i, -s - 6, 1.5, 4);
      ctx.fillRect(i, s + 2, 1.5, 4);
    }
    // Glow when the chain is close
    if (hot > 0) {
      ctx.globalAlpha = hot * (0.4 + 0.3 * Math.sin(t / 90));
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Hole with a slow swirl
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.wall;
    ctx.lineWidth = 2;
    for (let k = 0; k < 3; k++) {
      ctx.beginPath();
      ctx.arc(0, 0, 5 + k * 3.5, t / 300 + k * 2, t / 300 + k * 2 + 2.4);
      ctx.stroke();
    }
    ctx.restore();
    kit.text("RUG", e.x, e.y - 37, 8, hot > 0 ? p.accent : p.text);
  }

  function drawAim(v: ChainView) {
    const tr = TRACKS[v.track];
    const coins: Coin[] = v.coins.map((c) => ({ id: c.id, col: c.col, s: c.s, w: c.w, hx: 0, hy: 0 }));
    const sim = simulateShot(coins, tr, v.aim);
    const d = aimDir(v.aim);
    const x0 = LX + d.dx * (MUZZLE + 14), y0 = LY + d.dy * (MUZZLE + 14);
    const len = Math.hypot(sim.x - x0, sim.y - y0);
    ctx.fillStyle = colour(v.cur);
    const phase = (t / 40) % 12;
    for (let s = phase; s < len; s += 12) {
      ctx.globalAlpha = 0.75 * (1 - s / (len + 40));
      ctx.beginPath();
      ctx.arc(x0 + d.dx * s, y0 + d.dy * s, 2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (sim.hit >= 0) {
      const c = v.coins[sim.hit];
      ctx.strokeStyle = c.col === v.cur ? p.text : colour(v.cur);
      ctx.globalAlpha = 0.6 + 0.3 * Math.sin(t / 100);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(c.x, c.y, R + 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
  }

  function drawTurret(v: ChainView) {
    const d = aimDir(v.aim);
    const ang = Math.atan2(d.dy, d.dx);
    recoil = Math.max(0, recoil - 1 / 9);
    // Base ring that turns with the aim
    ctx.save();
    ctx.translate(LX, LY);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 32, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.arc(0, 0, 30, 0, Math.PI * 2);
    ctx.fill();
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    for (let k = 0; k < 8; k++) {
      ctx.rotate(Math.PI / 4);
      ctx.fillRect(22, -2, 6, 4);
    }
    // Barrel
    const len = 20 - recoil * 6;
    ctx.fillStyle = p.ink;
    ctx.fillRect(14, -10, len + 2, 20);
    ctx.fillStyle = p.secondary;
    ctx.fillRect(15.5, -8.5, len - 1, 17);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(17, -7, len - 4, 3);
    ctx.restore();
    // Next coin rides on the back of the turret
    const sw = swapT > 0 ? swapT / 200 : 0;
    coin(LX - d.dx * 24, LY - d.dy * 24, v.next, 0, 7 + sw * 2);
    // Mascot pilot, upright
    const sprite = mood === "happy" ? kit.sprites.happy : mood === "sad" || v.over ? kit.sprites.sad : kit.sprites.idle;
    const bob = mood === "happy" ? -Math.abs(Math.sin(t / 90)) * 4 : Math.sin(t / 300) * 1.2;
    ctx.drawImage(sprite, LX - 20, LY - 22 + bob, 40, 40);
    // Loaded coin at the muzzle
    if (!v.over && !v.clearing) {
      const m = MUZZLE + 10 - recoil * 6;
      coin(LX + d.dx * m, LY + d.dy * m, v.cur, 0, R - 1 + (v.ready ? 0 : -2));
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        switch (e.t) {
          case "shot":
            recoil = 1;
            break;
          case "swap":
            swapT = 200;
            break;
          case "insert":
            kit.fx.burst(e.x!, e.y!, colour(e.col as number), 4, 60, 0);
            break;
          case "pop": {
            const cells = e.cells as { x: number; y: number; col: number }[];
            for (const c of cells) {
              rings.push({ x: c.x, y: c.y, col: c.col, life: 0 });
              kit.fx.burst(c.x, c.y, colour(c.col), 7, 140, 260);
            }
            kit.fx.addShake((e.shake as number) ?? 2);
            kit.fx.popup(e.x!, e.y! - 16, `+${e.pts as number}`, p.text);
            if ((e.n as number) >= 5) { mood = "happy"; moodT = 900; }
            break;
          }
          case "combo":
            comboN = e.combo as number;
            comboBanner = 1200;
            mood = "happy"; moodT = 1200;
            kit.fx.flash("255,255,255");
            kit.fx.popup(e.x!, e.y! - 34, `COMBO x${comboN}`, p.primary);
            break;
          case "danger":
            mood = "sad"; moodT = 900;
            kit.fx.flash();
            break;
          case "levelclear":
            mood = "happy"; moodT = 1800;
            for (let i = 0; i < 8; i++) kit.fx.burst(40 + Math.random() * (W - 80), 120 + Math.random() * 360, colour(i), 14, 220);
            kit.fx.popup(W / 2, H / 2 + 60, `CLEAR +${e.bonus as number}`, p.primary);
            break;
          case "lost": {
            mood = "sad"; moodT = 1e9;
            lostAt = t;
            kit.fx.flash();
            kit.fx.addShake(10);
            kit.fx.burst(e.x!, e.y!, p.accent, 24, 200);
            v.coins.forEach((c, i) => sucked.push({ x: c.x, y: c.y, col: c.col, delay: i * 25, life: 0 }));
            break;
          }
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);
      if (moodT > 0) { moodT -= dtMs; if (moodT <= 0) mood = null; }
      if (swapT > 0) swapT -= dtMs;
      const tr = TRACKS[v.track];

      drawTrack(v);
      drawPit(v);

      if (!v.over && !v.clearing && !v.intro) drawAim(v);

      // Chain
      if (lostAt < 0) {
        for (let i = v.coins.length - 1; i >= 0; i--) {
          const c = v.coins[i];
          const r = c.w < 1 ? R * (0.75 + 0.25 * c.w) : R;
          coin(c.x, c.y, c.col, c.s / R, r);
        }
      } else {
        // Sucked into the pit one by one.
        const e = trackPos(tr, tr.len);
        sucked = sucked.filter((q) => q.life < 500 + q.delay);
        for (const q of sucked) {
          q.life += dtMs;
          const k = Math.max(0, Math.min(1, (q.life - q.delay) / 500));
          const ease = k * k;
          coin(q.x + (e.x - q.x) * ease, q.y + (e.y - q.y) * ease, q.col, k * 8, R * (1 - 0.8 * ease));
        }
      }

      // Shot trails + shots
      for (const s of v.shots) trails.push({ x: s.x, y: s.y, col: s.col, life: 0 });
      trails = trails.filter((q) => (q.life += dtMs) < 160);
      for (const q of trails) {
        ctx.globalAlpha = 0.35 * (1 - q.life / 160);
        ctx.fillStyle = colour(q.col);
        ctx.beginPath();
        ctx.arc(q.x, q.y, R * 0.7 * (1 - q.life / 200), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      for (const s of v.shots) coin(s.x, s.y, s.col, t / 60);

      // Pop rings
      rings = rings.filter((q) => (q.life += dtMs) < 240);
      for (const q of rings) {
        const k = q.life / 240;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = colour(q.col);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(q.x, q.y, R * (1 + k * 1.2), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      drawTurret(v);

      // Top strip: level, track name, waiting coins
      kit.text(`LV ${v.level + 1} · ${tr.name.toUpperCase()}`, 8, 12, 9, p.text, "left");
      if (v.hidden > 0) kit.text(`+${v.hidden} COMING`, W - 8, 12, 9, p.text, "right");

      if (comboBanner > 0) {
        comboBanner -= dtMs;
        ctx.globalAlpha = Math.min(1, comboBanner / 300);
        kit.text(`CHAIN x${comboN}!`, LX, LY - 58, 16, p.primary);
        ctx.globalAlpha = 1;
      }
      if (v.intro && !v.clearing) {
        kit.text(tr.name.toUpperCase(), LX, LY - 62, 16, p.primary);
        kit.text("HERE THEY COME", LX, LY + 52, 10, p.text);
      }
      if (v.clearing) {
        kit.text("CHAIN BROKEN!", W / 2, H / 2 - 64, 20, p.primary);
        kit.text(`LEVEL ${v.level + 1} NEXT`, W / 2, H / 2 + 52, 11, p.text);
      }
      if (v.frame < 240 && !v.over) kit.text("AIM + TAP TO SHOOT · X SWAPS", W / 2, H - 14, 8, p.text);
      kit.fx.draw(kit, dtMs);
    },
  };
}
