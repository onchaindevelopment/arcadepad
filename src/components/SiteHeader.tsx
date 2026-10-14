"use client";
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoBadge } from "./Logo";
import { WalletButton } from "./WalletButton";
import { SoundButton } from "./SiteAudio";

const NAV = [
  { href: "/", label: "Arcade" },
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/create", label: "Launch" },
  { href: "/order", label: "Order" },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path.startsWith(href);
}

export function SiteHeader() {
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
      <div className="drop-in relative mx-auto flex max-w-6xl items-center justify-between gap-3 md:gap-5">
        <Link href="/" aria-label="ArcadePad home" className="group flex shrink-0 items-center gap-3 rounded-full">
          <LogoBadge />
          <span className="sign chrome hidden text-[1.35rem] leading-none sm:inline lg:text-[1.5rem]">ArcadePad</span>
        </Link>
        <nav aria-label="Main" className="hidden h-12 items-center gap-1 rounded-full border border-hot/50 bg-[#1a0838]/90 px-2 shadow-[0_0_0_1px_rgba(255,46,136,0.15),0_0_24px_-6px_rgba(255,46,136,0.6)] backdrop-blur md:flex">
          <Suspense fallback={<DeskLinks path="" />}>
            <WithPath render={(p) => <DeskLinks path={p} />} />
          </Suspense>
        </nav>
        <div className="hidden items-center gap-2.5 md:flex">
          <SoundButton />
          <WalletButton compact />
        </div>
        <SoundButton className="ml-auto md:hidden" />
        <button
          type="button"
          className={`grid h-12 w-12 place-items-center rounded-full transition-colors md:hidden ${open ? "bg-sun" : "bg-pill shadow-[inset_0_0_0_1px_rgba(255,46,136,0.5),0_0_18px_-4px_rgba(255,46,136,0.6)]"}`}
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
          <div id="mobile-menu" className="menu-in absolute inset-x-4 top-[calc(100%+10px)] mx-auto max-w-sm rounded-[28px] border border-hot/40 bg-[#1f0b42] px-4 pb-5 pt-5 shadow-[0_20px_60px_rgba(0,0,0,0.55),0_0_40px_-10px_rgba(255,46,136,0.5)] md:hidden">
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
            className={`group/tab relative flex items-center gap-1 rounded-full px-3 py-2 font-[family-name:var(--font-ui)] text-[1rem] font-medium transition-colors ${active ? "text-sun" : "text-soft hover:text-white"}`}
          >
            <span className={`font-sans text-[0.7em] ${active ? "blink" : "opacity-0 group-hover/tab:opacity-60"}`} aria-hidden>
              ▶
            </span>
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
            className={`relative rounded-2xl px-4 py-3.5 text-center font-[family-name:var(--font-ui)] text-xl ${active ? "text-sun" : "text-soft"}`}
          >
            {active && <span className="blink mr-2 font-sans text-[0.7em]" aria-hidden>▶</span>}
            {n.label}
          </Link>
        );
      })}
    </>
  );
}
