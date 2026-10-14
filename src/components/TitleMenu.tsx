"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { siteSound } from "@/lib/site-sound";

const ITEMS = [
  { label: "Play arcade", href: "#games" },
  { label: "Launchpad", href: "/create" },
  { label: "Coins", href: "/coins" },
  { label: "How it works", href: "#how" },
  { label: "Leaderboard", href: "/leaderboard" },
];

/**
 * Title-screen menu: a blinking cursor moved with arrow keys or the mouse, Enter or click
 * to select, with blips. Keys only steer it while the hero is on screen and no field has focus.
 */
export function TitleMenu({ align = "center" }: { align?: "left" | "center" }) {
  const [sel, setSel] = useState(0);
  const selRef = useRef(0);
  useEffect(() => {
    selRef.current = sel;
  }, [sel]);
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const inView = useRef(true);

  const choose = (i: number) => {
    siteSound.wake();
    siteSound.blip("levelclear");
    const href = ITEMS[i].href;
    if (href.startsWith("#")) document.querySelector(href)?.scrollIntoView({ behavior: "smooth", block: "start" });
    else router.push(href);
  };

  useEffect(() => {
    const io = new IntersectionObserver(([e]) => (inView.current = e.isIntersecting), { threshold: 0.4 });
    io.observe(boxRef.current!);
    const onKey = (e: KeyboardEvent) => {
      if (!inView.current || e.altKey || e.ctrlKey || e.metaKey) return;
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable]")) return;
      if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key.toLowerCase() === "s" || e.key.toLowerCase() === "w") {
        e.preventDefault();
        const d = e.key === "ArrowDown" || e.key.toLowerCase() === "s" ? 1 : -1;
        setSel((n) => (n + d + ITEMS.length) % ITEMS.length);
        siteSound.blip("paddle");
      } else if ((e.key === "Enter" || e.key === " ") && !t.closest("a, button")) {
        e.preventDefault();
        choose(selRef.current);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- choose only reads stable values
  }, []);

  return (
    <div ref={boxRef}>
      <nav aria-label="Title menu" className={`flex flex-col gap-0.5 ${align === "left" ? "items-start" : "items-center"}`}>
        {ITEMS.map((it, i) => {
          const active = i === sel;
          return (
            <button
              key={it.label}
              type="button"
              onMouseEnter={() => {
                if (i !== sel) {
                  setSel(i);
                  siteSound.blip("paddle");
                }
              }}
              onFocus={() => setSel(i)}
              onClick={() => choose(i)}
              className={`sign group relative flex items-center gap-3 py-1 text-[clamp(1.5rem,2.8vw,2rem)] uppercase transition-colors ${align === "left" ? "pr-5" : "px-5"} ${active ? "text-sun" : "text-white/80 hover:text-white"}`}
            >
              <span className={`w-5 font-sans text-[0.8em] ${active ? "blink" : "opacity-0"}`} aria-hidden>
                ▶
              </span>
              {it.label}
            </button>
          );
        })}
      </nav>
      <p className={`mt-4 hidden text-sm text-dim sm:block ${align === "left" ? "" : "text-center"}`}>↑ ↓ to choose · Enter to select</p>
    </div>
  );
}
