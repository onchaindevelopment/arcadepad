// Moon Digger renderer: moon-dust cave with a scrolling camera, crater-pocked
// moon rocks, spinning coins, a portal exit, the mascot digger, a bear and a
// ghost. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BEAR, BOOM, BRICK, CELL, COIN, COLS, DUST, EXIT, FIELD_H, FIELD_W, GHOST, INTRO_T, PLAYER, ROCK, ROWS, STEEL, VIEW_H, VIEW_W, VIEW_Y,
  type DiggerView,
} from "./index.ts";

const TAU = Math.PI * 2;
const CAVE_W = COLS * CELL;

function rgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}
function hash(i: number): number {
  let h = Math.imul(i ^ 0x5bd1e995, 0x27d4eb2d);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<DiggerView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const glyph = (theme.coin.ticker || "$").charAt(0);
  let t = 0;
  let camX = 0;
  let snap = true;
  let happyMs = 0;
  let timeUp = false;
  let lastLevel = -1;

  function circle(x: number, y: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }
  function outlinedCircle(x: number, y: number, r: number, fill: string) {
    circle(x, y, r + 1.5, p.ink);
    circle(x, y, r, fill);
  }
  const cx = (i: number) => (i % COLS) * CELL + CELL / 2;
  const cy = (i: number) => Math.floor(i / COLS) * CELL + CELL / 2;

  // ---------- tiles ----------
  function drawDust(i: number, x: number, y: number) {
    ctx.fillStyle = `rgba(${rgb(p.wall)},0.85)`;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.fillStyle = `rgba(255,255,255,0.07)`;
    ctx.fillRect(x, y, CELL, 2);
    for (let k = 0; k < 3; k++) {
      const hx = hash(i * 3 + k);
      const hy = hash(i * 7 + k * 13);
      const s = 1 + Math.floor(hash(i * 11 + k) * 2.5);
      ctx.fillStyle = k === 0 ? `rgba(255,255,255,0.14)` : `rgba(${rgb(p.ink)},0.28)`;
      ctx.fillRect(x + 2 + Math.floor(hx * (CELL - 6)), y + 2 + Math.floor(hy * (CELL - 6)), s, s);
    }
  }
  function drawSteel(x: number, y: number) {
    kit.block(x, y, CELL, CELL, p.wall, 3);
    ctx.fillStyle = `rgba(${rgb(p.ink)},0.55)`;
    for (const [dx, dy] of [[5, 5], [CELL - 7, 5], [5, CELL - 7], [CELL - 7, CELL - 7]]) ctx.fillRect(x + dx, y + dy, 2, 2);
  }
  function drawBrick(i: number, x: number, y: number) {
    ctx.fillStyle = p.ink;
    ctx.fillRect(x, y, CELL, CELL);
    ctx.fillStyle = p.secondary;
    const off = (Math.floor(i / COLS) & 1) * 6;
    for (let row = 0; row < 3; row++) {
      for (let k = -1; k < 3; k++) {
        const bx = x + k * 12 + (row & 1 ? 6 : 0) + off - (off ? 6 : 0);
        const x0 = Math.max(x + 1, bx + 1), x1 = Math.min(x + CELL - 1, bx + 11);
        if (x1 > x0) ctx.fillRect(x0, y + row * 8 + 1, x1 - x0, 6);
      }
    }
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(x + 1, y + 1, CELL - 2, 2);
  }
  function drawRock(x: number, y: number, seed: number, falling: boolean) {
    const r = CELL / 2 - 1;
    const wob = falling ? Math.sin(t / 40 + seed) * 0.08 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(wob);
    ctx.beginPath();
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * TAU;
      const rr = r * (0.84 + hash(seed * 17 + k) * 0.16);
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.94 + 1;
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = p.ink;
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.fillStyle = p.wall;
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.fill();
    // craters
    for (let k = 0; k < 3; k++) {
      const a = hash(seed * 5 + k) * TAU;
      const d = r * 0.45 * hash(seed * 9 + k);
      const cr = 1.5 + hash(seed * 3 + k * 7) * 2.2;
      circle(Math.cos(a) * d, Math.sin(a) * d, cr, `rgba(${rgb(p.ink)},0.3)`);
      circle(Math.cos(a) * d - 0.6, Math.sin(a) * d - 0.6, cr * 0.6, "rgba(255,255,255,0.18)");
    }
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-r * 0.5, -r * 0.6, r * 0.5, 2);
    ctx.restore();
  }
  function drawCoin(x: number, y: number, seed: number) {
    const spin = Math.cos(t / 260 + seed * 0.9);
    const sx = Math.max(0.18, Math.abs(spin));
    const r = 8.5;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, 1);
    circle(0, 0, r + 1.5, p.ink);
    circle(0, 0, r, p.accent);
    ctx.strokeStyle = `rgba(${rgb(p.ink)},0.35)`;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(0, 0, r - 2.5, 0, TAU);
    ctx.stroke();
    if (sx > 0.5) kit.text(glyph, 0, 1, 9, p.ink);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(-r * 0.55, -r * 0.6, r * 0.45, 2);
    ctx.restore();
    // twinkle
    const tw = (t / 900 + seed * 0.37) % 1;
    if (tw < 0.12) {
      const a = 1 - tw / 0.12;
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.fillRect(x + 4, y - 9, 1, 5);
      ctx.fillRect(x + 2, y - 7, 5, 1);
    }
  }
  function drawExit(i: number, open: boolean) {
    const x = (i % COLS) * CELL, y = Math.floor(i / COLS) * CELL;
    if (!open) {
      drawSteel(x, y);
      ctx.fillStyle = `rgba(${rgb(p.ink)},0.5)`;
      ctx.fillRect(x + 7, y + 6, CELL - 14, CELL - 9);
      ctx.fillStyle = `rgba(255,255,255,0.12)`;
      ctx.fillRect(x + 8, y + 7, CELL - 16, 2);
      return;
    }
    const mx = x + CELL / 2, my = y + CELL / 2;
    ctx.fillStyle = p.ink;
    ctx.fillRect(x, y, CELL, CELL);
    for (let k = 3; k >= 0; k--) {
      const ph = ((t / 500 + k / 4) % 1);
      circle(mx, my, 2 + ph * 10, k & 1 ? p.primary : `rgba(255,255,255,${0.9 - ph * 0.6})`);
    }
    ctx.strokeStyle = p.primary;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, CELL - 2, CELL - 2);
  }

  // ---------- creatures ----------
  function eyes(x: number, y: number, face: number, gap: number, r: number) {
    const lx = face === 1 ? 1.4 : face === 3 ? -1.4 : 0;
    const ly = face === 0 ? -1.2 : face === 2 ? 1.2 : 0;
    for (const s of [-1, 1]) {
      circle(x + s * gap, y, r, "#ffffff");
      circle(x + s * gap + lx, y + ly, r * 0.55, p.ink);
    }
  }
  function drawBear(x: number, y: number, face: number) {
    const s = CELL + 2;
    const c = p.secondary;
    const bob = Math.sin(t / 160 + x * 0.1) * 0.8;
    y += bob;
    outlinedCircle(x - s * 0.3, y - s * 0.28, s * 0.14, c);
    outlinedCircle(x + s * 0.3, y - s * 0.28, s * 0.14, c);
    outlinedCircle(x, y, s * 0.38, c);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.14, s * 0.16, s * 0.11, 0, 0, TAU);
    ctx.fill();
    circle(x, y + s * 0.09, s * 0.05, p.ink);
    eyes(x, y - s * 0.06, face, s * 0.14, s * 0.07);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.26, y - s * 0.2);
    ctx.lineTo(x - s * 0.07, y - s * 0.13);
    ctx.moveTo(x + s * 0.26, y - s * 0.2);
    ctx.lineTo(x + s * 0.07, y - s * 0.13);
    ctx.stroke();
  }
  function drawGhost(x: number, y: number, face: number) {
    const w = CELL * 0.42;
    y += Math.sin(t / 220 + x * 0.05) * 1.6;
    const bot = y + CELL * 0.4;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x - w, bot);
      ctx.lineTo(x - w, y - 2);
      ctx.arc(x, y - 2, w, Math.PI, 0);
      ctx.lineTo(x + w, bot);
      const waves = 4;
      for (let k = 0; k < waves; k++) {
        const x0 = x + w - (k * 2 * w) / waves;
        const x1 = x0 - (2 * w) / waves;
        const ph = Math.sin(t / 120 + k) * 1.5;
        ctx.quadraticCurveTo((x0 + x1) / 2, bot - 4 + ph, x1, bot);
      }
      ctx.closePath();
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    path();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.92)";
    ctx.fill();
    ctx.fillStyle = `rgba(${rgb(p.primary)},0.25)`;
    ctx.fill();
    const lx = face === 1 ? 1.6 : face === 3 ? -1.6 : 0;
    const ly = face === 0 ? -1.4 : face === 2 ? 1.4 : 0;
    for (const s of [-1, 1]) {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.ellipse(x + s * 3.6 + lx, y - 2 + ly, 2, 3, 0, 0, TAU);
      ctx.fill();
    }
    // tiny coin glint: it's full of treasure
    circle(x, y + 5, 1.6, p.accent);
  }
  function drawPlayer(x: number, y: number, v: DiggerView, moving: boolean) {
    const sprite = happyMs > 0 || v.phase === "clear" || v.phase === "won" ? kit.sprites.happy : kit.sprites.mini;
    const s = CELL + 6;
    let ox = 0, oy = 0;
    if (moving) oy = -Math.abs(Math.sin(v.t * Math.PI)) * 2.5;
    else oy = Math.sin(t / 300) * 0.8;
    if (v.pushing) ox = v.face === 1 ? 2.5 : v.face === 3 ? -2.5 : 0;
    // shadow
    ctx.fillStyle = `rgba(${rgb(p.ink)},0.35)`;
    ctx.beginPath();
    ctx.ellipse(x, y + CELL / 2 - 2, 8, 2.5, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    ctx.translate(x + ox, y + oy);
    if (v.face === 3) ctx.scale(-1, 1);
    ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
    ctx.restore();
  }
  function drawBoom(i: number, v: DiggerView) {
    const x = cx(i), y = cy(i);
    const k = (v.boomT[i] + v.t) / 3;
    const r = 6 + k * 10;
    ctx.globalAlpha = Math.max(0, 1 - k * 0.7);
    circle(x, y, r + 2, p.ink);
    circle(x, y, r, p.accent);
    circle(x, y, r * 0.65, p.primary);
    circle(x, y, r * 0.3, "#ffffff");
    ctx.fillStyle = "#ffffff";
    for (let a = 0; a < 4; a++) {
      const ang = a * (TAU / 4) + t / 200 + i;
      ctx.fillRect(x + Math.cos(ang) * (r + 3) - 1, y + Math.sin(ang) * (r + 3) - 1, 2, 2);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- HUD + overlays ----------
  function drawHud(v: DiggerView) {
    ctx.fillStyle = `rgba(${rgb(p.ink)},0.75)`;
    ctx.fillRect(0, 0, FIELD_W, VIEW_Y - 4);
    ctx.fillStyle = p.wall;
    ctx.fillRect(0, VIEW_Y - 4, FIELD_W, 2);
    // coins
    const met = v.coins >= v.need;
    const bounce = happyMs > 0 ? Math.sin((happyMs / 300) * Math.PI) * 2 : 0;
    drawCoin(18, 19 - bounce, 0);
    kit.text(`${Math.min(v.coins, 999)}/${v.need}`, 33, 20, 14, met ? p.primary : p.text, "left");
    // cave
    kit.text(`CAVE ${v.level + 1}`, FIELD_W / 2, 20, 14, p.text);
    // timer
    const secs = Math.ceil(v.timeLeft / 60);
    const clock = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
    const hurry = secs <= 10 && v.phase === "play";
    const pulse = hurry ? 1 + Math.max(0, Math.sin(t / 80)) * 0.15 : 1;
    kit.text(clock, FIELD_W - 12, 20, Math.round(14 * pulse), hurry ? p.accent : p.text, "right");
    // lives + score
    for (let k = 0; k < v.lives; k++) ctx.drawImage(kit.sprites.mini, 10 + k * 20, 34, 16, 16);
    kit.text(met ? "EXIT OPEN!" : `${v.need - v.coins} TO GO`, FIELD_W / 2, 43, 10, met ? p.primary : `rgba(${rgb(p.text)},0.7)`);
    kit.text(String(v.score), FIELD_W - 12, 43, 12, p.primary, "right");
  }

  function banner(lines: { s: string; size: number; c: string }[]) {
    const midY = VIEW_Y + VIEW_H / 2;
    const hgt = lines.reduce((a, l) => a + l.size + 12, 12);
    ctx.fillStyle = `rgba(${rgb(p.ink)},0.72)`;
    ctx.fillRect(0, midY - hgt / 2, FIELD_W, hgt);
    let y = midY - hgt / 2 + 12;
    for (const l of lines) {
      kit.text(l.s, FIELD_W / 2, y + l.size / 2, l.size, l.c);
      y += l.size + 12;
    }
  }

  function drawOverlay(v: DiggerView) {
    const pop = Math.min(1, v.phaseT / 12);
    if (v.phase === "intro") {
      banner([
        { s: `CAVE ${v.level + 1}`, size: Math.max(1, Math.round(26 * pop)), c: p.primary },
        { s: `COLLECT ${v.need} COINS`, size: 13, c: p.text },
        { s: v.phaseT < INTRO_T * 0.7 ? "WATCH FOR FALLING ROCKS" : "GO!", size: 10, c: p.accent },
      ]);
      kit.text("HOLD ARROWS OR SWIPE TO DIG", FIELD_W / 2, FIELD_H - 26, 9, `rgba(${rgb(p.text)},0.75)`);
    } else if (v.phase === "dead") {
      banner([
        { s: timeUp ? "TIME UP!" : "SQUASHED!", size: Math.max(1, Math.round(24 * pop)), c: p.accent },
        { s: v.lives > 0 ? `${v.lives} ${v.lives === 1 ? "LIFE" : "LIVES"} LEFT` : "NO LIVES LEFT", size: 12, c: p.text },
      ]);
    } else if (v.phase === "clear") {
      banner([
        { s: "CAVE CLEAR!", size: Math.max(1, Math.round(24 * pop)), c: p.primary },
        { s: `BONUS +${v.bonus}`, size: 13, c: p.accent },
        { s: `SCORE ${v.score}`, size: 11, c: p.text },
      ]);
    } else if (v.phase === "over") {
      banner([
        { s: "GAME OVER", size: Math.max(1, Math.round(26 * pop)), c: p.accent },
        { s: `SCORE ${v.score}`, size: 14, c: p.text },
      ]);
    } else if (v.phase === "won") {
      banner([
        { s: "MOON CONQUERED!", size: Math.max(1, Math.round(22 * pop)), c: p.primary },
        { s: `SCORE ${v.score}`, size: 14, c: p.text },
      ]);
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const x = e.x ?? 0, y = e.y ?? 0;
        switch (e.t) {
          case "coin":
            kit.fx.burst(x, y, p.accent, 10, 120, 300);
            kit.fx.popup(x, y - 10, `+${e.points as number}`, p.accent);
            happyMs = 300;
            break;
          case "dig":
            kit.fx.burst(x, y, p.wall, 4, 50, 200);
            break;
          case "thud":
            kit.fx.burst(x, y + CELL / 2, "#ffffff", 5, 60, 300);
            break;
          case "clink":
            kit.fx.burst(x, y, p.accent, 3, 50, 300);
            break;
          case "push":
            kit.fx.burst(x, y + CELL / 2, p.wall, 6, 70, 300);
            break;
          case "boom":
            kit.fx.addShake(e.shake ?? 7);
            kit.fx.burst(x, y, p.accent, 22, 220, 260);
            kit.fx.burst(x, y, "#ffffff", 10, 160, 200);
            if (e.coins) kit.fx.burst(x, y, p.primary, 14, 180, 300);
            break;
          case "crush":
            kit.fx.popup(x, y - 14, `+${e.points as number}`, p.primary);
            break;
          case "open":
            kit.fx.flash(rgb(p.primary));
            kit.fx.burst(x, y, p.primary, 24, 200, 200);
            kit.fx.popup(x, y - 16, "EXIT OPEN", p.primary);
            break;
          case "timeup":
            timeUp = true;
            break;
          case "die":
            kit.fx.flash();
            kit.fx.addShake(10);
            break;
          case "clear":
            for (let k = 0; k < 4; k++) kit.fx.burst(x + (k - 1.5) * 12, y, p.bricks[k % p.bricks.length] ?? p.primary, 14, 220, 300);
            happyMs = 1200;
            break;
          case "won":
            for (let k = 0; k < 6; k++) kit.fx.burst(camX + Math.random() * VIEW_W, cy(v.player), p.bricks[k % p.bricks.length] ?? p.accent, 14, 240);
            break;
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      happyMs = Math.max(0, happyMs - dtMs);
      if (v.level !== lastLevel || (v.phase === "intro" && v.phaseT < 3)) {
        snap = true;
        lastLevel = v.level;
        timeUp = false;
      }
      if (v.phase === "intro") timeUp = false;
      kit.background(dtMs);

      // Interpolated player position drives the camera.
      const g = v.grid;
      const lerpPos = (i: number) => {
        const f = v.from[i];
        if (f < 0) return [cx(i), cy(i)];
        const k = Math.min(1, v.t);
        return [cx(f) + (cx(i) - cx(f)) * k, cy(f) + (cy(i) - cy(f)) * k];
      };
      const [px] = lerpPos(v.player);
      const target = Math.max(0, Math.min(CAVE_W - VIEW_W, px - VIEW_W / 2));
      if (snap) { camX = target; snap = false; }
      else camX += (target - camX) * Math.min(1, dtMs * 0.008);
      const cam = Math.round(camX);

      ctx.save();
      ctx.beginPath();
      ctx.rect(0, VIEW_Y, VIEW_W, VIEW_H);
      ctx.clip();
      ctx.translate(-cam, VIEW_Y);
      // cave darkness
      ctx.fillStyle = `rgba(${rgb(p.bg)},0.55)`;
      ctx.fillRect(cam, 0, VIEW_W, VIEW_H);

      const c0 = Math.max(0, Math.floor(cam / CELL) - 1);
      const c1 = Math.min(COLS - 1, Math.ceil((cam + VIEW_W) / CELL) + 1);
      // static layer
      for (let r = 0; r < ROWS; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * COLS + c;
          const x = c * CELL, y = r * CELL;
          const cell = g[i];
          if (cell === DUST) drawDust(i, x, y);
          else if (cell === STEEL) drawSteel(x, y);
          else if (cell === BRICK) drawBrick(i, x, y);
          else if (cell === EXIT) drawExit(i, v.exitOpen);
        }
      }
      // objects (interpolated)
      for (let r = 0; r < ROWS; r++) {
        for (let c = c0; c <= c1; c++) {
          const i = r * COLS + c;
          const cell = g[i];
          if (cell === ROCK || cell === COIN || cell === BEAR || cell === GHOST) {
            const [x, y] = lerpPos(i);
            // Looks keyed by column only, so falling things don't change shape.
            if (cell === ROCK) drawRock(x, y, 3 + (c % 3), v.falling[i] === 1);
            else if (cell === COIN) drawCoin(x, y, c);
            else if (cell === BEAR) drawBear(x, y, v.dirs[i]);
            else drawGhost(x, y, v.dirs[i]);
          }
        }
      }
      if (g[v.player] === PLAYER) {
        const [x, y] = lerpPos(v.player);
        drawPlayer(x, y, v, v.from[v.player] >= 0);
      }
      for (let r = 0; r < ROWS; r++) for (let c = c0; c <= c1; c++) if (g[r * COLS + c] === BOOM) drawBoom(r * COLS + c, v);
      kit.fx.draw(kit, dtMs);
      ctx.restore();

      // Exit arrow when the open exit is off screen.
      if (v.exitOpen && v.phase === "play") {
        const ex = cx(v.exit) - cam, ey = cy(v.exit) + VIEW_Y;
        if (ex < 0 || ex > VIEW_W) {
          const right = ex > VIEW_W;
          const ax = right ? VIEW_W - 14 : 14;
          const bob = Math.sin(t / 150) * 3 * (right ? 1 : -1);
          ctx.fillStyle = p.ink;
          ctx.beginPath();
          const dir = right ? 1 : -1;
          ctx.moveTo(ax + bob + dir * 10, ey);
          ctx.lineTo(ax + bob - dir * 6, ey - 10);
          ctx.lineTo(ax + bob - dir * 6, ey + 10);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = p.primary;
          ctx.beginPath();
          ctx.moveTo(ax + bob + dir * 7, ey);
          ctx.lineTo(ax + bob - dir * 4, ey - 7);
          ctx.lineTo(ax + bob - dir * 4, ey + 7);
          ctx.closePath();
          ctx.fill();
        }
      }
      // Low-time vignette
      if (v.phase === "play" && v.timeLeft <= 10 * 60) {
        ctx.fillStyle = `rgba(${rgb(p.accent)},${0.06 + 0.06 * Math.max(0, Math.sin(t / 120))})`;
        ctx.fillRect(0, VIEW_Y, VIEW_W, VIEW_H);
      }
      drawHud(v);
      drawOverlay(v);
    },
  };
}
