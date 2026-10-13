// Snake renderer: coin food, chunky body in the coin's colours, mascot head.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CELL, COLS, ROWS, type SnakeView } from "./index.ts";

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SnakeView> {
  const kit = makeKit(canvas, theme, COLS * CELL, ROWS * CELL);
  const p = theme.palette;
  let t = 0;

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.t === "eat") {
          kit.fx.burst(e.x!, e.y!, p.accent, 12, 140);
          kit.fx.popup(e.x!, e.y! - 10, `+${e.value as number}`, p.primary);
        } else if (e.t === "die") {
          kit.fx.addShake(8);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.secondary, 24, 200);
        } else if (e.t === "won") {
          for (let i = 0; i < 6; i++) kit.fx.burst(Math.random() * kit.w, kit.h * 0.6, p.bricks[i % p.bricks.length], 12, 220);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      const { ctx } = kit;
      kit.background(dtMs);

      // Board grid
      ctx.fillStyle = "rgba(255,255,255,0.035)";
      for (let r = 0; r < ROWS; r++) for (let c = (r & 1); c < COLS; c += 2) ctx.fillRect(c * CELL, r * CELL, CELL, CELL);

      // Food: a coin with its value
      const fx = v.food.c * CELL + CELL / 2;
      const fy = v.food.r * CELL + CELL / 2 + Math.sin(t / 200) * 1.5;
      const rad = 7 + v.food.value * 0.35;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(fx, fy, rad + 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(fx, fy, rad, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.45)";
      ctx.fillRect(fx - rad / 2, fy - rad / 2, rad / 2, 2);
      kit.text(String(v.food.value), fx, fy + 1, 10, p.ink);

      // Body, tail to head
      for (let i = v.body.length - 1; i >= 1; i--) {
        const [c, r] = v.body[i];
        const color = i % 4 < 2 ? p.primary : p.secondary;
        kit.block(c * CELL + 1, r * CELL + 1, CELL - 2, CELL - 2, color, 5);
      }
      // Head: mascot face, slightly bigger than a cell
      const [hc, hr] = v.body[0];
      const sprite = v.dead ? kit.sprites.sad : kit.sprites.mini;
      const s = CELL + 8;
      ctx.drawImage(sprite, hc * CELL + CELL / 2 - s / 2, hr * CELL + CELL / 2 - s / 2, s, s);

      if (!v.started) kit.text("ARROWS OR SWIPE TO START", kit.w / 2, kit.h - 18, 12, p.text);
      kit.fx.draw(kit, dtMs);
    },
  };
}
