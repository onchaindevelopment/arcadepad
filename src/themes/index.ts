import glorp from "./packs/glorp.json";
import nubbin from "./packs/nubbin.json";
import wobbl from "./packs/wobbl.json";
import type { ThemePack } from "./types.ts";
import { validateGrid } from "./pixel.ts";

export const THEMES: ThemePack[] = [glorp, nubbin, wobbl] as ThemePack[];

export function getTheme(id: string): ThemePack | undefined {
  return THEMES.find((t) => t.id === id);
}

/** Checks a pack is complete; used by tests and the skin scaffolder. */
export function validateTheme(t: ThemePack): string[] {
  const errs: string[] = [];
  if (!/^[a-z0-9-]{2,24}$/.test(t.id)) errs.push("id must be a short slug");
  if (!/^[A-Z0-9$]{1,6}$/.test(t.coin.ticker)) errs.push("ticker: 1-6 chars A-Z 0-9");
  for (const f of ["idle", "blink", "happy", "sad"] as const) errs.push(...validateGrid(t.mascot[f], 16, 16, f));
  errs.push(...validateGrid(t.mascot.mini, 12, 12, "mini"));
  const chars = new Set([...t.mascot.idle, ...t.mascot.blink, ...t.mascot.happy, ...t.mascot.sad, ...t.mascot.mini].join(""));
  for (const c of chars) if (c !== "." && !t.pixels[c]) errs.push(`pixel char '${c}' has no colour`);
  if (t.palette.bricks.length < 4) errs.push("palette.bricks needs at least 4 colours");
  if (t.music.leadSteps.length !== 16 || t.music.bassSteps.length !== 16) errs.push("music patterns need 16 steps");
  return errs;
}

export type { ThemePack } from "./types.ts";
