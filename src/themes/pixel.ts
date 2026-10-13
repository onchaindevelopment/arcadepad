// Pixel-grid sprites: rows of chars, each char maps to a colour in the pack.

export type Grid = string[];

export function gridSize(g: Grid): { w: number; h: number } {
  return { w: g[0]?.length ?? 0, h: g.length };
}

export function validateGrid(g: Grid, w: number, h: number, name: string): string[] {
  const errs: string[] = [];
  if (g.length !== h) errs.push(`${name}: ${g.length} rows, expected ${h}`);
  g.forEach((row, i) => {
    if (row.length !== w) errs.push(`${name}: row ${i} has ${row.length} cols, expected ${w}`);
  });
  return errs;
}

/** SVG markup for a grid, merging horizontal runs into single rects. */
export function gridToSvg(g: Grid, colors: Record<string, string>, scale = 1, title?: string): string {
  const { w, h } = gridSize(g);
  let rects = "";
  g.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const c = row[x];
      let n = 1;
      while (x + n < row.length && row[x + n] === c) n++;
      if (c !== "." && colors[c]) rects += `<rect x="${x}" y="${y}" width="${n}" height="1" fill="${colors[c]}"/>`;
      x += n;
    }
  });
  const t = title ? `<title>${title}</title>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w * scale}" height="${h * scale}" shape-rendering="crispEdges" role="img">${t}${rects}</svg>`;
}

export function gridToDataUrl(g: Grid, colors: Record<string, string>): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(gridToSvg(g, colors))}`;
}

/** Pre-render a grid to an offscreen canvas for fast drawImage in the game loop. */
export function gridToCanvas(g: Grid, colors: Record<string, string>, scale = 1): HTMLCanvasElement {
  const { w, h } = gridSize(g);
  const c = document.createElement("canvas");
  c.width = w * scale;
  c.height = h * scale;
  const ctx = c.getContext("2d")!;
  g.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = colors[row[x]];
      if (row[x] !== "." && col) {
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  });
  return c;
}
