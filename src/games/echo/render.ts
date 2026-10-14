// Echo Pads renderer: chunky coin pads in a diamond around the mascot (later
// Space and X bars join), pads glow and pop with rings when lit, the mascot
// watches the lit pad, a countdown ring wraps the mascot on your turn, and
// progress dots show how far through the sequence you are.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CENTER, H, INTRO, LAYOUTS, PRESS, W, type EchoView, type Pad } from "./index.ts";

const TAU = Math.PI * 2;

interface Ring { x: number; y: number; r: number; life: number; max: number; color: string; w: number }
interface Banner { text: string; sub: string; life: number; max: number; color: string }
interface Disp { x: number; y: number; w: number; h: number; kind: Pad["kind"]; a: number }

function parseHex(c: string): [number, number, number] {
  let h = c.replace("#", "");
  if (h.length === 3) h = h.split("").map((ch) => ch + ch).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return [128, 128, 128];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  const m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}
function rgba(c: string, a: number): string {
  const [r, g, b] = parseHex(c);
  return `rgba(${r},${g},${b},${a})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<EchoView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length >= 4 ? p.bricks : [p.primary, p.secondary, p.accent, p.wall, p.primary, p.secondary];
  const padColor = (i: number) => bricks[i % bricks.length];
  const glyph = (theme.coin.ticker || theme.coin.name || "$").slice(0, 1).toUpperCase();

  let t = 0;
  let rings: Ring[] = [];
  let banner: Banner | null = null;
  const light = [0, 0, 0, 0, 0, 0]; // 0..1 glow per pad
  const pop = [0, 0, 0, 0, 0, 0]; // scale kick per pad
  const wrong = [0, 0, 0, 0, 0, 0]; // wobble after a wrong press
  const disp: Disp[] = LAYOUTS[2].map((q, i) => ({ ...q, a: i < 4 ? 1 : 0 }));
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let squash = 0;
  let lookX = 0;
  let lookY = 0;
  let heartPulse = 0;
  let lastLayout = 0;
  for (let i = 0; i < 4; i++) Object.assign(disp[i], LAYOUTS[0][i]);

  // ---------- helpers ----------
  function circle(x: number, y: number, r: number, fill: string) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.arc(x, y, Math.max(0, r), 0, TAU);
    ctx.fill();
  }
  function heart(x: number, y: number, s: number, fill: string) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const path = () => {
      ctx.beginPath();
      ctx.moveTo(0, 4);
      ctx.bezierCurveTo(-7, -1, -5, -7, 0, -3);
      ctx.bezierCurveTo(5, -7, 7, -1, 0, 4);
      ctx.closePath();
    };
    ctx.lineWidth = 2.5 / s;
    ctx.strokeStyle = p.ink;
    path();
    ctx.stroke();
    ctx.fillStyle = fill;
    path();
    ctx.fill();
    ctx.restore();
  }
  function arrow(x: number, y: number, dir: number, s: number, color: string) {
    // dir: 0 up, 1 right, 2 down, 3 left
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((dir * Math.PI) / 2);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s, s * 0.55);
    ctx.lineTo(-s, s * 0.55);
    ctx.closePath();
    ctx.fillStyle = p.ink;
    ctx.translate(1, 1);
    ctx.fill();
    ctx.translate(-1, -1);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
  }

  function drawPad(i: number, d: Disp, v: EchoView) {
    if (d.a <= 0.01) return;
    const c = padColor(i);
    const L = light[i];
    const wob = wrong[i] > 0 ? Math.sin(wrong[i] * 0.06) * wrong[i] * 0.02 : 0;
    const s = d.a * (1 + 0.08 * L + pop[i] * 0.12);
    const x = d.x + wob;
    const y = d.y + (L > 0 ? 0 : Math.sin(t / 700 + i * 1.7) * 1.2);
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    const hw = d.w / 2;
    const hh = d.h / 2;

    // Glow
    if (L > 0.02) {
      const gr = ctx.createRadialGradient(0, 0, Math.min(hw, hh) * 0.6, 0, 0, Math.max(hw, hh) + 34);
      gr.addColorStop(0, rgba(c, 0.55 * L));
      gr.addColorStop(1, rgba(c, 0));
      ctx.fillStyle = gr;
      ctx.fillRect(-hw - 40, -hh - 40, d.w + 80, d.h + 80);
    }
    // Drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    if (d.kind === "coin") ctx.ellipse(0, hh * 0.86 + 6, hw * 0.86, 9, 0, 0, TAU);
    else ctx.roundRect(-hw + 4, -hh + 8, d.w - 8, d.h, 22);
    ctx.fill();

    const face = mix(c, p.ink, (1 - L) * 0.42);
    const rim = mix(c, p.ink, 0.55 + (1 - L) * 0.15);
    const hi = mix(c, "#ffffff", 0.35 + L * 0.4);
    if (d.kind === "coin") {
      const r = hw;
      circle(0, 0, r + 2.5, p.ink);
      circle(0, 0, r, rim);
      circle(0, -2, r - 6, face);
      // inner ring + ridges
      ctx.strokeStyle = rgba(L > 0.3 ? "#ffffff" : c, 0.35 + L * 0.3);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, -2, r - 14, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = rgba(p.ink, 0.35);
      ctx.lineWidth = 2;
      for (let k = 0; k < 24; k++) {
        const a = (k / 24) * TAU;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * (r - 1.5), Math.sin(a) * (r - 1.5));
        ctx.lineTo(Math.cos(a) * (r - 5), Math.sin(a) * (r - 5));
        ctx.stroke();
      }
      // shine
      ctx.fillStyle = rgba("#ffffff", 0.18 + L * 0.35);
      ctx.beginPath();
      ctx.ellipse(-r * 0.32, -r * 0.42, r * 0.32, r * 0.13, -0.6, 0, TAU);
      ctx.fill();
      // embossed glyph
      ctx.font = `bold ${Math.round(r * 0.8)}px ${kit.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = rgba(p.ink, 0.45);
      ctx.fillText(glyph, 2, 2);
      ctx.fillStyle = L > 0.3 ? "#ffffff" : hi;
      ctx.fillText(glyph, 0, 0);
      // key arrow at the outer edge
      const ox = [0, 1, 0, -1][i];
      const oy = [-1, 0, 1, 0][i];
      arrow(ox * (r - 15), oy * (r - 15) - 2, i, 6, L > 0.3 ? "#ffffff" : rgba(p.text, 0.75));
    } else {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(-hw - 2.5, -hh - 2.5, d.w + 5, d.h + 5, hh);
      ctx.fill();
      ctx.fillStyle = rim;
      ctx.beginPath();
      ctx.roundRect(-hw, -hh, d.w, d.h, hh - 2);
      ctx.fill();
      ctx.fillStyle = face;
      ctx.beginPath();
      ctx.roundRect(-hw + 6, -hh + 4, d.w - 12, d.h - 12, hh - 8);
      ctx.fill();
      ctx.fillStyle = rgba("#ffffff", 0.18 + L * 0.35);
      ctx.fillRect(-hw + hh * 0.6, -hh + 9, d.w - hh * 1.2, 4);
      // small coins + key label
      const label = i === 4 ? "SPACE" : "X";
      for (const sx of [-1, 1]) {
        const cx = sx * (hw - hh * 0.62);
        circle(cx, -2, 13, p.ink);
        circle(cx, -2, 11, L > 0.3 ? "#ffffff" : hi);
        ctx.font = `bold 12px ${kit.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = mix(c, p.ink, 0.5);
        ctx.fillText(glyph, cx, -1);
      }
      kit.text(label, 0, -2, label.length > 1 ? 14 : 20, L > 0.3 ? "#ffffff" : p.text);
    }
    // Wrong press: ink cross
    if (wrong[i] > 0) {
      ctx.globalAlpha = Math.min(1, wrong[i] / 300);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 9;
      ctx.lineCap = "round";
      const k = Math.min(hw, hh) * 0.45;
      ctx.beginPath();
      ctx.moveTo(-k, -k);
      ctx.lineTo(k, k);
      ctx.moveTo(k, -k);
      ctx.lineTo(-k, k);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineCap = "butt";
    }
    ctx.restore();
    void v;
  }

  function drawMascot(v: EchoView, dtMs: number) {
    const c = { x: lerpC.x, y: lerpC.y };
    const size = v.layout === 0 ? 68 : 58;
    // Countdown ring on your turn
    const rr = size * 0.66 + 4;
    circle(c.x, c.y + 3, rr + 6, rgba(p.ink, 0.45));
    if (v.phase === "input" && v.timeMax > 0) {
      const f = v.timeLeft / v.timeMax;
      const low = f < 0.3;
      const blink = low && Math.floor(t / 120) % 2 === 0;
      ctx.lineCap = "round";
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rr, 0, TAU);
      ctx.stroke();
      ctx.strokeStyle = blink ? "#ffffff" : low ? p.accent : p.primary;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rr, -Math.PI / 2, -Math.PI / 2 + TAU * f);
      ctx.stroke();
      ctx.lineCap = "butt";
    } else {
      ctx.strokeStyle = rgba(p.text, 0.18);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(c.x, c.y, rr, 0, TAU);
      ctx.stroke();
    }
    // Look toward the lit pad
    let tx = 0, ty = 0;
    const focus = v.lit >= 0 ? v.lit : v.press.t < PRESS ? v.press.pad : -1;
    if (focus >= 0 && disp[focus]) {
      const dx = disp[focus].x - c.x;
      const dy = disp[focus].y - c.y;
      const m = Math.hypot(dx, dy) || 1;
      tx = (dx / m) * 6;
      ty = (dy / m) * 6;
    }
    const k = Math.min(1, dtMs / 90);
    lookX += (tx - lookX) * k;
    lookY += (ty - lookY) * k;
    squash = Math.max(0, squash - dtMs / 220);
    let m = mood;
    if (v.phase === "over") m = "sad";
    else if (v.phase === "won") m = "happy";
    const sprite = m === "happy" ? kit.sprites.happy : m === "sad" ? kit.sprites.sad : kit.sprites.idle;
    const bob = m === "happy" ? -Math.abs(Math.sin(t / 110)) * 6 : Math.sin(t / 420) * 2;
    const sw = size * (1 + squash * 0.18);
    const sh = size * (1 - squash * 0.14);
    ctx.drawImage(sprite, Math.round(c.x - sw / 2 + lookX), Math.round(c.y - sh / 2 + bob + lookY + (size - sh) / 2), sw, sh);
  }

  const lerpC = { x: CENTER[0].x, y: CENTER[0].y };

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        const pad = typeof e.pad === "number" ? (e.pad as number) : -1;
        if (e.t === "flash" && pad >= 0) {
          pop[pad] = 1;
          const d = disp[pad];
          rings.push({ x: d.x, y: d.y, r: Math.min(d.w, d.h) / 2, life: 0, max: 450, color: padColor(pad), w: 4 });
          kit.fx.burst(d.x, d.y, padColor(pad), 6, 90, 0);
        } else if (e.t === "tap" && pad >= 0) {
          pop[pad] = 1;
          squash = 1;
          const d = disp[pad];
          rings.push({ x: d.x, y: d.y, r: Math.min(d.w, d.h) / 2, life: 0, max: 380, color: "#ffffff", w: 3 });
          kit.fx.burst(d.x, d.y, padColor(pad), 10, 140, 200);
        } else if (e.t === "yourTurn") {
          banner = { text: "YOUR TURN", sub: "", life: 0, max: 700, color: p.primary };
        } else if (e.t === "clear") {
          mood = "happy";
          moodT = 900;
          const n = e.value as number;
          kit.fx.popup(lerpC.x, lerpC.y - 52, `+${n}`, p.primary);
          for (let i = 0; i < 4; i++) kit.fx.burst(lerpC.x, lerpC.y, bricks[i % bricks.length], 8, 200, 260);
          rings.push({ x: lerpC.x, y: lerpC.y, r: 30, life: 0, max: 600, color: p.primary, w: 5 });
        } else if (e.t === "miss") {
          mood = "sad";
          moodT = 1400;
          kit.fx.addShake(e.saved ? 8 : 12);
          kit.fx.flash();
          if (pad >= 0) {
            wrong[pad] = 900;
            const d = disp[pad];
            kit.fx.burst(d.x, d.y, p.ink, 14, 180);
          }
          // Show the pad that was wanted.
          const want = e.want as number | undefined;
          if (typeof want === "number" && want !== pad && disp[want]) {
            light[want] = 1;
            const d = disp[want];
            rings.push({ x: d.x, y: d.y, r: Math.min(d.w, d.h) / 2, life: 0, max: 700, color: "#ffffff", w: 5 });
          }
          banner = e.saved
            ? { text: e.why === "timeout" ? "TOO SLOW!" : "OOPS!", sub: "SECOND CHANCE USED", life: 0, max: 1300, color: p.accent }
            : { text: e.why === "timeout" ? "TOO SLOW!" : "WRONG PAD!", sub: "", life: 0, max: 1600, color: p.accent };
        } else if (e.t === "heart") {
          heartPulse = 1;
          banner = { text: "SECOND CHANCE", sub: "ONE MISTAKE FORGIVEN", life: 0, max: 1500, color: p.accent };
          for (let i = 0; i < 3; i++) kit.fx.burst(W / 2, 64, p.accent, 8, 160, 200);
        } else if (e.t === "layout") {
          const np = e.pads as number;
          banner = { text: "NEW PAD!", sub: np === 5 ? "SPACE BAR JOINS" : "X BAR JOINS", life: 0, max: 1500, color: p.secondary };
          kit.fx.addShake(6);
        } else if (e.t === "won") {
          mood = "happy";
          moodT = 99999;
          banner = { text: "TOTAL RECALL!", sub: "", life: 0, max: 99999, color: p.primary };
          for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * W, H * 0.5, bricks[i % bricks.length], 12, 240);
        } else if (e.t === "go") {
          banner = { text: "WATCH", sub: "THEN REPEAT", life: 0, max: 800, color: p.text };
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);

      // Pad lights and transitions
      for (let i = 0; i < 6; i++) {
        const on = v.lit === i || (v.press.pad === i && v.press.t < PRESS && v.press.ok);
        if (on) light[i] = 1;
        else light[i] = Math.max(0, light[i] - dtMs / 220);
        pop[i] = Math.max(0, pop[i] - dtMs / 160);
        wrong[i] = Math.max(0, wrong[i] - dtMs);
        const target = v.pads[i];
        const d = disp[i];
        const k = Math.min(1, dtMs / 140);
        if (target) {
          d.x += (target.x - d.x) * k;
          d.y += (target.y - d.y) * k;
          d.w += (target.w - d.w) * k;
          d.h += (target.h - d.h) * k;
          d.a += (1 - d.a) * k;
        } else d.a += (0 - d.a) * k;
      }
      if (v.layout !== lastLayout) {
        lastLayout = v.layout;
        // New pads grow out of the mascot.
        for (let i = 4; i < v.pads.length; i++) if (disp[i].a < 0.05) { disp[i].x = v.center.x; disp[i].y = v.center.y; }
      }
      const kc = Math.min(1, dtMs / 140);
      lerpC.x += (v.center.x - lerpC.x) * kc;
      lerpC.y += (v.center.y - lerpC.y) * kc;
      if (moodT > 0) {
        moodT -= dtMs;
        if (moodT <= 0) mood = "idle";
      }

      // Header: round + heart
      kit.text(`ROUND ${v.round}`, W / 2, 34, 20, p.text);
      if (v.heartGiven) {
        heartPulse = Math.max(0, heartPulse - dtMs / 900);
        const hs = 1.6 + heartPulse * 1.2 + (v.hearts > 0 ? Math.sin(t / 260) * 0.08 : 0);
        heart(W / 2, 66, hs, v.hearts > 0 ? p.accent : rgba(p.text, 0.25));
      } else if (v.round < 10) {
        ctx.globalAlpha = 0.6;
        kit.text(`SECOND CHANCE AT ROUND 10`, W / 2, 64, 9, p.text);
        ctx.globalAlpha = 1;
      }

      // Pads (extra bars first so the diamond overlaps nicely)
      for (let i = 5; i >= 0; i--) drawPad(i, disp[i], v);
      drawMascot(v, dtMs);

      // Rings
      rings = rings.filter((r) => (r.life += dtMs) < r.max);
      for (const r of rings) {
        const f = r.life / r.max;
        ctx.globalAlpha = 1 - f;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.w * (1 - f) + 1;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r + f * 40, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // Status line
      let status = "";
      let sc = p.text;
      if (v.phase === "intro") status = v.phaseT < INTRO / 2 ? "GET READY" : "GET SET";
      else if (v.phase === "watch" || v.phase === "show") status = "WATCH" + ".".repeat(1 + (Math.floor(t / 300) % 3));
      else if (v.phase === "input") { status = "YOUR TURN"; sc = p.primary; }
      else if (v.phase === "good") { status = "NICE!"; sc = p.primary; }
      else if (v.phase === "miss") { status = "AGAIN FROM THE TOP"; sc = p.accent; }
      else if (v.phase === "over") { status = `GAME OVER · BEST ${v.best}`; sc = p.accent; }
      else if (v.phase === "won") { status = "YOU REMEMBERED IT ALL"; sc = p.primary; }
      kit.text(status, W / 2, 552, 15, sc);

      // Progress dots
      const n = v.seq.length;
      const gap = Math.min(16, 328 / Math.max(1, n));
      const r = Math.max(2, Math.min(5.5, gap / 2 - 1));
      const x0 = W / 2 - ((n - 1) * gap) / 2;
      const done = v.phase === "show" ? v.idx + 1 : v.phase === "input" ? v.idx : v.phase === "good" || v.phase === "won" ? n : 0;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * gap;
        circle(x, 580, r + 1.5, p.ink);
        const filled = i < done;
        const reveal = v.phase === "show" || v.phase === "good" || v.phase === "won" || v.phase === "over";
        circle(x, 580, r, filled ? (reveal ? padColor(v.seq[i]) : p.primary) : rgba(p.text, 0.18));
      }

      // Banner
      if (banner) {
        banner.life += dtMs;
        if (banner.life >= banner.max) banner = null;
        else {
          const f = banner.life / banner.max;
          const inA = Math.min(1, banner.life / 120);
          const outA = Math.min(1, (banner.max - banner.life) / 250);
          ctx.globalAlpha = Math.min(inA, outA);
          const s = 1 + (1 - inA) * 0.4;
          const by = 104 - f * 4;
          ctx.fillStyle = rgba(p.ink, 0.6);
          ctx.beginPath();
          ctx.roundRect(W / 2 - 150, by - 22, 300, banner.sub ? 52 : 40, 10);
          ctx.fill();
          ctx.save();
          ctx.translate(W / 2, by - 2);
          ctx.scale(s, s);
          kit.text(banner.text, 0, 0, 22, banner.color);
          ctx.restore();
          if (banner.sub) kit.text(banner.sub, W / 2, by + 20, 10, p.text);
          ctx.globalAlpha = 1;
        }
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
