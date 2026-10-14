import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { GAMES } from "@/games/registry";
import { CATEGORIES, categoryOf } from "@/games/categories";
import { store } from "@/lib/store";
import { arcadeTheme } from "@/lib/arcades";
import { shortAddress } from "@/lib/session";
import { Mascot } from "@/components/Mascot";
import { GameGrid } from "@/components/GameGrid";
import { ArcadeActions } from "@/components/ArcadeActions";

async function load(slug: string) {
  await connection();
  const a = await store.getArcade(slug);
  if (!a || a.hidden) return null;
  return { a, theme: arcadeTheme(a) };
}

export async function generateMetadata(props: PageProps<"/a/[slug]">): Promise<Metadata> {
  const { slug } = await props.params;
  const d = await load(slug);
  if (!d) return { title: "Arcade not found" };
  const t = d.theme;
  return { title: `$${t.coin.ticker} Arcade`, description: `${GAMES.length} arcade games in ${t.coin.name}'s colours. Play free, climb the board.` };
}

export default function ArcadePage(props: PageProps<"/a/[slug]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 pt-16 sm:px-6"><p className="pixel">Loading arcade…</p></div>}>
      <Arcade params={props.params} />
    </Suspense>
  );
}

async function Arcade({ params }: { params: PageProps<"/a/[slug]">["params"] }) {
  const { slug } = await params;
  const d = await load(slug);
  if (!d) notFound();
  const { a, theme: t } = d;
  const p = t.palette;
  const order = (id: string) => CATEGORIES.indexOf(categoryOf(id));
  const games = GAMES.map((g) => ({ id: g.id, name: g.name, tagline: g.tagline, session: g.session, category: categoryOf(g.id) })).sort((x, y) => order(x.id) - order(y.id));
  const date = new Date(a.createdAt).toISOString().slice(0, 10);

  return (
    <>
      <section className="relative -mt-[76px] overflow-hidden px-4 pb-14 pt-[100px] sm:-mt-[80px] sm:pt-[112px]">
        <div
          className="sunburst pointer-events-none absolute left-1/2 top-[45%] h-[140vmax] w-[140vmax] -translate-x-1/2 -translate-y-1/2"
          style={{ background: `repeating-conic-gradient(from 0deg, ${p.primary}33 0deg 7deg, ${p.secondary}14 7deg 14deg)` }}
          aria-hidden
        />
        <div className="relative z-10 mx-auto flex max-w-[900px] flex-col items-center text-center">
          <div className="relative w-full rounded-[36px] px-5 pb-9 pt-8 sm:px-12" style={{ background: `linear-gradient(180deg, ${p.bg2}, ${p.bg})`, boxShadow: `0 0 0 3px ${p.primary}, 0 0 0 8px #12062a, 0 0 0 10px ${p.secondary}99, 0 0 70px -10px ${p.primary}` }}>
            <div className="bulbs" aria-hidden />
            <p className="pixel text-sm uppercase tracking-[0.2em]" style={{ color: p.primary }}>
              ★ Now playing ★
            </p>
            <div className="mt-4 flex flex-col items-center gap-4 sm:flex-row sm:justify-center sm:gap-7">
              <span className="grid h-28 w-28 shrink-0 place-items-center rounded-3xl border-2 border-white/15" style={{ background: `${p.ink}cc`, boxShadow: `0 0 40px -8px ${p.primary}` }}>
                <Mascot theme={t} size={92} label={`${t.coin.name} mascot`} />
              </span>
              <h1 className="text-left max-sm:text-center">
                <span className="chrome block text-[clamp(2.6rem,9vw,5.6rem)] leading-[0.95]">${t.coin.ticker}</span>
                <span className="mt-2 block text-[clamp(1.1rem,3vw,1.9rem)] text-white [text-shadow:2px_2px_0_var(--hot)]">{t.coin.name} Arcade</span>
              </h1>
            </div>
          </div>

          <p className="mt-6 max-w-xl text-base leading-relaxed text-soft">
            {GAMES.length} games in {t.coin.name}&apos;s colours, with replay-verified leaderboards. Launched by{" "}
            <span className="font-mono text-white">{shortAddress(a.owner)}</span> on {date}.
          </p>
          <div className="mt-7 flex flex-wrap justify-center gap-4">
            <Link href={`/play/breakout/${a.slug}`} className="btn px-7 py-3.5 text-base">
              ▶ Press start
            </Link>
            <Link href={`/leaderboard?game=breakout&coin=${a.slug}`} className="btn btn-hot px-7 py-3.5 text-base">
              Leaderboard
            </Link>
          </div>
          <div className="mt-6">
            <ArcadeActions slug={a.slug} ticker={t.coin.ticker} />
          </div>
          <p className="mt-6 max-w-xl rounded-2xl border border-hairline bg-ink/60 px-4 py-3 text-sm leading-relaxed text-dim">
            Community launch. Not affiliated with or endorsed by the {t.coin.name} team or ArcadePad. High scores are for bragging rights only: no prizes, no wagering, no token rewards.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
        <p className="kicker">Select game</p>
        <h2 className="mt-5 text-[clamp(2.2rem,5vw,3.6rem)]">${t.coin.ticker} arcade</h2>
        <GameGrid games={games} theme={t} />
      </section>
    </>
  );
}
