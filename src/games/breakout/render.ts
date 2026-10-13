// Breakout renderer: wraps the original canvas renderer in the GameRenderer contract.
import type { GameEvent as BEvent, GameView } from "../../engine/types.ts";
import { Renderer } from "../../game/renderer.ts";
import type { ThemePack } from "../../themes/types.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<GameView> {
  const r = new Renderer(canvas, theme);
  return {
    onEvents(events: readonly GameEvent[]) {
      r.events(events.map((e) => e.raw as BEvent));
    },
    draw(view, dtMs) {
      r.draw(view, dtMs);
    },
  };
}
