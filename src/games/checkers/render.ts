// Moon Checkers renderer: themed board, mascot coins vs bear coins, smooth
// slides and arcing jumps, crowns on kings, a rung ladder and a reacting Bear.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, type Kit, rivalColor } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BEAR, BOARD_X, BOARD_Y, CELL, DRAW_MOVES, H, N, RUNGS, W, YOU, isKing, owner, type CheckersView } from "./index.ts";

const R = 16; // coin radius

const cx = (s: number) => BOARD_X + (s % N) * CELL + CELL / 2;
const cy = (s: number) => BOARD_Y + Math.floor(s / N) * CELL + CELL / 2;

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

type BearMood = "grump" | "smug" | "sad";

function bearFace(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, ink: string, mood: BearMood) {
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

function crown(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string, ink: string) {
  const pts: [number, number][] = [[-9, 4], [-9, -4], [-4.5, 0], [0, -7], [4.5, 0], [9, -4], [9, 4]];
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(-1, -2, 2, 2);
  ctx.restore();
}

interface Ghost { x: number; y: number; who: number; king: boolean; ms: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<CheckersView> {
  const kit: Kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const rival = rivalColor(theme);
  const { ctx } = kit;
  let t = 0;
  let bearShake = 0;
  let ghosts: Ghost[] = [];
  let crownPop: { s: number; ms: number } | null = null;
  let landSquash: { s: number; ms: number } | null = null;
  let nope: { s: number; ms: number; why: string } | null = null;
  let curX = cx(42);
  let curY = cy(42);

  function coin(x: number, y: number, piece: number, scale = 1, mood: BearMood = "grump", sx = 1, sy = 1) {
    const who = owner(piece);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * sx, scale * sy);
    // edge (thickness) under the face
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(0, 3.5, R + 1.5, R + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    const fill = who === YOU ? p.primary : rival;
    ring(ctx, 0, 0, R, fill, p.ink);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, R - 3.5, 0, Math.PI * 2);
    ctx.stroke();
    if (who === YOU) {
      const s = 24;
      const spr = mood === "sad" ? kit.sprites.sad : mood === "smug" ? kit.sprites.happy : kit.sprites.mini;
      ctx.drawImage(spr, -s / 2, -s / 2, s, s);
    } else {
      bearFace(ctx, 0, 1, 0.7, p.ink, mood);
    }
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(-R / 2, -R + 3.5, R / 2, 2);
    if (isKing(piece)) crown(ctx, 0, -R - 1, 0.95, p.accent, p.ink);
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        if (e.t === "capture") {
          const at = e.at as number;
          const piece = e.piece as number;
          ghosts.push({ x: cx(at), y: cy(at), who: owner(piece), king: isKing(piece), ms: 380 });
          const col = owner(piece) === YOU ? p.primary : rival;
          kit.fx.burst(e.x!, e.y!, col, 16, 170);
          kit.fx.burst(e.x!, e.y!, p.accent, 6, 90, 0);
          kit.fx.addShake(e.shake ?? 3);
          if (e.who === YOU) {
            kit.fx.popup(e.x!, e.y! - 16, "JUMP!", p.accent);
            bearShake = 500;
          } else kit.fx.flash();
        } else if (e.t === "land") {
          landSquash = { s: -1, ms: 160 };
          kit.fx.burst(e.x!, e.y! + R - 2, e.who === YOU ? p.primary : rival, 5, 60, 200);
        } else if (e.t === "jump") {
          kit.fx.burst(e.x!, e.y! + R - 2, p.text, 5, 70, 300);
        } else if (e.t === "crown") {
          const s = Math.floor((e.y! - BOARD_Y) / CELL) * N + Math.floor((e.x! - BOARD_X) / CELL);
          crownPop = { s, ms: 600 };
          kit.fx.burst(e.x!, e.y! - 10, p.accent, 22, 190, 260);
          kit.fx.popup(e.x!, e.y! - 26, e.who === YOU ? "CROWNED!" : "BEAR KING", e.who === YOU ? p.accent : rival);
          kit.fx.addShake(3);
        } else if (e.t === "select") {
          kit.fx.burst(e.x!, e.y!, p.primary, 4, 50, 0);
        } else if (e.t === "nope") {
          nope = { s: Math.floor((e.y! - BOARD_Y) / CELL) * N + Math.floor((e.x! - BOARD_X) / CELL), ms: 400, why: e.why as string };
          kit.fx.popup(e.x!, e.y! - 18, (e.why as string).toUpperCase(), p.text);
          kit.fx.addShake(2);
        } else if (e.t === "more") {
          kit.fx.popup(e.x!, e.y! - 18, "AGAIN!", p.accent);
        } else if (e.t === "win") {
          for (let i = 0; i < N * N; i++) if (owner(v.board[i]) === YOU) kit.fx.burst(cx(i), cy(i), p.bricks[i % p.bricks.length], 10, 200);
          kit.fx.popup(W / 2, BOARD_Y + 120, `+${e.points as number}`, p.accent);
          if ((e.bonus as number) > 0) kit.fx.popup(W / 2, BOARD_Y + 140, `FAST +${e.bonus as number}`, p.text);
          kit.fx.flash("255,255,255");
          kit.fx.addShake(5);
          bearShake = 900;
        } else if (e.t === "lose") {
          kit.fx.flash();
          kit.fx.addShake(8);
        } else if (e.t === "won") {
          for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * W, H * 0.45, p.bricks[i % p.bricks.length], 14, 240);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      bearShake = Math.max(0, bearShake - dtMs);
      ghosts = ghosts.filter((g) => (g.ms -= dtMs) > 0);
      if (crownPop && (crownPop.ms -= dtMs) <= 0) crownPop = null;
      if (landSquash && (landSquash.ms -= dtMs) <= 0) landSquash = null;
      if (nope && (nope.ms -= dtMs) <= 0) nope = null;
      kit.background(dtMs);

      // --- Rung ladder ---
      const pipW = 26;
      const lx = W / 2 - (RUNGS * pipW) / 2;
      kit.text(`RUNG ${v.level}/${RUNGS}`, W / 2, 40, 14, p.text);
      for (let i = 0; i < RUNGS; i++) {
        const x = lx + i * pipW + 3;
        const done = i < v.wins;
        const cur = i === v.level - 1 && !v.runWon;
        ctx.globalAlpha = done ? 1 : cur ? 0.6 + 0.4 * Math.sin(t / 180) : 0.35;
        kit.block(x, 54, pipW - 6, 12, done ? p.primary : cur ? p.accent : p.wall, 3);
      }
      ctx.globalAlpha = 1;

      // --- Bear (left) and you (right) ---
      let yours = 0, bears = 0;
      for (const c of v.board) if (owner(c) === YOU) yours++; else if (owner(c) === BEAR) bears++;
      const thinking = v.phase === "think";
      const bearWon = v.outcome === "lose";
      const bearLost = v.outcome === "win";
      const shakeX = bearShake > 0 ? Math.sin(t / 25) * 3 * (bearShake / 900) : 0;
      ctx.save();
      ctx.translate(52 + shakeX, 108 + Math.sin(t / 300) * 2);
      ring(ctx, -16, -18, 8, rival, p.ink);
      ring(ctx, 16, -18, 8, rival, p.ink);
      ring(ctx, 0, 0, 26, rival, p.ink);
      bearFace(ctx, 0, 2, 1.25, p.ink, bearWon ? "smug" : bearLost || bearShake > 0 ? "sad" : "grump");
      ctx.restore();
      kit.text(`BEAR x${bears}`, 52, 150, 10, p.text);
      let say = "";
      if (thinking) say = ".".repeat(1 + (Math.floor(t / 250) % 3));
      else if (bearWon) say = "HA!";
      else if (bearLost) say = "GRR!";
      else if (bearShake > 0) say = "OUCH";
      if (say) {
        ctx.fillStyle = p.text;
        ctx.beginPath();
        ctx.roundRect(88, 82, 64, 24, 8);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(90, 98);
        ctx.lineTo(80, 106);
        ctx.lineTo(98, 102);
        ctx.fill();
        ctx.fillStyle = p.ink;
        ctx.font = `bold 12px ${kit.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(say, 120, 94);
      }
      const ys = 52;
      const youSprite = v.outcome === "win" || v.runWon ? kit.sprites.happy : v.outcome === "lose" ? kit.sprites.sad : kit.sprites.idle;
      const yourBob = v.phase === "turn" ? Math.sin(t / 160) * 3 : 0;
      ctx.drawImage(youSprite, W - 52 - ys / 2, 106 - ys / 2 + yourBob, ys, ys);
      kit.text(`YOU x${yours}`, W - 52, 150, 10, p.text);

      // --- Board ---
      const bw = N * CELL;
      kit.block(BOARD_X - 7, BOARD_Y - 7, bw + 14, bw + 14, p.wall, 10);
      for (let r = 0; r < N; r++)
        for (let c = 0; c < N; c++) {
          const dark = (r + c) % 2 === 1;
          ctx.fillStyle = dark ? p.bg : p.text;
          ctx.globalAlpha = dark ? 0.85 : 0.14;
          ctx.fillRect(BOARD_X + c * CELL, BOARD_Y + r * CELL, CELL, CELL);
        }
      ctx.globalAlpha = 1;
      // Last move trail
      if (v.lastFrom >= 0 && v.lastTo >= 0 && v.phase !== "anim") {
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.16;
        ctx.fillRect(cx(v.lastFrom) - CELL / 2, cy(v.lastFrom) - CELL / 2, CELL, CELL);
        ctx.fillRect(cx(v.lastTo) - CELL / 2, cy(v.lastTo) - CELL / 2, CELL, CELL);
        ctx.globalAlpha = 1;
      }
      const turn = v.phase === "turn";
      // Movable pieces pulse (forced jumps glow brighter)
      if (turn && v.selected < 0) {
        for (const s of v.movable) {
          ctx.strokeStyle = v.mustJump ? p.accent : p.primary;
          ctx.globalAlpha = (v.mustJump ? 0.55 : 0.3) + 0.25 * Math.sin(t / 160);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(cx(s), cy(s), R + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      // Destinations
      if (turn) {
        for (const d of v.dests) {
          const pulse = 0.5 + 0.5 * Math.sin(t / 130);
          ctx.fillStyle = p.accent;
          ctx.globalAlpha = 0.22 + 0.12 * pulse;
          ctx.fillRect(cx(d) - CELL / 2 + 2, cy(d) - CELL / 2 + 2, CELL - 4, CELL - 4);
          ctx.globalAlpha = 1;
          ring(ctx, cx(d), cy(d), 5 + pulse * 1.5, p.accent, p.ink);
        }
      }

      // Pieces
      const hop = v.hop;
      for (let s = 0; s < N * N; s++) {
        const piece = v.board[s];
        if (piece <= 0) continue;
        if (hop && s === hop.from) continue;
        let sx = 1, sy = 1, scale = 1;
        if (landSquash && s === v.lastTo) {
          const k = landSquash.ms / 160;
          sx = 1 + 0.15 * k;
          sy = 1 - 0.15 * k;
        }
        if (crownPop && s === crownPop.s) scale = 1 + 0.25 * Math.sin((crownPop.ms / 600) * Math.PI);
        if (s === v.selected && turn) scale *= 1.1 + 0.04 * Math.sin(t / 110);
        if (nope && s === nope.s) sx *= 1 + 0.06 * Math.sin(t / 20);
        const who = owner(piece);
        const mood: BearMood = v.outcome === "lose" ? (who === YOU ? "sad" : "smug") : v.outcome === "win" ? (who === YOU ? "smug" : "sad") : "grump";
        const lift = s === v.selected && turn ? -3 : 0;
        if (hop && s === hop.cap) {
          // victim trembles while being jumped
          coin(cx(s) + Math.sin(t / 18) * 1.5, cy(s), piece, 1, "sad");
          continue;
        }
        coin(cx(s), cy(s) + lift, piece, scale, mood, sx, sy);
        if (s === v.selected && turn) {
          ctx.strokeStyle = p.accent;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(cx(s), cy(s) + lift, R + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
      // Captured ghosts: pop and fade
      for (const g of ghosts) {
        const k = 1 - g.ms / 380;
        ctx.globalAlpha = 1 - k;
        coin(g.x, g.y - k * 10, (g.who === YOU ? YOU : BEAR) + (g.king ? 2 : 0), 1 + k * 0.6, "sad");
        ctx.globalAlpha = 1;
      }
      // Moving piece
      if (hop) {
        const k = Math.min(1, v.phaseT / v.hopFrames);
        const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
        const x = cx(hop.from) + (cx(hop.to) - cx(hop.from)) * e;
        let y = cy(hop.from) + (cy(hop.to) - cy(hop.from)) * e;
        let scale = 1.05;
        if (hop.cap >= 0) {
          const arc = Math.sin(k * Math.PI);
          y -= arc * 26;
          scale = 1 + arc * 0.3;
          ctx.fillStyle = p.ink;
          ctx.globalAlpha = 0.3;
          ctx.beginPath();
          ctx.ellipse(x, cy(hop.from) + (cy(hop.to) - cy(hop.from)) * e + 6, R * (1 - arc * 0.3), R * 0.45, 0, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
        }
        coin(x, y, hop.piece, scale, hop.cap >= 0 ? "smug" : "grump");
      }

      // Cursor
      curX += (cx(v.cursor) - curX) * Math.min(1, dtMs / 50);
      curY += (cy(v.cursor) - curY) * Math.min(1, dtMs / 50);
      if (turn) {
        const h = CELL / 2 - 1;
        const L = 8;
        ctx.strokeStyle = p.text;
        ctx.globalAlpha = 0.7 + 0.3 * Math.sin(t / 150);
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (const [ax, ay] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          ctx.moveTo(curX + ax * h, curY + ay * h - ay * L);
          ctx.lineTo(curX + ax * h, curY + ay * h);
          ctx.lineTo(curX + ax * h - ax * L, curY + ay * h);
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // --- Bottom status ---
      const sy = BOARD_Y + bw + 30;
      if (turn) {
        const msg = v.locked ? "KEEP JUMPING!" : v.mustJump ? "YOU MUST JUMP" : v.selected >= 0 ? "TAP WHERE IT GOES" : v.yourMoves === 0 ? "TAP A COIN TO MOVE" : "YOUR MOVE";
        kit.text(msg, W / 2, sy, 14, v.mustJump || v.locked ? p.accent : p.primary);
      } else if (thinking) kit.text("BEAR IS THINKING", W / 2, sy, 14, rival);
      kit.text(`SCORE ${v.score}`, W / 2, sy + 26, 12, p.text);
      if (v.quiet >= DRAW_MOVES - 15 && v.phase !== "end" && v.phase !== "over") {
        ctx.globalAlpha = 0.8;
        kit.text(`DRAW IN ${DRAW_MOVES - v.quiet} MOVES`, W / 2, sy + 46, 10, p.accent);
        ctx.globalAlpha = 1;
      }

      // --- Banners ---
      const banner = (title: string, sub: string, color: string, a = 1) => {
        const my = BOARD_Y + bw / 2;
        ctx.globalAlpha = 0.72 * a;
        ctx.fillStyle = p.ink;
        ctx.fillRect(0, my - 46, W, 92);
        ctx.globalAlpha = a;
        kit.text(title, W / 2, my - 12, 28, color);
        if (sub) kit.text(sub, W / 2, my + 22, 12, p.text);
        ctx.globalAlpha = 1;
      };
      if (v.phase === "intro") {
        const a = Math.min(1, v.phaseT / 10, (80 - v.phaseT) / 12);
        banner(`RUNG ${v.level}`, v.youFirst ? "YOU START" : "BEAR STARTS", p.accent, Math.max(0, a));
      } else if (v.phase === "end" && v.phaseT > 30) {
        const a = Math.min(1, (v.phaseT - 30) / 12);
        if (v.outcome === "win") banner("YOU WIN!", v.level >= RUNGS ? "TOP RUNG BEATEN" : "NEXT BEAR IS SHARPER", p.primary, a);
        else if (v.outcome === "lose") banner("BEAR WINS", "RUN OVER", rival, a);
        else banner("DRAW", "REPLAY THIS RUNG", p.text, a);
      } else if (v.phase === "over") {
        banner(v.runWon ? "LADDER CLEARED!" : "GAME OVER", `${v.wins} WIN${v.wins === 1 ? "" : "S"}`, v.runWon ? p.accent : p.text);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
