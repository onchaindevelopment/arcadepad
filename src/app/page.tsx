import Link from "next/link";
import { THEMES } from "@/themes";
import { MascotStatic } from "@/components/Mascot";
import { AttractScreen } from "@/components/AttractScreen";
import { GameGrid } from "@/components/GameGrid";
import { GAMES } from "@/games/registry";
import { CATEGORIES, categoryOf } from "@/games/categories";

const MARQUEE = ["INSERT COIN", ...THEMES.map((t) => `$${t.coin.ticker}`), "HIGH SCORES", "WALLET-SIGNED", "NO WAGERING", "OPEN SOURCE", "SHARE CARDS", "PRESS START"];
const MARQUEE_COLORS = ["var(--hot)", "var(--sun)", "var(--sky)", "var(--mint)"];

const STEPS = [
  { n: "01", t: "Port", d: "An open-source classic, or an original, rebuilt for the browser. Deterministic, so every run can be replayed.", c: "var(--sky)" },
  { n: "02", t: "Re-skin", d: "One theme pack per coin: mascot sprites, palette, sounds, chiptune, and a level that spells your ticker.", c: "var(--sun)" },
  { n: "03", t: "Compete", d: "Players sign one message with their wallet. The server replays each run before a score counts.", c: "var(--mint)" },
  { n: "04", t: "Share", d: "Every run gets a score card and a link. Your community posts them; new players click through and play.", c: "var(--hot)" },
];

const PACK_SNIPPET = `{
  "coin":    { "ticker": "GLORP", "chain": "solana" },
  "palette": { "primary": "#B6FF3B", ... },
  "mascot":  { "idle": [ "......kkk......." ... ] },
  "sfx":     { "brickgone": { "wave": "sine", "f0": 900 } },
  "music":   { "bpm": 132, "leadSteps": [ "E5", ... ] }
}`;

export default function Home() {
  const order = (id: string) => CATEGORIES.indexOf(categoryOf(id));
  const games = GAMES.map((g) => ({ id: g.id, name: g.name, tagline: g.tagline, session: g.session, category: categoryOf(g.id) })).sort((a, b) => order(a.id) - order(b.id));
  const ported = GAMES.filter((g) => g.credits.basedOn !== "Original");
  const originals = GAMES.length - ported.length;

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="grid-floor" aria-hidden />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-bg to-transparent" aria-hidden />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 px-4 pb-24 pt-12 sm:px-6 md:pt-20 lg:grid-cols-[1.1fr_1fr] lg:pb-32">
          <div className="pop-in">
            <span className="chip">
              <span className="h-1.5 w-1.5 rounded-full bg-mint shadow-[0_0_8px_var(--mint)]" aria-hidden />
              {GAMES.length} games online
            </span>
            <h1 className="mt-6 text-[clamp(2.6rem,5.3vw,4.35rem)] font-semibold leading-[0.95] tracking-[-0.045em]">
              Arcade classics,
              <br />
              re-skinned for <span className="neon-text">your coin.</span>
            </h1>
            <p className="mt-6 max-w-lg text-[1.05rem] leading-relaxed text-soft sm:text-lg">
              Dress the arcade in your community&apos;s mascot, colours, ticker and sounds. Replay-verified, wallet-signed high scores and share cards. Something to do besides watch
              the chart.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="#games" className="btn btn-hot px-6 py-3 text-base">
                ▶ Play the arcade
              </Link>
              <Link href="/create" className="btn btn-plain px-6 py-3 text-base">
                Skin it for your coin
              </Link>
            </div>
            <dl className="mt-12 grid max-w-md grid-cols-3 divide-x divide-hairline border-y border-hairline">
              {[
                [String(GAMES.length), "games"],
                [String(THEMES.length), "demo skins"],
                ["0", "token rewards"],
              ].map(([n, l]) => (
                <div key={l} className="px-4 py-3 first:pl-0">
                  <dt className="sr-only">{l}</dt>
                  <dd>
                    <span className="block font-mono text-2xl font-medium tracking-tight">{n}</span>
                    <span className="pixel block text-[0.6rem] uppercase tracking-[0.12em] text-dim">{l}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="pop-in [animation-delay:120ms]">
            <AttractScreen games={GAMES.map((g) => ({ id: g.id, name: g.name, field: g.field }))} />
          </div>
        </div>
      </section>

      {/* Ticker */}
      <div className="border-y border-hairline bg-bg-2/70 py-3" aria-hidden>
        <div className="overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_8%,black_92%,transparent)]">
          <div className="marquee">
            {[0, 1].map((k) => (
              <div key={k} className="flex shrink-0">
                {[...MARQUEE, ...MARQUEE].map((m, i) => (
                  <span key={`${k}-${i}`} className="pixel flex items-center gap-8 px-8 text-[0.72rem] tracking-[0.18em] text-soft">
                    {m} <span style={{ color: MARQUEE_COLORS[i % MARQUEE_COLORS.length] }}>◆</span>
                  </span>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Games */}
      <section id="games" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-24 sm:px-6">
        <p className="kicker">The arcade</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <h2 className="text-[clamp(2rem,4.4vw,3.3rem)] font-semibold leading-none tracking-[-0.04em]">
            {GAMES.length} games. <span className="text-soft">Any coin.</span>
          </h2>
          <p className="max-w-md text-soft">Every game runs in the browser, wears your coin&apos;s mascot, colours and sounds, and keeps a replay-verified leaderboard.</p>
        </div>
        <GameGrid games={games} />
      </section>

      {/* Skins */}
      <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6">
        <p className="kicker">Demo skins</p>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <h2 className="text-[clamp(1.9rem,4vw,2.9rem)] font-semibold leading-none tracking-[-0.04em]">
            Same games. <span className="text-soft">Your coin.</span>
          </h2>
          <p className="max-w-md text-soft">One theme pack re-skins every game: mascot, palette, sounds, music and the ticker level. These three coins are made up.</p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {THEMES.map((t) => {
            const p = t.palette;
            return (
              <Link
                key={t.id}
                href={`/play/breakout/${t.id}`}
                className="slab slab-lift group relative flex items-center gap-5 overflow-hidden p-5"
                style={{ background: `radial-gradient(120% 140% at 0% 0%, ${p.primary}30, transparent 60%), var(--surface)` }}
              >
                <span className="grid h-20 w-20 shrink-0 place-items-center rounded-2xl border border-white/10" style={{ background: `${p.ink}aa`, boxShadow: `0 0 30px -6px ${p.primary}88` }}>
                  <MascotStatic theme={t} size={64} className="floaty" />
                </span>
                <span className="min-w-0">
                  <span className="pixel block text-xs tracking-[0.12em]" style={{ color: p.primary }}>
                    ${t.coin.ticker} · {t.coin.chain.toUpperCase()}
                  </span>
                  <span className="mt-1 block text-xl font-semibold tracking-tight">{t.coin.name}</span>
                  <span className="mt-1 block text-sm opacity-60">Fictional demo coin · Play →</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto max-w-6xl scroll-mt-24 px-4 pt-28 sm:px-6">
        <p className="kicker">How it works</p>
        <h2 className="mt-3 max-w-3xl text-[clamp(1.9rem,4vw,2.9rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
          From classic game to <span className="text-soft">your coin&apos;s arcade.</span>
        </h2>
        <ol className="mt-10 grid overflow-hidden rounded-[20px] border border-hairline bg-hairline [gap:1px] sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li key={s.n} className="bg-surface p-6">
              <span className="pixel text-xs tracking-[0.14em]" style={{ color: s.c, textShadow: `0 0 12px ${s.c}` }}>
                {s.n}
              </span>
              <h3 className="mt-5 text-xl font-semibold tracking-tight">{s.t}</h3>
              <p className="mt-2 text-[0.94rem] leading-relaxed text-soft">{s.d}</p>
            </li>
          ))}
        </ol>
        <div className="mt-4 grid gap-4 lg:grid-cols-[1.15fr_1fr]">
          <div className="slab min-w-0 p-6 sm:p-7">
            <h3 className="text-xl font-semibold tracking-tight">A skin is one file.</h3>
            <p className="mt-2 text-soft">Theme packs are plain JSON: sprite grids, palette, sound recipes and a chiptune. No new code, so a new coin&apos;s skin is fast to make and easy to review.</p>
            <pre className="mt-5 overflow-x-auto rounded-xl border border-hairline bg-[#05040a] p-4 font-mono text-[0.78rem] leading-relaxed text-[#b6ff3b]">
              <code>{PACK_SNIPPET}</code>
            </pre>
          </div>
          <div className="slab min-w-0 p-6 sm:p-7">
            <h3 className="text-xl font-semibold tracking-tight">Open source only. Seriously.</h3>
            <p className="mt-2 text-soft">
              Ported games use code <em>and</em> art whose licences allow commercial reuse and changes. Everything else is an ArcadePad original. No famous trademarked names or
              characters, and the full source is public under the GPL.
            </p>
            <ul className="mt-5 divide-y divide-hairline rounded-xl border border-hairline">
              {ported.map((g) => (
                <li key={g.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-2.5 text-sm">
                  <span className="font-medium">{g.name}</span>
                  <span className="font-mono text-xs text-dim">
                    {g.credits.basedOn} · {g.credits.licence}
                  </span>
                </li>
              ))}
              <li className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-medium">{originals} more games</span>
                <span className="font-mono text-xs text-dim">ArcadePad originals · GPL-3.0</span>
              </li>
            </ul>
            <Link href="/licenses" className="btn btn-plain btn-sm mt-5">
              See every licence →
            </Link>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-6xl px-4 pt-28 sm:px-6">
        <div className="relative overflow-hidden rounded-[28px] border border-white/10 p-8 sm:p-14" style={{ background: "radial-gradient(80% 140% at 100% 0%, rgba(255,61,139,0.28), transparent 60%), radial-gradient(70% 120% at 0% 100%, rgba(61,228,255,0.18), transparent 60%), #100d1c" }}>
          <div className="grid-floor !h-full opacity-40" aria-hidden />
          <div className="relative z-10 max-w-2xl">
            <p className="kicker !text-sun">Bragging rights only</p>
            <h2 className="mt-3 text-[clamp(2rem,4.6vw,3.4rem)] font-semibold leading-[1] tracking-[-0.04em]">Your coin deserves a high score table.</h2>
            <p className="mt-4 max-w-xl text-lg text-soft">No wagering, no entry fees, no token rewards. Just your mascot, your colours and a leaderboard your community will fight over.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/create" className="btn btn-hot px-6 py-3 text-base">
                Make your coin&apos;s skin
              </Link>
              <Link href="/order" className="btn btn-plain px-6 py-3 text-base">
                Order a custom game
              </Link>
              <Link href="/fair-play" className="btn btn-plain px-6 py-3 text-base">
                Fair play rules
              </Link>
            </div>
          </div>
          <div className="pointer-events-none absolute -bottom-4 right-6 hidden gap-3 md:flex" aria-hidden>
            {THEMES.map((t, i) => (
              <MascotStatic key={t.id} theme={t} mood="happy" size={110} className={`floaty drop-shadow-[0_10px_30px_rgba(0,0,0,0.6)] ${["", "[animation-delay:0.4s]", "[animation-delay:0.8s]"][i % 3]}`} />
            ))}
          </div>
        </div>
      </section>
    </>
  );
}
