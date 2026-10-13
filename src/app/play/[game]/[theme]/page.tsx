import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { THEMES, getTheme } from "@/themes";
import { GAMES, gameMeta, gameTitle, getGame } from "@/games/registry";
import { GameHost } from "@/components/GameHost";

export function generateStaticParams() {
  return GAMES.flatMap((g) => THEMES.map((t) => ({ game: g.id, theme: t.id })));
}

export async function generateMetadata(props: PageProps<"/play/[game]/[theme]">): Promise<Metadata> {
  const { game: gid, theme: tid } = await props.params;
  const g = getGame(gid);
  const t = getTheme(tid);
  if (!g || !t) return {};
  return { title: `${gameTitle(g, t)} ($${t.coin.ticker})`, description: `${g.tagline} Play free in your browser, sign in with a wallet, climb the board.` };
}

export default function PlayPage(props: PageProps<"/play/[game]/[theme]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6"><div className="slab aspect-[4/3] w-full max-w-[52rem] animate-pulse bg-paper-2" /></div>}>
      <Play params={props.params} />
    </Suspense>
  );
}

async function Play({ params }: { params: PageProps<"/play/[game]/[theme]">["params"] }) {
  const { game: gid, theme: tid } = await params;
  const game = getGame(gid);
  const theme = getTheme(tid);
  if (!game || !theme) notFound();
  const title = gameTitle(game, theme);
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={`/play/${game.id}`} className="chip shrink-0">
            ← {game.name}
          </Link>
          <h1 className="truncate text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
        </div>
        <nav aria-label="Other skins" className="flex gap-2">
          {THEMES.filter((t) => t.id !== theme.id).map((t) => (
            <Link key={t.id} href={`/play/${game.id}/${t.id}`} className="btn btn-sm btn-plain">
              ${t.coin.ticker}
            </Link>
          ))}
        </nav>
      </div>
      <GameHost key={`${game.id}-${theme.id}`} meta={gameMeta(game)} theme={theme} title={title} />
    </div>
  );
}
