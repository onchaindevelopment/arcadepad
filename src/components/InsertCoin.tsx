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
          <span className="sign chrome text-[clamp(3rem,11vw,7rem)] leading-none">ARCADEPAD</span>
          <span className="sign mt-3 text-balance text-[clamp(1rem,2.6vw,1.6rem)] uppercase text-soft">The arcade launchpad for your coin</span>

          {/* Coin + slot */}
          <span className="relative mt-12 flex h-40 flex-col items-center justify-end" aria-hidden>
            <span className={`coin-drop absolute top-0 ${state === "drop" || state === "out" ? "is-dropping" : "floaty"}`}>
              <LogoMark size={64} />
            </span>
            <span className="relative z-10 grid h-20 w-36 place-items-center border-2 border-white bg-black shadow-[5px_5px_0_rgba(255,210,61,0.9)]">
              <span className="h-10 w-3 border-2 border-sun bg-black" />
            </span>
          </span>

          <span className={`sign mt-8 text-[clamp(1.6rem,4vw,2.4rem)] uppercase ${state === "idle" ? "blink text-sun" : "text-mint"}`}>{state === "idle" ? "Insert coin" : "Credit 01"}</span>
          <span className="mt-3 text-base font-medium text-soft">Click, tap or press any key</span>
        </button>
      </div>
    </>
  );
}
