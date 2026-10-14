// Launched coins as light, serialisable rows for the coin board (server only).
import "server-only";
import { store } from "./store";
import { arcadeTheme } from "./arcades";
import { shortAddress } from "./session";

export interface CoinItem {
  slug: string;
  name: string;
  ticker: string;
  chain: string;
  createdAt: number;
  owner: string;
  runs: number;
  best: number;
  grid: string[];
  pixels: Record<string, string>;
  primary: string;
  bg: string;
}

export async function listCoinItems(limit: number): Promise<CoinItem[]> {
  let arcades: Awaited<ReturnType<typeof store.listArcades>> = [];
  try {
    arcades = await store.listArcades(limit);
  } catch {
    return [];
  }
  const stats = await store.arcadeStats(arcades.map((a) => a.slug)).catch(() => ({}) as Record<string, { runs: number; best: number }>);
  return arcades.map((a) => {
    const t = arcadeTheme(a);
    return {
      slug: a.slug,
      name: t.coin.name,
      ticker: t.coin.ticker,
      chain: a.chain,
      createdAt: a.createdAt,
      owner: shortAddress(a.owner),
      runs: stats[a.slug]?.runs ?? 0,
      best: stats[a.slug]?.best ?? 0,
      grid: t.mascot.idle,
      pixels: t.pixels,
      primary: t.palette.primary,
      bg: t.palette.bg,
    };
  });
}
