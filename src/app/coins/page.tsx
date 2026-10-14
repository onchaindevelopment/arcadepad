import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { CoinBoard } from "@/components/CoinBoard";
import { listCoinItems } from "@/lib/coin-items";

export const metadata: Metadata = {
  title: "Coins",
  description: "Every coin arcade launched on ArcadePad. Search, sort and play.",
};

export default function CoinsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-14 sm:px-6">
      <p className="kicker">Coins</p>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-[clamp(2.4rem,6vw,4.4rem)]">Every coin arcade</h1>
        <Link href="/create" className="btn btn-sun">
          Launchpad
        </Link>
      </div>
      <Suspense fallback={<p className="pixel mt-10 text-dim">Loading coins…</p>}>
        <Board />
      </Suspense>
    </div>
  );
}

async function Board() {
  await connection();
  return <CoinBoard items={await listCoinItems(200)} />;
}
