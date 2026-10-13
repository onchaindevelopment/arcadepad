import Link from "next/link";
import { Logo } from "./Logo";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/#games", label: "Games" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/#how", label: "How it works" },
  { href: "/order", label: "Order a game" },
];

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-30 px-4 pt-3 sm:px-6">
      <div className="slab mx-auto flex max-w-6xl items-center justify-between gap-3 !rounded-full px-3 py-2 sm:px-4">
        <Link href="/" className="rounded-full px-1" aria-label="ArcadePad home">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 text-[0.95rem] font-semibold hover:bg-paper-2">
              {n.label}
            </Link>
          ))}
        </nav>
        <WalletButton compact />
      </div>
      <nav aria-label="Main (mobile)" className="mx-auto mt-2 flex max-w-6xl gap-1 overflow-x-auto px-1 md:hidden">
        {NAV.map((n) => (
          <Link key={n.href} href={n.href} className="chip shrink-0 !text-[0.65rem]">
            {n.label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
