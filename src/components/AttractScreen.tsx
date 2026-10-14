"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadGame } from "@/games/client";
import { STEP_MS } from "@/games/core/types";
import type { GameMeta } from "@/games/core/types";
import { THEMES } from "@/themes";

const SLOT_MS = 9000;

// Hero demo: every game played by its own bot, cycling through games and coin skins.
export function AttractScreen({ games }: { games: Pick<GameMeta, "id" | "name" | "field">[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const game = games[i % games.length];
  const theme = THEMES[i % THEMES.length];

  useEffect(() => {
    let raf = 0;
    let cancelled = false;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(boxRef.current!);
    loadGame(game.id).then(({ def, createRenderer }) => {
      if (cancelled) return;
      const r = createRenderer(canvasRef.current!, theme);
      const g = def.create(((Date.now() & 0xffff) + i) >>> 0, { ticker: theme.coin.ticker });
      const bot = () => (def.bot ? def.bot(g.view(), g.frame) : { x: 0, y: 0, b: 0 });
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        for (let k = 0; k < 300 && !g.done; k++) g.step(bot());
        r.draw(g.view(), 16);
        return;
      }
      let last = 0;
      let acc = 0;
      let elapsed = 0;
      const tick = (t: number) => {
        if (cancelled) return;
        raf = requestAnimationFrame(tick);
        if (!visible || document.hidden) {
          last = t;
          return;
        }
        const dt = Math.min(100, t - (last || t));
        last = t;
        acc += dt;
        elapsed += dt;
        while (acc >= STEP_MS) {
          acc -= STEP_MS;
          if (g.done) break;
          g.step(bot());
          if (g.events.length) r.onEvents(g.events, g.view());
        }
        r.draw(g.view(), dt);
        if (elapsed > SLOT_MS || (g.done && elapsed > 2500)) {
          cancelAnimationFrame(raf);
          setI((n) => n + 1);
        }
      };
      raf = requestAnimationFrame(tick);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [i, game.id, theme]);

  const p = theme.palette;
  return (
    <div ref={boxRef} className="relative">
      <div className="pointer-events-none absolute -inset-10 opacity-50 blur-3xl transition-colors duration-700" style={{ background: `radial-gradient(closest-side, ${p.primary}66, transparent)` }} aria-hidden />
      <div className="relative rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,#2a1156,#12062a)] p-3 shadow-[0_0_0_2px_rgba(255,210,61,0.5),0_40px_80px_-30px_rgba(0,0,0,0.9)]">
        <div className="flex items-center justify-between gap-3 px-2 pb-3 pt-1">
          <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
            <span className="h-2 w-2 shrink-0 animate-pulse rounded-full" style={{ background: p.primary, boxShadow: `0 0 10px ${p.primary}` }} aria-hidden />
            <span className="truncate">
              <span style={{ color: p.primary }}>${theme.coin.ticker}</span>
              <span className="text-dim"> · </span>
              {game.name}
            </span>
          </span>
          <span className="pixel shrink-0 text-[0.72rem] uppercase tracking-[0.16em] text-dim">Live demo</span>
        </div>
        <div className="crt screen grid aspect-[4/3] place-items-center transition-colors duration-500" style={{ background: p.bg }}>
          <canvas
            key={`${game.id}-${i}`}
            ref={canvasRef}
            className="block h-full w-full object-contain"
            style={{ imageRendering: "pixelated" }}
            role="img"
            aria-label={`Demo: ${game.name} playing itself in the ${theme.coin.ticker} skin`}
          />
        </div>
        <div className="flex items-center justify-between gap-2 px-1 pb-1 pt-3">
          <button className="btn btn-plain btn-sm" onClick={() => setI((n) => n + 1)}>
            Next game →
          </button>
          <span className="pixel blink hidden text-[0.72rem] uppercase tracking-[0.18em] text-soft sm:inline">Insert coin</span>
          <Link href={`/play/${game.id}/${theme.id}`} className="btn btn-sm">
            Play {game.name}
          </Link>
        </div>
      </div>
    </div>
  );
}
