// Moon Solitaire renderer: rounded cards with big ranks and drawn suit shapes,
// mascot card backs and mascot court cards, tweened card motion, flip
// animation, and a bouncing-card celebration on a win. Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  CH, CW, END_BTN, FIELD_H, FIELD_W, FOUND0, STOCK, TAB0, TOP_Y, TAB_Y, WASTE, TIME_LIMIT,
  cardPos, colX, isRed, rankOf, suitOf, type SolitaireView,
} from "./index.ts";

const RANKS = ["", "A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

function hexRgb(h: string): [number, number, number] {
  const s = h.replace("#", "");
  const n = parseInt(s.length === 3 ? s.split("").map((c) => c + c).join("") : s.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
const lum = (c: [number, number, number]) => (0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]) / 255;
function mix(a: string, b: string, t: number): string {
  const x = hexRgb(a), y = hexRgb(b);
  const m = (i: number) => Math.round(x[i] + (y[i] - x[i]) * t);
  return `rgb(${m(0)},${m(1)},${m(2)})`;
}

/** Suit shape centred on (x, y), size s. Hearts round, diamonds pointy, clubs trefoil, spades with a stem. */
function suitPath(ctx: CanvasRenderingContext2D, suit: number, x: number, y: number, s: number) {
  const r = s / 2;
  ctx.beginPath();
  if (suit === 0) {
    // heart
    ctx.moveTo(x, y + r * 0.95);
    ctx.bezierCurveTo(x - r * 1.3, y + r * 0.05, x - r * 0.9, y - r * 1.05, x, y - r * 0.4);
    ctx.bezierCurveTo(x + r * 0.9, y - r * 1.05, x + r * 1.3, y + r * 0.05, x, y + r * 0.95);
  } else if (suit === 1) {
    // diamond
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.72, y);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.72, y);
    ctx.closePath();
  } else if (suit === 2) {
    // club
    const c = r * 0.42;
    ctx.arc(x, y - r * 0.45, c, 0, Math.PI * 2);
    ctx.moveTo(x - r * 0.45 + c, y + r * 0.12);
    ctx.arc(x - r * 0.45, y + r * 0.12, c, 0, Math.PI * 2);
    ctx.moveTo(x + r * 0.45 + c, y + r * 0.12);
    ctx.arc(x + r * 0.45, y + r * 0.12, c, 0, Math.PI * 2);
    ctx.moveTo(x - r * 0.12, y);
    ctx.lineTo(x - r * 0.38, y + r);
    ctx.lineTo(x + r * 0.38, y + r);
    ctx.lineTo(x + r * 0.12, y);
    ctx.closePath();
  } else {
    // spade
    ctx.moveTo(x, y - r);
    ctx.bezierCurveTo(x + r * 1.3, y - r * 0.1, x + r * 0.8, y + r * 0.85, x + r * 0.05, y + r * 0.35);
    ctx.lineTo(x + r * 0.38, y + r);
    ctx.lineTo(x - r * 0.38, y + r);
    ctx.lineTo(x - r * 0.05, y + r * 0.35);
    ctx.bezierCurveTo(x - r * 0.8, y + r * 0.85, x - r * 1.3, y - r * 0.1, x, y - r);
  }
  ctx.fill();
}

interface Pos { x: number; y: number }
interface Bouncer { card: number; x: number; y: number; vx: number; vy: number; trail: Pos[]; bounces: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SolitaireView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const S = RENDER_SCALE;

  // Red suits: the most "red" palette colour, darkened until readable on white.
  const cands = [p.accent, p.primary, p.secondary, ...p.bricks];
  let red = cands[0];
  let bestScore = -1e9;
  for (const c of cands) {
    const [r, g, b] = hexRgb(c);
    const sc = r - (g + b) / 2;
    if (sc > bestScore) { bestScore = sc; red = c; }
  }
  const redL = lum(hexRgb(red));
  const redInk = redL > 0.45 ? mix(red, p.ink, Math.min(0.6, 0.2 + (redL - 0.45))) : red;
  const blackInk = p.ink;
  const suitInk = (c: number) => (isRed(c) ? redInk : blackInk);
  const paper = "#ffffff";
  const paperShade = mix("#ffffff", p.bg2, 0.12);

  function roundCard(c: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, fill: string) {
    c.fillStyle = p.ink;
    c.beginPath();
    c.roundRect(x, y, w, h, 6);
    c.fill();
    c.fillStyle = fill;
    c.beginPath();
    c.roundRect(x + 1.25, y + 1.25, w - 2.5, h - 2.5, 5);
    c.fill();
  }

  function hat(c: CanvasRenderingContext2D, rank: number, x: number, y: number, col: string) {
    c.fillStyle = col;
    c.strokeStyle = p.ink;
    c.lineWidth = 1;
    c.beginPath();
    if (rank === 13) {
      // crown
      c.moveTo(x - 9, y + 4);
      c.lineTo(x - 9, y - 3);
      c.lineTo(x - 5, y + 1);
      c.lineTo(x, y - 5);
      c.lineTo(x + 5, y + 1);
      c.lineTo(x + 9, y - 3);
      c.lineTo(x + 9, y + 4);
      c.closePath();
    } else if (rank === 12) {
      // tiara
      c.moveTo(x - 9, y + 4);
      c.quadraticCurveTo(x, y - 7, x + 9, y + 4);
      c.closePath();
    } else {
      // cap with a feather
      c.moveTo(x - 9, y + 4);
      c.lineTo(x - 7, y - 2);
      c.lineTo(x + 6, y - 2);
      c.lineTo(x + 10, y + 4);
      c.closePath();
    }
    c.fill();
    c.stroke();
    if (rank === 11) {
      c.strokeStyle = col;
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(x + 4, y - 2);
      c.quadraticCurveTo(x + 10, y - 9, x + 14, y - 8);
      c.stroke();
    } else {
      c.fillStyle = "#ffffff";
      c.fillRect(x - 1, y - (rank === 13 ? 2 : 1), 2, 2);
    }
  }

  // ---- Pre-rendered faces and back (at RENDER_SCALE) ----
  function makeCanvas(): [HTMLCanvasElement, CanvasRenderingContext2D] {
    const cv = document.createElement("canvas");
    cv.width = CW * S;
    cv.height = CH * S;
    const c = cv.getContext("2d")!;
    c.setTransform(S, 0, 0, S, 0, 0);
    c.imageSmoothingEnabled = false;
    return [cv, c];
  }

  function makeFace(card: number): HTMLCanvasElement {
    const [cv, c] = makeCanvas();
    const rank = rankOf(card), suit = suitOf(card);
    const ink = suitInk(card);
    roundCard(c, 0, 0, CW, CH, paper);
    c.fillStyle = paperShade;
    c.fillRect(2, CH - 6, CW - 4, 3);
    // Top strip: big rank + small suit (visible when overlapped).
    c.fillStyle = ink;
    c.font = `bold ${rank === 10 ? 12 : 14}px ${kit.font}`;
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(RANKS[rank], 3.5, 10);
    suitPath(c, suit, CW - 9, 9.5, 11);
    // Centre art.
    const cx = CW / 2, cy = 40;
    if (rank >= 11) {
      const tint = p.bricks[suit % p.bricks.length] ?? p.primary;
      c.fillStyle = mix(tint.startsWith("#") ? tint : "#888888", "#ffffff", 0.6);
      c.beginPath();
      c.roundRect(5, 20, CW - 10, CH - 25, 4);
      c.fill();
      const spr = rank === 13 ? kit.sprites.happy : rank === 12 ? kit.sprites.idle : kit.sprites.mini;
      c.drawImage(spr, cx - 13, cy - 10, 26, 26);
      hat(c, rank, cx, cy - 12, rank === 11 ? redInk : p.accent);
      suitPath(c, suit, 10, CH - 11, 8);
    } else if (rank === 1) {
      c.fillStyle = mix(p.accent.startsWith("#") ? p.accent : "#888888", "#ffffff", 0.75);
      c.beginPath();
      c.arc(cx, cy, 15, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = ink;
      suitPath(c, suit, cx, cy, 24);
    } else {
      c.fillStyle = ink;
      suitPath(c, suit, cx, cy, 22);
      c.font = `bold 9px ${kit.font}`;
      c.textAlign = "right";
      c.fillText(RANKS[rank], CW - 4, CH - 9);
    }
    return cv;
  }

  function makeBack(): HTMLCanvasElement {
    const [cv, c] = makeCanvas();
    roundCard(c, 0, 0, CW, CH, p.secondary);
    c.save();
    c.beginPath();
    c.roundRect(3, 3, CW - 6, CH - 6, 4);
    c.clip();
    c.fillStyle = "rgba(255,255,255,0.12)";
    for (let i = -CH; i < CW; i += 6) {
      c.beginPath();
      c.moveTo(i, 0);
      c.lineTo(i + 3, 0);
      c.lineTo(i + 3 + CH, CH);
      c.lineTo(i + CH, CH);
      c.fill();
    }
    c.restore();
    c.strokeStyle = p.primary;
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(4, 4, CW - 8, CH - 8, 4);
    c.stroke();
    c.fillStyle = p.ink;
    c.globalAlpha = 0.35;
    c.beginPath();
    c.arc(CW / 2, CH / 2 + 1, 14, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.drawImage(kit.sprites.mini, CW / 2 - 13, CH / 2 - 13, 26, 26);
    return cv;
  }

  const faces: HTMLCanvasElement[] = [];
  for (let i = 0; i < 52; i++) faces.push(makeFace(i));
  const back = makeBack();
  // The pixel font may still be loading: redraw the faces once it is ready.
  document.fonts?.ready.then(() => {
    for (let i = 0; i < 52; i++) faces[i] = makeFace(i);
  }).catch(() => {});

  // ---- Animation state ----
  const pos = new Map<number, Pos>(); // drawn position per card
  const flipT = new Map<number, number>(); // ms left of a flip animation
  const wasUp = new Map<number, boolean>();
  let bouncers: Bouncer[] = [];
  let launchQueue: number[] = [];
  let launchTimer = 0;
  let wonAt = -1;
  let t = 0;
  let started = false;
  let badPulse = 0;

  function drawCard(card: number, x: number, y: number, up: boolean, alpha = 1) {
    const ft = flipT.get(card) ?? 0;
    ctx.globalAlpha = alpha;
    if (ft > 0) {
      const k = ft / 160; // 1 -> 0
      const sx = Math.abs(1 - 2 * k);
      const img = k > 0.5 ? back : up ? faces[card] : back;
      ctx.drawImage(img, x + (CW * (1 - sx)) / 2, y - 2 * Math.sin(Math.PI * k), CW * sx, CH);
    } else {
      ctx.drawImage(up ? faces[card] : back, x, y, CW, CH);
    }
    ctx.globalAlpha = 1;
  }

  function slot(x: number, y: number, label: string, suitHint = -1) {
    ctx.fillStyle = "rgba(255,255,255,0.07)";
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, CW - 2, CH - 2, 6);
    ctx.fill();
    ctx.stroke();
    ctx.setLineDash([]);
    if (suitHint >= 0) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      suitPath(ctx, suitHint, x + CW / 2, y + CH / 2 - 4, 18);
    }
    if (label) kit.text(label, x + CW / 2, y + CH - 12, 10, "rgba(255,255,255,0.45)");
  }

  function outline(x: number, y: number, h: number, color: string, wpx = 2.5) {
    ctx.strokeStyle = color;
    ctx.lineWidth = wpx;
    ctx.beginPath();
    ctx.roundRect(x - 2, y - 2, CW + 4, h + 4, 7);
    ctx.stroke();
  }

  /** Every card's target position + face state, in drawing order. */
  function layout(v: SolitaireView) {
    const out: { card: number; x: number; y: number; up: boolean; pile: number; idx: number }[] = [];
    const n = v.stock.length;
    for (let i = 0; i < n; i++) out.push({ card: v.stock[i], x: colX(0), y: TOP_Y - Math.min(2, Math.floor(i / 10)), up: false, pile: STOCK, idx: i });
    for (let i = 0; i < v.waste.length; i++) {
      const q = cardPos(v, WASTE, i);
      out.push({ card: v.waste[i], x: q.x, y: q.y, up: true, pile: WASTE, idx: i });
    }
    for (let f = 0; f < 4; f++) for (let i = 0; i < v.found[f].length; i++) out.push({ card: v.found[f][i], x: colX(f + 3), y: TOP_Y, up: true, pile: FOUND0 + f, idx: i });
    for (let k = 0; k < 7; k++) {
      const tp = v.tab[k];
      for (let i = 0; i < tp.cards.length; i++) {
        const q = cardPos(v, TAB0 + k, i);
        out.push({ card: tp.cards[i], x: q.x, y: q.y, up: i >= tp.down, pile: TAB0 + k, idx: i });
      }
    }
    return out;
  }

  function startWin(v: SolitaireView) {
    wonAt = t;
    launchQueue = [];
    for (let r = 12; r >= 0; r--) for (let f = 0; f < 4; f++) if (v.found[f][r] !== undefined) launchQueue.push(v.found[f][r] * 8 + f);
    launchTimer = 0;
  }

  return {
    onEvents(events: readonly GameEvent[], v: SolitaireView) {
      for (const e of events) {
        if (e.t === "found") {
          kit.fx.burst(e.x!, e.y!, p.accent, 14, 150);
          kit.fx.burst(e.x!, e.y!, p.primary, 6, 90);
          kit.fx.popup(e.x!, e.y! - 18, `+${e.gain as number}`, p.primary);
          if (rankOf(e.card as number) === 13) {
            kit.fx.addShake(5);
            kit.fx.flash("255,255,255");
            for (let i = 0; i < 3; i++) kit.fx.burst(e.x!, e.y!, p.bricks[i % p.bricks.length], 12, 220);
          }
        } else if (e.t === "place") {
          kit.fx.burst(e.x!, e.y!, p.secondary, 6, 80, 200);
          if ((e.gain as number) !== 0) kit.fx.popup(e.x!, e.y! - 14, `${(e.gain as number) > 0 ? "+" : ""}${e.gain as number}`, (e.gain as number) > 0 ? p.primary : p.accent);
        } else if (e.t === "flip") {
          flipT.set(e.card as number, 160);
          kit.fx.popup(e.x!, e.y! - 20, `+${e.gain as number}`, p.text);
        } else if (e.t === "recycle") {
          kit.fx.popup(e.x!, e.y!, `${e.gain as number}`, p.accent);
          kit.fx.addShake(3);
        } else if (e.t === "bad") {
          kit.fx.addShake(3);
          badPulse = 250;
        } else if (e.t === "stuck") {
          kit.fx.addShake(4);
        } else if (e.t === "autofinish") {
          kit.fx.popup(FIELD_W / 2, TAB_Y + 120, "AUTO FINISH!", p.primary);
        } else if (e.t === "won") {
          kit.fx.flash("255,255,255");
          startWin(v);
          if ((e.bonus as number) > 0) kit.fx.popup(FIELD_W / 2, FIELD_H / 2 + 40, `TIME BONUS +${e.bonus as number}`, p.primary);
        }
      }
    },

    draw(v: SolitaireView, dtMs: number) {
      t += dtMs;
      if (!started) {
        started = true;
        // Deal animation: every card flies out from the stock.
        for (let i = 0; i < 52; i++) pos.set(i, { x: colX(0), y: TOP_Y });
      }
      kit.background(dtMs);
      badPulse = Math.max(0, badPulse - dtMs);

      // Felt panel behind the table.
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.beginPath();
      ctx.roundRect(3, TOP_Y - 6, FIELD_W - 6, FIELD_H - TOP_Y + 2, 10);
      ctx.fill();

      // Top strip: score, cards home, time.
      const secs = Math.ceil(v.timeLeft / 60);
      const home = v.found.reduce((n, f) => n + f.length, 0);
      kit.text(`${v.score}`, 10, 16, 16, p.primary, "left");
      kit.text(`${home}/52`, FIELD_W / 2, 16, 12, p.text);
      const low = secs <= 30 && v.phase === "play";
      kit.text(`${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, FIELD_W - 10, 16, 14, low && Math.floor(t / 300) % 2 ? p.accent : p.text, "right");
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(10, 30, FIELD_W - 20, 3);
      ctx.fillStyle = low ? p.accent : p.secondary;
      ctx.fillRect(10, 30, ((FIELD_W - 20) * v.timeLeft) / TIME_LIMIT, 3);

      // Empty slots.
      if (!v.stock.length) {
        slot(colX(0), TOP_Y, "");
        if (v.waste.length) {
          // recycle arrow
          ctx.strokeStyle = "rgba(255,255,255,0.5)";
          ctx.lineWidth = 3;
          ctx.beginPath();
          ctx.arc(colX(0) + CW / 2, TOP_Y + CH / 2, 11, -0.3, Math.PI * 1.5);
          ctx.stroke();
          ctx.fillStyle = "rgba(255,255,255,0.5)";
          ctx.beginPath();
          const ax = colX(0) + CW / 2 + 11 * Math.cos(-0.3), ay = TOP_Y + CH / 2 + 11 * Math.sin(-0.3);
          ctx.moveTo(ax - 6, ay - 2);
          ctx.lineTo(ax + 5, ay - 4);
          ctx.lineTo(ax + 1, ay + 6);
          ctx.fill();
        }
      }
      if (!v.waste.length) slot(colX(1), TOP_Y, "");
      for (let f = 0; f < 4; f++) if (!v.found[f].length) slot(colX(f + 3), TOP_Y, "A", f);
      for (let k = 0; k < 7; k++) if (!v.tab[k].cards.length) slot(colX(k), TAB_Y, "K");

      // Cards: tween toward their targets; movers are drawn last.
      const lay = layout(v);
      const k = 1 - Math.exp(-dtMs / 55);
      const dragSet = new Set<number>();
      if (v.drag) {
        const src = v.drag.pile;
        if (src >= TAB0) v.tab[src - TAB0].cards.slice(v.drag.idx).forEach((c) => dragSet.add(c));
        else if (src === WASTE) dragSet.add(v.waste[v.waste.length - 1]);
        else dragSet.add(v.found[src - FOUND0][v.found[src - FOUND0].length - 1]);
      }
      const bouncing = new Set(bouncers.map((b) => b.card));
      const movers: { card: number; x: number; y: number; up: boolean }[] = [];
      const dragged: { card: number; up: boolean }[] = [];
      for (const c of lay) {
        const up = c.up;
        if (wasUp.has(c.card) && wasUp.get(c.card) !== up && !flipT.has(c.card)) flipT.set(c.card, 160);
        wasUp.set(c.card, up);
        const ft = flipT.get(c.card);
        if (ft !== undefined) {
          if (ft - dtMs <= 0) flipT.delete(c.card);
          else flipT.set(c.card, ft - dtMs);
        }
        if (bouncing.has(c.card)) continue;
        if (dragSet.has(c.card)) {
          dragged.push({ card: c.card, up });
          continue;
        }
        const cur = pos.get(c.card) ?? { x: c.x, y: c.y };
        cur.x += (c.x - cur.x) * k;
        cur.y += (c.y - cur.y) * k;
        if (Math.abs(c.x - cur.x) < 0.3 && Math.abs(c.y - cur.y) < 0.3) {
          cur.x = c.x;
          cur.y = c.y;
        }
        pos.set(c.card, cur);
        const far = Math.abs(c.x - cur.x) + Math.abs(c.y - cur.y) > 3;
        if (far) movers.push({ card: c.card, x: cur.x, y: cur.y, up });
        else drawCard(c.card, cur.x, cur.y, up);
      }
      // Stock depth + count.
      if (v.stock.length) {
        kit.text(String(v.stock.length), colX(0) + CW / 2, TOP_Y + CH + 6, 9, p.text);
      }
      for (const m of movers) drawCard(m.card, m.x, m.y, m.up);

      // Keyboard cursor and held pick.
      if (v.phase === "play" && v.keyMode) {
        const glow = 0.6 + 0.4 * Math.sin(t / 150);
        if (v.held) {
          const hp = cardPos(v, v.held.pile, v.held.idx);
          const tp = v.held.pile >= TAB0 ? v.tab[v.held.pile - TAB0] : null;
          const bottom = tp ? cardPos(v, v.held.pile, tp.cards.length - 1).y + CH : hp.y + CH;
          outline(hp.x, hp.y, bottom - hp.y, p.accent, 3);
        }
        const c = v.cursor;
        const cp = cardPos(v, c.pile, c.idx);
        const tp = c.pile >= TAB0 ? v.tab[c.pile - TAB0] : null;
        const bottom = tp && tp.cards.length ? cardPos(v, c.pile, tp.cards.length - 1).y + CH : cp.y + CH;
        ctx.globalAlpha = glow;
        outline(cp.x, cp.y, bottom - cp.y, badPulse > 0 ? p.accent : p.primary, 2.5);
        ctx.globalAlpha = 1;
        // little mascot pointer
        ctx.drawImage(kit.sprites.mini, cp.x + CW - 10, cp.y - 12 + Math.sin(t / 200) * 2, 16, 16);
      }

      // Dragged cards follow the pointer, lifted with a shadow.
      if (v.drag && dragged.length) {
        const off = v.drag.pile >= TAB0 ? Math.max(12, Math.min(19, (FIELD_H - 20 - v.drag.y - CH) / Math.max(1, dragged.length - 1))) : 0;
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.beginPath();
        ctx.roundRect(v.drag.x + 5, v.drag.y + 7, CW, CH + off * (dragged.length - 1), 7);
        ctx.fill();
        dragged.forEach((d, i) => {
          const x = v.drag!.x, y = v.drag!.y + i * off;
          pos.set(d.card, { x, y });
          drawCard(d.card, x, y, d.up);
        });
      }

      // ---- Win celebration: cards hop off the foundations and bounce ----
      if (wonAt >= 0) {
        launchTimer -= dtMs;
        while (launchTimer <= 0 && launchQueue.length) {
          const q = launchQueue.shift()!;
          const card = q >> 3, f = q & 7;
          bouncers.push({ card, x: colX(f + 3), y: TOP_Y, vx: (Math.random() < 0.5 ? -1 : 1) * (70 + Math.random() * 120), vy: -60 - Math.random() * 220, trail: [], bounces: 0 });
          launchTimer += 75;
        }
        const dt = dtMs / 1000;
        for (const b of bouncers) {
          b.vy += 900 * dt;
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (b.y + CH > FIELD_H) {
            b.y = FIELD_H - CH;
            b.vy = -b.vy * 0.72;
            b.bounces++;
            kit.fx.burst(b.x + CW / 2, FIELD_H - 2, p.bricks[b.bounces % p.bricks.length], 4, 90);
          }
          b.trail.push({ x: b.x, y: b.y });
          if (b.trail.length > 6) b.trail.shift();
          b.trail.forEach((q, i) => drawCard(b.card, q.x, q.y, true, 0.08 + i * 0.05));
          drawCard(b.card, b.x, b.y, true);
        }
        bouncers = bouncers.filter((b) => b.x > -CW - 10 && b.x < FIELD_W + 10);
        const bob = Math.sin(t / 180) * 4;
        ctx.drawImage(kit.sprites.happy, FIELD_W / 2 - 40, FIELD_H / 2 - 110 + bob, 80, 80);
        kit.text("TO THE MOON!", FIELD_W / 2, FIELD_H / 2 - 10, 22, p.primary);
        kit.text(`SCORE ${v.score}`, FIELD_W / 2, FIELD_H / 2 + 18, 14, p.text);
      }

      // ---- No more moves ----
      if (v.stuck && v.phase === "play") {
        ctx.fillStyle = "rgba(0,0,0,0.55)";
        ctx.beginPath();
        ctx.roundRect(40, END_BTN.y - 70, FIELD_W - 80, END_BTN.h + 86, 12);
        ctx.fill();
        ctx.drawImage(kit.sprites.sad, FIELD_W / 2 - 66, END_BTN.y - 64, 28, 28);
        kit.text("NO MORE MOVES", FIELD_W / 2 + 14, END_BTN.y - 50, 14, p.accent);
        kit.text("keep trying, or end the run", FIELD_W / 2, END_BTN.y - 22, 9, p.text);
        const pulse = 1 + 0.04 * Math.sin(t / 160);
        const bw = END_BTN.w * pulse, bh = END_BTN.h * pulse;
        kit.block(FIELD_W / 2 - bw / 2, END_BTN.y + END_BTN.h / 2 - bh / 2, bw, bh, p.primary, 8);
        kit.text("END RUN", FIELD_W / 2, END_BTN.y + END_BTN.h / 2 + 1, 14, p.ink);
      }

      // Give-up hold progress.
      if (v.giveUp > 0 && v.phase === "play") {
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(60, FIELD_H - 26, FIELD_W - 120, 16);
        ctx.fillStyle = p.accent;
        ctx.fillRect(62, FIELD_H - 24, (FIELD_W - 124) * Math.min(1, v.giveUp), 12);
        kit.text("HOLD TO GIVE UP", FIELD_W / 2, FIELD_H - 18, 9, p.text);
      } else if (v.frame < 240 && v.phase === "play") {
        ctx.globalAlpha = Math.min(1, (240 - v.frame) / 60);
        kit.text("TAP A CARD TO MOVE IT  -  DRAG TO PLACE", FIELD_W / 2, FIELD_H - 14, 8, p.text);
        ctx.globalAlpha = 1;
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
