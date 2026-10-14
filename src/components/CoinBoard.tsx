"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { gridToSvg } from "@/themes/pixel";
import type { CoinItem } from "@/lib/coin-items";

type Sort = "new" | "played" | "best";
const CHAINS = ["all", "solana", "base", "ethereum"] as const;

function ago(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function Mascot({ c, size }: { c: CoinItem; size: number }) {
  return (
    <span
      className="grid shrink-0 place-items-center border-2 border-white/20"
      style={{ width: size, height: size, background: `radial-gradient(circle, ${c.primary}55, ${c.bg})` }}
      aria-hidden
    >
      <span className="block [&>svg]:h-full [&>svg]:w-full" style={{ width: size * 0.74, height: size * 0.74 }} dangerouslySetInnerHTML={{ __html: gridToSvg(c.grid, c.pixels) }} />
    </span>
  );
}

/** Launched coins with search, sort, chain filter and grid/list views. */
export function CoinBoard({ items, compact = false }: { items: CoinItem[]; compact?: boolean }) {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<Sort>("new");
  const [chain, setChain] = useState<(typeof CHAINS)[number]>("all");
  const [view, setView] = useState<"grid" | "list">("grid");

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase().replace(/^\$/, "");
    const list = items.filter((c) => (chain === "all" || c.chain === chain) && (!needle || c.name.toLowerCase().includes(needle) || c.ticker.toLowerCase().includes(needle)));
    const by: Record<Sort, (a: CoinItem, b: CoinItem) => number> = {
      new: (a, b) => b.createdAt - a.createdAt,
      played: (a, b) => b.runs - a.runs || b.createdAt - a.createdAt,
      best: (a, b) => b.best - a.best || b.createdAt - a.createdAt,
    };
    return [...list].sort(by[sort]);
  }, [items, q, sort, chain]);
  const maxRuns = Math.max(1, ...items.map((c) => c.runs));

  return (
    <div className="mt-8">
      <div className="flex flex-wrap items-stretch gap-3">
        <label className="min-w-[14rem] flex-1 sm:max-w-md">
          <span className="sr-only">Search coins</span>
          <input className="field h-full" placeholder="Search coins or tickers…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="flex gap-2" role="group" aria-label="Sort">
          {(
            [
              ["new", "New"],
              ["played", "Most played"],
              ["best", "Top score"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>
              {l}
            </button>
          ))}
        </div>
        {!compact && (
          <div className="ml-auto flex gap-2" role="group" aria-label="View">
            <button type="button" className="chip" aria-pressed={view === "grid"} onClick={() => setView("grid")}>
              Grid
            </button>
            <button type="button" className="chip" aria-pressed={view === "list"} onClick={() => setView("list")}>
              List
            </button>
          </div>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Chain">
        {CHAINS.map((c) => (
          <button key={c} type="button" className="chip" aria-pressed={chain === c} onClick={() => setChain(c)}>
            {c === "all" ? "All" : c}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="slab mt-6 grid place-items-center gap-3 p-10 text-center">
          <p className="sign text-2xl">{items.length ? "No coins match" : "No launches yet"}</p>
          <p className="text-soft">{items.length ? "Try another search or chain." : "Be the first coin on the Launchpad."}</p>
          <Link href="/create" className="btn btn-sun mt-2">
            Launchpad
          </Link>
        </div>
      )}

      {view === "grid" ? (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {shown.map((c) => (
            <li key={c.slug}>
              <Link href={`/a/${c.slug}`} className="slab slab-lift block">
                <span className="flex gap-3 p-4">
                  <Mascot c={c} size={72} />
                  <span className="min-w-0">
                    <span className="sign block truncate text-xl leading-tight text-white">{c.name}</span>
                    <span className="pixel mt-1 block text-sm font-bold" style={{ color: c.primary }}>
                      ${c.ticker}
                    </span>
                    <span className="mt-1 block text-xs text-dim" suppressHydrationWarning>{ago(c.createdAt)}</span>
                  </span>
                </span>
                <span className="flex items-center justify-between gap-2 border-t-2 border-hairline px-4 py-2.5 text-xs">
                  <span className="truncate text-dim">
                    By <span className="text-soft">{c.owner}</span>
                  </span>
                  <span className="pixel shrink-0 border-2 border-white/30 px-2 py-0.5 text-[0.7rem] font-bold uppercase text-white">{c.chain}</span>
                </span>
                <span className="block border-t-2 border-hairline px-4 py-3">
                  <span className="flex justify-between text-xs">
                    <span className="text-soft">Runs {c.runs.toLocaleString("en-US")}</span>
                    <span className="text-soft">Best {c.best.toLocaleString("en-US")}</span>
                  </span>
                  <span className="mt-2 block h-2 border border-white/40" aria-hidden>
                    <span className="block h-full bg-white" style={{ width: `${Math.max(3, (c.runs / maxRuns) * 100)}%` }} />
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="slab mt-6 overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="pixel text-xs font-bold uppercase tracking-[0.12em] text-dim">
                <th className="px-4 py-3">Coin</th>
                <th className="px-4 py-3">Chain</th>
                <th className="px-4 py-3">Launched</th>
                <th className="px-4 py-3 text-right">Runs</th>
                <th className="px-4 py-3 text-right">Best</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.slug} className="border-t-2 border-hairline hover:bg-white/[0.03]">
                  <td className="px-4 py-2.5">
                    <Link href={`/a/${c.slug}`} className="flex items-center gap-3 hover:text-sun">
                      <Mascot c={c} size={36} />
                      <span className="sign text-lg">{c.name}</span>
                      <span className="pixel text-xs font-bold" style={{ color: c.primary }}>
                        ${c.ticker}
                      </span>
                    </Link>
                  </td>
                  <td className="px-4 py-2.5 capitalize text-soft">{c.chain}</td>
                  <td className="px-4 py-2.5 text-soft" suppressHydrationWarning>{ago(c.createdAt)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.runs.toLocaleString("en-US")}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.best.toLocaleString("en-US")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
