"use client";
import { useEffect, useState } from "react";
import type { ThemePack } from "@/themes/types";
import { gridToSvg } from "@/themes/pixel";

type Mood = "idle" | "happy" | "sad";

/** Pixel mascot with an idle blink. Decorative unless a label is given. */
export function Mascot({ theme, mood = "idle", size = 128, label, className = "" }: { theme: ThemePack; mood?: Mood; size?: number; label?: string; className?: string }) {
  const [blink, setBlink] = useState(false);
  useEffect(() => {
    if (mood !== "idle") return;
    let t: number;
    const loop = () => {
      t = window.setTimeout(() => {
        setBlink(true);
        window.setTimeout(() => setBlink(false), 140);
        loop();
      }, 2200 + Math.random() * 2600);
    };
    loop();
    return () => window.clearTimeout(t);
  }, [mood]);
  const grid = mood === "idle" ? (blink ? theme.mascot.blink : theme.mascot.idle) : theme.mascot[mood];
  const svg = gridToSvg(grid, theme.pixels);
  return (
    <span
      className={`inline-block [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

/** Static version for server components (no blink). */
export function MascotStatic({ theme, mood = "idle", size = 128, className = "" }: { theme: ThemePack; mood?: Mood; size?: number; className?: string }) {
  return (
    <span
      className={`inline-block [&>svg]:h-full [&>svg]:w-full ${className}`}
      style={{ width: size, height: size }}
      aria-hidden
      dangerouslySetInnerHTML={{ __html: gridToSvg(theme.mascot[mood], theme.pixels) }}
    />
  );
}
