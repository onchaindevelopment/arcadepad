// Run: npm run test:themes
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { validateGrid } from "./pixel.ts";
import type { ThemePack } from "./types.ts";

const dir = path.join(import.meta.dirname, "packs");
const packs: ThemePack[] = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")));

for (const t of packs) {
  test(`theme ${t.id} is complete`, () => {
    const errs: string[] = [];
    for (const f of ["idle", "blink", "happy", "sad"] as const) errs.push(...validateGrid(t.mascot[f], 16, 16, f));
    errs.push(...validateGrid(t.mascot.mini, 12, 12, "mini"));
    const chars = new Set([...t.mascot.idle, ...t.mascot.blink, ...t.mascot.happy, ...t.mascot.sad, ...t.mascot.mini].join(""));
    for (const c of chars) if (c !== "." && !t.pixels[c]) errs.push(`pixel char '${c}' has no colour`);
    for (const s of ["paddle", "wall", "brick", "brickgone", "explode", "extraGood", "extraBad", "shot", "launch", "lost", "levelclear", "gameover", "won"]) {
      if (!(s in t.sfx)) errs.push(`missing sfx ${s}`);
    }
    if (t.music.leadSteps.length !== 16 || t.music.bassSteps.length !== 16) errs.push("music needs 16 steps");
    if (!/^[A-Z0-9]{1,6}$/.test(t.coin.ticker)) errs.push("ticker must be 1-6 chars A-Z/0-9");
    assert.deepEqual(errs, []);
  });
}

test("demo coins are marked fictional", () => {
  for (const t of packs.filter((p) => ["glorp", "nubbin", "wobbl"].includes(p.id))) assert.equal(t.coin.fictional, true);
});
