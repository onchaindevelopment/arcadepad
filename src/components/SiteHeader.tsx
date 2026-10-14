import Link from "next/link";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/#games", label: "Games" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/create", label: "Make your skin" },
  { href: "/order", label: "Order a game" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-[rgba(7,6,13,0.72)] backdrop-blur-xl backdrop-saturate-150">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="shrink-0 rounded-lg" aria-label="ArcadePad home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-lg px-3 py-2 text-sm font-medium text-soft transition-colors hover:bg-white/5 hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
        <WalletButton compact />
      </div>
      <nav aria-label="Main (mobile)" className="mx-auto flex max-w-6xl gap-1 overflow-x-auto px-3 pb-2 md:hidden [scrollbar-width:none]">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="shrink-0 rounded-lg px-3 py-1.5 text-[0.8rem] font-medium text-soft hover:bg-white/5 hover:text-text">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
