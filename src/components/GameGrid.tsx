"use client";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { THEMES, type ThemePack } from "@/themes";
import { CATEGORIES, type Category } from "@/games/categories";
import { siteSound } from "@/lib/site-sound";
import { GameThumb } from "./GameThumb";
import { MascotStatic } from "./Mascot";

export type GridGame = { id: string; name: string; tagline: string; session: string; category: Category };

// Dark skins read best on the shelf; the light skin is one tap away on each cartridge.
const GRID_THEMES = THEMES.filter((t) => t.id !== "nubbin");

// Cartridge shell colours: soft retro plastics.
const SHELLS = ["#6f5aa8", "#4f8a8b", "#a0587a", "#6a7a3c", "#4d6aa8", "#a8703c", "#7a4fa0", "#3f8a64"];

/** `theme` pins every cartridge to one skin (a launched coin's arcade). */
export function GameGrid({ games, theme }: { games: GridGame[]; theme?: ThemePack }) {
  const [cat, setCat] = useState<Category | "All">("All");
  const listRef = useRef<HTMLUListElement>(null);
  const counts = useMemo(() => Object.fromEntries(CATEGORIES.map((c) => [c, games.filter((g) => g.category === c).length])), [games]);
  const shown = cat === "All" ? games : games.filter((g) => g.category === cat);

  // Arrow keys move between cartridges like a game's select screen.
  const onKey = (e: React.KeyboardEvent) => {
    if (!["ArrowRight", "ArrowLeft", "ArrowDown", "ArrowUp"].includes(e.key)) return;
    const links = [...(listRef.current?.querySelectorAll<HTMLAnchorElement>("a[data-cart]") ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    const cols = getComputedStyle(listRef.current!).gridTemplateColumns.split(" ").length;
    const step = e.key === "ArrowDown" ? cols : e.key === "ArrowUp" ? -cols : e.key === "ArrowRight" ? 1 : -1;
    const next = links[i + step];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };

  return (
    <>
      <div role="toolbar" aria-label="Filter games" className="mt-10 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {(["All", ...CATEGORIES] as const).map((c) => (
          <button key={c} type="button" className="chip shrink-0 font-[family-name:var(--font-ui)] !text-[0.95rem]" aria-pressed={cat === c} onClick={() => setCat(c)}>
            {c}
            <span className="opacity-60">{c === "All" ? games.length : counts[c]}</span>
          </button>
        ))}
      </div>
      <ul ref={listRef} onKeyDown={onKey} className="mt-7 grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
        {shown.map((g) => {
          const idx = games.indexOf(g);
          const t = theme ?? GRID_THEMES[idx % GRID_THEMES.length];
          const shell = SHELLS[idx % SHELLS.length];
          return (
            <li key={g.id} className="min-w-0">
              <article className="cart group relative flex h-full flex-col" style={{ ["--shell" as string]: shell }}>
                {/* Top edge: number + grip ridges */}
                <div className="flex items-center justify-between px-3 pb-1.5 pt-2">
                  <span className="pixel text-[0.72rem] text-white/70">{String(idx + 1).padStart(2, "0")}</span>
                  <span className="cart-ridges h-1.5 w-14 opacity-60" aria-hidden />
                </div>
                {/* Label: the game's screen */}
                <Link
                  href={`/play/${g.id}/${t.id}`}
                  data-cart
                  onFocus={() => siteSound.blip("paddle")}
                  aria-label={`Play ${g.name}`}
                  className="cart-label crt relative mx-2 block aspect-[4/3] overflow-hidden rounded-md outline-offset-4"
                >
                  <div className="h-full w-full transition-transform duration-500 group-hover:scale-[1.05]">
                    <GameThumb gameId={g.id} theme={t} label={`${g.name} preview`} />
                  </div>
                  <span className="pixel pointer-events-none absolute inset-x-0 bottom-0 bg-black/55 py-1 text-center text-[0.72rem] uppercase tracking-[0.18em] text-white opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
                    press start
                  </span>
                </Link>
                {/* Name + play button */}
                <div className="flex items-start justify-between gap-2 px-3 pb-2 pt-2.5">
                  <div className="min-w-0">
                    <h3 className="truncate font-[family-name:var(--font-ui)] text-[1.02rem] font-semibold leading-tight text-white sm:text-[1.12rem]">{g.name}</h3>
                    <p className="mt-0.5 truncate text-[0.76rem] font-medium text-white/75">
                      {g.category} · {g.session}
                    </p>
                  </div>
                  <Link href={`/play/${g.id}/${t.id}`} tabIndex={-1} aria-hidden className="cart-play grid h-8 w-8 shrink-0 place-items-center text-[0.7rem]">
                    ▶
                  </Link>
                </div>
                {/* Other skins */}
                {!theme && <div className="relative z-10 flex items-center gap-1.5 px-3 pb-2" aria-label="Play in another skin">
                  {THEMES.map((o) => (
                    <Link
                      key={o.id}
                      href={`/play/${g.id}/${o.id}`}
                      title={`${g.name} as $${o.coin.ticker}`}
                      className="grid h-6 w-6 place-items-center rounded-md border border-black/30 transition-transform hover:scale-110"
                      style={{ background: o.palette.bg2 }}
                    >
                      <MascotStatic theme={o} size={16} />
                      <span className="sr-only">{`Play ${g.name} as $${o.coin.ticker}`}</span>
                    </Link>
                  ))}
                </div>}
                <div className="cart-grip mx-6 mb-1.5 mt-auto h-2" aria-hidden />
              </article>
            </li>
          );
        })}
      </ul>
    </>
  );
}
