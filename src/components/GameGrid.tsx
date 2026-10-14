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
      <div role="toolbar" aria-label="Filter games" className="mt-8 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
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
          const p = t.palette;
          return (
            <li key={g.id} className="min-w-0">
              <article
                className="group relative flex h-full flex-col overflow-hidden rounded-2xl border border-hairline bg-surface transition-[transform,border-color,box-shadow] duration-300 hover:-translate-y-1 hover:border-[var(--glow)] hover:shadow-[0_0_0_1px_var(--glow),0_20px_50px_-20px_var(--glow)]"
                style={{ "--glow": `${p.primary}88` } as React.CSSProperties}
              >
                <Link href={`/play/${g.id}/${t.id}`} className="crt relative block aspect-[4/3] overflow-hidden" tabIndex={-1} aria-hidden>
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.04]">
                    <GameThumb gameId={g.id} theme={t} label={`${g.name} preview`} />
                  </div>
                  <span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
                  <span
                    className="pixel pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-md px-3 py-1.5 text-xs text-[#0b0814] opacity-0 shadow-[0_0_24px_var(--glow)] transition-opacity duration-200 group-hover:opacity-100"
                    style={{ background: p.primary }}
                  >
                    ▶ PLAY
                  </span>
                </Link>
                <div className="flex flex-1 flex-col p-3 sm:p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="pixel truncate text-[0.6rem] uppercase tracking-[0.12em]" style={{ color: p.primary }}>
                      {g.category}
                    </span>
                    <span className="hidden shrink-0 font-mono text-[0.65rem] text-dim sm:inline">{g.session}</span>
                  </div>
                  <h3 className="mt-1.5 text-[0.98rem] font-semibold leading-tight tracking-tight sm:text-lg">
                    <Link href={`/play/${g.id}/${t.id}`} className="after:absolute after:inset-0 after:content-['']">
                      {g.name}
                    </Link>
                  </h3>
                  <p className="mt-1 hidden text-[0.82rem] leading-snug text-soft sm:line-clamp-2">{g.tagline}</p>
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
