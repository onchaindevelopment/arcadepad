#!/usr/bin/env node
// Scaffold a new coin skin from an existing pack:
//   npm run skin:new -- --id otter --name "Moon Otter" --ticker OTTER --chain solana --from wobbl --hue 140
// Copies the base pack, rotates every colour by --hue degrees, sets the coin
// fields and registers the pack. Then edit the JSON: mascot grids, copy, sounds.
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const packs = path.join(root, "src", "themes", "packs");
const { id, name, ticker, chain = "solana", from = "glorp" } = args;
const hue = Number(args.hue ?? 0);

if (!id || !name || !ticker || !/^[a-z0-9-]{2,24}$/.test(id) || !/^[A-Z0-9]{1,6}$/.test(ticker)) {
  console.error('Usage: npm run skin:new -- --id slug --name "Coin Name" --ticker TICK [--chain solana|base|ethereum] [--from glorp] [--hue 0-359]');
  process.exit(1);
}
const out = path.join(packs, `${id}.json`);
if (fs.existsSync(out)) {
  console.error(`${out} already exists`);
  process.exit(1);
}

function rotate(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m || !hue) return hex;
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h /= 6;
  }
  h = (h + hue / 360) % 1;
  const f = (n) => {
    const k = (n + h * 12) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}
const deep = (v) => (typeof v === "string" ? rotate(v) : Array.isArray(v) ? v.map(deep) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, deep(x)])) : v);

const base = JSON.parse(fs.readFileSync(path.join(packs, `${from}.json`), "utf8"));
const pack = {
  ...base,
  id,
  coin: { name, ticker, chain, fictional: args.real !== "yes" },
  game: { title: `${name} Breakout`, tagline: `A ${name} original. Break every brick.` },
  palette: deep(base.palette),
  pixels: deep(base.pixels),
  mascot: { ...base.mascot, name },
};
fs.writeFileSync(out, JSON.stringify(pack, null, 2) + "\n");

const idx = path.join(root, "src", "themes", "index.ts");
let src = fs.readFileSync(idx, "utf8");
const ident = id.replace(/-(.)/g, (_, c) => c.toUpperCase());
src = src.replace(/(import wobbl[^\n]*\n|import [^\n]*packs[^\n]*\n)(?![\s\S]*import [^\n]*packs)/, `$1import ${ident} from "./packs/${id}.json";\n`);
src = src.replace(/export const THEMES: ThemePack\[\] = \[([^\]]*)\]/, (_, list) => `export const THEMES: ThemePack[] = [${list}, ${ident}]`);
fs.writeFileSync(idx, src);
console.log(`Created ${path.relative(root, out)} and registered it. Next: draw the mascot grids, write the copy, run npm run test:themes.`);
