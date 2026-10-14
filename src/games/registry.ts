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
import { sweeper } from "./sweeper/index.ts";
import { puck } from "./puck/index.ts";
import { hoops } from "./hoops/index.ts";
import { tiles } from "./tiles/index.ts";
import { solitaire } from "./solitaire/index.ts";
import { racer } from "./racer/index.ts";
import { chain } from "./chain/index.ts";
import { towers } from "./towers/index.ts";
import { putt } from "./putt/index.ts";
import { lander } from "./lander/index.ts";
import { defense } from "./defense/index.ts";
import { bridge } from "./bridge/index.ts";
import { beat } from "./beat/index.ts";
import { whack } from "./whack/index.ts";
import { four } from "./four/index.ts";
import { trails } from "./trails/index.ts";
import { swarm } from "./swarm/index.ts";
import { bomber } from "./bomber/index.ts";
import { pins } from "./pins/index.ts";
import { crawler } from "./crawler/index.ts";
import { checkers } from "./checkers/index.ts";
import { hex } from "./hex/index.ts";
import { echo } from "./echo/index.ts";
import { tanks } from "./tanks/index.ts";
import { digger } from "./digger/index.ts";
import { crates } from "./crates/index.ts";
import { quest } from "./quest/index.ts";

export const GAMES: GameDef<never>[] = [breakout, pinball, slope, match3, racer, sling, lanes, helix, putt, runner, blocks, gridfit, solitaire, maze, colorhop, invaders, towers, flap, pulse, hoops, jumper, hopper, hill, slice, blob, turf, puck, snake, rocks, chain, bubbles, tiles, sweeper, barrage, cave, target, duel, stack, merge, lander, defense, bridge, beat, whack, four, trails, swarm, bomber, pins, crawler, checkers, hex, echo, tanks, digger, crates, quest] as unknown as GameDef<never>[];

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
