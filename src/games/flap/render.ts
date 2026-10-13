// Moon Flap renderer: mascot head with tilt, candlestick obstacles in the
// palette's greenest/reddest colours, parallax clouds and stars, ground strip.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BIRD_X, CANDLE_W, GROUND_Y, H, W, WICK_LEN, WICK_W, type FlapView } from "./index.ts";

function hue(hex: string): number {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return h < 0 ? h + 360 : h;
}

/** Pick the palette colour whose hue is closest to target (degrees). */
function closestHue(colors: string[], target: number, fallback: string): string {
  let best = fallback, bestD = 999;
  for (const c of colors) {
    const h = hue(c);
    if (h < 0) continue;
    const d = Math.min(Math.abs(h - target), 360 - Math.abs(h - target));
    if (d < bestD) { bestD = d; best = c; }
  }
  return best;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<FlapView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const pool = [p.primary, p.secondary, p.accent, ...p.bricks];
  const green = closestHue(pool, 125, p.primary);
  const red = closestHue(pool, 355, p.accent);
  let t = 0;

  // Fixed decorative layout (render-only randomness is fine).
  const stars = Array.from({ length: 30 }, () => ({ x: Math.random() * W, y: Math.random() * GROUND_Y * 0.7, s: Math.random() < 0.3 ? 2 : 1 }));
  const clouds = Array.from({ length: 6 }, (_, i) => ({ x: i * 90 + Math.random() * 40, y: 40 + Math.random() * 300, w: 40 + Math.random() * 50 }));

  function drawCandle(x: number, top: number, bottom: number, wickY0: number, wickY1: number, color: string) {
    const { ctx } = kit;
    // Wick (ink outline, coloured core) behind the body.
    const wx = x + (CANDLE_W - WICK_W) / 2;
    ctx.fillStyle = p.ink;
    ctx.fillRect(wx, wickY0, WICK_W, wickY1 - wickY0);
    ctx.fillStyle = color;
    ctx.fillRect(wx + 1.5, wickY0 + 1.5, WICK_W - 3, wickY1 - wickY0 - 3);
    kit.block(x, top, CANDLE_W, bottom - top, color, 4);
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.t === "flap") {
          kit.fx.burst(BIRD_X - 10, e.y! + 6, "#ffffff", 3, 50, 200);
        } else if (e.t === "score") {
          kit.fx.burst(BIRD_X + 10, e.y!, p.accent, 6, 90);
        } else if (e.t === "milestone") {
          kit.fx.popup(W / 2, GROUND_Y * 0.3, `${e.score as number}! TO THE MOON`, p.primary);
          for (let i = 0; i < 4; i++) kit.fx.burst(W * (0.2 + i * 0.2), GROUND_Y * 0.3, p.bricks[i % p.bricks.length], 10, 180);
        } else if (e.t === "hit") {
          kit.fx.addShake(e.shake ?? 10);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, red, 24, 200);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const { ctx } = kit;
      kit.background(dtMs);

      // Parallax: stars (slow), clouds (medium).
      ctx.fillStyle = "#ffffff";
      for (const s of stars) {
        const x = (((s.x - v.dist * 0.1) % W) + W) % W;
        ctx.globalAlpha = 0.35 + 0.3 * Math.sin(t / 400 + s.x);
        ctx.fillRect(Math.round(x), Math.round(s.y), s.s, s.s);
      }
      ctx.globalAlpha = 0.16;
      for (const c of clouds) {
        const span = W + 120;
        const x = (((c.x - v.dist * 0.35) % span) + span) % span - 100;
        ctx.beginPath();
        ctx.roundRect(x, c.y, c.w, 14, 7);
        ctx.roundRect(x + c.w * 0.25, c.y - 8, c.w * 0.5, 14, 7);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Candles: upper hangs from the top, lower stands on the ground.
      for (const c of v.candles) {
        const bull = (c.id & 1) === 0;
        const up = bull ? green : red;
        const lo = bull ? red : green;
        drawCandle(c.x, -6, c.gapTop - WICK_LEN, c.gapTop - WICK_LEN - 4, c.gapTop, up);
        drawCandle(c.x, c.gapTop + c.gap + WICK_LEN, GROUND_Y + 6, c.gapTop + c.gap, c.gapTop + c.gap + WICK_LEN + 4, lo);
      }

      // Ground strip with scrolling stripes.
      ctx.fillStyle = p.ink;
      ctx.fillRect(0, GROUND_Y, W, H - GROUND_Y);
      ctx.fillStyle = p.wall;
      ctx.fillRect(0, GROUND_Y + 3, W, H - GROUND_Y - 3);
      ctx.fillStyle = p.secondary;
      const off = v.dist % 24;
      for (let x = -off; x < W; x += 24) {
        ctx.beginPath();
        ctx.moveTo(x, GROUND_Y + 3);
        ctx.lineTo(x + 12, GROUND_Y + 3);
        ctx.lineTo(x + 6, GROUND_Y + 13);
        ctx.lineTo(x - 6, GROUND_Y + 13);
        ctx.fill();
      }
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.fillRect(0, GROUND_Y + 3, W, 2);

      // Mascot: bobs while waiting, tilts with vertical speed.
      const bob = v.state === "ready" ? Math.sin(t / 250) * 5 : 0;
      const sprite = v.state === "dead" ? kit.sprites.sad : kit.sprites.mini;
      const size = 30;
      const squash = v.sinceFlap < 6 ? 1 + (6 - v.sinceFlap) * 0.03 : 1;
      ctx.save();
      ctx.translate(BIRD_X, v.y + bob);
      ctx.rotate((v.tilt * Math.PI) / 180);
      ctx.scale(squash, 2 - squash);
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();

      if (v.state !== "ready") kit.text(String(v.score), W / 2, 40, 28, p.text);
      else {
        kit.text("GET READY", W / 2, GROUND_Y * 0.28, 22, p.primary);
        kit.text("TAP / SPACE TO FLAP", W / 2, GROUND_Y * 0.62, 12, p.text);
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
