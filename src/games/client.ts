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
};

export async function loadGame(id: string) {
  const def = getGame(id);
  const loader = LOADERS[id];
  if (!def || !loader) throw new Error(`Unknown game ${id}`);
  const mod = await loader();
  return { def, createRenderer: mod.default };
}
