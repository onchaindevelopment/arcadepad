// Build a full ThemePack from a few creator inputs (used by the self-serve skin builder).
import type { ThemePack } from "./types.ts";
import glorp from "./packs/glorp.json";
import nubbin from "./packs/nubbin.json";
import wobbl from "./packs/wobbl.json";

export const SOUND_STYLES = {
  squishy: { label: "Squishy space", from: glorp as ThemePack },
  squeaky: { label: "Squeaky candy", from: nubbin as ThemePack },
  bubbly: { label: "Bubbly ocean", from: wobbl as ThemePack },
} as const;
export type SoundStyle = keyof typeof SOUND_STYLES;

export interface SkinInput {
  name: string;
  ticker: string;
  chain: ThemePack["coin"]["chain"];
  /** 16x16 grid + colours, e.g. from pixelateImage(). */
  mascot: { grid: string[]; pixels: Record<string, string> };
  colors: { bg: string; primary: string; secondary: string; accent: string };
  dark: boolean;
  sound: SoundStyle;
}

const clampHex = (h: string) => (/^#[0-9a-f]{6}$/i.test(h) ? h.toUpperCase() : "#888888");

function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("").toUpperCase();
}

/** 12x12 head for the ball/icon: nearest-neighbour downscale of the 16x16 grid. */
export function miniFromGrid(grid: string[]): string[] {
  const out: string[] = [];
  for (let y = 0; y < 12; y++) {
    let row = "";
    for (let x = 0; x < 12; x++) row += grid[Math.floor((y * 16) / 12)]?.[Math.floor((x * 16) / 12)] ?? ".";
    out.push(row);
  }
  return out;
}

/** Simple "mood" variants: happy bounces up a pixel, sad droops down one. */
function shift(grid: string[], dy: number): string[] {
  const blank = ".".repeat(16);
  return grid.map((_, y) => grid[y - dy] ?? blank);
}

export function sanitizeTickerInput(t: string): string {
  return t.toUpperCase().replace(/^\$/, "").replace(/[^A-Z0-9]/g, "").slice(0, 6) || "COIN";
}

export function buildTheme(input: SkinInput): ThemePack {
  const base = SOUND_STYLES[input.sound].from;
  const bg = clampHex(input.colors.bg);
  const primary = clampHex(input.colors.primary);
  const secondary = clampHex(input.colors.secondary);
  const accent = clampHex(input.colors.accent);
  const ink = input.dark ? mix(bg, "#000000", 0.55) : "#1A1033";
  const text = input.dark ? "#F7F3FF" : "#1A1033";
  const ticker = sanitizeTickerInput(input.ticker);
  const name = input.name.trim().slice(0, 24) || ticker;
  const grid = input.mascot.grid;
  return {
    id: `custom-${ticker.toLowerCase()}`,
    coin: { name, ticker, chain: input.chain, fictional: false },
    game: { title: `${name} Breakout`, tagline: `${name}'s own arcade.` },
    palette: {
      bg,
      bg2: mix(bg, primary, input.dark ? 0.18 : 0.12),
      ink,
      text,
      primary,
      secondary,
      accent,
      wall: mix(bg, secondary, 0.35),
      bricks: [primary, secondary, accent, mix(primary, accent, 0.5), mix(secondary, "#FFFFFF", 0.3), mix(primary, "#FFFFFF", 0.35)],
    },
    pixels: input.mascot.pixels,
    mascot: { name, idle: grid, blink: grid, happy: shift(grid, -1), sad: shift(grid, 1), mini: miniFromGrid(grid) },
    backdrop: base.backdrop,
    sfx: base.sfx,
    music: base.music,
    copy: {
      start: `${name} is ready.`,
      levelClear: [`${ticker} TO THE MOON.`, "Cleared!", "Next level."],
      lifeLost: ["Ouch.", "Shake it off.", "Again!"],
      gameOver: ["GG.", `${name} needs a break.`, "One more run?"],
      won: `${name} cleared it all.`,
    },
  };
}

/**
 * Turn an image into a 16x16 pixel mascot with up to `maxColors` colours (browser only).
 * Transparent or near-background pixels become '.'.
 */
export async function pixelateImage(file: Blob, maxColors = 6): Promise<{ grid: string[]; pixels: Record<string, string> }> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement("canvas");
  c.width = 16;
  c.height = 16;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  // Fit the image into a square, centred.
  const s = Math.min(bmp.width, bmp.height);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 16, 16);
  const data = ctx.getImageData(0, 0, 16, 16).data;
  // Background guess: the corner colour when the image has no transparency.
  const corner = [data[0], data[1], data[2], data[3]];
  const px: ([number, number, number] | null)[] = [];
  for (let i = 0; i < 256; i++) {
    const [r, g, b, a] = [data[i * 4], data[i * 4 + 1], data[i * 4 + 2], data[i * 4 + 3]];
    const nearCorner = corner[3] > 200 && Math.abs(r - corner[0]) + Math.abs(g - corner[1]) + Math.abs(b - corner[2]) < 36;
    px.push(a < 100 || nearCorner ? null : [r, g, b]);
  }
  // k-means palette (deterministic init from evenly spaced opaque pixels).
  const opaque = px.filter((p): p is [number, number, number] => !!p);
  if (!opaque.length) return { grid: Array(16).fill(".".repeat(16)), pixels: {} };
  const k = Math.min(maxColors, opaque.length);
  let centers = Array.from({ length: k }, (_, i) => opaque[Math.floor((i * opaque.length) / k)].slice() as [number, number, number]);
  const nearest = (p: [number, number, number]) => {
    let best = 0;
    let bd = Infinity;
    centers.forEach((c2, i) => {
      const d = (p[0] - c2[0]) ** 2 + (p[1] - c2[1]) ** 2 + (p[2] - c2[2]) ** 2;
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return best;
  };
  for (let it = 0; it < 8; it++) {
    const sums = centers.map(() => [0, 0, 0, 0]);
    for (const p of opaque) {
      const n = nearest(p);
      sums[n][0] += p[0];
      sums[n][1] += p[1];
      sums[n][2] += p[2];
      sums[n][3]++;
    }
    centers = centers.map((c2, i) => (sums[i][3] ? [sums[i][0] / sums[i][3], sums[i][1] / sums[i][3], sums[i][2] / sums[i][3]] : c2)) as [number, number, number][];
  }
  const chars = "abcdefgh";
  const pixels: Record<string, string> = {};
  centers.forEach((c2, i) => (pixels[chars[i]] = "#" + c2.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()));
  const grid: string[] = [];
  for (let y = 0; y < 16; y++) {
    let row = "";
    for (let x = 0; x < 16; x++) {
      const p = px[y * 16 + x];
      row += p ? chars[nearest(p)] : ".";
    }
    grid.push(row);
  }
  // Ink outline around the sprite so it reads on any background.
  pixels.k = "#1A1033";
  const out = grid.map((r) => r.split(""));
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (grid[y][x] !== ".") continue;
      const n = [grid[y - 1]?.[x], grid[y + 1]?.[x], grid[y][x - 1], grid[y][x + 1]];
      if (n.some((v) => v && v !== ".")) out[y][x] = "k";
    }
  return { grid: out.map((r) => r.join("")), pixels };
}

/** Dominant colours of a pixel mascot, most frequent first (for "match my mascot" colours). */
export function dominantColors(m: { grid: string[]; pixels: Record<string, string> }): string[] {
  const count: Record<string, number> = {};
  for (const row of m.grid) for (const ch of row) if (ch !== "." && ch !== "k") count[ch] = (count[ch] ?? 0) + 1;
  return Object.entries(count)
    .sort((a, b) => b[1] - a[1])
    .map(([ch]) => m.pixels[ch])
    .filter(Boolean);
}
