// Block Drop renderer: a glass coin jar, clusters of round jelly coins with
// little faces (or the ticker initial), a bubble queue and the mascot cheering
// on the side. Everything is coloured from the theme palette.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CELL, COLS, FIELD_H, FIELD_W, ROWS, WELL_X, WELL_Y, shapeCells, type BlocksView } from "./index.ts";

const WELL_W = COLS * CELL;
const WELL_H = ROWS * CELL;
const PANEL_X = WELL_X + WELL_W + 12;
const PANEL_W = FIELD_W - PANEL_X - 8;
const PANEL_CX = PANEL_X + PANEL_W / 2;
const TAU = Math.PI * 2;
const CLEAR_WORDS = ["", "NICE", "DOUBLE", "TRIPLE", "MEGA POP!"];

type Face = "normal" | "pop" | "sad";
interface CoinSpec { x: number; y: number; kind: number; id: number; sq: number; scale: number; alpha: number; face: Face }
interface Ring { x: number; y: number; r: number; life: number; max: number; color: string }
interface Trail { x: number; y0: number; y1: number; life: number; color: string }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BlocksView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const color = (kind: number) => p.bricks[kind % p.bricks.length];
  let t = 0;
  const squash = new Map<number, number>(); // cluster id -> ms since it set
  const rings: Ring[] = [];
  const trails: Trail[] = [];
  let cheer = 0; // ms left of mascot cheering
  let sad = false;
  let banner = { text: "", sub: "", life: 0 };
  let lastDrop = 0;
  let nudge = 0; // sideways wobble of the active cluster after a bump

  const initial = () => (theme.coin.ticker || "X").charAt(0).toUpperCase();

  function face(x: number, y: number, r: number, kind: number, f: Face, ticker: string) {
    ctx.fillStyle = p.ink;
    if (f === "normal" && kind % 3 === 1) {
      ctx.font = `bold ${Math.round(r * 1.2)}px ${kit.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.globalAlpha *= 0.85;
      ctx.fillText(ticker, x, y + 0.5);
      ctx.globalAlpha /= 0.85;
      return;
    }
    const e = Math.max(1, r * 0.2);
    const ex = r * 0.36;
    const ey = y - r * 0.18;
    if (f === "pop") {
      // ^ ^ eyes and a wide grin
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - ex - e, ey + e * 0.6); ctx.lineTo(x - ex, ey - e * 0.4); ctx.lineTo(x - ex + e, ey + e * 0.6);
      ctx.moveTo(x + ex - e, ey + e * 0.6); ctx.lineTo(x + ex, ey - e * 0.4); ctx.lineTo(x + ex + e, ey + e * 0.6);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y + r * 0.15, r * 0.38, 0, Math.PI);
      ctx.fill();
      return;
    }
    if (f === "sad") {
      ctx.fillRect(x - ex - e / 2, ey, e, e);
      ctx.fillRect(x + ex - e / 2, ey, e, e);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(x, y + r * 0.62, r * 0.3, Math.PI * 1.15, Math.PI * 1.85);
      ctx.stroke();
      return;
    }
    const blink = ((t / 90 + kind * 37) | 0) % 47 === 0;
    const style = kind % 3;
    if (blink) {
      ctx.fillRect(x - ex - e / 2, ey + e * 0.4, e, 1);
      ctx.fillRect(x + ex - e / 2, ey + e * 0.4, e, 1);
    } else if (style === 2 && kind % 2 === 0) {
      // wink
      ctx.fillRect(x - ex - e / 2, ey, e, e);
      ctx.fillRect(x + ex - e / 2, ey + e * 0.4, e, 1);
    } else {
      ctx.fillRect(x - ex - e / 2, ey, e, e);
      ctx.fillRect(x + ex - e / 2, ey, e, e);
    }
    if (style === 0) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(x, y + r * 0.12, r * 0.3, Math.PI * 0.15, Math.PI * 0.85);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y + r * 0.32, r * 0.14, 0, TAU);
      ctx.fill();
    }
  }

  /** Draw a set of coins with jelly bridges between neighbours of the same cluster. */
  function drawCoins(coins: CoinSpec[], r: number, cell: number, ticker: string) {
    const byPos = new Map<string, CoinSpec>();
    for (const c of coins) byPos.set(`${Math.round(c.x / cell * 2)},${Math.round(c.y / cell * 2)}`, c);
    const bridges: [CoinSpec, CoinSpec][] = [];
    for (const c of coins) {
      if (c.scale < 0.95 || c.alpha < 1) continue;
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const n = byPos.get(`${Math.round((c.x + dx * cell) / cell * 2)},${Math.round((c.y + dy * cell) / cell * 2)}`);
        if (n && n.id === c.id && n.scale >= 0.95 && n.alpha >= 1) bridges.push([c, n]);
      }
    }
    const bw = r * 1.05;
    const geo = (c: CoinSpec) => {
      const s = c.sq;
      const rx = r * c.scale * (1 + 0.16 * s);
      const ry = r * c.scale * (1 - 0.22 * s);
      return { rx, ry, cy: c.y + (r * c.scale - ry) };
    };
    // Pass 1: ink outlines
    ctx.fillStyle = p.ink;
    for (const [a, b] of bridges) {
      ctx.beginPath();
      if (a.y === b.y) ctx.roundRect(a.x, a.y - bw / 2 - 1.5, b.x - a.x, bw + 3, 2);
      else ctx.roundRect(a.x - bw / 2 - 1.5, a.y, bw + 3, b.y - a.y, 2);
      ctx.fill();
    }
    for (const c of coins) {
      const g = geo(c);
      ctx.globalAlpha = c.alpha;
      ctx.beginPath();
      ctx.ellipse(c.x, g.cy, g.rx + 1.5, g.ry + 1.5, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // Pass 2: jelly fills
    for (const [a, b] of bridges) {
      ctx.fillStyle = color(a.kind);
      ctx.beginPath();
      if (a.y === b.y) ctx.rect(a.x, a.y - bw / 2, b.x - a.x, bw);
      else ctx.rect(a.x - bw / 2, a.y, bw, b.y - a.y);
      ctx.fill();
    }
    for (const c of coins) {
      const g = geo(c);
      ctx.globalAlpha = c.alpha;
      ctx.fillStyle = color(c.kind);
      ctx.beginPath();
      ctx.ellipse(c.x, g.cy, g.rx, g.ry, 0, 0, TAU);
      ctx.fill();
    }
    // Pass 3: rim, shine, face
    for (const c of coins) {
      const g = geo(c);
      ctx.globalAlpha = c.alpha;
      ctx.strokeStyle = "rgba(0,0,0,0.22)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(c.x, g.cy, Math.max(0.5, g.rx - 2.2), Math.max(0.5, g.ry - 2.2), 0, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.beginPath();
      ctx.ellipse(c.x - g.rx * 0.4, g.cy - g.ry * 0.45, g.rx * 0.28, g.ry * 0.16, -0.6, 0, TAU);
      ctx.fill();
      if (r >= 4.5) face(c.x, g.cy + 0.5, Math.min(g.rx, g.ry), c.kind, c.face, ticker);
    }
    ctx.globalAlpha = 1;
  }

  function drawJar(v: BlocksView) {
    // Glass jar body
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(WELL_X - 5, WELL_Y - 4, WELL_W + 10, WELL_H + 9, [6, 6, 16, 16]);
    ctx.fill();
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.roundRect(WELL_X - 3, WELL_Y - 2, WELL_W + 6, WELL_H + 5, [5, 5, 14, 14]);
    ctx.fill();
    const g = ctx.createLinearGradient(0, WELL_Y, 0, WELL_Y + WELL_H);
    g.addColorStop(0, p.bg);
    g.addColorStop(1, p.bg2);
    ctx.fillStyle = g;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.roundRect(WELL_X, WELL_Y, WELL_W, WELL_H, [3, 3, 12, 12]);
    ctx.fill();
    ctx.globalAlpha = 1;
    // Slot dimples instead of grid lines
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      ctx.beginPath();
      ctx.arc(WELL_X + c * CELL + CELL / 2, WELL_Y + r * CELL + CELL / 2, 1.4, 0, TAU);
      ctx.fill();
    }
    // Danger glow when the stack gets high
    let top = ROWS;
    for (let i = 0; i < v.board.length; i++) if (v.board[i]) { top = Math.floor(i / COLS); break; }
    if (top < 5 && !v.over) {
      const a = (0.18 + 0.12 * Math.sin(t / 120)) * (5 - top) / 5;
      const dg = ctx.createLinearGradient(0, WELL_Y, 0, WELL_Y + CELL * 5);
      dg.addColorStop(0, hexA(p.accent, a));
      dg.addColorStop(1, hexA(p.accent, 0));
      ctx.fillStyle = dg;
      ctx.fillRect(WELL_X, WELL_Y, WELL_W, CELL * 5);
    }
  }

  function drawJarGlass() {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.beginPath();
    ctx.roundRect(WELL_X + 4, WELL_Y + 6, 6, WELL_H - 24, 3);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.04)";
    ctx.beginPath();
    ctx.roundRect(WELL_X + 14, WELL_Y + 6, 3, WELL_H - 40, 2);
    ctx.fill();
  }

  function drawPanel(v: BlocksView, ticker: string) {
    kit.text("UP NEXT", PANEL_CX, WELL_Y + 6, 9, p.text);
    const pods = [
      { y: WELL_Y + 46, r: 30, cell: 11 },
      { y: WELL_Y + 104, r: 21, cell: 8 },
    ];
    pods.forEach((pod, i) => {
      const kind = v.next[i];
      const bob = Math.sin(t / 380 + i * 1.7) * 1.5;
      const cy = pod.y + bob;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(PANEL_CX, cy, pod.r + 2, 0, TAU);
      ctx.fill();
      ctx.fillStyle = hexA(p.wall, 0.85);
      ctx.beginPath();
      ctx.arc(PANEL_CX, cy, pod.r, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath();
      ctx.ellipse(PANEL_CX - pod.r * 0.4, cy - pod.r * 0.5, pod.r * 0.3, pod.r * 0.14, -0.5, 0, TAU);
      ctx.fill();
      if (kind === undefined) return;
      const cells = shapeCells(kind, 0);
      let minC = 9, maxC = -9, minR = 9, maxR = -9;
      for (const [c, r] of cells) { minC = Math.min(minC, c); maxC = Math.max(maxC, c); minR = Math.min(minR, r); maxR = Math.max(maxR, r); }
      const ox = PANEL_CX - ((maxC - minC + 1) * pod.cell) / 2;
      const oy = cy - ((maxR - minR + 1) * pod.cell) / 2;
      drawCoins(
        cells.map(([c, r]) => ({ x: ox + (c - minC + 0.5) * pod.cell, y: oy + (r - minR + 0.5) * pod.cell, kind, id: -1 - i, sq: 0, scale: 1, alpha: 1, face: "normal" as Face })),
        pod.cell * 0.44,
        pod.cell,
        ticker,
      );
    });

    let y = WELL_Y + 146;
    kit.text("LEVEL", PANEL_CX, y, 8, p.text);
    kit.text(String(v.level), PANEL_CX, y + 17, 18, p.primary);
    y += 40;
    // Level jar: 8 coin slots fill up with rows popped this level.
    const filled = v.lines % 8;
    const slot = PANEL_W / 8;
    for (let i = 0; i < 8; i++) {
      const sx = PANEL_X + slot * (i + 0.5);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(sx, y, slot * 0.42, 0, TAU);
      ctx.fill();
      if (i < filled) {
        ctx.fillStyle = color(i);
        ctx.beginPath();
        ctx.arc(sx, y, slot * 0.32, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.5)";
        ctx.fillRect(sx - 2, y - 2.5, 2, 1);
      } else {
        ctx.strokeStyle = hexA(p.text, 0.25);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(sx, y, slot * 0.28, 0, TAU);
        ctx.stroke();
      }
    }
    y += 22;
    kit.text("ROWS", PANEL_CX, y, 8, p.text);
    kit.text(String(v.lines), PANEL_CX, y + 14, 12, p.secondary);
    y += 34;
    kit.text("SCORE", PANEL_CX, y, 8, p.text);
    kit.text(String(v.score), PANEL_CX, y + 14, v.score >= 1e6 ? 9 : 11, p.accent);

    // Mascot cheerleader
    const sprite = v.over || sad ? kit.sprites.sad : cheer > 0 ? kit.sprites.happy : kit.sprites.idle;
    const size = 64;
    const jump = cheer > 0 ? Math.abs(Math.sin(t / 90)) * 12 : Math.sin(t / 600) * 2;
    const my = FIELD_H - 14 - size - jump;
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.ellipse(PANEL_CX, FIELD_H - 12, 22 - jump * 0.6, 4, 0, 0, TAU);
    ctx.fill();
    ctx.save();
    if (cheer > 0) {
      ctx.translate(PANEL_CX, my + size / 2);
      ctx.rotate(Math.sin(t / 70) * 0.12);
      ctx.translate(-PANEL_CX, -(my + size / 2));
    }
    ctx.drawImage(sprite, PANEL_CX - size / 2, my, size, size);
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[], v: BlocksView) {
      for (const e of events) {
        switch (e.t) {
          case "bump":
            nudge = (e.dx as number) * 2.5;
            break;
          case "harddrop":
            lastDrop = e.dist as number;
            if (lastDrop > 0) kit.fx.addShake(lastDrop > 6 ? 4 : 2);
            break;
          case "lock": {
            squash.set(e.id as number, 0);
            const kind = e.kind as number;
            for (const [c, r] of e.cells as [number, number][]) {
              const x = WELL_X + (c + 0.5) * CELL;
              const y = WELL_Y + (r + 0.5) * CELL;
              if (lastDrop > 0) trails.push({ x, y0: y - lastDrop * CELL, y1: y, life: 260, color: color(kind) });
              kit.fx.burst(x, y + CELL * 0.4, "rgba(255,255,255,0.8)", 2, 50, 200);
            }
            lastDrop = 0;
            break;
          }
          case "clear": {
            const n = e.count as number;
            const rows = e.rows as number[];
            const kinds = e.kinds as number[][];
            rows.forEach((r, i) => {
              for (let c = 0; c < COLS; c++) {
                const x = WELL_X + (c + 0.5) * CELL;
                const y = WELL_Y + (r + 0.5) * CELL;
                kit.fx.burst(x, y, "#ffffff", 2, 90, 0);
                rings.push({ x, y, r: 4, life: 0, max: 320 + c * 15, color: color((kinds[i][c] || 1) - 1) });
              }
            });
            const midY = WELL_Y + ((rows[0] + rows[rows.length - 1]) / 2 + 0.5) * CELL;
            kit.fx.popup(WELL_X + WELL_W / 2, midY - 12, `+${e.points as number}`, p.primary);
            banner = { text: CLEAR_WORDS[n] ?? "WOW", sub: n >= 4 ? `${theme.coin.name.toUpperCase()} RAIN` : "", life: n >= 4 ? 1400 : 700 };
            kit.fx.addShake(n >= 4 ? 9 : 2 + n);
            if (n >= 4) kit.fx.flash("255,255,255");
            cheer = n >= 4 ? 2200 : 900 + n * 200;
            break;
          }
          case "collapse": {
            for (const r of e.rows as number[]) {
              for (let c = 0; c < COLS; c += 1) {
                const x = WELL_X + (c + 0.5) * CELL;
                const y = WELL_Y + (r + 0.5) * CELL;
                kit.fx.burst(x, y, p.bricks[(c + r) % p.bricks.length], 5, 170, 380);
              }
            }
            break;
          }
          case "levelup":
            banner = { text: `LEVEL ${e.level as number}`, sub: "FASTER!", life: 1500 };
            kit.fx.flash("255,255,255");
            for (let i = 0; i < 5; i++) kit.fx.burst(WELL_X + 20 + Math.random() * (WELL_W - 40), WELL_Y + 30 + Math.random() * 60, p.bricks[i % p.bricks.length], 10, 200);
            cheer = Math.max(cheer, 1800);
            break;
          case "gameover":
            sad = true;
            kit.fx.addShake(8);
            kit.fx.flash();
            break;
        }
      }
      if (!v.over) sad = false;
    },

    draw(v, dtMs) {
      t += dtMs;
      cheer = Math.max(0, cheer - dtMs);
      nudge *= Math.max(0, 1 - dtMs / 60);
      for (const [id, ms] of squash) {
        if (ms > 400) squash.delete(id);
        else squash.set(id, ms + dtMs);
      }
      const ticker = (v.ticker || initial()).charAt(0).toUpperCase();
      kit.background(dtMs);
      drawJar(v);

      // Settled coins
      const coins: CoinSpec[] = [];
      const clearing = new Set(v.clearing);
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const k = v.board[r * COLS + c];
        if (!k) continue;
        const id = v.ids[r * COLS + c];
        const ms = squash.get(id);
        const sq = ms === undefined ? 0 : Math.sin((ms / 400) * Math.PI * 2.5) * (1 - ms / 400);
        let scale = 1, alpha = 1, f: Face = v.over ? "sad" : "normal";
        if (clearing.has(r)) {
          const ct = Math.min(1, v.clearT + c * 0.02);
          scale = 1 + 0.35 * Math.sin(ct * Math.PI * 0.9);
          alpha = ct > 0.6 ? Math.max(0, 1 - (ct - 0.6) / 0.4) : 1;
          f = "pop";
        }
        coins.push({ x: WELL_X + (c + 0.5) * CELL, y: WELL_Y + (r + 0.5) * CELL, kind: k - 1, id: clearing.has(r) ? -100 - r * COLS - c : id, sq, scale, alpha, face: f });
      }
      drawCoins(coins, CELL * 0.46, CELL, ticker);

      // Drop trails
      for (let i = trails.length - 1; i >= 0; i--) {
        const tr = trails[i];
        tr.life -= dtMs;
        if (tr.life <= 0) { trails.splice(i, 1); continue; }
        const a = tr.life / 260;
        const g = ctx.createLinearGradient(0, tr.y0, 0, tr.y1);
        g.addColorStop(0, hexA(tr.color, 0));
        g.addColorStop(1, hexA(tr.color, 0.45 * a));
        ctx.fillStyle = g;
        ctx.fillRect(tr.x - CELL * 0.3, tr.y0, CELL * 0.6, tr.y1 - tr.y0);
      }

      // Falling cluster
      if (v.piece) {
        const pc = v.piece;
        const dy = v.fallT * CELL * 0.85;
        const pulse = v.lockT > 0 ? Math.sin(t / 45) * 0.04 * v.lockT : 0;
        const active: CoinSpec[] = pc.cells
          .filter(([, r]) => r >= 0)
          .map(([c, r]) => ({ x: WELL_X + (c + 0.5) * CELL + nudge, y: WELL_Y + (r + 0.5) * CELL + dy, kind: pc.kind, id: -50, sq: 0, scale: 1, alpha: 1, face: v.lockT > 0.6 ? "pop" as Face : "normal" as Face }));
        ctx.save();
        ctx.beginPath();
        ctx.rect(WELL_X - 2, WELL_Y, WELL_W + 4, WELL_H + 4);
        ctx.clip();
        drawCoins(active, CELL * 0.46, CELL, ticker);
        if (pulse) {
          ctx.strokeStyle = hexA("#ffffff", 0.5 * v.lockT);
          ctx.lineWidth = 1;
          for (const a of active) {
            ctx.beginPath();
            ctx.arc(a.x, a.y, CELL * 0.5 + 1, 0, TAU);
            ctx.stroke();
          }
        }
        ctx.restore();
      }

      // Pop rings
      for (let i = rings.length - 1; i >= 0; i--) {
        const g = rings[i];
        g.life += dtMs;
        if (g.life >= g.max) { rings.splice(i, 1); continue; }
        const k = g.life / g.max;
        ctx.strokeStyle = hexA(g.color, 1 - k);
        ctx.lineWidth = 2 * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.r + k * 16, 0, TAU);
        ctx.stroke();
      }

      drawJarGlass();
      if (v.over) {
        ctx.fillStyle = hexA(p.ink, 0.45);
        ctx.beginPath();
        ctx.roundRect(WELL_X, WELL_Y, WELL_W, WELL_H, [3, 3, 12, 12]);
        ctx.fill();
        kit.text("JAR FULL", WELL_X + WELL_W / 2, WELL_Y + WELL_H / 2, 18, p.accent);
      }

      drawPanel(v, ticker);

      // Banner
      if (banner.life > 0) {
        banner.life -= dtMs;
        const k = Math.min(1, banner.life / 300);
        const pop = 1 + Math.max(0, (banner.life - (banner.sub ? 1100 : 400)) / 300) * 0.5;
        ctx.save();
        ctx.globalAlpha = k;
        ctx.translate(WELL_X + WELL_W / 2, WELL_Y + WELL_H * 0.32);
        ctx.scale(pop, pop);
        kit.text(banner.text, 0, 0, 20, p.primary);
        if (banner.sub) kit.text(banner.sub, 0, 20, 10, p.text);
        ctx.restore();
      }

      if (v.frame < 300 && !v.over) {
        ctx.globalAlpha = Math.min(1, (300 - v.frame) / 60);
        kit.text("ARROWS MOVE  UP TURN", WELL_X + WELL_W / 2, WELL_Y + WELL_H - 30, 8, p.text);
        kit.text("SPACE DROPS", WELL_X + WELL_W / 2, WELL_Y + WELL_H - 18, 8, p.text);
        ctx.globalAlpha = 1;
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}

/** "#rrggbb" + alpha -> rgba() string; passes other colour strings through. */
function hexA(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}
