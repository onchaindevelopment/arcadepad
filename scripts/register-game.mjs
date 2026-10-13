#!/usr/bin/env node
// Register a game folder in the registry and the client loader map:
//   node scripts/register-game.mjs <id> <exportName>
import fs from "node:fs";
const [id, exportName = id] = process.argv.slice(2);
if (!id) {
  console.error("usage: node scripts/register-game.mjs <id> [exportName]");
  process.exit(1);
}
const regPath = "src/games/registry.ts";
let r = fs.readFileSync(regPath, "utf8");
if (!r.includes(`./${id}/index.ts`)) {
  const imports = [...r.matchAll(/^import \{ \w+ \} from "\.\/\w+\/index\.ts";$/gm)];
  const last = imports[imports.length - 1];
  const at = last.index + last[0].length;
  r = r.slice(0, at) + `\nimport { ${exportName} } from "./${id}/index.ts";` + r.slice(at);
  r = r.replace(/export const GAMES: GameDef<never>\[\] = \[([^\]]*)\]/, (_, l) => `export const GAMES: GameDef<never>[] = [${l}, ${exportName}]`);
  fs.writeFileSync(regPath, r);
}
const cliPath = "src/games/client.ts";
let c = fs.readFileSync(cliPath, "utf8");
if (!c.includes(`./${id}/render.ts`)) {
  c = c.replace(/(\n};\n\nexport async function loadGame)/, `\n  ${id}: () => import("./${id}/render.ts") as Promise<{ default: RendererFactory }>,$1`);
  fs.writeFileSync(cliPath, c);
}
console.log(`registered ${id}`);
