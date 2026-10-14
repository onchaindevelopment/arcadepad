// Moon Tiles renderer: chunky stacked blocks with per-layer depth shading,
// coin-symbol faces (symbol + pip count, so tiles read without colour), the
// mascot as three special faces and as the host between the buttons. Deal,
// match, shuffle and clear animations are driven by the engine's phase
// counters and events. All art is drawn here.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BTN_H, BTN_Y, CLEAR_FRAMES, DEAL_FRAMES, DEPTH, FIELD_H, FIELD_W, HINT_BTN, RUN_FRAMES, SHUF_BTN,
  SHUFFLE_FRAMES, SYMBOLS, TH, TW, type TileView, type TilesView,
} from "./index.ts";

interface Ghost { x: number; y: number; tx: number; ty: number; face: number; life: number; max: number; z: number }
interface Ring { x: number; y: number; life: number; max: number; color: string }
interface Banner { text: string; sub: string; life: number; color: string }

const TAU = Math.PI * 2;
const ease = (k: number) => 1 - (1 - k) * (1 - k);

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<TilesView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const tints = [p.primary, p.secondary, p.accent];
  let clock = 0;
  let ghosts: Ghost[] = [];
  let rings: Ring[] = [];
  let banner: Banner | null = null;
  let mood: "happy" | "sad" | null = null;
  let moodUntil = 0;
  let scoreShown = 0;
  let scoreBump = 0;
  const shakeTile = new Map<number, number>();

  // ---------- Face art ----------

  function symbol(kind: number, cx: number, cy: number, r: number, color: string) {
    ctx.fillStyle = color;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();
    switch (kind) {
      case 0: { // coin
        ctx.arc(cx, cy, r, 0, TAU);
        ctx.fill();
        ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.arc(cx, cy, r * 0.62, 0, TAU);
        ctx.stroke();
        ctx.fillStyle = "rgba(255,255,255,0.6)";
        ctx.fillRect(cx - r * 0.5, cy - r * 0.55, r * 0.35, 2);
        return;
      }
      case 1: // star
        for (let i = 0; i < 10; i++) {
          const a = -Math.PI / 2 + (i * Math.PI) / 5;
          const rr = i & 1 ? r * 0.45 : r * 1.05;
          ctx.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
        }
        break;
      case 2: // crescent moon
        ctx.arc(cx, cy, r, 0.3 * Math.PI, 1.7 * Math.PI, false);
        ctx.arc(cx + r * 0.5, cy - r * 0.15, r * 0.75, 1.55 * Math.PI, 0.45 * Math.PI, true);
        break;
      case 3: { // heart
        const s = r;
        ctx.moveTo(cx, cy + s * 0.85);
        ctx.bezierCurveTo(cx - s * 1.5, cy - s * 0.1, cx - s * 0.7, cy - s * 1.2, cx, cy - s * 0.4);
        ctx.bezierCurveTo(cx + s * 0.7, cy - s * 1.2, cx + s * 1.5, cy - s * 0.1, cx, cy + s * 0.85);
        break;
      }
      case 4: { // diamond gem
        ctx.moveTo(cx, cy - r);
        ctx.lineTo(cx + r * 0.85, cy - r * 0.2);
        ctx.lineTo(cx, cy + r);
        ctx.lineTo(cx - r * 0.85, cy - r * 0.2);
        break;
      }
      default: { // rocket
        const s = r;
        ctx.moveTo(cx, cy - s);
        ctx.quadraticCurveTo(cx + s * 0.6, cy - s * 0.3, cx + s * 0.45, cy + s * 0.5);
        ctx.lineTo(cx + s * 0.8, cy + s * 0.9);
        ctx.lineTo(cx - s * 0.8, cy + s * 0.9);
        ctx.lineTo(cx - s * 0.45, cy + s * 0.5);
        ctx.quadraticCurveTo(cx - s * 0.6, cy - s * 0.3, cx, cy - s);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  function face(f: number, x: number, y: number, w: number, h: number) {
    const cx = x + w / 2;
    if (f >= SYMBOLS * 3) {
      const spr = [kit.sprites.idle, kit.sprites.happy, kit.sprites.sad][f - SYMBOLS * 3];
      const s = w - 6;
      ctx.drawImage(spr, cx - s / 2, y + (h - s) / 2 - 2, s, s);
      ctx.fillStyle = p.accent;
      ctx.fillRect(x + 5, y + h - 8, w - 10, 3);
      return;
    }
    const sym = f % SYMBOLS, tint = Math.floor(f / SYMBOLS);
    symbol(sym, cx, y + h * 0.4, w * 0.3, tints[tint]);
    // pips: 1-3 by tint, readable without colour
    ctx.fillStyle = p.ink;
    for (let i = 0; i <= tint; i++) {
      ctx.beginPath();
      ctx.arc(cx + (i - tint / 2) * 7, y + h - 9, 2.2, 0, TAU);
      ctx.fill();
    }
  }

  /** A chunky 3D block: depth sides bottom-right, face on top. */
  function block(x: number, y: number, z: number, f: number, opts: { dim?: boolean; lift?: number; glow?: string | null; alpha?: number }) {
    const lift = opts.lift ?? 0;
    x -= lift;
    y -= lift;
    ctx.globalAlpha = opts.alpha ?? 1;
    // drop shadow
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.beginPath();
    ctx.roundRect(x + DEPTH + 2 + lift, y + DEPTH + 3 + lift, TW, TH, 5);
    ctx.fill();
    // side (depth) with per-layer shade
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x - 0.5, y - 0.5, TW + DEPTH + 1, TH + DEPTH + 1, 6);
    ctx.fill();
    const side = [p.wall, p.secondary, p.primary, p.accent][Math.min(3, z)];
    ctx.fillStyle = side;
    ctx.beginPath();
    ctx.roundRect(x + 1.5, y + 1.5, TW + DEPTH - 3, TH + DEPTH - 3, 5);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath();
    ctx.roundRect(x + 1.5, y + 1.5, TW + DEPTH - 3, TH + DEPTH - 3, 5);
    ctx.fill();
    // face
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, TW, TH, 5);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.roundRect(x + 1.5, y + 1.5, TW - 3, TH - 3, 4);
    ctx.fill();
    ctx.fillStyle = p.text;
    ctx.globalAlpha *= 0.35;
    ctx.beginPath();
    ctx.roundRect(x + 1.5, y + TH * 0.55, TW - 3, TH * 0.45 - 1.5, 4);
    ctx.fill();
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.fillStyle = "rgba(255,255,255,0.9)";
    ctx.fillRect(x + 4, y + 3, TW - 8, 2);
    face(f, x + 1, y + 1, TW - 2, TH - 2);
    // lower layers get darker; blocked tiles dim a little more
    const shade = Math.max(0, 0.16 - z * 0.05) + (opts.dim ? 0.18 : 0);
    if (shade > 0) {
      ctx.fillStyle = `rgba(0,0,0,${shade})`;
      ctx.beginPath();
      ctx.roundRect(x + 1.5, y + 1.5, TW - 3, TH - 3, 4);
      ctx.fill();
    }
    if (opts.glow) {
      ctx.strokeStyle = opts.glow;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.roundRect(x - 1, y - 1, TW + 2, TH + 2, 6);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function button(r: { x: number; y: number; w: number; h: number }, label: string, color: string, on: boolean) {
    ctx.globalAlpha = on ? 1 : 0.45;
    kit.block(r.x, r.y, r.w, r.h, color, 8);
    kit.text(label, r.x + r.w / 2, r.y + r.h / 2 + 1, 13, p.ink === color ? p.text : "#ffffff");
    ctx.globalAlpha = 1;
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        if (e.t === "match") {
          const tiles = [
            { x: (e.ax as number) - TW / 2, y: (e.ay as number) - TH / 2 },
            { x: (e.bx as number) - TW / 2, y: (e.by as number) - TH / 2 },
          ];
          const mx = e.x as number, my = e.y as number;
          for (const t of tiles) ghosts.push({ x: t.x, y: t.y, tx: mx - TW / 2, ty: my - TH / 2, face: e.face as number, life: 0, max: 260, z: 9 });
          const combo = e.combo as number;
          setTimeout(() => {
            kit.fx.burst(mx, my, tints[(e.face as number) % 3] ?? p.accent, 14 + combo * 2, 160);
            kit.fx.burst(mx, my, "#ffffff", 6, 90);
            rings.push({ x: mx, y: my, life: 0, max: 380, color: p.accent });
            kit.fx.popup(mx, my - 18, combo >= 2 ? `+${e.gain as number} x${combo}` : `+${e.gain as number}`, combo >= 3 ? p.accent : p.primary);
          }, 230);
          if (combo >= 3) kit.fx.addShake(3);
          scoreBump = 1;
        } else if (e.t === "blocked") {
          shakeTile.set(e.id as number, 300);
          kit.fx.addShake(2);
        } else if (e.t === "select" || e.t === "mismatch") {
          kit.fx.burst(e.x as number, e.y as number, p.primary, 5, 60, 0);
        } else if (e.t === "hint") {
          for (const id of [e.a, e.b] as number[]) {
            const t = v.tiles.find((q) => q.id === id);
            if (t) rings.push({ x: t.x + TW / 2, y: t.y + TH / 2, life: 0, max: 600, color: p.accent });
          }
        } else if (e.t === "shuffle") {
          kit.fx.addShake(5);
          kit.fx.flash("255,255,255");
          const cost = e.cost as number;
          banner = { text: "SHUFFLE!", sub: cost ? `-${cost}` : "", life: 1100, color: p.secondary };
        } else if (e.t === "stuck") {
          banner = { text: "NO MOVES", sub: v.shuffles > 0 ? "shuffling..." : "", life: 1300, color: p.secondary };
        } else if (e.t === "levelclear") {
          banner = { text: "CLEARED!", sub: `+${e.bonus as number} time bonus`, life: 1500, color: p.primary };
          for (let i = 0; i < 8; i++)
            kit.fx.burst(30 + Math.random() * (FIELD_W - 60), 200 + Math.random() * 200, p.bricks[i % p.bricks.length] ?? p.accent, 14, 240);
          kit.fx.flash("255,255,255");
        } else if (e.t === "gameover") {
          banner = { text: e.reason === "stuck" ? "NO MOVES LEFT" : "TIME UP!", sub: `${e.score as number} points`, life: 1e9, color: p.accent };
          kit.fx.addShake(4);
        }
        if (e.mood) {
          mood = e.mood;
          moodUntil = clock + 1200;
        }
      }
    },

    draw(v, dtMs) {
      clock += dtMs;
      kit.background(dtMs);
      if (clock > moodUntil) mood = null;

      // ---------- Header ----------
      scoreShown += (v.score - scoreShown) * Math.min(1, dtMs / 120);
      if (Math.abs(v.score - scoreShown) < 1) scoreShown = v.score;
      scoreBump = Math.max(0, scoreBump - dtMs / 300);
      kit.text(String(Math.round(scoreShown)), FIELD_W / 2, 26, 22 + scoreBump * 6, p.text);
      kit.text(`${v.layoutNo + 1}. ${v.layoutName.toUpperCase()}`, 12, 26, 11, p.primary, "left");
      const secs = Math.ceil(v.timeLeft / 60);
      const low = secs <= 20 && !v.over;
      kit.text(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, FIELD_W - 12, 26, 13, low && Math.floor(clock / 250) % 2 ? p.accent : p.text, "right");
      // time bar
      kit.block(12, 46, FIELD_W - 24, 12, p.wall, 5);
      const frac = v.timeLeft / RUN_FRAMES;
      if (frac > 0) kit.block(12, 46, Math.max(12, (FIELD_W - 24) * frac), 12, low ? p.accent : p.primary, 5);
      // progress + combo
      const left = v.tiles.length;
      kit.text(`${left} TILES`, 14, 72, 9, p.text, "left");
      if (v.combo >= 2) kit.text(`COMBO x${v.combo}`, FIELD_W - 14, 72, 10 + Math.sin(clock / 90), p.accent, "right");

      // ---------- Tiles ----------
      const order = v.tiles.slice().sort((a, b) => a.z - b.z || a.hy - b.hy || a.hx - b.hx);
      const dealK = v.phase === "deal" ? v.phaseT / DEAL_FRAMES : 1;
      const shufK = v.phase === "shuffle" ? v.phaseT / SHUFFLE_FRAMES : 1;
      const clearFade = v.phase === "clear" ? 1 - Math.min(1, v.phaseT / (CLEAR_FRAMES * 0.3)) : 1;
      const hint = v.hint;
      for (let i = 0; i < order.length; i++) {
        const t: TileView = order[i];
        let x = t.x, y = t.y, alpha = clearFade;
        if (dealK < 1) {
          const delay = (i / order.length) * 0.6;
          const k = Math.max(0, Math.min(1, (dealK - delay) / 0.4));
          y -= (1 - ease(k)) * 80;
          alpha *= k;
        }
        if (shufK < 1) {
          const w = Math.sin(shufK * Math.PI);
          x += Math.sin(t.id * 1.7 + clock / 60) * 6 * w;
          y += Math.cos(t.id * 2.3 + clock / 70) * 4 * w;
        }
        const sh = shakeTile.get(t.id);
        if (sh) {
          x += Math.sin(sh / 20) * 3 * (sh / 300);
          const n = sh - dtMs;
          if (n > 0) shakeTile.set(t.id, n);
          else shakeTile.delete(t.id);
        }
        const sel = t.id === v.selected;
        const hinted = !!hint && (hint[0] === t.id || hint[1] === t.id);
        const cur = t.id === v.cursor && v.phase === "play";
        let glow: string | null = null;
        if (sel) glow = p.accent;
        else if (hinted) glow = Math.floor(clock / 180) % 2 ? p.primary : "#ffffff";
        else if (cur && v.keyCursor) glow = p.primary;
        else if (cur && t.free) glow = "rgba(255,255,255,0.55)";
        block(x, y, t.z, t.face, { dim: !t.free && v.phase === "play", lift: sel ? 3 : 0, glow, alpha });
      }

      // matched tiles flying together
      ghosts = ghosts.filter((g) => (g.life += dtMs) < g.max);
      for (const g of ghosts) {
        const k = ease(g.life / g.max);
        block(g.x + (g.tx - g.x) * k, g.y + (g.ty - g.y) * k - Math.sin(k * Math.PI) * 12, 3, g.face, { lift: 2, alpha: 1 - k * 0.5, glow: p.accent });
      }
      rings = rings.filter((r) => (r.life += dtMs) < r.max);
      for (const r of rings) {
        const k = r.life / r.max;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 10 + k * 34, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      // ---------- Footer: buttons + mascot host ----------
      const canPlay = v.phase === "play" || v.phase === "stuck";
      button(HINT_BTN, "HINT", p.primary, canPlay && v.pairs.length > 0);
      button(SHUF_BTN, `SHUFFLE ${v.shuffles}`, p.secondary, canPlay && v.shuffles > 0);
      const sprite = v.over
        ? v.score > 0 ? kit.sprites.happy : kit.sprites.sad
        : mood === "happy" || v.phase === "clear" ? kit.sprites.happy
        : mood === "sad" || v.phase === "stuck" || low ? kit.sprites.sad : kit.sprites.idle;
      const hop = mood === "happy" || v.phase === "clear" ? Math.abs(Math.sin(clock / 110)) * 8 : Math.sin(clock / 400) * 1.5;
      const ms = 52;
      ctx.drawImage(sprite, FIELD_W / 2 - ms / 2, BTN_Y + BTN_H / 2 - ms / 2 - 4 - hop, ms, ms);

      // ---------- Banner ----------
      if (banner) {
        banner.life -= dtMs;
        if (banner.life <= 0) banner = null;
        else {
          const a = Math.min(1, banner.life / 300);
          ctx.globalAlpha = a;
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(0, FIELD_H / 2 - 52, FIELD_W, 96);
          const pop = 1 + Math.max(0, 1 - (1500 - Math.min(1500, banner.life)) / 200) * 0.3;
          kit.text(banner.text, FIELD_W / 2, FIELD_H / 2 - 16, 28 * pop, banner.color);
          if (banner.sub) kit.text(banner.sub, FIELD_W / 2, FIELD_H / 2 + 20, 13, p.text);
          ctx.globalAlpha = 1;
        }
      }
      if (v.phase === "deal" && v.frame < DEAL_FRAMES + 2)
        kit.text("TAP TWO FREE MATCHING TILES", FIELD_W / 2, BTN_Y - 14, 10, p.text);

      kit.fx.draw(kit, dtMs);
    },
  };
}
