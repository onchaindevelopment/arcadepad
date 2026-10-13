// Moon Tunnel renderer: layered rock bands for the cave walls, parallax
// crystals and stars, the mascot riding a little rocket with a flame and
// smoke trail, spinning coins, wall sparks, explosion and a distance meter.
// Render-side randomness (Math.random) is fine here; the engine stays pure.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { COIN_R, COL_W, H, METRES_PER_MILESTONE, PLAYER_X, W, type CaveView, type Obstacle } from "./index.ts";

/** Mix a #rrggbb colour towards another (t = 0..1). */
function mix(a: string, b: string, t: number): string {
  const pa = parseInt(a.replace("#", "").slice(0, 6), 16);
  const pb = parseInt(b.replace("#", "").slice(0, 6), 16);
  const ch = (n: number, s: number) => (n >> s) & 255;
  const c = (s: number) => Math.round(ch(pa, s) + (ch(pb, s) - ch(pa, s)) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

interface Puff { x: number; y: number; vx: number; vy: number; life: number; max: number; size: number; fire: boolean }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<CaveView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const rockDeep = mix(p.wall, p.ink, 0.55);
  const rockMid = p.wall;
  const rockRim = mix(p.wall, p.secondary, 0.6);
  const rockLip = mix(p.secondary, "#ffffff", 0.25);
  let t = 0;
  let lastDist = 0;
  let deadAt = -1;
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let sparkT = 0;
  const puffs: Puff[] = [];

  // Parallax layers (screen-space x wraps with distance).
  const stars = Array.from({ length: 36 }, () => ({ x: Math.random() * W, y: 20 + Math.random() * (H - 40), s: Math.random() < 0.3 ? 2 : 1, ph: Math.random() * 6 }));
  const crystals = Array.from({ length: 10 }, (_, i) => ({
    x: i * 70 + Math.random() * 40,
    y: 40 + Math.random() * (H - 80),
    h: 10 + Math.random() * 18,
    c: [p.primary, p.accent, p.secondary, ...p.bricks][i % (3 + p.bricks.length)],
    far: i % 2 === 0,
  }));

  /** Deterministic per-column hash for rock speckles (stable while scrolling). */
  const hash = (k: number) => {
    let h = Math.imul(k ^ 0x27d4eb2d, 0x165667b1);
    h ^= h >>> 15;
    return (h >>> 0) / 4294967296;
  };

  function wallPath(v: CaveView, ys: number[], inset: number, edgeY: number) {
    const sx = v.col0 * COL_W - v.dist;
    ctx.beginPath();
    ctx.moveTo(sx, edgeY);
    for (let k = 0; k < ys.length; k++) ctx.lineTo(sx + k * COL_W, ys[k] + inset);
    ctx.lineTo(sx + (ys.length - 1) * COL_W, edgeY);
    ctx.closePath();
  }

  function drawWalls(v: CaveView) {
    // Ceiling: deep rock at the screen edge, mid band, light rim at the face.
    for (const [ys, dir, edge] of [[v.tops, -1, -20], [v.bots, 1, H + 20]] as const) {
      ctx.fillStyle = rockRim;
      wallPath(v, ys as number[], 0, edge);
      ctx.fill();
      ctx.fillStyle = rockMid;
      wallPath(v, ys as number[], dir * 7, edge);
      ctx.fill();
      ctx.fillStyle = rockDeep;
      wallPath(v, ys as number[], dir * 22, edge);
      ctx.fill();
      // Speckles inside the mid band.
      const sx = v.col0 * COL_W - v.dist;
      ctx.fillStyle = mix(p.wall, p.ink, 0.3);
      for (let k = 0; k < ys.length; k += 2) {
        const r = hash(v.col0 + k + (dir > 0 ? 9999 : 0));
        if (r < 0.5) continue;
        ctx.fillRect(Math.round(sx + k * COL_W + r * 6), Math.round(ys[k] + dir * (10 + r * 8)), 3, 2);
      }
      // Ink outline + lit lip along the face.
      ctx.lineJoin = "round";
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      for (let k = 0; k < ys.length; k++) ctx.lineTo(sx + k * COL_W, ys[k]);
      ctx.stroke();
      ctx.strokeStyle = rockLip;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let k = 0; k < ys.length; k++) ctx.lineTo(sx + k * COL_W, ys[k] + dir * 3);
      ctx.stroke();
    }
  }

  function drawObstacle(o: Obstacle, dist: number) {
    const x = o.x - dist;
    const top = Math.max(-10, o.top);
    const bot = Math.min(H + 10, o.bot);
    kit.block(x, top, o.w, bot - top, rockMid, 5);
    ctx.fillStyle = rockRim;
    ctx.fillRect(x + 4, top + 4, 4, Math.max(0, bot - top - 8));
    // A crystal glint so obstacles read clearly against the walls.
    ctx.fillStyle = p.accent;
    const gy = o.kind === "drip" ? bot - 9 : o.kind === "rise" ? top + 5 : (top + bot) / 2 - 2;
    ctx.fillRect(x + o.w / 2 - 2, gy, 4, 4);
  }

  function drawCoin(cx: number, cy: number, phase: number) {
    const sx = Math.max(0.15, Math.abs(Math.cos(t / 180 + phase)));
    ctx.save();
    ctx.translate(cx, cy + Math.sin(t / 260 + phase) * 1.5);
    ctx.scale(sx, 1);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_R + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.arc(0, 0, COIN_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = mix(p.primary, p.ink, 0.35);
    ctx.fillRect(-1.5, -4, 3, 8);
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(-COIN_R / 2, -COIN_R / 2, 2, 3);
    ctx.restore();
  }

  function drawRocket(v: CaveView, bob: number) {
    const tilt = Math.max(-0.35, Math.min(0.35, v.vy * 0.08));
    ctx.save();
    ctx.translate(PLAYER_X, v.y + bob);
    ctx.rotate(tilt);
    // Flame (behind the body).
    if (v.thrust) {
      const len = 12 + Math.random() * 8;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(-12, 0);
      ctx.lineTo(-12 - len, 4);
      ctx.lineTo(-12, 8);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(-12, 2);
      ctx.lineTo(-12 - len * 0.5, 4);
      ctx.lineTo(-12, 6);
      ctx.fill();
    }
    // Rider: the mascot sits on top of the rocket.
    const sprite = mood === "sad" || v.state === "dead" ? kit.sprites.sad : mood === "happy" ? kit.sprites.happy : kit.sprites.mini;
    ctx.drawImage(sprite, -10, -16, 18, 18);
    // Rocket body: fins, hull, window stripe, nose.
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(-12, -1);
    ctx.lineTo(-16, -5);
    ctx.lineTo(-7, -1);
    ctx.moveTo(-12, 9);
    ctx.lineTo(-16, 13);
    ctx.lineTo(-7, 9);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(-13, -1, 22, 10, 3);
    ctx.moveTo(8, -1);
    ctx.lineTo(16, 4);
    ctx.lineTo(8, 9);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(-11.5, 0.5, 19, 7, 2);
    ctx.moveTo(8, 0.5);
    ctx.lineTo(13.5, 4);
    ctx.lineTo(8, 7.5);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.fillRect(-8, 0.5, 3, 7);
    ctx.fillRect(7, 0.5, 2, 7);
    ctx.fillStyle = p.secondary;
    ctx.fillRect(-1, 2, 4, 3);
    ctx.restore();
  }

  function updatePuffs(v: CaveView, dtMs: number) {
    const dt = dtMs / 1000;
    const scroll = v.dist - lastDist;
    lastDist = v.dist;
    if (v.state === "flying") {
      const n = v.thrust ? 2 : Math.random() < 0.35 ? 1 : 0;
      for (let i = 0; i < n; i++) {
        puffs.push({
          x: PLAYER_X - 14,
          y: v.y + 4 + (Math.random() - 0.5) * 3,
          vx: -20 - Math.random() * 30,
          vy: (v.thrust ? 40 : 6) + (Math.random() - 0.5) * 20,
          life: 0,
          max: v.thrust ? 300 + Math.random() * 200 : 500 + Math.random() * 300,
          size: v.thrust ? 3 + Math.random() * 2 : 2 + Math.random() * 2,
          fire: v.thrust && Math.random() < 0.6,
        });
      }
    }
    for (let i = puffs.length - 1; i >= 0; i--) {
      const q = puffs[i];
      q.life += dtMs;
      if (q.life >= q.max) { puffs.splice(i, 1); continue; }
      q.x += q.vx * dt - scroll;
      q.y += q.vy * dt;
      q.vy *= 0.95;
      const a = 1 - q.life / q.max;
      const s = q.size * (q.fire ? a + 0.3 : 1 + (1 - a) * 1.5);
      ctx.globalAlpha = q.fire ? a : a * 0.45;
      ctx.fillStyle = q.fire ? (q.life < q.max * 0.3 ? "#ffffff" : p.accent) : p.text;
      ctx.fillRect(q.x - s / 2, q.y - s / 2, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function drawMeter(v: CaveView) {
    const into = v.metres % METRES_PER_MILESTONE;
    const bw = 120, bx = W - bw - 12, by = 26;
    kit.text(`${v.metres} M`, W - 12, 14, 12, p.text, "right");
    ctx.fillStyle = p.ink;
    ctx.fillRect(bx - 1, by - 1, bw + 2, 7);
    ctx.fillStyle = mix(p.wall, p.ink, 0.3);
    ctx.fillRect(bx, by, bw, 5);
    ctx.fillStyle = p.primary;
    ctx.fillRect(bx, by, Math.round((bw * into) / METRES_PER_MILESTONE), 5);
    // Coins collected.
    drawCoinIcon(14, 14);
    kit.text(`x${v.coins}`, 26, 14, 12, p.text, "left");
  }
  function drawCoinIcon(x: number, y: number) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.arc(x, y, 4.5, 0, Math.PI * 2);
    ctx.fill();
  }

  return {
    onEvents(events: readonly GameEvent[], v: CaveView) {
      for (const e of events) {
        if (e.t === "thrust") {
          kit.fx.burst(e.x!, e.y! + 4, p.accent, 4, 60, 0);
        } else if (e.t === "coin") {
          kit.fx.burst(e.x!, e.y!, p.primary, 10, 110, 200);
          kit.fx.popup(e.x!, e.y! - 12, `+${e.points as number}`, p.primary);
        } else if (e.t === "milestone") {
          mood = "happy";
          moodT = 1200;
          kit.fx.popup(W / 2, H * 0.3, `${e.metres as number} M! TO THE MOON`, p.primary);
          for (let i = 0; i < 5; i++) kit.fx.burst(W * (0.15 + i * 0.175), H * 0.3, p.bricks[i % p.bricks.length], 10, 170);
        } else if (e.t === "nearmiss") {
          kit.fx.popup(PLAYER_X + 30, v.y - 20, "CLOSE!", p.accent);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 6, 120, 300);
        } else if (e.t === "crash") {
          mood = "sad";
          moodT = 99999;
          deadAt = t;
          kit.fx.addShake(e.shake ?? 12);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.accent, 26, 230, 260);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 14, 160, 200);
          kit.fx.burst(e.x!, e.y!, rockRim, 18, 190, 420);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (moodT > 0 && (moodT -= dtMs) <= 0) mood = "idle";
      if (v.state !== "dead" && deadAt >= 0) { deadAt = -1; mood = "idle"; }
      kit.background(dtMs);

      // Parallax: stars far back, crystals in two depths.
      ctx.fillStyle = "#ffffff";
      for (const s of stars) {
        const x = (((s.x - v.dist * 0.08) % W) + W) % W;
        ctx.globalAlpha = 0.3 + 0.3 * Math.sin(t / 450 + s.ph);
        ctx.fillRect(Math.round(x), Math.round(s.y), s.s, s.s);
      }
      for (const c of crystals) {
        const span = W + 60;
        const x = (((c.x - v.dist * (c.far ? 0.2 : 0.4)) % span) + span) % span - 30;
        ctx.globalAlpha = c.far ? 0.18 : 0.3;
        ctx.fillStyle = c.c;
        ctx.beginPath();
        ctx.moveTo(x, c.y - c.h);
        ctx.lineTo(x + c.h * 0.35, c.y);
        ctx.lineTo(x, c.y + c.h * 0.5);
        ctx.lineTo(x - c.h * 0.35, c.y);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      for (const o of v.obstacles) drawObstacle(o, v.dist);
      drawWalls(v);
      for (const c of v.coinList) {
        const x = c.x - v.dist;
        if (x > -10 && x < W + 10) drawCoin(x, c.y, c.id * 0.7);
      }

      updatePuffs(v, dtMs);

      // Sparks scraping the walls.
      sparkT -= dtMs;
      if (v.state === "flying" && v.clear < 8 && sparkT <= 0) {
        sparkT = 50;
        const y = v.y + v.clearSide * (7 + v.clear);
        kit.fx.burst(PLAYER_X + (Math.random() - 0.5) * 16, y, Math.random() < 0.5 ? "#ffffff" : p.accent, 3, 140, v.clearSide * -200);
      }

      if (v.state !== "dead" || t - deadAt < 120) {
        const bob = v.state === "ready" ? Math.sin(t / 250) * 4 : 0;
        drawRocket(v, bob);
      }

      if (v.state === "ready") {
        kit.text("HOLD TO FLY", W / 2, H * 0.32, 22, p.primary);
        kit.text("HOLD SPACE / UP / TOUCH TO RISE, LET GO TO DROP", W / 2, H * 0.68, 10, p.text);
      } else {
        drawMeter(v);
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
