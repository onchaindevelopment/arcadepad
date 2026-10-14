import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { THEMES, getTheme } from "@/themes";
import { GAMES, gameTitle, getGame } from "@/games/registry";
import { store } from "@/lib/store";
import { shortAddress } from "@/lib/session";
import { MascotStatic } from "@/components/Mascot";
import { resolveTheme } from "@/lib/arcades";
import { GameSelectNav } from "@/components/GameSelect";

export const metadata: Metadata = {
  title: "Leaderboard",
  description: "Wallet-signed, replay-verified high scores. Bragging rights only.",
};

export default function LeaderboardPage(props: PageProps<"/leaderboard">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-5xl px-4 pt-12 sm:px-6"><p className="pixel">Loading scores…</p></div>}>
      <Board searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Board({ searchParams }: { searchParams: PageProps<"/leaderboard">["searchParams"] }) {
  await connection();
  const sp = await searchParams;
  const coin = typeof sp.coin === "string" ? sp.coin : "";
  const theme = (coin && (getTheme(coin) ?? (await resolveTheme(coin)))) || THEMES[0];
  const active = theme.id;
  const coins = THEMES.some((t) => t.id === active) ? THEMES : [...THEMES, theme];
  const game = (typeof sp.game === "string" && getGame(sp.game)) || GAMES[0];
  const rows = await store.leaderboard(game.id, active, 50);
  const p = theme.palette;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 sm:px-6">
      <p className="kicker">Leaderboard</p>
      <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-none tracking-[-0.04em]">Top runs</h1>
      <p className="mt-4 max-w-2xl text-lg text-soft">Best score per wallet. Every score here was re-played by the server from the run&apos;s inputs. Bragging rights only.</p>

      <div className="mt-8 flex flex-wrap items-center gap-3">
        <GameSelectNav games={GAMES.map((g) => ({ id: g.id, name: g.name }))} value={game.id} hrefFor={`/leaderboard?game=__GAME__&coin=${active}`} />
      </div>

      <nav aria-label="Choose a coin" className="mt-3 flex flex-wrap gap-2">
        {coins.map((t) => (
          <Link
            key={t.id}
            href={`/leaderboard?game=${game.id}&coin=${t.id}`}
            aria-current={t.id === active ? "page" : undefined}
            className={`btn btn-sm ${t.id === active ? "" : "btn-plain"}`}
            style={t.id === active ? { background: t.palette.primary } : undefined}
          >
            <MascotStatic theme={t} size={22} /> ${t.coin.ticker}
          </Link>
        ))}
      </nav>

      <div className="slab mt-6 overflow-hidden">
        <div className="flex items-center justify-between gap-4 border-b border-hairline p-5" style={{ background: `radial-gradient(120% 200% at 0% 0%, ${p.primary}30, transparent 60%)` }}>
          <div className="flex items-center gap-3">
            <MascotStatic theme={theme} size={48} />
            <div>
              <p className="pixel text-xs" style={{ color: p.primary }}>
                ${theme.coin.ticker}
              </p>
              <p className="text-xl font-bold">{gameTitle(game, theme)}</p>
            </div>
          </div>
          <Link href={`/play/${game.id}/${theme.id}`} className="btn btn-sm" style={{ background: p.primary }}>
            Play
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center opacity-80">No signed runs yet. Connect a wallet and be the first name on the board.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Top scores for ${theme.coin.ticker}</caption>
            <thead>
              <tr className="pixel text-[0.72rem] uppercase tracking-[0.12em] text-dim">
                <th scope="col" className="px-5 py-3">#</th>
                <th scope="col" className="px-5 py-3">Player</th>
                <th scope="col" className="hidden px-5 py-3 sm:table-cell">Level</th>
                <th scope="col" className="px-5 py-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t border-hairline transition-colors hover:bg-white/[0.02]">
                  <td className="px-5 py-3 font-bold" style={{ color: i < 3 ? p.accent : undefined }}>
                    {i + 1}
                  </td>
                  <td className="px-5 py-3 font-mono text-sm">
                    <Link href={`/s/${r.id}`} className="hover:underline">
                      {shortAddress(r.wallet)}
                    </Link>
                  </td>
                  <td className="hidden px-5 py-3 sm:table-cell">{r.level > 0 ? r.level + 1 : "–"}</td>
                  <td className="px-5 py-3 text-right font-mono text-lg font-medium tabular-nums">{r.score.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
