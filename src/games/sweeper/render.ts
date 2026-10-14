// Coin Sweeper renderer: chunky hidden tiles that flip into coins, rolled-up
// rugs with eyes, little coin flags, mascot header. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BAD_FLAG, FIELD_H, FIELD_W, FLAG, HIDDEN, LONG_PRESS, RUG_HIT, RUG_SHOWN, CLEAR_FRAMES, DEAD_FRAMES,
  type SweeperView,
} from "./index.ts";

const FLIP = 8; // frames for a tile flip

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SweeperView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const numColor = (n: number) => p.bricks[(n - 1) % p.bricks.length];
  let t = 0;
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let seen = new Uint8Array(0);
  let seenKey = "";
  let bigFlood = false;

  function circle(x: number, y: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function hiddenTile(x: number, y: number, s: number, odd: boolean) {
    kit.block(x + 0.5, y + 0.5, s - 1, s - 1, odd ? p.secondary : p.wall, Math.max(2, s / 7));
  }

  function coin(cx: number, cy: number, s: number, n: number, sx: number) {
    const r = s * 0.4;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(Math.max(0.05, sx), 1);
    if (n === 0) {
      ctx.globalAlpha = 0.35;
      circle(0, 0, r * 0.55, p.primary);
      ctx.globalAlpha = 1;
    } else {
      circle(0, 0, r + 1.5, p.ink);
      circle(0, 0, r, numColor(n));
      ctx.strokeStyle = "rgba(0,0,0,0.25)";
      ctx.lineWidth = Math.max(1, s / 16);
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.fillRect(-r * 0.5, -r * 0.62, r * 0.55, Math.max(1.5, s / 14));
      ctx.font = `bold ${Math.round(s * 0.5)}px ${kit.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = p.ink;
      ctx.fillText(String(n), 0, 1);
    }
    ctx.restore();
  }

  function flag(cx: number, cy: number, s: number, wave: number) {
    const h = s * 0.62;
    const bx = cx - s * 0.12, top = cy - h / 2, bottom = cy + h / 2;
    ctx.fillStyle = p.ink;
    ctx.fillRect(bx - 1, top, Math.max(2, s / 12), h);
    ctx.fillRect(bx - s * 0.18, bottom - 2, s * 0.4, Math.max(2, s / 12));
    // pennant
    const fw = s * 0.36, fh = s * 0.24;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(bx + 1, top - 1);
    ctx.lineTo(bx + fw + 2 + wave, top + fh / 2);
    ctx.lineTo(bx + 1, top + fh + 1);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(bx + 1.5, top + 0.5);
    ctx.lineTo(bx + fw + wave, top + fh / 2);
    ctx.lineTo(bx + 1.5, top + fh - 0.5);
    ctx.fill();
    // coin on top of the pole
    circle(bx, top - 1, Math.max(2, s * 0.1) + 1, p.ink);
    circle(bx, top - 1, Math.max(2, s * 0.1), p.primary);
  }

  function rug(cx: number, cy: number, s: number, hit: boolean, wobble: number) {
    const w = s * 0.78, h = s * 0.42;
    ctx.save();
    ctx.translate(cx, cy + wobble);
    // body of the roll
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(-w / 2 - 1, -h / 2 - 1, w + 2, h + 2, h / 2);
    ctx.fill();
    ctx.fillStyle = hit ? p.accent : p.secondary;
    ctx.beginPath();
    ctx.roundRect(-w / 2, -h / 2, w, h, h / 2);
    ctx.fill();
    // stripes
    ctx.fillStyle = hit ? p.primary : p.accent;
    for (let i = 1; i <= 3; i++) ctx.fillRect(-w / 2 + (w * i) / 4.5, -h / 2 + 1, Math.max(1.5, s / 18), h - 2);
    // spiral end
    circle(-w / 2 + h / 2, 0, h / 2 + 0.5, p.ink);
    circle(-w / 2 + h / 2, 0, h / 2 - 1, hit ? p.primary : p.wall);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = Math.max(1, s / 22);
    ctx.beginPath();
    ctx.arc(-w / 2 + h / 2, 0, h / 4, 0, Math.PI * 1.6);
    ctx.stroke();
    // eyes
    const er = Math.max(1.8, s * 0.09);
    const ex = w * 0.12;
    circle(ex - er * 1.2, -h * 0.05, er, "#ffffff");
    circle(ex + er * 1.2, -h * 0.05, er, "#ffffff");
    const look = hit ? 0 : Math.sin(t / 400 + cx) * er * 0.4;
    circle(ex - er * 1.2 + look, -h * 0.05 + (hit ? 0 : er * 0.2), er * 0.5, p.ink);
    circle(ex + er * 1.2 + look, -h * 0.05 + (hit ? 0 : er * 0.2), er * 0.5, p.ink);
    // fringe
    ctx.fillStyle = p.ink;
    for (let i = 0; i < 3; i++) ctx.fillRect(w / 2 - 1, -h / 2 + 2 + (i * (h - 4)) / 2.2, Math.max(2, s / 12), 1.2);
    ctx.restore();
  }

  function header(v: SweeperView) {
    // Mascot
    const sprite = mood === "happy" ? kit.sprites.happy : mood === "sad" ? kit.sprites.sad : kit.sprites.idle;
    const bob = mood === "happy" ? -Math.abs(Math.sin(t / 120)) * 6 : Math.sin(t / 500) * 1.5;
    ctx.drawImage(sprite, 12, 22 + bob, 64, 64);
    kit.text(`BOARD ${v.board + 1}/${v.boards}`, 92, 34, 16, p.text, "left");
    // ladder pips
    for (let i = 0; i < v.boards; i++) {
      const done = i < v.board || (i === v.board && (v.phase === "clear" || v.phase === "won"));
      const x = 96 + i * 20;
      circle(x, 58, 7, p.ink);
      circle(x, 58, 5.5, done ? p.primary : i === v.board ? p.accent : p.wall);
    }
    // Rugs left
    const left = v.rugs - v.flags;
    rug(290, 34, 30, false, 0);
    kit.text(String(left), 314, 34, 16, left < 0 ? p.accent : p.text, "left");
    // Clock
    const m = Math.floor(v.seconds / 60), s = v.seconds % 60;
    kit.text(`${m}:${s < 10 ? "0" : ""}${s}`, 348, 62, 14, p.text, "right");
  }

  return {
    onEvents(events: readonly GameEvent[], v: SweeperView) {
      for (const e of events) {
        if (e.t === "reveal") {
          const count = e.count as number;
          kit.fx.burst(e.x!, e.y!, p.primary, Math.min(24, 4 + count), 90 + Math.min(120, count * 3));
          kit.fx.popup(e.x!, e.y! - 12, `+${e.pts as number}`, p.primary);
          bigFlood = count >= 6;
          if (count >= 20) {
            kit.fx.addShake(3);
            mood = "happy";
            moodT = 700;
          }
        } else if (e.t === "flag") {
          kit.fx.burst(e.x!, e.y!, p.accent, 6, 70, 200);
        } else if (e.t === "unflag" || e.t === "bump" || e.t === "nochord") {
          kit.fx.burst(e.x!, e.y!, p.text, 3, 40, 100);
        } else if (e.t === "boom") {
          kit.fx.addShake(12);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.accent, 30, 220);
          kit.fx.burst(e.x!, e.y!, p.secondary, 20, 160);
          kit.fx.popup(e.x!, e.y! - 16, "RUGGED!", p.accent);
          mood = "sad";
          moodT = 1e9;
        } else if (e.t === "clear") {
          kit.fx.flash("255,255,255");
          for (let i = 0; i < 8; i++) kit.fx.burst(20 + Math.random() * (FIELD_W - 40), 200 + Math.random() * 300, p.bricks[i % p.bricks.length], 14, 220);
          kit.fx.popup(FIELD_W / 2, (e.y as number) + 30, `+${(e.bonus as number) + (e.timeBonus as number)}`, p.primary);
          mood = "happy";
          moodT = 2500;
        } else if (e.t === "won") {
          for (let i = 0; i < 10; i++) kit.fx.burst(Math.random() * FIELD_W, 150 + Math.random() * 400, p.bricks[i % p.bricks.length], 16, 260);
          mood = "happy";
          moodT = 1e9;
        } else if (e.t === "board") {
          mood = "idle";
        }
      }
      void v;
    },

    draw(v, dtMs) {
      t += dtMs;
      if (moodT > 0 && (moodT -= dtMs) <= 0) mood = "idle";
      kit.background(dtMs);
      const { cols, rows, cell: s, x0, y0 } = v.layout;
      const n = cols * rows;
      const key = `${v.board}:${v.generated ? 1 : 0}`;
      if (key !== seenKey || seen.length !== n) {
        seen = new Uint8Array(n);
        seenKey = key;
      }

      header(v);

      // Board frame
      kit.block(x0 - 6, y0 - 6, cols * s + 12, rows * s + 12, p.wall, 6);
      ctx.fillStyle = p.ink;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x0, y0, cols * s, rows * s);
      ctx.globalAlpha = 1;

      const f = v.frame;
      for (let i = 0; i < n; i++) {
        const c = i % cols, r = (i / cols) | 0;
        const x = x0 + c * s, y = y0 + r * s;
        const cx = x + s / 2, cy = y + s / 2;
        const st = v.vis[i];
        const odd = ((c + r) & 1) === 1;
        if (st === HIDDEN) {
          hiddenTile(x, y, s, odd);
          continue;
        }
        if (st === FLAG) {
          hiddenTile(x, y, s, odd);
          flag(cx, cy, s, Math.sin(t / 180 + i) * 1.5);
          continue;
        }
        const since = f - v.revAt[i];
        if (since < 0) {
          // waiting for the ripple (or a rug to be uncovered)
          hiddenTile(x, y, s, odd);
          if (st === BAD_FLAG) flag(cx, cy, s, 0);
          continue;
        }
        // recessed slot
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
        if (!seen[i]) {
          seen[i] = 1;
          if (bigFlood && st >= 0 && st <= 8 && Math.random() < 0.5) kit.fx.burst(cx, cy, st === 0 ? p.primary : numColor(st), 2, 50, 120);
          if (st === RUG_SHOWN) kit.fx.burst(cx, cy, p.secondary, 4, 60, 150);
        }
        const k = Math.min(1, since / FLIP);
        if (k < 0.5) {
          // old tile shrinking
          const sx = 1 - k * 2;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(Math.max(0.05, sx), 1);
          kit.block(-s / 2 + 0.5, -s / 2 + 0.5, s - 1, s - 1, odd ? p.secondary : p.wall, Math.max(2, s / 7));
          ctx.restore();
          continue;
        }
        const grow = (k - 0.5) * 2;
        const pop = 1 + Math.sin(grow * Math.PI) * 0.15;
        if (st >= 0 && st <= 8) {
          coin(cx, cy, s * pop, st, grow);
        } else if (st === RUG_HIT || st === RUG_SHOWN) {
          if (st === RUG_HIT) {
            ctx.fillStyle = p.accent;
            ctx.globalAlpha = 0.45 + 0.25 * Math.sin(t / 90);
            ctx.fillRect(x + 1, y + 1, s - 2, s - 2);
            ctx.globalAlpha = 1;
          }
          rug(cx, cy, s * pop, st === RUG_HIT, st === RUG_HIT ? Math.sin(t / 40) * 1 : 0);
        } else if (st === BAD_FLAG) {
          hiddenTile(x, y, s, odd);
          flag(cx, cy, s, 0);
          ctx.strokeStyle = p.accent;
          ctx.lineWidth = Math.max(2, s / 9);
          ctx.beginPath();
          ctx.moveTo(x + s * 0.2, y + s * 0.2);
          ctx.lineTo(x + s * 0.8, y + s * 0.8);
          ctx.moveTo(x + s * 0.8, y + s * 0.2);
          ctx.lineTo(x + s * 0.2, y + s * 0.8);
          ctx.stroke();
        }
      }

      // Cursor
      if (v.phase === "play") {
        const c = v.cursor % cols, r = (v.cursor / cols) | 0;
        ctx.strokeStyle = v.keyCursor ? p.text : "rgba(255,255,255,0.35)";
        ctx.lineWidth = v.keyCursor ? 2.5 : 1.5;
        const pad = v.keyCursor ? 1 + Math.sin(t / 150) * 0.8 : 1;
        ctx.strokeRect(x0 + c * s + pad, y0 + r * s + pad, s - pad * 2, s - pad * 2);
      }

      // Long-press ring
      if (v.holdCell >= 0 && v.hold > 4 && (v.vis[v.holdCell] === HIDDEN || v.vis[v.holdCell] === FLAG)) {
        const c = v.holdCell % cols, r = (v.holdCell / cols) | 0;
        const cx = x0 + c * s + s / 2, cy = y0 + r * s + s / 2;
        const k = Math.min(1, v.hold / LONG_PRESS);
        const rr = Math.max(s * 0.7, 18);
        ctx.lineWidth = 4;
        ctx.strokeStyle = p.ink;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 3;
        ctx.strokeStyle = p.accent;
        ctx.beginPath();
        ctx.arc(cx, cy, rr, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2);
        ctx.stroke();
      }

      // Messages
      const midY = y0 + (rows * s) / 2;
      if (!v.generated && v.phase === "play") {
        const a = 0.75 + 0.25 * Math.sin(t / 300);
        ctx.globalAlpha = a;
        kit.text("TAP A COIN TO START", FIELD_W / 2, FIELD_H - 16, 13, p.text);
        ctx.globalAlpha = 1;
      } else if (v.phase === "play") {
        ctx.globalAlpha = 0.6;
        kit.text("TAP REVEAL  ·  HOLD FLAG", FIELD_W / 2, FIELD_H - 16, 11, p.text);
        ctx.globalAlpha = 1;
      }
      if (v.phase === "clear" || v.phase === "won") {
        const k = v.phase === "won" ? 1 : Math.min(1, v.phaseT / 12);
        const fade = v.phase === "clear" ? Math.min(1, (CLEAR_FRAMES - v.phaseT) / 15) : 1;
        ctx.globalAlpha = 0.85 * fade;
        kit.block(30, midY - 54, FIELD_W - 60, 108, p.bg2, 8);
        ctx.globalAlpha = fade;
        const last = v.board + 1 >= v.boards;
        kit.text(last ? "ALL BOARDS CLEAR!" : "BOARD CLEAR!", FIELD_W / 2, midY - 26, 20 * (0.6 + 0.4 * k), p.primary);
        kit.text(`BONUS +${v.lastBonus}`, FIELD_W / 2, midY + 4, 13, p.text);
        kit.text(`TIME +${v.lastTimeBonus}`, FIELD_W / 2, midY + 26, 13, p.text);
        ctx.globalAlpha = 1;
      } else if (v.phase === "dead" || v.phase === "over") {
        const k = v.phase === "over" ? 1 : Math.min(1, v.phaseT / (DEAD_FRAMES / 3));
        ctx.globalAlpha = k;
        kit.text("RUGGED!", FIELD_W / 2, FIELD_H - 18, 20, p.accent);
        ctx.globalAlpha = 1;
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
