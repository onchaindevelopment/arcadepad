// Pulse Run renderer: beat-pulsing backdrop, chunky tile world, spikes, pads,
// orbs and portals in the coin's palette, and the mascot drawn on a spinning
// block (or riding a little ship). Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BEAT, FIELD_H, FIELD_W, P, PLAYER_SX, ROWS, T, type PulseView } from "./index.ts";

function rgba(hex: string, a: number): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

interface Trail { x: number; y: number; life: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<PulseView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const br = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const padColor = br[4 % br.length];
  const orbColor = br[3 % br.length];
  let rot = 0;
  let trail: Trail[] = [];
  let lastLevel = -1;
  let lastNo = -1;
  let banner = 0;
  let deadAt: { x: number; y: number } | null = null;
  let squash = 0;

  const cam = (v: PulseView) => v.sim.x - PLAYER_SX;

  function drawSpike(x: number, y: number, down: boolean) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    if (!down) {
      ctx.moveTo(x + 2, y + T);
      ctx.lineTo(x + T / 2, y + 4);
      ctx.lineTo(x + T - 2, y + T);
    } else {
      ctx.moveTo(x + 2, y);
      ctx.lineTo(x + T / 2, y + T - 4);
      ctx.lineTo(x + T - 2, y);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    if (!down) {
      ctx.moveTo(x + 5, y + T - 1.5);
      ctx.lineTo(x + T / 2, y + 9);
      ctx.lineTo(x + T - 5, y + T - 1.5);
    } else {
      ctx.moveTo(x + 5, y + 1.5);
      ctx.lineTo(x + T / 2, y + T - 9);
      ctx.lineTo(x + T - 5, y + 1.5);
    }
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    if (!down) ctx.fillRect(x + T / 2 - 1, y + 12, 2, 8);
    else ctx.fillRect(x + T / 2 - 1, y + 6, 2, 8);
  }

  function drawPlayer(v: PulseView, sx: number, sy: number, dtMs: number) {
    const s = v.sim;
    const sprite = v.state === "dead" ? kit.sprites.sad : v.state === "clear" ? kit.sprites.happy : kit.sprites.mini;
    const cx = sx + P / 2, cy = sy + P / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (s.ship) {
      const ang = Math.max(-0.6, Math.min(0.6, s.vy * 0.07));
      ctx.rotate(ang);
      // Ship hull
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.moveTo(-18, 2);
      ctx.lineTo(20, 4);
      ctx.lineTo(10, 14);
      ctx.lineTo(-16, 14);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = p.secondary;
      ctx.beginPath();
      ctx.moveTo(-15, 4.5);
      ctx.lineTo(15, 6);
      ctx.lineTo(8.5, 12);
      ctx.lineTo(-13.5, 12);
      ctx.closePath();
      ctx.fill();
      ctx.drawImage(sprite, -12, -18, 24, 24);
    } else {
      const k = Math.min(1, dtMs / 16.67);
      if (s.grounded || v.state !== "play") {
        const target = Math.round(rot / (Math.PI / 2)) * (Math.PI / 2);
        rot += (target - rot) * Math.min(1, 0.45 * k * 2);
      } else {
        rot += 0.19 * s.grav * v.k * k;
      }
      const sq = 1 + squash * 0.25;
      ctx.scale(sq, 1 / sq);
      ctx.rotate(rot);
      kit.block(-P / 2, -P / 2, P, P, p.primary, 4);
      ctx.drawImage(sprite, -P / 2 + 2, -P / 2 + 2, P - 4, P - 4);
    }
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[], v: PulseView) {
      const cx = cam(v);
      for (const e of events) {
        const x = (e.x ?? 0) - cx, y = e.y ?? 0;
        if (e.t === "jump") {
          kit.fx.burst(x, y, rgba(p.text, 0.8), 5, 60, 200);
          squash = -0.6;
        } else if (e.t === "pad") {
          kit.fx.burst(x, y, padColor, 14, 160, 300);
          kit.fx.addShake(3);
          squash = -1;
        } else if (e.t === "orb") {
          kit.fx.burst(x, y, orbColor, 16, 150, 0);
          kit.fx.popup(x, y - 18, "TAP!", orbColor);
        } else if (e.t === "portal") {
          kit.fx.flash("255,255,255");
          kit.fx.burst(x, v.sim.y + P / 2, e.kind === "S" || e.kind === "C" ? p.accent : p.secondary, 20, 180, 0);
        } else if (e.t === "die") {
          deadAt = { x, y };
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(x, y, p.primary, 30, 260);
          kit.fx.burst(x, y, p.accent, 18, 200);
          kit.fx.popup(x, y - 24, `${e.progress as number}%`, p.text);
        } else if (e.t === "levelclear") {
          for (let i = 0; i < 6; i++) kit.fx.burst(80 + Math.random() * (FIELD_W - 160), FIELD_H * 0.4 + Math.random() * 80, br[i % br.length], 14, 220);
          kit.fx.popup(x, y - 30, `+${100 + (e.bonus as number)}`, p.primary);
          kit.fx.flash("255,255,255");
        }
      }
    },

    draw(v, dtMs) {
      const s = v.sim;
      if (v.levelNo !== lastNo || v.levelIdx !== lastLevel) {
        lastNo = v.levelNo;
        lastLevel = v.levelIdx;
        banner = 1600;
        trail = [];
        deadAt = null;
        rot = 0;
      }
      banner = Math.max(0, banner - dtMs);
      squash += (0 - squash) * Math.min(1, dtMs / 90);

      kit.background(dtMs);
      const cx = cam(v);
      const lvl = v.level;

      // ---- beat pulse (visual only)
      const beatPhase = (v.frame % BEAT) / BEAT;
      const pulse = Math.pow(1 - beatPhase, 3);
      const beatNo = Math.floor(v.frame / BEAT);
      ctx.fillStyle = rgba(br[beatNo % br.length], 0.08 + 0.1 * pulse);
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      // big pulsing rings behind everything
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const r = 60 + i * 90 + beatPhase * 90;
        ctx.strokeStyle = rgba(p.primary, 0.12 * (1 - (i + beatPhase) / 3));
        ctx.beginPath();
        ctx.arc(FIELD_W * 0.62, FIELD_H * 0.42, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      // equalizer bars (parallax)
      const barW = 20;
      const off = (cx * 0.3) % barW;
      for (let i = -1; i < FIELD_W / barW + 1; i++) {
        const gi = i + Math.floor((cx * 0.3) / barW);
        const hgt = 30 + ((gi * 37) % 50) + pulse * (20 + ((gi * 13) % 40));
        ctx.fillStyle = rgba(p.secondary, 0.16);
        ctx.fillRect(i * barW - off + 2, 10 * T - hgt, barW - 4, hgt);
      }

      // ---- world
      const c0 = Math.max(0, Math.floor(cx / T) - 1);
      const c1 = Math.min(lvl.cols - 1, Math.ceil((cx + FIELD_W) / T) + 1);
      for (let r = 0; r < ROWS; r++) {
        const row = lvl.rows[r];
        let c = c0;
        while (c <= c1) {
          if (row[c] !== "#") { c++; continue; }
          let e = c;
          while (e + 1 <= c1 && row[e + 1] === "#") e++;
          const x = c * T - cx;
          const w = (e - c + 1) * T;
          if (r === 11) {
            ctx.fillStyle = rgba(p.wall, 1);
            ctx.fillRect(x, r * T, w, T);
          } else {
            kit.block(x, r * T, w, T, r === 10 ? p.wall : p.secondary, 3);
            const above = r > 0 ? lvl.rows[r - 1] : "";
            // glowing top edges where you can land
            ctx.fillStyle = rgba(p.primary, 0.5 + 0.5 * pulse);
            for (let q = c; q <= e; q++) if (above[q] !== "#") ctx.fillRect(q * T - cx + 1, r * T, T - 2, 2);
          }
          c = e + 1;
        }
      }
      for (let r = 0; r < ROWS; r++) {
        for (let c = c0; c <= c1; c++) {
          const ch = lvl.rows[r][c];
          if (ch === "#" || ch === ".") continue;
          const x = c * T - cx, y = r * T;
          const used = s.used.includes(r * lvl.cols + c);
          if (ch === "^" || ch === "v") drawSpike(x, y, ch === "v");
          else if (ch === "p") {
            ctx.fillStyle = p.ink;
            ctx.beginPath();
            ctx.ellipse(x + T / 2, y + T - 1, 14, 8, 0, Math.PI, 0);
            ctx.fill();
            ctx.fillStyle = used ? rgba(padColor, 0.5) : padColor;
            ctx.beginPath();
            ctx.ellipse(x + T / 2, y + T - 1, 12, 6 + (used ? 0 : 2 * pulse), 0, Math.PI, 0);
            ctx.fill();
          } else if (ch === "o") {
            const rr = 9 + (used ? 0 : 3 * pulse);
            ctx.globalAlpha = used ? 0.35 : 1;
            ctx.fillStyle = p.ink;
            ctx.beginPath();
            ctx.arc(x + T / 2, y + T / 2, rr + 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = orbColor;
            ctx.beginPath();
            ctx.arc(x + T / 2, y + T / 2, rr, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = "rgba(255,255,255,0.6)";
            ctx.fillRect(x + T / 2 - 4, y + T / 2 - 5, 4, 3);
            ctx.strokeStyle = rgba(orbColor, 0.5);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(x + T / 2, y + T / 2, rr + 5 + 4 * (1 - pulse), 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 1;
          } else if (ch === "G" || ch === "N" || ch === "S" || ch === "C") {
            const col = ch === "G" ? p.secondary : ch === "N" ? p.primary : ch === "S" ? p.accent : br[5 % br.length];
            ctx.globalAlpha = used ? 0.45 : 1;
            ctx.lineWidth = 5;
            ctx.strokeStyle = p.ink;
            ctx.beginPath();
            ctx.ellipse(x + T / 2, y - T / 2, 11, 46, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.lineWidth = 3;
            ctx.strokeStyle = col;
            ctx.stroke();
            ctx.fillStyle = rgba(col, 0.2 + 0.15 * pulse);
            ctx.fill();
            const label = ch === "G" ? "UP" : ch === "N" ? "DN" : ch === "S" ? "FLY" : "RUN";
            kit.text(label, x + T / 2, y - T / 2, 8, p.text);
            ctx.globalAlpha = 1;
          }
        }
      }
      // finish line
      const fx = lvl.endX + P - cx;
      if (fx < FIELD_W + 20) {
        for (let r = 0; r < 10; r++) for (let q = 0; q < 2; q++) {
          ctx.fillStyle = (r + q) % 2 ? p.text : p.ink;
          ctx.fillRect(fx + q * 6, r * 30, 6, 30);
        }
      }

      // ---- player trail + player
      const sx = s.x - cx, sy = s.y;
      if (v.state === "play") trail.push({ x: s.x, y: sy, life: 260 });
      trail = trail.filter((q) => (q.life -= dtMs) > 0);
      for (const q of trail) {
        ctx.fillStyle = rgba(p.primary, (q.life / 260) * 0.35);
        const sz = 8 * (q.life / 260) + 2;
        ctx.fillRect(q.x - cx + P / 2 - sz / 2 - 8, q.y + P / 2 - sz / 2, sz, sz);
      }
      if (v.state !== "dead") drawPlayer(v, sx, sy, dtMs);
      else if (deadAt) {
        ctx.globalAlpha = 0.6;
        ctx.drawImage(kit.sprites.sad, deadAt.x - 16, deadAt.y - 16, 32, 32);
        ctx.globalAlpha = 1;
      }

      kit.fx.draw(kit, dtMs);

      // ---- HUD: progress bar
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      const bx = 120, bw = FIELD_W - 240, by = 8;
      ctx.fillStyle = p.ink;
      ctx.fillRect(bx - 2, by - 2, bw + 4, 12);
      ctx.fillStyle = rgba(p.text, 0.15);
      ctx.fillRect(bx, by, bw, 8);
      ctx.fillStyle = p.primary;
      ctx.fillRect(bx, by, (bw * v.progress) / 100, 8);
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.fillRect(bx, by, (bw * v.progress) / 100, 2);
      kit.text(`${v.progress}%`, bx + bw + 22, by + 4, 11, p.text);
      kit.text(`#${v.levelNo}`, bx - 22, by + 4, 11, p.text);

      if (v.state === "ready" || banner > 0) {
        const a = v.state === "ready" ? 1 : Math.min(1, banner / 500);
        ctx.globalAlpha = a;
        kit.text(lvl.name.toUpperCase(), FIELD_W / 2, FIELD_H * 0.3, 26, p.primary);
        const sub = v.loop > 0 ? `LOOP ${v.loop + 1} - SPEED x${v.k.toFixed(2)}` : `LEVEL ${v.levelNo}`;
        kit.text(sub, FIELD_W / 2, FIELD_H * 0.3 + 28, 12, p.text);
        if (v.state === "ready" && v.levelNo === 1) kit.text("TAP / HOLD TO JUMP", FIELD_W / 2, FIELD_H * 0.3 + 50, 12, p.accent);
        ctx.globalAlpha = 1;
      }
      if (v.state === "clear") kit.text("LEVEL CLEAR!", FIELD_W / 2, FIELD_H * 0.4, 28, p.primary);
    },
  };
}
