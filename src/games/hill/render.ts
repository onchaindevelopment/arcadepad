// Hill Rider renderer: parallax hills, grassy road, spinning coins, fuel
// cans and a little buggy with the coin mascot at the wheel. All colours come
// from the coin theme (plus ink and white). Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { FIELD_H, FIELD_W, HEAD_R, PX_PER_M, WHEEL_R, type HillView } from "./index.ts";

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}
function shade(hex: string, k: number): string {
  // k < 0 darkens toward black, k > 0 lightens toward white.
  const [r, g, b] = hexRgb(hex);
  const f = (c: number) => Math.round(k < 0 ? c * (1 + k) : c + (255 - c) * k);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<HillView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  let t = 0;
  let camX = 0, camY = 0;
  let camReady = false;
  let lastFrame = -1;
  let happyMs = 0;
  let dustMs = 0;
  const clouds = Array.from({ length: 7 }, (_, i) => ({ x: Math.random() * FIELD_W * 2, y: 20 + Math.random() * 110, s: 0.6 + Math.random() * 0.8, i }));

  const sx = (x: number) => x - camX;
  const sy = (y: number) => y - camY;

  function farHill(x: number, seed: number, amp: number): number {
    return Math.sin(x * 0.004 + seed) * amp + Math.sin(x * 0.011 + seed * 1.7) * amp * 0.45 + Math.sin(x * 0.027 + seed * 0.3) * amp * 0.15;
  }

  function drawParallax() {
    // Clouds drift slowly with the camera.
    for (const c of clouds) {
      const x = ((((c.x - camX * 0.08 * c.s) % (FIELD_W + 160)) + FIELD_W + 160) % (FIELD_W + 160)) - 80;
      const y = c.y - camY * 0.03;
      ctx.fillStyle = "rgba(255,255,255,0.07)";
      ctx.beginPath();
      ctx.ellipse(x, y, 34 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 16 * c.s, y - 6 * c.s, 18 * c.s, 8 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    const layers: [number, number, number, number, string][] = [
      [0.15, 0.05, 210, 46, rgba(p.secondary, 0.22)],
      [0.35, 0.12, 250, 34, rgba(p.wall, 0.55)],
    ];
    for (const [k, ky, base, amp, color] of layers) {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, FIELD_H);
      const off = camX * k;
      const yb = base - camY * ky;
      for (let x = 0; x <= FIELD_W + 8; x += 8) ctx.lineTo(x, yb + farHill(x + off, k * 10, amp));
      ctx.lineTo(FIELD_W, FIELD_H);
      ctx.closePath();
      ctx.fill();
    }
  }

  function drawTerrain(v: HillView) {
    const { x0, step, ys } = v.terrain;
    const i0 = Math.max(0, Math.floor((camX - 16 - x0) / step));
    const i1 = Math.min(ys.length - 1, Math.ceil((camX + FIELD_W + 16 - x0) / step));
    if (i1 <= i0) return;
    const path = (dy: number) => {
      ctx.beginPath();
      ctx.moveTo(sx(x0 + i0 * step), FIELD_H + 20);
      for (let i = i0; i <= i1; i++) ctx.lineTo(sx(x0 + i * step), sy(ys[i]) + dy);
      ctx.lineTo(sx(x0 + i1 * step), FIELD_H + 20);
      ctx.closePath();
    };
    // Dirt body with darker bands.
    const top = Math.min(...ys.slice(i0, i1 + 1).map((y) => sy(y)));
    const g = ctx.createLinearGradient(0, top, 0, FIELD_H + 40);
    g.addColorStop(0, shade(p.wall, 0.1));
    g.addColorStop(1, shade(p.wall, -0.45));
    ctx.fillStyle = g;
    path(0);
    ctx.fill();
    ctx.fillStyle = rgba(p.ink, 0.18);
    path(26);
    ctx.fill();
    ctx.fillStyle = rgba(p.ink, 0.18);
    path(60);
    ctx.fill();
    // Pebbles in the dirt (stable per world x).
    for (let i = i0 - (i0 % 3); i <= i1; i += 3) {
      if (i < 0) continue;
      const wx = x0 + i * step;
      const k = Math.sin(wx * 12.9898) * 43758.5453;
      const r = k - Math.floor(k);
      if (r > 0.45) continue;
      ctx.fillStyle = rgba(p.ink, 0.25);
      ctx.fillRect(Math.round(sx(wx) + r * 6), Math.round(sy(ys[i]) + 12 + r * 50), 3, 2);
    }
    // Grass edge: ink outline under a bright lip.
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = i0; i <= i1; i++) {
      const X = sx(x0 + i * step), Y = sy(ys[i]);
      if (i === i0) ctx.moveTo(X, Y);
      else ctx.lineTo(X, Y);
    }
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 9;
    ctx.stroke();
    ctx.strokeStyle = p.primary;
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1.5;
    ctx.save();
    ctx.translate(0, -1.5);
    ctx.stroke();
    ctx.restore();
    // Distance posts every 50 m.
    const every = 50 * PX_PER_M;
    const first = Math.ceil((camX - 20) / every) * every;
    for (let wx = first; wx < camX + FIELD_W + 20; wx += every) {
      const i = Math.round((wx - x0) / step);
      if (i < 0 || i >= ys.length) continue;
      const m = Math.round((wx - 120) / PX_PER_M);
      if (m <= 0) continue;
      const X = sx(wx), Y = sy(ys[i]);
      ctx.fillStyle = p.ink;
      ctx.fillRect(X - 2, Y - 34, 4, 34);
      kit.block(X - 17, Y - 48, 34, 16, p.secondary, 3);
      kit.text(`${m}m`, X, Y - 40, 8, p.text);
    }
  }

  function drawItems(v: HillView) {
    for (const it of v.items) {
      const X = sx(it.x), Y = sy(it.y) + Math.sin(t / 260 + it.x * 0.05) * 2;
      if (X < -30 || X > FIELD_W + 30) continue;
      if (it.kind === "fuel") {
        ctx.save();
        ctx.translate(X, Y);
        ctx.rotate(Math.sin(t / 300 + it.x) * 0.12);
        kit.block(-10, -12, 20, 24, p.accent, 3);
        ctx.fillStyle = p.ink;
        ctx.fillRect(-6, -17, 7, 6);
        ctx.fillRect(3, -16, 4, 4);
        kit.text("F", 0, 1, 12, p.text);
        ctx.restore();
        // Glow ring so it reads from afar.
        ctx.strokeStyle = rgba(p.accent, 0.35 + 0.25 * Math.sin(t / 150));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(X, Y, 19, 0, Math.PI * 2);
        ctx.stroke();
      } else {
        const big = it.kind === "bigcoin";
        const r = big ? 10 : 7;
        const sxk = Math.max(0.15, Math.abs(Math.cos(t / 220 + it.x * 0.03)));
        ctx.save();
        ctx.translate(X, Y);
        ctx.scale(sxk, 1);
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(0, 0, r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = big ? p.primary : p.accent;
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = rgba(p.ink, 0.25);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "rgba(255,255,255,0.55)";
        ctx.fillRect(-r * 0.5, -r * 0.6, r * 0.45, 2);
        ctx.restore();
        if (big && sxk > 0.6) ctx.drawImage(kit.sprites.mini, X - 6, Y - 6, 12, 12);
      }
    }
  }

  function drawWheel(x: number, y: number, spin: number) {
    const X = sx(x), Y = sy(y);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(X, Y, WHEEL_R + 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = shade(p.wall, -0.55);
    ctx.beginPath();
    ctx.arc(X, Y, WHEEL_R - 1, 0, Math.PI * 2);
    ctx.fill();
    // Tread blocks
    ctx.fillStyle = p.ink;
    for (let k = 0; k < 8; k++) {
      const a = spin + (k * Math.PI) / 4;
      ctx.fillRect(X + Math.cos(a) * (WHEEL_R - 1.5) - 1.5, Y + Math.sin(a) * (WHEEL_R - 1.5) - 1.5, 3, 3);
    }
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(X, Y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    for (let k = 0; k < 3; k++) {
      const a = spin + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(X, Y);
      ctx.lineTo(X + Math.cos(a) * 5, Y + Math.sin(a) * 5);
      ctx.stroke();
    }
    ctx.fillStyle = p.ink;
    ctx.fillRect(X - 1.5, Y - 1.5, 3, 3);
  }

  function drawCar(v: HillView) {
    const [r, f] = v.body;
    const ang = Math.atan2(f.y - r.y, f.x - r.x);
    const mx = sx((r.x + f.x) / 2), my = sy((r.y + f.y) / 2);
    // Suspension struts from the frame ends to the wheels.
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (let i = 0; i < 2; i++) {
      const b = v.body[i], w = v.wheels[i];
      ctx.beginPath();
      ctx.moveTo(sx(b.x), sy(b.y));
      ctx.lineTo(sx(w.x), sy(w.y));
      ctx.stroke();
    }
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < 2; i++) {
      const b = v.body[i], w = v.wheels[i];
      ctx.beginPath();
      ctx.moveTo(sx(b.x), sy(b.y));
      ctx.lineTo(sx(w.x), sy(w.y));
      ctx.stroke();
    }
    for (let i = 0; i < 2; i++) drawWheel(v.wheels[i].x, v.wheels[i].y, v.wheels[i].spin);

    // Chassis in car space.
    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(ang);
    // Roll bar behind the driver.
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(-17, -2);
    ctx.lineTo(-15, -24);
    ctx.lineTo(-6, -26);
    ctx.stroke();
    ctx.strokeStyle = p.secondary;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Tub
    kit.block(-27, -8, 54, 14, p.secondary, 4);
    // Hood rising to the front, with a stripe
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(4, -7);
    ctx.lineTo(24, -11);
    ctx.lineTo(29, -4);
    ctx.lineTo(28, 2);
    ctx.lineTo(4, 2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.secondary;
    ctx.beginPath();
    ctx.moveTo(6, -5.5);
    ctx.lineTo(23, -9);
    ctx.lineTo(27, -3.5);
    ctx.lineTo(26.5, 0.5);
    ctx.lineTo(6, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.fillRect(-24, -2, 50, 3);
    // Headlight + exhaust
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(25, -4, 3, 3);
    ctx.fillStyle = p.ink;
    ctx.fillRect(-31, -1, 6, 4);
    // Windscreen
    ctx.fillStyle = rgba("#ffffff", 0.45);
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(3, -7);
    ctx.lineTo(8, -17);
    ctx.lineTo(10, -17);
    ctx.lineTo(7, -7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Driver: the mascot, rotated with the buggy.
    const sprite = v.crashed ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.idle;
    const s = HEAD_R * 2 + 10;
    ctx.save();
    ctx.translate(sx(v.head.x), sy(v.head.y));
    ctx.rotate(ang);
    const bob = v.airborne ? 0 : Math.sin(t / 90) * 0.6 * Math.min(1, Math.abs(v.vx) / 3);
    ctx.drawImage(sprite, -s / 2, -s / 2 + bob, s, s);
    ctx.restore();
  }

  function drawHud(v: HillView) {
    // Fuel gauge
    const x = 10, y = 10, w = 120, h = 14;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 4);
    ctx.fill();
    const low = v.fuel < 0.25;
    const on = !low || Math.floor(t / 220) % 2 === 0;
    ctx.fillStyle = low ? p.accent : p.primary;
    if (on && v.fuel > 0) {
      ctx.beginPath();
      ctx.roundRect(x + 2, y + 2, Math.max(2, (w - 4) * v.fuel), h - 4, 3);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.fillRect(x + 4, y + 3, Math.max(0, (w - 8) * v.fuel), 2);
    kit.text("FUEL", x + w + 22, y + 7, 9, low ? p.accent : p.text);
    kit.text(`${v.meters}m`, x, y + 26, 12, p.text, "left");
    kit.text(`${v.coins}`, x + 70, y + 26, 12, p.accent, "left");
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x + 62, y + 26, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(x + 62, y + 26, 3.5, 0, Math.PI * 2);
    ctx.fill();
    if (v.airborne && v.airFrames > 20) kit.text(`AIR ${(v.airFrames / 60).toFixed(1)}s`, FIELD_W / 2, 26, 12, p.primary);

    // Pedals (also the touch zones).
    const pedal = (px: number, label: string, active: boolean) => {
      ctx.globalAlpha = active ? 0.9 : 0.35;
      kit.block(px, FIELD_H - 40, 62, 30, active ? p.primary : p.wall, 6);
      kit.text(label, px + 31, FIELD_H - 25, 10, active ? p.ink : p.text);
      ctx.globalAlpha = 1;
    };
    pedal(10, "BRAKE", v.pedal < 0);
    pedal(FIELD_W - 72, "GAS", v.pedal > 0);

    if (!v.started) {
      kit.text("HOLD GAS TO GO", FIELD_W / 2, 70, 16, p.text);
      kit.text("RIGHT SIDE OR RIGHT ARROW = GAS     LEFT SIDE OR LEFT ARROW = BRAKE", FIELD_W / 2, 92, 9, p.text);
      kit.text("IN THE AIR THEY TILT THE BUGGY", FIELD_W / 2, 108, 9, p.text);
    } else if (v.fuel <= 0 && !v.over && !v.crashed) {
      kit.text("OUT OF FUEL", FIELD_W / 2, 80, 18, p.accent);
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: HillView) {
      for (const e of events) {
        const X = typeof e.wx === "number" ? sx(e.wx) : FIELD_W / 2;
        const Y = typeof e.wy === "number" ? sy(e.wy) : FIELD_H / 2;
        if (e.t === "coin") {
          kit.fx.burst(X, Y, e.big ? p.primary : p.accent, e.big ? 18 : 8, e.big ? 170 : 110);
          kit.fx.popup(X, Y - 12, `+${e.value as number}`, e.big ? p.primary : p.accent);
          if (e.big) happyMs = 700;
        } else if (e.t === "fuel") {
          kit.fx.burst(X, Y, p.accent, 22, 180);
          kit.fx.burst(X, Y, p.primary, 12, 120);
          kit.fx.popup(X, Y - 20, "FUEL!", p.primary);
          happyMs = 900;
        } else if (e.t === "flip") {
          const n = e.flips as number;
          kit.fx.popup(FIELD_W / 2, 60, `${e.back ? "BACKFLIP" : "FLIP"}${n > 1 ? ` x${n}` : ""} +${e.points as number}`, p.primary);
          for (let i = 0; i < 4; i++) kit.fx.burst(X + (i - 1.5) * 20, Y, p.bricks[i % p.bricks.length], 10, 200);
          kit.fx.flash("255,255,255");
          happyMs = 1200;
        } else if (e.t === "air") {
          kit.fx.popup(FIELD_W / 2, 86, `AIR +${e.points as number}`, p.text);
        } else if (e.t === "land") {
          kit.fx.addShake(Math.min(7, (e.impact as number) * 0.9));
          kit.fx.burst(X - 20, Y, rgba(p.wall, 1), 8, 90, 300);
          kit.fx.burst(X + 20, Y, rgba(p.wall, 1), 8, 90, 300);
        } else if (e.t === "crash") {
          kit.fx.addShake(12);
          kit.fx.flash();
          kit.fx.burst(X, Y, p.secondary, 26, 220);
          kit.fx.burst(X, Y, p.accent, 14, 160);
          kit.fx.popup(X, Y - 26, "OUCH!", p.accent);
        } else if (e.t === "milestone") {
          kit.fx.popup(FIELD_W / 2, 50, `${e.meters as number}m!`, p.primary);
          for (let i = 0; i < 3; i++) kit.fx.burst(FIELD_W * (0.25 + i * 0.25), 40, p.bricks[i % p.bricks.length], 12, 160);
        } else if (e.t === "lowfuel") {
          kit.fx.popup(FIELD_W / 2, 60, "LOW FUEL", p.accent);
        } else if (e.t === "empty") {
          kit.fx.popup(sx(v.cx), sy(v.cy) - 40, "EMPTY!", p.accent);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (happyMs > 0) happyMs -= dtMs;
      // Camera: lead in the direction of travel, ease vertically.
      const lead = Math.max(-60, Math.min(110, v.vx * 14));
      const tx = v.cx - 230 + lead;
      const ty = v.cy - 215;
      if (!camReady || v.frame < lastFrame) {
        camX = tx;
        camY = ty;
        camReady = true;
      } else {
        const k = Math.min(1, dtMs / 140);
        camX += (tx - camX) * k;
        camY += (ty - camY) * Math.min(1, dtMs / 220);
        // Never let the buggy leave the screen.
        camX = Math.max(v.cx - FIELD_W + 90, Math.min(v.cx - 90, camX));
        camY = Math.max(v.cy - FIELD_H + 70, Math.min(v.cy - 70, camY));
      }
      lastFrame = v.frame;

      kit.background(dtMs);
      drawParallax();
      drawTerrain(v);
      drawItems(v);
      drawCar(v);

      // Dust from driven wheels.
      dustMs += dtMs;
      if (dustMs > 60) {
        dustMs = 0;
        if (v.pedal !== 0 && !v.crashed) {
          for (const w of v.wheels) {
            if (!w.contact) continue;
            kit.fx.burst(sx(w.x) - 6 * v.pedal, sy(w.y) + WHEEL_R - 2, rgba(p.text, 0.6), 2, 50, 150);
          }
        }
      }

      kit.fx.draw(kit, dtMs);
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0); // HUD does not shake
      drawHud(v);
    },
  };
}
