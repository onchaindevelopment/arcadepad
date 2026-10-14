"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoBadge } from "./Logo";
import { WalletButton } from "./WalletButton";

const NAV = [
  { href: "/", label: "Arcade" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/create", label: "Make a skin" },
  { href: "/order", label: "Order" },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

// Three lit dots under the active link.
const DOTS = "after:absolute after:bottom-[5px] after:left-1/2 after:h-[3px] after:w-[3px] after:-translate-x-1/2 after:rounded-full after:bg-current after:shadow-[-5px_0_0_currentColor,5px_0_0_currentColor] after:content-['']";

export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onResize = () => window.innerWidth > 768 && setOpen(false);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onResize);
      document.body.classList.remove("menu-open");
    };
  }, [open]);

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:pt-4">
      {open && <div className="overlay-in fixed inset-0 bg-black/65 backdrop-blur-md md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className="drop-in relative mx-auto flex max-w-[760px] items-center justify-between gap-3 md:justify-center md:gap-5">
        <Link href="/" aria-label="ArcadePad home" className="shrink-0 rounded-full">
          <LogoBadge />
        </Link>
        <nav aria-label="Main" className="hidden h-12 max-w-[440px] flex-1 items-center justify-between rounded-full bg-white px-2 shadow-[var(--soft-shadow)] md:flex">
          {NAV.map((n) => {
            const active = isActive(path, n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={active ? "page" : undefined}
                className={`relative rounded-full px-3.5 py-2 text-[0.92rem] font-medium tracking-[-0.01em] text-[#2e2e2e] transition-opacity ${active ? `opacity-100 ${DOTS}` : "opacity-50 hover:opacity-75"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
        <div className="hidden h-12 md:block">
          <WalletButton compact />
        </div>
        <button
          type="button"
          className={`grid h-12 w-12 place-items-center rounded-full transition-colors md:hidden ${open ? "bg-white" : "bg-pill shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)]"}`}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          <span className="relative block h-4 w-[18px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`absolute left-0 h-[1.5px] w-[18px] transition-transform duration-300 ${open ? "bg-black" : "bg-white"}`}
                style={{
                  top: `${i * 6.5 + 1}px`,
                  transform: open ? (i === 0 ? "translateY(6.5px) rotate(45deg)" : i === 2 ? "translateY(-6.5px) rotate(-45deg)" : "scaleX(0)") : "none",
                }}
              />
            ))}
          </span>
        </button>
      </div>
      {open && (
        <>
          <div id="mobile-menu" className="menu-in absolute inset-x-4 top-[calc(100%+10px)] mx-auto max-w-sm rounded-[28px] bg-white px-4 pb-5 pt-5 shadow-[0_20px_60px_rgba(0,0,0,0.45)] md:hidden">
            <nav aria-label="Main (mobile)" className="grid gap-1">
              {NAV.map((n) => {
                const active = isActive(path, n.href);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={`relative rounded-2xl px-4 py-3.5 text-center text-lg font-medium text-[#2e2e2e] ${active ? `opacity-100 ${DOTS.replace("bottom-[5px]", "bottom-[8px]")}` : "opacity-55"}`}
                  >
                    {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="mt-3 grid [&_button]:w-full [&_button]:!py-3.5">
              <WalletButton compact />
            </div>
          </div>
        </>
      )}
    </header>
  );
}
