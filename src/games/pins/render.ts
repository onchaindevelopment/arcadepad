// Pin Spin renderer: a giant spinning coin with the mascot and ticker on its
// face, candle-wick darts stuck in the rim, gems, shatter bursts and juice.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { ANG, CX, CY, FIELD_H, FIELD_W, LAUNCH_Y, PATTERN_NAMES, PIN_L, R, type Pin, type PinsView } from "./index.ts";

const TAU = Math.PI * 2;
const toRad = (a: number) => (a / ANG) * TAU;

interface Shard { a0: number; a1: number; x: number; y: number; vx: number; vy: number; rot: number; vr: number; color: string }
interface Flier { x: number; y: number; vx: number; vy: number; ang: number; vr: number; preset: boolean }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<PinsView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const p = theme.palette;
  const { ctx } = kit;
  let t = 0;
  let jolt = 0; // coin knock-back after a hit
  let mood: "idle" | "happy" | "sad" = "idle";
  let moodT = 0;
  let shards: Shard[] = [];
  let fliers: Flier[] = [];
  let pop = 0; // stage intro scale-in
  let banner = 0;
  let bannerText = "";
  let dying: { y: number; t: number } | null = null;
  let lastStage = -1;
  let seenThrow = false;
  const gemSpark: number[] = [];

  /** One dart pointing outward from the centre: tip at r0, tail at r1, along angle phi. */
  function dart(x: number, y: number, phi: number, len: number, preset: boolean, flame: boolean) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(phi);
    // local +x = outward from tip
    ctx.fillStyle = p.ink;
    ctx.fillRect(-1, -3, len + 2, 6);
    ctx.fillStyle = preset ? p.wall : p.text;
    ctx.fillRect(0, -1.5, len, 3);
    // steel tip
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, -1, 7, 2);
    // fletching
    const fc = preset ? p.secondary : p.primary;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(len - 15, 0);
    ctx.lineTo(len + 1, -7);
    ctx.lineTo(len + 1, 7);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = fc;
    ctx.beginPath();
    ctx.moveTo(len - 12, 0);
    ctx.lineTo(len - 1, -5);
    ctx.lineTo(len - 1, 5);
    ctx.closePath();
    ctx.fill();
    // candle wick + flame at the tail
    if (flame) {
      const f = 3 + Math.sin(t / 70 + x * 0.1 + y) * 1;
      ctx.fillStyle = p.ink;
      ctx.fillRect(len, -0.75, 3, 1.5);
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.ellipse(len + 3 + f, 0, f + 1.5, 2.6, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.ellipse(len + 3 + f * 0.6, 0, f * 0.5 + 0.5, 1.2, 0, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  function drawCoin(v: PinsView, cy: number, scale: number) {
    const rot = toRad(v.rot);
    const rr = R * scale;
    const face = v.boss ? p.secondary : p.primary;
    const rim = v.boss ? p.accent : p.secondary;
    ctx.save();
    ctx.translate(CX, cy);
    // drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(4, 6, rr + 4, 0, TAU);
    ctx.fill();
    // boss spikes
    if (v.boss) {
      ctx.save();
      ctx.rotate(rot);
      for (let i = 0; i < 16; i++) {
        ctx.rotate(TAU / 16);
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.moveTo(rr - 4, -9);
        ctx.lineTo(rr + 12, 0);
        ctx.lineTo(rr - 4, 9);
        ctx.fill();
        ctx.fillStyle = p.accent;
        ctx.beginPath();
        ctx.moveTo(rr - 3, -6);
        ctx.lineTo(rr + 8, 0);
        ctx.lineTo(rr - 3, 6);
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, rr + 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = rim;
    ctx.beginPath();
    ctx.arc(0, 0, rr, 0, TAU);
    ctx.fill();
    // reeded edge, spinning
    ctx.save();
    ctx.rotate(rot);
    ctx.strokeStyle = "rgba(0,0,0,0.28)";
    ctx.lineWidth = 2;
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * TAU;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * (rr - 8), Math.sin(a) * (rr - 8));
      ctx.lineTo(Math.cos(a) * (rr - 1), Math.sin(a) * (rr - 1));
      ctx.stroke();
    }
    ctx.restore();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, rr - 9, 0, TAU);
    ctx.fill();
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.arc(0, 0, rr - 10.5, 0, TAU);
    ctx.fill();
    // shine
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.arc(-rr * 0.25, -rr * 0.3, rr * 0.45, 0, TAU);
    ctx.fill();
    // face: mascot + ticker, spinning with the coin
    ctx.save();
    ctx.rotate(rot);
    const spr = mood === "sad" ? kit.sprites.sad : mood === "happy" ? kit.sprites.happy : kit.sprites.idle;
    const s = 64 * scale;
    ctx.drawImage(spr, -s / 2, -s / 2 - 10 * scale, s, s);
    kit.text("$" + v.ticker, 0, 32 * scale, v.ticker.length > 4 ? 11 : 13, p.text);
    ctx.restore();
    ctx.restore();
  }

  function pinPos(a: number, rot: number, cy: number) {
    const phi = toRad(a + rot);
    return { phi, x: CX + Math.cos(phi) * (R - 6), y: cy + Math.sin(phi) * (R - 6) };
  }

  function shatter(v: PinsView) {
    const n = v.boss ? 12 : 8;
    const base = toRad(v.rot);
    const colors = [v.boss ? p.secondary : p.primary, v.boss ? p.accent : p.secondary];
    shards = [];
    for (let i = 0; i < n; i++) {
      const a0 = base + (i / n) * TAU;
      const a1 = base + ((i + 1) / n) * TAU;
      const mid = (a0 + a1) / 2;
      const sp = 140 + Math.random() * 120;
      shards.push({ a0, a1, x: CX, y: CY, vx: Math.cos(mid) * sp, vy: Math.sin(mid) * sp - 120, rot: 0, vr: (Math.random() - 0.5) * 8, color: colors[i % 2] });
    }
    for (const pin of v.pins) {
      const q = pinPos(pin.a, v.rot, CY);
      const sp = 160 + Math.random() * 160;
      fliers.push({ x: q.x, y: q.y, vx: Math.cos(q.phi) * sp, vy: Math.sin(q.phi) * sp - 140, ang: q.phi, vr: (Math.random() - 0.5) * 14, preset: pin.preset });
    }
    for (let i = 0; i < 6; i++) kit.fx.burst(CX + (Math.random() - 0.5) * 80, CY + (Math.random() - 0.5) * 80, p.bricks[i % p.bricks.length], 14, 260);
  }

  return {
    onEvents(events: readonly GameEvent[], v: PinsView) {
      for (const e of events) {
        if (e.t === "throw") {
          seenThrow = true;
        } else if (e.t === "stick") {
          jolt = 6;
          kit.fx.burst(CX, CY + R + 2, p.text, 6, 90, 300);
          kit.fx.burst(CX, CY + R + 2, p.accent, 4, 70, 200);
          kit.fx.popup(CX + 22, CY + R + 18, "+1", p.text);
        } else if (e.t === "gem") {
          kit.fx.burst(CX, CY + R, p.accent, 22, 200);
          kit.fx.popup(CX - 26, CY + R + 22, "+5", p.accent);
          kit.fx.flash("255,255,255");
          mood = "happy";
          moodT = 600;
        } else if (e.t === "clear") {
          shatter(v);
          kit.fx.addShake(e.boss ? 12 : 7);
          kit.fx.flash("255,255,255");
          kit.fx.popup(CX, CY - 10, `STAGE CLEAR +${e.pts as number}`, p.primary);
          mood = "happy";
          moodT = 1200;
        } else if (e.t === "stage") {
          pop = 1;
          banner = 1400;
          bannerText = e.boss ? "BOSS COIN!" : `STAGE ${(e.stage as number) + 1}`;
          if (e.boss) kit.fx.flash("255,60,100");
        } else if (e.t === "die") {
          dying = { y: e.y as number, t: 0 };
          kit.fx.addShake(10);
          kit.fx.flash();
          kit.fx.burst(CX, e.y as number, p.accent, 26, 220);
          mood = "sad";
          moodT = 1e9;
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      const dt = dtMs / 1000;
      kit.background(dtMs);
      if (v.stage !== lastStage) {
        if (lastStage === -1) {
          banner = 1400;
          bannerText = v.boss ? "BOSS COIN!" : `STAGE ${v.stage + 1}`;
        }
        lastStage = v.stage;
      }
      if (moodT > 0 && (moodT -= dtMs) <= 0) mood = "idle";
      jolt = Math.max(0, jolt - dtMs * 0.04);
      pop = Math.max(0, pop - dtMs / 350);
      const cy = CY - jolt;

      // ---- stage pips (5 per cycle, the 5th is the boss)
      const cyc = Math.floor(v.stage / 5) * 5;
      for (let i = 0; i < 5; i++) {
        const s = cyc + i;
        const x = CX - 48 + i * 24;
        const y = 22;
        const boss = i === 4;
        const done = s < v.stage || (s === v.stage && v.clearing > 0);
        const cur = s === v.stage;
        const rr = boss ? 8 : 5;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(x, y, rr + 2, 0, TAU);
        ctx.fill();
        ctx.fillStyle = done ? p.primary : cur ? (boss ? p.accent : p.text) : p.wall;
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, TAU);
        ctx.fill();
        if (cur && v.clearing === 0) {
          ctx.strokeStyle = p.text;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(x, y, rr + 4 + Math.sin(t / 150), 0, TAU);
          ctx.stroke();
        }
      }
      kit.text(v.boss ? "BOSS" : `STAGE ${v.stage + 1}`, CX, 44, 11, v.boss ? p.accent : p.text);

      // ---- coin, pins and gems
      if (v.clearing === 0) {
        const scale = 1 - pop * pop * 0.6;
        // gems (behind pins, on the rim)
        for (let i = 0; i < v.gems.length; i++) {
          const g = v.gems[i];
          if (g.taken) continue;
          const phi = toRad(g.a + v.rot);
          const gx = CX + Math.cos(phi) * (R * scale + 4);
          const gy = cy + Math.sin(phi) * (R * scale + 4);
          const s = 8 + Math.sin(t / 160 + i) * 1;
          ctx.save();
          ctx.translate(gx, gy);
          ctx.rotate(phi + Math.PI / 4);
          ctx.fillStyle = p.ink;
          ctx.fillRect(-s / 2 - 1.5, -s / 2 - 1.5, s + 3, s + 3);
          ctx.fillStyle = p.accent;
          ctx.fillRect(-s / 2, -s / 2, s, s);
          ctx.fillStyle = "rgba(255,255,255,0.6)";
          ctx.fillRect(-s / 2 + 1.5, -s / 2 + 1.5, s / 3, s / 3);
          ctx.restore();
          gemSpark[i] = (gemSpark[i] ?? 0) + dtMs;
          if (gemSpark[i] > 260) {
            gemSpark[i] = 0;
            kit.fx.burst(gx, gy, "#ffffff", 1, 30, 0);
          }
        }
        // stuck pins
        for (const pin of v.pins as Pin[]) {
          const phi = toRad(pin.a + v.rot);
          const x = CX + Math.cos(phi) * (R * scale - 8);
          const y = cy + Math.sin(phi) * (R * scale - 8);
          dart(x, y, phi, PIN_L + 8, pin.preset, !pin.preset);
        }
        drawCoin(v, cy, scale);
      }

      // ---- shards and flung pins
      if (shards.length) {
        for (const s of shards) {
          s.vy += 520 * dt;
          s.x += s.vx * dt;
          s.y += s.vy * dt;
          s.rot += s.vr * dt;
          ctx.save();
          ctx.translate(s.x, s.y);
          ctx.rotate(s.rot);
          ctx.fillStyle = p.ink;
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.arc(0, 0, R + 3, s.a0, s.a1);
          ctx.closePath();
          ctx.fill();
          ctx.fillStyle = s.color;
          ctx.beginPath();
          ctx.moveTo(Math.cos((s.a0 + s.a1) / 2) * 3, Math.sin((s.a0 + s.a1) / 2) * 3);
          ctx.arc(0, 0, R, s.a0 + 0.04, s.a1 - 0.04);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
        shards = shards.filter((s) => s.y < FIELD_H + 120);
      }
      if (fliers.length) {
        for (const f of fliers) {
          f.vy += 620 * dt;
          f.x += f.vx * dt;
          f.y += f.vy * dt;
          f.ang += f.vr * dt;
          dart(f.x, f.y, f.ang, PIN_L, f.preset, false);
        }
        fliers = fliers.filter((f) => f.y < FIELD_H + 80);
      }

      // ---- the pin in flight, the dying pin, the pin waiting to be thrown
      if (v.flyY >= 0 && !v.dead) {
        // speed streak
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(CX - 2, v.flyY + PIN_L, 4, 40);
        dart(CX, v.flyY, Math.PI / 2, PIN_L + 8, false, true);
      }
      if (dying) {
        dying.t += dtMs;
        const k = dying.t / 1000;
        const x = CX + 90 * k;
        const y = dying.y - 160 * k + 700 * k * k;
        if (y < FIELD_H + 60) dart(x, y, Math.PI / 2 + k * 14, PIN_L + 8, false, false);
      }
      if (!v.dead && v.left > 0 && v.flyY < 0 && v.clearing === 0) {
        dart(CX, LAUNCH_Y + Math.sin(t / 220) * 2, Math.PI / 2, PIN_L + 8, false, true);
      }
      // mascot cheering from the launcher
      const ms = 28;
      ctx.drawImage(mood === "sad" ? kit.sprites.sad : mood === "happy" ? kit.sprites.happy : kit.sprites.mini, CX + 30, LAUNCH_Y + 28 - ms / 2, ms, ms);

      // ---- pins left column (bottom left)
      const total = v.needed;
      const colH = Math.min(14, 220 / Math.max(1, total));
      for (let i = 0; i < total; i++) {
        const y = FIELD_H - 24 - i * colH;
        const avail = i < v.left;
        ctx.fillStyle = p.ink;
        ctx.fillRect(16, y - 3, 30, 6);
        ctx.fillStyle = avail ? p.text : p.wall;
        ctx.fillRect(18, y - 1.5, 26, 3);
        ctx.fillStyle = avail ? p.primary : p.wall;
        ctx.fillRect(38, y - 3, 6, 6);
      }
      kit.text(`${v.left}`, 31, FIELD_H - 24 - total * colH - 6, 12, p.text);

      // ---- banner / hints
      if (banner > 0) {
        banner -= dtMs;
        const a = Math.min(1, banner / 300);
        ctx.globalAlpha = a;
        kit.text(bannerText, CX, CY + R + 100, bannerText.startsWith("BOSS") ? 22 : 18, bannerText.startsWith("BOSS") ? p.accent : p.text);
        if (v.pattern >= 0) kit.text(PATTERN_NAMES[v.pattern].toUpperCase(), CX, CY + R + 122, 10, p.secondary);
        ctx.globalAlpha = 1;
      }
      if (!seenThrow && v.throws === 0 && !v.dead) {
        const a = 0.6 + 0.4 * Math.sin(t / 250);
        ctx.globalAlpha = a;
        kit.text("TAP TO THROW", CX, LAUNCH_Y - 40, 13, p.text);
        ctx.globalAlpha = 1;
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
