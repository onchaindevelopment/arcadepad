// Paddle Duel renderer: neon court, chunky paddles, grumpy bear CPU, mascot ball with trail.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, type Kit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BALL_R, COIN_R, CPU_Y, H, PADDLE_H, PLAYER_Y, POWER_KINDS, W, type DuelView } from "./index.ts";

const POWER_LETTER: Record<string, string> = { big: "B", multi: "M", slow: "S" };

function drawBear(kit: Kit, cx: number, cy: number, t: number, grump: number) {
  const { ctx } = kit;
  const p = kit.theme.palette;
  const wob = grump > 0 ? Math.sin(t / 30) * 2 * Math.min(1, grump / 300) : 0;
  const x = cx + wob;
  const circle = (px: number, py: number, r: number, fill: string) => {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(px, py, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(px, py, r, 0, Math.PI * 2);
    ctx.fill();
  };
  // Ears
  circle(x - 10, cy - 9, 5, p.secondary);
  circle(x + 10, cy - 9, 5, p.secondary);
  ctx.fillStyle = p.accent;
  ctx.beginPath();
  ctx.arc(x - 10, cy - 9, 2.5, 0, Math.PI * 2);
  ctx.arc(x + 10, cy - 9, 2.5, 0, Math.PI * 2);
  ctx.fill();
  // Head + muzzle
  circle(x, cy, 13, p.secondary);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(x, cy + 5, 7, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  // Eyes + angry brows
  ctx.fillStyle = p.ink;
  ctx.fillRect(x - 6, cy - 3, 3, 3);
  ctx.fillRect(x + 3, cy - 3, 3, 3);
  ctx.strokeStyle = p.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x - 9, cy - 8);
  ctx.lineTo(x - 3, cy - 5);
  ctx.moveTo(x + 9, cy - 8);
  ctx.lineTo(x + 3, cy - 5);
  ctx.stroke();
  // Nose + frown
  ctx.fillRect(x - 2, cy + 2, 4, 3);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, cy + 11, 4, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<DuelView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  let t = 0;
  let grump = 0; // ms the bear stays shaking after losing a point
  let banner = 0; // ms left on the "LEVEL n" banner
  let bannerLevel = 1;
  let trails: { x: number; y: number }[][] = [];

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        if (e.t === "paddle") {
          const color = e.side === "player" ? p.primary : p.accent;
          kit.fx.burst(e.x!, e.y!, color, e.smash ? 18 : 8, e.smash ? 220 : 130, 0);
          if (e.smash) {
            kit.fx.addShake(6);
            kit.fx.flash("255,255,255");
          }
        } else if (e.t === "wall") {
          kit.fx.burst(e.x!, e.y!, p.secondary, 4, 80, 0);
        } else if (e.t === "point") {
          if (e.side === "player") {
            grump = 600;
            kit.fx.burst(e.x!, CPU_Y, p.primary, 20, 180);
            if (e.popup) kit.fx.popup(W / 2, H / 2 - 40, e.popup as string, p.primary);
          } else {
            kit.fx.addShake(4);
            kit.fx.flash();
            kit.fx.burst(e.x!, PLAYER_Y, p.accent, 16, 160);
          }
          trails = [];
        } else if (e.t === "levelclear") {
          banner = 1800;
          bannerLevel = v.level;
          for (let i = 0; i < 6; i++) kit.fx.burst(Math.random() * W, H * 0.4, p.bricks[i % p.bricks.length], 12, 220);
          kit.fx.popup(W / 2, H / 2, "+1000", p.accent);
        } else if (e.t === "lost") {
          kit.fx.addShake(8);
          kit.fx.flash();
        } else if (e.t === "power") {
          const ki = POWER_KINDS.indexOf(e.kind as never);
          kit.fx.burst(e.x!, e.y!, p.bricks[ki % p.bricks.length], 16, 160, 0);
          kit.fx.popup(e.x!, e.y! - 14, `${String(e.kind).toUpperCase()}${e.side === "cpu" ? " (BEAR)" : ""}`, p.text);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      grump = Math.max(0, grump - dtMs);
      banner = Math.max(0, banner - dtMs);
      const { ctx } = kit;
      kit.background(dtMs);

      // Faint giant scoreboard
      ctx.globalAlpha = 0.13;
      kit.text(String(v.bear), W / 2, H / 2 - 90, 110, p.accent);
      kit.text(String(v.you), W / 2, H / 2 + 90, 110, p.primary);
      ctx.globalAlpha = 1;

      // Court: glowing border + dashed centre line
      ctx.save();
      ctx.shadowColor = p.secondary;
      ctx.shadowBlur = 10;
      ctx.strokeStyle = p.wall;
      ctx.lineWidth = 3;
      ctx.strokeRect(2, 2, W - 4, H - 4);
      ctx.strokeStyle = p.secondary;
      ctx.globalAlpha = 0.55;
      ctx.setLineDash([10, 10]);
      ctx.lineDashOffset = -t / 60;
      ctx.beginPath();
      ctx.moveTo(8, H / 2);
      ctx.lineTo(W - 8, H / 2);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
      ctx.strokeStyle = p.secondary;
      ctx.globalAlpha = 0.25;
      ctx.lineWidth = 2;
      ctx.arc(W / 2, H / 2, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Power-up coins
      for (const c of v.coins) {
        const ki = POWER_KINDS.indexOf(c.kind);
        const cy = c.y + Math.sin(t / 180 + c.x / 30) * 2;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(c.x, cy, COIN_R + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.bricks[ki % p.bricks.length];
        ctx.beginPath();
        ctx.arc(c.x, cy, COIN_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.45)";
        ctx.fillRect(c.x - 4, cy - 6, 5, 2);
        kit.text(POWER_LETTER[c.kind], c.x, cy + 1, 11, p.ink);
      }

      // Bear (behind its paddle), then paddles
      drawBear(kit, v.cpu.x, CPU_Y - 6, t, grump);
      ctx.save();
      ctx.shadowColor = p.accent;
      ctx.shadowBlur = v.cpu.big > 0 ? 14 : 6;
      kit.block(v.cpu.x - v.cpu.w / 2, CPU_Y, v.cpu.w, PADDLE_H, p.accent, 4);
      ctx.shadowColor = p.primary;
      ctx.shadowBlur = v.player.big > 0 ? 14 : 6;
      kit.block(v.player.x - v.player.w / 2, PLAYER_Y, v.player.w, PADDLE_H, p.primary, 4);
      ctx.restore();

      // Balls: trails then mascot heads
      if (trails.length !== v.balls.length) trails = v.balls.map(() => []);
      v.balls.forEach((b, i) => {
        const tr = trails[i];
        tr.push({ x: b.x, y: b.y });
        if (tr.length > 10) tr.shift();
        for (let k = 0; k < tr.length - 1; k++) {
          const a = (k + 1) / tr.length;
          ctx.globalAlpha = a * 0.35;
          ctx.fillStyle = b.owner === "player" ? p.primary : p.accent;
          ctx.beginPath();
          ctx.arc(tr[k].x, tr[k].y, BALL_R * a, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        const s = BALL_R * 2 + 6;
        ctx.drawImage(kit.sprites.mini, b.x - s / 2, b.y - s / 2, s, s);
      });

      if (v.phase === "serve" && v.server === "player") kit.text("TAP / SPACE TO SERVE", W / 2, H / 2 + 26, 12, p.text);
      if (v.rally >= 4 && v.phase === "play") kit.text(`RALLY ${v.rally}`, W - 46, H / 2 - 14, 10, p.text);
      if (banner > 0) {
        ctx.globalAlpha = Math.min(1, banner / 400);
        kit.text(`LEVEL ${bannerLevel}`, W / 2, H / 2 - 4, 28, p.accent);
        kit.text("THE BEAR GETS SHARPER", W / 2, H / 2 + 24, 11, p.text);
        ctx.globalAlpha = 1;
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
