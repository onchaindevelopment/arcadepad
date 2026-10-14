import Link from "next/link";
import { BRAND } from "@/brand";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="mt-32 border-t border-hairline bg-bg-2/60">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-soft">{BRAND.tagline} Built only on open-source games and original designs whose code and art may be reused.</p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-dim">High scores are for fun and bragging rights. No prizes, no wagering, no token rewards.</p>
        </div>
        <nav aria-label="Footer" className="grid content-start gap-2.5 text-sm">
          <span className="kicker mb-1 !text-dim">Play</span>
          <Link href="/#games" className="text-soft hover:text-text">Games</Link>
          <Link href="/leaderboard" className="text-soft hover:text-text">Leaderboard</Link>
          <Link href="/create" className="text-soft hover:text-text">Make your coin&apos;s skin</Link>
          <Link href="/order" className="text-soft hover:text-text">Order a custom game</Link>
        </nav>
        <nav aria-label="Legal" className="grid content-start gap-2.5 text-sm">
          <span className="kicker mb-1 !text-dim">Open source</span>
          <Link href="/licenses" className="text-soft hover:text-text">Licences &amp; source code</Link>
          <Link href="/fair-play" className="text-soft hover:text-text">Fair play &amp; privacy</Link>
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
