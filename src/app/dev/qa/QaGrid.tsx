"use client";
import { useEffect, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { loadGame } from "@/games/client";
import { GAMES } from "@/games/registry";
import { THEMES } from "@/themes";
import type { ThemePack } from "@/themes/types";

function Cell({ id, theme, frames }: { id: string; theme: ThemePack; frames: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let off = false;
    loadGame(id).then(({ def, createRenderer }) => {
      if (off) return;
      const r = createRenderer(ref.current!, theme);
      const g = def.create(99, { ticker: theme.coin.ticker });
      for (let i = 0; i < frames && !g.done; i++) {
        g.step(def.bot ? def.bot(g.view(), g.frame) : { x: 0, y: 0, b: 0 });
        if (i > frames - 30) r.onEvents(g.events, g.view());
      }
      for (let k = 0; k < 3; k++) r.draw(g.view(), 16);
    });
    return () => {
      off = true;
    };
  }, [id, theme, frames]);
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={ref} style={{ width: "100%", height: 260, objectFit: "contain", background: theme.palette.bg, imageRendering: "pixelated" }} />
      <figcaption style={{ font: "12px monospace" }}>{id} · {theme.id} · {frames}f</figcaption>
    </figure>
  );
}

export function QaGrid() {
  const sp = useSearchParams();
  const only = sp.get("game");
  const frames = Number(sp.get("frames") ?? 900);
  const games = GAMES.filter((g) => !only || g.id === only);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12, padding: 12 }}>
      {games.flatMap((g) => THEMES.map((t) => <Cell key={`${g.id}-${t.id}`} id={g.id} theme={t} frames={frames} />))}
    </div>
  );
}
