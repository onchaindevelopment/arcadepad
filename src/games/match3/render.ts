// Moon Match renderer: round coin tokens with a symbol each (readable without
// colour), the mascot as the MOON bomb token and as the cheering host below
// the board, and every animation (swap, clear, fall, shuffle) driven by the
// engine's phase + frame counters. All art is drawn here.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BOARD_PX, BOARD_X, BOARD_Y, CELL, FIELD_H, FIELD_W, KIND, LAND_FRAMES, N, START_TIME,
  cellX, cellY, fallCovered, fallFrames, type Match3View, type Tile,
} from "./index.ts";

interface Beam { horiz: boolean; row: number; col: number; life: number; color: string }
interface Ring { x: number; y: number; life: number; max: number; r: number; color: string }
interface Banner { text: string; life: number; color: string }

const TAU = Math.PI * 2;
const ease = (k: number) => 1 - (1 - k) * (1 - k);
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k));

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<Match3View> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length >= 6 ? p.bricks : [...p.bricks, p.primary, p.secondary, p.accent, p.wall, p.text, "#ffffff"].slice(0, 6);
  let clock = 0;
  let beams: Beam[] = [];
  let rings: Ring[] = [];
  let banner: Banner | null = null;
  let moodUntil = 0;
  let mood: "happy" | "sad" | null = null;
  let timerPulse = 0;
  let scoreShown = 0;
  let scoreBump = 0;

  const colorOf = (c: number) => (c >= 0 ? bricks[c % bricks.length] : p.accent);

  // ---------- Token art ----------

  function star(cx: number, cy: number, r: number) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const a = -Math.PI / 2 + (i * Math.PI) / 5;
      const rr = i & 1 ? r * 0.45 : r;
      ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    ctx.closePath();
    ctx.fill();
  }

  function symbol(kind: number, cx: number, cy: number, r: number) {
    ctx.fillStyle = p.ink;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = Math.max(1.5, r * 0.18);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    switch (kind) {
      case 0: { // smiley face
        ctx.beginPath();
        ctx.arc(cx - r * 0.35, cy - r * 0.2, r * 0.14, 0, TAU);
        ctx.arc(cx + r * 0.35, cy - r * 0.2, r * 0.14, 0, TAU);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(cx, cy + r * 0.05, r * 0.42, 0.15 * Math.PI, 0.85 * Math.PI);
        ctx.stroke();
        break;
      }
      case 1: // star
        star(cx, cy + r * 0.04, r * 0.62);
        break;
      case 2: { // crescent moon
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.55, 0.35 * Math.PI, 1.65 * Math.PI, false);
        ctx.arc(cx + r * 0.28, cy - r * 0.08, r * 0.42, 1.55 * Math.PI, 0.45 * Math.PI, true);
        ctx.closePath();
        ctx.fill();
        break;
      }
      case 3: { // heart
        const s = r * 0.55;
        ctx.beginPath();
        ctx.moveTo(cx, cy + s * 0.9);
        ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.7, cy - s * 1.2, cx, cy - s * 0.4);
        ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.2, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.9);
        ctx.fill();
        break;
      }
      case 4: { // lightning bolt
        const s = r * 0.62;
        ctx.beginPath();
        ctx.moveTo(cx + s * 0.25, cy - s);
        ctx.lineTo(cx - s * 0.55, cy + s * 0.12);
        ctx.lineTo(cx - s * 0.02, cy + s * 0.12);
        ctx.lineTo(cx - s * 0.25, cy + s);
        ctx.lineTo(cx + s * 0.55, cy - s * 0.15);
        ctx.lineTo(cx + s * 0.02, cy - s * 0.15);
        ctx.closePath();
        ctx.fill();
        break;
      }
      default: { // rocket / up arrow
        const s = r * 0.6;
        ctx.beginPath();
        ctx.moveTo(cx, cy - s);
        ctx.lineTo(cx + s * 0.75, cy + s * 0.1);
        ctx.lineTo(cx + s * 0.28, cy + s * 0.1);
        ctx.lineTo(cx + s * 0.28, cy + s * 0.85);
        ctx.lineTo(cx - s * 0.28, cy + s * 0.85);
        ctx.lineTo(cx - s * 0.28, cy + s * 0.1);
        ctx.lineTo(cx - s * 0.75, cy + s * 0.1);
        ctx.closePath();
        ctx.fill();
      }
    }
  }

  function coinBase(cx: number, cy: number, r: number, color: string) {
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(cx, cy + r * 0.85, r * 0.8, r * 0.25, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TAU);
    ctx.fill();
    // rim
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 3.5, 0, TAU);
    ctx.stroke();
    // shine
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 1.5, 1.1 * Math.PI, 1.45 * Math.PI);
    ctx.stroke();
  }

  function drawToken(t: Tile, cx: number, cy: number, scale: number, sx = 1, sy = 1) {
    const r = 17 * scale;
    if (r <= 0.5) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(sx, sy);
    if (t.kind === KIND.BOMB) {
      // Rainbow ring + the mascot's face: the MOON token.
      const spin = clock / 600;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(0, 0, r + 2.5, 0, TAU);
      ctx.fill();
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = bricks[i];
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, r, spin + (i * TAU) / 6, spin + ((i + 1) * TAU) / 6);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.72, 0, TAU);
      ctx.fill();
      const s = r * 1.3;
      ctx.drawImage(kit.sprites.mini, -s / 2, -s / 2, s, s);
      ctx.restore();
      return;
    }
    const color = colorOf(t.color);
    coinBase(0, 0, r, color);
    if (t.kind === KIND.LINE_H || t.kind === KIND.LINE_V) {
      ctx.save();
      if (t.kind === KIND.LINE_V) ctx.rotate(Math.PI / 2);
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(-r + 2, -r * 0.18, 2 * r - 4, r * 0.36);
      const w = (clock / 120) % 1;
      ctx.fillStyle = "#ffffff";
      for (const dir of [-1, 1]) {
        const tip = dir * (r + 4 + w * 3);
        ctx.beginPath();
        ctx.moveTo(tip, 0);
        ctx.lineTo(tip - dir * 7, -5);
        ctx.lineTo(tip - dir * 7, 5);
        ctx.closePath();
        ctx.fillStyle = p.ink;
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(tip - dir * 1.5, 0);
        ctx.lineTo(tip - dir * 6, -3);
        ctx.lineTo(tip - dir * 6, 3);
        ctx.closePath();
        ctx.fillStyle = "#ffffff";
        ctx.fill();
      }
      ctx.restore();
    } else if (t.kind === KIND.BLAST) {
      const pulse = 0.5 + 0.5 * Math.sin(clock / 120);
      ctx.strokeStyle = `rgba(255,255,255,${0.5 + 0.4 * pulse})`;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = (i * TAU) / 16 + clock / 900;
        const rr = i & 1 ? r + 2 : r + 6 + pulse * 2;
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      ctx.stroke();
    }
    symbol(t.color, 0, 0, r);
    if (t.clock) {
      // +5 s badge
      const bx = r * 0.62, by = r * 0.62, br = r * 0.46;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(bx, by, br + 1.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(bx, by, br, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx, by - br * 0.7);
      ctx.moveTo(bx, by);
      const a = clock / 300;
      ctx.lineTo(bx + Math.cos(a) * br * 0.6, by + Math.sin(a) * br * 0.6);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Helpers ----------

  function bigText(s: string, x: number, y: number, size: number, fill = "#ffffff") {
    ctx.font = `bold ${size}px ${kit.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size / 5);
    ctx.strokeStyle = p.ink;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(s, x, y);
  }

  const centerOf = (cell: number) => ({ x: cellX(cell % N) + CELL / 2, y: cellY(Math.floor(cell / N)) + CELL / 2 });

  function hexToRgb(hex: string): string {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return "255,255,255";
    const n = parseInt(m[1], 16);
    return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.mood) {
          mood = e.mood;
          moodUntil = clock + 1200;
        }
        switch (e.t) {
          case "clear": {
            const cells = e.cells as { x: number; y: number; color: number; kind: number }[];
            for (const q of cells) kit.fx.burst(q.x, q.y, colorOf(q.color), 6, 110, 300);
            const combo = e.combo as number;
            kit.fx.popup(e.x!, e.y! - 6, combo > 1 ? `+${e.points} x${combo}` : `+${e.points}`, combo > 1 ? p.accent : "#ffffff");
            scoreBump = 1;
            if (cells.length >= 12) kit.fx.addShake(4);
            break;
          }
          case "special":
            rings.push({ x: e.x!, y: e.y!, life: 0, max: 380, r: 30, color: "#ffffff" });
            break;
          case "line": {
            const color = p.text;
            beams.push({ horiz: e.horiz as boolean, row: e.row as number, col: e.col as number, life: 320, color });
            kit.fx.addShake(3);
            break;
          }
          case "blast":
            rings.push({ x: e.x!, y: e.y!, life: 0, max: 420, r: CELL * 1.8, color: p.accent });
            kit.fx.burst(e.x!, e.y!, p.accent, 20, 200);
            kit.fx.addShake(6);
            break;
          case "bomb":
            rings.push({ x: e.x!, y: e.y!, life: 0, max: 600, r: BOARD_PX, color: (e.color as number) >= 0 ? colorOf(e.color as number) : "#ffffff" });
            kit.fx.flash(hexToRgb((e.color as number) >= 0 ? colorOf(e.color as number) : p.accent));
            kit.fx.addShake(8);
            banner = { text: "MOON!", life: 900, color: p.primary };
            break;
          case "combo": {
            const c = e.combo as number;
            const words = ["", "", "NICE", "GREAT", "AMAZING", "TO THE MOON"];
            banner = { text: `${words[Math.min(c, words.length - 1)]} x${c}`, life: 900, color: c >= 4 ? p.accent : p.primary };
            break;
          }
          case "time":
            kit.fx.popup(e.x!, e.y! - 18, `+${e.sec}s`, p.primary);
            timerPulse = 1;
            break;
          case "badswap":
            kit.fx.addShake(2);
            break;
          case "shuffle":
            banner = { text: "SHUFFLE", life: 900, color: p.secondary };
            break;
          case "tick":
            timerPulse = 1;
            break;
          case "timeup":
            kit.fx.flash("255,255,255");
            banner = { text: "TIME!", life: 1400, color: "#ffffff" };
            break;
          case "gameover":
            for (let i = 0; i < 6; i++) kit.fx.burst(BOARD_X + Math.random() * BOARD_PX, BOARD_Y + BOARD_PX * 0.4, bricks[i], 12, 220);
            break;
        }
      }
    },

    draw(v, dtMs) {
      clock += dtMs;
      kit.background(dtMs);

      // ---------- Header: score + timer ----------
      scoreShown += (v.score - scoreShown) * Math.min(1, dtMs / 120);
      if (Math.abs(v.score - scoreShown) < 1) scoreShown = v.score;
      scoreBump = Math.max(0, scoreBump - dtMs / 250);
      kit.text("SCORE", FIELD_W / 2, 20, 11, p.text);
      bigText(String(Math.round(scoreShown)), FIELD_W / 2, 48, 30 + scoreBump * 6, p.primary);

      const secs = Math.ceil(v.timeLeft / 60);
      const low = v.timeLeft <= 10 * 60;
      const barX = BOARD_X + 34, barY = 86, barW = BOARD_PX - 34, barH = 18;
      const frac = Math.max(0, Math.min(1, v.timeLeft / Math.max(START_TIME, v.timeLeft)));
      timerPulse = Math.max(0, timerPulse - dtMs / 400);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(barX - 2, barY - 2, barW + 4, barH + 4, 7);
      ctx.fill();
      ctx.fillStyle = p.wall;
      ctx.beginPath();
      ctx.roundRect(barX, barY, barW, barH, 5);
      ctx.fill();
      const flashOn = low && Math.floor(clock / 250) % 2 === 0;
      ctx.fillStyle = flashOn ? p.accent : low ? p.secondary : p.primary;
      if (frac > 0) {
        ctx.beginPath();
        ctx.roundRect(barX, barY, Math.max(8, barW * frac), barH, 5);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.fillRect(barX + 4, barY + 3, Math.max(0, barW * frac - 8), 3);
      }
      if (timerPulse > 0) {
        ctx.strokeStyle = `rgba(255,255,255,${timerPulse})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(barX - 4, barY - 4, barW + 8, barH + 8, 9);
        ctx.stroke();
      }
      kit.text(`${secs}s`, barX + barW / 2, barY + barH / 2 + 1, 12, "#ffffff");
      // stopwatch icon
      const ix = BOARD_X + 14, iy = barY + barH / 2;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(ix, iy, 12, 0, TAU);
      ctx.fill();
      ctx.fillRect(ix - 3, iy - 16, 6, 5);
      ctx.fillStyle = low ? p.accent : "#ffffff";
      ctx.beginPath();
      ctx.arc(ix, iy, 9.5, 0, TAU);
      ctx.fill();
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(ix, iy);
      const ha = -Math.PI / 2 + TAU * (1 - frac);
      ctx.lineTo(ix + Math.cos(ha) * 7, iy + Math.sin(ha) * 7);
      ctx.stroke();

      // ---------- Board ----------
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(BOARD_X - 6, BOARD_Y - 6, BOARD_PX + 12, BOARD_PX + 12, 12);
      ctx.fill();
      ctx.fillStyle = p.wall;
      ctx.beginPath();
      ctx.roundRect(BOARD_X - 3, BOARD_Y - 3, BOARD_PX + 6, BOARD_PX + 6, 10);
      ctx.fill();
      for (let r = 0; r < N; r++) {
        for (let c = 0; c < N; c++) {
          ctx.fillStyle = (r + c) & 1 ? "rgba(0,0,0,0.16)" : "rgba(255,255,255,0.05)";
          ctx.fillRect(cellX(c), cellY(r), CELL, CELL);
        }
      }

      // Selection + cursor + hint underlays
      if (v.selected >= 0 && !v.over) {
        const { x, y } = centerOf(v.selected);
        const pulse = 0.5 + 0.5 * Math.sin(clock / 110);
        ctx.fillStyle = `rgba(255,255,255,${0.18 + 0.15 * pulse})`;
        ctx.beginPath();
        ctx.roundRect(x - CELL / 2 + 1, y - CELL / 2 + 1, CELL - 2, CELL - 2, 8);
        ctx.fill();
      }

      const k = v.plen > 0 ? Math.min(1, v.pf / v.plen) : 0;
      const clearing = new Set(v.clearing);

      ctx.save();
      ctx.beginPath();
      ctx.rect(BOARD_X - 3, BOARD_Y - 3, BOARD_PX + 6, BOARD_PX + 6);
      ctx.clip();
      for (let i = 0; i < N * N; i++) {
        const t = v.cells[i];
        if (!t) continue;
        const r = Math.floor(i / N), c = i % N;
        let x = cellX(c) + CELL / 2;
        let y = cellY(r) + CELL / 2;
        let scale = 1, sx = 1, sy = 1;

        if (v.phase === "swap" && v.swap) {
          const { a, b, back } = v.swap;
          if (i === a || i === b) {
            const other = i === a ? b : a;
            const ox = cellX(other % N) + CELL / 2, oy = cellY(Math.floor(other / N)) + CELL / 2;
            const amt = back ? (k < 0.5 ? easeInOut(k * 2) * 0.55 : easeInOut((1 - k) * 2) * 0.55) : 1 - easeInOut(k);
            x += (ox - x) * amt;
            y += (oy - y) * amt;
            scale = i === (back ? a : b) ? 1.12 : 0.94;
          }
        } else if (v.phase === "fall") {
          const from = v.fallFrom[i];
          const dist = r - from;
          if (dist > 0) {
            const cov = Math.min(dist, fallCovered(v.pf));
            y = cellY(from + cov) + CELL / 2;
            const landed = v.pf - fallFrames(dist);
            if (landed >= 0 && landed < LAND_FRAMES + 2) {
              const q = Math.sin((landed / (LAND_FRAMES + 2)) * Math.PI);
              sx = 1 + 0.18 * q;
              sy = 1 - 0.18 * q;
              y += 17 * 0.18 * q;
            }
          }
        } else if (v.phase === "clear" && clearing.has(i)) {
          scale = k < 0.25 ? 1 + k * 0.8 : Math.max(0, 1.2 * (1 - (k - 0.25) / 0.75));
        } else if (v.phase === "shuffle") {
          const s = Math.abs(Math.cos(k * Math.PI));
          scale = 0.35 + 0.65 * s;
          x += Math.sin(k * Math.PI) * Math.sin(i * 1.7) * 10;
        }
        if (t.kind !== KIND.NORMAL) {
          const age = v.frame - t.born;
          if (age >= 0 && age < 14) scale *= 1 + 0.35 * Math.sin((age / 14) * Math.PI);
        }
        if (i === v.selected && v.phase === "idle") {
          scale *= 1.08 + 0.04 * Math.sin(clock / 110);
          y -= 2;
        }
        if (v.hint && (i === v.hint.a || i === v.hint.b)) {
          const other = i === v.hint.a ? v.hint.b : v.hint.a;
          const w = Math.max(0, Math.sin(clock / 140)) * 3;
          x += Math.sign((other % N) - c) * w;
          y += Math.sign(Math.floor(other / N) - r) * w;
        }
        drawToken(t, x, y, scale, sx, sy);
        if (v.phase === "clear" && clearing.has(i) && k < 0.35) {
          ctx.fillStyle = `rgba(255,255,255,${0.8 * (1 - k / 0.35)})`;
          ctx.beginPath();
          ctx.arc(x, y, 19 * scale, 0, TAU);
          ctx.fill();
        }
      }

      // Line beams
      beams = beams.filter((b) => (b.life -= dtMs) > 0);
      for (const b of beams) {
        const a = b.life / 320;
        const th = 6 + 18 * a;
        ctx.fillStyle = `rgba(255,255,255,${0.85 * a})`;
        if (b.horiz) ctx.fillRect(BOARD_X, cellY(b.row) + CELL / 2 - th / 2, BOARD_PX, th);
        else ctx.fillRect(cellX(b.col) + CELL / 2 - th / 2, BOARD_Y, th, BOARD_PX);
      }
      ctx.restore();

      // Rings (blast / bomb / special created)
      rings = rings.filter((q) => (q.life += dtMs) < q.max);
      for (const q of rings) {
        const a = q.life / q.max;
        ctx.strokeStyle = q.color;
        ctx.globalAlpha = 1 - a;
        ctx.lineWidth = 4 * (1 - a) + 1;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 6 + q.r * ease(a), 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Keyboard cursor
      if (v.keyCursor && !v.over) {
        const cell = v.selected >= 0 ? v.selected : v.cursor;
        const x0 = cellX(cell % N) + 1, y0 = cellY(Math.floor(cell / N)) + 1, s = CELL - 2, l = 10;
        const o = Math.sin(clock / 150) * 1.5;
        ctx.strokeStyle = v.selected >= 0 ? p.accent : "#ffffff";
        ctx.lineWidth = 3;
        ctx.lineCap = "round";
        ctx.beginPath();
        for (const [cx, cy, dx, dy] of [[x0 - o, y0 - o, 1, 1], [x0 + s + o, y0 - o, -1, 1], [x0 - o, y0 + s + o, 1, -1], [x0 + s + o, y0 + s + o, -1, -1]]) {
          ctx.moveTo(cx + dx * l, cy);
          ctx.lineTo(cx, cy);
          ctx.lineTo(cx, cy + dy * l);
        }
        ctx.stroke();
      }

      // ---------- Footer: the mascot host ----------
      const footY = BOARD_Y + BOARD_PX + 10;
      if (clock > moodUntil) mood = null;
      const sprite = v.over ? (v.score > 0 ? kit.sprites.happy : kit.sprites.sad) : mood === "happy" ? kit.sprites.happy : mood === "sad" || (v.timeLeft < 5 * 60 && v.timeLeft > 0) ? kit.sprites.sad : kit.sprites.idle;
      const bob = mood === "happy" ? Math.abs(Math.sin(clock / 90)) * 8 : Math.sin(clock / 400) * 2;
      const ms = 80;
      const mx = BOARD_X + 6, my = footY + 18 - bob;
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(mx + ms / 2, footY + 18 + ms - 4, ms * 0.35, 6, 0, 0, TAU);
      ctx.fill();
      ctx.drawImage(sprite, mx, my, ms, ms);

      // Speech bubble
      let say: string;
      if (v.over) say = `FINAL ${v.score}`;
      else if (v.combo >= 2) say = `COMBO x${v.combo}!`;
      else if (v.timeLeft <= 0) say = "LAST CASCADE...";
      else if (v.frame < 240) say = "DRAG OR TAP TWO COINS";
      else if (v.hint) say = "PSST... TRY THE WIGGLE";
      else if (v.timeLeft < 10 * 60) say = "HURRY!";
      else say = v.bestCombo >= 2 ? `BEST COMBO x${v.bestCombo}` : "MATCH 3 OR MORE";
      const bx = mx + ms + 12, by = footY + 34, bw = FIELD_W - bx - 10, bh = 40;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(bx - 2, by - 2, bw + 4, bh + 4, 10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - 12, by + bh / 2 + 6);
      ctx.lineTo(bx + 2, by + bh / 2 - 6);
      ctx.lineTo(bx + 2, by + bh / 2 + 10);
      ctx.fill();
      ctx.fillStyle = p.text;
      ctx.beginPath();
      ctx.roundRect(bx, by, bw, bh, 8);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(bx - 8, by + bh / 2 + 5);
      ctx.lineTo(bx + 3, by + bh / 2 - 4);
      ctx.lineTo(bx + 3, by + bh / 2 + 8);
      ctx.fill();
      ctx.font = `bold 11px ${kit.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = p.ink;
      ctx.fillText(say, bx + bw / 2, by + bh / 2 + 1, bw - 10);

      // Legend: specials
      const ly = footY + 106;
      const legend: [number, string][] = [[KIND.LINE_H, "4 = LINE"], [KIND.BLAST, "L/T = BLAST"], [KIND.BOMB, "5 = MOON"]];
      legend.forEach(([kind, label], j) => {
        const lx = BOARD_X + 14 + j * 114;
        drawToken({ id: 0, color: j, kind, clock: false, born: -999 }, lx, ly, 0.5);
        kit.text(label, lx + 14, ly + 1, 9, p.text, "left");
      });

      kit.fx.draw(kit, dtMs);

      // Banner (combo / shuffle / time)
      if (banner) {
        banner.life -= dtMs;
        if (banner.life <= 0) banner = null;
        else {
          const a = Math.min(1, banner.life / 300);
          const pop = 1 + Math.max(0, (banner.life - 700) / 200) * 0.4;
          ctx.globalAlpha = a;
          bigText(banner.text, FIELD_W / 2, BOARD_Y + BOARD_PX / 2, Math.round(28 * pop), banner.color);
          ctx.globalAlpha = 1;
        }
      }

      if (v.over) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(BOARD_X - 6, BOARD_Y - 6, BOARD_PX + 12, BOARD_PX + 12);
        bigText("TIME!", FIELD_W / 2, BOARD_Y + BOARD_PX / 2 - 40, 40, p.primary);
        bigText(String(v.score), FIELD_W / 2, BOARD_Y + BOARD_PX / 2 + 10, 30, "#ffffff");
        if (v.bestCombo >= 2) kit.text(`BEST COMBO x${v.bestCombo}`, FIELD_W / 2, BOARD_Y + BOARD_PX / 2 + 48, 13, p.text);
      }
    },
  };
}
