// Hex Spin renderer: rotating six-slice backdrop that cycles through the
// coin palette per stage, trapezoid walls closing in on a pulsing core,
// and the coin mascot orbiting it. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { ANG, BEAT, CORE_R, CX, CY, FIELD_H, FIELD_W, PR, SECTORS, SECTOR_U, STAGE_FRAMES, type HexView } from "./index.ts";

const TAU = Math.PI * 2;
const FAR = 560; // beyond the field corners

function rgbOf(c: string): [number, number, number] {
  if (c.startsWith("rgb")) {
    const m = (c.match(/\d+/g) ?? ["0", "0", "0"]).map(Number);
    return [m[0], m[1], m[2]];
  }
  let h = c.slice(1);
  if (h.length === 3) h = h.split("").map((x) => x + x).join("");
  const n = parseInt(h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = rgbOf(a);
  const y = rgbOf(b);
  const k = Math.max(0, Math.min(1, t));
  return `rgb(${Math.round(x[0] + (y[0] - x[0]) * k)},${Math.round(x[1] + (y[1] - x[1]) * k)},${Math.round(x[2] + (y[2] - x[2]) * k)})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<HexView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const p = theme.palette;
  const { ctx } = kit;
  const cols = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  let t = 0;
  let banner = { text: "", life: 0 };
  let flipKick = 0;
  let bumpKick = 0;
  let deathT = 0;
  let shownStage = 0;
  let stageBlend = 1; // 0..1 blend from the previous stage colour
  let prevCol = cols[0];

  const rad = (u: number) => (u / ANG) * TAU;
  const stageCol = (s: number) => cols[s % cols.length];

  /** Point at hexagon "radius" r (apothem-free: vertices at sector edges) and world angle u. */
  const pt = (u: number, r: number): [number, number] => [CX + Math.cos(rad(u)) * r, CY + Math.sin(rad(u)) * r];

  function hexPath(rot: number, r: number) {
    ctx.beginPath();
    for (let i = 0; i < SECTORS; i++) {
      const [x, y] = pt(rot + i * SECTOR_U, r);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  function trapezoid(rot: number, s: number, r0: number, r1: number) {
    const u0 = rot + s * SECTOR_U;
    const u1 = u0 + SECTOR_U;
    const a = pt(u0, r0), b = pt(u1, r0), c = pt(u1, r1), d = pt(u0, r1);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.lineTo(c[0], c[1]);
    ctx.lineTo(d[0], d[1]);
    ctx.closePath();
  }

  return {
    onEvents(events: readonly GameEvent[], v: HexView) {
      for (const e of events) {
        if (e.t === "stage") {
          banner = { text: String(e.name).toUpperCase(), life: 1600 };
          kit.fx.flash("255,255,255");
          for (let i = 0; i < 3; i++) kit.fx.burst(CX, CY, cols[(v.stage + i) % cols.length], 14, 220, 0);
        } else if (e.t === "flip") {
          flipKick = e.surge ? 1 : 0.6;
        } else if (e.t === "bump") {
          bumpKick = 1;
          kit.fx.burst(e.x!, e.y!, p.text, 6, 90, 0);
        } else if (e.t === "die") {
          deathT = 1;
          kit.fx.addShake(12);
          kit.fx.flash();
          kit.fx.burst(e.x!, e.y!, p.accent, 26, 220, 120);
          kit.fx.burst(e.x!, e.y!, stageCol(v.stage), 18, 160, 120);
        } else if (e.t === "won") {
          for (let i = 0; i < 8; i++) kit.fx.burst(CX, CY, cols[i % cols.length], 14, 260, 0);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);
      if (v.stage !== shownStage) {
        prevCol = stageCol(shownStage);
        shownStage = v.stage;
        stageBlend = 0;
      }
      stageBlend = Math.min(1, stageBlend + dtMs / 900);
      const col = mix(prevCol, stageCol(v.stage), stageBlend);
      // Palette cycling: the two backdrop slice colours walk through the coin colours.
      const cyc = (v.frame / (BEAT * 4)) % cols.length;
      const ci = Math.floor(cyc);
      const cyc1 = mix(cols[ci], cols[(ci + 1) % cols.length], cyc - ci);
      const cyc2 = mix(cols[(ci + 3) % cols.length], cols[(ci + 4) % cols.length], cyc - ci);

      const beat = Math.max(0, 1 - v.beatT / 10);
      const pulse = 1 + 0.06 * beat * beat + 0.04 * flipKick;
      flipKick = Math.max(0, flipKick - dtMs / 400);
      bumpKick = Math.max(0, bumpKick - dtMs / 200);
      if (deathT > 0) deathT = Math.min(3, deathT + dtMs / 1000);
      const rot = v.rot;

      // --- backdrop slices
      for (let s = 0; s < SECTORS; s++) {
        trapezoid(rot, s, 0, FAR);
        ctx.fillStyle = s % 2 === 0 ? mix(p.bg, cyc1, 0.16 + 0.08 * beat) : mix(p.bg2, cyc2, 0.1);
        ctx.globalAlpha = 0.85;
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      // Spokes
      ctx.strokeStyle = mix(p.bg2, col, 0.35);
      ctx.lineWidth = 1;
      for (let s = 0; s < SECTORS; s++) {
        const [x, y] = pt(rot + s * SECTOR_U, FAR);
        ctx.beginPath();
        ctx.moveTo(CX, CY);
        ctx.lineTo(x, y);
        ctx.stroke();
      }
      // Orbit guide
      hexPath(rot, PR * pulse);
      ctx.strokeStyle = mix(p.bg2, col, 0.45);
      ctx.setLineDash([3, 5]);
      ctx.stroke();
      ctx.setLineDash([]);

      // --- walls
      const wallOuter = mix(col, "#ffffff", 0.15);
      for (const w of v.walls) {
        const r0 = Math.max(CORE_R - 4, w.d) * pulse;
        const r1 = Math.min(FAR, w.d + w.th) * pulse;
        if (r1 <= r0 || r0 > FAR) continue;
        trapezoid(rot, w.s, r0, r1);
        ctx.fillStyle = p.ink;
        ctx.fill();
        trapezoid(rot, w.s, r0 + 1.5, r1 - 1.5);
        ctx.fillStyle = col;
        ctx.fill();
        // bright inner lip (the edge that hits)
        trapezoid(rot, w.s, r0 + 1.5, Math.min(r1 - 1.5, r0 + 4));
        ctx.fillStyle = wallOuter;
        ctx.fill();
      }

      // --- core
      const coreR = CORE_R * pulse;
      hexPath(rot, coreR + 3);
      ctx.fillStyle = p.ink;
      ctx.fill();
      hexPath(rot, coreR);
      ctx.fillStyle = mix(p.bg2, col, 0.25 + 0.3 * beat);
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = col;
      ctx.stroke();
      // Stage progress around the core
      const prog = v.stageT / STAGE_FRAMES;
      ctx.beginPath();
      ctx.arc(CX, CY, coreR - 9, -Math.PI / 2, -Math.PI / 2 + prog * TAU);
      ctx.lineWidth = 4;
      ctx.strokeStyle = p.text;
      ctx.globalAlpha = 0.7;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1;
      kit.text(String(v.stage + 1), CX, CY + 1, 14, p.text);

      // --- mascot
      const pu = v.pa + rot;
      const [mx, my] = pt(pu, PR * pulse);
      if (v.turning !== 0 && !v.dead && Math.random() < 0.6) {
        const [tx, ty] = pt(pu - v.turning * 40, PR * pulse);
        kit.fx.burst(tx, ty, cols[(v.frame >> 2) % cols.length], 1, 30, 0);
      }
      // Glow + pointer nub facing outward
      const [nx, ny] = pt(pu, PR * pulse + 15);
      ctx.fillStyle = p.text;
      ctx.beginPath();
      const [lx, ly] = pt(pu - 22, PR * pulse + 9);
      const [rx, ry] = pt(pu + 22, PR * pulse + 9);
      ctx.moveTo(nx, ny);
      ctx.lineTo(lx, ly);
      ctx.lineTo(rx, ry);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.arc(mx, my, 13 + 2 * beat, 0, TAU);
      ctx.fillStyle = mix(p.ink, col, 0.35);
      ctx.globalAlpha = 0.6;
      ctx.fill();
      ctx.globalAlpha = 1;
      const sprite = v.dead ? kit.sprites.sad : v.stageT < 60 && v.stage > 0 ? kit.sprites.happy : kit.sprites.mini;
      const sz = (v.dead ? 30 + 10 * Math.min(1, deathT) : 22) + 3 * bumpKick;
      const wob = bumpKick * Math.sin(t / 20) * 2;
      ctx.drawImage(sprite, mx - sz / 2 + wob, my - sz / 2, sz, sz);

      kit.fx.draw(kit, dtMs);

      // --- overlay text (unshaken)
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      const secs = `${Math.floor(v.score / 10)}.${v.score % 10}`;
      kit.text(secs, CX, 34, 26, p.text);
      kit.text(v.stageName.toUpperCase(), CX, 60, 11, col);
      if (banner.life > 0) {
        banner.life -= dtMs;
        const a = Math.min(1, banner.life / 400);
        const grow = 1 + 0.3 * Math.max(0, (banner.life - 1300) / 300);
        ctx.globalAlpha = a;
        kit.text(banner.text, CX, 150, Math.round(28 * grow), p.text);
        ctx.globalAlpha = 1;
      }
      if (v.frame < 200 && !v.dead) {
        ctx.globalAlpha = Math.min(1, (200 - v.frame) / 40);
        kit.text("LEFT / RIGHT TO ORBIT", CX, FIELD_H - 52, 12, p.text);
        kit.text("TOUCH: HOLD LEFT OR RIGHT SIDE", CX, FIELD_H - 34, 10, p.text);
        ctx.globalAlpha = 1;
      }
      if (v.dead) kit.text(`SURVIVED ${secs}s`, CX, FIELD_H - 60, 16, p.text);
    },
  };
}
