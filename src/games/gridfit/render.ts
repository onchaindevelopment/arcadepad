// Grid Fit renderer: themed 9x9 board with checkered 3x3 boxes, chunky coin
// blocks, a three-slot tray, drag/ghost previews that light up the groups a
// drop would clear, pop-and-burst clears, combo popups and a reacting mascot.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BOARD, BOARD_X, BOARD_Y, CELL, FIELD_H, FIELD_W, LIFT, N, SHAPES, SLOT_W, TRAY_CELL, TRAY_H, TRAY_Y,
  canPlaceAnywhere, groupCells, slotCenter, type GridFitView, type TrayPiece,
} from "./index.ts";

interface Pop { i: number; color: number; at: number }
interface Beam { g: number; at: number }
interface Fly { slot: number; fromX: number; fromY: number; at: number }

const POP_MS = 320;
const LAND_MS = 160;
const DEAL_MS = 260;

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<GridFitView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  let clock = 0;
  let pops: Pop[] = [];
  let beams: Beam[] = [];
  const landed = new Map<number, number>(); // cell -> time placed
  let flies: Fly[] = [];
  let dealAt = -1e9;
  let happyUntil = 0;
  let mascotJump = -1e9;
  let bumpAt = -1e9;
  let comboText = "";
  let comboAt = -1e9;

  const col = (c: number) => p.bricks[((c % p.bricks.length) + p.bricks.length) % p.bricks.length] ?? p.primary;
  const cellX = (c: number) => BOARD_X + c * CELL;
  const cellY = (r: number) => BOARD_Y + r * CELL;

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

  /** One chunky coin block, size s, top-left (x, y), scaled about its centre. */
  function coinBlock(x: number, y: number, s: number, color: string, scale = 1, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x + s / 2, y + s / 2);
    ctx.scale(scale, scale);
    const o = -s / 2;
    kit.block(o + 1, o + 1, s - 2, s - 2, color, Math.max(2, s / 7));
    // Embossed coin face
    const r = s * 0.27;
    ctx.fillStyle = "rgba(0,0,0,0.16)";
    ctx.beginPath();
    ctx.arc(0.8, 1.2, r + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = Math.max(1, s / 18);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-r * 0.15, -r * 0.55, Math.max(1, r * 0.3), r * 1.1);
    ctx.restore();
  }

  function drawPiece(piece: TrayPiece, cx: number, cy: number, s: number, alpha = 1, scale = 1) {
    const x0 = cx - (piece.w * s) / 2, y0 = cy - (piece.h * s) / 2;
    for (const [dc, dr] of piece.cells) coinBlock(x0 + dc * s, y0 + dr * s, s, col(piece.color), scale, alpha);
  }

  function header(v: GridFitView) {
    const happy = clock < happyUntil;
    const sprite = v.over ? kit.sprites.sad : happy ? kit.sprites.happy : kit.sprites.idle;
    const jt = (clock - mascotJump) / 380;
    const jump = jt >= 0 && jt < 1 ? -Math.sin(jt * Math.PI) * 12 : 0;
    const bob = Math.sin(clock / 400) * 1.5;
    ctx.drawImage(sprite, 12, 10 + jump + bob, 56, 56);
    bigText(String(v.score), FIELD_W / 2 + 18, 30, 26);
    if (v.streak >= 2) {
      const pulse = 1 + 0.08 * Math.sin(clock / 90);
      ctx.save();
      ctx.translate(FIELD_W / 2 + 18, 58);
      ctx.scale(pulse, pulse);
      bigText(`COMBO x${v.streak}`, 0, 0, 13, p.accent);
      ctx.restore();
    } else kit.text(`${v.clears} CLEARED`, FIELD_W / 2 + 18, 58, 10, p.text);
    // Combo pips on the right
    for (let i = 0; i < 5; i++) {
      const on = i < Math.min(5, v.streak);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(FIELD_W - 70 + i * 13, 30, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = on ? col(i) : p.wall;
      ctx.beginPath();
      ctx.arc(FIELD_W - 70 + i * 13, 30, 4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function board(v: GridFitView) {
    const bump = Math.max(0, 1 - (clock - bumpAt) / 140);
    const bx = bump > 0 ? Math.sin(clock / 18) * 3 * bump : 0;
    ctx.save();
    ctx.translate(bx, 0);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(BOARD_X - 6, BOARD_Y - 6, BOARD + 12, BOARD + 12, 12);
    ctx.fill();
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.roundRect(BOARD_X - 4, BOARD_Y - 4, BOARD + 8, BOARD + 8, 10);
    ctx.fill();
    // Checkered 3x3 boxes
    for (let b = 0; b < 9; b++) {
      const bx0 = BOARD_X + (b % 3) * 3 * CELL, by0 = BOARD_Y + Math.floor(b / 3) * 3 * CELL;
      ctx.fillStyle = (b & 1) === 0 ? "rgba(0,0,0,0.30)" : "rgba(0,0,0,0.12)";
      ctx.beginPath();
      ctx.roundRect(bx0 + 1, by0 + 1, 3 * CELL - 2, 3 * CELL - 2, 6);
      ctx.fill();
    }
    // Sockets
    for (let r = 0; r < N; r++) {
      for (let c = 0; c < N; c++) {
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        ctx.roundRect(cellX(c) + 3, cellY(r) + 3, CELL - 6, CELL - 6, 5);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.05)";
        ctx.fillRect(cellX(c) + 6, cellY(r) + CELL - 6, CELL - 12, 1.5);
      }
    }

    // Groups the current preview would clear
    const pv = v.preview;
    const hot = new Set<number>();
    if (pv && pv.ok) for (const g of pv.clears) for (const i of groupCells(g)) hot.add(i);
    const previewColor = pv ? v.tray[pv.slot]?.color ?? 0 : 0;

    for (let i = 0; i < N * N; i++) {
      const val = v.board[i];
      if (!val) continue;
      const c = i % N, r = Math.floor(i / N);
      const t0 = landed.get(i);
      let s = 1;
      if (t0 !== undefined) {
        const k = (clock - t0) / LAND_MS;
        if (k < 1) s = 1 + 0.18 * Math.sin(k * Math.PI);
        else landed.delete(i);
      }
      coinBlock(cellX(c), cellY(r), CELL, hot.has(i) ? col(previewColor) : col(val - 1), s);
    }
    if (hot.size) {
      ctx.fillStyle = `rgba(255,255,255,${0.16 + 0.12 * Math.sin(clock / 80)})`;
      for (const i of hot) ctx.fillRect(cellX(i % N) + 2, cellY(Math.floor(i / N)) + 2, CELL - 4, CELL - 4);
    }

    // Ghost
    if (pv) {
      const piece = v.tray[pv.slot];
      if (piece) {
        for (const [dc, dr] of piece.cells) {
          const x = cellX(pv.c + dc), y = cellY(pv.r + dr);
          if (pv.ok) coinBlock(x, y, CELL, col(piece.color), 1, 0.45 + 0.1 * Math.sin(clock / 100));
          else {
            ctx.strokeStyle = p.accent;
            ctx.lineWidth = 2;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.roundRect(x + 3, y + 3, CELL - 6, CELL - 6, 5);
            ctx.stroke();
            ctx.setLineDash([]);
          }
        }
      }
    }

    // Clearing cells pop and fade
    pops = pops.filter((q) => clock - q.at < POP_MS);
    for (const q of pops) {
      const k = (clock - q.at) / POP_MS;
      if (k < 0) {
        coinBlock(cellX(q.i % N), cellY(Math.floor(q.i / N)), CELL, col(q.color));
        continue;
      }
      coinBlock(cellX(q.i % N), cellY(Math.floor(q.i / N)), CELL, k < 0.25 ? "#ffffff" : col(q.color), 1 + k * 0.5, 1 - k);
    }
    // Group beams
    beams = beams.filter((q) => clock - q.at < 300);
    for (const q of beams) {
      const a = 1 - (clock - q.at) / 300;
      const cells = groupCells(q.g);
      const c0 = cells[0] % N, r0 = Math.floor(cells[0] / N);
      const c1 = cells[8] % N, r1 = Math.floor(cells[8] / N);
      ctx.fillStyle = `rgba(255,255,255,${0.45 * a})`;
      ctx.beginPath();
      ctx.roundRect(cellX(c0), cellY(r0), (c1 - c0 + 1) * CELL, (r1 - r0 + 1) * CELL, 6);
      ctx.fill();
    }
    ctx.restore();
  }

  function tray(v: GridFitView) {
    for (let slot = 0; slot < 3; slot++) {
      const x = slot * SLOT_W + 6, y = TRAY_Y + 4, w = SLOT_W - 12, h = TRAY_H - 8;
      const selected = v.sel === slot && v.tray[slot] && !v.drag;
      ctx.fillStyle = p.ink;
      ctx.globalAlpha = 0.45;
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, 12);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (selected) {
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2.5 + Math.sin(clock / 120);
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, w - 2, h - 2, 11);
        ctx.stroke();
      }
      const piece = v.tray[slot];
      if (!piece || (v.drag && v.drag.slot === slot) || (v.placing && v.sel === slot)) continue;
      const sc = slotCenter(slot);
      let cx = sc.x, cy = sc.y;
      // Deal slide-in, staggered per slot
      const dk = (clock - dealAt - slot * 70) / DEAL_MS;
      let scale = 1;
      if (dk < 1) {
        const e = Math.max(0, dk);
        cx += (1 - e) * (1 - e) * 140;
        scale = 0.6 + 0.4 * e;
      }
      // Fly back after a missed drop
      const fly = flies.find((f) => f.slot === slot);
      let size = TRAY_CELL;
      if (fly) {
        const k = Math.min(1, (clock - fly.at) / 180);
        const e = 1 - (1 - k) * (1 - k);
        cx = fly.fromX + (cx - fly.fromX) * e;
        cy = fly.fromY + (cy - fly.fromY) * e;
        size = CELL + (TRAY_CELL - CELL) * e;
      }
      if (selected) cy += Math.sin(clock / 150) * 2;
      const fitsSomewhere = canPlaceAnywhere(v.board, SHAPES[piece.shape]);
      drawPiece(piece, cx, cy, size, fitsSomewhere ? 1 : 0.35, scale);
    }
    flies = flies.filter((f) => clock - f.at < 180);
  }

  function dragged(v: GridFitView) {
    if (!v.drag) return;
    const piece = v.tray[v.drag.slot];
    if (!piece) return;
    const cx = v.drag.x, cy = v.drag.y - LIFT;
    // Soft shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    for (const [dc, dr] of piece.cells) {
      ctx.beginPath();
      ctx.roundRect(cx - (piece.w * CELL) / 2 + dc * CELL + 5, cy - (piece.h * CELL) / 2 + dr * CELL + 7, CELL - 2, CELL - 2, 5);
      ctx.fill();
    }
    drawPiece(piece, cx, cy, CELL, 1, 1.04);
  }

  function hints(v: GridFitView) {
    const y = FIELD_H - 26;
    if (v.over) return;
    if (v.placing) kit.text("ARROWS MOVE  SPACE DROP  X BACK", FIELD_W / 2, y, 9, p.text);
    else if (v.kb) kit.text("LEFT/RIGHT PICK  SPACE LIFT", FIELD_W / 2, y, 9, p.text);
    else if (v.sel >= 0 && !v.drag && v.tray[v.sel]) kit.text("TAP A CELL TO PLACE IT", FIELD_W / 2, y, 10, p.text);
    else if (v.moves < 3) kit.text("DRAG A PIECE ONTO THE GRID", FIELD_W / 2, y, 10, p.text);
    else kit.text("ROWS  COLUMNS  3x3 BOXES", FIELD_W / 2, y, 9, p.text);
  }

  return {
    onEvents(events: readonly GameEvent[], v: GridFitView) {
      for (const e of events) {
        if (e.t === "place") {
          for (const i of e.cells as number[]) landed.set(i, clock);
          kit.fx.burst(e.x!, e.y!, col(e.color as number), 6, 70, 200);
        } else if (e.t === "clear") {
          const cells = e.cells as number[], colors = e.colors as number[];
          const ox = e.x!, oy = e.y!;
          cells.forEach((i, k) => {
            const x = cellX(i % N) + CELL / 2, y = cellY(Math.floor(i / N)) + CELL / 2;
            const d = Math.abs(x - ox) + Math.abs(y - oy);
            const at = clock + d * 0.35;
            pops.push({ i, color: colors[k], at });
            if (k % 2 === 0) kit.fx.burst(x, y, col(colors[k]), 4, 130, 380);
          });
          for (const g of e.groups as number[]) beams.push({ g, at: clock });
          const n = e.n as number;
          kit.fx.popup(ox, oy - 14, `+${e.gain as number}`, "#ffffff");
          if (n >= 2) kit.fx.popup(FIELD_W / 2, BOARD_Y + BOARD / 2 - 24, n >= 3 ? `MEGA x${n}!` : "DOUBLE!", p.accent);
          kit.fx.addShake(2 + n * 2);
          if (n >= 3) kit.fx.flash("255,255,255");
          happyUntil = clock + 1200;
          mascotJump = clock;
        } else if (e.t === "combo") {
          comboText = `COMBO x${e.streak as number}`;
          comboAt = clock;
        } else if (e.t === "allclear") {
          kit.fx.flash("255,255,255");
          kit.fx.addShake(8);
          for (let i = 0; i < 8; i++) kit.fx.burst(BOARD_X + Math.random() * BOARD, BOARD_Y + Math.random() * BOARD, col(i), 14, 220);
          kit.fx.popup(FIELD_W / 2, BOARD_Y + BOARD / 2, "BOARD CLEAR +300", p.primary);
        } else if (e.t === "deal") {
          dealAt = clock;
        } else if (e.t === "return") {
          flies.push({ slot: e.slot as number, fromX: e.x!, fromY: e.y!, at: clock });
          bumpAt = clock;
        } else if (e.t === "bump") {
          bumpAt = clock;
          kit.fx.addShake(3);
        } else if (e.t === "gameover") {
          kit.fx.addShake(6);
          kit.fx.flash();
          for (let i = 0; i < N * N; i += 3) {
            if (v.board[i]) kit.fx.burst(cellX(i % N) + CELL / 2, cellY(Math.floor(i / N)) + CELL / 2, col(v.board[i] - 1), 2, 60, 300);
          }
        }
      }
    },
    draw(v, dtMs) {
      clock += dtMs;
      kit.background(dtMs);
      header(v);
      board(v);
      tray(v);
      hints(v);
      if (comboText && clock - comboAt < 900) {
        const k = (clock - comboAt) / 900;
        ctx.globalAlpha = Math.min(1, (1 - k) * 2.5);
        bigText(comboText, FIELD_W / 2, BOARD_Y + BOARD / 2 + 10 - k * 24, 22 + 6 * Math.max(0, 1 - k * 4), p.accent);
        ctx.globalAlpha = 1;
      }
      if (v.over) {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.beginPath();
        ctx.roundRect(BOARD_X - 6, BOARD_Y - 6, BOARD + 12, BOARD + 12, 12);
        ctx.fill();
        const s = 104;
        ctx.drawImage(kit.sprites.sad, FIELD_W / 2 - s / 2, BOARD_Y + BOARD / 2 - s + 4 + Math.sin(clock / 300) * 3, s, s);
        bigText("NO ROOM LEFT", FIELD_W / 2, BOARD_Y + BOARD / 2 + 28, 24);
        kit.text(`${v.score} POINTS`, FIELD_W / 2, BOARD_Y + BOARD / 2 + 56, 12, p.text);
      }
      dragged(v);
      kit.fx.draw(kit, dtMs);
    },
  };
}
