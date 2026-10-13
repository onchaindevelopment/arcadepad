"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Game, runLevels } from "@/engine";
import { FIELD_W, STEP_MS, type GameView } from "@/engine/types";
import { THEMES } from "@/themes";
import { Renderer } from "@/game/renderer";
import { Mascot } from "./Mascot";

const SKIN_MS = 11000;

/** Bot input: follow the lowest falling ball, with a little lead so it angles shots. */
function botX(v: GameView, frame: number): number {
  let best = null as null | { x: number; y: number };
  for (const b of v.balls) if (!best || b.y > best.y) best = b;
  const wobble = Math.sin(frame / 50) * v.paddle.w * 0.3;
  return Math.max(0, Math.min(FIELD_W, Math.round((best ? best.x : FIELD_W / 2) + wobble)));
}

// Hero demo: the real engine played by a bot, cycling through the demo skins.
export function AttractScreen() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const theme = THEMES[i];

  useEffect(() => {
    const canvas = canvasRef.current!;
    const renderer = new Renderer(canvas, theme);
    const game = new Game({ seed: (Date.now() & 0xffff) + i, levels: runLevels(theme.coin.ticker) });
    let view = game.view();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) {
      renderer.draw(view, 16);
      return;
    }
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(boxRef.current!);
    let raf = 0;
    let last = 0;
    let acc = 0;
    let elapsed = 0;
    const tick = (t: number) => {
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
        if (game.done) break;
        view = game.step({ x: botX(view, view.frame), fire: true });
        renderer.events(view.events);
      }
      renderer.draw(view, dt);
      if (elapsed > SKIN_MS || game.done) {
        cancelAnimationFrame(raf);
        setI((n) => (n + 1) % THEMES.length);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [i, theme]);

  const p = theme.palette;
  return (
    <div ref={boxRef} className="relative">
      <div className="slab relative rotate-[1.2deg] p-3 transition-colors duration-500" style={{ background: p.ink }}>
        <div className="mb-2.5 flex items-center justify-between px-2">
          <span className="pixel text-sm" style={{ color: p.primary }}>
            ${theme.coin.ticker} · {theme.game.title.toUpperCase()}
          </span>
          <span className="pixel flex items-center gap-1.5 text-[0.65rem]" style={{ color: "#FFF8EE" }}>
            <span className="h-2 w-2 animate-pulse rounded-full" style={{ background: p.secondary }} aria-hidden /> DEMO
          </span>
        </div>
        <div className="crt overflow-hidden rounded-[14px]">
          <canvas ref={canvasRef} className="block aspect-[4/3] h-auto w-full" style={{ imageRendering: "pixelated" }} role="img" aria-label={`Demo: ${theme.game.title} playing itself in the ${theme.coin.ticker} skin`} />
        </div>
        <div className="mt-2.5 flex items-center justify-between gap-2 px-2">
          <div className="flex gap-1.5" role="tablist" aria-label="Demo skins">
            {THEMES.map((t, k) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={k === i}
                aria-label={`Show ${t.coin.ticker} skin`}
                onClick={() => setI(k)}
                className="h-3 rounded-full border-2 transition-all"
                style={{ width: k === i ? 28 : 12, background: k === i ? t.palette.primary : "transparent", borderColor: t.palette.primary }}
              />
            ))}
          </div>
          <Link href={`/play/${theme.id}`} className="btn btn-sm" style={{ background: p.primary }}>
            ▶ Play ${theme.coin.ticker}
          </Link>
        </div>
      </div>
      <div className="slab absolute -right-4 -top-10 hidden h-24 w-24 rotate-6 place-items-center sm:grid" style={{ background: p.primary }} aria-hidden>
        <Mascot theme={theme} size={72} />
      </div>
    </div>
  );
}
