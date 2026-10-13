import { NextResponse, connection } from "next/server";
import { store } from "@/lib/store";
import { shortAddress } from "@/lib/session";

export async function GET(req: Request) {
  await connection();
  const sp = new URL(req.url).searchParams;
  const rows = await store.leaderboard(sp.get("game") || "breakout", sp.get("theme") || null, 50);
  return NextResponse.json({
    rows: rows.map((r, i) => ({ rank: i + 1, id: r.id, game: r.game, theme: r.theme, player: shortAddress(r.wallet), chain: r.chain, score: r.score, level: r.level + 1, at: r.createdAt })),
  });
}
