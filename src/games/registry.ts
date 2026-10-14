// All games, server-safe (engines + metadata only; renderers load on the client).
import type { GameDef, GameMeta } from "./core/types.ts";
import { breakout } from "./breakout/index.ts";
import { snake } from "./snake/index.ts";
import { stack } from "./stack/index.ts";
import { flap } from "./flap/index.ts";
import { merge } from "./merge/index.ts";
import { blocks } from "./blocks/index.ts";
import { rocks } from "./rocks/index.ts";
import { invaders } from "./invaders/index.ts";
import { runner } from "./runner/index.ts";
import { maze } from "./maze/index.ts";
import { pinball } from "./pinball/index.ts";
import { slice } from "./slice/index.ts";
import { target } from "./target/index.ts";
import { duel } from "./duel/index.ts";
import { bubbles } from "./bubbles/index.ts";
import { jumper } from "./jumper/index.ts";
import { cave } from "./cave/index.ts";
import { lanes } from "./lanes/index.ts";
import { hopper } from "./hopper/index.ts";
import { sling } from "./sling/index.ts";
import { slope } from "./slope/index.ts";
import { blob } from "./blob/index.ts";
import { barrage } from "./barrage/index.ts";
import { gridfit } from "./gridfit/index.ts";
import { match3 } from "./match3/index.ts";
import { helix } from "./helix/index.ts";
import { hill } from "./hill/index.ts";
import { turf } from "./turf/index.ts";
import { pulse } from "./pulse/index.ts";
import { colorhop } from "./colorhop/index.ts";

export const GAMES: GameDef<never>[] = [breakout, pinball, slope, match3, sling, lanes, helix, runner, blocks, gridfit, maze, colorhop, invaders, flap, pulse, jumper, hopper, hill, slice, blob, turf, snake, rocks, bubbles, barrage, cave, target, duel, stack, merge] as unknown as GameDef<never>[];

export function getGame(id: string): GameDef<unknown> | undefined {
  return GAMES.find((g) => g.id === id) as GameDef<unknown> | undefined;
}

/** Plain metadata for client components (no functions). */
export function gameMeta(g: GameDef<unknown>): GameMeta {
  const { id, name, tagline, genre, session, controls, field, input, maxFrames, credits } = g;
  return { id, name, tagline, genre, session, controls, field, input, maxFrames, credits };
}

export function gameTitle(g: GameDef<unknown>, theme: { coin: { name: string }; game: { title: string } }): string {
  return g.titleFor ? g.titleFor(theme) : `${theme.coin.name} ${g.name}`;
}
