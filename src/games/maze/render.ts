// Maze Dash renderer: chunky rounded walls in the coin's colours, glowing
// coins, wobbling robot bots, vents, particles. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE, type Kit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { COLS, ROWS, TILE, type EnemyView, type MazeView } from "./index.ts";

const W = COLS * TILE;
const H = ROWS * TILE;
const TAU = Math.PI * 2;

function rgb(hex: string): string {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, "$&$&") : h.slice(0, 6), 16);
  return `${(n >> 16) & 255},${(n >> 8) & 255},${n & 255}`;
}

function offscreen(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const cv = document.createElement("canvas");
  cv.width = Math.ceil(w * RENDER_SCALE);
  cv.height = Math.ceil(h * RENDER_SCALE);
  const c = cv.getContext("2d")!;
  c.scale(RENDER_SCALE, RENDER_SCALE);
  return [cv, c];
}

/** One quarter of a wall tile, auto-joined with its neighbours. */
function quarter(c: CanvasRenderingContext2D, x0: number, y0: number, sx: number, sy: number, hN: boolean, vN: boolean, dN: boolean, pad: number, rad: number) {
  const ix = x0 + TILE / 2;
  const iy = y0 + TILE / 2;
  const ox = sx < 0 ? x0 : x0 + TILE;
  const oy = sy < 0 ? y0 : y0 + TILE;
  const ex = hN ? ox : ox - sx * pad;
  const ey = vN ? oy : oy - sy * pad;
  const rect = (ax: number, ay: number, bx: number, by: number) => c.rect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay));
  c.beginPath();
  if (hN && vN && !dN) {
    // Inner (concave) corner: leave the diagonal notch open.
    rect(ix, iy, ox, oy - sy * pad);
    rect(ix, iy, ox - sx * pad, oy);
  } else if (!hN && !vN) {
    const radii = [0, 0, 0, 0];
    radii[sy < 0 ? (sx < 0 ? 0 : 1) : sx > 0 ? 2 : 3] = rad;
    c.roundRect(Math.min(ix, ex), Math.min(iy, ey), Math.abs(ex - ix), Math.abs(ey - iy), radii);
  } else rect(ix, iy, ex, ey);
  c.fill();
}

function buildWalls(grid: readonly string[], theme: ThemePack): HTMLCanvasElement {
  const p = theme.palette;
  const [cv, c] = offscreen(W, H);
  const wall = (x: number, y: number) => x < 0 || x >= COLS || y < 0 || y >= ROWS || grid[y][x] === "#";
  const passes = [
    { pad: 1.5, rad: 6, color: p.ink, glow: 0 },
    { pad: 3, rad: 5, color: p.secondary, glow: 7 },
    { pad: 5.5, rad: 3, color: p.wall, glow: 0 },
  ];
  for (const pass of passes) {
    c.fillStyle = pass.color;
    c.shadowColor = pass.glow ? p.secondary : "transparent";
    c.shadowBlur = pass.glow;
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        if (!wall(x, y)) continue;
        for (const sx of [-1, 1])
          for (const sy of [-1, 1]) quarter(c, x * TILE, y * TILE, sx, sy, wall(x + sx, y), wall(x, y + sy), wall(x + sx, y + sy), pass.pad, pass.rad);
      }
  }
  c.shadowBlur = 0;
  // Bevel: light along exposed tops, shade along exposed bottoms (kit.block style).
  const pad = passes[2].pad;
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      if (!wall(x, y)) continue;
      const x0 = x * TILE + (wall(x - 1, y) ? 0 : pad + 2);
      const x1 = x * TILE + TILE - (wall(x + 1, y) ? 0 : pad + 2);
      if (!wall(x, y - 1)) {
        c.fillStyle = "rgba(255,255,255,0.32)";
        c.fillRect(x0, y * TILE + pad + 1, x1 - x0, 2);
      }
      if (!wall(x, y + 1)) {
        c.fillStyle = "rgba(0,0,0,0.25)";
        c.fillRect(x0, y * TILE + TILE - pad - 3, x1 - x0, 2);
      }
      // A little rivet texture inside fat walls.
      if (wall(x - 1, y) && wall(x + 1, y) && wall(x, y - 1) && wall(x, y + 1) && ((x * 7 + y * 3) & 3) === 0) {
        c.fillStyle = "rgba(255,255,255,0.10)";
        c.fillRect(x * TILE + 9, y * TILE + 9, 2, 2);
      }
    }
  return cv;
}

function coinSprite(theme: ThemePack): HTMLCanvasElement {
  const p = theme.palette;
  const [cv, c] = offscreen(12, 12);
  const g = c.createRadialGradient(6, 6, 0, 6, 6, 6);
  g.addColorStop(0, `rgba(${rgb(p.accent)},0.55)`);
  g.addColorStop(1, `rgba(${rgb(p.accent)},0)`);
  c.fillStyle = g;
  c.fillRect(0, 0, 12, 12);
  c.fillStyle = p.ink;
  c.beginPath();
  c.arc(6, 6, 3.6, 0, TAU);
  c.fill();
  c.fillStyle = p.accent;
  c.beginPath();
  c.arc(6, 6, 2.6, 0, TAU);
  c.fill();
  c.fillStyle = "rgba(255,255,255,0.8)";
  c.fillRect(4.6, 4.4, 1.4, 1.2);
  return cv;
}

const BOT_COLORS = (p: ThemePack["palette"]) => [p.accent, p.secondary, p.bricks[3 % p.bricks.length], p.bricks[4 % p.bricks.length]];

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<MazeView> {
  const kit: Kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const botColors = BOT_COLORS(p);
  const coin = coinSprite(theme);
  const wallCache = new Map<number, HTMLCanvasElement>();
  const letter = (theme.coin.ticker || "X").charAt(0).toUpperCase();
  let t = 0;

  const drawWrapped = (x: number, draw: (x: number) => void) => {
    draw(x);
    if (x < TILE) draw(x + W);
    else if (x > W - TILE) draw(x - W);
  };

  function drawVent(c: number, r: number, glow: number) {
    const x = c * TILE + 2;
    const y = r * TILE + 2;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, TILE - 4, TILE - 4, 4);
    ctx.fill();
    ctx.fillStyle = p.secondary;
    ctx.globalAlpha = 0.35 + glow * 0.5;
    for (let i = 0; i < 3; i++) ctx.fillRect(x + 3, y + 3 + i * 4.5, TILE - 10, 2);
    ctx.globalAlpha = 1;
  }

  function drawBot(e: EnemyView, x: number, y: number, frightLeft: number, ghost: number) {
    const k = e.kind;
    const accent = botColors[k];
    const scared = e.fright;
    const blink = scared && frightLeft < 90 && Math.floor(frightLeft / 8) % 2 === 0;
    // White chassis with a coloured trim per bot; frightened bots go dark.
    const body = scared ? (blink ? p.primary : p.wall) : "#ffffff";
    const trim = scared ? p.ink : accent;
    const wob = Math.sin(t / (scared ? 60 : 130) + k * 1.7) * (scared ? 0.16 : 0.08);
    const bob = Math.sin(t / 95 + k) * 1;
    ctx.save();
    ctx.globalAlpha = ghost;
    ctx.translate(x, y + bob);
    ctx.rotate(wob);
    ctx.scale(1.15, 1.15);
    // Treads
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(-8, 4, 16, 6, 3);
    ctx.fill();
    ctx.fillStyle = scared ? p.text : accent;
    const roll = (t / 60) % 4;
    for (let i = 0; i < 4; i++) ctx.fillRect(-7 + ((i * 4 + roll) % 15), 6, 1.5, 2);
    // Head features: FUD antenna, bear ears, rug flap, dump horns
    ctx.fillStyle = p.ink;
    if (k === 0) {
      ctx.fillRect(-0.75, -12, 1.5, 4);
      ctx.fillStyle = Math.floor(t / 250) % 2 ? trim : "#ffffff";
      ctx.beginPath();
      ctx.arc(0, -12.5, 2, 0, TAU);
      ctx.fill();
    } else if (k === 1) {
      for (const s of [-1, 1]) {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(s * 6, -8, 3.6, 0, TAU);
        ctx.fill();
        ctx.fillStyle = trim;
        ctx.beginPath();
        ctx.arc(s * 6, -8, 2.2, 0, TAU);
        ctx.fill();
      }
    } else if (k === 2) {
      ctx.fillRect(-5, -10.5, 10, 3);
      ctx.fillStyle = trim;
      ctx.fillRect(-4, -9.8, 8, 1.6);
    } else {
      for (const s of [-1, 1]) {
        ctx.fillStyle = p.ink;
        ctx.fillRect(s * 5 - 1.5, -12.5, 3, 5);
        ctx.fillStyle = trim;
        ctx.fillRect(s * 5 - 0.5, -11.5, 1, 3);
      }
    }
    kit.block(-8.5, -8, 17, 14, body, 4);
    // Trim band under the visor
    ctx.fillStyle = trim;
    ctx.fillRect(-6.5, 2, 13, 1.6);
    // Visor
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(-6, -5, 12, 6, 2);
    ctx.fill();
    const lx = e.dir >= 0 ? [0, 1.5, 0, -1.5][e.dir] : 0;
    const ly = e.dir >= 0 ? [-1, 0, 1, 0][e.dir] : 0;
    if (scared) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-4, -3.5, 2, 2);
      ctx.fillRect(2, -3.5, 2, 2);
      ctx.strokeStyle = blink ? p.ink : "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i <= 4; i++) ctx.lineTo(-4 + i * 2, 4.5 + (i % 2 ? -1 : 1));
      ctx.stroke();
    } else {
      ctx.shadowColor = accent;
      ctx.shadowBlur = 4;
      ctx.fillStyle = accent;
      ctx.fillRect(-4 + lx, -3 + ly * 0.6, 3, 2);
      ctx.fillRect(1 + lx, -3 + ly * 0.6, 3, 2);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  function drawPower(x: number, y: number, i: number) {
    const pulse = 1 + Math.sin(t / 160 + i) * 0.12;
    const rad = 6.5 * pulse;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad * 2.2);
    g.addColorStop(0, `rgba(${rgb(p.primary)},0.7)`);
    g.addColorStop(1, `rgba(${rgb(p.primary)},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad * 2.2, y - rad * 2.2, rad * 4.4, rad * 4.4);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, rad + 1.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.45)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, y, rad - 2, Math.PI * 1.1, Math.PI * 1.6);
    ctx.stroke();
    kit.text(letter, x, y + 0.5, 9, p.ink);
  }

  function drawMoon(x: number, y: number, left: number) {
    if (left < 120 && Math.floor(left / 6) % 2 === 0) return;
    const bob = Math.sin(t / 220) * 1.5;
    const g = ctx.createRadialGradient(x, y + bob, 0, x, y + bob, 14);
    g.addColorStop(0, `rgba(${rgb(p.text)},0.5)`);
    g.addColorStop(1, `rgba(${rgb(p.text)},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - 14, y - 14 + bob, 28, 28);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x - 12, y - 12 + bob, 24, 24);
    ctx.arc(x + 3.5, y - 2.5 + bob, 6, 0, TAU, true);
    ctx.clip("evenodd");
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y + bob, 8, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.arc(x, y + bob, 6.5, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  function drawPlayer(v: MazeView) {
    const pl = v.player;
    let sprite = kit.sprites.mini;
    let scale = 1;
    let rot = 0;
    if (v.phase === "dying") {
      sprite = kit.sprites.sad;
      const k = 1 - v.phaseT / 90;
      rot = k * TAU * 2;
      scale = Math.max(0, 1 - k * k);
    } else if (v.phase === "over") return;
    const s = (TILE + 4) * scale;
    const squash = pl.moving ? Math.sin(t / 45) * 0.07 : 0;
    const tilt = pl.face === 0 ? -0.25 : pl.face === 2 ? 0.25 : 0;
    drawWrapped(pl.x, (x) => {
      ctx.save();
      ctx.translate(x, pl.y);
      ctx.rotate(rot + (pl.face === 3 ? -tilt : tilt));
      ctx.scale(pl.face === 3 ? -1 : 1, 1);
      ctx.scale(1 + squash, 1 - squash);
      if (v.frightLeft > 0) {
        ctx.shadowColor = p.primary;
        ctx.shadowBlur = 10;
      }
      ctx.drawImage(sprite, -s / 2, -s / 2, s, s);
      ctx.restore();
    });
  }

  return {
    onEvents(events: readonly GameEvent[], v: MazeView) {
      for (const e of events) {
        const x = e.x ?? W / 2;
        const y = e.y ?? H / 2;
        switch (e.t) {
          case "pellet":
            kit.fx.burst(x, y, p.accent, 3, 45, 0);
            break;
          case "power":
            kit.fx.burst(x, y, p.primary, 26, 170, 60);
            kit.fx.flash(rgb(p.primary));
            kit.fx.popup(x, y - 10, "+50", p.primary);
            break;
          case "eatEnemy":
            kit.fx.burst(x, y, botColors[(e.kind as number) & 3], 20, 180, 200);
            kit.fx.burst(x, y, "#ffffff", 8, 120, 200);
            kit.fx.popup(x, y - 12, `+${e.points as number}`, p.primary);
            kit.fx.addShake(3);
            break;
          case "bonus":
            kit.fx.burst(x, y, p.text, 18, 150, 80);
            kit.fx.popup(x, y - 12, "+500", p.text);
            break;
          case "bonusSpawn":
            kit.fx.burst(x, y, p.text, 10, 80, 0);
            break;
          case "release":
            kit.fx.burst(x, y, p.secondary, 8, 70, 0);
            break;
          case "die":
            kit.fx.addShake(8);
            kit.fx.flash();
            kit.fx.burst(x, y, p.secondary, 26, 200);
            kit.fx.burst(x, y, p.accent, 12, 140);
            break;
          case "levelclear":
            for (let i = 0; i < 8; i++) kit.fx.burst(W * (0.1 + 0.8 * Math.random()), H * (0.2 + 0.5 * Math.random()), p.bricks[i % p.bricks.length], 14, 220);
            break;
          case "gameover":
            kit.fx.flash(rgb(p.ink));
            break;
        }
      }
      void v;
    },
    draw(v: MazeView, dtMs: number) {
      t += dtMs;
      kit.background(dtMs);

      // Walls (cached per maze), flashing on level clear.
      let walls = wallCache.get(v.mazeIndex);
      if (!walls) {
        walls = buildWalls(v.grid, theme);
        wallCache.set(v.mazeIndex, walls);
      }
      ctx.drawImage(walls, 0, 0, W, H);
      if (v.phase === "clear" && Math.floor(v.phaseT / 12) % 2 === 0) {
        ctx.globalCompositeOperation = "lighter";
        ctx.globalAlpha = 0.6;
        ctx.drawImage(walls, 0, 0, W, H);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }

      // Vents
      for (const e of v.enemies) {
        const charging = e.state === "vent" ? 1 - Math.min(1, e.timer / 300) : e.state === "dead" ? 1 - e.timer / 150 : 0;
        drawVent(e.vent[0], e.vent[1], charging * (0.5 + 0.5 * Math.sin(t / 80)));
      }

      // Coins
      let pi = 0;
      for (let r = 0; r < ROWS; r++)
        for (let c = 0; c < COLS; c++) {
          const k = v.pellets[r * COLS + c];
          if (!k) continue;
          const x = c * TILE + TILE / 2;
          const y = r * TILE + TILE / 2;
          if (k === 2) drawPower(x, y, pi++);
          else {
            const s = 12 * (1 + 0.1 * Math.sin(t / 260 + c * 0.7 + r * 1.3));
            ctx.drawImage(coin, x - s / 2, y - s / 2, s, s);
          }
        }
      if (v.bonus) drawMoon(v.bonus.c * TILE + TILE / 2, v.bonus.r * TILE + TILE / 2, v.bonus.left);

      // Bots
      for (const e of v.enemies) {
        if (e.state === "dead") continue;
        if (e.state === "vent") {
          const flick = e.timer < 60 && Math.floor(t / 70) % 2 === 0 ? 0.75 : 0.4;
          drawBot(e, e.x, e.y, v.frightLeft, v.phase === "dying" ? 0.25 : flick);
          continue;
        }
        if (v.phase === "dying" && v.phaseT < 60) continue;
        drawWrapped(e.x, (x) => drawBot(e, x, e.y, v.frightLeft, 1));
      }

      drawPlayer(v);

      // Power timer on the top wall
      if (v.frightLeft > 0 && v.frightTotal > 0) {
        const fw = (W - 40) * (v.frightLeft / v.frightTotal);
        ctx.fillStyle = p.ink;
        ctx.fillRect(18, 7, W - 36, 6);
        ctx.fillStyle = v.frightLeft < 90 && Math.floor(v.frightLeft / 8) % 2 === 0 ? "#ffffff" : p.primary;
        ctx.fillRect(20, 8, fw, 4);
      }

      if (v.phase === "ready") {
        kit.text(v.mazeName.toUpperCase(), W / 2, H / 2 - 34, 14, p.text);
        if (Math.floor(t / 300) % 2 === 0 || v.phaseT > 45) kit.text("READY!", W / 2, H / 2 - 16, 16, p.primary);
      } else if (v.phase === "clear") {
        kit.text("MAZE CLEAR!", W / 2, H / 2 - 16, 18, p.primary);
      } else if (v.phase === "over") {
        kit.text("GAME OVER", W / 2, H / 2 - 16, 20, p.accent);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
