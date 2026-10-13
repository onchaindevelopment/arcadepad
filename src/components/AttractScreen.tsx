"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { loadGame } from "@/games/client";
import { STEP_MS } from "@/games/core/types";
import type { GameMeta } from "@/games/core/types";
import { THEMES } from "@/themes";
import { Mascot } from "./Mascot";

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
      <div className="slab relative rotate-[1.2deg] p-3 transition-colors duration-500" style={{ background: p.ink }}>
        <div className="mb-2.5 flex items-center justify-between gap-2 px-2">
          <span className="pixel truncate text-sm" style={{ color: p.primary }}>
            ${theme.coin.ticker} · {game.name.toUpperCase()}
          </span>
          <span className="pixel flex shrink-0 items-center gap-1.5 text-[0.65rem]" style={{ color: "#FFF8EE" }}>
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: p.secondary }} aria-hidden /> DEMO
          </span>
        </div>
        <div className="crt grid aspect-[4/3] place-items-center overflow-hidden rounded-[14px]" style={{ background: p.bg }}>
          <canvas
            key={`${game.id}-${i}`}
            ref={canvasRef}
            className="block h-full w-full object-contain"
            style={{ imageRendering: "pixelated" }}
            role="img"
            aria-label={`Demo: ${game.name} playing itself in the ${theme.coin.ticker} skin`}
          />
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 px-2">
          <button className="pixel rounded-full border-2 px-2.5 py-1 text-[0.65rem]" style={{ color: "#FFF8EE", borderColor: p.primary }} onClick={() => setI((n) => n + 1)}>
            NEXT GAME ›
          </button>
          <Link href={`/play/${game.id}/${theme.id}`} className="btn btn-sm" style={{ background: p.primary }}>
            ▶ Play
          </Link>
        </div>
      </div>
      <div className="slab absolute -right-4 -top-10 hidden h-24 w-24 rotate-6 place-items-center sm:grid" style={{ background: p.primary }} aria-hidden>
        <Mascot theme={theme} size={72} />
      </div>
    </div>
  );
}
