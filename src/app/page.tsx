import Link from "next/link";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";
import { AttractScreen } from "@/components/AttractScreen";

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
            <span className="h-2 w-2 rounded-full bg-hot" aria-hidden /> Now playing: Breakout, ported from LBreakout2
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
            <Link href={`/play/${THEMES[0].id}`} className="btn btn-hot text-lg">
              ▶ Play the demo
            </Link>
            <Link href="/order" className="btn btn-plain text-lg">
              Order a game for your coin
            </Link>
          </div>
          <dl className="mt-10 grid max-w-md grid-cols-3 gap-3">
            {[
              ["3", "demo coins"],
              ["1", "ported classic"],
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
        <AttractScreen />
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
            <span className="chip">Demo skins</span>
            <h2 className="mt-3 text-[clamp(2rem,4.5vw,3.4rem)] font-extrabold leading-none tracking-tight">Same game. Three coins.</h2>
            <p className="mt-3 max-w-xl text-soft">One engine, three theme packs. Each skin swaps the mascot, colours, sound effects, music and the ticker level. All three coins are made up.</p>
          </div>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {THEMES.map((t, i) => {
            const p = t.palette;
            return (
              <article key={t.id} className="slab slab-lift group relative flex flex-col overflow-hidden" style={{ background: p.bg, color: p.text }}>
                <div className="relative grid h-56 place-items-center overflow-hidden" style={{ background: `linear-gradient(160deg, ${p.bg2}, ${p.bg})` }}>
                  <div className="absolute inset-x-4 top-4 grid grid-cols-6 gap-1.5" aria-hidden>
                    {Array.from({ length: 12 }, (_, k) => (
                      <span key={k} className="h-3.5 rounded-[4px] border-2" style={{ background: p.bricks[(k + i) % p.bricks.length], borderColor: p.ink }} />
                    ))}
                  </div>
                  <MascotStatic theme={t} size={132} className="floaty mt-8 transition-transform duration-300 group-hover:scale-110" />
                </div>
                <div className="flex flex-1 flex-col p-5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="pixel text-sm font-bold" style={{ color: p.primary }}>
                      ${t.coin.ticker}
                    </span>
                    <span className="pixel rounded-full border-2 px-2 py-0.5 text-[0.65rem] uppercase" style={{ borderColor: `${p.text}55` }}>
                      {t.coin.chain}
                    </span>
                  </div>
                  <h3 className="mt-2 text-2xl font-extrabold">{t.game.title}</h3>
                  <p className="mt-1 flex-1 opacity-80">{t.game.tagline}</p>
                  <div className="mt-5 flex items-center justify-between gap-3">
                    <Link href={`/play/${t.id}`} className="btn" style={{ background: p.primary }}>
                      ▶ Play
                    </Link>
                    <span className="text-xs opacity-60">Fictional demo coin</span>
                  </div>
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
              <li className="rounded-2xl border-2 border-line bg-white/10 p-3">
                <span className="pixel text-xs text-sun">NOW PLAYING</span>
                <p className="font-bold">Breakout · engine from LBreakout2 (GPL-2.0-or-later)</p>
                <p className="text-sm opacity-80">All art, levels and sounds are new.</p>
              </li>
              <li className="rounded-2xl border-2 border-dashed border-white/50 p-3">
                <span className="pixel text-xs text-sun">NEXT</span>
                <p className="font-bold">More open-source classics, each licence-checked file by file</p>
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
              <Link href="/order" className="btn btn-hot text-lg">
                Order a game
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
