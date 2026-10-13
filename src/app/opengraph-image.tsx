import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BRAND } from "@/brand";
import { THEMES } from "@/themes";

export const alt = `${BRAND.name}: ${BRAND.tagline}`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

function Px({ grid, colors, px }: { grid: string[]; colors: Record<string, string>; px: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {grid.map((row, y) => (
        <div key={y} style={{ display: "flex", height: px }}>
          {row.split("").map((c, x) => (
            <div key={x} style={{ width: px, height: px, background: c === "." ? "transparent" : colors[c] }} />
          ))}
        </div>
      ))}
    </div>
  );
}

export default async function OgImage() {
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [bold, pixel] = await Promise.all([readFile(path.join(dir, "BricolageGrotesque-800.ttf")), readFile(path.join(dir, "Silkscreen-Regular.ttf"))]);
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", background: "#fff6e9", color: "#1a1033", padding: 64, fontFamily: "B" }}>
        <div style={{ display: "flex", fontFamily: "S", fontSize: 34 }}>{BRAND.name.toUpperCase()}</div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: 92, fontWeight: 800, lineHeight: 0.95, letterSpacing: -3 }}>
          <div style={{ display: "flex" }}>Classic games,</div>
          <div style={{ display: "flex" }}>
            re-skinned for&nbsp;<span style={{ background: "#ffc83d", padding: "0 12px", borderRadius: 18 }}>your coin.</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 24 }}>
          {THEMES.map((t) => (
            <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 14, background: t.palette.primary, border: "4px solid #1a1033", borderRadius: 22, padding: "10px 18px 10px 10px", boxShadow: "6px 6px 0 #1a1033" }}>
              <Px grid={t.mascot.idle} colors={t.pixels} px={5} />
              <div style={{ display: "flex", fontFamily: "S", fontSize: 26 }}>${t.coin.ticker}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: "B", data: bold, weight: 800, style: "normal" },
        { name: "S", data: pixel, weight: 400, style: "normal" },
      ],
    },
  );
}
