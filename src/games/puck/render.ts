// Air Puck renderer: glowing air table, round mallets (yours and the grumpy Bear's), coin puck with the mascot's face.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, type Kit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { GOAL_L, GOAL_R, GOAL_W, H, MALLET_R, MID, PUCK_R, W, type PuckView } from "./index.ts";

const CREASE_R = 74;
const HOLD_WARN = 300;
const HOLD_LIMIT = 480;

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function drawMallet(kit: Kit, x: number, y: number, color: string, glow: number) {
  const { ctx } = kit;
  const p = kit.theme.palette;
  // Soft floor shadow
  ctx.globalAlpha = 0.35;
  disc(ctx, x + 3, y + 5, MALLET_R, p.ink);
  ctx.globalAlpha = 1;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8 + glow * 14;
  disc(ctx, x, y, MALLET_R + 1.5, p.ink);
  ctx.restore();
  disc(ctx, x, y, MALLET_R, color);
  // Rim bevel + dished inner ring
  ctx.strokeStyle = "rgba(255,255,255,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, MALLET_R - 3, Math.PI * 1.1, Math.PI * 1.75);
  ctx.stroke();
  disc(ctx, x, y, MALLET_R * 0.68, "rgba(0,0,0,0.22)");
  // Knob
  disc(ctx, x, y, MALLET_R * 0.46 + 1.5, p.ink);
  disc(ctx, x, y, MALLET_R * 0.46, color);
  disc(ctx, x - 3, y - 3, 3, "rgba(255,255,255,0.55)");
}

function drawBearKnob(kit: Kit, cx: number, cy: number, t: number, grump: number) {
  const { ctx } = kit;
  const p = kit.theme.palette;
  const x = cx + (grump > 0 ? Math.sin(t / 25) * 2 * Math.min(1, grump / 300) : 0);
  // Ears poke out of the mallet
  for (const s of [-1, 1]) {
    disc(ctx, x + s * 12, cy - 13, 6.5, p.ink);
    disc(ctx, x + s * 12, cy - 13, 5, p.secondary);
    disc(ctx, x + s * 12, cy - 13, 2.5, p.accent);
  }
  disc(ctx, x, cy, 13.5, p.ink);
  disc(ctx, x, cy, 12, p.secondary);
  ctx.fillStyle = "rgba(255,255,255,0.28)";
  ctx.beginPath();
  ctx.ellipse(x, cy + 5, 6.5, 4.5, 0, 0, Math.PI * 2);
  ctx.fill();
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
  ctx.fillRect(x - 2, cy + 2, 4, 3);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(x, cy + 10, 3.5, Math.PI * 1.15, Math.PI * 1.85);
  ctx.stroke();
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<PuckView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const coin = p.bricks.length > 4 ? p.bricks[4] : p.accent;
  let t = 0;
  let grump = 0;
  let banner = 0;
  let bannerAge = 0;
  let bannerText = "";
  let bannerSub = "";
  let bannerColor = p.accent;
  const goalFlash = { top: 0, bottom: 0 };
  let spin = 0;
  let trail: { x: number; y: number }[] = [];
  let rings: { x: number; y: number; r: number; life: number; color: string }[] = [];
  const glow = { player: 0, cpu: 0 };

  const showBanner = (text: string, sub: string, color: string, ms = 1300) => {
    banner = ms;
    bannerAge = 0;
    bannerText = text;
    bannerSub = sub;
    bannerColor = color;
  };

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        if (e.t === "hit") {
          const mine = e.side === "player";
          const color = mine ? p.primary : p.accent;
          const power = (e.power as number) ?? 4;
          kit.fx.burst(e.x!, e.y!, color, e.smash ? 18 : 6 + Math.round(power / 2), 70 + power * 12, 0);
          rings.push({ x: e.x!, y: e.y!, r: 4, life: 1, color });
          glow[mine ? "player" : "cpu"] = 1;
          if (e.smash) {
            kit.fx.addShake(5);
            kit.fx.burst(e.x!, e.y!, "#ffffff", 8, 260, 0);
          }
        } else if (e.t === "wall") {
          const power = (e.power as number) ?? 2;
          kit.fx.burst(e.x!, e.y!, p.secondary, Math.min(8, 2 + Math.round(power / 2)), 60 + power * 6, 0);
        } else if (e.t === "go") {
          rings.push({ x: e.x!, y: e.y!, r: PUCK_R, life: 1, color: coin });
        } else if (e.t === "goal") {
          trail = [];
          if (e.side === "player") {
            goalFlash.top = 1;
            grump = 900;
            kit.fx.addShake(6);
            kit.fx.flash("255,255,255");
            for (let i = 0; i < 3; i++) kit.fx.burst(e.x!, 8, [p.primary, coin, p.secondary][i], 14, 220, 260);
            kit.fx.popup(e.x!, 40, "+100", p.primary);
            showBanner("GOAL!", `${v.you} – ${v.bear}`, p.primary);
          } else {
            goalFlash.bottom = 1;
            kit.fx.addShake(8);
            kit.fx.flash();
            for (let i = 0; i < 3; i++) kit.fx.burst(e.x!, H - 8, [p.accent, p.secondary, coin][i], 14, 220, -260);
            showBanner("BEAR SCORES", `${v.you} – ${v.bear}`, p.accent);
          }
        } else if (e.t === "levelclear") {
          showBanner(`LEVEL ${v.level}`, "THE BEAR GETS ANGRIER", p.accent, 2000);
          for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * W, H * 0.4, p.bricks[i % p.bricks.length], 12, 220);
          kit.fx.popup(W / 2, H / 2 + 40, "+1000", coin);
        } else if (e.t === "foul") {
          kit.fx.popup(e.x!, e.y! - 24, "TOO SLOW!", p.text);
          kit.fx.burst(e.x!, e.y!, p.secondary, 10, 120, 0);
        } else if (e.t === "lost") {
          kit.fx.addShake(10);
          showBanner("GAME OVER", "THE BEAR WINS", p.accent, 4000);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      grump = Math.max(0, grump - dtMs);
      banner = Math.max(0, banner - dtMs);
      bannerAge += dtMs;
      goalFlash.top = Math.max(0, goalFlash.top - dtMs / 700);
      goalFlash.bottom = Math.max(0, goalFlash.bottom - dtMs / 700);
      glow.player = Math.max(0, glow.player - dtMs / 250);
      glow.cpu = Math.max(0, glow.cpu - dtMs / 250);
      const { ctx } = kit;
      kit.background(dtMs);

      // Table surface + air holes
      ctx.fillStyle = "rgba(255,255,255,0.04)";
      ctx.beginPath();
      ctx.roundRect(4, 4, W - 8, H - 8, 18);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.09)";
      for (let y = 22; y < H - 10; y += 20) for (let x = 20 + ((y / 20) & 1) * 10; x < W - 10; x += 20) ctx.fillRect(x, y, 1.5, 1.5);

      // Faint giant score digits
      ctx.globalAlpha = 0.12;
      kit.text(String(v.bear), W / 2, MID - 100, 110, p.accent);
      kit.text(String(v.you), W / 2, MID + 100, 110, p.primary);
      ctx.globalAlpha = 1;

      // Markings: centre line + circle, goal creases
      ctx.save();
      ctx.lineWidth = 3;
      ctx.shadowBlur = 10;
      ctx.shadowColor = p.secondary;
      ctx.strokeStyle = p.secondary;
      ctx.globalAlpha = 0.7;
      ctx.beginPath();
      ctx.moveTo(10, MID);
      ctx.lineTo(W - 10, MID);
      ctx.stroke();
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(W / 2, MID, 46, 0, Math.PI * 2);
      ctx.stroke();
      disc(ctx, W / 2, MID, 5, p.secondary);
      ctx.globalAlpha = 0.45;
      ctx.shadowColor = p.accent;
      ctx.strokeStyle = p.accent;
      ctx.beginPath();
      ctx.arc(W / 2, 0, CREASE_R, 0, Math.PI);
      ctx.stroke();
      ctx.shadowColor = p.primary;
      ctx.strokeStyle = p.primary;
      ctx.beginPath();
      ctx.arc(W / 2, H, CREASE_R, Math.PI, Math.PI * 2);
      ctx.stroke();
      ctx.restore();

      // Hold warning tint on the half that is stalling
      if (v.phase === "play" && v.hold > HOLD_WARN) {
        const k = (v.hold - HOLD_WARN) / (HOLD_LIMIT - HOLD_WARN);
        ctx.fillStyle = p.secondary;
        ctx.globalAlpha = 0.08 + 0.08 * Math.sin(t / 80) * k;
        ctx.fillRect(0, v.holdSide === "player" ? MID : 0, W, MID);
        ctx.globalAlpha = 1;
        const secs = Math.ceil((HOLD_LIMIT - v.hold) / 60);
        kit.text(String(secs), W - 24, v.holdSide === "player" ? MID + 24 : MID - 24, 16, p.text);
      }

      // Rails with glow
      ctx.save();
      ctx.shadowColor = p.secondary;
      ctx.shadowBlur = 12;
      ctx.strokeStyle = p.wall;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.roundRect(3, 3, W - 6, H - 6, 18);
      ctx.stroke();
      ctx.restore();

      // Goal slots (flare on goal)
      for (const [y, color, f] of [[0, p.accent, goalFlash.top], [H, p.primary, goalFlash.bottom]] as const) {
        ctx.save();
        ctx.shadowColor = f > 0 ? "#ffffff" : color;
        ctx.shadowBlur = 10 + f * 30;
        ctx.fillStyle = p.ink;
        ctx.fillRect(GOAL_L, y === 0 ? 0 : H - 7, GOAL_W, 7);
        ctx.fillStyle = color;
        ctx.globalAlpha = 0.6 + 0.4 * f;
        ctx.fillRect(GOAL_L + 2, y === 0 ? 0 : H - 4, GOAL_W - 4, 4);
        ctx.restore();
        disc(ctx, GOAL_L, y, 5, p.ink);
        disc(ctx, GOAL_R, y, 5, p.ink);
        disc(ctx, GOAL_L, y, 3.5, p.wall);
        disc(ctx, GOAL_R, y, 3.5, p.wall);
        if (f > 0) {
          ctx.globalAlpha = f * 0.5;
          const g = ctx.createRadialGradient(W / 2, y, 0, W / 2, y, 160);
          g.addColorStop(0, color);
          g.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = g;
          ctx.fillRect(0, y === 0 ? 0 : H - 160, W, 160);
          ctx.globalAlpha = 1;
        }
      }

      // Shock rings
      rings = rings.filter((r) => (r.life -= dtMs / 350) > 0);
      for (const r of rings) {
        r.r += dtMs * 0.09;
        ctx.globalAlpha = r.life * 0.8;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Mallets
      drawMallet(kit, v.cpu.x, v.cpu.y, p.accent, glow.cpu);
      drawBearKnob(kit, v.cpu.x, v.cpu.y, t, grump);
      drawMallet(kit, v.player.x, v.player.y, p.primary, glow.player);

      // Puck: trail, then the coin with the mascot face
      if (v.phase !== "pause") {
        const pk = v.puck;
        const speed = Math.sqrt(pk.vx * pk.vx + pk.vy * pk.vy);
        trail.push({ x: pk.x, y: pk.y });
        if (trail.length > 12) trail.shift();
        if (speed > 3) {
          for (let k = 0; k < trail.length - 1; k++) {
            const a = (k + 1) / trail.length;
            ctx.globalAlpha = a * Math.min(0.45, speed / 30);
            disc(ctx, trail[k].x, trail[k].y, PUCK_R * a, coin);
          }
          ctx.globalAlpha = 1;
        }
        spin += (pk.vx * dtMs) / 900;
        const pulse = v.phase === "ready" ? 1 + 0.08 * Math.sin(t / 90) : 1;
        const r = PUCK_R * pulse;
        ctx.globalAlpha = 0.35;
        disc(ctx, pk.x + 2, pk.y + 4, r, p.ink);
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.shadowColor = coin;
        ctx.shadowBlur = 6 + Math.min(16, speed);
        disc(ctx, pk.x, pk.y, r + 1.5, p.ink);
        ctx.restore();
        disc(ctx, pk.x, pk.y, r, coin);
        ctx.save();
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, r - 2.5, 0, Math.PI * 2);
        ctx.clip();
        disc(ctx, pk.x, pk.y, r - 2.5, p.bg2);
        ctx.translate(pk.x, pk.y);
        ctx.rotate(spin);
        const s = (r - 2.5) * 2 + 2;
        ctx.drawImage(grump > 0 ? kit.sprites.happy : kit.sprites.mini, -s / 2, -s / 2, s, s);
        ctx.restore();
        ctx.strokeStyle = "rgba(255,255,255,0.5)";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(pk.x, pk.y, r - 1, Math.PI * 1.1, Math.PI * 1.6);
        ctx.stroke();
      }

      kit.fx.draw(kit, dtMs);

      if (v.phase === "ready" && banner <= 0) {
        const blink = Math.floor(t / 300) % 2 === 0;
        if (blink) kit.text(v.puck.y > MID ? "YOUR PUCK" : "BEAR'S PUCK", W / 2, MID + (v.puck.y > MID ? 46 : -46), 13, p.text);
      }
      if (v.frame < 240 && v.score === 0 && v.you === 0 && v.bear === 0) kit.text("MOVE TO STEER YOUR MALLET", W / 2, H - 22, 10, p.text);
      if (banner > 0) {
        const pop = bannerAge < 160 ? 1 + 0.3 * (1 - bannerAge / 160) : 1;
        ctx.globalAlpha = Math.min(1, banner / 300);
        ctx.fillStyle = p.ink;
        ctx.globalAlpha *= 0.55;
        ctx.fillRect(0, MID - 34, W, 68);
        ctx.globalAlpha = Math.min(1, banner / 300);
        kit.text(bannerText, W / 2, MID - 8, 30 * pop, bannerColor);
        kit.text(bannerSub, W / 2, MID + 20, 12, p.text);
        ctx.globalAlpha = 1;
      }
    },
  };
}
