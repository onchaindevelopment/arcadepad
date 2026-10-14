// Four Up renderer: chunky themed rack, mascot coins vs bear coins, bouncy drops,
// glowing winning four, a rung ladder and a bear that reacts.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, type Kit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { AIM_Y, BEAR, BOARD_X, BOARD_Y, CELL, COLS, H, ROWS, RUNGS, W, YOU, type FourView } from "./index.ts";

const R = 19; // disc radius

const cx = (c: number) => BOARD_X + c * CELL + CELL / 2;
const cy = (r: number) => BOARD_Y + r * CELL + CELL / 2;

function ring(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, ink: string) {
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x, y, r + 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function bearFace(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string, mood: "grump" | "smug" | "sad") {
  // s = scale where 1 means a disc of radius R
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.beginPath();
  ctx.arc(x - 9 * s, y - 10 * s, 4.5 * s, 0, Math.PI * 2);
  ctx.arc(x + 9 * s, y - 10 * s, 4.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, y + 5 * s, 7 * s, 5 * s, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  const ey = y - 3 * s;
  if (mood === "sad") {
    ctx.fillRect(x - 7 * s, ey, 4 * s, 1.5 * s);
    ctx.fillRect(x + 3 * s, ey, 4 * s, 1.5 * s);
  } else {
    ctx.fillRect(x - 6.5 * s, ey - 1 * s, 3 * s, 3 * s);
    ctx.fillRect(x + 3.5 * s, ey - 1 * s, 3 * s, 3 * s);
  }
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(1, 1.6 * s);
  ctx.beginPath();
  if (mood === "grump") {
    ctx.moveTo(x - 9 * s, ey - 5 * s);
    ctx.lineTo(x - 3 * s, ey - 2.5 * s);
    ctx.moveTo(x + 9 * s, ey - 5 * s);
    ctx.lineTo(x + 3 * s, ey - 2.5 * s);
  }
  ctx.stroke();
  ctx.fillRect(x - 2 * s, y + 2 * s, 4 * s, 2.5 * s);
  ctx.beginPath();
  if (mood === "smug") ctx.arc(x, y + 5 * s, 3.5 * s, Math.PI * 0.15, Math.PI * 0.85);
  else ctx.arc(x, y + 11 * s, 3.5 * s, Math.PI * 1.2, Math.PI * 1.8);
  ctx.stroke();
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<FourView> {
  const kit: Kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const { ctx } = kit;
  let t = 0;
  let squash: { idx: number; ms: number } | null = null;
  let bearShake = 0;
  let aimX = cx(3);
  let bearX = cx(3);

  function disc(x: number, y: number, who: number, sx = 1, sy = 1, mood: "grump" | "smug" | "sad" = "grump") {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(sx, sy);
    const fill = who === YOU ? p.primary : p.secondary;
    ring(ctx, 0, 0, R, fill, p.ink);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R - 4, 0, Math.PI * 2);
    ctx.stroke();
    if (who === YOU) {
      const s = 30;
      ctx.drawImage(mood === "sad" ? kit.sprites.sad : mood === "smug" ? kit.sprites.happy : kit.sprites.mini, -s / 2, -s / 2, s, s);
    } else {
      bearFace(ctx, 0, 1, 0.85, p.ink, mood);
    }
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-R / 2, -R + 4, R / 2, 2);
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.t === "thud") {
          squash = { idx: (e.row as number) * COLS + (e.col as number), ms: 220 };
          kit.fx.burst(e.x!, e.y! + R - 2, e.who === YOU ? p.primary : p.secondary, 8, 110, 380);
          kit.fx.addShake(2 + (e.power as number) * 3);
        } else if (e.t === "drop") {
          kit.fx.burst(e.x!, e.y!, p.text, 4, 60, 0);
        } else if (e.t === "full") {
          kit.fx.popup(e.x!, e.y! - 22, "FULL", p.accent);
          kit.fx.addShake(3);
        } else if (e.t === "win") {
          const cells = e.cells as number[];
          for (const i of cells) kit.fx.burst(cx(i % COLS), cy(Math.floor(i / COLS)), p.bricks[i % p.bricks.length], 14, 200);
          kit.fx.popup(e.x!, e.y! - 8, `+${e.points as number}`, p.accent);
          if ((e.bonus as number) > 0) kit.fx.popup(e.x!, e.y! + 12, `FAST +${e.bonus as number}`, p.text);
          kit.fx.flash("255,255,255");
          kit.fx.addShake(5);
          bearShake = 900;
        } else if (e.t === "lose") {
          kit.fx.flash();
          kit.fx.addShake(8);
          for (const i of e.cells as number[]) kit.fx.burst(cx(i % COLS), cy(Math.floor(i / COLS)), p.secondary, 10, 160);
        } else if (e.t === "won") {
          for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * W, H * 0.45, p.bricks[i % p.bricks.length], 14, 240);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      bearShake = Math.max(0, bearShake - dtMs);
      if (squash) {
        squash.ms -= dtMs;
        if (squash.ms <= 0) squash = null;
      }
      kit.background(dtMs);

      // --- Rung ladder ---
      const pipW = 26;
      const lx = W / 2 - (RUNGS * pipW) / 2;
      kit.text(`RUNG ${v.level}/${RUNGS}`, W / 2, 46, 14, p.text);
      for (let i = 0; i < RUNGS; i++) {
        const x = lx + i * pipW + 3;
        const done = i < v.wins;
        const cur = i === v.level - 1 && !v.runWon;
        const pulse = cur ? 0.6 + 0.4 * Math.sin(t / 180) : 1;
        ctx.globalAlpha = done ? 1 : cur ? pulse : 0.35;
        kit.block(x, 60, pipW - 6, 12, done ? p.primary : cur ? p.accent : p.wall, 3);
      }
      ctx.globalAlpha = 1;

      // --- The Bear (top left) and you (top right) ---
      const thinking = v.phase === "think";
      const bearWon = v.outcome === "lose";
      const bearLost = v.outcome === "win";
      const bob = Math.sin(t / 300) * 2;
      const shakeX = bearShake > 0 ? Math.sin(t / 25) * 3 * (bearShake / 900) : 0;
      const bx = 52 + shakeX;
      const by = 118 + bob;
      ctx.save();
      ctx.translate(bx, by);
      ring(ctx, -16, -18, 8, p.secondary, p.ink);
      ring(ctx, 16, -18, 8, p.secondary, p.ink);
      ring(ctx, 0, 0, 26, p.secondary, p.ink);
      bearFace(ctx, 0, 2, 1.25, p.ink, bearWon ? "smug" : bearLost ? "sad" : "grump");
      ctx.restore();
      kit.text(`BEAR LV${v.level}`, 52, 160, 10, p.text);
      // Speech bubble
      let say = "";
      if (thinking) say = ".".repeat(1 + (Math.floor(t / 250) % 3));
      else if (bearWon) say = "HA!";
      else if (bearLost) say = "GRR!";
      else if (v.phase === "turn") say = v.yourMoves === 0 && v.board.every((c) => c === 0) ? "GO ON" : "";
      if (say) {
        ctx.fillStyle = p.text;
        ctx.beginPath();
        ctx.roundRect(88, 92, 64, 24, 8);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(90, 108);
        ctx.lineTo(80, 116);
        ctx.lineTo(98, 112);
        ctx.fill();
        ctx.fillStyle = p.ink;
        ctx.font = `bold 12px ${kit.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(say, 120, 104);
      }
      const ys = 56;
      const youSprite = v.outcome === "win" || v.runWon ? kit.sprites.happy : v.outcome === "lose" ? kit.sprites.sad : kit.sprites.idle;
      const yourBob = v.phase === "turn" ? Math.sin(t / 160) * 3 : 0;
      ctx.drawImage(youSprite, W - 52 - ys / 2, 118 - ys / 2 + yourBob, ys, ys);
      kit.text("YOU", W - 52, 160, 10, p.text);

      // --- Rack ---
      const bw = COLS * CELL;
      const bh = ROWS * CELL;
      kit.block(BOARD_X - 6, BOARD_Y - 6, bw + 12, bh + 12, p.wall, 10);
      // Column highlight under your aim
      if (v.phase === "turn") {
        ctx.fillStyle = p.primary;
        ctx.globalAlpha = 0.12 + 0.05 * Math.sin(t / 150);
        ctx.fillRect(BOARD_X + v.cursor * CELL + 2, BOARD_Y, CELL - 4, bh);
        ctx.globalAlpha = 1;
      }
      // Sockets
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          ctx.fillStyle = p.ink;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.arc(cx(c), cy(r), R + 1, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 0.25;
          ctx.fillStyle = p.bg;
          ctx.beginPath();
          ctx.arc(cx(c), cy(r) + 2, R - 2, 0, Math.PI * 2);
          ctx.fill();
        }
      ctx.globalAlpha = 1;

      // Discs
      const win = v.winLine ? new Set(v.winLine) : null;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const idx = r * COLS + c;
          const who = v.board[idx];
          if (!who) continue;
          let sx = 1, sy = 1, oy = 0;
          if (squash && squash.idx === idx) {
            const k = squash.ms / 220;
            sx = 1 + 0.18 * k;
            sy = 1 - 0.18 * k;
            oy = R * 0.18 * k;
          }
          const dim = win && !win.has(idx);
          if (dim) ctx.globalAlpha = 0.4;
          const winner = win && win.has(idx);
          const mood = winner ? "smug" : v.outcome === "lose" && who === YOU ? "sad" : v.outcome === "win" && who === BEAR ? "sad" : "grump";
          const pop = winner ? 1 + 0.08 * Math.sin(t / 120 + idx) : 1;
          disc(cx(c), cy(r) + oy, who, sx * pop, sy * pop, mood);
          ctx.globalAlpha = 1;
          if (idx === v.lastIdx && !win) {
            ctx.fillStyle = p.text;
            ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 200);
            ctx.fillRect(cx(c) - 3, cy(r) - R - 5, 6, 3);
            ctx.globalAlpha = 1;
          }
        }

      // Winning four: glowing link + rings
      if (v.winLine) {
        const a = v.winLine[0];
        const b = v.winLine[v.winLine.length - 1];
        const color = v.outcome === "win" ? p.accent : p.text;
        ctx.save();
        ctx.shadowColor = color;
        ctx.shadowBlur = 12;
        ctx.strokeStyle = color;
        ctx.globalAlpha = 0.75 + 0.25 * Math.sin(t / 100);
        ctx.lineWidth = 5;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(cx(a % COLS), cy(Math.floor(a / COLS)));
        ctx.lineTo(cx(b % COLS), cy(Math.floor(b / COLS)));
        ctx.stroke();
        ctx.lineWidth = 3;
        for (const i of v.winLine) {
          ctx.beginPath();
          ctx.arc(cx(i % COLS), cy(Math.floor(i / COLS)), R + 4 + Math.sin(t / 140) * 1.5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      // Falling disc (bounce comes from the engine)
      if (v.drop) {
        const d = v.drop;
        const y0 = AIM_Y;
        const y1 = cy(d.row);
        const y = y0 + ((d.y + 1) / (d.row + 1)) * (y1 - y0);
        const stretch = Math.min(0.15, Math.abs(d.vy) * 0.25);
        disc(cx(d.col), y, d.who, 1 - stretch, 1 + stretch);
      }

      // Hovering discs above the rack
      const aimTarget = cx(v.cursor);
      aimX += (aimTarget - aimX) * Math.min(1, dtMs / 60);
      const bearTarget = cx(v.bearCol);
      bearX += (bearTarget - bearX) * Math.min(1, dtMs / 70);
      if (v.phase === "turn") {
        disc(aimX, AIM_Y + Math.sin(t / 180) * 2, YOU);
        ctx.fillStyle = p.primary;
        ctx.beginPath();
        ctx.moveTo(aimX - 6, BOARD_Y - 4);
        ctx.lineTo(aimX + 6, BOARD_Y - 4);
        ctx.lineTo(aimX, BOARD_Y + 3);
        ctx.fill();
      } else if (v.phase === "think") {
        disc(bearX + Math.sin(t / 60) * 1.2, AIM_Y + Math.sin(t / 140) * 2, BEAR);
      }

      // --- Bottom status ---
      const sy = BOARD_Y + bh + 40;
      if (v.phase === "turn") kit.text(v.yourMoves === 0 ? "TAP A COLUMN TO DROP" : "YOUR MOVE", W / 2, sy, 14, p.primary);
      else if (v.phase === "think") kit.text("BEAR IS THINKING", W / 2, sy, 14, p.secondary);
      kit.text(`SCORE ${v.score}`, W / 2, sy + 30, 12, p.text);
      if (v.phase === "turn" && v.yourMoves < 21) {
        const bonus = Math.max(0, 21 - v.yourMoves) * 50;
        ctx.globalAlpha = 0.7;
        kit.text(`WIN NOW: +${1000 + Math.max(0, bonus - 50)}`, W / 2, sy + 50, 10, p.accent);
        ctx.globalAlpha = 1;
      }

      // --- Banners ---
      const banner = (title: string, sub: string, color: string, a = 1) => {
        ctx.globalAlpha = 0.72 * a;
        ctx.fillStyle = p.ink;
        ctx.fillRect(0, BOARD_Y + bh / 2 - 46, W, 92);
        ctx.globalAlpha = a;
        kit.text(title, W / 2, BOARD_Y + bh / 2 - 12, 28, color);
        if (sub) kit.text(sub, W / 2, BOARD_Y + bh / 2 + 22, 12, p.text);
        ctx.globalAlpha = 1;
      };
      if (v.phase === "intro") {
        const a = Math.min(1, v.phaseT / 10, (80 - v.phaseT) / 12);
        banner(`RUNG ${v.level}`, v.youFirst ? "YOU START" : "BEAR STARTS", p.accent, Math.max(0, a));
      } else if (v.phase === "end" && v.phaseT > 40) {
        const a = Math.min(1, (v.phaseT - 40) / 12);
        if (v.outcome === "win") banner("YOU WIN!", v.level >= RUNGS ? "TOP RUNG BEATEN" : "NEXT BEAR IS SHARPER", p.primary, a);
        else if (v.outcome === "lose") banner("BEAR WINS", "RUN OVER", p.secondary, a);
        else banner("DRAW", "REPLAY THIS RUNG", p.text, a);
      } else if (v.phase === "over") {
        banner(v.runWon ? "LADDER CLEARED!" : "GAME OVER", `${v.wins} WIN${v.wins === 1 ? "" : "S"}`, v.runWon ? p.accent : p.text);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
