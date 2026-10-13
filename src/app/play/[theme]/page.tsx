import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { THEMES, getTheme } from "@/themes";
import { GameClient } from "@/components/GameClient";

export function generateStaticParams() {
  return THEMES.map((t) => ({ theme: t.id }));
}

export async function generateMetadata(props: PageProps<"/play/[theme]">): Promise<Metadata> {
  const t = getTheme((await props.params).theme);
  if (!t) return {};
  return { title: `${t.game.title} ($${t.coin.ticker})`, description: `${t.game.tagline} Play in your browser, sign in with a wallet, climb the board.` };
}

export default function PlayPage(props: PageProps<"/play/[theme]">) {
  return (
    <Suspense fallback={<div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6"><div className="slab aspect-[4/3] w-full max-w-[52rem] animate-pulse bg-paper-2" /></div>}>
      <Play params={props.params} />
    </Suspense>
  );
}

async function Play({ params }: { params: PageProps<"/play/[theme]">["params"] }) {
  const theme = getTheme((await params).theme);
  if (!theme) notFound();
  return (
    <div className="mx-auto max-w-6xl px-4 pt-8 sm:px-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="chip">${theme.coin.ticker}</span>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{theme.game.title}</h1>
        </div>
        <nav aria-label="Other skins" className="flex gap-2">
          {THEMES.filter((t) => t.id !== theme.id).map((t) => (
            <Link key={t.id} href={`/play/${t.id}`} className="btn btn-sm btn-plain">
              ${t.coin.ticker}
            </Link>
          ))}
        </nav>
      </div>
      <GameClient key={theme.id} theme={theme} />
    </div>
  );
}
