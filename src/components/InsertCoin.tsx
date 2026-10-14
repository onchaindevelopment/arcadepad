"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { siteSound } from "@/lib/site-sound";
import { LogoMark } from "./Logo";

const KEY = "ap_coin";

/**
 * Home-page intro, once per browser session: drop a coin in the slot to start. It doubles as
 * the user gesture browsers need before music may play. Rendered on the server so it covers
 * the first paint; an inline script hides it when already seen. Skipped for reduced motion.
 */
export function InsertCoin() {
  const [state, setState] = useState<"idle" | "drop" | "out" | "gone">("idle");

  const used = useRef(false);
  const start = useCallback(() => {
    if (used.current) return;
    used.current = true;
    setState("drop");
    siteSound.wake();
    siteSound.blip("brickgone");
    window.setTimeout(() => siteSound.blip("levelclear"), 380);
    window.setTimeout(() => setState("out"), 900);
    window.setTimeout(() => {
      setState("gone");
      document.documentElement.dataset.coin = "1";
    }, 1300);
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {}
  }, []);

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {}
    if (seen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      document.documentElement.dataset.coin = "1";
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time skip on mount
      setState("gone");
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Tab") return;
      e.preventDefault();
      start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [start]);

  if (state === "gone") return null;
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: `try{if(sessionStorage.getItem("${KEY}")==="1"||matchMedia("(prefers-reduced-motion: reduce)").matches)document.documentElement.dataset.coin="1"}catch(e){}` }} />
      <div className={`coin-intro fixed inset-0 z-[100] grid place-items-center overflow-hidden bg-bg ${state === "out" ? "coin-out" : ""}`} role="dialog" aria-label="Insert coin to start">
        <div className="sunburst pointer-events-none absolute left-1/2 top-1/2 h-[160vmax] w-[160vmax] -translate-x-1/2 -translate-y-1/2" aria-hidden />
        <button type="button" onClick={start} className="relative flex flex-col items-center px-6 text-center" aria-label="Insert coin and start">
          <span className="sign chrome text-[clamp(3rem,11vw,7rem)] leading-none">ArcadePad</span>
          <span className="sign mt-3 text-balance text-[clamp(1rem,2.6vw,1.6rem)] text-white [text-shadow:2px_2px_0_var(--hot)]">The arcade launchpad for your coin</span>

          {/* Coin + slot */}
          <span className="relative mt-12 flex h-40 flex-col items-center justify-end" aria-hidden>
            <span className={`coin-drop absolute top-0 ${state === "drop" || state === "out" ? "is-dropping" : "floaty"}`}>
              <LogoMark size={64} />
            </span>
            <span className="relative z-10 grid h-20 w-36 place-items-center rounded-2xl border-4 border-[#0b0320] bg-[linear-gradient(180deg,#3a1a72,#1a0838)] shadow-[0_6px_0_#0b0320,0_0_30px_-6px_rgba(255,46,136,0.6)]">
              <span className="h-10 w-3 rounded-full bg-[#0b0320] shadow-[inset_0_0_0_2px_rgba(255,210,61,0.8),0_0_14px_rgba(255,210,61,0.6)]" />
            </span>
          </span>

          <span className={`sign mt-8 text-[clamp(1.6rem,4vw,2.4rem)] ${state === "idle" ? "blink text-sun" : "text-mint"}`}>{state === "idle" ? "Insert coin" : "Credit 01"}</span>
          <span className="mt-3 text-base font-medium text-soft">Click, tap or press any key</span>
        </button>
      </div>
    </>
  );
}
