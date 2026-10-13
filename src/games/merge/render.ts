// Merge to Moon renderer: mascot-evolution tiles on a themed board, smooth
// slides from each tile's previous cell, pop on merge, grow-in for new tiles,
// and a moon progress bar in the header. All art is drawn here.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BOARD, BOARD_X, BOARD_Y, CELL, FIELD_H, FIELD_W, GAP, HEADER, SIZE, tierOf, type MergeView } from "./index.ts";

const SLIDE_MS = 100;
const POP_MS = 160;
const MOON_TIER = 11; // 2048

interface Delayed { at: number; run: () => void }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<MergeView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  let clock = 0;
  let lastMoveId = -1;
  let animAt = -1e9;
  let bumpAt = -1e9;
  let bumpDir = 0;
  let queue: Delayed[] = [];

  const cellX = (x: number) => BOARD_X + GAP + x * (CELL + GAP);
  const cellY = (y: number) => BOARD_Y + GAP + y * (CELL + GAP);

  /** Tile colour per tier: palette bricks first, then primary/accent/secondary, moon above. */
  function tierColor(tier: number): string {
    const n = p.bricks.length || 1;
    if (tier <= n) return p.bricks[(tier - 1 + n) % n];
    const high = [p.primary, p.accent, p.secondary];
    return high[(tier - n - 1) % high.length];
  }

  function bigText(s: string, x: number, y: number, size: number) {
    ctx.font = `bold ${size}px ${kit.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = p.ink;
    ctx.strokeText(s, x, y);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(s, x, y);
  }

  function moon(cx: number, cy: number, r: number) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(cx, cy, r + 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.13)";
    for (const [dx, dy, rr] of [[-0.4, -0.3, 0.22], [0.35, 0.1, 0.16], [-0.1, 0.45, 0.13], [0.2, -0.5, 0.1]]) {
      ctx.beginPath();
      ctx.arc(cx + dx * r, cy + dy * r, rr * r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.arc(cx - r * 0.3, cy - r * 0.35, r * 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  /** One tile at (x, y) top-left, scaled around its centre. */
  function drawTile(value: number, x: number, y: number, scale: number) {
    const tier = tierOf(value);
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(scale, scale);
    ctx.translate(-CELL / 2, -CELL / 2);
    const digits = String(value).length;
    const num = digits <= 2 ? 30 : digits === 3 ? 26 : digits === 4 ? 21 : 16;
    if (tier >= MOON_TIER) {
      // Moon tiles: dark sky block, glowing moon, happy mascot riding it.
      kit.block(0, 0, CELL, CELL, p.bg2, 10);
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      for (const [sx, sy] of [[12, 14], [74, 10], [70, 70], [16, 72], [44, 8]]) ctx.fillRect(sx, sy, 2, 2);
      const glow = 0.5 + 0.5 * Math.sin(clock / 300);
      ctx.fillStyle = `rgba(255,255,255,${0.08 + glow * 0.1})`;
      ctx.beginPath();
      ctx.arc(CELL / 2, CELL / 2 - 4, 34, 0, Math.PI * 2);
      ctx.fill();
      moon(CELL / 2, CELL / 2 - 4, 26);
      const s = 34;
      ctx.drawImage(kit.sprites.happy, CELL / 2 - s / 2, CELL / 2 - s - 4 + Math.sin(clock / 180) * 2, s, s);
      bigText(String(value), CELL / 2, CELL - 14, num);
    } else {
      kit.block(0, 0, CELL, CELL, tierColor(tier), 10);
      // Evolution: tiny mini head -> idle -> happy, growing with the tier.
      const sprite = tier <= 3 ? kit.sprites.mini : tier <= 6 ? kit.sprites.idle : kit.sprites.happy;
      const s = Math.round(16 + tier * 4.4);
      const bob = tier >= 7 ? Math.sin(clock / 220 + tier) * 1.5 : 0;
      if (tier <= 3) {
        // Small coins: big number in the middle, mascots peeking in a row.
        for (let i = 0; i < tier; i++) ctx.drawImage(sprite, 8 + i * (s - 8), CELL - s - 6, s, s);
        bigText(String(value), CELL / 2, CELL / 2 - 10, num + 4);
      } else {
        ctx.drawImage(sprite, CELL / 2 - s / 2, 8 + bob + (60 - s) / 2, s, s);
        bigText(String(value), CELL / 2, CELL - 15, num);
      }
    }
    ctx.restore();
  }

  function header(v: MergeView) {
    const tier = v.best > 0 ? tierOf(v.best) : 0;
    const x0 = 46, x1 = FIELD_W - 46, y = HEADER / 2 - 2;
    // Track
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x0 - 2, y - 7, x1 - x0 + 4, 14, 7);
    ctx.fill();
    ctx.fillStyle = p.wall;
    ctx.beginPath();
    ctx.roundRect(x0, y - 5, x1 - x0, 10, 5);
    ctx.fill();
    const prog = Math.min(1, tier / MOON_TIER);
    if (prog > 0) {
      ctx.fillStyle = tier >= MOON_TIER ? p.text : tierColor(tier);
      ctx.beginPath();
      ctx.roundRect(x0, y - 5, Math.max(10, (x1 - x0) * prog), 10, 5);
      ctx.fill();
    }
    // Rider and the moon
    const rx = x0 + (x1 - x0) * prog;
    ctx.drawImage(v.over && !v.reached ? kit.sprites.sad : kit.sprites.mini, rx - 11, y - 11 + Math.sin(clock / 200) * 1.5, 22, 22);
    moon(FIELD_W - 24, y, 13);
    ctx.drawImage(kit.sprites.mini, 6, y - 13, 26, 26);
    if (v.moves === 0) kit.text("ARROWS OR SWIPE", FIELD_W / 2, HEADER - 6, 9, p.text);
    else if (v.reached) kit.text("MOONED!", FIELD_W / 2, HEADER - 6, 9, p.text);
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      // Effects land when the slide finishes.
      const at = clock + SLIDE_MS;
      for (const e of events) {
        const x = e.x as number, y = e.y as number;
        if (e.t === "merge") {
          const tier = e.tier as number;
          const c = tier >= MOON_TIER ? p.text : tierColor(tier);
          queue.push({ at, run: () => {
            kit.fx.burst(x, y, c, 6 + tier * 2, 80 + tier * 12, 260);
            kit.fx.popup(x, y - 26, `+${e.value as number}`, p.text);
            if (tier >= 7) kit.fx.addShake(2 + (tier - 6));
          } });
        } else if (e.t === "maxTile") {
          queue.push({ at: at + 60, run: () => {
            kit.fx.burst(x, y, p.accent, 24, 200);
            kit.fx.burst(x, y, p.primary, 16, 160);
            kit.fx.popup(FIELD_W / 2, BOARD_Y + BOARD / 2, `NEW TOP: ${e.value as number}!`, p.accent);
          } });
        } else if (e.t === "moon") {
          queue.push({ at: at + 80, run: () => {
            kit.fx.flash("255,255,255");
            kit.fx.addShake(8);
            for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * FIELD_W, BOARD_Y + Math.random() * BOARD, p.bricks[i % p.bricks.length] ?? p.accent, 14, 240);
            kit.fx.popup(FIELD_W / 2, BOARD_Y + BOARD / 2 - 20, "TO THE MOON!", p.text);
          } });
        } else if (e.t === "bump") {
          bumpAt = clock;
          bumpDir = e.dir as number;
        } else if (e.t === "gameover") {
          queue.push({ at, run: () => {
            kit.fx.addShake(6);
            kit.fx.flash();
          } });
        }
      }
    },
    draw(v, dtMs) {
      clock += dtMs;
      if (v.moveId !== lastMoveId) {
        // First frame sees the start board as "new" tiles; later moves slide.
        animAt = lastMoveId < 0 && v.moveId === 0 ? clock - SLIDE_MS : clock;
        lastMoveId = v.moveId;
      }
      const due = queue.filter((q) => q.at <= clock);
      queue = queue.filter((q) => q.at > clock);
      for (const q of due) q.run();

      kit.background(dtMs);

      // Board: palette wall with ink rim, dark sockets (no beige).
      const bump = Math.max(0, 1 - (clock - bumpAt) / 120);
      const bx = BOARD_X + (bump > 0 ? [0, 1, 0, -1][bumpDir] * 3 * bump : 0);
      const by = BOARD_Y + (bump > 0 ? [-1, 0, 1, 0][bumpDir] * 3 * bump : 0);
      ctx.save();
      ctx.translate(bx - BOARD_X, by - BOARD_Y);
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 14);
      ctx.fill();
      ctx.fillStyle = p.wall;
      ctx.beginPath();
      ctx.roundRect(BOARD_X + 2, BOARD_Y + 2, BOARD - 4, BOARD - 4, 12);
      ctx.fill();
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          ctx.fillStyle = "rgba(0,0,0,0.28)";
          ctx.beginPath();
          ctx.roundRect(cellX(x), cellY(y), CELL, CELL, 10);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.05)";
          ctx.fillRect(cellX(x) + 6, cellY(y) + CELL - 8, CELL - 12, 2);
        }
      }

      const t = Math.min(1, (clock - animAt) / SLIDE_MS);
      const ease = 1 - (1 - t) * (1 - t);
      const after = clock - animAt - SLIDE_MS; // ms since the slide ended
      // Swallowed tiles slide into their merge target, under the rest.
      if (t < 1) {
        for (const c of v.consumed) {
          const x = cellX(c.fx) + (cellX(c.x) - cellX(c.fx)) * ease;
          const y = cellY(c.fy) + (cellY(c.y) - cellY(c.fy)) * ease;
          drawTile(c.value, x, y, 1);
        }
      }
      for (const tile of v.tiles) {
        if (tile.merged || tile.isNew) {
          if (t < 1) continue;
          let s = 1;
          if (tile.merged && after < POP_MS) s = 1 + 0.22 * Math.sin((after / POP_MS) * Math.PI);
          if (tile.isNew && after < POP_MS) s = Math.max(0.05, after / POP_MS);
          drawTile(tile.value, cellX(tile.x), cellY(tile.y), s);
        } else {
          const x = cellX(tile.fx) + (cellX(tile.x) - cellX(tile.fx)) * ease;
          const y = cellY(tile.fy) + (cellY(tile.y) - cellY(tile.fy)) * ease;
          drawTile(tile.value, x, y, 1);
        }
      }
      ctx.restore();

      header(v);

      if (v.over) {
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.beginPath();
        ctx.roundRect(BOARD_X, BOARD_Y, BOARD, BOARD, 14);
        ctx.fill();
        const s = 96;
        ctx.drawImage(v.reached ? kit.sprites.happy : kit.sprites.sad, FIELD_W / 2 - s / 2, BOARD_Y + BOARD / 2 - s + 6, s, s);
        bigText(v.reached ? "MOONED" : "NO MOVES", FIELD_W / 2, BOARD_Y + BOARD / 2 + 30, 26);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
