import Link from "next/link";
import { connection } from "next/server";
import { store } from "@/lib/store";
import { arcadeTheme } from "@/lib/arcades";
import { MascotStatic } from "./Mascot";

/** Newest community-launched arcades (server component; render inside <Suspense>). */
export async function JustLaunched() {
  await connection();
  let list: Awaited<ReturnType<typeof store.listArcades>> = [];
  try {
    list = await store.listArcades(8);
  } catch {
    list = [];
  }
  return (
    <div className="mt-10 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
      {list.map((a) => {
        const t = arcadeTheme(a);
        const p = t.palette;
        return (
          <Link key={a.slug} href={`/a/${a.slug}`} className="slab slab-lift group flex items-center gap-3 overflow-hidden p-3 sm:p-4">
            <span className="grid h-16 w-16 shrink-0 place-items-center rounded-2xl" style={{ background: `radial-gradient(circle, ${p.primary}55, ${p.bg})`, boxShadow: `0 0 0 2px ${p.primary}88` }}>
              <MascotStatic theme={t} size={48} className="transition-transform group-hover:scale-110" />
            </span>
            <span className="min-w-0">
              <span className="sign block truncate text-lg leading-tight" style={{ color: p.primary, textShadow: "2px 2px 0 #12062a" }}>
                ${t.coin.ticker}
              </span>
              <span className="block truncate text-sm text-soft">{t.coin.name}</span>
              <span className="block text-xs capitalize text-dim">{a.chain}</span>
            </span>
          </Link>
        );
      })}
      <Link href="/create" className="slab slab-lift grid min-h-[96px] place-items-center border-dashed p-4 text-center" style={{ borderColor: "rgba(255,210,61,0.5)" }}>
        <span>
          <span className="sign block text-lg text-sun">+ Launch yours</span>
          <span className="mt-1 block text-sm text-soft">{list.length ? "Live in a minute" : "Be the first on the Launchpad"}</span>
        </span>
      </Link>
    </div>
  );
}
