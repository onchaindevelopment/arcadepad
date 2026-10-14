import Link from "next/link";
import { Suspense } from "react";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";
import { AttractScreen } from "@/components/AttractScreen";
import { GameGrid } from "@/components/GameGrid";
import { HowItWorks } from "@/components/HowItWorks";
import { CountUp } from "@/components/CountUp";
import { TitleMenu } from "@/components/TitleMenu";
import { InsertCoin } from "@/components/InsertCoin";
import { JustLaunched } from "@/components/JustLaunched";
import { GAMES } from "@/games/registry";
import { CATEGORIES, categoryOf } from "@/games/categories";

const MARQUEE = ["Insert coin", "Launch instantly", "High scores", "Share cards", ...THEMES.map((t) => `$${t.coin.ticker}`), "Open source", "No wagering", "Press start"];

const PACK_SNIPPET = `{
  "coin":    { "ticker": "GLORP", "chain": "solana" },
  "palette": { "primary": "#B6FF3B", ... },
  "mascot":  { "idle": [ "......kkk......." ... ] },
  "sfx":     { "brickgone": { "wave": "sine", "f0": 900 } },
  "music":   { "bpm": 132, "leadSteps": [ "E5", ... ] }
}`;

const d = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;

export default function Home() {
  const order = (id: string) => CATEGORIES.indexOf(categoryOf(id));
  const games = GAMES.map((g) => ({ id: g.id, name: g.name, tagline: g.tagline, session: g.session, category: categoryOf(g.id) })).sort((a, b) => order(a.id) - order(b.id));
  const ported = GAMES.filter((g) => g.credits.basedOn !== "Original");
  const originals = GAMES.length - ported.length;
  const stats = [
    { to: GAMES.length, suffix: "", label: "Games" },
    { to: 1, suffix: " min", label: "To launch" },
    { to: 100, suffix: "%", label: "Runs replayed" },
    { to: 0, suffix: "", label: "Fees" },
  ];

  return (
    <>
      <InsertCoin />

      {/* Title screen */}
      <section className="mx-auto grid max-w-6xl items-center gap-12 px-4 pb-14 pt-12 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:pt-16">
        <div>
          <p className="kicker reveal" style={d(0)}>
            The arcade launchpad
          </p>
          <h1 className="reveal mt-5" style={d(0.08)}>
            <span className="chrome block text-[clamp(3.4rem,9.5vw,7rem)] leading-[0.9]">ARCADEPAD</span>
          </h1>
          <p className="reveal mt-6 max-w-lg text-[1.05rem] leading-relaxed text-soft" style={d(0.16)}>
            Launch your coin&apos;s arcade in a minute: {GAMES.length} classic games in your mascot, colours and ticker, with replay-verified leaderboards. Free.
          </p>
          <div className="reveal mt-8" style={d(0.24)}>
            <TitleMenu align="left" />
          </div>
        </div>
        <div className="reveal" style={d(0.2)}>
          <AttractScreen games={GAMES.map((g) => ({ id: g.id, name: g.name, field: g.field }))} />
        </div>
      </section>

      {/* Score display */}
      <section className="mx-auto max-w-6xl px-4 sm:px-6">
        <dl className="dmd grid grid-cols-2 sm:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className={`flex flex-col items-center px-4 py-5 ${i ? "sm:border-l-2 sm:border-[#3a1804]" : ""} ${i > 1 ? "border-t-2 border-[#3a1804] sm:border-t-0" : ""}`}>
              <dd className="text-[clamp(2.2rem,4.6vw,3rem)] leading-none">{s.to === 0 ? "0" : <CountUp to={s.to} suffix={s.suffix} duration={1400 + i * 80} delay={400 + i * 90} />}</dd>
              <dt className="mt-2 font-mono text-[0.8rem] font-semibold uppercase tracking-[0.14em] [text-shadow:none]" style={{ color: "#ffb066" }}>
                {s.label}
              </dt>
            </div>
          ))}
        </dl>
      </section>

      {/* Marquee */}
      <div className="mt-16 overflow-hidden border-y-2 border-white/15 bg-black py-4" aria-hidden>
        <div className="marquee">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={`${k}-${i}`} className="sign flex items-center gap-8 px-8 text-[clamp(1.4rem,3vw,2.4rem)] uppercase text-white">
                  {m} <span className="text-sun">✦</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Coins */}
      <section id="launched" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-20 sm:px-6">
        <p className="kicker">Coins</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-[clamp(2.2rem,5vw,3.8rem)]">Just launched</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/coins" className="btn btn-plain">
              All coins →
            </Link>
            <Link href="/create" className="btn btn-sun">
              Launchpad
            </Link>
          </div>
        </div>
        <Suspense fallback={<div className="mt-8 h-24" />}>
          <JustLaunched />
        </Suspense>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 sm:px-6">
        <p className="kicker">How it works</p>
        <h2 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)]">From mascot to arcade</h2>
        <div className="mt-10">
          <HowItWorks />
        </div>
      </section>

      {/* Games */}
      <section id="games" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 sm:px-6">
        <p className="kicker">Games</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="text-[clamp(2.4rem,6vw,4.4rem)]">{GAMES.length} games</h2>
          <p className="max-w-sm leading-relaxed text-soft">Every game runs in the browser, wears your coin&apos;s skin and keeps a replay-verified leaderboard.</p>
        </div>
        <GameGrid games={games} />
      </section>

      {/* Demo coins */}
      <section className="mx-auto max-w-6xl px-4 pt-24 sm:px-6">
        <p className="kicker">Demo coins</p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="text-[clamp(2.2rem,5vw,3.8rem)]">Same games, your coin</h2>
          <p className="max-w-sm leading-relaxed text-soft">One skin re-themes every game. These three coins are made up; yours could be next.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {THEMES.map((t, i) => {
            const p = t.palette;
            return (
              <Link key={t.id} href={`/play/breakout/${t.id}`} className="slab slab-lift group flex flex-col">
                <span className="relative grid place-items-center border-b-2 border-hairline py-9" style={{ background: `radial-gradient(circle, ${p.primary}40, transparent 70%), ${p.bg}` }}>
                  <span className="pixel absolute left-3 top-3 text-xs font-bold uppercase tracking-[0.2em] text-white/80">P{i + 1}</span>
                  <MascotStatic theme={t} size={120} className="transition-transform duration-200 group-hover:scale-110" />
                </span>
                <span className="flex items-center justify-between gap-3 px-4 py-4">
                  <span>
                    <span className="sign block text-2xl leading-none text-white">{t.coin.name}</span>
                    <span className="pixel mt-1.5 block text-sm font-bold" style={{ color: p.primary }}>
                      ${t.coin.ticker} · {t.coin.chain}
                    </span>
                  </span>
                  <span className="btn btn-sm">Play</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Open source */}
      <section className="mx-auto max-w-6xl px-4 pt-24 sm:px-6">
        <p className="kicker">No bootlegs</p>
        <h2 className="mt-4 text-[clamp(2.2rem,5vw,3.8rem)]">Open source only</h2>
        <div className="mt-10 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="slab min-w-0 p-6">
            <h3 className="text-2xl">A skin is one file</h3>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              Skins are plain JSON: sprite grids, palette, sound recipes and a chiptune. No new code, so every launch is fast and safe to run.
            </p>
            <pre className="mt-5 overflow-x-auto border-2 border-hairline bg-black p-4 text-[0.76rem] leading-relaxed text-[#b6ff3b]">
              <code>{PACK_SNIPPET}</code>
            </pre>
          </div>
          <div className="slab min-w-0 p-6">
            <h3 className="text-2xl">Every licence checked</h3>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              Ported games use code <em>and</em> art whose licences allow commercial reuse and changes. Everything else is an ArcadePad original. No famous trademarked names or
              characters, and the full source is public under the GPL.
            </p>
            <ul className="mt-5 border-2 border-hairline text-sm">
              {ported.map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b-2 border-hairline px-4 py-2.5 last:border-b-0">
                  <span className="font-semibold">{g.name}</span>
                  <span className="text-xs text-dim">
                    {g.credits.basedOn} · {g.credits.licence}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="font-semibold">+{originals} originals</span>
                <span className="text-xs text-dim">ArcadePad · GPL-3.0</span>
              </li>
            </ul>
            <Link href="/licenses" className="btn btn-plain btn-sm mt-6">
              Every licence →
            </Link>
          </div>
        </div>
      </section>

      {/* Insert coin */}
      <section className="mx-auto max-w-6xl px-4 pt-32 text-center sm:px-6">
        <p className="kicker">Final stage</p>
        <h2 className="chrome mt-6 text-[clamp(3rem,10vw,7rem)] leading-none">INSERT COIN</h2>
        <p className="mx-auto mt-7 max-w-md leading-relaxed text-soft">Your mascot, your colours and a leaderboard your community will fight over. No wagering, no entry fees, no token rewards.</p>
        <div className="mt-9 flex flex-wrap justify-center gap-4">
          <Link href="/create" className="btn btn-sun px-7 py-4">
            Launchpad
          </Link>
          <Link href="#games" className="btn px-7 py-4">
            Play the arcade
          </Link>
        </div>
        <p className="pixel blink mt-12 text-sm font-bold uppercase tracking-[0.3em] text-sun">Press start</p>
      </section>
    </>
  );
}
