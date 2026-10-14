// Crate Push renderer: chunky warehouse walls, glowing wallet pads, coin
// crates that slide and light up on their pads, mascot porter. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { RENDER_SCALE, makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { FIELD_H, FIELD_W, UNDOS, layout, type CratesView } from "./index.ts";

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<CratesView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const glyph = (theme.coin.ticker || "$").charAt(0).toUpperCase();
  let t = 0;
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let bumpT = 0;
  let bumpDir = 0;
  let squash = 0;
  /** Per-crate glow level 0..1, eased toward on/off. */
  const glow: number[] = [];
  let glowMap = -1;
  let clearInfo: { gain: number; base: number; eff: number; time: number; perfect: boolean } | null = null;
  let toast = "";
  let toastT = 0;

  function circle(x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  const ease = (x: number) => 1 - (1 - x) * (1 - x);
  const fmt = (frames: number) => {
    const s = Math.ceil(frames / 60);
    return `${Math.floor(s / 60)}:${s % 60 < 10 ? "0" : ""}${s % 60}`;
  };

  function pad(x: number, y: number, s: number, lit: number) {
    const pulse = 0.5 + 0.5 * Math.sin(t / 300 + x * 0.1);
    const inset = s * 0.14;
    ctx.save();
    ctx.globalAlpha = 0.25 + 0.25 * pulse + 0.4 * lit;
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, s - inset * 2, s - inset * 2, s * 0.18);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = Math.max(1.5, s / 16);
    ctx.setLineDash([s * 0.12, s * 0.08]);
    ctx.lineDashOffset = -t / 60;
    ctx.beginPath();
    ctx.roundRect(x + inset, y + inset, s - inset * 2, s - inset * 2, s * 0.18);
    ctx.stroke();
    ctx.setLineDash([]);
    // Wallet slot.
    ctx.fillStyle = p.ink;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(x + s * 0.32, y + s * 0.47, s * 0.36, Math.max(2, s * 0.07));
    ctx.restore();
  }

  function crate(cx: number, cy: number, s: number, lit: number) {
    const size = s - 4;
    const x = cx - size / 2, y = cy - size / 2;
    if (lit > 0.01) {
      ctx.save();
      ctx.shadowColor = p.primary;
      ctx.shadowBlur = 14 * lit + 4 * lit * Math.sin(t / 150);
      ctx.fillStyle = p.primary;
      ctx.globalAlpha = 0.6 * lit;
      ctx.fillRect(x + 2, y + 2, size - 4, size - 4);
      ctx.restore();
    }
    kit.block(x, y, size, size, lit > 0.5 ? p.primary : p.secondary, Math.max(3, s / 9));
    // Plank lines.
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = Math.max(1, s / 22);
    ctx.beginPath();
    ctx.moveTo(x + 4, y + 4);
    ctx.lineTo(x + size - 4, y + size - 4);
    ctx.moveTo(x + size - 4, y + 4);
    ctx.lineTo(x + 4, y + size - 4);
    ctx.stroke();
    // Coin emblem.
    const r = size * 0.27;
    circle(cx, cy, r + 1.5, p.ink);
    circle(cx, cy, r, lit > 0.5 ? p.accent : p.primary);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(cx - r * 0.5, cy - r * 0.6, r * 0.5, Math.max(1.5, s / 18));
    ctx.font = `bold ${Math.round(r * 1.25)}px ${kit.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = p.ink;
    ctx.fillText(glyph, cx, cy + 1);
  }

  function header(v: CratesView) {
    kit.text(`LEVEL ${v.level + 1}`, 14, 18, 15, p.text, "left");
    kit.text(v.name.toUpperCase(), 14, 38, 11, p.primary, "left");
    // Clock bar.
    const frac = v.timeLimit ? v.timeLeft / v.timeLimit : 0;
    const low = v.timeLeft < 600 && v.phase === "play";
    const bx = 14, by = 52, bw = 230, bh = 9;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(bx - 1.5, by - 1.5, bw + 3, bh + 3, 5);
    ctx.fill();
    ctx.fillStyle = low && Math.floor(t / 200) % 2 ? "#ffffff" : low ? p.accent : p.primary;
    ctx.beginPath();
    ctx.roundRect(bx, by, Math.max(0, bw * frac), bh, 4);
    ctx.fill();
    kit.text(fmt(v.timeLeft), bx + bw + 8, by + 5, 11, low ? p.accent : p.text, "left");
    // Undo pips.
    kit.text("UNDO", 346, 16, 10, p.text, "right");
    for (let i = 0; i < UNDOS; i++) {
      const x = 346 - (UNDOS - 1 - i) * 13 - 4;
      circle(x, 32, 5.5, p.ink);
      circle(x, 32, 4, i < v.undos ? p.accent : p.wall);
    }
    // Push counter.
    const over = v.pushes > v.optimal && v.optimal > 0;
    kit.text(`PUSH ${v.pushes}`, 14, 74, 11, p.text, "left");
    kit.text(`BEST ${v.optimal}`, 110, 74, 11, over ? p.accent : p.primary, "left");
    kit.text(`MOVES ${v.moves}`, 346, 74, 11, p.text, "right");
  }

  return {
    onEvents(events: readonly GameEvent[], v: CratesView) {
      for (const e of events) {
        if (e.t === "pad") {
          kit.fx.burst(e.x!, e.y!, p.primary, 14, 130, 200);
          kit.fx.burst(e.x!, e.y!, p.accent, 6, 90, 200);
          kit.fx.popup(e.x!, e.y! - 18, "LOCKED", p.primary);
          squash = 1;
        } else if (e.t === "push" || e.t === "unpad") {
          squash = 1;
          kit.fx.burst(e.x!, e.y! + 10, p.wall, 3, 40, 100);
        } else if (e.t === "bump") {
          bumpT = 1;
          bumpDir = e.dir as number;
          kit.fx.addShake(2);
        } else if (e.t === "undo") {
          kit.fx.popup(e.x!, e.y! - 22, `UNDO (${e.left as number})`, p.text);
        } else if (e.t === "noUndo") {
          toast = v.undos <= 0 ? "NO UNDOS LEFT" : "NOTHING TO UNDO";
          toastT = 1200;
        } else if (e.t === "restart") {
          kit.fx.flash("255,255,255");
          kit.fx.addShake(4);
          toast = `RESTART -${e.cost as number}`;
          toastT = 1200;
          mood = "sad";
          moodT = 900;
        } else if (e.t === "stuck") {
          mood = "sad";
          moodT = 1200;
        } else if (e.t === "clear") {
          clearInfo = { gain: e.gain as number, base: e.base as number, eff: e.eff as number, time: e.time as number, perfect: !!e.perfect };
          mood = "happy";
          moodT = 1600;
          kit.fx.flash("255,255,255");
          const L = layout(v.w, v.h);
          v.crates.forEach((c, i) => {
            const cx = L.x0 + (c.cell % v.w) * L.cell + L.cell / 2;
            const cy = L.y0 + Math.floor(c.cell / v.w) * L.cell + L.cell / 2;
            kit.fx.burst(cx, cy, p.bricks[i % p.bricks.length], 18, 190);
          });
        } else if (e.t === "timeout") {
          kit.fx.addShake(6);
          kit.fx.flash();
          mood = "sad";
          moodT = 99999;
        } else if (e.t === "hurry") {
          toast = "10 SECONDS!";
          toastT = 1400;
        } else if (e.t === "won") {
          for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * kit.w, kit.h * 0.5, p.bricks[i % p.bricks.length], 14, 220);
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);
      if (moodT > 0 && (moodT -= dtMs) <= 0) mood = "idle";
      bumpT = Math.max(0, bumpT - dtMs / 160);
      squash = Math.max(0, squash - dtMs / 180);
      if (v.phase === "play") clearInfo = null;

      const L = layout(v.w, v.h);
      const s = L.cell;
      const cx = (i: number) => L.x0 + (i % v.w) * s;
      const cy = (i: number) => L.y0 + Math.floor(i / v.w) * s;
      const k = ease(v.t);

      header(v);

      // Floor + pads.
      for (let i = 0; i < v.map.length; i++) {
        const ch = v.map[i];
        if (ch === "-" || ch === "#") continue;
        const x = cx(i), y = cy(i);
        const odd = ((i % v.w) + Math.floor(i / v.w)) & 1;
        ctx.fillStyle = p.ink;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = odd ? 0.12 : 0.06;
        ctx.fillStyle = p.text;
        ctx.fillRect(x, y, s, s);
        ctx.globalAlpha = 1;
      }
      if (glowMap !== v.mapId) {
        glow.length = 0;
        glowMap = v.mapId;
      }
      const litPad = new Set(v.crates.filter((c) => c.on).map((c) => c.cell));
      for (let i = 0; i < v.map.length; i++) if (v.map[i] === ".") pad(cx(i), cy(i), s, litPad.has(i) ? 1 : 0);
      // Walls.
      for (let i = 0; i < v.map.length; i++) {
        if (v.map[i] !== "#") continue;
        kit.block(cx(i) + 0.5, cy(i) + 0.5, s - 1, s - 1, p.wall, Math.max(2, s / 8));
      }

      // Crates.
      for (const c of v.crates) {
        const g0 = glow[c.id] ?? (c.on ? 1 : 0);
        const target = c.on && k >= 0.999 ? 1 : 0;
        glow[c.id] = g0 + (target - g0) * Math.min(1, dtMs / 120);
        const x = cx(c.from) + (cx(c.cell) - cx(c.from)) * k + s / 2;
        const y = cy(c.from) + (cy(c.cell) - cy(c.from)) * k + s / 2;
        crate(x, y, s, glow[c.id]);
      }

      // Player (mascot), with a bump nudge and push squash.
      let px = cx(v.playerFrom) + (cx(v.player) - cx(v.playerFrom)) * k + s / 2;
      let py = cy(v.playerFrom) + (cy(v.player) - cy(v.playerFrom)) * k + s / 2;
      const nudge = Math.sin(bumpT * Math.PI) * s * 0.12;
      px += DX[bumpDir] * nudge;
      py += DY[bumpDir] * nudge;
      const sprite = v.phase === "over" || mood === "sad" ? kit.sprites.sad : mood === "happy" ? kit.sprites.happy : kit.sprites.mini;
      const hop = v.t < 1 ? Math.sin(v.t * Math.PI) * s * 0.08 : Math.sin(t / 400) * 0.8;
      const size = s * 1.05;
      const sq = squash * 0.12;
      const horiz = v.facing === 1 || v.facing === 3;
      const sw = size * (1 + (horiz ? -sq : sq)), sh = size * (1 + (horiz ? sq : -sq));
      ctx.save();
      ctx.translate(px, py - hop);
      if (v.facing === 3) ctx.scale(-1, 1);
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.ellipse(0, size * 0.42 + hop, size * 0.32, size * 0.1, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.drawImage(sprite, -sw / 2, -sh / 2, sw, sh);
      ctx.restore();

      // Restart ring while FIRE is held.
      if (v.restart > 0) {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(px, py, s * 0.75, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(px, py, s * 0.75, -Math.PI / 2, -Math.PI / 2 + v.restart * Math.PI * 2);
        ctx.stroke();
        kit.text("RESTART?", px, py - s * 0.75 - 12, 11, p.accent);
      }

      kit.fx.draw(kit, dtMs);

      // Footer: hints / stuck warning / toasts.
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      if (toastT > 0) {
        toastT -= dtMs;
        ctx.globalAlpha = Math.min(1, toastT / 300);
        kit.text(toast, FIELD_W / 2, 548, 14, p.accent);
        ctx.globalAlpha = 1;
      } else if (v.stuck && v.phase === "play") {
        const a = 0.6 + 0.4 * Math.sin(t / 160);
        ctx.globalAlpha = a;
        kit.text("STUCK! UNDO OR RESTART", FIELD_W / 2, 548, 14, p.accent);
        ctx.globalAlpha = 1;
      }
      kit.text("SWIPE: MOVE   TAP / X: UNDO", FIELD_W / 2, 572, 10, p.text);
      kit.text("DOUBLE-TAP / HOLD SPACE: RESTART", FIELD_W / 2, 588, 10, p.text);

      // Mascot cheer corner when clearing.
      if (v.phase === "clear" && clearInfo) {
        const a = Math.min(1, (100 - v.clearTimer) / 15);
        ctx.globalAlpha = a * 0.75;
        ctx.fillStyle = p.ink;
        ctx.fillRect(0, 200, FIELD_W, 190);
        ctx.globalAlpha = a;
        const bob = -Math.abs(Math.sin(t / 130)) * 6;
        ctx.drawImage(kit.sprites.happy, FIELD_W / 2 - 32, 208 + bob, 64, 64);
        kit.text(clearInfo.perfect ? "PERFECT PUSHES!" : "VAULT SECURED!", FIELD_W / 2, 290, 20, p.primary);
        kit.text(`LEVEL ${clearInfo.base}   PUSHES ${clearInfo.eff}   TIME ${clearInfo.time}`, FIELD_W / 2, 320, 10, p.text);
        kit.text(`+${clearInfo.gain}`, FIELD_W / 2, 352, 24, p.accent);
        ctx.globalAlpha = 1;
      } else if (v.phase === "over") {
        ctx.globalAlpha = 0.7;
        ctx.fillStyle = p.ink;
        ctx.fillRect(0, 230, FIELD_W, 120);
        ctx.globalAlpha = 1;
        kit.text("TIME UP!", FIELD_W / 2, 270, 26, p.accent);
        kit.text(`SCORE ${v.score}`, FIELD_W / 2, 310, 14, p.text);
      } else if (v.phase === "won") {
        kit.text("WAREHOUSE CLEARED!", FIELD_W / 2, 290, 20, p.primary);
      } else if (v.moves === 0 && v.level === 0 && v.timeLeft > v.timeLimit - 240) {
        kit.text("PUSH THE COIN CRATE ONTO THE PAD", FIELD_W / 2, 470, 11, p.text);
      }
    },
  };
}
