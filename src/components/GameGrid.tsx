"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { THEMES } from "@/themes";
import { CATEGORIES, type Category } from "@/games/categories";
import { GameThumb } from "./GameThumb";
import { MascotStatic } from "./Mascot";

export type GridGame = { id: string; name: string; tagline: string; session: string; category: Category };

// Dark skins read best as a wall of screens; the light skin is one tap away on each card.
const GRID_THEMES = THEMES.filter((t) => t.id !== "nubbin");

export function GameGrid({ games }: { games: GridGame[] }) {
  const [cat, setCat] = useState<Category | "All">("All");
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, games.filter((g) => g.category === c).length])), [games]);
  const shown = cat === "All" ? games : games.filter((g) => g.category === cat);

  return (
    <>
      <div role="toolbar" aria-label="Filter games" className="mt-10 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {(["All", ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" className="chip shrink-0 !text-[0.68rem]" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
            <span className="opacity-60">{c === "All" ? games.length : counts[c]}</span>
          </button>
        ))}
      </div>
      <ul className="mt-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-4">
        {shown.map((g) => {
          const idx = games.indexOf(g);
          const t = GRID_THEMES[idx % GRID_THEMES.length];
          return (
            <li key={g.id} className="min-w-0">
              <article
                className="group relative flex h-full flex-col overflow-hidden rounded-[20px] border border-hairline bg-surface p-1.5 transition-[transform,border-color,box-shadow] duration-300 [transition-timing-function:var(--ease)] hover:-translate-y-1 hover:border-white/30 hover:shadow-[0_0_0_1px_rgba(255,255,255,0.12),0_20px_50px_-20px_rgba(255,255,255,0.25)]"
              >
                <Link href={`/play/${g.id}/${t.id}`} className="crt relative block aspect-[4/3] overflow-hidden rounded-[14px]" tabIndex={-1} aria-hidden>
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]">
                    <GameThumb gameId={g.id} theme={t} label={`${g.name} preview`} />
                  </div>
                                    <span
                    className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 scale-90 rounded-full bg-white px-4 py-2 text-xs font-semibold text-black opacity-0 shadow-[var(--glow)] transition-all duration-300 group-hover:scale-100 group-hover:opacity-100"
                  >
                    Play ▶
                  </span>
                </Link>
                <div className="flex flex-1 flex-col px-2.5 pb-2.5 pt-3 sm:px-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="pixel truncate text-[0.62rem] uppercase tracking-[0.12em] text-dim">
                      {g.category}
                    </span>
                    <span className="hidden shrink-0 text-[0.66rem] text-dim sm:inline">{g.session}</span>
                  </div>
                  <h3 className="mt-1.5 text-[0.95rem] leading-tight sm:text-[1.05rem]">
                    <Link href={`/play/${g.id}/${t.id}`} className="after:absolute after:inset-0 after:content-['']">
                      {g.name}
                    </Link>
                  </h3>
                  <p className="mt-1 hidden text-[0.8rem] leading-snug text-dim sm:line-clamp-2">{g.tagline}</p>
                  <div className="relative z-10 mt-auto flex items-center gap-1.5 pt-3" aria-label="Play in another skin">
                    {THEMES.map((o) => (
                      <Link
                        key={o.id}
                        href={`/play/${g.id}/${o.id}`}
                        title={`${g.name} as $${o.coin.ticker}`}
                        className="grid h-7 w-7 place-items-center rounded-full border border-hairline transition-transform hover:scale-110"
                        style={{ background: o.palette.bg2 }}
                      >
                        <MascotStatic theme={o} size={18} />
                        <span className="sr-only">{`Play ${g.name} as $${o.coin.ticker}`}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </>
  );
}
