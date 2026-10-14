import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { getTheme } from "@/themes";
import { getGame, gameTitle } from "@/games/registry";
import { store } from "@/lib/store";
import { shortAddress } from "@/lib/session";

async function load(id: string) {
  await connection();
  const s = await store.getScore(id);
  const theme = s && getTheme(s.theme);
  const game = s && getGame(s.game ?? "breakout");
  return s && theme && game ? { s, theme, game, title: gameTitle(game, theme) } : null;
}

export async function generateMetadata(props: PageProps<"/s/[id]">): Promise<Metadata> {
  const { id } = await props.params;
  const d = await load(id);
  if (!d) return { title: "Score not found" };
  const title = `${d.s.score.toLocaleString("en-US")} in ${d.title} ($${d.theme.coin.ticker})`;
  const image = { url: `/api/card/${id}`, width: 1200, height: 630, alt: title };
  return {
    title,
    description: `Can you beat it? Replay-verified score by ${shortAddress(d.s.wallet)}.`,
    openGraph: { title, images: [image] },
    twitter: { card: "summary_large_image", title, images: [image] },
  };
}

export default function SharePage(props: PageProps<"/s/[id]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6"><p className="pixel">Loading score…</p></div>}>
      <Share params={props.params} />
    </Suspense>
  );
}

async function Share({ params }: { params: PageProps<"/s/[id]">["params"] }) {
  await connection();
  const { id } = await params;
  const d = await load(id);
  if (!d) notFound();
  const { s, theme, game, title } = d;
  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="kicker">Replay-verified score</p>
      <h1 className="mt-4 text-[clamp(2rem,5vw,3.4rem)] font-semibold leading-none tracking-[-0.04em]">
        {shortAddress(s.wallet)} scored {s.score.toLocaleString("en-US")}
      </h1>
      <p className="mt-3 text-lg text-soft">
        {title} · ${theme.coin.ticker}{s.level > 0 ? ` · level ${s.level + 1}` : ""}
      </p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/api/card/${id}`} width={1200} height={630} alt={`Score card: ${s.score} points in ${title}`} className="slab mt-8 h-auto w-full" />
      <div className="mt-8 flex flex-wrap gap-3">
        <Link href={`/play/${game.id}/${theme.id}`} className="btn btn-hot">
          Beat this score
        </Link>
        <a href={`/api/card/${id}?download=1`} className="btn btn-plain">
          Download card
        </a>
        <Link href={`/leaderboard?game=${game.id}&coin=${theme.id}`} className="btn btn-plain">
          Leaderboard
        </Link>
      </div>
    </div>
  );
}
