import type { Metadata } from "next";
import { BRAND } from "@/brand";

export const metadata: Metadata = {
  title: "Licences & source code",
  description: "Which open-source games, fonts and libraries ArcadePad is built on, under which licences, and where to get the source.",
};

const ROWS = [
  {
    what: "Breakout engine (ball, bricks, paddle, extras, shots, level format)",
    from: "LBreakout2 2.6.5 by Michael Speck, with patches by Zooko, Mark Tomich, Michal Cihar, Sammy Mannaert, Jochen Striepe, Lee Read, Claudio Chimera, Trevor Spiteri, Dante and Patrick Hohmeyer",
    licence: "GPL-2.0-or-later → our TypeScript port: GPL-3.0-or-later",
  },
  {
    what: "Levels, mascots, pixel art, sound recipes, music patterns, renderer, site",
    from: `Original work by ${BRAND.name}`,
    licence: "GPL-3.0-or-later",
  },
  { what: "Bricolage Grotesque, Silkscreen (fonts)", from: "The Bricolage Grotesque Project Authors; The Silkscreen Project Authors", licence: "SIL Open Font License 1.1" },
  { what: "Next.js, React, Tailwind CSS", from: "Vercel; Meta; Tailwind Labs", licence: "MIT" },
  { what: "@noble/curves, @noble/hashes, @scure/base, viem", from: "Paul Miller; wevm", licence: "MIT" },
];

export default function LicensesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 pt-12 sm:px-6">
      <span className="chip">Open source</span>
      <h1 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)] font-extrabold leading-none tracking-tight">Licences &amp; source code</h1>
      <p className="mt-5 text-lg text-soft">
        {BRAND.name} only ports games whose code <em>and</em> assets carry open licences that allow commercial use and modification, or games we have written permission for.
        We never use trademarked game names or characters.
      </p>

      <div className="slab mt-10 overflow-hidden">
        <table className="w-full text-left text-[0.95rem]">
          <caption className="sr-only">Components and their licences</caption>
          <thead className="bg-paper-2">
            <tr>
              <th scope="col" className="p-4">Component</th>
              <th scope="col" className="hidden p-4 md:table-cell">Authors</th>
              <th scope="col" className="p-4">Licence</th>
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
            From LBreakout2 we ported the game logic only. Its graphics, sounds and bundled level sets are not used: the sounds come from a third-party pack, and the community
            level sets have many authors. Every level, sprite and sound here is new.
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
