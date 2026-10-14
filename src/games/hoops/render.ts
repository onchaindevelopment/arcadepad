// Hoop Flick renderer: a crowd in the stands, a perspective court, a hoop
// with backboard and swinging net, and the coin ball with the mascot face.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BALL_Y, BOARD_BOT, BOARD_DX, BOARD_TOP, BR, FLOOR_Y, H, HOOP_Y, RIM_HALF, W, type HoopsView } from "./index.ts";

const TAU = Math.PI * 2;
const NET_H = 40;
const RIM_EH = 7; // rim ellipse half height (perspective)

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<HoopsView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  let t = 0;
  let cheer = 0; // ms of crowd excitement left
  let happyMs = 0;
  let sadMs = 0;
  let spin = 0;
  let lastX = 0;
  let banner = 0;
  let bannerText = "";
  const trail: { x: number; y: number }[] = [];

  // Crowd: three rows of fans in the stands.
  const fans: { x: number; y: number; r: number; c: string; ph: number; sp: number }[] = [];
  for (let row = 0; row < 4; row++) {
    const y = 300 + row * 30;
    const n = 13 + (row & 1);
    for (let i = 0; i < n; i++) {
      fans.push({
        x: (i + ((row & 1) ? 0.1 : 0.6)) * (W / n) + (Math.random() - 0.5) * 6,
        y: y + (Math.random() - 0.5) * 4,
        r: 7 + row * 0.8,
        c: p.bricks[(i * 3 + row) % p.bricks.length],
        ph: Math.random() * TAU,
        sp: 0.6 + Math.random() * 0.8,
      });
    }
  }

  function drawStands() {
    // stand steps
    for (let row = 0; row < 5; row++) {
      ctx.fillStyle = row % 2 ? p.wall : p.bg2;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(0, 290 + row * 30, W, 30);
    }
    ctx.globalAlpha = 1;
    const excite = Math.min(1, cheer / 900);
    for (const f of fans) {
      const bob = Math.sin(t / 300 * f.sp + f.ph) * 1.5 + excite * Math.abs(Math.sin(t / 90 * f.sp + f.ph)) * -7;
      const y = f.y + bob;
      ctx.globalAlpha = 0.8;
      // body
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(f.x - f.r - 1, y + f.r - 3, f.r * 2 + 2, f.r * 2 + 2, 5);
      ctx.fill();
      ctx.fillStyle = f.c;
      ctx.beginPath();
      ctx.roundRect(f.x - f.r, y + f.r - 2, f.r * 2, f.r * 2, 4);
      ctx.fill();
      // raised arms when cheering
      if (excite > 0.2) {
        ctx.fillStyle = f.c;
        ctx.fillRect(f.x - f.r - 2, y - f.r - 2, 3, f.r + 4);
        ctx.fillRect(f.x + f.r - 1, y - f.r - 2, 3, f.r + 4);
      }
      // head
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(f.x, y, f.r * 0.75 + 1, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.text;
      ctx.beginPath();
      ctx.arc(f.x, y, f.r * 0.75, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.ink;
      ctx.fillRect(f.x - 3, y - 1, 2, 2);
      ctx.fillRect(f.x + 1, y - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
    // barrier with ticker-coloured boards
    kit.block(-4, 420, W + 8, 26, p.secondary, 2);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = "rgba(255,255,255,0.22)";
      ctx.fillRect(10 + i * 60, 428, 36, 4);
      ctx.fillRect(10 + i * 60, 434, 22, 3);
    }
  }

  function drawCourt() {
    const top = 446;
    // perspective floor
    const g = ctx.createLinearGradient(0, top, 0, H);
    g.addColorStop(0, p.wall);
    g.addColorStop(1, p.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, top, W, H - top);
    // planks
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 1;
    for (let i = -8; i <= 8; i++) {
      ctx.beginPath();
      ctx.moveTo(W / 2 + i * 26, top);
      ctx.lineTo(W / 2 + i * 60, H);
      ctx.stroke();
    }
    for (let k = 1; k < 6; k++) {
      const y = top + (k * k * (H - top)) / 36;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
    // key / arc lines in the accent colour
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.ellipse(W / 2, top + 6, 150, 40, 0, 0, Math.PI);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(W / 2 - 60, top);
    ctx.lineTo(W / 2 - 80, top + 70);
    ctx.lineTo(W / 2 + 80, top + 70);
    ctx.lineTo(W / 2 + 60, top);
    ctx.stroke();
    ctx.globalAlpha = 1;
    // court edge highlight
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(0, top, W, 2);
  }

  function drawPoleAndBoard(hx: number) {
    const bx = hx + BOARD_DX;
    // pole behind the board, down to the court
    const px = bx + 18;
    kit.block(px - 5, BOARD_TOP + 30, 10, 460 - BOARD_TOP - 30, p.wall, 2);
    kit.block(px - 16, 456, 32, 14, p.wall, 3);
    // arm from pole to board
    ctx.fillStyle = p.ink;
    ctx.fillRect(bx, BOARD_TOP + 46, px - bx, 6);
    ctx.fillStyle = p.text;
    ctx.globalAlpha = 0.6;
    ctx.fillRect(bx, BOARD_TOP + 47, px - bx, 3);
    ctx.globalAlpha = 1;
    // backboard seen at an angle: a slim panel with a target square
    const bw = 12;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(bx - bw / 2 - 1.5, BOARD_TOP - 1.5, bw + 3, BOARD_BOT - BOARD_TOP + 3, 3);
    ctx.fill();
    const g = ctx.createLinearGradient(bx - bw / 2, 0, bx + bw / 2, 0);
    g.addColorStop(0, "#ffffff");
    g.addColorStop(1, p.text);
    ctx.fillStyle = g;
    ctx.fillRect(bx - bw / 2, BOARD_TOP, bw, BOARD_BOT - BOARD_TOP);
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.strokeRect(bx - bw / 2 + 2, HOOP_Y - 44, bw - 4, 40);
    // bracket from board to rim
    ctx.fillStyle = p.ink;
    ctx.fillRect(hx + RIM_HALF, HOOP_Y - 3, BOARD_DX - RIM_HALF - bw / 2 + 1, 6);
  }

  function rimBack(hx: number) {
    ctx.lineWidth = 5;
    ctx.strokeStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(hx, HOOP_Y, RIM_HALF, RIM_EH, 0, Math.PI, TAU);
    ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = p.accent;
    ctx.globalAlpha = 0.7;
    ctx.beginPath();
    ctx.ellipse(hx, HOOP_Y, RIM_HALF, RIM_EH, 0, Math.PI, TAU);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function netAndRimFront(v: HoopsView) {
    const hx = v.hoop.x;
    // Net: swishes down and swings after a basket.
    const nt = v.netT;
    const k = nt < 40 ? Math.sin((nt / 40) * Math.PI) * (1 - nt / 40) : 0;
    const stretch = 1 + k * 0.45;
    const sway = nt < 60 ? Math.sin(nt * 0.35) * (1 - nt / 60) * 5 : Math.sin(t / 700) * 0.8;
    const n = 8;
    const rows = 4;
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.9;
    const pt = (i: number, r: number) => {
      const f = r / rows;
      const half = RIM_HALF * (1 - 0.42 * f) * (1 - k * 0.15 * f);
      const ang = (i / n) * Math.PI; // front half
      const x = hx + Math.cos(ang) * half + sway * f;
      const y = HOOP_Y + Math.sin(ang) * RIM_EH * (1 - 0.4 * f) + f * NET_H * stretch;
      return [x, y] as const;
    };
    for (let i = 0; i <= n; i++) {
      ctx.beginPath();
      for (let r = 0; r <= rows; r++) {
        // criss-cross: alternate columns lean
        const [x, y] = pt(i + ((r & 1) ? 0.5 : 0), r);
        if (r === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    for (let r = 1; r <= rows; r++) {
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const [x, y] = pt(i, r);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // front rim
    ctx.lineWidth = 5;
    ctx.strokeStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(hx, HOOP_Y, RIM_HALF, RIM_EH, 0, 0, Math.PI);
    ctx.stroke();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.accent;
    ctx.beginPath();
    ctx.ellipse(hx, HOOP_Y, RIM_HALF, RIM_EH, 0, 0, Math.PI);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(hx - RIM_HALF + 6, HOOP_Y + RIM_EH - 2, 10, 1.5);
  }

  function ballScale(y: number) {
    // perspective: the ball shrinks as it flies "into" the court
    const f = Math.max(-0.4, Math.min(1, (y - HOOP_Y) / (BALL_Y - HOOP_Y)));
    return 0.95 + 0.35 * f;
  }

  function drawBall(x: number, y: number, moon: boolean, sad: boolean) {
    const s = ballScale(y);
    const r = BR * s;
    ctx.save();
    ctx.translate(x, y);
    if (moon) {
      ctx.globalAlpha = 0.35 + 0.2 * Math.sin(t / 120);
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(0, 0, r + 7, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.rotate(spin);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, r + 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = moon ? p.accent : p.secondary;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fill();
    // milled coin edge
    ctx.strokeStyle = "rgba(0,0,0,0.3)";
    ctx.lineWidth = 1.2;
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (r - 3), Math.sin(a) * (r - 3));
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      ctx.stroke();
    }
    const face = ctx.createRadialGradient(-r * 0.35, -r * 0.4, 1, 0, 0, r);
    face.addColorStop(0, "#ffffff");
    face.addColorStop(0.18, p.primary);
    face.addColorStop(1, p.primary);
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, r - 3.5, 0, TAU);
    ctx.fill();
    // basketball seams on the coin face
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-r + 3.5, 0);
    ctx.lineTo(r - 3.5, 0);
    ctx.moveTo(0, -r + 3.5);
    ctx.lineTo(0, r - 3.5);
    ctx.stroke();
    ctx.restore();
    // mascot face stays upright
    const sprite = sad ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.mini;
    const ss = r * 1.45;
    ctx.drawImage(sprite, x - ss / 2, y - ss / 2, ss, ss);
    if (moon) kit.text("5", x + r + 4, y - r - 2, 11, p.accent);
  }

  function drawAim(v: HoopsView) {
    const a = v.aim;
    const bx = v.ball.x;
    const by = v.ball.y;
    if (a.mode === "drag") {
      const dx = a.px - a.gx;
      const dy = a.py - a.gy;
      ctx.strokeStyle = p.text;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = 3;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + dx, by + dy);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
      return;
    }
    const ang = (a.angle / 256) * TAU;
    const charging = a.mode === "charge";
    const len = charging ? 30 + 60 * a.power : 34;
    ctx.globalAlpha = charging ? 1 : 0.45;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.moveTo(bx + Math.cos(ang) * 22, by + Math.sin(ang) * 22);
    ctx.lineTo(bx + Math.cos(ang) * (22 + len), by + Math.sin(ang) * (22 + len));
    ctx.stroke();
    ctx.strokeStyle = charging ? p.accent : p.text;
    ctx.lineWidth = 4;
    ctx.stroke();
    const tx = bx + Math.cos(ang) * (26 + len);
    const ty = by + Math.sin(ang) * (26 + len);
    ctx.fillStyle = charging ? p.accent : p.text;
    ctx.beginPath();
    ctx.moveTo(tx + Math.cos(ang) * 6, ty + Math.sin(ang) * 6);
    ctx.lineTo(tx + Math.cos(ang + 2.4) * 8, ty + Math.sin(ang + 2.4) * 8);
    ctx.lineTo(tx + Math.cos(ang - 2.4) * 8, ty + Math.sin(ang - 2.4) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    if (charging) {
      // power meter beside the ball
      const mx = bx < W / 2 ? bx + 30 : bx - 40;
      kit.block(mx, by - 40, 10, 52, p.wall, 2);
      ctx.fillStyle = a.power > 0.85 ? p.accent : p.primary;
      const hgt = 46 * a.power;
      ctx.fillRect(mx + 3, by + 9 - hgt, 4, hgt);
    }
  }

  function drawClock(v: HoopsView) {
    const secs = Math.ceil(v.timeLeft / 60);
    const s = `0:${secs < 10 ? "0" : ""}${secs}`;
    const low = secs <= 10 && v.phase !== "over";
    const pulse = low ? 1 + 0.12 * Math.max(0, Math.sin((v.timeLeft / 60) * TAU)) : 1;
    kit.block(W / 2 - 46, 14, 92, 40, p.ink, 6);
    ctx.save();
    ctx.translate(W / 2, 35);
    ctx.scale(pulse, pulse);
    kit.text(s, 0, 0, 22, low ? p.accent : p.primary);
    ctx.restore();
    // shot multiplier + baskets
    kit.text(`${v.baskets}`, 26, 34, 18, p.text);
    kit.text("BASKETS", 26, 52, 7, p.text);
    if (v.mult > 1) {
      ctx.save();
      ctx.translate(W - 32, 38);
      const wob = 1 + 0.08 * Math.sin(t / 110);
      ctx.scale(wob, wob);
      kit.text(`x${v.mult}`, 0, 0, 20, p.accent);
      ctx.restore();
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: HoopsView) {
      for (const e of events) {
        if (e.t === "launch") {
          kit.fx.burst(e.x!, e.y! + BR, p.text, 6, 70, 300);
        } else if (e.t === "rim" || e.t === "board") {
          kit.fx.burst(e.x!, e.y!, e.t === "rim" ? p.accent : p.text, 5, 80);
          kit.fx.addShake(Math.min(3, (e.power as number) * 0.4));
        } else if (e.t === "basket") {
          const pts = e.pts as number;
          const swish = e.swish as boolean;
          const moon = e.moon as boolean;
          cheer = 1600;
          happyMs = 700;
          for (let i = 0; i < 4; i++) kit.fx.burst(e.x! + (i - 1.5) * 14, e.y! + 20, p.bricks[i % p.bricks.length], 8, 170);
          const label = moon ? "MOON BALL!" : swish ? "SWISH!" : "";
          kit.fx.popup(e.x!, e.y! - 30, `+${pts}`, moon ? p.accent : p.primary);
          if (label) kit.fx.popup(e.x!, e.y! - 48, label, p.accent);
          if ((e.mult as number) > 1) kit.fx.popup(e.x!, e.y! - 66, `x${e.mult as number} STREAK`, p.text);
          if (moon || swish) kit.fx.flash("255,255,255");
          kit.fx.addShake(moon ? 6 : swish ? 4 : 2);
        } else if (e.t === "miss") {
          if ((e.lostStreak as number) >= 3) {
            sadMs = 700;
            kit.fx.popup(e.x!, e.y! - 30, "STREAK LOST", p.secondary);
          }
          kit.fx.burst(e.x!, e.y!, p.wall, 6, 60, 300);
        } else if (e.t === "land") {
          kit.fx.burst(e.x!, e.y!, p.text, 4, 50, 300);
        } else if (e.t === "moon") {
          kit.fx.burst(e.x!, e.y!, p.accent, 14, 120);
          kit.fx.popup(e.x!, e.y! - 34, "MOON BALL x5", p.accent);
        } else if (e.t === "speedup") {
          banner = 1500;
          bannerText = (e.level as number) <= 1 ? "THE HOOP IS MOVING!" : "FASTER!";
          kit.fx.flash("255,255,255");
          kit.fx.addShake(5);
        } else if (e.t === "buzzer") {
          banner = 1600;
          bannerText = "TIME!";
          kit.fx.flash();
          kit.fx.addShake(6);
        }
      }
      void v;
    },
    draw(v, dtMs) {
      t += dtMs;
      cheer = Math.max(0, cheer - dtMs);
      happyMs = Math.max(0, happyMs - dtMs);
      sadMs = Math.max(0, sadMs - dtMs);
      banner = Math.max(0, banner - dtMs);
      kit.background(dtMs);
      drawStands();
      drawCourt();

      const hx = v.hoop.x;
      const b = v.ball;
      // spin follows horizontal travel; reset on a fresh ball
      if (v.phase === "flight") spin += (b.x - lastX) / BR;
      else if (v.phase === "ready" && v.phaseT < 2) spin = 0;
      lastX = b.x;

      // ball shadow on the court
      if (v.phase !== "over") {
        const sh = Math.max(0.15, 1 - (FLOOR_Y - b.y) / 500);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.globalAlpha = sh;
        ctx.beginPath();
        ctx.ellipse(b.x, Math.min(FLOOR_Y - 18, BALL_Y + 16), 15 * sh + 4, 4, 0, 0, TAU);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawPoleAndBoard(hx);
      rimBack(hx);

      // trail
      if (v.phase === "flight") {
        trail.push({ x: b.x, y: b.y });
        if (trail.length > 10) trail.shift();
      } else trail.length = 0;
      for (let i = 0; i < trail.length; i++) {
        const q = trail[i];
        ctx.globalAlpha = (i / trail.length) * 0.35;
        ctx.fillStyle = b.moon ? p.accent : p.primary;
        ctx.beginPath();
        ctx.arc(q.x, q.y, BR * ballScale(q.y) * (i / trail.length), 0, TAU);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      const showBall = v.phase !== "respawn" || v.phaseT < 6;
      const respawnIn = v.phase === "ready" && v.phaseT < 10 ? v.phaseT / 10 : 1;
      if (showBall && v.phase !== "over") {
        if (respawnIn < 1) {
          ctx.save();
          ctx.translate(b.x, b.y);
          ctx.scale(respawnIn, respawnIn);
          ctx.translate(-b.x, -b.y);
        }
        if (v.phase === "ready") drawAim(v);
        drawBall(b.x, b.y, b.moon, sadMs > 0);
        if (respawnIn < 1) ctx.restore();
      }
      netAndRimFront(v);

      drawClock(v);
      if (!v.started) {
        const a = 0.6 + 0.4 * Math.sin(t / 250);
        ctx.globalAlpha = a;
        kit.text("SWIPE UP ON THE BALL", W / 2, 400, 13, p.text);
        kit.text("OR HOLD SPACE, AIM WITH ARROWS", W / 2, 474, 9, p.text);
        ctx.globalAlpha = 1;
      }
      if (banner > 0) {
        const k = Math.min(1, banner / 300, (1700 - banner) / 200);
        ctx.globalAlpha = Math.max(0, k);
        kit.block(20, 250, W - 40, 44, p.secondary, 8);
        kit.text(bannerText, W / 2, 272, 17, p.text);
        ctx.globalAlpha = 1;
      }
      if (v.phase === "over") {
        kit.block(40, 230, W - 80, 110, p.ink, 10);
        kit.text("FINAL", W / 2, 258, 12, p.text);
        kit.text(String(v.score), W / 2, 292, 30, p.primary);
        kit.text(`${v.baskets} BASKETS`, W / 2, 322, 10, p.text);
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
