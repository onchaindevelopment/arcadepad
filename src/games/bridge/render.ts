// Moon Bridge renderer: moon-rock pillars over a starry void, a glowing candle
// plank that grows and tips over, the mascot walking (or hanging) across, coins
// under the bridge, and a camera that glides to each new pillar.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { EDGE_SCREEN_X, H, MILESTONE, PERFECT_HALF, TOP_Y, W, type BridgeView, type Plank } from "./index.ts";

const T = 6; // plank thickness
const HERO = 30; // sprite size
const COIN_DY = 22; // coin centre below the surface

type RGB = [number, number, number];
function rgb(hex: string): RGB {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const css = (c: RGB, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c: RGB, k: number): RGB => (k >= 0 ? mix(c, [255, 255, 255], k) : mix(c, [0, 0, 0], -k));

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BridgeView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const ink = rgb(p.ink);
  const wall = rgb(p.wall);
  const moonC = rgb(p.text);
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const coinColor = bricks[4 % bricks.length] ?? p.accent;
  const craters = Array.from({ length: 24 }, (_, i) => ({ u: Math.random(), v: Math.random(), r: 2 + Math.random() * 5, k: i }));
  let cam = 0;
  let camInit = false;
  let t = 0;
  let happyMs = 0;
  let squash = 0;
  let banner: { text: string; ms: number; color: string } | null = null;
  let landFlash = 0;

  const sx = (wx: number) => wx - cam;

  function drawMoonAndHills() {
    // Big moon, slow parallax.
    const mx = W * 0.72 - ((cam * 0.03) % (W * 2)), my = 130, r = 70;
    const glow = ctx.createRadialGradient(mx, my, r * 0.7, mx, my, r * 2.1);
    glow.addColorStop(0, css(moonC, 0.28));
    glow.addColorStop(1, css(moonC, 0));
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, my + r * 2.2);
    ctx.fillStyle = css(ink);
    ctx.beginPath();
    ctx.arc(mx, my, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(moonC);
    ctx.beginPath();
    ctx.arc(mx, my, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = css(shade(moonC, -0.16));
    for (const [cx, cy, cr] of [[-24, -18, 13], [20, 12, 17], [-8, 30, 8], [30, -28, 8], [-38, 14, 6]]) {
      ctx.beginPath();
      ctx.arc(mx + cx, my + cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    // Two layers of distant ridges.
    const layers: [number, number, RGB, number][] = [
      [0.15, TOP_Y - 70, mix(rgb(p.bg2), wall, 0.35), 0.9],
      [0.35, TOP_Y - 25, mix(rgb(p.bg2), wall, 0.75), 1],
    ];
    for (const [par, base, c, a] of layers) {
      ctx.fillStyle = css(c, a);
      ctx.beginPath();
      ctx.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) {
        const wx = x + cam * par;
        const y = base - 22 * (0.5 + 0.5 * Math.sin(wx / 47)) - 14 * (0.5 + 0.5 * Math.sin(wx / 19 + 1.3));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, H);
      ctx.closePath();
      ctx.fill();
    }
    // Deep void below the pillar tops.
    const g = ctx.createLinearGradient(0, TOP_Y, 0, H);
    g.addColorStop(0, css(rgb(p.bg), 0));
    g.addColorStop(1, css(rgb(p.bg), 0.95));
    ctx.fillStyle = g;
    ctx.fillRect(0, TOP_Y, W, H - TOP_Y);
  }

  function drawPillar(x: number, w: number, i: number, showZone: boolean) {
    const X = sx(x);
    if (X > W + 4 || X + w < -4) return;
    const cap = rgb(bricks[i % bricks.length] ?? p.primary);
    // Body.
    const g = ctx.createLinearGradient(X, 0, X + w, 0);
    g.addColorStop(0, css(shade(wall, 0.12)));
    g.addColorStop(1, css(shade(wall, -0.25)));
    ctx.fillStyle = css(ink);
    ctx.fillRect(X - 1.5, TOP_Y - 1.5, w + 3, H - TOP_Y + 4);
    ctx.fillStyle = g;
    ctx.fillRect(X, TOP_Y, w, H - TOP_Y + 2);
    // Moon-rock craters, stable per pillar.
    ctx.save();
    ctx.beginPath();
    ctx.rect(X, TOP_Y + 10, w, H - TOP_Y);
    ctx.clip();
    ctx.fillStyle = css(shade(wall, -0.35), 0.7);
    for (const c of craters) {
      const cx = X + ((c.u + i * 0.37) % 1) * w;
      const cy = TOP_Y + 22 + ((c.v + i * 0.21) % 1) * (H - TOP_Y - 20);
      ctx.beginPath();
      ctx.arc(cx, cy, Math.min(c.r, w / 5), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    // Cap.
    ctx.fillStyle = css(cap);
    ctx.fillRect(X, TOP_Y, w, 9);
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(X + 2, TOP_Y + 1.5, Math.max(0, w - 4), 2);
    ctx.fillStyle = css(ink, 0.8);
    ctx.fillRect(X, TOP_Y + 9, w, 1.5);
    if (showZone) {
      const zx = X + w / 2 - PERFECT_HALF - 0.5;
      const pulse = 0.75 + 0.25 * Math.sin(t / 160);
      ctx.fillStyle = css(ink);
      ctx.fillRect(zx - 1, TOP_Y - 1, PERFECT_HALF * 2 + 3, 6);
      ctx.fillStyle = css(rgb(p.accent), pulse);
      ctx.fillRect(zx, TOP_Y, PERFECT_HALF * 2 + 1, 4);
    }
  }

  function drawPlank(pl: Plank, flame: boolean, alpha = 1) {
    if (pl.len <= 0) return;
    const X = sx(pl.x);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(X, TOP_Y);
    ctx.rotate((pl.ang / 256) * Math.PI * 2);
    // Pre-rotation: an upright candle at x in [0, T], from y = -len to 0.
    const body = rgb(p.primary);
    ctx.fillStyle = css(ink);
    ctx.fillRect(-1.5, -pl.len - 1.5, T + 3, pl.len + 3);
    const g = ctx.createLinearGradient(0, 0, T, 0);
    g.addColorStop(0, css(shade(body, 0.3)));
    g.addColorStop(1, css(shade(body, -0.2)));
    ctx.fillStyle = g;
    ctx.fillRect(0, -pl.len, T, pl.len);
    // Wax rings.
    ctx.fillStyle = css(shade(body, -0.35), 0.6);
    for (let y = -12; y > -pl.len + 4; y -= 18) ctx.fillRect(0, y, T, 1.5);
    // Wick + flame at the tip.
    ctx.fillStyle = css(ink);
    ctx.fillRect(T / 2 - 0.75, -pl.len - 5, 1.5, 4);
    if (flame) {
      const f = 1 + 0.25 * Math.sin(t / 45) + 0.15 * Math.sin(t / 23);
      ctx.fillStyle = css(rgb(p.accent), 0.35);
      ctx.beginPath();
      ctx.ellipse(T / 2, -pl.len - 9, 7 * f, 10 * f, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.ellipse(T / 2, -pl.len - 9, 3.5 * f, 6.5 * f, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(T / 2, -pl.len - 7.5, 1.5, 3, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCoin(x: number, y: number) {
    const spin = Math.abs(Math.cos(t / 260));
    const r = 7;
    ctx.fillStyle = css(ink);
    ctx.beginPath();
    ctx.ellipse(x, y, r * spin + 1.5, r + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = coinColor;
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(0.5, r * spin), r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillRect(x - r * spin * 0.5, y - r * 0.55, Math.max(1, r * spin * 0.5), 2);
    // String up to the plank line.
    ctx.strokeStyle = css(moonC, 0.35);
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(x, TOP_Y + 1);
    ctx.lineTo(x, y - r - 1);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawHero(v: BridgeView) {
    const sprite = v.dead ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.idle;
    const X = sx(v.heroX);
    const walking = v.phase === "walk";
    const bob = walking ? Math.abs(Math.sin(t / 70)) * 2.5 : happyMs > 0 ? Math.abs(Math.sin(t / 100)) * 5 : 0;
    const sq = v.phase === "grow" ? 0.06 + 0.03 * Math.sin(t / 60) : squash * 0.2;
    const w = HERO * (1 + sq), h = HERO * (1 - sq);
    ctx.save();
    if (v.phase === "fall" || v.phase === "dead") {
      ctx.translate(X, TOP_Y + v.heroY + (v.flipped ? T + h / 2 : -h / 2));
      ctx.rotate(Math.min(3, v.heroY / 60) * (v.flipped ? -1 : 1));
      if (v.flipped) ctx.scale(1, -1);
      ctx.drawImage(sprite, -w / 2, -h / 2, w, h);
    } else if (v.flipped) {
      ctx.translate(X, TOP_Y + T + bob);
      ctx.scale(1, -1);
      ctx.drawImage(sprite, -w / 2, -h, w, h);
    } else {
      ctx.translate(X, TOP_Y - bob);
      ctx.drawImage(sprite, -w / 2, -h, w, h);
    }
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const X = e.x !== undefined ? sx(e.x) : sx(v.heroX);
        if (e.t === "release") {
          squash = 1;
        } else if (e.t === "land") {
          kit.fx.burst(X, TOP_Y, css(moonC), 8, 90, 300);
          landFlash = 1;
        } else if (e.t === "perfect") {
          happyMs = 1000;
          kit.fx.burst(X, TOP_Y, p.accent, 16, 170, 300);
          kit.fx.burst(X, TOP_Y, "#ffffff", 8, 120, 200);
          const s = e.streak as number;
          kit.fx.popup(X, TOP_Y - 46, s > 1 ? `PERFECT x${s}` : "PERFECT +1", p.accent);
          kit.fx.flash("255,255,255");
        } else if (e.t === "flip") {
          kit.fx.burst(X, TOP_Y + 2, p.secondary, 5, 60, 0);
        } else if (e.t === "coin") {
          kit.fx.burst(X, TOP_Y + COIN_DY, coinColor, 14, 150);
          kit.fx.popup(X, TOP_Y + COIN_DY + 18, "+1", coinColor);
        } else if (e.t === "arrive") {
          squash = 1;
          kit.fx.popup(X, TOP_Y - 44, "+1", p.primary);
          kit.fx.burst(X, TOP_Y, p.primary, 8, 90, 300);
        } else if (e.t === "milestone") {
          happyMs = 1600;
          banner = { text: `${e.crossed as number} PILLARS!`, ms: 1800, color: p.primary };
          for (let i = 0; i < 6; i++) kit.fx.burst(30 + Math.random() * (W - 60), 140 + Math.random() * 140, bricks[i % bricks.length], 14, 200);
        } else if (e.t === "fall") {
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(X, TOP_Y, p.secondary, 18, 180);
          const why = e.why as string;
          banner = { text: why === "crash" ? "BONK!" : why === "short" ? "TOO SHORT!" : "TOO LONG!", ms: 99999, color: p.accent };
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const dt = Math.min(50, dtMs);
      happyMs = Math.max(0, happyMs - dtMs);
      squash = Math.max(0, squash - dtMs / 180);
      landFlash = Math.max(0, landFlash - dtMs / 250);
      const target = v.cur.x + v.cur.w - EDGE_SCREEN_X;
      if (!camInit) {
        cam = target;
        camInit = true;
      }
      cam += (target - cam) * Math.min(1, dt / 110);

      kit.background(dtMs);
      drawMoonAndHills();

      // Old planks, then pillars, then the live plank.
      for (const pl of v.old) drawPlank(pl, false, 0.85);
      for (const pl of v.pillars) drawPillar(pl.x, pl.w, pl.i, pl === v.next);
      const live = v.plank;
      drawPlank(live, v.phase === "grow" || v.phase === "rotate", 1);
      if (v.phase === "grow") {
        // Length guide: a faint dashed line at the tip's height.
        ctx.strokeStyle = css(moonC, 0.25);
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(sx(live.x), TOP_Y - live.len);
        ctx.lineTo(sx(live.x) + 40, TOP_Y - live.len);
        ctx.stroke();
        ctx.setLineDash([]);
        if (Math.random() < dtMs / 60) kit.fx.burst(sx(live.x) + T / 2, TOP_Y - live.len - 10, p.accent, 1, 30, -60);
      }
      if (landFlash > 0 && v.phase === "walk") {
        ctx.fillStyle = `rgba(255,255,255,${landFlash * 0.5})`;
        ctx.fillRect(sx(live.x), TOP_Y - 1, live.len, T + 2);
      }

      if (v.coin && !v.coin.taken) drawCoin(sx(v.coin.x), TOP_Y + COIN_DY + Math.sin(t / 300) * 1.5);

      drawHero(v);

      // Banner and hints.
      if (banner) {
        banner.ms -= dtMs;
        ctx.globalAlpha = Math.max(0, Math.min(1, banner.ms / 400));
        kit.text(banner.text, W / 2, 250, 24, banner.color);
        ctx.globalAlpha = 1;
        if (banner.ms <= 0) banner = null;
      }
      if (!v.dead && v.streak >= 2) kit.text(`PERFECT x${v.streak}`, W / 2, 285, 11, p.accent);
      if (v.crossed === 0 && v.phase === "ready") {
        kit.text("HOLD TO GROW", W / 2, H - 70, 14, p.text);
        kit.text("RELEASE TO DROP", W / 2, H - 50, 14, p.text);
      } else if (v.crossed < 3 && v.phase === "walk" && v.coin && !v.coin.taken && !v.flipped) {
        kit.text("TAP / DOWN TO FLIP UNDER", W / 2, H - 50, 11, p.text);
      }
      if (v.crossed > 0 && v.crossed % MILESTONE !== 0 && v.phase === "ready" && !v.dead) {
        kit.text(`${MILESTONE - (v.crossed % MILESTONE)} TO GO`, W / 2, H - 40, 10, css(moonC, 0.6));
      }

      kit.fx.draw(kit, dtMs);
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    },
  };
}
