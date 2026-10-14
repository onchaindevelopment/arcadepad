"use client";
import { useEffect, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { siteSound } from "@/lib/site-sound";

/** Full-screen game routes (/play/<game>/<skin>) run their own music. */
const isGameRoute = (p: string) => /^\/play\/[^/]+\/[^/]+/.test(p);

/** Wires the title music and click blips to the page. Renders nothing. */
export function SiteAudio() {
  const path = usePathname();

  useEffect(() => {
    siteSound.suppress(isGameRoute(path));
  }, [path]);

  useEffect(() => {
    const wake = () => siteSound.wake();
    const onClick = (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest("a, button, [role=button], select, summary");
      if (!el || el.closest("[data-sound-toggle]")) return;
      const primary = el.classList.contains("btn") && !el.classList.contains("btn-plain");
      siteSound.blip(primary ? "launch" : el.tagName === "A" ? "brick" : "paddle");
    };
    const onGame = () => siteSound.suppress(true);
    const onVis = () => (document.hidden ? siteSound.pause() : siteSound.resumeIfOn());
    window.addEventListener("pointerdown", wake, { capture: true });
    window.addEventListener("keydown", wake);
    window.addEventListener("click", onClick, { capture: true });
    window.addEventListener("ap:game", onGame);
    document.addEventListener("visibilitychange", onVis);
    return () => {
      window.removeEventListener("pointerdown", wake, { capture: true });
      window.removeEventListener("keydown", wake);
      window.removeEventListener("click", onClick, { capture: true });
      window.removeEventListener("ap:game", onGame);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return null;
}

/** Square pixel speaker button for the HUD. */
export function SoundButton({ className = "" }: { className?: string }) {
  const on = useSyncExternalStore(siteSound.subscribe, siteSound.isOn, () => true);
  return (
    <button
      type="button"
      data-sound-toggle
      onClick={() => siteSound.toggle()}
      aria-pressed={on}
      aria-label={on ? "Music and sounds on. Click to mute." : "Music and sounds off. Click to turn on."}
      title={on ? "Mute" : "Sound on"}
      className={`hud-btn grid h-11 w-11 place-items-center ${className}`}
    >
      <svg viewBox="0 0 12 12" width={22} height={22} shapeRendering="crispEdges" aria-hidden>
        <path d="M1 4h2v4H1zM3 4h1V3h1V2h1v8H5V9H4V8H3z" fill="currentColor" />
        {on ? (
          <path d="M8 4h1v4H8zM10 2h1v1h-1zM10 9h1v1h-1zM11 3h1v6h-1z" fill="currentColor" />
        ) : (
          <path d="M8 4h1v1H8zM11 4h1v1h-1zM9 5h2v2H9zM8 7h1v1H8zM11 7h1v1h-1z" fill="currentColor" />
        )}
      </svg>
    </button>
  );
}
