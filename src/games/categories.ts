// Catalogue groups for the arcade's filter. Every registered game id should be listed;
// anything missing falls back to "Action".
export const CATEGORIES = ["Classics", "Action", "Puzzle", "Strategy", "Sports"] as const;
export type Category = (typeof CATEGORIES)[number];

const BY_ID: Record<string, Category> = {
  breakout: "Classics", pinball: "Classics", invaders: "Classics", rocks: "Classics", maze: "Classics", snake: "Classics",
  defense: "Classics", swarm: "Classics", crawler: "Classics", digger: "Classics", lander: "Classics", quest: "Classics",
  chain: "Classics", bubbles: "Classics", barrage: "Classics", whack: "Classics", blocks: "Classics", runner: "Classics",
  flap: "Classics", stack: "Classics",
  slope: "Action", lanes: "Action", helix: "Action", colorhop: "Action", pulse: "Action", jumper: "Action", hopper: "Action",
  hill: "Action", slice: "Action", blob: "Action", turf: "Action", cave: "Action", bridge: "Action", pins: "Action",
  hex: "Action", beat: "Action", sling: "Action", target: "Action",
  match3: "Puzzle", gridfit: "Puzzle", solitaire: "Puzzle", merge: "Puzzle", sweeper: "Puzzle", tiles: "Puzzle",
  crates: "Puzzle", echo: "Puzzle",
  four: "Strategy", checkers: "Strategy", tanks: "Strategy", towers: "Strategy", bomber: "Strategy", trails: "Strategy",
  putt: "Sports", hoops: "Sports", puck: "Sports", racer: "Sports", duel: "Sports",
};

export function categoryOf(id: string): Category {
  return BY_ID[id] ?? "Action";
}
