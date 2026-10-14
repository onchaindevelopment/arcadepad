import { NextResponse } from "next/server";
import { resolveTheme } from "@/lib/arcades";
import { getGame } from "@/games/registry";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";
import { randomId, randomSeed } from "@/lib/tokens";

// The server picks the seed, so a run can't be re-rolled offline for a lucky layout.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { game?: string; theme?: string } | null;
  const game = getGame(body?.game ?? "breakout");
  const theme = body?.theme ? await resolveTheme(body.theme) : undefined;
  if (!game || !theme) return NextResponse.json({ error: "Unknown game or skin." }, { status: 400 });

  const s = await getSession();
  const run = { id: randomId(), game: game.id, theme: theme.id, seed: randomSeed(), wallet: s?.a ?? null, chain: s?.c ?? null, startedAt: Date.now() };
  await store.createRun(run);
  return NextResponse.json({ runId: run.id, seed: run.seed, ranked: !!run.wallet });
}
