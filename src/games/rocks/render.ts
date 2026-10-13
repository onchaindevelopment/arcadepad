// Rock Blaster renderer: mascot cockpit ship, lumpy palette rocks, bear drone,
// thrust flames, explosions and a parallax star field. Visual only (may use
// Math.random/sin/cos; the engine never does).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { H, W, type RockV, type RocksView } from "./index.ts";

const TAU = Math.PI * 2;
const byteToRad = (a: number) => (a / 256) * TAU;

/** Darken a #rrggbb colour. */
function shade(hex: string, f: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const c = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * f)));
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

/** Deterministic lumpy outline per rock shape id (unit radius). */
const shapeCache = new Map<number, number[]>();
function rockShape(shape: number, size: number): number[] {
  const key = shape * 4 + size;
  let pts = shapeCache.get(key);
  if (pts) return pts;
  let s = shape * 2654435761 >>> 0;
  const rnd = () => ((s = (Math.imul(s ^ (s >>> 15), 2246822519) + 0x9e3779b9) >>> 0) / 4294967296);
  const n = size === 0 ? 11 : size === 1 ? 9 : 7;
  pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + (rnd() - 0.5) * 0.35;
    const r = 0.78 + rnd() * 0.3;
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  shapeCache.set(key, pts);
  return pts;
}

interface Flame { x: number; y: number; vx: number; vy: number; life: number; max: number; c: string; s: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<RocksView> {
  const kit = makeKit(canvas, theme, W, H);
  const p = theme.palette;
  const { ctx } = kit;
  let t = 0;
  let banner = 0;
  let bannerText = "";
  const flames: Flame[] = [];
  const stars = Array.from({ length: 90 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    z: 0.2 + Math.random() * 0.8,
    tw: Math.random() * TAU,
  }));
  const rockColor = (r: RockV) => p.bricks[r.shape % p.bricks.length] ?? p.secondary;

  function drawRock(r: RockV, frame: number) {
    const pts = rockShape(r.shape, r.size);
    const rot = byteToRad(r.spin * frame * 0.25 + (r.shape & 255));
    const col = rockColor(r);
    const offs: [number, number][] = [[0, 0]];
    if (r.x < r.r) offs.push([W, 0]);
    if (r.x > W - r.r) offs.push([-W, 0]);
    if (r.y < r.r) offs.push([0, H]);
    if (r.y > H - r.r) offs.push([0, -H]);
    for (const [ox, oy] of offs) {
      ctx.save();
      ctx.translate(r.x + ox, r.y + oy);
      ctx.rotate(rot);
      const path = () => {
        ctx.beginPath();
        for (let i = 0; i < pts.length; i += 2) {
          const x = pts[i] * r.r, y = pts[i + 1] * r.r;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
      };
      path();
      ctx.fillStyle = col;
      ctx.fill();
      ctx.lineJoin = "round";
      ctx.lineWidth = r.size === 0 ? 4 : 3;
      ctx.strokeStyle = shade(col, 0.45);
      ctx.stroke();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = p.ink;
      ctx.stroke();
      // Craters + highlight
      ctx.fillStyle = shade(col, 0.7);
      const cr = r.r * 0.22;
      ctx.beginPath();
      ctx.arc(r.r * 0.25, r.r * 0.15, cr, 0, TAU);
      ctx.arc(-r.r * 0.3, -r.r * 0.25, cr * 0.7, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.beginPath();
      ctx.arc(-r.r * 0.35, r.r * 0.25, cr * 0.5, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawShip(v: RocksView) {
    const s = v.ship;
    if (!s.alive) return;
    if (s.invuln > 0 && Math.floor(s.invuln / 6) % 2 === 0) return; // blink
    const a = byteToRad(s.angle);
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(a);
    // Chunky hull: nose to the right (angle 0 = +x), two fins at the back.
    ctx.beginPath();
    ctx.moveTo(22, 0);
    ctx.lineTo(4, -12);
    ctx.lineTo(-10, -16);
    ctx.lineTo(-8, -6);
    ctx.lineTo(-13, 0);
    ctx.lineTo(-8, 6);
    ctx.lineTo(-10, 16);
    ctx.lineTo(4, 12);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = p.ink;
    ctx.stroke();
    ctx.fillStyle = p.primary;
    ctx.fill();
    ctx.fillStyle = p.secondary;
    ctx.fillRect(-11, -15, 6, 4);
    ctx.fillRect(-11, 11, 6, 4);
    // Cockpit bubble
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.bg2;
    ctx.beginPath();
    ctx.arc(0, 0, 9.5, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Mascot stays upright in the cockpit.
    const m = 18;
    ctx.drawImage(kit.sprites.mini, Math.round(s.x - m / 2), Math.round(s.y - m / 2), m, m);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(s.x - 6, s.y - 8, 4, 2);
  }

  function drawDrone(d: { x: number; y: number; dir: number }) {
    const bob = Math.sin(t / 150) * 1.5;
    ctx.save();
    ctx.translate(d.x, d.y + bob);
    ctx.lineWidth = 2;
    ctx.strokeStyle = p.ink;
    // Rotor arms
    const spin = (t / 40) % TAU;
    for (const sx of [-14, 14]) {
      ctx.fillStyle = p.ink;
      ctx.fillRect(sx - 1, -14, 2, 6);
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      const w = Math.abs(Math.cos(spin + sx)) * 9 + 2;
      ctx.fillRect(sx - w, -15, w * 2, 2);
    }
    // Saucer skirt
    ctx.fillStyle = p.secondary;
    ctx.beginPath();
    ctx.ellipse(0, 4, 18, 6, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
    // Bear head: ears, face, snout
    ctx.fillStyle = p.accent;
    for (const ex of [-8, 8]) {
      ctx.beginPath();
      ctx.arc(ex, -8, 4.5, 0, TAU);
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -1, 10, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.text;
    ctx.beginPath();
    ctx.ellipse(0, 3, 5, 3.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.fillRect(-1.5, 1, 3, 2);
    // Angry eyes looking the way it flies
    const lx = d.dir * 1.5;
    ctx.fillRect(-5 + lx, -4, 2.5, 2.5);
    ctx.fillRect(3 + lx, -4, 2.5, 2.5);
    ctx.fillRect(-6 + lx, -6, 4, 1);
    ctx.fillRect(2.5 + lx, -6, 4, 1);
    // Blinking lights
    ctx.fillStyle = Math.floor(t / 200) % 2 ? p.primary : "#ffffff";
    ctx.fillRect(-14, 4, 3, 2);
    ctx.fillRect(11, 4, 3, 2);
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[], v: RocksView) {
      for (const e of events) {
        const x = e.x ?? W / 2, y = e.y ?? H / 2;
        switch (e.t) {
          case "split":
          case "rockgone": {
            const big = (e.size as number) === 0;
            kit.fx.burst(x, y, p.bricks[(e.shape as number) % p.bricks.length] ?? p.accent, big ? 18 : 12, big ? 150 : 120, 0);
            kit.fx.burst(x, y, p.text, 6, 90, 0);
            if (e.points) kit.fx.popup(x, y - 8, `+${e.points as number}`, p.primary);
            if (big) kit.fx.addShake(3);
            break;
          }
          case "explode":
            kit.fx.burst(x, y, p.accent, 26, 200, 0);
            kit.fx.burst(x, y, p.secondary, 16, 140, 0);
            kit.fx.addShake(6);
            if (e.points) kit.fx.popup(x, y - 12, `+${e.points as number}`, p.accent);
            break;
          case "lost":
            kit.fx.burst(x, y, p.primary, 30, 220, 0);
            kit.fx.burst(x, y, "#ffffff", 14, 160, 0);
            kit.fx.addShake(10);
            kit.fx.flash();
            break;
          case "hyper":
            kit.fx.burst(e.fromX as number, e.fromY as number, p.secondary, 14, 160, 0);
            kit.fx.burst(x, y, p.primary, 14, 100, 0);
            break;
          case "extralife":
            kit.fx.popup(x, y - 20, "1UP!", p.primary);
            kit.fx.flash("255,255,255");
            break;
          case "levelclear":
            bannerText = "WAVE CLEAR!";
            banner = 1200;
            break;
          case "wave":
            bannerText = `WAVE ${e.wave as number}`;
            banner = 1200;
            break;
          case "shot":
            flames.push({ x: v.ship.x, y: v.ship.y, vx: 0, vy: 0, life: 0, max: 80, c: "#ffffff", s: 4 });
            break;
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);

      // Parallax stars drifting against the ship's motion.
      for (const st of stars) {
        st.x -= v.ship.vx * st.z * 0.3;
        st.y -= v.ship.vy * st.z * 0.3;
        if (st.x < 0) st.x += W; else if (st.x >= W) st.x -= W;
        if (st.y < 0) st.y += H; else if (st.y >= H) st.y -= H;
        ctx.globalAlpha = st.z * (0.55 + 0.45 * Math.sin(t / 400 + st.tw));
        ctx.fillStyle = st.z > 0.8 ? p.accent : p.text;
        const sz = st.z > 0.7 ? 2 : 1;
        ctx.fillRect(Math.round(st.x), Math.round(st.y), sz, sz);
      }
      ctx.globalAlpha = 1;

      for (const r of v.rocks) drawRock(r, v.frame);

      // Thrust flame particles
      const s = v.ship;
      if (s.alive && s.thrust) {
        const a = byteToRad(s.angle);
        const bx = s.x - Math.cos(a) * 13, by = s.y - Math.sin(a) * 13;
        for (let i = 0; i < 3; i++) {
          const sp = 60 + Math.random() * 80, j = (Math.random() - 0.5) * 0.7;
          flames.push({
            x: bx, y: by,
            vx: -Math.cos(a + j) * sp + s.vx * 60, vy: -Math.sin(a + j) * sp + s.vy * 60,
            life: 0, max: 180 + Math.random() * 160,
            c: [p.accent, p.primary, "#ffffff"][i % 3], s: 2 + Math.random() * 3,
          });
        }
      }
      for (let i = flames.length - 1; i >= 0; i--) {
        const f = flames[i];
        f.life += dtMs;
        if (f.life >= f.max) { flames.splice(i, 1); continue; }
        f.x += (f.vx * dtMs) / 1000;
        f.y += (f.vy * dtMs) / 1000;
        const k = 1 - f.life / f.max;
        ctx.globalAlpha = k;
        ctx.fillStyle = f.c;
        const sz = f.s * (0.5 + k * 0.5);
        ctx.fillRect(f.x - sz / 2, f.y - sz / 2, sz, sz);
      }
      ctx.globalAlpha = 1;

      // Bullets
      for (const b of v.bullets) {
        ctx.fillStyle = p.ink;
        ctx.fillRect(b.x - 3, b.y - 3, 6, 6);
        ctx.fillStyle = p.primary;
        ctx.fillRect(b.x - 2, b.y - 2, 4, 4);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(b.x - 1, b.y - 1, 2, 2);
      }
      for (const b of v.enemyBullets) {
        const pulse = 3 + Math.sin(t / 60) * 1;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(b.x, b.y, pulse + 1.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.arc(b.x, b.y, pulse, 0, TAU);
        ctx.fill();
      }

      if (v.drone) drawDrone(v.drone);
      drawShip(v);

      // Pointer aim marker
      if (v.pointerAim) {
        const { x, y } = v.pointerAim;
        ctx.strokeStyle = p.text;
        ctx.globalAlpha = 0.6;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, 7 + Math.sin(t / 120) * 1.5, 0, TAU);
        ctx.moveTo(x - 11, y); ctx.lineTo(x - 4, y);
        ctx.moveTo(x + 4, y); ctx.lineTo(x + 11, y);
        ctx.moveTo(x, y - 11); ctx.lineTo(x, y - 4);
        ctx.moveTo(x, y + 4); ctx.lineTo(x, y + 11);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }

      // Lives as mini ships
      for (let i = 0; i < Math.min(v.lives, 8); i++) ctx.drawImage(kit.sprites.mini, W - 22 - i * 18, 8, 14, 14);

      if (banner > 0) {
        banner -= dtMs;
        ctx.globalAlpha = Math.min(1, banner / 300);
        kit.text(bannerText, W / 2, H / 2 - 40, 24, p.primary);
        ctx.globalAlpha = 1;
      }
      if (v.frame < 150 && v.score === 0) kit.text("ARROWS + SPACE, OR TAP TO AIM & FIRE", W / 2, H - 20, 11, p.text);
      kit.fx.draw(kit, dtMs);
    },
  };
}
