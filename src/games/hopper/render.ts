// Coin Crossing renderer: flat top-down tiles (grass, asphalt with dashes,
// rippling water, rails), rounded vehicles with windows and wheels, logs and
// lily-coin pads, a bullet tram with warning lights, candle stumps, spinning
// coins and a squashy mascot. Every colour comes from the coin's palette
// (mixed with ink/white for shades).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  COLS, DIR_LEFT, FIELD_H, FIELD_W, LILY, PUMP_TRUCK, SCOOTER, TILE,
  laneObjects, rowTopY, tramState, type HopperView, type Row,
} from "./index.ts";

function hexRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** Mix two hex colours (t = 0 -> a, 1 -> b). */
function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a), y = hexRgb(b);
  const c = x.map((v, i) => Math.round(v + (y[i] - v) * t));
  return `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}
function rgba(hex: string, a: number): string {
  const [r, g, b] = hexRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<HopperView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const W = "#ffffff";
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const water = bricks[3 % bricks.length];
  const C = {
    grassA: mix(p.primary, p.bg, 0.55),
    grassB: mix(p.primary, p.bg, 0.62),
    road: mix(p.bg, p.ink, 0.45),
    curb: mix(p.wall, W, 0.2),
    water: mix(water, p.bg, 0.45),
    waterDeep: mix(water, p.bg, 0.6),
    gravel: mix(p.wall, p.bg, 0.45),
    tie: mix(p.wall, p.ink, 0.35),
    log: mix(p.wall, W, 0.25),
    logEnd: mix(p.wall, W, 0.5),
    lily: mix(p.primary, p.ink, 0.15),
    tram: p.secondary,
  };
  let t = 0;
  let deadMs = 0;

  function tileRow(row: Row, y: number, above: Row | undefined, below: Row | undefined, frame: number) {
    if (row.kind === "grass") {
      ctx.fillStyle = row.r % 2 ? C.grassA : C.grassB;
      ctx.fillRect(0, y, FIELD_W, TILE);
      // Tufts
      ctx.fillStyle = rgba(W, 0.12);
      for (let c = 0; c < COLS; c++) {
        const h = (row.r * 7 + c * 13) % 5;
        if (h < 2) ctx.fillRect(c * TILE + 8 + h * 9, y + 10 + h * 7, 3, 3);
      }
    } else if (row.kind === "road") {
      ctx.fillStyle = C.road;
      ctx.fillRect(0, y, FIELD_W, TILE);
      if (above?.kind === "road") {
        ctx.fillStyle = rgba(W, 0.4);
        for (let x = 6; x < FIELD_W; x += 40) ctx.fillRect(x, y - 1, 20, 2);
      } else {
        ctx.fillStyle = C.curb;
        ctx.fillRect(0, y, FIELD_W, 3);
      }
      if (below?.kind !== "road") {
        ctx.fillStyle = C.curb;
        ctx.fillRect(0, y + TILE - 3, FIELD_W, 3);
      }
    } else if (row.kind === "river") {
      ctx.fillStyle = row.r % 2 ? C.water : C.waterDeep;
      ctx.fillRect(0, y, FIELD_W, TILE);
      ctx.strokeStyle = rgba(W, 0.2);
      ctx.lineWidth = 1.5;
      const drift = (frame * row.speed * 0.5) % 60;
      for (let i = -1; i < 8; i++) {
        const rx = i * 60 + drift + ((row.r * 23) % 30);
        const ry = y + 12 + ((i + row.r) % 3) * 8;
        ctx.beginPath();
        ctx.arc(rx, ry + Math.sin(t / 400 + i) * 1.5, 6, Math.PI * 1.15, Math.PI * 1.85);
        ctx.stroke();
      }
      if (above?.kind !== "river") {
        ctx.fillStyle = rgba(W, 0.25);
        ctx.fillRect(0, y, FIELD_W, 2);
      }
    } else {
      ctx.fillStyle = C.gravel;
      ctx.fillRect(0, y, FIELD_W, TILE);
      ctx.fillStyle = C.tie;
      for (let x = 2; x < FIELD_W; x += 18) ctx.fillRect(x, y + 6, 7, TILE - 12);
      ctx.fillStyle = rgba(W, 0.55);
      ctx.fillRect(0, y + 11, FIELD_W, 3);
      ctx.fillRect(0, y + TILE - 14, FIELD_W, 3);
    }
  }

  function stump(x: number, y: number, color: string) {
    // Candle stump seen from above: chunky wax block with its wick.
    ctx.fillStyle = rgba(p.ink, 0.3);
    ctx.fillRect(x + 9, y + 31, 24, 5);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x + 19, y + 3, 2, 34);
    kit.block(x + 9, y + 9, 22, 22, color, 4);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x + 20, y + 20, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  function coin(cx: number, cy: number, phase: number) {
    const sx = Math.max(0.2, Math.abs(Math.cos(t / 260 + phase)));
    ctx.save();
    ctx.translate(cx, cy + Math.sin(t / 300 + phase) * 1.5);
    ctx.scale(sx, 1);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 8, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = rgba(p.ink, 0.45);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = rgba(W, 0.5);
    ctx.fillRect(-5, -5, 3, 3);
    ctx.restore();
  }

  function vehicle(x: number, y: number, w: number, kind: number, dir: number, idx: number) {
    const color = bricks[(idx * 3 + kind) % bricks.length];
    const front = dir > 0 ? x + w : x;
    const fx = (d: number) => (dir > 0 ? front - d : front + d); // d px back from the nose
    if (kind === SCOOTER) {
      const bx = x + 4, bw = w - 8;
      ctx.fillStyle = p.ink;
      ctx.fillRect(bx + 2, y + 12, 6, 16);
      ctx.fillRect(bx + bw - 8, y + 12, 6, 16);
      kit.block(bx, y + 13, bw, 14, color, 5);
      // Rider helmet
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(x + w / 2, y + 20, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = mix(color, W, 0.4);
      ctx.beginPath();
      ctx.arc(x + w / 2, y + 20, 5.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = W;
      ctx.fillRect(fx(4) - 2, y + 18, 4, 4);
      return;
    }
    // Wheels poke out top and bottom (seen from above).
    ctx.fillStyle = p.ink;
    for (const d of [10, w - 16]) {
      const wx = dir > 0 ? x + w - d - 6 : x + d;
      ctx.fillRect(wx, y + 4, 8, 4);
      ctx.fillRect(wx, y + TILE - 8, 8, 4);
    }
    if (kind === PUMP_TRUCK) {
      // Cab (front tile) + rounded tank with a pump arrow.
      const cabX = dir > 0 ? x + w - TILE + 2 : x + 2;
      const tankX = dir > 0 ? x + 2 : x + TILE + 2;
      kit.block(tankX, y + 6, w - TILE - 2, TILE - 12, color, 10);
      kit.block(cabX, y + 7, TILE - 4, TILE - 14, mix(color, p.ink, 0.25), 4);
      // Pump arrow on the tank
      const ax = tankX + (w - TILE - 2) / 2;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ax - 9 * dir, y + 13);
      ctx.lineTo(ax + 5 * dir, y + 20);
      ctx.lineTo(ax - 9 * dir, y + 27);
      ctx.stroke();
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = rgba(W, 0.6);
      ctx.fillRect(dir > 0 ? fx(11) : fx(5), y + 11, 6, TILE - 22);
    } else {
      // Delivery van: boxy body, windscreen at the nose, roof stripe.
      kit.block(x + 2, y + 6, w - 4, TILE - 12, color, 6);
      ctx.fillStyle = rgba(W, 0.6);
      ctx.fillRect(dir > 0 ? fx(15) : fx(7), y + 11, 8, TILE - 22);
      ctx.fillStyle = rgba(p.ink, 0.25);
      ctx.fillRect(dir > 0 ? x + 8 : x + 26, y + 17, w - 34, 6);
    }
    // Headlights
    ctx.fillStyle = W;
    ctx.fillRect(fx(3) - 1.5, y + 9, 3, 4);
    ctx.fillRect(fx(3) - 1.5, y + TILE - 13, 3, 4);
  }

  function float(x: number, y: number, w: number, kind: number) {
    if (kind === LILY) {
      for (let px = x; px < x + w - 1; px += TILE) {
        const cx = px + TILE / 2, cy = y + TILE / 2;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(cx, cy, 17.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = C.lily;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, 16, Math.PI * 0.15, Math.PI * 1.85);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = rgba(p.accent, 0.9);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, 8, 0, Math.PI * 2);
        ctx.stroke();
      }
      return;
    }
    kit.block(x + 1, y + 5, w - 2, TILE - 10, C.log, 12);
    ctx.strokeStyle = rgba(p.ink, 0.3);
    ctx.lineWidth = 1.5;
    for (let gx = x + 16; gx < x + w - 16; gx += 22) {
      ctx.beginPath();
      ctx.moveTo(gx, y + 13);
      ctx.lineTo(gx + 12, y + 13);
      ctx.moveTo(gx + 6, y + 26);
      ctx.lineTo(gx + 18, y + 26);
      ctx.stroke();
    }
    for (const ex of [x + 9, x + w - 9]) {
      ctx.fillStyle = C.logEnd;
      ctx.beginPath();
      ctx.ellipse(ex, y + TILE / 2, 5, 11, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(p.ink, 0.45);
      ctx.beginPath();
      ctx.ellipse(ex, y + TILE / 2, 2.5, 6, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  function rail(row: Row, y: number, frame: number) {
    const s = tramState(row, frame);
    // Warning lights at both ends.
    const on = s.warn && Math.floor(frame / 8) % 2 === 0;
    for (const lx of [10, FIELD_W - 10]) {
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(lx, y + TILE / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = on ? p.accent : mix(p.accent, p.ink, 0.7);
      ctx.beginPath();
      ctx.arc(lx, y + TILE / 2, 5, 0, Math.PI * 2);
      ctx.fill();
      if (on) {
        ctx.fillStyle = rgba(p.accent, 0.25);
        ctx.beginPath();
        ctx.arc(lx, y + TILE / 2, 13, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (s.warn && !s.active) {
      ctx.fillStyle = rgba(p.accent, 0.12 + (on ? 0.1 : 0));
      ctx.fillRect(0, y, FIELD_W, TILE);
    }
    if (s.active) {
      const x = s.x;
      kit.block(x, y + 3, s.w, TILE - 6, C.tram, 12);
      ctx.fillStyle = rgba(W, 0.55);
      for (let wx = x + 22; wx < x + s.w - 30; wx += 26) ctx.fillRect(wx, y + 10, 16, TILE - 20);
      // Nose stripe
      const nose = s.dir > 0 ? x + s.w - 14 : x + 6;
      ctx.fillStyle = p.accent;
      ctx.fillRect(nose, y + 8, 8, TILE - 16);
      // Speed lines behind
      ctx.fillStyle = rgba(W, 0.35);
      const tail = s.dir > 0 ? x : x + s.w;
      for (let i = 0; i < 3; i++) ctx.fillRect(tail - s.dir * (12 + i * 14) - 5, y + 9 + i * 9, 10, 2);
    }
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        if (e.t === "hop") {
          kit.fx.burst(e.x!, e.y! + 10, rgba(W, 0.7), 4, 50, 0);
        } else if (e.t === "land" && e.kind === "river") {
          kit.fx.burst(e.x!, e.y! + 6, rgba(W, 0.8), 5, 60, 200);
        } else if (e.t === "coin") {
          kit.fx.burst(e.x!, e.y!, p.accent, 12, 140);
          kit.fx.popup(e.x!, e.y! - 14, `+${e.value as number}`, p.accent);
        } else if (e.t === "milestone") {
          kit.fx.popup(FIELD_W / 2, e.y!, `ROW ${e.row as number}!`, p.primary);
          for (let i = 0; i < 5; i++) kit.fx.burst(40 + i * 70, e.y!, bricks[i % bricks.length], 10, 180);
          kit.fx.flash("255,255,255");
        } else if (e.t === "bump") {
          kit.fx.addShake(2);
        } else if (e.t === "die") {
          deadMs = 0;
          if (e.cause === "water" || e.cause === "swept") {
            kit.fx.burst(e.x!, e.y!, mix(water, W, 0.5), 22, 170, 500);
            kit.fx.burst(e.x!, e.y!, W, 8, 90, 300);
          } else {
            kit.fx.burst(e.x!, e.y!, p.secondary, 18, 220);
            kit.fx.burst(e.x!, e.y!, p.primary, 10, 160);
            kit.fx.flash();
          }
          kit.fx.addShake(e.cause === "water" ? 5 : 9);
        }
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (v.player.dead) deadMs += dtMs;
      kit.background(dtMs);
      const byR = new Map<number, Row>();
      for (const r of v.rows) byR.set(r.r, r);

      // Ground tiles, bottom to top.
      for (const row of v.rows) {
        const y = rowTopY(row.r, v.camY);
        if (y > FIELD_H || y < -TILE) continue;
        tileRow(row, y, byR.get(row.r + 1), byR.get(row.r - 1), v.frame);
      }
      // Static things and moving lanes.
      for (const row of v.rows) {
        const y = rowTopY(row.r, v.camY);
        if (y > FIELD_H || y < -TILE) continue;
        if (row.kind === "grass") {
          for (let c = 0; c < COLS; c++) if (row.stumps & (1 << c)) stump(c * TILE, y, bricks[(row.r + c) % bricks.length]);
        } else if (row.kind === "river") {
          for (const o of laneObjects(row, v.frame)) if (o.x < FIELD_W && o.x + o.w > 0) float(o.x, y, o.w, o.kind);
        }
        if (row.coins) for (let c = 0; c < COLS; c++) if (row.coins & (1 << c)) coin(c * TILE + TILE / 2, y + TILE / 2, c + row.r);
      }

      // Player (drawn above water/floats, below vehicles so a hit reads as "under the wheels").
      const pl = v.player;
      const k = pl.hopping ? pl.hopT : 0;
      const arc = Math.sin(Math.PI * k);
      let sx = 1 - 0.12 * arc, sy = 1 + 0.22 * arc;
      if (!pl.hopping && pl.landT < 6) {
        const q = 1 - pl.landT / 6;
        sx = 1 + 0.25 * q;
        sy = 1 - 0.22 * q;
      }
      let alpha = 1;
      const sprite = pl.dead ? kit.sprites.sad : kit.sprites.mini;
      if (pl.dead) {
        if (pl.cause === "car" || pl.cause === "tram") {
          sx = 1.45;
          sy = 0.35;
        } else if (pl.cause === "water" || pl.cause === "swept") {
          const q = Math.min(1, deadMs / 500);
          sx = sy = 1 - 0.5 * q;
          alpha = 1 - q;
        }
      }
      const px = pl.x;
      const py = rowTopY(pl.y, v.camY) + TILE / 2;
      const size = 34;
      if (alpha > 0) {
        ctx.fillStyle = rgba(p.ink, 0.3);
        ctx.beginPath();
        ctx.ellipse(px, py + 12, 12 * (1 - 0.3 * arc), 4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(px, py - arc * 10 + (size * (1 - sy)) / 2);
        ctx.scale(pl.dir === DIR_LEFT ? -sx : sx, sy);
        ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
        ctx.restore();
      }

      // Vehicles and trams over the player.
      for (const row of v.rows) {
        const y = rowTopY(row.r, v.camY);
        if (y > FIELD_H || y < -TILE) continue;
        if (row.kind === "road") {
          const dir = row.speed > 0 ? 1 : -1;
          laneObjects(row, v.frame).forEach((o, i) => {
            if (o.x < FIELD_W && o.x + o.w > 0) vehicle(o.x, y, o.w, o.kind, dir, i + row.r);
          });
        } else if (row.kind === "rail") rail(row, y, v.frame);
      }

      // Danger glow when the creeping edge is close.
      const lead = pl.y * TILE + TILE / 2 - v.camY;
      if (v.started && lead < 2.5 * TILE) {
        const a = Math.max(0, Math.min(0.55, (2.5 * TILE - lead) / (2.5 * TILE))) * (0.75 + 0.25 * Math.sin(t / 90));
        const g = ctx.createLinearGradient(0, FIELD_H, 0, FIELD_H - 70);
        g.addColorStop(0, rgba(p.accent, a));
        g.addColorStop(1, rgba(p.accent, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, FIELD_H - 70, FIELD_W, 70);
      }

      kit.text(`ROW ${v.best}`, 10, 16, 12, p.text, "left");
      if (!v.started && v.best === 0) {
        kit.text("TAP OR UP TO HOP", FIELD_W / 2, FIELD_H - 70, 14, p.text);
        kit.text("SWIPE TO DODGE", FIELD_W / 2, FIELD_H - 50, 10, rgba(p.text, 0.8));
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
