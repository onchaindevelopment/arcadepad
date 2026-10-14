"use client";
// Client-side game loading: engine definitions + lazily loaded renderers.
import type { ThemePack } from "../themes/types.ts";
import type { GameRenderer } from "./core/types.ts";
import { getGame } from "./registry.ts";

type RendererFactory = (canvas: HTMLCanvasElement, theme: ThemePack) => GameRenderer<unknown>;

const LOADERS: Record<string, () => Promise<{ default: RendererFactory }>> = {
  breakout: () => import("./breakout/render.ts") as Promise<{ default: RendererFactory }>,
  snake: () => import("./snake/render.ts") as Promise<{ default: RendererFactory }>,
  stack: () => import("./stack/render.ts") as Promise<{ default: RendererFactory }>,
  flap: () => import("./flap/render.ts") as Promise<{ default: RendererFactory }>,
  merge: () => import("./merge/render.ts") as Promise<{ default: RendererFactory }>,
  blocks: () => import("./blocks/render.ts") as Promise<{ default: RendererFactory }>,
  rocks: () => import("./rocks/render.ts") as Promise<{ default: RendererFactory }>,
  invaders: () => import("./invaders/render.ts") as Promise<{ default: RendererFactory }>,
  runner: () => import("./runner/render.ts") as Promise<{ default: RendererFactory }>,
  maze: () => import("./maze/render.ts") as Promise<{ default: RendererFactory }>,
  pinball: () => import("./pinball/render.ts") as Promise<{ default: RendererFactory }>,
  slice: () => import("./slice/render.ts") as Promise<{ default: RendererFactory }>,
  target: () => import("./target/render.ts") as Promise<{ default: RendererFactory }>,
  duel: () => import("./duel/render.ts") as Promise<{ default: RendererFactory }>,
  bubbles: () => import("./bubbles/render.ts") as Promise<{ default: RendererFactory }>,
  jumper: () => import("./jumper/render.ts") as Promise<{ default: RendererFactory }>,
  cave: () => import("./cave/render.ts") as Promise<{ default: RendererFactory }>,
  lanes: () => import("./lanes/render.ts") as Promise<{ default: RendererFactory }>,
  hopper: () => import("./hopper/render.ts") as Promise<{ default: RendererFactory }>,
  sling: () => import("./sling/render.ts") as Promise<{ default: RendererFactory }>,
  slope: () => import("./slope/render.ts") as Promise<{ default: RendererFactory }>,
  blob: () => import("./blob/render.ts") as Promise<{ default: RendererFactory }>,
  barrage: () => import("./barrage/render.ts") as Promise<{ default: RendererFactory }>,
  gridfit: () => import("./gridfit/render.ts") as Promise<{ default: RendererFactory }>,
  match3: () => import("./match3/render.ts") as Promise<{ default: RendererFactory }>,
  helix: () => import("./helix/render.ts") as Promise<{ default: RendererFactory }>,
  hill: () => import("./hill/render.ts") as Promise<{ default: RendererFactory }>,
  turf: () => import("./turf/render.ts") as Promise<{ default: RendererFactory }>,
  pulse: () => import("./pulse/render.ts") as Promise<{ default: RendererFactory }>,
  colorhop: () => import("./colorhop/render.ts") as Promise<{ default: RendererFactory }>,
  sweeper: () => import("./sweeper/render.ts") as Promise<{ default: RendererFactory }>,
  puck: () => import("./puck/render.ts") as Promise<{ default: RendererFactory }>,
  hoops: () => import("./hoops/render.ts") as Promise<{ default: RendererFactory }>,
  tiles: () => import("./tiles/render.ts") as Promise<{ default: RendererFactory }>,
  solitaire: () => import("./solitaire/render.ts") as Promise<{ default: RendererFactory }>,
  racer: () => import("./racer/render.ts") as Promise<{ default: RendererFactory }>,
  chain: () => import("./chain/render.ts") as Promise<{ default: RendererFactory }>,
  towers: () => import("./towers/render.ts") as Promise<{ default: RendererFactory }>,
  putt: () => import("./putt/render.ts") as Promise<{ default: RendererFactory }>,
};

export async function loadGame(id: string) {
  const def = getGame(id);
  const loader = LOADERS[id];
  if (!def || !loader) throw new Error(`Unknown game ${id}`);
  const mod = await loader();
  return { def, createRenderer: mod.default };
}
