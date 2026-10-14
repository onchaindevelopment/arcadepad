"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoBadge } from "./Logo";
import { WalletButton } from "./WalletButton";
import { SoundButton } from "./SiteAudio";

const NAV = [
  { href: "/#games", label: "Games" },
  { href: "/coins", label: "Coins" },
  { href: "/create", label: "Launchpad" },
  { href: "/leaderboard", label: "Leaderboard" },
];

function isActive(path: string, href: string) {
  return href.startsWith("/#") ? false : path.startsWith(href) || (href === "/coins" && path.startsWith("/a/"));
}

export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 12);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

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
    <header className={`sticky top-0 z-50 border-b-2 px-4 transition-colors duration-200 ${scrolled ? "border-white/20 bg-black/90 backdrop-blur-sm" : "border-white/10 bg-black"}`}>
      {open && <div className="overlay-in fixed inset-0 bg-black/65 backdrop-blur-md md:hidden" onClick={() => setOpen(false)} aria-hidden />}
      <div className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-3 md:gap-6">
        <Link href="/" aria-label="ArcadePad home" className="group flex shrink-0 items-center gap-2.5">
          <LogoBadge size={34} />
          <span className="sign text-[1.45rem] leading-none text-white">ARCADEPAD</span>
        </Link>
        <nav aria-label="Main" className="mr-auto hidden items-center gap-6 md:flex">
          <Suspense fallback={<DeskLinks path="" />}>
            <WithPath render={(p) => <DeskLinks path={p} />} />
          </Suspense>
        </nav>
        <div className="hidden items-center gap-2 md:flex">
          <SoundButton />
          <WalletButton compact />
        </div>
        <SoundButton className="ml-auto md:hidden" />
        <button
          type="button"
          className={`grid h-11 w-11 place-items-center border-2 transition-colors md:hidden ${open ? "border-white bg-white" : "border-white/60 bg-transparent"}`}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen(!open)}
        >
          <span className="relative block h-4 w-[18px]" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className={`absolute left-0 h-[1.5px] w-[18px] transition-transform duration-300 ${open ? "bg-ink" : "bg-white"}`}
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
          <div id="mobile-menu" className="menu-in absolute inset-x-4 top-[calc(100%+8px)] mx-auto max-w-sm border-2 border-white bg-black px-4 pb-5 pt-4 shadow-[6px_6px_0_rgba(255,210,61,0.9)] md:hidden">
            <nav aria-label="Main (mobile)" className="grid gap-1">
              <Suspense fallback={<MobileLinks path="" close={() => setOpen(false)} />}>
                <WithPath render={(p) => <MobileLinks path={p} close={() => setOpen(false)} />} />
              </Suspense>
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

function WithPath({ render }: { render: (path: string) => React.ReactNode }) {
  return <>{render(usePathname())}</>;
}

function DeskLinks({ path }: { path: string }) {
  return (
    <>
      {NAV.map((n) => {
        const active = isActive(path, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            aria-current={active ? "page" : undefined}
            className={`pixel relative py-1.5 text-[0.8rem] font-bold uppercase tracking-[0.14em] transition-colors ${active ? "text-white after:absolute after:inset-x-0 after:-bottom-0.5 after:h-[2px] after:bg-sun after:content-['']" : "text-dim hover:text-white"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </>
  );
}

function MobileLinks({ path, close }: { path: string; close: () => void }) {
  return (
    <>
      {NAV.map((n) => {
        const active = isActive(path, n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            onClick={close}
            aria-current={active ? "page" : undefined}
            className={`pixel relative border-b border-white/10 px-2 py-3.5 text-base font-bold uppercase tracking-[0.12em] ${active ? "text-sun" : "text-soft"}`}
          >
            {active && <span className="blink mr-2 font-sans text-[0.7em]" aria-hidden>▶</span>}
            {n.label}
          </Link>
        );
      })}
    </>
  );
}
