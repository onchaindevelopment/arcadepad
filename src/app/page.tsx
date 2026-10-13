import Link from "next/link";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";
import { AttractScreen } from "@/components/AttractScreen";
import { GameThumb } from "@/components/GameThumb";
import { GAMES, gameTitle } from "@/games/registry";

const MARQUEE = ["INSERT COIN", ...THEMES.map((t) => `$${t.coin.ticker}`), "HIGH SCORES", "WALLET-SIGNED", "NO WAGERING", "OPEN SOURCE", "SHARE CARDS"];

const STEPS = [
  { n: "01", t: "Port", d: "We take an open-source classic and rebuild its engine for the browser. Deterministic, so every run can be replayed.", c: "bg-sky" },
  { n: "02", t: "Re-skin", d: "One theme pack per coin: mascot sprites, palette, sounds, chiptune, title screen and a level that spells your ticker.", c: "bg-sun" },
  { n: "03", t: "Compete", d: "Players sign in by signing one message with their wallet. The server replays each run before a score counts.", c: "bg-mint" },
  { n: "04", t: "Share", d: "Every run gets a score card and a link. Your community posts them; new players click through and play.", c: "bg-hot" },
];

const PACK_SNIPPET = `{
  "coin": { "ticker": "GLORP", "chain": "solana" },
  "palette": { "primary": "#B6FF3B", ... },
  "mascot": { "idle": [ "......kkk......." ... ] },
  "sfx": { "brickgone": { "wave": "sine", "f0": 900 } },
  "music": { "bpm": 132, "leadSteps": [ "E5", ... ] }
}`;

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pt-10 sm:px-6 md:pt-16 lg:grid-cols-[1.05fr_1fr]">
        <div className="pop-in">
          <span className="chip">
            <span className="h-2 w-2 rounded-full bg-hot" aria-hidden /> Now playing: {GAMES.length} classic arcade games
          </span>
          <h1 className="mt-5 text-[clamp(2.6rem,5.6vw,4.7rem)] font-extrabold leading-[0.9] tracking-[-0.035em]">
            Classic games,
            <br />
            re-skinned for{" "}
            <span className="relative inline-block whitespace-nowrap">
              <span className="relative z-10">your coin.</span>
              <span className="absolute inset-x-[-0.1em] bottom-[0.08em] h-[0.32em] -rotate-1 rounded-full" style={{ background: "var(--highlight)" }} aria-hidden />
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-soft sm:text-xl">
            We port open-source arcade classics to the browser and dress them in your community&apos;s mascot, colours, ticker and sounds. Wallet-signed high scores, share
            cards, and something to do besides watch the chart.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="#games" className="btn btn-hot text-lg">
              ▶ Play the arcade
            </Link>
            <Link href="/create" className="btn btn-plain text-lg">
              Skin it for your coin
            </Link>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-3">
            {[
              ["3", "demo coins"],
              [String(GAMES.length), "classic games"],
              ["0", "token rewards (on purpose)"],
            ].map(([n, l]) => (
              <div key={l} className="slab !rounded-2xl !shadow-[3px_3px_0_var(--shadow)] px-3 py-2">
                <dt className="sr-only">{l}</dt>
                <dd>
                  <span className="block text-3xl font-extrabold">{n}</span>
                  <span className="block text-xs leading-tight text-soft">{l}</span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
        <AttractScreen games={GAMES.map((g) => ({ id: g.id, name: g.name, field: g.field }))} />
      </section>

      {/* Marquee */}
      <div className="mt-20 -rotate-1 border-y-[2.5px] border-line bg-sun py-3 text-oncolor" aria-hidden>
        <div className="overflow-hidden">
          <div className="marquee">
            {[0, 1].map((k) => (
              <div key={k} className="flex shrink-0">
                {[...MARQUEE, ...MARQUEE].map((m, i) => (
                  <span key={`${k}-${i}`} className="pixel flex items-center gap-6 px-6 text-lg font-bold">
                    {m} <span className="text-hot">✦</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Games */}
      <section id="games" className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-24 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="chip">The arcade</span>
            <h2 className="mt-3 text-[clamp(2rem,4.5vw,3.4rem)] font-extrabold leading-none tracking-tight">{GAMES.length} classics. Any coin.</h2>
            <p className="mt-3 max-w-xl text-soft">Every game runs in your browser, wears your coin&apos;s mascot, colours and sounds, and keeps a wallet-signed leaderboard. More are being ported.</p>
          </div>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {GAMES.map((g, i) => {
            const t = THEMES[i % THEMES.length];
            const p = t.palette;
            return (
              <article key={g.id} className="slab slab-lift group flex flex-col overflow-hidden" style={{ background: p.bg, color: p.text }}>
                <Link href={`/play/${g.id}/${t.id}`} className="block aspect-[4/3] overflow-hidden" aria-label={`Play ${gameTitle(g, t)}`} tabIndex={-1}>
                  <GameThumb gameId={g.id} theme={t} label={`${g.name} preview in the ${t.coin.ticker} skin`} />
                </Link>
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="pixel text-xs" style={{ color: p.primary }}>
                      {g.genre.toUpperCase()}
                    </span>
                    <span className="pixel rounded-full border-2 px-2 py-0.5 text-[0.6rem] uppercase" style={{ borderColor: `${p.text}55` }}>
                      {g.session}
                    </span>
                  </div>
                  <h3 className="mt-2 text-2xl font-extrabold">{g.name}</h3>
                  <p className="mt-1 flex-1 text-sm opacity-80">{g.tagline}</p>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <Link href={`/play/${g.id}/${t.id}`} className="btn btn-sm" style={{ background: p.primary }}>
                      ▶ Play
                    </Link>
                    <div className="flex gap-1.5" aria-label="Other skins">
                      {THEMES.map((o) => (
                        <Link key={o.id} href={`/play/${g.id}/${o.id}`} title={`${g.name} as ${o.coin.ticker}`} className="grid h-8 w-8 place-items-center rounded-full border-2" style={{ background: o.palette.bg2, borderColor: o.palette.primary }}>
                          <MascotStatic theme={o} size={22} />
                          <span className="sr-only">{`Play ${g.name} as $${o.coin.ticker}`}</span>
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>

        <div className="mt-16 flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="chip">Demo skins</span>
            <h2 className="mt-3 text-[clamp(1.8rem,4vw,2.8rem)] font-extrabold leading-none tracking-tight">Same games. Your coin.</h2>
            <p className="mt-3 max-w-xl text-soft">One theme pack re-skins every game: mascot, palette, sounds, music and the ticker level. These three coins are made up.</p>
          </div>
        </div>
        <div className="mt-8 grid gap-6 md:grid-cols-3">
          {THEMES.map((t) => {
            const p = t.palette;
            return (
              <article key={t.id} className="slab flex items-center gap-4 p-5" style={{ background: p.bg, color: p.text }}>
                <MascotStatic theme={t} size={84} className="floaty shrink-0" />
                <div className="min-w-0">
                  <p className="pixel text-sm" style={{ color: p.primary }}>
                    ${t.coin.ticker} · {t.coin.chain.toUpperCase()}
                  </p>
                  <p className="text-xl font-extrabold">{t.coin.name}</p>
                  <p className="mt-1 text-sm opacity-75">Fictional demo coin</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-28 px-4 pt-28 sm:px-6">
        <span className="chip">How it works</span>
        <h2 className="mt-3 text-[clamp(2rem,4.5vw,3.4rem)] font-extrabold leading-none tracking-tight">From open-source classic to your coin&apos;s arcade.</h2>
        <ol className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="slab slab-lift p-5">
              <span className={`pixel inline-grid h-10 w-10 place-items-center rounded-xl border-2 border-line text-sm font-bold text-oncolor ${s.c}`}>{s.n}</span>
              <h3 className="mt-4 text-2xl font-extrabold">{s.t}</h3>
              <p className="mt-2 text-soft">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-6 grid gap-5 lg:grid-cols-[1fr_1.1fr]">
          <div className="slab min-w-0 p-6">
            <h3 className="text-2xl font-extrabold">A skin is one file.</h3>
            <p className="mt-2 text-soft">
              Theme packs are plain JSON: sprite grids, palette, sound recipes and a 16-step chiptune. No new code, so a new coin&apos;s skin is fast to make and easy to review.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-2xl border-2 border-line bg-[#1a1033] p-4 text-[0.8rem] leading-relaxed text-[#d8ff9a]">
              <code>{PACK_SNIPPET}</code>
            </pre>
          </div>
          <div className="slab min-w-0 p-6 text-white" style={{ background: "var(--grape)" }}>
            <h3 className="text-2xl font-extrabold">Open source only. Seriously.</h3>
            <p className="mt-2 opacity-90">
              We only port games whose code <em>and</em> art carry licences that allow commercial reuse and changes (GPL, MIT, BSD, zlib code; CC0, CC-BY or GPL assets), or games we
              have written permission for. No famous trademarked names or characters. Ported code stays GPL, and its source is published.
            </p>
            <ul className="mt-5 grid gap-2">
              {GAMES.map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3 rounded-2xl border-2 border-line bg-white/10 px-3 py-2">
                  <span className="font-bold">{g.name}</span>
                  <span className="text-sm opacity-85">{g.credits.basedOn === "Original" ? "ArcadePad original" : `${g.credits.basedOn} · ${g.credits.licence}`}</span>
                </li>
              ))}
              <li className="rounded-2xl border-2 border-dashed border-white/50 px-3 py-2">
                <span className="pixel text-xs text-sun">NEXT</span>
                <p className="font-bold">More classics and bigger games, each licence-checked file by file</p>
              </li>
            </ul>
            <Link href="/licenses" className="btn btn-sun btn-sm mt-5">
              See every licence
            </Link>
          </div>
        </div>
      </section>

      {/* Fair play + CTA */}
      <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6">
        <div className="slab relative overflow-hidden p-8 text-oncolor sm:p-12" style={{ background: "var(--mint)" }}>
          <div className="relative z-10 max-w-2xl">
            <h2 className="text-[clamp(2rem,4.5vw,3.4rem)] font-extrabold leading-none tracking-tight">Your coin deserves a high score table.</h2>
            <p className="mt-4 text-lg">
              Bragging rights, not prizes: no wagering, no entry fees, no token rewards. Just your mascot, your colours and a leaderboard your community will fight over.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <Link href="/create" className="btn btn-hot text-lg">
                Make your coin&apos;s skin
              </Link>
              <Link href="/order" className="btn btn-plain text-lg !text-[#1a1033] !bg-white">
                Order a custom game
              </Link>
              <Link href="/fair-play" className="btn btn-plain text-lg !text-[#1a1033] !bg-white">
                Fair play rules
              </Link>
            </div>
          </div>
          <div className="pointer-events-none absolute -bottom-6 right-4 hidden gap-2 md:flex" aria-hidden>
            {THEMES.map((t) => (
              <MascotStatic key={t.id} theme={t} mood="happy" size={120} className="floaty" />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
