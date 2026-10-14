// Community-launched arcades: validation, slugs and theme lookup (server only).
import "server-only";
import { createHash } from "node:crypto";
import { THEMES, getTheme, validateTheme, type ThemePack } from "@/themes";
import { SOUND_STYLES, buildTheme, sanitizeTickerInput, type SkinInput } from "@/themes/build";
import { store, type ArcadeRecord } from "./store";

/** Launches allowed per wallet per 24 h. */
export const LAUNCHES_PER_DAY = 3;
/** Distinct reports that hide an arcade until someone looks at it. */
export const HIDE_AFTER_REPORTS = 5;

const CHAINS = ["solana", "base", "ethereum"] as const;
const RESERVED = new Set([...THEMES.map((t) => t.id), "admin", "api", "new", "launch", "launchpad", "arcadepad", "official", "support", "help", "team"]);
// Short blocklist for names/tickers: slurs and obvious abuse. Not exhaustive; reports cover the rest.
const BLOCKED = ["nigg", "fagg", "retard", "kike", "spic", "chink", "rape", "nazi", "hitler", "pedo", "cp", "kys"];

const isHex = (v: unknown): v is string => typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);

function blocked(text: string): boolean {
  const t = text.toLowerCase().replace(/[^a-z]/g, "");
  return BLOCKED.some((w) => (w.length <= 3 ? t === w : t.includes(w)));
}

/** Checks a launch request body and returns clean builder input, or an error message. */
export function validateLaunch(body: unknown): { input: SkinInput } | { error: string } {
  const b = body as Partial<SkinInput> | null;
  if (!b || typeof b !== "object") return { error: "Bad request." };
  const name = typeof b.name === "string" ? b.name.trim().replace(/\s+/g, " ") : "";
  if (name.length < 2 || name.length > 24 || !/^[\p{L}\p{N} .'!&-]+$/u.test(name)) return { error: "Name: 2–24 letters, numbers and spaces." };
  if (typeof b.ticker !== "string") return { error: "Ticker is required." };
  const ticker = sanitizeTickerInput(b.ticker);
  if (!b.ticker.trim() || ticker === "COIN" && !/coin/i.test(b.ticker)) return { error: "Ticker: 1–6 letters or numbers." };
  if (blocked(name) || blocked(ticker)) return { error: "That name or ticker isn't allowed." };
  if (!CHAINS.includes(b.chain as (typeof CHAINS)[number])) return { error: "Pick a chain." };
  if (typeof b.sound !== "string" || !(b.sound in SOUND_STYLES)) return { error: "Pick a sound style." };
  if (typeof b.dark !== "boolean") return { error: "Bad request." };
  const c = b.colors;
  if (!c || !isHex(c.bg) || !isHex(c.primary) || !isHex(c.secondary) || !isHex(c.accent)) return { error: "Colours must be hex like #FF8800." };
  const m = b.mascot;
  if (!m || !Array.isArray(m.grid) || m.grid.length !== 16 || !m.grid.every((r) => typeof r === "string" && r.length === 16 && /^[.a-z]+$/i.test(r)))
    return { error: "Mascot must be a 16×16 pixel grid." };
  if (!m.pixels || typeof m.pixels !== "object") return { error: "Mascot colours are missing." };
  const keys = Object.keys(m.pixels);
  if (keys.length > 12 || !keys.every((k) => /^[a-z]$/i.test(k) && isHex(m.pixels[k]))) return { error: "Mascot colours are invalid." };
  if (![...m.grid.join("")].every((ch) => ch === "." || keys.includes(ch))) return { error: "Mascot uses a colour it doesn't define." };
  return {
    input: {
      name,
      ticker,
      chain: b.chain as SkinInput["chain"],
      sound: b.sound as SkinInput["sound"],
      dark: b.dark,
      colors: { bg: c.bg, primary: c.primary, secondary: c.secondary, accent: c.accent },
      mascot: { grid: m.grid.map(String), pixels: Object.fromEntries(keys.map((k) => [k, m.pixels[k].toUpperCase()])) },
    },
  };
}

/** Base slug for a ticker: lowercase, at least 2 chars, never a reserved word. */
export function baseSlug(ticker: string): string {
  let s = ticker.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (s.length < 2) s = `${s}-coin`;
  if (RESERVED.has(s)) s = `${s}-coin`;
  return s;
}

/** Builds the theme on the server and stores the arcade under the first free slug. */
export async function launchArcade(input: SkinInput, owner: string): Promise<{ slug: string } | { error: string }> {
  const base = baseSlug(input.ticker);
  for (let n = 1; n <= 20; n++) {
    const slug = n === 1 ? base : `${base}-${n}`;
    const theme: ThemePack = { ...buildTheme(input), id: slug };
    theme.coin.fictional = false;
    const errs = validateTheme(theme);
    if (errs.length) return { error: `Skin is invalid: ${errs[0]}` };
    const rec: ArcadeRecord = { slug, owner, chain: input.chain, createdAt: Date.now(), hidden: false, theme: JSON.stringify(theme) };
    if (await store.createArcade(rec)) return { slug };
  }
  return { error: "Too many arcades with this ticker. Try another." };
}

export function arcadeTheme(a: ArcadeRecord): ThemePack {
  return JSON.parse(a.theme) as ThemePack;
}

/** A built-in skin, or a launched arcade's skin (hidden ones only when `allowHidden`). */
export async function resolveTheme(id: string, allowHidden = false): Promise<ThemePack | undefined> {
  const builtIn = getTheme(id);
  if (builtIn) return builtIn;
  if (!/^[a-z0-9-]{2,24}$/.test(id)) return undefined;
  const a = await store.getArcade(id);
  if (!a || (a.hidden && !allowHidden)) return undefined;
  return arcadeTheme(a);
}

/** Stable, non-reversible reporter key: the wallet if signed in, else a salted hash of IP + UA. */
export function reporterKey(wallet: string | null, ip: string, ua: string): string {
  if (wallet) return `w:${wallet}`;
  const salt = process.env.SESSION_SECRET ?? "dev";
  return "h:" + createHash("sha256").update(`${salt}|${ip}|${ua}`).digest("hex").slice(0, 24);
}
