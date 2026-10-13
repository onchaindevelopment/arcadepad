import type { Metadata } from "next";
import { OrderForm } from "./OrderForm";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";

export const metadata: Metadata = {
  title: "Order a game for your coin",
  description: "Tell us about your coin and mascot. We port an open-source classic and re-skin it for your community.",
};

const STEPS = [
  { n: "01", t: "You send the vibe", d: "Mascot art you own, colours, ticker, sounds you like, links to the community." },
  { n: "02", t: "We port and re-skin", d: "Pick a game from the open-source catalogue. Your mascot, palette, title screen, sound set and ticker level." },
  { n: "03", t: "Your community plays", d: "A link of your own, wallet-signed leaderboard, share cards for every run." },
];

export default function OrderPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-12 sm:px-6">
      <div className="grid items-end gap-8 md:grid-cols-[1.4fr_1fr]">
        <div>
          <span className="chip">Order a game</span>
          <h1 className="mt-4 text-[clamp(2.4rem,6vw,4.6rem)] font-extrabold leading-[0.95] tracking-tight">
            Give your coin
            <br />
            <span className="[box-decoration-break:clone] bg-[linear-gradient(transparent_64%,var(--highlight)_64%,var(--highlight)_90%,transparent_90%)] px-1">something to play.</span>
          </h1>
          <p className="mt-5 max-w-xl text-lg text-soft">
            Your request is saved with us. Nothing is charged and no wallet is needed. We reply on the contact you leave.
          </p>
        </div>
        <div className="hidden justify-end gap-3 md:flex" aria-hidden>
          {THEMES.map((t, i) => (
            <div key={t.id} className="slab floaty grid h-28 w-28 place-items-center" style={{ background: t.palette.primary, animationDelay: `${i * 0.6}s`, ["--r" as string]: `${(i - 1) * 6}deg` }}>
              <MascotStatic theme={t} size={84} />
            </div>
          ))}
        </div>
      </div>

      <ol className="mt-12 grid gap-4 md:grid-cols-3">
        {STEPS.map((s) => (
          <li key={s.n} className="slab p-5">
            <span className="pixel text-sm text-hot">{s.n}</span>
            <h2 className="mt-1 text-xl font-bold">{s.t}</h2>
            <p className="mt-1 text-soft">{s.d}</p>
          </li>
        ))}
      </ol>

      <div className="mt-12 grid gap-8 lg:grid-cols-[1.6fr_1fr]">
        <OrderForm />
        <aside className="grid content-start gap-4">
          <div className="slab p-5">
            <h2 className="text-lg font-bold">House rules</h2>
            <ul className="mt-2 grid gap-2 text-soft">
              <li>• You must own the mascot and brand, or have written permission.</li>
              <li>• We only port games whose code and art have open licences that allow this. No famous trademarked games or characters.</li>
              <li>• Scores are for bragging rights only: no prizes, wagering or token rewards.</li>
              <li>• Ported game code is GPL: its source is public, including your skin&apos;s code.</li>
            </ul>
          </div>
          <div className="slab p-5 text-oncolor" style={{ background: "var(--sun)" }}>
            <h2 className="text-lg font-bold">Pricing</h2>
            <p className="mt-1">Quoted per project after we&apos;ve seen your request. Nothing is charged through this form.</p>
          </div>
        </aside>
      </div>
    </div>
  );
}
