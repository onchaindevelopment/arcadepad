import type { Metadata } from "next";
import { BRAND } from "@/brand";
import { GAMES } from "@/games/registry";

export const metadata: Metadata = {
  title: "Licences & source code",
  description: "Which open-source games, fonts and libraries ArcadePad is built on, under which licences, and where to get the source.",
};

const ROWS = [
  ...GAMES.map((g) =>
    g.credits.basedOn === "Original"
      ? { what: `${g.name} (game)`, from: `Original design and code by ${BRAND.name}`, licence: "GPL-3.0-or-later" }
      : { what: `${g.name} (game logic)`, from: `Ported from ${g.credits.basedOn}, ${g.credits.authors}. ${g.credits.notes}`, licence: `${g.credits.licence} → our port: GPL-3.0-or-later` },
  ),
  {
    what: "Levels, mascots, pixel art, sound recipes, music patterns, renderers, site",
    from: `Original work by ${BRAND.name}`,
    licence: "GPL-3.0-or-later",
  },
  { what: "Site music: \"Exhilarate\"", from: "Kevin MacLeod (incompetech.com). Re-encoded to 128 kbps.", licence: "CC BY 4.0" },
  { what: "Tiny5, Silkscreen, Doto, Geist, Geist Mono (fonts)", from: "The Tiny5, Silkscreen and Doto Project Authors; Vercel (Geist)", licence: "SIL Open Font License 1.1" },
  { what: "Next.js, React, Tailwind CSS", from: "Vercel; Meta; Tailwind Labs", licence: "MIT" },
  { what: "@noble/curves, @noble/hashes, @scure/base, viem, @neondatabase/serverless", from: "Paul Miller; wevm; Neon", licence: "MIT" },
];

export default function LicensesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <p className="kicker">Open source</p>
      <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-semibold leading-none tracking-[-0.04em]">Licences &amp; source code</h1>
      <p className="mt-5 text-lg text-soft">
        {BRAND.name} only ports games whose code <em>and</em> assets carry open licences that allow commercial use and modification, or games we have written permission for.
        We never use trademarked game names or characters.
      </p>

      <div className="slab mt-10 overflow-hidden">
        <table className="w-full text-left text-[0.95rem]">
          <caption className="sr-only">Components and their licences</caption>
          <thead className="bg-white/[0.03] text-sm">
            <tr>
              <th scope="col" className="p-4">Component</th>
              <th scope="col" className="hidden p-4 md:table-cell">Authors</th>
              <th scope="col" className="w-48 p-4">Licence</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => (
              <tr key={r.what} className="border-t-2 border-line align-top">
                <td className="p-4 font-semibold">
                  {r.what}
                  <span className="mt-1 block font-normal text-soft md:hidden">{r.from}</span>
                </td>
                <td className="hidden p-4 text-soft md:table-cell">{r.from}</td>
                <td className="p-4">{r.licence}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="mt-10 grid gap-4 md:grid-cols-2">
        <div className="slab p-5">
          <h2 className="text-xl font-bold">What we did not take</h2>
          <p className="mt-2 text-soft">
            From every ported game we take the game logic only. Their graphics, sounds, level sets and maps are never used, and some (like LBreakout2&apos;s sounds) come from third-party packs anyway. Every level, sprite and sound here is new. Full notices for the ported code are in THIRD_PARTY_NOTICES.md in the source repository.
          </p>
        </div>
        <div className="slab p-5">
          <h2 className="text-xl font-bold">Get the source</h2>
          <p className="mt-2 text-soft">
            The game you play is free software: you can redistribute and modify it under the GNU General Public License, version 3 or later. It comes with no warranty.
          </p>
          <p className="mt-3">
            {BRAND.sourceUrl ? (
              <a className="btn btn-sun btn-sm" href={BRAND.sourceUrl}>
                Source repository
              </a>
            ) : (
              <span className="font-semibold">The complete source code is published alongside every public release.</span>
            )}
          </p>
        </div>
      </section>
    </div>
  );
}
