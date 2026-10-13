import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BRAND } from "@/brand";
import { getTheme } from "@/themes";
import { store } from "@/lib/store";
import { shortAddress } from "@/lib/session";
import type { Grid } from "@/themes/pixel";

const fontDir = path.join(process.cwd(), "assets", "fonts");
const fonts = Promise.all([
  readFile(path.join(fontDir, "BricolageGrotesque-800.ttf")),
  readFile(path.join(fontDir, "BricolageGrotesque-500.ttf")),
  readFile(path.join(fontDir, "Silkscreen-Regular.ttf")),
]);

function Pixels({ grid, colors, px }: { grid: Grid; colors: Record<string, string>; px: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {grid.map((row, y) => {
        const runs: { c: string; n: number }[] = [];
        for (const ch of row) {
          const last = runs[runs.length - 1];
          if (last && last.c === ch) last.n++;
          else runs.push({ c: ch, n: 1 });
        }
        return (
          <div key={y} style={{ display: "flex", height: px }}>
            {runs.map((r, i) => (
              <div key={i} style={{ width: r.n * px, height: px, background: r.c === "." ? "transparent" : colors[r.c] }} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

// 1200x630 share card for a replay-verified score.
export async function GET(req: Request, ctx: RouteContext<"/api/card/[id]">) {
  const { id } = await ctx.params;
  const s = await store.getScore(id);
  const theme = s && getTheme(s.theme);
  if (!s || !theme) return new Response("Not found", { status: 404 });

  const rank = await store.rankOf(s);
  const [bold, medium, pixel] = await fonts;
  const p = theme.palette;
  const download = new URL(req.url).searchParams.has("download");

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: `linear-gradient(135deg, ${p.bg} 0%, ${p.bg2} 100%)`, color: p.text, fontFamily: "Bricolage" }}>
        <div style={{ display: "flex", height: 34, gap: 6, padding: "12px 12px 0" }}>
          {Array.from({ length: 16 }, (_, i) => (
            <div key={i} style={{ flex: 1, background: p.bricks[i % p.bricks.length], borderRadius: 4, border: `3px solid ${p.ink}` }} />
          ))}
        </div>
        <div style={{ display: "flex", flex: 1, padding: "36px 64px 40px", gap: 56, alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 360, height: 360, borderRadius: 40, background: p.bg2, border: `6px solid ${p.ink}`, boxShadow: `14px 14px 0 ${p.ink}` }}>
            <Pixels grid={s.status === "won" ? theme.mascot.happy : theme.mascot.idle} colors={theme.pixels} px={18} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            <div style={{ display: "flex", fontFamily: "Silk", fontSize: 30, color: p.primary, letterSpacing: 2 }}>
              ${theme.coin.ticker} · {theme.game.title.toUpperCase()}
            </div>
            <div style={{ display: "flex", fontSize: 168, fontWeight: 800, lineHeight: 1, letterSpacing: -6, marginTop: 8 }}>{s.score.toLocaleString("en-US")}</div>
            <div style={{ display: "flex", gap: 16, marginTop: 22, fontSize: 30, fontWeight: 500 }}>
              <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: p.secondary, color: "#fff", border: `3px solid ${p.ink}` }}>Level {s.level + 1}</div>
              {rank ? <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: p.accent, color: p.ink, border: `3px solid ${p.ink}` }}>Rank #{rank}</div> : null}
              {s.status === "won" ? <div style={{ display: "flex", padding: "8px 18px", borderRadius: 999, background: p.primary, color: p.ink, border: `3px solid ${p.ink}` }}>Cleared!</div> : null}
            </div>
            <div style={{ display: "flex", marginTop: 26, fontSize: 28, fontWeight: 500, opacity: 0.85 }}>{s.wallet ? shortAddress(s.wallet) : "Guest run"}</div>
          </div>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0 64px 34px", fontSize: 24 }}>
          <div style={{ display: "flex", fontFamily: "Silk", fontSize: 28 }}>{BRAND.name.toUpperCase()}</div>
          <div style={{ display: "flex", fontWeight: 500, opacity: 0.8 }}>Score verified by server replay{theme.coin.fictional ? " · fictional demo coin" : ""}</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      fonts: [
        { name: "Bricolage", data: bold, weight: 800, style: "normal" },
        { name: "Bricolage", data: medium, weight: 500, style: "normal" },
        { name: "Silk", data: pixel, weight: 400, style: "normal" },
      ],
      headers: {
        "Cache-Control": "public, max-age=300",
        ...(download ? { "Content-Disposition": `attachment; filename="${theme.coin.ticker.toLowerCase()}-score-${s.score}.png"` } : {}),
      },
    },
  );
}
