import Link from "next/link";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";
import { AttractScreen } from "@/components/AttractScreen";
import { GameGrid } from "@/components/GameGrid";
import { GameWall } from "@/components/GameWall";
import { CountUp } from "@/components/CountUp";
import { PixelIcon, type IconName } from "@/components/PixelIcon";
import { GAMES } from "@/games/registry";
import { CATEGORIES, categoryOf } from "@/games/categories";

const MARQUEE = ["Insert coin", ...THEMES.map((t) => `$${t.coin.ticker}`), "High scores", "Share cards", "Open source", "No wagering", "Press start"];

const STEPS: { t: string; d: string; icon: IconName }[] = [
  { t: "Pick a game", d: "Classics and originals, rebuilt for the browser. Deterministic, so every run can be replayed.", icon: "joystick" },
  { t: "Skin it", d: "One theme pack per coin: mascot, palette, sounds, chiptune and a level that spells your ticker.", icon: "brush" },
  { t: "Compete", d: "Players sign one message with their wallet. The server replays each run before a score counts.", icon: "trophy" },
  { t: "Share", d: "Every run gets a score card and a link. Your community posts them; new players click through.", icon: "share" },
];

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
    { icon: "#", to: GAMES.length, suffix: "", dec: 0, label: "Games in the arcade" },
    { icon: "*", to: THEMES.length, suffix: "", dec: 0, label: "Demo coin skins" },
    { icon: "%", to: 100, suffix: "%", dec: 0, label: "Runs replay-checked" },
    { icon: "$", to: 0, suffix: "", dec: 0, label: "Token rewards. On purpose" },
  ];

  return (
    <>
      {/* Hero: one viewport over a wall of live games */}
      <section className="relative -mt-[64px] flex min-h-[100svh] flex-col overflow-hidden px-4 pb-6 pt-[88px] sm:-mt-[68px] sm:pt-[96px]">
        <GameWall />
        <div className="relative z-10 mx-auto flex w-full max-w-[920px] flex-1 flex-col items-center justify-center text-center">
          <div className="reveal mb-6 inline-flex items-center" style={d(0.05)}>
            {THEMES.map((t, i) => (
              <span
                key={t.id}
                className="grid h-11 w-11 place-items-center rounded-full border border-white/40 bg-pill p-[5px] transition-transform duration-300 hover:-translate-y-1"
                style={{ marginLeft: i ? -18 : 0, zIndex: i + 1 }}
              >
                <span className="grid h-full w-full place-items-center rounded-full" style={{ background: t.palette.primary }}>
                  <MascotStatic theme={t} size={24} />
                </span>
              </span>
            ))}
            <span className="-ml-[18px] flex h-11 items-center rounded-full border border-white/40 bg-pill pl-7 pr-4 text-[0.82rem] font-medium text-[#c4c2c3]">
              {GAMES.length} games · {THEMES.length} demo coins
            </span>
          </div>

          <h1 className="text-[clamp(2rem,8.6vw,6.6rem)] leading-[1.04] tracking-[-0.06em] [font-weight:900]">
            <span className="reveal block whitespace-nowrap" style={d(0.12)}>
              Arcade classics
            </span>
            <span className="reveal block whitespace-nowrap" style={d(0.3)}>
              for your coin
            </span>
          </h1>

          <p className="reveal mt-6 max-w-[min(520px,92%)] text-[clamp(1rem,1.6vw,1.15rem)] leading-relaxed text-[#d0d0d0]/80" style={d(0.28)}>
            Launch an arcade in your community&apos;s mascot, colours and sounds. Replay-verified high scores, share cards, and something to do besides watch the chart.
          </p>

          <div className="reveal mt-9 flex flex-wrap justify-center gap-3" style={d(0.4)}>
            <Link href="#games" className="btn">
              Press start
            </Link>
            <Link href="/create" className="btn btn-plain">
              Make your skin
            </Link>
          </div>
        </div>

        <dl className="relative z-10 mx-auto mt-10 grid w-full max-w-[920px] grid-cols-2 gap-x-4 gap-y-7 md:grid-cols-4">
          {stats.map((s, i) => (
            <div key={s.label} className="reveal flex flex-col items-center text-center" style={d(0.5 + i * 0.08)}>
              <span className="display text-[clamp(1.4rem,2.6vw,2rem)] leading-none" aria-hidden>
                {s.icon}
              </span>
              <dd className="mt-2 text-[clamp(1.2rem,2.2vw,1.6rem)] font-medium tracking-[-0.025em]">
                {s.to === 0 ? "0" : <CountUp to={s.to} suffix={s.suffix} decimals={s.dec} duration={1500 + i * 80} delay={480 + i * 90} />}
              </dd>
              <dt className="mt-1 text-[0.8rem] text-dim">{s.label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* Live demo */}
      <section className="mx-auto grid max-w-6xl items-center gap-14 px-4 pt-28 sm:px-6 lg:grid-cols-[1fr_1.15fr]">
        <div>
          <p className="kicker">Live demo</p>
          <h2 className="mt-5 text-[clamp(2.2rem,5vw,4rem)]">Every game plays itself</h2>
          <p className="mt-5 max-w-md leading-relaxed text-soft">
            Each game has a built-in bot, so your page is never empty. Watch it cycle through the arcade in every skin, then take the controls.
          </p>
          <p className="cursor mt-6 font-mono text-sm text-soft">&gt; pick a game. skin it. press start.</p>
        </div>
        <AttractScreen games={GAMES.map((g) => ({ id: g.id, name: g.name, field: g.field }))} />
      </section>

      {/* Marquee */}
      <div className="mt-28 overflow-hidden border-y border-hairline py-6" aria-hidden>
        <div className="marquee">
          {[0, 1].map((k) => (
            <div key={k} className="flex shrink-0">
              {[...MARQUEE, ...MARQUEE].map((m, i) => (
                <span key={`${k}-${i}`} className="display flex items-center gap-10 px-10 text-[clamp(1.6rem,3.4vw,2.8rem)] tracking-[-0.03em]">
                  {m} <span className="h-2 w-2 rounded-full bg-white shadow-[0_0_12px_#fff]" />
                </span>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* Games */}
      <section id="games" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-24 sm:px-6">
        <p className="kicker">The arcade</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="text-[clamp(2.4rem,6vw,4.6rem)]">{GAMES.length} games</h2>
          <p className="max-w-sm text-sm leading-relaxed text-soft">Every game runs in the browser, wears your coin&apos;s skin and keeps a replay-verified leaderboard.</p>
        </div>
        <GameGrid games={games} />
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-32 sm:px-6">
        <p className="kicker">How it works</p>
        <h2 className="mt-5 text-[clamp(2.2rem,5vw,4rem)]">From game to your arcade</h2>
        <ol className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="slab slab-lift flex flex-col p-6">
              <div className="flex items-center justify-between">
                <PixelIcon name={s.icon} size={36} />
                <span className="display text-2xl text-dim">0{i + 1}</span>
              </div>
              <h3 className="mt-8 text-lg">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-soft">{s.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Skins */}
      <section className="mx-auto max-w-6xl px-4 pt-32 sm:px-6">
        <p className="kicker">Demo skins</p>
        <div className="mt-5 flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <h2 className="text-[clamp(2.2rem,5vw,4rem)]">Same games, your coin</h2>
          <p className="max-w-sm text-sm leading-relaxed text-soft">One theme pack re-skins every game. These three coins are made up; yours could be next.</p>
        </div>
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {THEMES.map((t) => {
            const p = t.palette;
            return (
              <Link key={t.id} href={`/play/breakout/${t.id}`} className="slab slab-lift group flex flex-col overflow-hidden">
                <span className="dots relative grid place-items-center py-10" style={{ background: `radial-gradient(closest-side, ${p.primary}40, transparent), #0c0c0d` }}>
                  <MascotStatic theme={t} size={120} className="relative transition-transform duration-300 group-hover:scale-110" />
                </span>
                <span className="flex items-center justify-between gap-3 border-t border-hairline px-5 py-4">
                  <span>
                    <span className="display block text-2xl leading-none" style={{ color: p.primary }}>
                      ${t.coin.ticker}
                    </span>
                    <span className="mt-1.5 block text-sm text-dim">
                      {t.coin.name} · {t.coin.chain}
                    </span>
                  </span>
                  <span className="btn btn-plain btn-sm">Play →</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Open source */}
      <section className="mx-auto max-w-6xl px-4 pt-32 sm:px-6">
        <p className="kicker">No bootlegs</p>
        <h2 className="mt-5 text-[clamp(2.2rem,5vw,4rem)]">Open source only</h2>
        <div className="mt-12 grid gap-4 lg:grid-cols-[1.1fr_1fr]">
          <div className="slab min-w-0 p-6 sm:p-7">
            <h3 className="text-lg">A skin is one file</h3>
            <p className="mt-2 text-sm leading-relaxed text-soft">
              Theme packs are plain JSON: sprite grids, palette, sound recipes and a chiptune. No new code, so a new coin&apos;s skin is fast to make and easy to review.
            </p>
            <pre className="mt-5 overflow-x-auto rounded-2xl border border-hairline bg-black p-4 font-mono text-[0.76rem] leading-relaxed text-soft">
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
                  <span className="font-medium">{g.name}</span>
                  <span className="font-mono text-xs text-dim">
                    {g.credits.basedOn} · {g.credits.licence}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                <span className="font-medium">+{originals} originals</span>
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
      <section className="relative mx-auto max-w-6xl px-4 pt-36 text-center sm:px-6">
        <div className="halftone pointer-events-none absolute inset-x-0 bottom-0 top-20 [mask-image:radial-gradient(closest-side,black,transparent)]" aria-hidden />
        <div className="relative">
          <p className="kicker">Bragging rights only</p>
          <h2 className="mt-6 text-[clamp(3rem,10vw,8rem)] leading-none tracking-[-0.05em]">Insert coin</h2>
          <p className="mx-auto mt-6 max-w-md leading-relaxed text-soft">Your mascot, your colours and a leaderboard your community will fight over. No wagering, no entry fees, no token rewards.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/create" className="btn">
              Make your skin
            </Link>
            <Link href="/order" className="btn btn-plain">
              Order a game
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
