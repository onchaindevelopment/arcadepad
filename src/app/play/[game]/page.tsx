import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { THEMES, getTheme } from "@/themes";
import { GAMES, gameTitle, getGame } from "@/games/registry";
import { MascotStatic } from "@/components/Mascot";

export function generateStaticParams() {
  return [...GAMES.map((g) => ({ game: g.id })), ...THEMES.map((t) => ({ game: t.id }))];
}

export async function generateMetadata(props: PageProps<"/play/[game]">): Promise<Metadata> {
  const g = getGame((await props.params).game);
  return g ? { title: g.name, description: g.tagline } : {};
}

export default function GamePage(props: PageProps<"/play/[game]">) {
  return (
    <Suspense fallback={null}>
      <Picker params={props.params} />
    </Suspense>
  );
}

async function Picker({ params }: { params: PageProps<"/play/[game]">["params"] }) {
  const { game: id } = await params;
  // Old links were /play/<coin>: those were Breakout.
  if (!getGame(id) && getTheme(id)) redirect(`/play/breakout/${id}`);
  const game = getGame(id);
  if (!game) notFound();
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <Link href="/#games" className="chip">
        ← All games
      </Link>
      <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-none tracking-tight">{game.name}</h1>
      <p className="mt-3 max-w-2xl text-lg text-soft">{game.tagline}</p>
      <p className="mt-2 text-sm text-soft">
        {game.genre} · {game.session} · {game.controls}
      </p>
      <h2 className="mt-10 text-xl font-bold">Pick a coin skin</h2>
      <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {THEMES.map((t) => {
          const p = t.palette;
          return (
            <Link key={t.id} href={`/play/${game.id}/${t.id}`} className="slab slab-lift flex items-center gap-4 p-5" style={{ background: p.bg, color: p.text }}>
              <MascotStatic theme={t} size={72} />
              <div className="min-w-0">
                <p className="pixel text-sm" style={{ color: p.primary }}>
                  ${t.coin.ticker}
                </p>
                <p className="truncate text-xl font-extrabold">{gameTitle(game, t)}</p>
                <p className="mt-1 text-sm opacity-75">▶ Play</p>
              </div>
            </Link>
          );
        })}
      </div>
      <p className="mt-8 max-w-2xl text-sm text-soft">
        {game.credits.basedOn === "Original"
          ? "An ArcadePad original."
          : `Game logic based on ${game.credits.basedOn} by ${game.credits.authors} (${game.credits.licence}). ${game.credits.notes}`}{" "}
        <Link href="/licenses" className="underline">
          Licences
        </Link>
      </p>
    </div>
  );
}
