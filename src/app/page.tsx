import Link from "next/link";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";
import { AttractScreen } from "@/components/AttractScreen";
import { GameGrid } from "@/components/GameGrid";
import { HowItWorks } from "@/components/HowItWorks";
import { CountUp } from "@/components/CountUp";
import { TitleMenu } from "@/components/TitleMenu";
import { InsertCoin } from "@/components/InsertCoin";
import { GAMES } from "@/games/registry";
import { CATEGORIES, categoryOf } from "@/games/categories";

const MARQUEE = ["Insert coin", ...THEMES.map((t) => `$${t.coin.ticker}`), "High scores", "Share cards", "Open source", "No wagering", "Press start", "Tilt!"];
const MARQUEE_COLORS = ["var(--sun)", "var(--hot)", "var(--sky)", "var(--mint)", "var(--orange)"];

const PACK_SNIPPET = `{
  "coin":    { "ticker": "GLORP", "chain": "solana" },
  "palette": { "primary": "#B6FF3B", ... },
  "mascot":  { "idle": [ "......kkk......." ... ] },
  "sfx":     { "brickgone": { "wave": "sine", "f0": 900 } },
  "music":   { "bpm": 132, "leadSteps": [ "E5", ... ] }
}`;

const d = (s: number) => ({ "--d": `${s}s` }) as React.CSSProperties;
const BUMPERS = [
  { c: "#ff2e88", c2: "#ffd23d", pos: "left-[4%] top-[22%]", size: 132, theme: 0 },
  { c: "#2ee6ff", c2: "#8b5cff", pos: "right-[5%] top-[16%]", size: 120, theme: 2 },
  { c: "#ff7a1a", c2: "#ff2e88", pos: "right-[10%] bottom-[22%]", size: 96, theme: 1 },
];

export default function Home() {
  const order = (id: string) => CATEGORIES.indexOf(categoryOf(id));
  const games = GAMES.map((g) => ({ id: g.id, name: g.name, tagline: g.tagline, session: g.session, category: categoryOf(g.id) })).sort((a, b) => order(a.id) - order(b.id));
  const ported = GAMES.filter((g) => g.credits.basedOn !== "Original");
  const originals = GAMES.length - ported.length;
  const stats = [
    { to: GAMES.length, suffix: "", label: "Games" },
    { to: THEMES.length, suffix: "", label: "Demo skins" },
    { to: 100, suffix: "%", label: "Runs replayed" },
    { to: 0, suffix: "", label: "Token rewards" },
  ];

  return (
    <>
      <InsertCoin />
      {/* Hero: pinball backglass */}
      <section className="relative -mt-[64px] flex min-h-[100svh] flex-col overflow-hidden px-4 pb-0 pt-[96px] sm:-mt-[68px] sm:pt-[110px]">
        <div className="sunburst pointer-events-none absolute left-1/2 top-[42%] h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-[linear-gradient(to_top,var(--bg),transparent)]" aria-hidden />
        {BUMPERS.map((b) => (
          <div key={b.pos} className={`bumper floaty pointer-events-none absolute hidden place-items-center lg:grid ${b.pos}`} style={{ width: b.size, height: b.size, ["--c" as string]: b.c, ["--c2" as string]: b.c2 }} aria-hidden>
            <MascotStatic theme={THEMES[b.theme]} size={Math.round(b.size * 0.42)} />
          </div>
        ))}

        <div className="relative z-10 mx-auto flex w-full max-w-[980px] flex-1 flex-col items-center justify-center text-center">
          {/* Marquee sign */}
          <div className="reveal relative w-full max-w-[860px] rounded-[36px] px-5 pb-8 pt-7 sm:px-12 sm:pb-11 sm:pt-9" style={{ ...d(0.05), background: "linear-gradient(180deg, #2a1156, #12062a)", boxShadow: "0 0 0 3px #ffd23d, 0 0 0 8px #12062a, 0 0 0 10px rgba(255,46,136,0.6), 0 0 70px -10px rgba(255,46,136,0.7)" }}>
            <div className="bulbs" aria-hidden />
            <p className="pixel text-[0.72rem] uppercase tracking-[0.3em] text-sky sm:text-sm">★ Now playing ★</p>
            <h1 className="mt-3">
              <span className="chrome block text-[clamp(2.8rem,10.5vw,7.4rem)] leading-[0.95]">ArcadePad</span>
              <span className="mt-4 block text-balance text-[clamp(1rem,2.7vw,1.85rem)] leading-tight text-white [text-shadow:2px_2px_0_var(--hot),4px_4px_0_#3b0f7a]">The arcade launchpad for your coin</span>
            </h1>
          </div>

          <div className="reveal mt-9" style={d(0.25)}>
            <TitleMenu />
          </div>

          {/* Dot-matrix score display */}
          <dl className="dmd reveal mt-10 grid w-full max-w-[760px] grid-cols-2 gap-y-4 px-4 py-5 sm:grid-cols-4 sm:px-6" style={d(0.5)}>
            {stats.map((s, i) => (
              <div key={s.label} className="flex flex-col items-center">
                <dd className="text-[clamp(2rem,4.4vw,2.8rem)] leading-none">{s.to === 0 ? "0" : <CountUp to={s.to} suffix={s.suffix} duration={1500 + i * 80} delay={480 + i * 90} />}</dd>
                <dt className="mt-2 font-sans text-[0.8rem] font-semibold uppercase tracking-[0.12em] [text-shadow:none]" style={{ color: "#ffb066" }}>{s.label}</dt>
              </div>
            ))}
          </dl>
        </div>
        <div className="checker relative z-10 mt-14 h-[18px] w-[calc(100%+2rem)] -translate-x-4 opacity-90" aria-hidden />
      </section>

      {/* Marquee */}
      <div className="overflow-hidden border-b-4 border-ink bg-[linear-gradient(90deg,#ff2e88,#8b5cff,#2ee6ff)] py-4" aria-hidden>
        <div className="marquee">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={`${k}-${i}`} className="sign flex items-center gap-8 px-8 text-[clamp(1.3rem,2.8vw,2.2rem)] text-white [text-shadow:3px_3px_0_#12062a]">
                  {m} <span style={{ color: MARQUEE_COLORS[i % MARQUEE_COLORS.length] }}>★</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-28 sm:px-6">
        <div className="text-center">
          <p className="kicker">Stage 1 · How it works</p>
          <h2 className="mt-5 text-[clamp(2.2rem,5.6vw,4.4rem)]">From game to your arcade</h2>
        </div>
        <div className="mt-14">
          <HowItWorks />
        </div>
      </section>

      {/* Games */}
      <section id="games" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-32 sm:px-6">
        <p className="kicker">Stage 2 · Select game</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="text-[clamp(2.4rem,6vw,4.6rem)]">{GAMES.length} games</h2>
          <p className="max-w-sm leading-relaxed text-soft">Every game runs in the browser, wears your coin&apos;s skin and keeps a replay-verified leaderboard.</p>
        </div>
        <GameGrid games={games} />
      </section>

      {/* Live demo */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 overflow-x-clip px-4 pt-32 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="kicker">Stage 3 · Attract mode</p>
          <h2 className="mt-5 text-[clamp(2.2rem,5vw,4rem)]">Every game plays itself</h2>
          <p className="mt-6 max-w-md leading-relaxed text-soft">
            Each game has a built-in bot, so your page is never empty. Watch it cycle through the arcade in every skin, then grab the controls.
          </p>
        </div>
        <AttractScreen games={GAMES.map((g) => ({ id: g.id, name: g.name, field: g.field }))} />
      </section>

      {/* Skins */}
      <section className="mx-auto max-w-6xl px-4 pt-32 sm:px-6">
        <p className="kicker">Stage 4 · Player select</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="text-[clamp(2.2rem,5vw,4rem)]">Same games, your coin</h2>
          <p className="max-w-sm leading-relaxed text-soft">One theme pack re-skins every game. These three coins are made up; yours could be next.</p>
        </div>
        <div className="mt-12 grid gap-5 md:grid-cols-3">
          {THEMES.map((t, i) => {
            const p = t.palette;
            return (
              <Link key={t.id} href={`/play/breakout/${t.id}`} className="slab slab-lift group flex flex-col overflow-hidden">
                <span className="relative grid place-items-center overflow-hidden py-10" style={{ background: `repeating-conic-gradient(from 0deg at 50% 60%, ${p.primary}33 0deg 10deg, transparent 10deg 20deg), linear-gradient(180deg, ${p.bg2}, ${p.bg})` }}>
                  <span className="pixel absolute left-4 top-3 text-xs uppercase tracking-[0.2em] text-white/80">P{i + 1}</span>
                  <MascotStatic theme={t} size={124} className="relative drop-shadow-[0_8px_0_rgba(0,0,0,0.35)] transition-transform duration-300 group-hover:-translate-y-1 group-hover:scale-110" />
                </span>
                <span className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
                  <span>
                    <span className="sign block text-2xl leading-none" style={{ color: p.primary, textShadow: "2px 2px 0 #12062a" }}>
                      ${t.coin.ticker}
                    </span>
                    <span className="mt-1.5 block text-sm capitalize text-dim">
                      {t.coin.name} · {t.coin.chain}
                    </span>
                  </span>
                  <span className="btn btn-sm">Select</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Open source */}
      <section className="mx-auto max-w-6xl px-4 pt-32 sm:px-6">
        <p className="kicker">Stage 5 · No bootlegs</p>
        <h2 className="mt-5 text-[clamp(2.2rem,5vw,4rem)]">Open source only</h2>
        <div className="mt-12 grid gap-5 lg:grid-cols-[1.1fr_1fr]">
          <div className="slab min-w-0 p-6 sm:p-7">
            <h3 className="text-lg">A skin is one file</h3>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              Theme packs are plain JSON: sprite grids, palette, sound recipes and a chiptune. No new code, so a new coin&apos;s skin is fast to make and easy to review.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-2xl border border-hairline bg-ink p-4 font-mono text-[0.76rem] leading-relaxed text-[#b6ff3b]">
              <code>{PACK_SNIPPET}</code>
            </pre>
          </div>
          <div className="slab min-w-0 p-6 sm:p-7">
            <h3 className="text-lg">Every licence checked</h3>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              Ported games use code <em>and</em> art whose licences allow commercial reuse and changes. Everything else is an ArcadePad original. No famous trademarked names or
              characters, and the full source is public under the GPL.
            </p>
            <ul className="mt-5 divide-y divide-hairline rounded-2xl border border-hairline text-sm">
              {ported.map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5">
                  <span className="font-semibold">{g.name}</span>
                  <span className="font-mono text-xs text-dim">
                    {g.credits.basedOn} · {g.credits.licence}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="font-semibold">+{originals} originals</span>
                <span className="font-mono text-xs text-dim">ArcadePad · GPL-3.0</span>
              </li>
            </ul>
            <Link href="/licenses" className="btn btn-plain btn-sm mt-6">
              Every licence →
            </Link>
          </div>
        </div>
      </section>

      {/* Insert coin */}
      <section className="relative mx-auto max-w-6xl overflow-hidden px-4 pb-4 pt-36 text-center sm:px-6">
        <div className="sunburst pointer-events-none absolute left-1/2 top-[60%] h-[900px] w-[900px] -translate-x-1/2 -translate-y-1/2 opacity-60" aria-hidden />
        <div className="relative">
          <p className="kicker">Final stage</p>
          <h2 className="chrome mt-6 text-[clamp(3rem,10vw,7.5rem)] leading-none">Insert coin</h2>
          <p className="mx-auto mt-7 max-w-md leading-relaxed text-soft">Your mascot, your colours and a leaderboard your community will fight over. No wagering, no entry fees, no token rewards.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-4">
            <Link href="/create" className="btn px-7 py-3.5 text-base">
              Launch your arcade
            </Link>
            <Link href="/order" className="btn btn-hot px-7 py-3.5 text-base">
              Order a game
            </Link>
          </div>
          <p className="pixel blink mt-12 text-sm uppercase tracking-[0.3em] text-sun">Press start</p>
        </div>
      </section>
    </>
  );
}
