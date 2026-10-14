import Link from "next/link";
import { BRAND } from "@/brand";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-hairline bg-[linear-gradient(180deg,rgba(11,3,32,0.4),#0b0320)]">
      {/* Game-over strip */}
      <div className="checker h-[14px] opacity-80" aria-hidden />
      <div className="mx-auto max-w-6xl px-4 pt-14 text-center sm:px-6">
        <p className="sign text-[clamp(1.8rem,4.4vw,3rem)] text-white [text-shadow:2px_2px_0_var(--hot),4px_4px_0_#3b0f7a]">Thanks for playing</p>
        <p className="mt-3 font-[family-name:var(--font-ui)] text-xl text-sun">Continue?</p>
        <div className="mt-6 flex flex-wrap justify-center gap-4">
          <Link href="/create" className="btn">
            Yes · Launch your arcade
          </Link>
          <a href="#main" className="btn btn-plain">
            Back to the top ▲
          </a>
        </div>
      </div>
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-soft">{BRAND.tagline} Built only on open-source games and original designs whose code and art may be reused.</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-dim">High scores are for fun and bragging rights. No prizes, no wagering, no token rewards.</p>
        </div>
        <nav aria-label="Footer" className="grid content-start gap-2.5 text-[0.95rem]">
          <span className="kicker mb-1">Play</span>
          <Link href="/#games" className="text-soft hover:text-sun">Games</Link>
          <Link href="/leaderboard" className="text-soft hover:text-sun">Leaderboard</Link>
          <Link href="/create" className="text-soft hover:text-sun">Launch your arcade</Link>
          <Link href="/order" className="text-soft hover:text-sun">Order a custom game</Link>
        </nav>
        <nav aria-label="Legal" className="grid content-start gap-2.5 text-[0.95rem]">
          <span className="kicker mb-1">Open source</span>
          <Link href="/licenses" className="text-soft hover:text-sun">Licences &amp; source code</Link>
          <Link href="/fair-play" className="text-soft hover:text-sun">Fair play &amp; privacy</Link>
        </nav>
      </div>
      <div className="border-t border-hairline">
        <p className="mx-auto max-w-6xl px-4 py-6 text-xs text-dim sm:px-6">
          © {BRAND.name}. Game code is free software under the GNU GPL v3. Demo coins on this site are fictional.
        </p>
      </div>
    </footer>
  );
}
