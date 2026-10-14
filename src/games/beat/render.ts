// Beat Tiles renderer: four lanes on a scrolling beat grid, a hit line and
// pads that pulse on every quarter note, chunky tiles in the coin's brick
// colours and the mascot dancing on the pad of the last lane played.
// Client only; may use Math.random / trig freely (purely visual).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BROKEN, H, HIT_Y, HOLDING, LANE_BTNS, LANE_W, LANES, MISSED, PENDING, TILE_H, W, distPx, laneCenter, type BeatView, type Note,
} from "./index.ts";
import { BTN } from "../core/types.ts";

const PAD_Y = HIT_Y + 14;
const PAD_H = H - PAD_Y - 6;

function rgbOf(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return "255,255,255";
  const n = parseInt(m[1], 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BeatView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const laneCols = [0, 1, 2, 3].map((i) => (p.bricks.length ? p.bricks[i % p.bricks.length] : [p.primary, p.secondary, p.accent, p.primary][i]));
  const accentRgb = rgbOf(p.accent);
  const padGlow = [0, 0, 0, 0];
  let t = 0;
  let judge: { text: string; color: string; ms: number } | null = null;
  let comboPop = 0;
  let happyMs = 0;
  let banner: { text: string; ms: number } | null = null;
  let mascotX = W / 2;
  let hopMs = 0;
  let hits = 0;

  function arrow(cx: number, cy: number, dir: number, s: number, color: string) {
    // dir: 0 left, 1 down, 2 up, 3 right
    const ang = [Math.PI, Math.PI / 2, -Math.PI / 2, 0][dir];
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(s + 1.5, 1.5);
    ctx.lineTo(-s * 0.6 + 1.5, -s + 1.5);
    ctx.lineTo(-s * 0.6 + 1.5, s + 1.5);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(s, 0);
    ctx.lineTo(-s * 0.6, -s);
    ctx.lineTo(-s * 0.6, s);
    ctx.fill();
    ctx.restore();
  }

  function drawTile(n: Note, v: BeatView, blink: boolean) {
    const x = n.lane * LANE_W + 6;
    const w = LANE_W - 12;
    const headY = HIT_Y - distPx(n.six, v.beatPos);
    const col = blink ? (Math.floor(t / 90) % 2 ? p.accent : p.text) : laneCols[n.lane];
    if (n.len === 0) {
      const y = headY - TILE_H / 2;
      if (y > H || y + TILE_H < -10) return;
      kit.block(x, y, w, TILE_H, col, 6);
      ctx.drawImage(kit.sprites.mini, x + w / 2 - 10, y + TILE_H / 2 - 10, 20, 20);
      return;
    }
    const tailY = HIT_Y - distPx(n.six + n.len, v.beatPos);
    let top = tailY - 6;
    let bottom = headY + TILE_H / 2;
    if (n.state === HOLDING) bottom = Math.min(bottom, HIT_Y);
    if (bottom < -10 || top > H) return;
    top = Math.max(-10, top);
    ctx.globalAlpha = n.state === BROKEN ? 0.35 : 1;
    kit.block(x, top, w, bottom - top, col, 8);
    // Spine of the hold with beat ticks.
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x + w / 2 - 5, top + 8, 10, Math.max(0, bottom - top - 16));
    if (n.state === HOLDING) {
      const g = 0.5 + 0.5 * Math.sin(t / 60);
      ctx.fillStyle = `rgba(255,255,255,${0.35 + 0.3 * g})`;
      ctx.fillRect(x + w / 2 - 3, top + 8, 6, Math.max(0, bottom - top - 8));
    }
    if (n.state !== HOLDING) {
      // Head cap where the tap lands.
      kit.block(x + 4, headY - TILE_H / 2 + 2, w - 8, TILE_H - 4, p.text, 6);
      ctx.drawImage(kit.sprites.mini, x + w / 2 - 10, headY - 10, 20, 20);
    }
    ctx.globalAlpha = 1;
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const lane = (e.lane as number) ?? 0;
        if (e.t === "hit") {
          hits++;
          const perfect = e.judge === "perfect";
          padGlow[lane] = 1;
          hopMs = 160;
          comboPop = 1;
          kit.fx.burst(e.x!, HIT_Y, perfect ? p.text : laneCols[lane], perfect ? 16 : 9, perfect ? 170 : 120, 300);
          kit.fx.burst(e.x!, HIT_Y, laneCols[lane], 6, 90, 0);
          judge = perfect ? { text: "PERFECT", color: p.primary, ms: 520 } : { text: "GOOD", color: p.text, ms: 420 };
          if (perfect) {
            happyMs = 300;
            kit.fx.addShake(1.2);
          }
          if ((e.combo as number) % 50 === 0) {
            banner = { text: `${e.combo} COMBO!`, ms: 1300 };
            for (let i = 0; i < LANES; i++) kit.fx.burst(laneCenter(i), HIT_Y - 20, laneCols[i], 10, 200);
          }
        } else if (e.t === "holdDone") {
          padGlow[lane] = 1;
          kit.fx.burst(e.x!, HIT_Y, p.accent, 18, 190);
          kit.fx.popup(e.x!, HIT_Y - 50, `+${e.pts}`, p.accent);
          happyMs = 400;
        } else if (e.t === "break") {
          judge = { text: "BROKEN", color: p.secondary, ms: 500 };
          kit.fx.addShake(3);
        } else if (e.t === "miss" || e.t === "wrongtap") {
          judge = { text: e.t === "miss" ? "MISSED" : "WRONG LANE", color: p.accent, ms: 4000 };
          kit.fx.addShake(9);
          kit.fx.flash(accentRgb);
          kit.fx.burst(e.x!, HIT_Y - 20, p.accent, 28, 230);
        } else if (e.t === "levelup") {
          banner = { text: `SPEED UP! ${e.bpm} BPM`, ms: 1500 };
          for (let i = 0; i < 5; i++) kit.fx.burst(Math.random() * W, 120 + Math.random() * 200, p.bricks[i % Math.max(1, p.bricks.length)] ?? p.primary, 10, 160);
        }
      }
      if (v.lastLane >= 0 && events.some((e) => e.t === "hit" || e.t === "wrongtap")) hopMs = Math.max(hopMs, 160);
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);
      const q = (((v.beatPos % 4) + 4) % 4) / 4;
      const pulse = (1 - q) * (1 - q);
      const downbeat = ((v.beatPos % 16) + 16) % 16 < 4;
      const amp = downbeat ? 1 : 0.6;

      // Lanes.
      for (let i = 0; i < LANES; i++) {
        ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)";
        ctx.fillRect(i * LANE_W, 0, LANE_W, HIT_Y);
        if (padGlow[i] > 0) {
          const g = ctx.createLinearGradient(0, HIT_Y, 0, HIT_Y - 260);
          g.addColorStop(0, `rgba(${rgbOf(laneCols[i])},${0.28 * padGlow[i]})`);
          g.addColorStop(1, `rgba(${rgbOf(laneCols[i])},0)`);
          ctx.fillStyle = g;
          ctx.fillRect(i * LANE_W, HIT_Y - 260, LANE_W, 260);
        }
      }
      // Beat pulse wash from the hit line.
      const wash = ctx.createLinearGradient(0, HIT_Y, 0, HIT_Y - 340);
      wash.addColorStop(0, `rgba(${rgbOf(p.secondary)},${0.22 * pulse * amp})`);
      wash.addColorStop(1, `rgba(${rgbOf(p.secondary)},0)`);
      ctx.fillStyle = wash;
      ctx.fillRect(0, HIT_Y - 340, W, 340);
      // Beat grid: quarter lines, bar lines stronger.
      const first = Math.floor(v.beatPos / 4) * 4;
      for (let k = first; k < first + 24; k += 4) {
        const y = HIT_Y - distPx(k, v.beatPos);
        if (y < 0 || y > HIT_Y) continue;
        ctx.fillStyle = k % 16 === 0 ? "rgba(255,255,255,0.16)" : "rgba(255,255,255,0.06)";
        ctx.fillRect(0, Math.round(y), W, k % 16 === 0 ? 2 : 1);
      }
      ctx.fillStyle = p.ink;
      for (let i = 1; i < LANES; i++) ctx.fillRect(i * LANE_W - 1, 0, 2, H);

      // Tiles (furthest first so nearer tiles draw on top).
      const failNote = v.fail?.kind === "miss" ? v.notes.find((n) => n.state === MISSED) : undefined;
      for (let i = v.notes.length - 1; i >= 0; i--) {
        const n = v.notes[i];
        if (n.state === PENDING || n.state === HOLDING || n.state === BROKEN || n.state === MISSED) drawTile(n, v, n === failNote);
      }
      if (v.fail?.kind === "wrongtap") {
        ctx.fillStyle = `rgba(${accentRgb},${0.25 + 0.2 * Math.sin(t / 80)})`;
        ctx.fillRect(v.fail.lane * LANE_W, 0, LANE_W, HIT_Y);
      }

      // Hit line.
      const glow = 3 + pulse * amp * 6;
      ctx.fillStyle = `rgba(${rgbOf(p.primary)},${0.25 + 0.3 * pulse})`;
      ctx.fillRect(0, HIT_Y - glow, W, glow * 2);
      ctx.fillStyle = p.ink;
      ctx.fillRect(0, HIT_Y - 3, W, 6);
      ctx.fillStyle = p.text;
      ctx.fillRect(0, HIT_Y - 1.5, W, 3);
      for (let i = 0; i < LANES; i++) {
        const cx = laneCenter(i);
        ctx.fillStyle = laneCols[i];
        ctx.fillRect(cx - 14 - pulse * 4, HIT_Y - 1.5, 28 + pulse * 8, 3);
      }

      // Pads.
      const held = (lane: number) => (v.prevB & LANE_BTNS[lane]) !== 0 || ((v.prevB & BTN.FIRE) !== 0 && v.lastLane === lane);
      for (let i = 0; i < LANES; i++) {
        const lit = held(i) || padGlow[i] > 0.6;
        const press = lit ? 3 : 0;
        kit.block(i * LANE_W + 5, PAD_Y + press, LANE_W - 10, PAD_H - press, lit ? laneCols[i] : p.wall, 8);
        arrow(laneCenter(i) + 26, PAD_Y + PAD_H - 16 + press, i, 6, lit ? p.ink : laneCols[i]);
        padGlow[i] = Math.max(0, padGlow[i] - dtMs / 260);
      }

      // Mascot dances on the pad of the last lane played.
      const target = v.lastLane >= 0 ? laneCenter(v.lastLane) - 12 : W / 2;
      mascotX += (target - mascotX) * Math.min(1, dtMs / 70);
      hopMs = Math.max(0, hopMs - dtMs);
      happyMs = Math.max(0, happyMs - dtMs);
      const hop = Math.sin((hopMs / 160) * Math.PI) * 14;
      const bounce = pulse * amp * 5;
      const sprite = v.dead ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.idle;
      const ms = 52;
      const squash = 1 + pulse * amp * 0.08;
      ctx.drawImage(sprite, mascotX - (ms * squash) / 2, PAD_Y + PAD_H / 2 - ms / 2 - hop - bounce + 2, ms * squash, ms / squash);

      // Combo.
      comboPop = Math.max(0, comboPop - dtMs / 200);
      if (v.combo > 1) {
        ctx.globalAlpha = 0.85;
        kit.text(String(v.combo), W / 2, 150, 34 + comboPop * 10 + pulse * amp * 3, p.text);
        kit.text("COMBO", W / 2, 180, 11, p.primary);
        ctx.globalAlpha = 1;
      }
      kit.text(`${v.bpm} BPM`, W - 8, 14, 10, p.text, "right");

      // Judgement.
      if (judge) {
        judge.ms -= dtMs;
        if (judge.ms <= 0 && !v.dead) judge = null;
        else {
          const a = Math.min(1, Math.max(0.3, judge.ms / 200));
          ctx.globalAlpha = a;
          kit.text(judge.text, W / 2, HIT_Y - 60 - (1 - a) * 8, 18, judge.color);
          ctx.globalAlpha = 1;
        }
      }
      if (banner) {
        banner.ms -= dtMs;
        if (banner.ms <= 0) banner = null;
        else {
          ctx.globalAlpha = Math.min(1, banner.ms / 300);
          kit.text(banner.text, W / 2, 230, 18, p.accent);
          ctx.globalAlpha = 1;
        }
      }
      if (hits === 0 && !v.dead && v.frame < 240) {
        const a = 0.6 + 0.4 * Math.sin(t / 200);
        ctx.globalAlpha = a;
        kit.text("TAP TILES ON THE LINE", W / 2, 290, 14, p.text);
        kit.text("HOLD THE LONG ONES", W / 2, 312, 11, p.primary);
        ctx.globalAlpha = 1;
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
