import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: "Fair play & privacy",
  description: "No prizes, no wagering, no token rewards. How scores are verified and what we store.",
};

const SECTIONS = [
  {
    h: "Bragging rights only",
    p: [
      "High scores are for fun. There are no cash prizes, no wagering, no entry fees and no token rewards for scores, here or in any game we build for a coin community.",
      "Wallet sign-in only proves which address played. You sign a text message; there is never a transaction, fee or token approval.",
    ],
  },
  {
    h: "How scores are checked",
    p: [
      "When a run starts, the server picks the random seed. The game is deterministic, so your browser records only your paddle moves and button presses.",
      "When the run ends, the server replays those inputs on the same engine and stores the score the replay produces, not the score your browser claims. Runs that finish faster than real time, are replayed twice, or don't reproduce are rejected.",
      "Replays stop casual cheating (edited scores, sped-up clocks, rerolled seeds). They can't stop someone who writes a perfect bot, so treat the top of any leaderboard with a wink.",
    ],
  },
  {
    h: "What we store",
    p: [
      "For signed-in runs: your public wallet address, your scores, and the recorded inputs of each run. Guest runs are stored without an address and don't appear on leaderboards.",
      "One cookie keeps you signed in. There are no ads or tracking cookies.",
      "Order requests: what you type into the form, to answer you. Nothing else.",
    ],
  },
];

export default function FairPlayPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 pt-12 sm:px-6">
      <span className="chip">Fair play</span>
      <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-none tracking-[-0.04em]">Fair play &amp; privacy</h1>
      <div className="mt-10 grid gap-5">
        {SECTIONS.map((s) => (
          <section key={s.h} className="slab p-6">
            <h2 className="text-2xl font-bold">{s.h}</h2>
            {s.p.map((t) => (
              <p key={t} className="mt-3 text-soft">
                {t}
              </p>
            ))}
          </section>
        ))}
        {BRAND.contact && (
          <p className="text-soft">
            Questions or deletion requests: <a className="underline" href={`mailto:${BRAND.contact}`}>{BRAND.contact}</a>
          </p>
        )}
      </div>
    </div>
  );
}
