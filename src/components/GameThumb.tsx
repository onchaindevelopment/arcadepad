"use client";
import { useEffect, useRef } from "react";
import { loadGame } from "@/games/client";
import type { ThemePack } from "@/themes/types";

/** A live thumbnail: the real engine, played by its bot for a few seconds, then frozen. */
export function GameThumb({ gameId, theme, label }: { gameId: string; theme: ThemePack; label: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!;
    let raf = 0;
    let cancelled = false;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      const { def, createRenderer } = await loadGame(gameId);
      if (cancelled) return;
      const r = createRenderer(canvas, theme);
      const game = def.create(4242, { ticker: theme.coin.ticker });
      // Fast-forward so the frame shows play in progress.
      for (let i = 0; i < 240 && !game.done; i++) {
        game.step(def.bot ? def.bot(game.view(), game.frame) : { x: 0, y: 0, b: 0 });
      }
      r.draw(game.view(), 16);
      if (reduce) return;
      let frames = 0;
      const tick = () => {
        if (cancelled || frames++ > 60 * 6 || game.done) return;
        game.step(def.bot ? def.bot(game.view(), game.frame) : { x: 0, y: 0, b: 0 });
        r.onEvents(game.events, game.view());
        r.draw(game.view(), 16);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    });
    io.observe(canvas);
    return () => {
      cancelled = true;
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [gameId, theme]);
  return (
    <div className="grid h-full w-full place-items-center overflow-hidden" style={{ background: theme.palette.bg }}>
      <canvas ref={ref} role="img" aria-label={label} className="block h-full w-full object-contain" style={{ imageRendering: "pixelated" }} />
    </div>
  );
}
