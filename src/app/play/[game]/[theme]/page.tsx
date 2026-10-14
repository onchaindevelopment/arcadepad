import type { Metadata } from "next";
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
    <Suspense fallback={<div className="play-fixed fixed inset-0 z-50 bg-[#140a33]" />}>
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
    // Full-viewport stage: the game fills the screen; the page never scrolls (see .play-fixed in globals.css).
    <div className="play-fixed fixed inset-0 z-50" style={{ background: theme.palette.bg }}>
      <h1 className="sr-only">{title}</h1>
      <GameHost
        key={`${game.id}-${theme.id}`}
        meta={gameMeta(game)}
        theme={theme}
        title={title}
        backHref={`/play/${game.id}`}
        skinLinks={THEMES.filter((t) => t.id !== theme.id).map((t) => ({ href: `/play/${game.id}/${t.id}`, label: `Play as $${t.coin.ticker}` }))}
      />
    </div>
  );
}
