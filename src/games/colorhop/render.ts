// Color Hop renderer: spinning rings, sliding bars, side crosses and coin
// wheels in 4 palette colours; the mascot rides inside a coloured ball.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BALL_R, BALL_X, COLOURS, H, TURN, W, partPos, type HopView, type Part } from "./index.ts";

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace("#", "").slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function dist(a: string, b: string): number {
  const x = rgb(a), y = rgb(b);
  return Math.abs(x[0] - y[0]) * 0.3 + Math.abs(x[1] - y[1]) * 0.59 + Math.abs(x[2] - y[2]) * 0.11 + Math.abs(x[0] - y[0] + x[2] - y[2]) * 0.2;
}

/** Four palette colours that are as distinct from each other as possible. */
function pickColours(theme: ThemePack): string[] {
  const p = theme.palette;
  const pool = [...new Set([...p.bricks, p.primary, p.secondary, p.accent].map((c) => c.toUpperCase()))];
  const out = [pool[0]];
  while (out.length < COLOURS && out.length < pool.length) {
    let best = pool[0], bestD = -1;
    for (const c of pool) {
      if (out.includes(c)) continue;
      const d = Math.min(...out.map((o) => dist(o, c)));
      if (d > bestD) { bestD = d; best = c; }
    }
    out.push(best);
  }
  while (out.length < COLOURS) out.push(["#FFFFFF", "#888888", "#444444"][out.length - 1]);
  return out;
}

const RAD = (Math.PI * 2) / TURN;

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<HopView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const cols = pickColours(theme);
  let t = 0;
  let trail: { y: number; c: number }[] = [];
  let swapPulse = 0;
  let hopSquash = 0;
  let lastFrame = -1;

  function ringPart(q: Part, sy: number, pos: number) {
    const { ctx } = kit;
    const a0 = pos * RAD;
    ctx.lineCap = "butt";
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = q.thick + 4;
    ctx.beginPath();
    ctx.arc(q.cx, sy, q.size, 0, Math.PI * 2);
    ctx.stroke();
    for (let k = 0; k < COLOURS; k++) {
      ctx.strokeStyle = cols[k];
      ctx.lineWidth = q.thick;
      ctx.beginPath();
      ctx.arc(q.cx, sy, q.size, a0 + (k * Math.PI) / 2, a0 + ((k + 1) * Math.PI) / 2 + 0.002);
      ctx.stroke();
    }
    // Bevel: light inner edge, dark outer edge.
    ctx.lineWidth = 2;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(q.cx, sy, q.size - q.thick / 2 + 2, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.arc(q.cx, sy, q.size + q.thick / 2 - 2, 0, Math.PI * 2);
    ctx.stroke();
    // Segment seams.
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < COLOURS; k++) {
      const a = a0 + (k * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(q.cx + Math.cos(a) * (q.size - q.thick / 2), sy + Math.sin(a) * (q.size - q.thick / 2));
      ctx.lineTo(q.cx + Math.cos(a) * (q.size + q.thick / 2), sy + Math.sin(a) * (q.size + q.thick / 2));
      ctx.stroke();
    }
  }

  function barPart(q: Part, sy: number, pos: number) {
    const off = pos / 16;
    const j0 = Math.floor((-q.size - off) / q.size);
    for (let j = j0; off + j * q.size < W; j++) {
      const x = off + j * q.size;
      kit.block(x, sy - q.thick / 2, q.size, q.thick, cols[((j % COLOURS) + COLOURS) % COLOURS], 5);
    }
  }

  function crossPart(q: Part, sy: number, pos: number) {
    const { ctx } = kit;
    const h = q.thick / 2;
    ctx.save();
    ctx.translate(q.cx, sy);
    ctx.rotate(pos * RAD);
    for (let k = 0; k < COLOURS; k++) {
      kit.block(h - 2, -h, q.size - h + 2, q.thick, cols[k], 6);
      ctx.rotate(Math.PI / 2);
    }
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, h + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(0, 0, h - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function wheelPart(q: Part, sy: number, pos: number) {
    const { ctx } = kit;
    ctx.strokeStyle = p.text;
    ctx.globalAlpha = 0.18;
    ctx.lineWidth = 2;
    for (let k = 0; k < q.n; k++) {
      const a = (pos + Math.floor((k * TURN) / q.n)) * RAD;
      ctx.beginPath();
      ctx.moveTo(q.cx, sy);
      ctx.lineTo(q.cx + Math.cos(a) * q.size, sy + Math.sin(a) * q.size);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.arc(q.cx, sy, 7, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < q.n; k++) {
      const a = (pos + Math.floor((k * TURN) / q.n)) * RAD;
      const x = q.cx + Math.cos(a) * q.size, y = sy + Math.sin(a) * q.size;
      coin(x, y, q.thick, cols[k % COLOURS]);
    }
  }

  function coin(x: number, y: number, r: number, c: string) {
    const { ctx } = kit;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath();
    ctx.arc(x - r * 0.35, y - r * 0.35, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  function star(x: number, y: number, r: number) {
    const { ctx } = kit;
    const rot = t / 600;
    const path = () => {
      ctx.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 ? r * 0.45 : r;
        ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
      }
      ctx.closePath();
    };
    path();
    ctx.lineWidth = 4;
    ctx.strokeStyle = p.ink;
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.fillStyle = "#ffffff";
    ctx.fill();
  }

  function orb(x: number, y: number, r: number) {
    const { ctx } = kit;
    const a0 = t / 300;
    ctx.globalAlpha = 0.25 + 0.15 * Math.sin(t / 150);
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r + 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, r + 2, 0, Math.PI * 2);
    ctx.fill();
    for (let k = 0; k < COLOURS; k++) {
      ctx.fillStyle = cols[k];
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.arc(x, y, r, a0 + (k * Math.PI) / 2, a0 + ((k + 1) * Math.PI) / 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const c = cols[v.colour];
        if (e.t === "hop") {
          hopSquash = 1;
          kit.fx.burst(BALL_X, e.y! + BALL_R, c, 4, 60, 300);
        } else if (e.t === "coin") {
          kit.fx.burst(e.x!, e.y!, "#ffffff", 10, 140);
          kit.fx.popup(e.x! + 26, e.y!, "+1", p.text);
        } else if (e.t === "swap") {
          swapPulse = 1;
          kit.fx.burst(e.x!, e.y!, cols[e.colour as number], 16, 170);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 6, 90);
        } else if (e.t === "levelup") {
          kit.fx.popup(W / 2, H * 0.3, `LEVEL ${(e.level as number) + 1}`, p.primary);
          for (let i = 0; i < COLOURS; i++) kit.fx.burst(W * (0.2 + i * 0.2), H * 0.3, cols[i], 10, 180);
        } else if (e.t === "hit") {
          kit.fx.addShake(e.shake ?? 10);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, cols[e.ball as number] ?? c, 26, 230);
          if ((e.colour as number) >= 0) kit.fx.burst(e.x!, e.y!, cols[e.colour as number], 12, 160);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 8, 120);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const { ctx } = kit;
      kit.background(dtMs);
      const cam = v.camY;

      // Path guide: a faint dotted line the ball travels on.
      ctx.fillStyle = p.text;
      ctx.globalAlpha = 0.07;
      const dashOff = ((-cam % 24) + 24) % 24;
      for (let y = dashOff - 24; y < H; y += 24) ctx.fillRect(BALL_X - 1, y, 2, 10);
      ctx.globalAlpha = 1;

      for (const g of v.groups) {
        if (g.bottom - cam < -140 || g.top - cam > H + 140) continue;
        for (const q of g.parts) {
          const sy = q.cy - cam;
          const pos = partPos(q, v.frame);
          if (q.k === "ring") ringPart(q, sy, pos);
          else if (q.k === "bar") barPart(q, sy, pos);
          else if (q.k === "cross") crossPart(q, sy, pos);
          else wheelPart(q, sy, pos);
        }
        if (!g.coinTaken) star(BALL_X, g.coinY - cam + Math.sin(t / 250) * 1.5, 11 + Math.sin(t / 180) * 1);
        if (!g.orbTaken) orb(BALL_X, g.orbY - cam, 11);
      }

      // Ball: trail, coloured shell, mascot inside.
      if (v.frame !== lastFrame) {
        lastFrame = v.frame;
        if (v.state === "play") trail.push({ y: v.y, c: v.colour });
        if (trail.length > 10) trail.shift();
      }
      const by = v.y - cam + (v.state === "ready" ? Math.sin(t / 220) * 4 : 0);
      if (v.state !== "dead") {
        for (let i = 0; i < trail.length; i++) {
          ctx.globalAlpha = (i / trail.length) * 0.35;
          ctx.fillStyle = cols[trail[i].c];
          ctx.beginPath();
          ctx.arc(BALL_X, trail[i].y - cam, BALL_R * (0.4 + (0.5 * i) / trail.length), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
        hopSquash = Math.max(0, hopSquash - dtMs / 160);
        swapPulse = Math.max(0, swapPulse - dtMs / 400);
        const sx = 1 - hopSquash * 0.15, syy = 1 + hopSquash * 0.15;
        ctx.save();
        ctx.translate(BALL_X, by);
        ctx.scale(sx, syy);
        if (swapPulse > 0) {
          ctx.globalAlpha = swapPulse * 0.6;
          ctx.strokeStyle = cols[v.colour];
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(0, 0, BALL_R + 4 + (1 - swapPulse) * 14, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(0, 0, BALL_R + 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = cols[v.colour];
        ctx.beginPath();
        ctx.arc(0, 0, BALL_R, 0, Math.PI * 2);
        ctx.fill();
        const sprite = v.sinceSwap < 30 ? kit.sprites.happy : kit.sprites.mini;
        const s = 16;
        ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        trail = [];
        ctx.globalAlpha = 0.9;
        ctx.drawImage(kit.sprites.sad, BALL_X - 16, Math.min(H - 40, by) - 16, 32, 32);
        ctx.globalAlpha = 1;
      }

      if (v.state === "ready") {
        kit.text("TAP TO HOP", W / 2, H - 110, 16, p.text);
        kit.text("MATCH YOUR COLOUR", W / 2, H - 86, 10, cols[v.colour]);
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
