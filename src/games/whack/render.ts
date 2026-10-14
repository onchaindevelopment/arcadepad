// Whack the FUD renderer: dirt mounds and holes, original FUD critters
// (grumpy bear, paper-hands ghost, sneaky rug), the coin mascot as the
// friend you must not bonk, golden coins, fizzing bombs, ice crystals,
// a swinging hammer, squash + stars, combo meter, clock bar and hearts.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CELL_H, CELL_W, COLS, GRID_Y, H, HEARTS, HIT_ANIM, INTRO, ROWS, RUN, W, holeX, holeY, type HoleView, type Kind, type WhackView } from "./index.ts";

const TAU = Math.PI * 2;
const HOLE_RX = 42;
const HOLE_RY = 13;

interface Ring { x: number; y: number; life: number; max: number; color: string; r: number }
interface Banner { text: string; sub: string; life: number; max: number; color: string }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<WhackView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const glyph = (theme.coin.ticker || theme.coin.name || "$").slice(0, 1).toUpperCase();
  let t = 0;
  let rings: Ring[] = [];
  let banner: Banner | null = null;
  let heartPop = [0, 0, 0];
  let comboPulse = 0;
  let redFlash = 0;
  let lastHearts = HEARTS;

  // ---------- helpers ----------
  function ellipse(x: number, y: number, rx: number, ry: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
    ctx.fill();
  }
  function circle(x: number, y: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function inkCircle(x: number, y: number, r: number, fill: string) {
    circle(x, y, r + 2, p.ink);
    circle(x, y, r, fill);
  }
  function eyes(x: number, y: number, gap: number, r: number, squashed: boolean, angry: boolean) {
    for (const s of [-1, 1]) {
      const ex = x + s * gap;
      if (squashed) {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(ex - r, y - r);
        ctx.lineTo(ex + r, y + r);
        ctx.moveTo(ex + r, y - r);
        ctx.lineTo(ex - r, y + r);
        ctx.stroke();
        continue;
      }
      circle(ex, y, r + 1, p.ink);
      circle(ex, y, r, "#ffffff");
      circle(ex + s * 0.5, y + 0.8, r * 0.5, p.ink);
      if (angry) {
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(ex - s * r * 1.3, y - r * 1.7);
        ctx.lineTo(ex + s * r * 0.9, y - r * 0.7);
        ctx.stroke();
      }
    }
  }
  function star(x: number, y: number, r: number, rot: number, fill: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TAU - Math.PI / 2;
      const rr = i % 2 ? r * 0.45 : r;
      ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fillStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
  }
  function heart(x: number, y: number, s: number, fill: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.bezierCurveTo(-10, -1, -6, -9, 0, -4);
    ctx.bezierCurveTo(6, -9, 10, -1, 0, 6);
    ctx.closePath();
    ctx.lineWidth = 3 / s;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-5, -4, 2.5, 2.5);
    ctx.restore();
  }

  // ---------- critters (origin = bottom centre at the hole rim, body goes up) ----------
  function drawBear(sq: boolean, wob: number) {
    const body = p.secondary;
    // ears
    inkCircle(-18, -50, 8, body);
    inkCircle(18, -50, 8, body);
    circle(-18, -50, 4, p.accent);
    circle(18, -50, 4, p.accent);
    // head/body blob
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(-28, -56, 56, 64, 24);
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.roundRect(-26, -54, 52, 60, 22);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.fillRect(-18, -48, 10, 4);
    // muzzle
    ellipse(0, -24, 13, 9, p.text);
    ellipse(0, -28, 5, 3.5, p.ink);
    // frown
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -16, 5, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
    eyes(0, -38, 10, 4, sq, true);
    // red-candle sign: a downward chart arrow on the belly
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(-14, -8 + wob);
    ctx.lineTo(-6, -2);
    ctx.lineTo(0, -6);
    ctx.lineTo(10, 3);
    ctx.stroke();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.moveTo(14, 6);
    ctx.lineTo(5, 5);
    ctx.lineTo(12, -2);
    ctx.closePath();
    ctx.fill();
  }

  function drawGhost(sq: boolean, wob: number) {
    const body = p.text;
    ctx.beginPath();
    ctx.moveTo(-24, 8);
    ctx.lineTo(-24, -32);
    ctx.arc(0, -32, 24, Math.PI, 0);
    ctx.lineTo(24, 8);
    for (let i = 0; i < 4; i++) {
      const x0 = 24 - i * 12;
      ctx.quadraticCurveTo(x0 - 6, 8 - 7 + Math.sin(t / 120 + i) * 2, x0 - 12, 8);
    }
    ctx.closePath();
    ctx.lineWidth = 4;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.fillStyle = body;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(-14, -46, 8, 4);
    eyes(0, -34, 9, 4.5, sq, false);
    // worried mouth
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(0, -20, 4, sq ? 2 : 5, 0, 0, TAU);
    ctx.fill();
    // paper hands: two flapping sheets
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 30, -18 + wob * s);
      ctx.rotate(s * (0.35 + Math.sin(t / 90) * 0.15));
      ctx.fillStyle = p.ink;
      ctx.fillRect(-8, -10, 16, 20);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-6.5, -8.5, 13, 17);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let l = 0; l < 3; l++) ctx.fillRect(-4.5, -5 + l * 4.5, 9, 1.4);
      ctx.restore();
    }
  }

  function drawRug(sq: boolean, wob: number) {
    // a rug rolled up like a carpet worm, peeking out
    ctx.save();
    ctx.rotate(wob * 0.02);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(-25, -62, 50, 72, 8);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.roundRect(-23, -60, 46, 68, 6);
    ctx.fill();
    // stripes
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = bricks[(i + 1) % bricks.length];
      ctx.fillRect(-23, -52 + i * 15, 46, 5);
    }
    // diamond pattern
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(7, -4);
    ctx.lineTo(0, 4);
    ctx.lineTo(-7, -4);
    ctx.closePath();
    ctx.fill();
    // fringe on top
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i++) {
      const x = -18 + i * 6;
      ctx.beginPath();
      ctx.moveTo(x, -62);
      ctx.lineTo(x + Math.sin(t / 100 + i) * 2, -70);
      ctx.stroke();
    }
    // sneaky face
    eyes(0, -36, 9, 4, sq, true);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    if (sq) {
      ctx.moveTo(-8, -22);
      ctx.lineTo(8, -22);
    } else {
      ctx.moveTo(-10, -25);
      ctx.quadraticCurveTo(0, -17, 12, -27);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawGold(sq: boolean) {
    const r = 24;
    const spin = Math.abs(Math.cos(t / 220));
    ctx.save();
    ctx.translate(0, -30);
    ctx.scale(sq ? 1 : 0.35 + 0.65 * spin, 1);
    inkCircle(0, 0, r, p.primary);
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, r - 5, 0, TAU);
    ctx.stroke();
    circle(-8, -8, 6, "rgba(255,255,255,0.55)");
    ctx.font = `bold 22px ${kit.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = p.ink;
    ctx.fillText(glyph, 1, 2);
    ctx.restore();
    // sparkles
    for (let i = 0; i < 3; i++) {
      const a = t / 300 + (i * TAU) / 3;
      const s = 3 + 2 * Math.sin(t / 80 + i * 2);
      star(Math.cos(a) * 32, -30 + Math.sin(a) * 26, s, a, "#ffffff");
    }
  }

  function drawBomb(sq: boolean) {
    inkCircle(0, -24, 22, p.ink);
    circle(-8, -32, 6, "rgba(255,255,255,0.3)");
    ctx.fillStyle = p.wall;
    ctx.fillRect(-6, -52, 12, 8);
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, -52);
    ctx.quadraticCurveTo(8, -62, 14, -58);
    ctx.stroke();
    if (!sq) {
      const f = 4 + Math.random() * 4;
      star(14, -58, f, t / 40, Math.random() < 0.5 ? p.accent : p.primary);
    }
    kit.text("BOOM", 0, -22, 9, p.accent);
  }

  function drawIce(sq: boolean) {
    ctx.save();
    ctx.translate(0, -30);
    ctx.rotate(Math.sin(t / 300) * 0.2);
    const c = bricks[3 % bricks.length];
    ctx.lineCap = "round";
    for (const [lw, col] of [[9, p.ink], [5, c], [2, "#ffffff"]] as [number, string][]) {
      ctx.lineWidth = lw;
      ctx.strokeStyle = col;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * TAU;
        const ex = Math.cos(a) * 24, ey = Math.sin(a) * 24;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(ex, ey);
        const bx = Math.cos(a) * 14, by = Math.sin(a) * 14;
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a + 0.8) * 8, by + Math.sin(a + 0.8) * 8);
        ctx.moveTo(bx, by);
        ctx.lineTo(bx + Math.cos(a - 0.8) * 8, by + Math.sin(a - 0.8) * 8);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (sq) circle(0, -30, 6, "#ffffff");
  }

  function drawFriend(hit: boolean, rise: number) {
    const s = 58;
    const spr = hit ? kit.sprites.sad : rise >= 1 ? kit.sprites.happy : kit.sprites.idle;
    ctx.drawImage(spr, -s / 2, -s + 6, s, s);
    if (!hit) kit.text("FRIEND", 0, -s - 4, 8, p.primary);
  }

  function drawCritter(kind: Kind, h: HoleView) {
    const sq = h.hitT >= 0;
    const wob = Math.sin(t / 110 + h.id) * 2;
    switch (kind) {
      case "bear": return drawBear(sq, wob);
      case "ghost": return drawGhost(sq, wob);
      case "rug": return drawRug(sq, wob);
      case "gold": return drawGold(sq);
      case "bomb": return drawBomb(sq);
      case "ice": return drawIce(sq);
      case "friend": return drawFriend(sq, h.rise);
    }
  }

  // ---------- holes ----------
  function moundBack(x: number, y: number) {
    ellipse(x, y + 6, HOLE_RX + 12, HOLE_RY + 12, p.ink);
    ellipse(x, y + 4, HOLE_RX + 10, HOLE_RY + 10, p.wall);
    ellipse(x - 10, y - 2, HOLE_RX - 6, HOLE_RY + 2, "rgba(255,255,255,0.08)");
    ellipse(x, y, HOLE_RX + 2, HOLE_RY + 2, p.ink);
    ellipse(x, y + 1, HOLE_RX, HOLE_RY, "rgba(0,0,0,0.55)");
  }
  function moundFront(x: number, y: number) {
    // front lip that hides the critter's base
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.ellipse(x, y + 4, HOLE_RX + 10, HOLE_RY + 10, 0, 0, Math.PI);
    ctx.lineTo(x - HOLE_RX - 2, y);
    ctx.ellipse(x, y, HOLE_RX + 2, HOLE_RY + 2, 0, Math.PI, 0, true);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(x, y + 4, HOLE_RX + 10, HOLE_RY + 10, 0, 0.05, Math.PI - 0.05);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(x, y, HOLE_RX + 2, HOLE_RY + 2, 0, 0, Math.PI);
    ctx.stroke();
    // little grass tufts
    ctx.fillStyle = p.primary;
    for (const dx of [-38, 30]) {
      ctx.fillRect(x + dx, y + 18, 3, 6);
      ctx.fillRect(x + dx + 4, y + 16, 3, 8);
      ctx.fillRect(x + dx + 8, y + 19, 3, 5);
    }
  }

  function drawHole(i: number, h: HoleView, v: WhackView) {
    const x = holeX(i);
    const y = holeY(i);
    moundBack(x, y);
    if (h.kind) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x - CELL_W / 2, y - CELL_H, CELL_W, CELL_H + 1);
      ctx.ellipse(x, y + 1, HOLE_RX, HOLE_RY, 0, 0, Math.PI);
      ctx.clip();
      const ease = 1 - (1 - h.rise) * (1 - h.rise);
      let sx = 1, sy = 1, dy = (1 - ease) * 80;
      if (h.hitT >= 0) {
        // squash then sink back down
        const k = h.hitT / HIT_ANIM;
        const s = Math.min(1, h.hitT / 4);
        sx = 1 + 0.4 * s;
        sy = 1 - 0.5 * s;
        dy = k > 0.55 ? ((k - 0.55) / 0.45) * 80 : 0;
      } else if (h.age >= 8 && h.age < 14) {
        // overshoot pop
        const o = Math.sin(((h.age - 8) / 6) * Math.PI) * 0.08;
        sx = 1 - o;
        sy = 1 + o;
      }
      ctx.translate(x, y + 4 + dy);
      ctx.scale(sx, sy);
      if (v.freeze > 0) ctx.globalAlpha = 0.95;
      drawCritter(h.kind, h);
      ctx.globalAlpha = 1;
      ctx.restore();
      // frost cap while frozen
      if (v.freeze > 0 && h.hitT < 0 && h.rise > 0.2) {
        ctx.fillStyle = "rgba(255,255,255,0.25)";
        ctx.beginPath();
        ctx.roundRect(x - 30, y - 70 * h.rise, 60, 70 * h.rise, 10);
        ctx.fill();
      }
    }
    moundFront(x, y);
    // timer pip for critters that are leaving soon (helps readability)
    if (h.kind && h.hitT < 0 && h.life - h.age < 14 && h.kind !== "friend") {
      ctx.globalAlpha = 0.6;
      kit.text("!", x + 36, y - 40, 12, p.accent);
      ctx.globalAlpha = 1;
    }
    // stars circling a squashed critter
    if (h.kind && h.hitT >= 0 && h.hitT < HIT_ANIM) {
      const n = h.kind === "friend" ? 3 : 4;
      for (let s = 0; s < n; s++) {
        const a = t / 140 + (s * TAU) / n;
        star(x + Math.cos(a) * 26, y - 44 + Math.sin(a) * 7, 5, a, h.kind === "friend" ? p.accent : p.primary);
      }
    }
  }

  // ---------- hammer ----------
  function drawHammer(x: number, y: number, ang: number, scale: number) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    ctx.rotate(ang);
    // pivot at the grip; head sits up-left
    ctx.fillStyle = p.ink;
    ctx.fillRect(-4, -54, 8, 58);
    ctx.fillStyle = p.text;
    ctx.fillRect(-2, -52, 4, 54);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (let i = 0; i < 3; i++) ctx.fillRect(-2, -10 + i * 5, 4, 2);
    kit.block(-24, -72, 48, 26, p.secondary, 5);
    ctx.fillStyle = p.accent;
    ctx.fillRect(-24, -66, 5, 14);
    ctx.fillRect(19, -66, 5, 14);
    ctx.restore();
  }

  function hammerPose(v: WhackView): { x: number; y: number; ang: number } {
    const sw = v.swing;
    let x: number, y: number;
    if (sw.t < 14) {
      x = sw.x;
      y = sw.y;
    } else if (v.ptrMode) {
      x = v.ptr.x;
      y = v.ptr.y;
    } else {
      x = holeX(v.cursor);
      y = holeY(v.cursor);
    }
    // swing angle: raised (-0.9) -> slam (0.35) in 3 frames, recover in 11
    let ang = -0.9 + Math.sin(t / 260) * 0.05;
    if (sw.t < 3) ang = -0.9 + (1.25 * (sw.t + 1)) / 3;
    else if (sw.t < 14) ang = 0.35 - (1.25 * (sw.t - 3)) / 11;
    return { x: x + 30, y: y + 10, ang };
  }

  // ---------- HUD ----------
  function drawTop(v: WhackView) {
    // clock bar
    const bx = 16, by = 52, bw = W - 32, bh = 16;
    const frac = v.timeLeft / RUN;
    kit.block(bx, by, bw, bh, p.wall, 6);
    const low = v.timeLeft < 10 * 60;
    const col = v.freeze > 0 ? bricks[3 % bricks.length] : low && Math.floor(t / 200) % 2 ? p.accent : p.primary;
    if (frac > 0) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.roundRect(bx + 3, by + 3, Math.max(4, (bw - 6) * frac), bh - 6, 4);
      ctx.fill();
    }
    kit.text(`${Math.ceil(v.timeLeft / 60)}s`, W / 2, by + bh / 2 + 1, 11, p.text);
    if (v.freeze > 0) kit.text("FROZEN", W - 46, by + 30, 10, "#ffffff");

    // hearts
    for (let i = 0; i < HEARTS; i++) {
      const pop = heartPop[i] > 0 ? 1 + 0.5 * Math.sin((heartPop[i] / 400) * Math.PI) : 1;
      heart(28 + i * 26, by + 34, 1.15 * pop, i < v.hearts ? p.accent : "rgba(0,0,0,0.35)");
    }

    // combo meter
    const cx = W / 2, cy = by + 66;
    if (v.combo >= 2) {
      const pulse = 1 + comboPulse * 0.3;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(pulse, pulse);
      kit.text(`${v.combo} COMBO`, 0, 0, 14, v.mult > 1 ? p.primary : p.text);
      ctx.restore();
      if (v.mult > 1) kit.text(`x${v.mult}`, cx + 78, cy, 16, bricks[(v.mult + 2) % bricks.length]);
    }
    // progress to next multiplier
    const seg = v.combo % 5;
    for (let i = 0; i < 5; i++) {
      const x = cx - 28 + i * 14;
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - 5, cy + 14, 10, 6);
      ctx.fillStyle = i < seg || v.mult === 5 ? p.primary : "rgba(255,255,255,0.12)";
      ctx.fillRect(x - 4, cy + 15, 8, 4);
    }
  }

  function drawField() {
    // grass panel behind the grid
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.roundRect(6, GRID_Y - 4, W - 12, ROWS * CELL_H + 12, 18);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let r = 0; r < ROWS; r++) for (let c = (r & 1); c < COLS; c += 2) ctx.fillRect(c * CELL_W + 8, GRID_Y + r * CELL_H, CELL_W - 16, CELL_H);
  }

  return {
    onEvents(events: readonly GameEvent[], v: WhackView) {
      for (const e of events) {
        const x = e.x ?? W / 2;
        const y = e.y ?? H / 2;
        switch (e.t) {
          case "hit": {
            const k = e.kind as Kind;
            const col = k === "bear" ? p.secondary : k === "ghost" ? p.text : k === "rug" ? p.accent : k === "gold" ? p.primary : bricks[3 % bricks.length];
            kit.fx.burst(x, y - 30, col, k === "gold" ? 22 : 12, 170);
            kit.fx.burst(x, y - 30, "#ffffff", 5, 220);
            const m = (e.mult as number) > 1 ? ` x${e.mult}` : "";
            kit.fx.popup(x, y - 70, `+${e.value as number}${m}`, k === "gold" ? p.primary : p.text);
            rings.push({ x, y: y - 30, life: 0, max: 260, color: col, r: 40 });
            if (!e.byBomb) kit.fx.addShake(k === "gold" ? 5 : 3);
            comboPulse = 1;
            if ((e.combo as number) % 5 === 0) {
              banner = { text: `x${e.mult as number}`, sub: "COMBO", life: 0, max: 800, color: p.primary };
            }
            if (k === "gold") banner = { text: "GOLDEN!", sub: "BONUS", life: 0, max: 900, color: p.primary };
            break;
          }
          case "ouch":
            kit.fx.flash();
            kit.fx.addShake(10);
            kit.fx.burst(x, y - 30, p.accent, 20, 200);
            kit.fx.popup(x, y - 70, `${e.value as number}`, p.accent);
            banner = { text: "NOT THE", sub: theme.mascot.name.toUpperCase() + "!", life: 0, max: 1000, color: p.accent };
            redFlash = 1;
            break;
          case "whiff":
            kit.fx.burst(x, y, p.wall, 8, 90, 300);
            if (e.broke) kit.fx.popup(x, y - 40, "MISS", p.text);
            break;
          case "escape":
            if (e.broke) kit.fx.popup(x, y - 50, "ESCAPED", p.text);
            break;
          case "safe":
            kit.fx.popup(x, y, `+${e.value as number}`, p.primary);
            break;
          case "heal":
            kit.fx.popup(x, y, "+1 HEART", p.accent);
            break;
          case "boom":
            kit.fx.flash("255,255,255");
            kit.fx.burst(x, y - 24, p.accent, 30, 260);
            kit.fx.burst(x, y - 24, p.primary, 20, 200);
            rings.push({ x, y: y - 24, life: 0, max: 400, color: p.accent, r: 160 });
            banner = { text: "BOOM", sub: "FUD CLEARED", life: 0, max: 900, color: p.accent };
            break;
          case "freeze":
            kit.fx.flash("200,240,255");
            kit.fx.burst(x, y - 30, "#ffffff", 24, 180, 120);
            banner = { text: "FREEZE", sub: "CLOCK STOPPED", life: 0, max: 900, color: "#ffffff" };
            break;
          case "go":
            banner = { text: "WHACK!", sub: "", life: 0, max: 700, color: p.primary };
            break;
          case "stage":
            banner = { text: "FASTER!", sub: `STAGE ${(e.stage as number) + 1}`, life: 0, max: 1000, color: p.accent };
            break;
          case "timeup":
            banner = { text: "TIME!", sub: `${v.score}`, life: 0, max: 99999, color: p.primary };
            for (let i = 0; i < 6; i++) kit.fx.burst(40 + Math.random() * (W - 80), H * 0.45, bricks[i % bricks.length], 14, 220);
            break;
          case "gameover":
            banner = { text: "REKT", sub: "OUT OF HEARTS", life: 0, max: 99999, color: p.accent };
            break;
        }
      }
      if (v.hearts < lastHearts) heartPop[v.hearts] = 400;
      else if (v.hearts > lastHearts) heartPop[v.hearts - 1] = 400;
      lastHearts = v.hearts;
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);
      drawField();
      for (let i = 0; i < v.holes.length; i++) drawHole(i, v.holes[i], v);

      // impact rings
      rings = rings.filter((r) => (r.life += dtMs) < r.max);
      for (const r of rings) {
        const k = r.life / r.max;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 4 * (1 - k) + 1;
        ctx.beginPath();
        ctx.ellipse(r.x, r.y, r.r * k + 8, (r.r * k + 8) * 0.6, 0, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // keyboard cursor
      if (!v.ptrMode && v.phase !== "over") {
        const x = holeX(v.cursor), y = holeY(v.cursor);
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -t / 40;
        ctx.beginPath();
        ctx.ellipse(x, y + 4, HOLE_RX + 16, HOLE_RY + 16, 0, 0, TAU);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // freeze tint
      if (v.freeze > 0) {
        ctx.fillStyle = `rgba(200,240,255,${0.12 * Math.min(1, v.freeze / 30)})`;
        ctx.fillRect(0, GRID_Y - 4, W, ROWS * CELL_H + 12);
        // frost corners
        ctx.strokeStyle = "rgba(255,255,255,0.4)";
        ctx.lineWidth = 2;
        for (const [cx, cy] of [[12, GRID_Y + 4], [W - 12, GRID_Y + 4], [12, GRID_Y + ROWS * CELL_H], [W - 12, GRID_Y + ROWS * CELL_H]]) {
          for (let i = 0; i < 3; i++) {
            const a = (i / 3) * Math.PI + t / 2000;
            ctx.beginPath();
            ctx.moveTo(cx - Math.cos(a) * 9, cy - Math.sin(a) * 9);
            ctx.lineTo(cx + Math.cos(a) * 9, cy + Math.sin(a) * 9);
            ctx.stroke();
          }
        }
      }

      drawTop(v);

      // hammer
      if (v.phase !== "over" || v.swing.t < 14) {
        const pose = hammerPose(v);
        if (v.swing.t < 3) {
          // motion smear
          ctx.globalAlpha = 0.25;
          drawHammer(pose.x, pose.y, pose.ang - 0.4, 0.9);
          ctx.globalAlpha = 1;
        }
        drawHammer(pose.x, pose.y, pose.ang, 0.9);
      }

      // bottom: mascot cheering + legend
      const bob = Math.sin(t / 300) * 2;
      const spr = v.phase === "over" && v.outOfHearts ? kit.sprites.sad : comboPulse > 0.3 || v.combo >= 10 ? kit.sprites.happy : kit.sprites.idle;
      ctx.drawImage(spr, 12, H - 50 + bob, 40, 40);
      kit.text(`DON'T BONK ${theme.mascot.name.toUpperCase()}`, 58, H - 30, 9, p.text, "left");
      comboPulse = Math.max(0, comboPulse - dtMs / 250);
      heartPop = heartPop.map((h) => Math.max(0, h - dtMs));

      kit.fx.draw(kit, dtMs);

      // red vignette on a friendly bonk
      if (redFlash > 0) {
        ctx.strokeStyle = `rgba(255,40,80,${0.5 * redFlash})`;
        ctx.lineWidth = 18;
        ctx.strokeRect(0, 0, W, H);
        redFlash = Math.max(0, redFlash - dtMs / 600);
      }

      // intro
      if (v.phase === "intro") {
        const k = v.phaseT / INTRO;
        ctx.save();
        ctx.translate(W / 2, H * 0.42);
        const s = 1 + 0.15 * Math.sin(k * Math.PI * 3);
        ctx.scale(s, s);
        kit.text("READY", 0, 0, 34, p.primary);
        ctx.restore();
        kit.text("WHACK THE FUD", W / 2, H * 0.42 + 36, 12, p.text);
      }

      // banner
      if (banner) {
        banner.life += dtMs;
        const k = banner.life / banner.max;
        if (k >= 1) banner = null;
        else {
          const inK = Math.min(1, banner.life / 160);
          const s = 0.4 + 0.6 * (1 - (1 - inK) * (1 - inK)) + (inK < 1 ? 0 : 0.04 * Math.sin(banner.life / 60));
          ctx.save();
          ctx.globalAlpha = banner.max > 5000 ? 1 : Math.min(1, (1 - k) * 4);
          ctx.translate(W / 2, H * 0.44);
          ctx.scale(s, s);
          if (banner.max > 5000) {
            ctx.fillStyle = "rgba(0,0,0,0.45)";
            ctx.fillRect(-W / 2, -46, W, 92);
          }
          kit.text(banner.text, 0, -6, 30, banner.color);
          if (banner.sub) kit.text(banner.sub, 0, 26, 14, p.text);
          ctx.restore();
          ctx.globalAlpha = 1;
        }
      }
    },
  };
}
