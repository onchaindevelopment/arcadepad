// Candle Crawler renderer: red candlestick chains, money-bag field, a bouncing
// bear, a bag-dropping dumper, a bag-clearing sweeper and the coin mascot.
// All colours come from the theme palette (plus ink/white).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BAG_HP, CELL, COLS, H, PZ_Y, ROWS, W, type CrawlerView } from "./index.ts";

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.slice(0, 6);
  const n = parseInt(f, 16) || 0;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** How "red" a colour is: red channel above the strongest other channel. */
function redness(hex: string) {
  const [r, g, b] = rgb(hex);
  return r - Math.max(g, b) * 0.9;
}

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<CrawlerView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const pool = [...p.bricks, p.accent, p.secondary, p.primary];
  const candle = pool.reduce((a, b) => (redness(b) > redness(a) ? b : a), pool[0]);
  const bagC = p.bricks[4] ?? p.primary;
  const bagTie = p.secondary;
  const bearC = p.secondary === candle ? p.primary : p.secondary;
  const fleaC = p.accent === candle ? p.primary : p.accent;
  const scoutC = p.bricks[3] ?? p.primary;

  let t = 0;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;
  let banner = "";
  let bannerT = 0;
  let started = false;

  function drawBag(cx: number, cy: number, hp: number) {
    const k = 0.45 + (0.55 * hp) / BAG_HP;
    const r = 6.2 * k;
    const by = cy + 1.5;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(cx, by, r + 1.4, r + 1, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 3 * k - 1, by - r - 4 * k, 6 * k + 2, 4 * k + 2);
    ctx.fillStyle = bagC;
    ctx.beginPath();
    ctx.ellipse(cx, by, r, r - 0.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillRect(cx - 3 * k, by - r - 3 * k, 6 * k, 3 * k + 1);
    ctx.fillStyle = bagTie;
    ctx.fillRect(cx - 3 * k, by - r + 0.5, 6 * k, 1.5);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(cx - r * 0.6, by - r * 0.45, 2, 2);
    if (hp === BAG_HP) {
      ctx.fillStyle = p.ink;
      ctx.fillRect(cx - 0.5, by - 3, 1, 6);
      ctx.fillRect(cx - 2, by - 2, 3, 1);
      ctx.fillRect(cx - 1, by, 3, 1);
      ctx.fillRect(cx - 2, by + 2, 3, 1);
    } else {
      ctx.fillStyle = p.ink;
      ctx.fillRect(cx - 2, by - 1, 2, 1);
      ctx.fillRect(cx, by, 2, 1);
      if (hp <= 2) ctx.fillRect(cx + 1, by - 2, 1, 3);
    }
  }

  function drawCandle(x: number, y: number, head: boolean, dir: number, i: number) {
    const bob = Math.sin(t / 140 + i * 0.9) * 1.2;
    const cy = y + bob;
    const bw = head ? 10 : 8;
    const bh = head ? 12 : 10;
    // wick
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 1.5, cy - 8, 3, 16);
    ctx.fillStyle = candle;
    ctx.fillRect(x - 0.5, cy - 7, 1, 14);
    // body
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - bw / 2 - 1, cy - bh / 2 - 1, bw + 2, bh + 2);
    ctx.fillStyle = candle;
    ctx.fillRect(x - bw / 2, cy - bh / 2, bw, bh);
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x - bw / 2 + 1, cy - bh / 2 + 1, 2, bh - 2);
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.fillRect(x + bw / 2 - 2, cy - bh / 2 + 1, 1, bh - 2);
    if (head) {
      // angry eyes looking where it crawls, plus a little flame
      const ex = x + dir * 1.5;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(ex - 4, cy - 3, 3, 3);
      ctx.fillRect(ex + 1, cy - 3, 3, 3);
      ctx.fillStyle = p.ink;
      ctx.fillRect(ex - 3 + dir * 0.5, cy - 2, 1.5, 2);
      ctx.fillRect(ex + 2 + dir * 0.5, cy - 2, 1.5, 2);
      ctx.fillRect(ex - 4, cy - 4.5, 3, 1);
      ctx.fillRect(ex + 1, cy - 4.5, 3, 1);
      ctx.fillRect(x - 2, cy + 2.5, 4, 1);
      const fl = 3 + Math.sin(t / 60 + i) * 1;
      ctx.fillStyle = bagC;
      ctx.beginPath();
      ctx.ellipse(x, cy - 10 - fl / 2, 2.2, fl, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 0.5, cy - 10, 1, 2);
    }
  }

  function drawBear(x: number, y: number, vx: number) {
    const s = Math.sign(vx) || 1;
    const hop = Math.abs(Math.sin(t / 90)) * 2;
    const cy = y - hop;
    ctx.fillStyle = p.ink;
    for (const ex of [-7, 7]) {
      ctx.beginPath();
      ctx.arc(x + ex, cy - 7, 4.5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(x, cy, 12, 9.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = bearC;
    for (const ex of [-7, 7]) {
      ctx.beginPath();
      ctx.arc(x + ex, cy - 7, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(x, cy, 10.5, 8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(x + s * 2, cy + 3, 5, 3.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.fillRect(x + s * 2 - 1.5, cy + 1, 3, 2);
    ctx.fillRect(x - 5 + s, cy - 3, 2.5, 2.5);
    ctx.fillRect(x + 3 + s, cy - 3, 2.5, 2.5);
    // grumpy brows
    ctx.fillRect(x - 6 + s, cy - 5.5, 4, 1);
    ctx.fillRect(x + 2.5 + s, cy - 5.5, 4, 1);
    // legs
    const leg = Math.sin(t / 60) * 2;
    ctx.fillRect(x - 7, cy + 7 + leg, 4, 3);
    ctx.fillRect(x + 3, cy + 7 - leg, 4, 3);
  }

  function drawFlea(x: number, y: number) {
    ctx.fillStyle = p.ink;
    for (let k = -1; k <= 1; k++) {
      const l = Math.sin(t / 40 + k) * 1.5;
      ctx.fillRect(x - 8, y + k * 3 + l, 4, 1);
      ctx.fillRect(x + 4, y + k * 3 - l, 4, 1);
    }
    ctx.beginPath();
    ctx.ellipse(x, y, 5.5, 7, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = fleaC;
    ctx.beginPath();
    ctx.ellipse(x, y, 4, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 3, y + 1, 2, 2);
    ctx.fillRect(x + 1, y + 1, 2, 2);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 2.5, y + 2, 1, 1);
    ctx.fillRect(x + 1.5, y + 2, 1, 1);
    // a tiny bag it is about to drop
    ctx.fillStyle = bagC;
    ctx.fillRect(x - 2, y - 11, 4, 4);
  }

  function drawScout(x: number, y: number, vx: number) {
    const s = Math.sign(vx) || 1;
    // broom bristles trailing behind
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 11, y - 5, 22, 10);
    ctx.fillStyle = scoutC;
    ctx.fillRect(x - 10, y - 4, 20, 8);
    ctx.fillStyle = bagC;
    for (let k = 0; k < 4; k++) ctx.fillRect(x - s * (12 + (k % 2) * 2), y - 4 + k * 2.5, 4, 1.5);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x + s * 4 - 1.5, y - 2, 3, 3);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x + s * 4 - 0.5 + s * 0.5, y - 1, 1.5, 1.5);
    const w = Math.sin(t / 50) * 1.5;
    ctx.fillRect(x - 6, y + 4 + w, 2, 3);
    ctx.fillRect(x + 4, y + 4 - w, 2, 3);
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        const x = e.x ?? W / 2, y = e.y ?? H / 2;
        switch (e.t) {
          case "kill":
            kit.fx.burst(x, y, candle, e.head ? 18 : 9, e.head ? 170 : 110);
            kit.fx.popup(x, y - 8, `+${e.points as number}`, e.head ? bagC : p.text);
            if (e.head) kit.fx.addShake(3);
            break;
          case "chip":
            kit.fx.burst(x, y, bagC, e.gone ? 8 : 3, e.gone ? 90 : 50);
            break;
          case "bear":
          case "scout":
          case "flea":
            kit.fx.burst(x, y, e.t === "bear" ? bearC : e.t === "scout" ? scoutC : fleaC, 20, 180);
            kit.fx.popup(x, y - 10, `+${e.points as number}`, bagC);
            kit.fx.addShake(4);
            if (e.t !== "flea") { mood = "happy"; moodT = 900; }
            break;
          case "plant":
          case "sweep":
          case "munch":
          case "newhead":
            kit.fx.burst(x, y, e.t === "newhead" ? candle : p.text, 6, 60, 0);
            break;
          case "hit":
            kit.fx.addShake(10);
            kit.fx.flash();
            kit.fx.burst(x, y, p.primary, 30, 220);
            mood = "sad"; moodT = 1600;
            break;
          case "restore": {
            const cells = (e.cells as number[]).slice(0, 40);
            for (const c of cells) {
              const cx = (c % COLS) * CELL + CELL / 2, cy = Math.floor(c / COLS) * CELL + CELL / 2;
              kit.fx.burst(cx, cy, bagC, 4, 60, 0);
            }
            banner = `BAGS RESTORED +${e.bonus as number}`;
            bannerT = 1400;
            break;
          }
          case "waveclear":
            banner = `WAVE CLEAR  +${e.bonus as number}`;
            bannerT = 1600;
            mood = "happy"; moodT = 1500;
            for (let i = 0; i < 5; i++) kit.fx.burst(40 + Math.random() * (W - 80), 200 + Math.random() * 200, pool[i % pool.length], 12, 200);
            break;
          case "gameover":
            mood = "sad"; moodT = 1e9;
            break;
        }
      }
      if (v.frame > 1) started = true;
    },
    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);

      // player zone
      ctx.fillStyle = "rgba(255,255,255,0.045)";
      ctx.fillRect(0, PZ_Y, W, H - PZ_Y);
      ctx.fillStyle = p.wall;
      ctx.globalAlpha = 0.7;
      for (let x = 0; x < W; x += 10) ctx.fillRect(x, PZ_Y - 1, 6, 2);
      ctx.globalAlpha = 1;

      // bags
      for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
        const hp = v.bags[r * COLS + c];
        if (hp) drawBag(c * CELL + CELL / 2, r * CELL + CELL / 2, hp);
      }

      // candle chains, tail first so heads sit on top
      for (let i = v.segs.length - 1; i >= 0; i--) {
        const s = v.segs[i];
        drawCandle(s.x, s.y, s.head, s.dir, i);
      }

      if (v.scout) drawScout(v.scout.x, v.scout.y, v.scout.vx);
      if (v.flea) drawFlea(v.flea.x, v.flea.y);
      if (v.bear) drawBear(v.bear.x, v.bear.y, v.bear.vx);

      // shot
      if (v.shot) {
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(v.shot.x - 2.5, v.shot.y - 2, 5, 12);
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(v.shot.x - 1, v.shot.y, 2, 8);
      }

      // mascot
      if (moodT > 0) moodT -= dtMs;
      const { x: px, y: py } = v.player;
      if (v.player.alive) {
        const spr = moodT > 0 && mood === "happy" ? kit.sprites.happy : moodT > 0 && mood === "sad" ? kit.sprites.sad : kit.sprites.idle;
        const bob = Math.sin(t / 220) * 1;
        const blink = v.ready > 0 && Math.floor(t / 120) % 2 === 0;
        if (!blink) ctx.drawImage(spr, px - 13, py - 14 + bob, 26, 26);
      } else if (!v.over || v.dying > 0) {
        ctx.globalAlpha = Math.max(0.2, v.dying / 90);
        ctx.drawImage(kit.sprites.sad, px - 13, py - 14, 26, 26);
        ctx.globalAlpha = 1;
      }

      if (v.ready > 0 && v.dying === 0) {
        kit.text(`WAVE ${v.wave + 1}`, W / 2, H * 0.42, 22, bagC);
        if (!started || (v.wave === 0 && v.frame < 120)) kit.text("DRAG TO MOVE · AUTO-FIRE", W / 2, H * 0.42 + 26, 10, p.text);
      }
      if (bannerT > 0) {
        bannerT -= dtMs;
        ctx.globalAlpha = Math.min(1, bannerT / 300);
        kit.text(banner, W / 2, H * 0.5, 16, p.text);
        ctx.globalAlpha = 1;
      }
      kit.fx.draw(kit, dtMs);
    },
  };
}
