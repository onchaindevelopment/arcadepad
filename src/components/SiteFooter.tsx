import Link from "next/link";
import { BRAND } from "@/brand";
import { Logo } from "./Logo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t-[2.5px] border-line bg-paper-2 px-4 py-12 sm:px-6">
      <div className="mx-auto grid max-w-6xl gap-10 md:grid-cols-[1.3fr_1fr_1fr]">
        <div>
          <Logo />
          <p className="mt-3 max-w-sm text-soft">{BRAND.tagline} Built only on open-source games whose code and art may be reused.</p>
          <p className="mt-4 max-w-sm text-sm text-soft">
            High scores are for fun and bragging rights. No prizes, no wagering, no token rewards.
          </p>
        </div>
        <nav aria-label="Footer" className="grid content-start gap-2">
          <span className="pixel text-xs uppercase text-soft">Play</span>
          <Link href="/#games" className="hover:underline">Games</Link>
          <Link href="/leaderboard" className="hover:underline">Leaderboard</Link>
          <Link href="/create" className="hover:underline">Make your coin&apos;s skin</Link>
          <Link href="/order" className="hover:underline">Order a custom game</Link>
        </nav>
        <nav aria-label="Legal" className="grid content-start gap-2">
          <span className="pixel text-xs uppercase text-soft">Open source</span>
          <Link href="/licenses" className="hover:underline">Licences &amp; source code</Link>
          <Link href="/fair-play" className="hover:underline">Fair play &amp; privacy</Link>
        </nav>
      </div>
      <p className="mx-auto mt-10 max-w-6xl text-sm text-soft">
        © {BRAND.name}. Game code is free software under the GNU GPL v3. Demo coins on this site are fictional.
      </p>
    </footer>
  );
}
