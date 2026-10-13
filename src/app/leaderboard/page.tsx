import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { THEMES, getTheme } from "@/themes";
import { store } from "@/lib/store";
import { shortAddress } from "@/lib/session";
import { MascotStatic } from "@/components/Mascot";

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
  const active = typeof sp.coin === "string" && getTheme(sp.coin) ? sp.coin : THEMES[0].id;
  const theme = getTheme(active)!;
  const rows = await store.leaderboard(active, 50);
  const p = theme.palette;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-12 sm:px-6">
      <span className="chip">Leaderboard</span>
      <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-none tracking-tight">Top runs</h1>
      <p className="mt-4 max-w-2xl text-lg text-soft">Best score per wallet. Every score here was re-played by the server from the run&apos;s inputs. Bragging rights only.</p>

      <nav aria-label="Choose a coin" className="mt-8 flex flex-wrap gap-3">
        {THEMES.map((t) => (
          <Link
            key={t.id}
            href={`/leaderboard?coin=${t.id}`}
            aria-current={t.id === active ? "page" : undefined}
            className={`btn btn-sm ${t.id === active ? "" : "btn-plain"}`}
            style={t.id === active ? { background: t.palette.primary } : undefined}
          >
            <MascotStatic theme={t} size={22} /> ${t.coin.ticker}
          </Link>
        ))}
      </nav>

      <div className="slab mt-6 overflow-hidden" style={{ background: p.bg, color: p.text }}>
        <div className="flex items-center justify-between gap-4 p-5" style={{ background: p.bg2 }}>
          <div className="flex items-center gap-3">
            <MascotStatic theme={theme} size={48} />
            <div>
              <p className="pixel text-xs" style={{ color: p.primary }}>
                ${theme.coin.ticker}
              </p>
              <p className="text-xl font-bold">{theme.game.title}</p>
            </div>
          </div>
          <Link href={`/play/${theme.id}`} className="btn btn-sm" style={{ background: p.primary }}>
            Play
          </Link>
        </div>
        {rows.length === 0 ? (
          <p className="p-8 text-center opacity-80">No signed runs yet. Connect a wallet and be the first name on the board.</p>
        ) : (
          <table className="w-full text-left">
            <caption className="sr-only">Top scores for ${theme.coin.ticker}</caption>
            <thead>
              <tr className="pixel text-xs uppercase opacity-70">
                <th scope="col" className="px-5 py-3">#</th>
                <th scope="col" className="px-5 py-3">Player</th>
                <th scope="col" className="hidden px-5 py-3 sm:table-cell">Level</th>
                <th scope="col" className="px-5 py-3 text-right">Score</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className="border-t" style={{ borderColor: `${p.text}22` }}>
                  <td className="px-5 py-3 font-bold" style={{ color: i < 3 ? p.accent : undefined }}>
                    {i + 1}
                  </td>
                  <td className="px-5 py-3 font-mono text-sm">
                    <Link href={`/s/${r.id}`} className="hover:underline">
                      {shortAddress(r.wallet)}
                    </Link>
                  </td>
                  <td className="hidden px-5 py-3 sm:table-cell">{r.level + 1}</td>
                  <td className="px-5 py-3 text-right text-lg font-extrabold tabular-nums">{r.score.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
