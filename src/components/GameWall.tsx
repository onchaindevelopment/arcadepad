"use client";
import { useEffect, useRef } from "react";
import { loadGame } from "@/games/client";
import { STEP_MS } from "@/games/core/types";
import { THEMES } from "@/themes";

// Light, colourful games that read well as a moving wall (no heavy CPU opponents).
const WALL = ["breakout", "invaders", "pinball", "maze", "bubbles", "snake", "swarm", "slope", "blocks", "flap", "defense", "lanes"];

/**
 * Hero backdrop: a tilted wall of live game screens, each played by its own bot and
 * restarted when it ends. Runs only while visible; frozen frames for reduced motion.
 */
export function GameWall() {
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current!;
    const canvases = [...box.querySelectorAll("canvas")];
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let cancelled = false;
    let raf = 0;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(box);

    type Tile = { step: () => void; draw: (dt: number) => void; shown: () => boolean };
    const tiles: Tile[] = [];

    Promise.all(
      canvases.map(async (canvas, i) => {
        const id = WALL[i % WALL.length];
        const theme = THEMES.filter((t) => t.id !== "nubbin")[i % 2];
        const { def, createRenderer } = await loadGame(id);
        if (cancelled) return;
        const r = createRenderer(canvas, theme);
        let seed = 1000 + i * 77;
        let g = def.create(seed, { ticker: theme.coin.ticker });
        const bot = () => (def.bot ? def.bot(g.view(), g.frame) : { x: 0, y: 0, b: 0 });
        // Start each tile at a different point so the wall isn't in sync.
        for (let k = 0; k < 120 + i * 37 && !g.done; k++) g.step(bot());
        r.draw(g.view(), 16);
        tiles.push({
          step() {
            if (g.done) g = def.create(++seed, { ticker: theme.coin.ticker });
            g.step(bot());
          },
          draw: (dt) => r.draw(g.view(), dt),
          shown: () => canvas.offsetParent !== null,
        });
      }),
    ).then(() => {
      if (cancelled || reduce) return;
      let last = 0;
      let acc = 0;
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
        let steps = 0;
        while (acc >= STEP_MS && steps < 3) {
          acc -= STEP_MS;
          steps++;
          for (const tile of tiles) if (tile.shown()) tile.step();
        }
        if (acc > STEP_MS * 3) acc = 0;
        for (const tile of tiles) if (tile.shown()) tile.draw(dt);
      };
      raf = requestAnimationFrame(tick);
    });

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-1/2 grid w-[170vw] grid-cols-3 gap-3 [transform:translate(-50%,-50%)_perspective(1400px)_rotateX(22deg)_rotateZ(-8deg)] sm:w-[140vw] sm:grid-cols-4 sm:gap-4 lg:w-[120vw]">
        {WALL.map((id, i) => (
          <div key={id} className={`crt aspect-[4/3] overflow-hidden rounded-xl bg-[#111] ${i >= 9 ? "hidden sm:block" : ""}`}>
            <canvas className="block h-full w-full object-cover" style={{ imageRendering: "pixelated" }} />
          </div>
        ))}
      </div>
      {/* Dim, dot-matrix screen, vignette */}
      <div className="absolute inset-0 bg-black/55" />
      <div className="dots absolute inset-0 opacity-70" />
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_45%,rgba(0,0,0,0.55),transparent_70%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_bottom,#000_0%,transparent_22%,transparent_70%,#000_100%)]" />
    </div>
  );
}
