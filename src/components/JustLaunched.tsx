import { connection } from "next/server";
import { listCoinItems } from "@/lib/coin-items";
import { CoinBoard } from "./CoinBoard";

/** Newest launched coins on the home page (server component; render inside <Suspense>). */
export async function JustLaunched() {
  await connection();
  return <CoinBoard items={await listCoinItems(8)} compact />;
}
