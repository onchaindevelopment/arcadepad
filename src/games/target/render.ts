// Coin Toss renderer: a spinning coin with the mascot embossed, chunky
// rocket pins, a pin counter column, wobble, shatter and fail flash.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CX, CY, FAIL_FRAMES, H, LAUNCH_Y, R, TURN, W, type TargetView } from "./index.ts";

const TAU = Math.PI * 2;
const PIN_LEN = 34;

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<TargetView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  let t = 0;
  let happyMs = 0;

  /** Rocket pin pointing up: tip at (0,0), tail at (0, PIN_LEN). */
  function pinPath() {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(4, 8);
    ctx.lineTo(4, 22);
    ctx.lineTo(9, 29);
    ctx.lineTo(9, PIN_LEN);
    ctx.lineTo(3, 31);
    ctx.lineTo(-3, 31);
    ctx.lineTo(-9, PIN_LEN);
    ctx.lineTo(-9, 29);
    ctx.lineTo(-4, 22);
    ctx.lineTo(-4, 8);
    ctx.closePath();
  }
  function drawPin(body: string, trim: string) {
    pinPath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.fillStyle = body;
    ctx.fill();
    // nose cone and fins in the trim colour
    ctx.fillStyle = trim;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.lineTo(3.5, 8);
    ctx.lineTo(-3.5, 8);
    ctx.closePath();
    ctx.fill();
    ctx.fillRect(-8, 29, 4, 4);
    ctx.fillRect(4, 29, 4, 4);
    // porthole
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 15, 2.6, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(-0.6, 14.4, 1.2, 0, TAU);
    ctx.fill();
    // bevel highlight
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(-3, 9, 1.5, 12);
  }
  /** Pin stuck in the disc at local angle a (disc frame already applied). */
  function stuckPin(a: number, body: string, trim: string) {
    const th = (a / TURN) * TAU;
    ctx.save();
    ctx.translate(Math.cos(th) * (R - 8), Math.sin(th) * (R - 8));
    ctx.rotate(th - Math.PI / 2);
    drawPin(body, trim);
    ctx.restore();
  }

  function drawDisc(v: TargetView) {
    const rot = (v.rot / TURN) * TAU;
    // impact wobble + level intro pop
    const wob = v.wobble < 12 ? (12 - v.wobble) / 12 : 0;
    const intro = v.phase === "play" && v.phaseT < 16 ? v.phaseT / 16 : 1;
    const scale = (0.55 + 0.45 * (1 - (1 - intro) * (1 - intro))) * (1 + 0.035 * wob);
    ctx.save();
    ctx.translate(CX, CY - wob * 5 * Math.cos(v.wobble * 1.4));
    ctx.scale(scale, scale);
    ctx.rotate(rot);

    // Pins first so the disc covers their tips.
    for (const a of v.obstacles) stuckPin(a, p.wall, p.secondary);
    for (const a of v.pins) stuckPin(a, p.text, p.accent);

    // Coin body
    const rim = v.boss ? p.accent : p.secondary;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, R + 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, R, 0, TAU);
    ctx.fill();
    // milled edge
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (R - 9), Math.sin(a) * (R - 9));
      ctx.lineTo(Math.cos(a) * (R - 1), Math.sin(a) * (R - 1));
      ctx.stroke();
    }
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, R - 9, 0, TAU);
    ctx.fill();
    const face = ctx.createRadialGradient(-R * 0.3, -R * 0.35, 4, 0, 0, R);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(0.12, p.primary);
    face.addColorStop(1, p.primary);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, R - 11, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R - 20, 0, TAU);
    ctx.stroke();

    // Embossed mascot
    const sprite = v.phase === "fail" || v.phase === "over" ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.idle;
    const s = R * 1.15;
    ctx.globalAlpha = 0.35;
    ctx.filter = "brightness(0)";
    ctx.drawImage(sprite, -s / 2 + 3, -s / 2 + 3, s, s);
    ctx.filter = "none";
    ctx.globalAlpha = 1;
    ctx.drawImage(sprite, -s / 2, -s / 2, s, s);

    // Rim coins
    for (const a of v.coins) {
      const th = (a / TURN) * TAU;
      const x = Math.cos(th) * (R - 4);
      const y = Math.sin(th) * (R - 4);
      const pulse = 1 + 0.08 * Math.sin(t / 120);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(x, y, 10 * pulse, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(x, y, 8 * pulse, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(x - 4, y - 4, 4, 2);
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - 1, y - 4, 2, 8);
      ctx.fillRect(x - 4, y - 1, 8, 2);
    }
    ctx.restore();
  }

  function drawCounter(v: TargetView) {
    const left = v.remaining + (v.flight ? 1 : 0);
    for (let i = 0; i < v.need; i++) {
      ctx.save();
      ctx.translate(22, H - 46 - i * 26);
      ctx.scale(0.6, 0.6);
      ctx.globalAlpha = i < left ? 1 : 0.22;
      drawPin(i < left ? p.text : p.wall, p.accent);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.t === "throw") {
          kit.fx.burst(CX, LAUNCH_Y + PIN_LEN, p.accent, 5, 60, 200);
        } else if (e.t === "stick") {
          kit.fx.burst(e.x!, e.y!, p.primary, 8, 110);
          kit.fx.addShake(2);
        } else if (e.t === "coin") {
          happyMs = 600;
          kit.fx.burst(e.x!, e.y!, p.accent, 16, 170);
          kit.fx.popup(e.x! + 26, e.y! + 10, `+${e.value as number}`, p.accent);
        } else if (e.t === "clear") {
          for (let i = 0; i < 18; i++) {
            const a = (i / 18) * TAU;
            const c = [p.primary, p.secondary, p.accent, p.text][i % 4];
            kit.fx.burst(CX + Math.cos(a) * R * 0.7, CY + Math.sin(a) * R * 0.7, c, 7, 230, 520);
          }
          kit.fx.addShake(6);
          kit.fx.flash("255,255,255");
          kit.fx.popup(CX, CY + 30, `+${e.bonus as number}`, p.primary);
        } else if (e.t === "fail") {
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.secondary, 18, 180);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      happyMs = Math.max(0, happyMs - dtMs);
      kit.background(dtMs);

      // Launcher pad
      kit.block(CX - 26, LAUNCH_Y + PIN_LEN + 4, 52, 12, p.wall, 4);

      if (v.phase !== "clear") drawDisc(v);

      // Pin waiting on the launcher / in flight
      if (v.phase === "play" && v.remaining > 0 && !v.flight) {
        ctx.save();
        ctx.translate(CX, LAUNCH_Y + Math.sin(t / 180) * 1.5);
        drawPin(p.text, p.accent);
        ctx.restore();
      }
      if (v.flight) {
        ctx.save();
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(CX - 2, v.flight.y + PIN_LEN, 4, 26);
        ctx.globalAlpha = 1;
        ctx.translate(CX, v.flight.y);
        drawPin(p.text, p.accent);
        ctx.restore();
      }
      // Bounced pin tumbling away
      if (v.phase === "fail" || (v.phase === "over" && v.phaseT < FAIL_FRAMES)) {
        const k = v.phaseT;
        ctx.save();
        ctx.translate(CX + k * 1.6, CY + R + 6 - k * 3 + 0.35 * k * k);
        ctx.rotate(k * 0.28);
        drawPin(p.text, p.accent);
        ctx.restore();
      }

      drawCounter(v);
      kit.text(v.boss ? "BOSS DISC" : `LEVEL ${v.level + 1}`, CX, 30, 14, v.boss ? p.accent : p.text);
      if (v.phase === "clear") kit.text(v.boss ? "BOSS DOWN!" : "CLEAR!", CX, CY, 22, p.primary);
      if (v.phase === "play" && v.level === 0 && v.pins.length === 0 && !v.flight) {
        kit.text("TAP TO THROW", CX, H - 14, 12, p.text);
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
