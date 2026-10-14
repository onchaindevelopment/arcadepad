"use client";
import { useRouter } from "next/navigation";
import { CATEGORIES, categoryOf } from "@/games/categories";

type Opt = { id: string; name: string };

/** Compact game picker: a native select grouped by catalogue category. */
export function GameSelect({ games, value, onChange, label = "Game" }: { games: Opt[]; value: string; onChange: (id: string) => void; label?: string }) {
  return (
    <label className="relative block w-full max-w-sm">
      <span className="sr-only">{label}</span>
      <select
        className="field cursor-pointer appearance-none !py-2.5 !pr-10 font-medium"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {CATEGORIES.map((c) => {
          const list = games.filter((g) => categoryOf(g.id) === c);
          return list.length ? (
            <optgroup key={c} label={c}>
              {list.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </optgroup>
          ) : null;
        })}
      </select>
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-soft" aria-hidden>
        ▼
      </span>
    </label>
  );
}

/** Same picker, navigating to a URL built from the chosen game. */
export function GameSelectNav({ games, value, hrefFor }: { games: Opt[]; value: string; hrefFor: string }) {
  const router = useRouter();
  return <GameSelect games={games} value={value} onChange={(id) => router.push(hrefFor.replace("__GAME__", id))} />;
}
