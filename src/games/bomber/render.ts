// Blast Grid renderer: chunky pillar grid, loot crates, coin-bombs with
// fuses, glowing + blasts, the mascot against bear, ghost and rug rivals.
// Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BASE_SPEED, BOMB_T, BURNING, CELL, COLS, CRATE, FIELD_H, FIELD_W, FLAME_T, INTRO_T, ITEM_BOMB, ITEM_FIRE, NAMES, OX, OY, PILLAR, ROWS, SUB, WINS_NEEDED,
  type ActorView, type BomberView,
} from "./index.ts";

const TAU = Math.PI * 2;
const BW = COLS * CELL;
const BH = ROWS * CELL;

function rgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BomberView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const glyph = (theme.coin.ticker || "$").charAt(0);
  const rivalColor = [p.primary, p.secondary, "#ffffff", p.accent];
  let t = 0;

  // ---------- small drawing helpers ----------
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
  function eyes(x: number, y: number, face: number, gap: number, r: number, white = true) {
    const lx = face === 1 ? 1.5 : face === 3 ? -1.5 : 0;
    const ly = face === 0 ? -1.2 : face === 2 ? 1.2 : 0;
    for (const s of [-1, 1]) {
      if (white) circle(x + s * gap, y, r, "#ffffff");
      circle(x + s * gap + lx, y + ly, r * 0.55, p.ink);
    }
  }

  function drawBear(x: number, y: number, s: number, face: number, alive: boolean) {
    const c = rivalColor[1];
    outlinedCircle(x - s * 0.32, y - s * 0.3, s * 0.15, c);
    outlinedCircle(x + s * 0.32, y - s * 0.3, s * 0.15, c);
    circle(x - s * 0.32, y - s * 0.3, s * 0.07, `rgba(${rgb(p.ink)},0.35)`);
    circle(x + s * 0.32, y - s * 0.3, s * 0.07, `rgba(${rgb(p.ink)},0.35)`);
    outlinedCircle(x, y, s * 0.4, c);
    // snout
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(x, y + s * 0.14, s * 0.17, s * 0.12, 0, 0, TAU);
    ctx.fill();
    circle(x, y + s * 0.09, s * 0.05, p.ink);
    if (alive) {
      eyes(x, y - s * 0.06, face, s * 0.15, s * 0.07);
      // grumpy brows: it's a bear market
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - s * 0.27, y - s * 0.2);
      ctx.lineTo(x - s * 0.07, y - s * 0.13);
      ctx.moveTo(x + s * 0.27, y - s * 0.2);
      ctx.lineTo(x + s * 0.07, y - s * 0.13);
      ctx.stroke();
    } else xEyes(x, y - s * 0.06, s * 0.15);
  }

  function drawGhost(x: number, y: number, s: number, face: number, alive: boolean) {
    const w = s * 0.4;
    const bot = y + s * 0.36;
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(x - w, bot);
      ctx.lineTo(x - w, y - s * 0.05);
      ctx.arc(x, y - s * 0.05, w, Math.PI, 0);
      ctx.lineTo(x + w, bot);
      const bumps = 4;
      for (let k = 0; k < bumps; k++) {
        const x1 = x + w - ((k + 0.5) * 2 * w) / bumps;
        const x2 = x + w - ((k + 1) * 2 * w) / bumps;
        const dy = Math.sin(t / 120 + k * 1.7) * 2.5;
        ctx.quadraticCurveTo(x1, bot - 6 + dy, x2, bot);
      }
      ctx.closePath();
    };
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    path();
    ctx.stroke();
    ctx.globalAlpha *= 0.92;
    ctx.fillStyle = rivalColor[2];
    path();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = `rgba(${rgb(p.secondary)},0.25)`;
    ctx.fillRect(x - w + 2, y + s * 0.1, w * 2 - 4, 2);
    if (alive) {
      // hollow eyes
      const lx = face === 1 ? 1.5 : face === 3 ? -1.5 : 0;
      for (const sx of [-1, 1]) {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.ellipse(x + sx * s * 0.15 + lx, y - s * 0.08, s * 0.08, s * 0.12, 0, 0, TAU);
        ctx.fill();
      }
      circle(x + lx, y + s * 0.14, s * 0.05, p.ink);
    } else xEyes(x, y - s * 0.08, s * 0.15);
  }

  function drawRug(x: number, y: number, s: number, face: number, alive: boolean) {
    const w = s * 0.42;
    const h = s * 0.3;
    // flying carpet: wavy body with fringe
    ctx.save();
    ctx.translate(x, y);
    const wave = (u: number) => Math.sin(t / 140 + u * 3) * 2.2;
    const shape = () => {
      ctx.beginPath();
      const n = 8;
      for (let k = 0; k <= n; k++) {
        const u = k / n;
        const px = -w + u * 2 * w;
        if (k === 0) ctx.moveTo(px, -h + wave(u));
        else ctx.lineTo(px, -h + wave(u));
      }
      for (let k = n; k >= 0; k--) {
        const u = k / n;
        ctx.lineTo(-w + u * 2 * w, h + wave(u));
      }
      ctx.closePath();
    };
    ctx.lineWidth = 3;
    ctx.strokeStyle = p.ink;
    shape();
    ctx.stroke();
    ctx.fillStyle = rivalColor[3];
    shape();
    ctx.fill();
    // pattern stripes
    ctx.fillStyle = `rgba(${rgb(p.primary)},0.8)`;
    for (const k of [-0.6, 0.6]) {
      const u = (k + 1) / 2;
      ctx.fillRect(k * w - 1.5, -h + wave(u) + 2, 3, 2 * h - 4);
    }
    // fringe
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1;
    for (const side of [-1, 1]) {
      const u = side < 0 ? 0 : 1;
      for (let k = -2; k <= 2; k++) {
        const yy = (k * h) / 2.5 + wave(u);
        ctx.beginPath();
        ctx.moveTo(side * w, yy);
        ctx.lineTo(side * (w + 4), yy + Math.sin(t / 90 + k) * 1.2);
        ctx.stroke();
      }
    }
    ctx.restore();
    if (alive) {
      eyes(x, y - 1 + wave(0.5), face, s * 0.13, s * 0.08);
      // sly grin
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y + s * 0.06, s * 0.1, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();
    } else xEyes(x, y - 1, s * 0.13);
  }

  function xEyes(x: number, y: number, gap: number) {
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    for (const s of [-1, 1]) {
      const ex = x + s * gap;
      ctx.beginPath();
      ctx.moveTo(ex - 2.5, y - 2.5);
      ctx.lineTo(ex + 2.5, y + 2.5);
      ctx.moveTo(ex + 2.5, y - 2.5);
      ctx.lineTo(ex - 2.5, y + 2.5);
      ctx.stroke();
    }
  }

  function drawActor(a: ActorView | { id: number; alive: boolean; face: number }, x: number, y: number, s: number, mood: "idle" | "happy" | "sad" = "idle") {
    if (a.id === 0) {
      const sprite = !a.alive || mood === "sad" ? kit.sprites.sad : mood === "happy" ? kit.sprites.happy : kit.sprites.mini;
      const sz = mood === "idle" && a.alive ? s * 1.05 : s * 1.2;
      ctx.drawImage(sprite, x - sz / 2, y - sz / 2, sz, sz);
    } else if (a.id === 1) drawBear(x, y, s, a.face, a.alive);
    else if (a.id === 2) drawGhost(x, y, s, a.face, a.alive);
    else drawRug(x, y, s, a.face, a.alive);
  }

  function itemIcon(kind: number, x: number, y: number, r: number) {
    const fill = kind === ITEM_BOMB ? p.secondary : kind === ITEM_FIRE ? p.accent : p.primary;
    ctx.save();
    ctx.shadowColor = fill;
    ctx.shadowBlur = 8;
    outlinedCircle(x, y, r, fill);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.4)";
    ctx.fillRect(x - r * 0.5, y - r * 0.6, r * 0.6, 1.5);
    if (kind === ITEM_BOMB) {
      circle(x, y + 1, r * 0.48, p.ink);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x + r * 0.25, y - r * 0.3);
      ctx.quadraticCurveTo(x + r * 0.5, y - r * 0.8, x + r * 0.7, y - r * 0.55);
      ctx.stroke();
      circle(x + r * 0.7, y - r * 0.55, 1.5, "#ffffff");
    } else if (kind === ITEM_FIRE) {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.moveTo(x, y - r * 0.7);
      ctx.quadraticCurveTo(x + r * 0.7, y, x, y + r * 0.6);
      ctx.quadraticCurveTo(x - r * 0.7, y, x, y - r * 0.7);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y + r * 0.22, r * 0.2, 0, TAU);
      ctx.fill();
    } else {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      for (const ox of [-r * 0.3, r * 0.15]) {
        ctx.beginPath();
        ctx.moveTo(x + ox - r * 0.15, y - r * 0.4);
        ctx.lineTo(x + ox + r * 0.2, y);
        ctx.lineTo(x + ox - r * 0.15, y + r * 0.4);
        ctx.stroke();
      }
    }
  }

  function drawBomb(cx: number, cy: number, timer: number, owner: number) {
    const left = timer / BOMB_T;
    const rate = 160 + left * 260;
    const pulse = 1 + Math.sin(t / (rate / TAU)) * (0.06 + (1 - left) * 0.08);
    const r = CELL * 0.36 * pulse;
    // shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + CELL * 0.33, r * 0.9, r * 0.3, 0, 0, TAU);
    ctx.fill();
    const hot = left < 0.25 && Math.floor(t / 70) % 2 === 0;
    outlinedCircle(cx, cy, r, hot ? "#ffffff" : p.accent);
    circle(cx, cy, r * 0.72, hot ? p.accent : `rgba(${rgb(p.ink)},0.18)`);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(cx - r * 0.55, cy - r * 0.6, r * 0.5, 2);
    kit.text(glyph, cx, cy + 1, Math.round(r * 1.05), owner === 0 ? p.primary : p.text);
    // fuse + spark
    const fx = cx + r * 0.7;
    const fy = cy - r * 0.75;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.45, cy - r * 0.55);
    ctx.quadraticCurveTo(fx + 2, fy - 2, fx + 4 * left, fy - 4 - 2 * left);
    ctx.stroke();
    const sx = fx + 4 * left;
    const sy = fy - 4 - 2 * left;
    const fl = 2 + Math.random() * 2;
    circle(sx, sy, fl + 1, p.primary);
    circle(sx, sy, fl * 0.5, "#ffffff");
    if (Math.random() < 0.3) kit.fx.burst(sx, sy, p.primary, 1, 40, 120);
  }

  function drawFlame(i: number, f: number, kind: number) {
    const x = OX + (i % COLS) * CELL;
    const y = OY + Math.floor(i / COLS) * CELL;
    const life = f / FLAME_T;
    const a = Math.min(1, life * 2.2);
    const grow = life > 0.85 ? (1 - life) / 0.15 : 1;
    const w0 = CELL * (0.35 + 0.45 * grow) * (0.85 + 0.15 * Math.sin(t / 40 + i));
    ctx.globalAlpha = a;
    const layers: [string, number][] = [[p.accent, 1], [p.primary, 0.66], ["#ffffff", 0.3]];
    for (const [col, k] of layers) {
      ctx.fillStyle = col;
      const w = w0 * k;
      if (kind & 1) ctx.fillRect(x - 0.5, y + CELL / 2 - w / 2, CELL + 1, w);
      if (kind & 2) ctx.fillRect(x + CELL / 2 - w / 2, y - 0.5, w, CELL + 1);
      if (kind === 3) {
        ctx.beginPath();
        ctx.arc(x + CELL / 2, y + CELL / 2, w * 0.75, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  // ---------- static board layer ----------
  const floor = document.createElement("canvas");
  floor.width = BW * RENDER_SCALE;
  floor.height = BH * RENDER_SCALE;
  {
    const c = floor.getContext("2d")!;
    c.scale(RENDER_SCALE, RENDER_SCALE);
    c.fillStyle = p.bg;
    c.fillRect(0, 0, BW, BH);
    for (let r = 0; r < ROWS; r++)
      for (let k = 0; k < COLS; k++) {
        c.fillStyle = (r + k) % 2 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.02)";
        c.fillRect(k * CELL, r * CELL, CELL, CELL);
        c.fillStyle = "rgba(0,0,0,0.12)";
        c.fillRect(k * CELL, r * CELL + CELL - 1, CELL, 1);
      }
  }

  // ---------- events ----------
  function cellXY(i: number): [number, number] {
    return [OX + ((i % COLS) + 0.5) * CELL, OY + (Math.floor(i / COLS) + 0.5) * CELL];
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        const x = e.x as number;
        const y = e.y as number;
        switch (e.t) {
          case "boom":
            kit.fx.burst(x, y, p.primary, 14, 170, 60);
            kit.fx.burst(x, y, p.accent, 10, 110, 30);
            break;
          case "blast":
            kit.fx.addShake(Math.min(12, 3 + (e.n as number) * 2));
            break;
          case "crate":
            kit.fx.burst(x, y, bricks[Math.floor(Math.random() * bricks.length)], 10, 140, 380);
            if (e.pts) kit.fx.popup(x, y - 8, `+${e.pts}`, p.text);
            break;
          case "pickup": {
            const label = e.kind === ITEM_BOMB ? "BOMB+" : e.kind === ITEM_FIRE ? "FIRE+" : "SPEED+";
            kit.fx.burst(x, y, p.primary, 12, 120, 0);
            kit.fx.popup(x, y - 10, label, e.who === 0 ? p.primary : p.text);
            break;
          }
          case "reveal":
            kit.fx.burst(x, y, "#ffffff", 6, 60, 0);
            break;
          case "itemBurn":
            kit.fx.burst(x, y, p.ink, 6, 80, 100);
            break;
          case "out":
            kit.fx.burst(x, y, rivalColor[e.who as number] ?? p.primary, 26, 220, 300);
            kit.fx.burst(x, y, "#ffffff", 10, 140, 200);
            if (e.who === 0) kit.fx.flash();
            else if (e.pts) kit.fx.popup(x, y - 12, `KO +${e.pts}`, p.primary);
            else kit.fx.popup(x, y - 12, "OUT", p.text);
            break;
          case "roundWon":
          case "matchWon":
            for (let i = 0; i < 6; i++) kit.fx.burst(OX + Math.random() * BW, OY + Math.random() * BH, bricks[i % bricks.length], 12, 200, 200);
            kit.fx.flash(rgb(p.primary));
            break;
          case "hurry":
            kit.fx.flash(rgb(p.accent));
            break;
          case "close":
            kit.fx.burst(x, y, p.wall, 6, 90, 300);
            break;
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);

      // ---------- header ----------
      const me = v.actors[0];
      kit.text(`MATCH ${v.match}`, 12, 22, 12, p.primary, "left");
      kit.text(`ROUND ${v.round}`, FIELD_W / 2, 22, 12, p.text);
      const secs = Math.ceil(v.timeLeft / 60);
      const clock = v.hurry ? "HURRY!" : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
      const flashClock = v.hurry && Math.floor(t / 250) % 2 === 0;
      kit.text(clock, FIELD_W - 12, 22, 12, flashClock ? p.accent : p.text, "right");

      // roster cards
      const cw = 84;
      for (let k = 0; k < 4; k++) {
        const a = v.actors[k];
        const x = 6 + k * (cw + 4);
        const y = 42;
        ctx.globalAlpha = a.alive || v.phase !== "play" ? 1 : 0.45;
        kit.block(x, y, cw, 84, k === 0 ? p.wall : `rgba(${rgb(p.wall)},0.7)`, 6);
        const bob = a.alive ? Math.sin(t / 300 + k) * 1.5 : 0;
        drawActor({ id: k, alive: a.alive || v.phase !== "play", face: 2 }, x + cw / 2, y + 26 + bob, 30, k === 0 && v.phase === "roundEnd" && v.roundWinner === 0 ? "happy" : "idle");
        kit.text(NAMES[k], x + cw / 2, y + 52, 10, k === 0 ? p.primary : p.text);
        for (let w = 0; w < WINS_NEEDED; w++) {
          const px = x + cw / 2 + (w - 1) * 16;
          const on = w < a.wins;
          outlinedCircle(px, y + 70, 5, on ? p.accent : `rgba(${rgb(p.ink)},0.6)`);
          if (on) kit.text(glyph, px, y + 70.5, 7, p.ink);
        }
        ctx.globalAlpha = 1;
      }

      // ---------- board ----------
      kit.block(OX - 5, OY - 5, BW + 10, BH + 10, p.wall, 6);
      ctx.drawImage(floor, OX, OY, BW, BH);

      // next sudden-death cells blink
      if (v.hurry) {
        for (const i of v.nextClose) {
          const [x, y] = cellXY(i);
          ctx.fillStyle = `rgba(${rgb(p.accent)},${0.25 + 0.25 * Math.sin(t / 60)})`;
          ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
        }
      }

      // items
      for (let i = 0; i < v.item.length; i++) {
        if (!v.item[i] || v.grid[i] !== 0) continue;
        const [x, y] = cellXY(i);
        itemIcon(v.item[i], x, y + Math.sin(t / 220 + i) * 1.5, CELL * 0.33);
      }

      // pillars and crates
      for (let i = 0; i < v.grid.length; i++) {
        const g = v.grid[i];
        if (!g) continue;
        const x = OX + (i % COLS) * CELL;
        const y = OY + Math.floor(i / COLS) * CELL;
        if (g === PILLAR) {
          const closed = v.closedAt[i];
          let dy = 0;
          if (closed) {
            const age = v.frame - closed;
            dy = age < 10 ? -(10 - age) * 4 : 0;
          }
          kit.block(x + 1, y + 1 + dy, CELL - 2, CELL - 2, closed ? p.secondary : p.wall, 4);
          circle(x + CELL / 2, y + CELL / 2 + dy, 2.5, `rgba(${rgb(closed ? p.ink : p.secondary)},0.6)`);
        } else if (g === CRATE || g === BURNING) {
          const color = bricks[(i * 7 + 3) % bricks.length];
          const shrink = g === BURNING ? (1 - v.flame[i] / FLAME_T) * 8 : 0;
          if (g === BURNING) ctx.globalAlpha = Math.max(0, v.flame[i] / FLAME_T);
          const s = CELL - 4 - shrink;
          const bx = x + CELL / 2 - s / 2;
          const by = y + CELL / 2 - s / 2;
          kit.block(bx, by, s, s, color, 3);
          // planks + coin slot
          ctx.fillStyle = `rgba(${rgb(p.ink)},0.28)`;
          ctx.fillRect(bx + 3, by + s / 2 - 1, s - 6, 2);
          ctx.fillRect(bx + s / 2 - 3, by + s / 2 - 4, 6, 2);
          ctx.globalAlpha = 1;
        }
      }

      // bombs
      for (const b of v.bombs) {
        const [x, y] = cellXY(b.r * COLS + b.c);
        drawBomb(x, y, b.timer, b.owner);
      }

      // flames
      for (let i = 0; i < v.flame.length; i++) if (v.flame[i] > 0) drawFlame(i, v.flame[i], v.flameKind[i] || 3);

      // actors, back to front
      const order = v.actors.slice().sort((a, b) => a.r + ((a.tr - a.r) * a.p) / SUB - (b.r + ((b.tr - b.r) * b.p) / SUB));
      for (const a of order) {
        const fx = a.c + ((a.tc - a.c) * a.p) / SUB;
        const fy = a.r + ((a.tr - a.r) * a.p) / SUB;
        const x = OX + (fx + 0.5) * CELL;
        let y = OY + (fy + 0.5) * CELL;
        if (!a.alive) {
          const age = (v.frame - a.deadAt) / 60;
          if (age > 1 || v.phase === "intro") continue;
          ctx.save();
          ctx.globalAlpha = 1 - age;
          ctx.translate(x, y - age * 20);
          ctx.rotate(age * 6);
          drawActor(a, 0, 0, CELL * (1 + age * 0.4), "sad");
          ctx.restore();
          continue;
        }
        const moving = a.dir >= 0;
        if (moving) y -= Math.abs(Math.sin((a.p / SUB) * Math.PI)) * 2.5;
        // shadow
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        ctx.beginPath();
        ctx.ellipse(x, OY + (fy + 0.5) * CELL + CELL * 0.38, CELL * 0.3, CELL * 0.1, 0, 0, TAU);
        ctx.fill();
        if (a.id === 0) {
          // halo so the hero is easy to spot
          ctx.strokeStyle = `rgba(${rgb(p.primary)},${0.35 + 0.2 * Math.sin(t / 200)})`;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(x, y, CELL * 0.58, 0, TAU);
          ctx.stroke();
        }
        const mood = a.id === 0 && v.phase === "roundEnd" && v.roundWinner === 0 ? "happy" : "idle";
        drawActor(a, x, y, CELL * 1.05, mood);
      }

      kit.fx.draw(kit, dtMs);
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);

      // ---------- player stats ----------
      const sy = OY + BH + 34;
      const stats: [number, string][] = [
        [ITEM_BOMB, `x${me.maxBombs}`],
        [ITEM_FIRE, `x${me.power}`],
        [3, `x${me.speed - BASE_SPEED + 1}`],
      ];
      for (let k = 0; k < 3; k++) {
        const x = 48 + k * 110;
        itemIcon(stats[k][0], x, sy, 11);
        kit.text(stats[k][1], x + 18, sy + 1, 14, p.text, "left");
      }
      kit.text(`SCORE ${v.score}`, FIELD_W / 2, sy + 40, 14, p.primary);
      kit.text("SWIPE GLIDE  ·  TAP BOMB", FIELD_W / 2, FIELD_H - 34, 9, `rgba(${rgb(p.text)},0.6)`);
      kit.text("ARROWS WALK  ·  SPACE BOMB", FIELD_W / 2, FIELD_H - 20, 9, `rgba(${rgb(p.text)},0.6)`);

      // ---------- overlays ----------
      const midY = OY + BH / 2;
      if (v.phase === "intro") {
        const k = v.phaseT / INTRO_T;
        banner(midY, 70);
        const pop = Math.min(1, v.phaseT / 12);
        kit.text(`ROUND ${v.round}`, FIELD_W / 2, midY - 12, Math.round(22 * pop) || 1, p.primary);
        kit.text(v.round === 1 ? `MATCH ${v.match}${v.level ? " · BOTS LV " + (v.level + 1) : ""}` : k < 0.6 ? "READY..." : "GO!", FIELD_W / 2, midY + 16, 12, p.text);
      } else if (v.phase === "play" && v.phaseT < 30) {
        ctx.globalAlpha = 1 - v.phaseT / 30;
        kit.text("GO!", FIELD_W / 2, midY, 28 + v.phaseT, p.primary);
        ctx.globalAlpha = 1;
      } else if (v.phase === "roundEnd" && v.phaseT > 20) {
        banner(midY, 76);
        const w = v.roundWinner;
        let head: string;
        let sub: string;
        if (v.matchWon) {
          head = "MATCH WON!";
          sub = "SMARTER BOTS NEXT";
        } else if (v.matchLost) {
          head = "MATCH LOST";
          sub = `${NAMES[w]} TAKES IT`;
        } else if (w === 0) {
          head = "ROUND WON!";
          sub = `${me.wins} / ${WINS_NEEDED} WINS`;
        } else if (w < 0) {
          head = "DRAW";
          sub = "NOBODY STANDING";
        } else {
          head = `${NAMES[w]} WINS`;
          sub = "SHAKE IT OFF";
        }
        const pop = Math.min(1, (v.phaseT - 20) / 10);
        kit.text(head, FIELD_W / 2, midY - 12, Math.max(1, Math.round(22 * pop)), w === 0 ? p.primary : p.accent);
        kit.text(sub, FIELD_W / 2, midY + 16, 11, p.text);
      } else if (v.phase === "over") {
        banner(midY, 76);
        kit.text("RUN OVER", FIELD_W / 2, midY - 10, 22, p.accent);
        kit.text(`SCORE ${v.score}`, FIELD_W / 2, midY + 16, 12, p.text);
      }
    },
  };

  function banner(y: number, h: number) {
    ctx.fillStyle = `rgba(${rgb(p.ink)},0.72)`;
    ctx.fillRect(0, y - h / 2, FIELD_W, h);
    ctx.fillStyle = p.primary;
    ctx.fillRect(0, y - h / 2, FIELD_W, 2);
    ctx.fillRect(0, y + h / 2 - 2, FIELD_W, 2);
  }
}
