// Moon Towers renderer: a glowing road for the FUD to march along, chunky
// themed towers with aiming barrels and recoil, the coin mascot sitting on the
// moon base, radial build menu, beams, splash rings, banners and particles.
// All art is drawn here from the theme palette.
import type { ThemePack } from "../../themes/types.ts";
import { RENDER_SCALE, makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BAR_Y, BOARD_H, BOARD_Y, CELL, COLS, CREEP, FIELD_H, FIELD_W, GO_BTN, ROWS, TILE, TOWERS, WIN_WAVES,
  cellCX, cellCY, type Creep, type Tower, type TowersView,
} from "./index.ts";

interface Beam { x: number; y: number; tx: number; ty: number; type: number; level: number; life: number; max: number }
interface Ring { x: number; y: number; r: number; life: number; max: number; color: string }
interface Banner { text: string; sub: string; life: number; max: number; color: string }

const TAU = Math.PI * 2;
const THEME_NAMES = ["FUD", "FAST FUD", "ARMORED FUD", "FUD SWARM", "MIXED FUD"];

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<TowersView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent, p.text];
  const ice = bricks[3 % bricks.length];
  const TCOL = [p.primary, p.accent, ice, p.secondary];
  let clock = 0;
  let beams: Beam[] = [];
  let rings: Ring[] = [];
  let banner: Banner | null = null;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;
  let coinBump = 0;
  let livesBump = 0;

  const circle = (x: number, y: number, r: number, color: string) => {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };
  const ringAt = (x: number, y: number, r: number, color: string, w = 2) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.stroke();
  };

  function coinIcon(x: number, y: number, r: number) {
    circle(x, y, r + 1.5, p.ink);
    circle(x, y, r, p.accent);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(x - r / 2, y - r / 2, r / 2, 1.5);
  }

  // ---------- Board ----------

  function drawBoard(v: TowersView) {
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = p.ink;
    ctx.fillRect(0, BOARD_Y, FIELD_W, BOARD_H);
    ctx.globalAlpha = 1;
    for (let cell = 0; cell < COLS * ROWS; cell++) {
      const c = cell % COLS, r = Math.floor(cell / COLS);
      const x = c * CELL, y = BOARD_Y + r * CELL;
      const t = v.tiles[cell];
      if (t === TILE.FREE) {
        ctx.fillStyle = (c + r) & 1 ? "rgba(255,255,255,0.05)" : "rgba(255,255,255,0.025)";
        ctx.fillRect(x + 1, y + 1, CELL - 2, CELL - 2);
      } else if (t === TILE.ROCK) {
        ctx.globalAlpha = 0.55;
        circle(x + 20, y + 21, 13, p.wall);
        circle(x + 18, y + 19, 9, p.ink);
        circle(x + 29, y + 30, 4, p.wall);
        ctx.globalAlpha = 1;
      }
    }
    // Road: ink outline, wall fill, animated dashes toward the base.
    const P = v.path;
    const road = (w: number, color: string, dash?: number[]) => {
      ctx.strokeStyle = color;
      ctx.lineWidth = w;
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.setLineDash(dash ?? []);
      if (dash) ctx.lineDashOffset = -clock / 40;
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
      ctx.stroke();
    };
    road(34, p.ink);
    road(30, p.wall);
    road(22, "rgba(255,255,255,0.06)");
    road(2, "rgba(255,255,255,0.22)", [6, 10]);
    ctx.setLineDash([]);
    // Entry: swirling FUD portal.
    const e = P[0];
    for (let i = 0; i < 3; i++) {
      ctx.globalAlpha = 0.35 - i * 0.08;
      circle(e.x + Math.sin(clock / 300 + i * 2) * 6, e.y + 6 + i * 2, 16 - i * 3, p.secondary);
    }
    ctx.globalAlpha = 1;
    kit.text("FUD", e.x, BOARD_Y + 6, 8, p.text);
  }

  function drawBase(v: TowersView) {
    const b = v.path[v.path.length - 1];
    const pulse = 1 + Math.sin(clock / 400) * 0.04;
    ctx.globalAlpha = 0.22;
    circle(b.x, b.y, 30 * pulse, p.text);
    ctx.globalAlpha = 1;
    circle(b.x, b.y, 22, p.ink);
    circle(b.x, b.y, 20, p.text);
    ctx.globalAlpha = 0.18;
    circle(b.x - 7, b.y - 4, 5, p.ink);
    circle(b.x + 8, b.y + 6, 4, p.ink);
    circle(b.x + 4, b.y - 9, 3, p.ink);
    ctx.globalAlpha = 1;
    const sprite = v.over || mood === "sad" ? kit.sprites.sad : v.won || mood === "happy" ? kit.sprites.happy : kit.sprites.idle;
    const s = 34;
    const bob = Math.sin(clock / 260) * 1.5;
    ctx.drawImage(sprite, b.x - s / 2, b.y - s + 2 + bob, s, s);
  }

  // ---------- Towers ----------

  function drawTower(t: Tower, v: TowersView) {
    const x = cellCX(t.cell), y = cellCY(t.cell);
    const col = TCOL[t.type];
    kit.block(x - 17, y - 17, 34, 34, col, 6);
    const a = Math.atan2(t.ay - y, t.ax - x);
    const since = v.frame - t.fired;
    const recoil = since < 6 ? (6 - since) * 0.8 : 0;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(a);
    ctx.translate(-recoil, 0);
    ctx.fillStyle = p.ink;
    if (t.type === 0) {
      // Coin blaster: twin short barrels at higher levels.
      const n = t.level === 2 ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const oy = n === 2 ? (i ? 3.5 : -3.5) : 0;
        ctx.fillStyle = p.ink;
        ctx.fillRect(0, oy - 3.5, 17, 7);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(2, oy - 1.5, 13, 3);
      }
      circle(0, 0, 8, p.ink);
      circle(0, 0, 6, p.accent);
    } else if (t.type === 1) {
      // Candle cannon: fat barrel with a candle body.
      ctx.fillRect(-2, -7, 18 + t.level * 2, 14);
      ctx.fillStyle = p.primary;
      ctx.fillRect(0, -5, 15 + t.level * 2, 10);
      ctx.fillStyle = p.ink;
      ctx.fillRect(15 + t.level * 2, -1, 4, 2);
      circle(0, 0, 9, p.ink);
      circle(0, 0, 7, p.secondary);
    } else if (t.type === 2) {
      // Freeze ray: dish + crystal.
      ctx.beginPath();
      ctx.moveTo(14, 0);
      ctx.lineTo(4, -8);
      ctx.lineTo(4, 8);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(12, 0);
      ctx.lineTo(6, -5);
      ctx.lineTo(6, 5);
      ctx.closePath();
      ctx.fill();
      circle(0, 0, 8, p.ink);
      circle(0, 0, 6, ice);
    } else {
      // Laser: long thin barrel, glowing tip.
      ctx.fillRect(0, -3, 21, 6);
      ctx.fillStyle = p.secondary;
      ctx.fillRect(2, -1.5, 17, 3);
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(clock / 120);
      circle(20, 0, 3, "#ffffff");
      ctx.globalAlpha = 1;
      circle(0, 0, 8, p.ink);
      circle(0, 0, 6, p.secondary);
    }
    ctx.restore();
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = i <= t.level ? "#ffffff" : "rgba(0,0,0,0.35)";
      ctx.fillRect(x - 8 + i * 6, y + 11, 4, 3);
    }
  }

  // ---------- Creeps ----------

  function drawCreep(c: Creep, v: TowersView) {
    const hit = v.frame - c.hitFrame < 4;
    const wob = Math.sin(clock / 90 + c.id) * 1.2;
    const x = c.x, y = c.y + wob;
    const slowed = c.slowUntil > v.frame;
    let r = 9;
    if (c.kind === CREEP.BOSS) {
      r = 16;
      // Bear: round head, ears, snout.
      circle(x - 11, y - 11, 6, p.ink);
      circle(x + 11, y - 11, 6, p.ink);
      circle(x - 11, y - 11, 4, hit ? "#ffffff" : p.wall);
      circle(x + 11, y - 11, 4, hit ? "#ffffff" : p.wall);
      circle(x, y, r + 1.5, p.ink);
      circle(x, y, r, hit ? "#ffffff" : p.wall);
      circle(x, y + 5, 7, p.ink);
      circle(x, y + 3, 2.5, p.text);
      ctx.fillStyle = p.accent;
      ctx.fillRect(x - 8, y - 6, 5, 3);
      ctx.fillRect(x + 3, y - 6, 5, 3);
      kit.text("BEAR", x, y - r - 12, 8, p.accent);
    } else if (c.kind === CREEP.SWARM) {
      r = 6;
      circle(x, y, r + 1.5, p.ink);
      circle(x, y, r, hit ? "#ffffff" : p.secondary);
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - 3, y - 2, 2, 2);
      ctx.fillRect(x + 1, y - 2, 2, 2);
    } else if (c.kind === CREEP.ARMOR) {
      r = 10;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.roundRect(x - r - 1.5, y - r - 1.5, 2 * r + 3, 2 * r + 3, 4);
      ctx.fill();
      ctx.fillStyle = hit ? "#ffffff" : bricks[1 % bricks.length];
      ctx.beginPath();
      ctx.roundRect(x - r, y - r, 2 * r, 2 * r, 3);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.fillRect(x - r + 2, y - r + 2, 2 * r - 4, 3);
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - 6, y - 2, 12, 3);
      kit.text("FUD", x, y + 5, 6, p.text);
    } else {
      const fast = c.kind === CREEP.FAST;
      r = fast ? 8 : 9;
      if (fast) {
        ctx.globalAlpha = 0.35;
        circle(x - 6, y, r - 2, p.accent);
        circle(x - 11, y, r - 4, p.accent);
        ctx.globalAlpha = 1;
      }
      // Grumpy storm cloud.
      const body = hit ? "#ffffff" : fast ? p.accent : p.wall;
      circle(x - 5, y + 2, r - 2 + 1.5, p.ink);
      circle(x + 5, y + 2, r - 2 + 1.5, p.ink);
      circle(x, y - 2, r + 1.5, p.ink);
      circle(x - 5, y + 2, r - 2, body);
      circle(x + 5, y + 2, r - 2, body);
      circle(x, y - 2, r, body);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 5, y - 4, 3, 3);
      ctx.fillRect(x + 2, y - 4, 3, 3);
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - 4, y - 3, 2, 2);
      ctx.fillRect(x + 3, y - 3, 2, 2);
      ctx.fillRect(x - 6, y - 6, 4, 1.5);
      ctx.fillRect(x + 2, y - 6, 4, 1.5);
      ctx.fillRect(x - 3, y + 3, 6, 1.5);
    }
    if (slowed) {
      ctx.globalAlpha = 0.45;
      ringAt(x, y, r + 3, ice, 2);
      ctx.globalAlpha = 1;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - r - 2, y - 1, 3, 3);
      ctx.fillRect(x + r, y + 2, 2, 2);
    }
    if (c.hp < c.maxHp) {
      const w = c.kind === CREEP.BOSS ? 32 : 18;
      const by = y - r - (c.kind === CREEP.BOSS ? 20 : 6);
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - w / 2 - 1, by - 1, w + 2, 4);
      ctx.fillStyle = c.hp / c.maxHp > 0.4 ? p.primary : p.accent;
      ctx.fillRect(x - w / 2, by, (w * Math.max(0, c.hp)) / c.maxHp, 2);
    }
  }

  // ---------- Menu ----------

  function towerGlyph(type: number, x: number, y: number, s: number) {
    ctx.fillStyle = p.ink;
    if (type === 0) {
      coinIcon(x, y, 5 * s);
    } else if (type === 1) {
      ctx.fillRect(x - 3.5 * s, y - 4 * s, 7 * s, 10 * s);
      ctx.fillStyle = p.primary;
      ctx.fillRect(x - 2.5 * s, y - 3 * s, 5 * s, 8 * s);
      ctx.fillStyle = p.ink;
      ctx.fillRect(x - 0.5 * s, y - 7 * s, 1.5 * s, 3 * s);
    } else if (type === 2) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2.5 * s;
      for (let i = 0; i < 3; i++) {
        const a = (i * Math.PI) / 3;
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(a) * 6 * s, y - Math.sin(a) * 6 * s);
        ctx.lineTo(x + Math.cos(a) * 6 * s, y + Math.sin(a) * 6 * s);
        ctx.stroke();
      }
    } else {
      ctx.fillRect(x - 7 * s, y - 2 * s, 14 * s, 4 * s);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 6 * s, y - 0.75 * s, 12 * s, 1.5 * s);
    }
  }

  function drawMenu(v: TowersView) {
    const m = v.menu!;
    ctx.globalAlpha = 0.4;
    ctx.fillStyle = p.ink;
    ctx.fillRect(0, BOARD_Y, FIELD_W, BOARD_H);
    ctx.globalAlpha = 1;
    const x = cellCX(m.cell), y = cellCY(m.cell);
    const tw = v.towers.find((t) => t.cell === m.cell);
    const sel = m.options[m.sel];
    // Range preview.
    let range = 0, next = 0;
    if (tw) {
      range = TOWERS[tw.type].range[tw.level];
      if (sel.kind === "upgrade" && tw.level < 2) next = TOWERS[tw.type].range[tw.level + 1];
    } else range = TOWERS[sel.type].range[0];
    ctx.globalAlpha = 0.12;
    circle(x, y, range, "#ffffff");
    ctx.globalAlpha = 0.6;
    ringAt(x, y, range, "#ffffff", 1.5);
    if (next) {
      ctx.setLineDash([4, 4]);
      ringAt(x, y, next, p.primary, 1.5);
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    // Highlight the cell and draw spokes.
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 2;
    ctx.strokeRect(x - CELL / 2 + 1, y - CELL / 2 + 1, CELL - 2, CELL - 2);
    if (tw) drawTower(tw, v);
    ctx.strokeStyle = "rgba(255,255,255,0.3)";
    ctx.lineWidth = 2;
    for (const o of m.options) {
      ctx.beginPath();
      ctx.moveTo(m.cx, m.cy);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
    }
    m.options.forEach((o, i) => {
      const active = i === m.sel;
      const pop = active ? 1.12 + Math.sin(clock / 120) * 0.04 : 1;
      const r = 18 * pop;
      ctx.globalAlpha = o.ok ? 1 : 0.45;
      circle(o.x, o.y, r + 2, p.ink);
      const fill = o.kind === "sell" ? p.wall : o.kind === "upgrade" ? (o.cost < 0 ? p.wall : p.primary) : TCOL[o.type];
      circle(o.x, o.y, r, fill);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(o.x - r / 2, o.y - r * 0.65, r, 2.5);
      if (o.kind === "build") towerGlyph(o.type, o.x, o.y, pop);
      else if (o.kind === "upgrade") {
        if (o.cost < 0) kit.text("MAX", o.x, o.y, 9, p.text);
        else {
          ctx.fillStyle = p.ink;
          ctx.beginPath();
          ctx.moveTo(o.x, o.y - 9);
          ctx.lineTo(o.x + 8, o.y);
          ctx.lineTo(o.x + 3, o.y);
          ctx.lineTo(o.x + 3, o.y + 8);
          ctx.lineTo(o.x - 3, o.y + 8);
          ctx.lineTo(o.x - 3, o.y);
          ctx.lineTo(o.x - 8, o.y);
          ctx.closePath();
          ctx.fill();
        }
      } else kit.text("$", o.x, o.y + 1, 16, p.accent);
      ctx.globalAlpha = 1;
      if (active) {
        ctx.globalAlpha = 0.8;
        ringAt(o.x, o.y, r + 5, "#ffffff", 2);
        ctx.globalAlpha = 1;
      }
      const label = o.kind === "sell" ? `+${o.cost}` : o.cost < 0 ? "" : `${o.cost}`;
      if (label) kit.text(label, o.x, o.y + r + 9, 10, o.ok ? p.accent : p.text);
    });
    // Name of the highlighted choice.
    const name = sel.kind === "build" ? TOWERS[sel.type].name.toUpperCase()
      : sel.kind === "sell" ? "SELL" : sel.cost < 0 ? "MAXED" : `UPGRADE TO LV${tw ? tw.level + 2 : 2}`;
    const ny = m.cy - 76 < BOARD_Y + 10 ? m.cy + 80 : m.cy - 76;
    kit.text(name, m.cx, ny, 11, "#ffffff");
  }

  // ---------- HUD ----------

  function drawTop(v: TowersView) {
    ctx.fillStyle = p.ink;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, 0, FIELD_W, BOARD_Y);
    ctx.globalAlpha = 1;
    // Lives: mascot head + count.
    const ls = 1 + livesBump * 0.4;
    ctx.drawImage(kit.sprites.mini, 8, 8, 26, 26);
    kit.text(`${v.lives}`, 40, 22, 15 * ls, v.lives <= 5 ? p.accent : p.text, "left");
    kit.text(`WAVE ${Math.max(1, v.wave)}/${WIN_WAVES}`, FIELD_W / 2, 15, 12, p.text);
    kit.text(`${v.score}`, FIELD_W / 2, 31, 11, p.primary);
    const cs = 1 + coinBump * 0.35;
    coinIcon(FIELD_W - 70, 22, 8);
    kit.text(`${v.coins}`, FIELD_W - 56, 22, 15 * cs, p.accent, "left");
  }

  function drawBottom(v: TowersView) {
    ctx.fillStyle = p.ink;
    ctx.globalAlpha = 0.55;
    ctx.fillRect(0, BAR_Y, FIELD_W, FIELD_H - BAR_Y);
    ctx.globalAlpha = 1;
    let msg: string;
    if (v.over) msg = "BASE OVERRUN";
    else if (v.won) msg = "MOON SAVED!";
    else if (v.spawning) msg = `WAVE ${v.wave} INCOMING`;
    else msg = `NEXT WAVE ${Math.ceil(v.countdown / 60)}s`;
    kit.text(msg, 10, BAR_Y + 18, 11, p.text, "left");
    if (v.earlyBonus > 0 && !v.over) {
      const pulse = Math.sin(clock / 150) * 1.5;
      kit.block(GO_BTN.x, GO_BTN.y - pulse / 2, GO_BTN.w, GO_BTN.h + pulse / 2, p.primary, 6);
      kit.text(`GO! +${v.earlyBonus}`, GO_BTN.x + GO_BTN.w / 2, GO_BTN.y + GO_BTN.h / 2, 12, p.ink);
    }
  }

  // ---------- Renderer ----------

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        const x = e.x as number, y = e.y as number;
        switch (e.t) {
          case "kill": {
            const boss = e.kind === CREEP.BOSS;
            kit.fx.burst(x, y, boss ? p.accent : p.wall, boss ? 40 : 10, boss ? 220 : 120);
            kit.fx.burst(x, y, p.accent, boss ? 16 : 4, 90, 200);
            kit.fx.popup(x, y - 10, `+${e.reward as number}`, p.accent);
            if (boss) {
              kit.fx.addShake(8);
              kit.fx.flash("255,255,255");
              rings.push({ x, y, r: 50, life: 0, max: 30, color: p.accent });
            }
            coinBump = 1;
            break;
          }
          case "leak":
            kit.fx.addShake((e.shake as number) ?? 5);
            kit.fx.flash();
            kit.fx.burst(x, y, p.secondary, 18, 160);
            kit.fx.popup(x, y - 30, e.kind === CREEP.BOSS ? "-5" : "-1", p.accent);
            mood = "sad";
            moodT = 900;
            livesBump = 1;
            break;
          case "boom":
            rings.push({ x, y, r: e.r as number, life: 0, max: 16, color: p.primary });
            kit.fx.burst(x, y, p.primary, 8, 100, 200);
            break;
          case "hit":
            kit.fx.burst(x, y, p.accent, 3, 60, 0);
            break;
          case "beam":
            beams.push({ x, y, tx: e.tx as number, ty: e.ty as number, type: e.type as number, level: e.level as number, life: 0, max: e.type === 3 ? 10 : 8 });
            break;
          case "build":
            kit.fx.burst(x, y, TCOL[e.type as number], 16, 140);
            rings.push({ x, y, r: 26, life: 0, max: 14, color: "#ffffff" });
            coinBump = 1;
            break;
          case "upgrade":
            kit.fx.burst(x, y, p.primary, 20, 160);
            kit.fx.popup(x, y - 18, `LV${(e.level as number) + 1}`, p.primary);
            rings.push({ x, y, r: 30, life: 0, max: 18, color: p.primary });
            mood = "happy";
            moodT = 700;
            coinBump = 1;
            break;
          case "sell":
            kit.fx.burst(x, y, p.accent, 12, 120);
            kit.fx.popup(x, y - 12, `+${e.refund as number}`, p.accent);
            coinBump = 1;
            break;
          case "nope":
            kit.fx.addShake(2);
            break;
          case "early":
            kit.fx.popup(x, y - 6, `+${e.bonus as number}`, p.accent);
            coinBump = 1;
            break;
          case "wave":
            banner = e.boss
              ? { text: `WAVE ${e.wave as number}`, sub: "BEAR INCOMING!", life: 0, max: 1600, color: p.accent }
              : { text: `WAVE ${e.wave as number}`, sub: THEME_NAMES[e.theme as number] ?? "FUD", life: 0, max: 1300, color: p.text };
            break;
          case "waveClear":
            banner = { text: "WAVE CLEAR", sub: `+${e.bonus as number} COINS`, life: 0, max: 1300, color: p.primary };
            mood = "happy";
            moodT = 900;
            coinBump = 1;
            break;
          case "boss":
            kit.fx.addShake(4);
            break;
          case "gameover":
            kit.fx.addShake(10);
            kit.fx.flash();
            banner = { text: "BASE OVERRUN", sub: "FUD WINS THIS TIME", life: 0, max: 1e9, color: p.accent };
            break;
          case "won":
            for (let i = 0; i < 8; i++) kit.fx.burst(Math.random() * FIELD_W, FIELD_H * 0.5, bricks[i % bricks.length], 14, 240);
            banner = { text: "MOON SAVED!", sub: `${WIN_WAVES} WAVES HELD`, life: 0, max: 1e9, color: p.primary };
            break;
        }
      }
    },

    draw(v, dtMs) {
      clock += dtMs;
      if (moodT > 0 && (moodT -= dtMs) <= 0) mood = null;
      coinBump = Math.max(0, coinBump - dtMs / 250);
      livesBump = Math.max(0, livesBump - dtMs / 300);
      kit.background(dtMs);
      drawBoard(v);
      drawBase(v);

      // Keyboard cursor.
      if (v.keyCursor && !v.menu && !v.over) {
        const c = v.cursor;
        const x = (c % COLS) * CELL, y = BOARD_Y + Math.floor(c / COLS) * CELL;
        ctx.setLineDash([5, 4]);
        ctx.lineDashOffset = clock / 60;
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 2;
        ctx.strokeRect(x + 2, y + 2, CELL - 4, CELL - 4);
        ctx.setLineDash([]);
      }

      for (const t of v.towers) drawTower(t, v);
      for (const c of v.creeps) drawCreep(c, v);

      // Shells.
      for (const s of v.shells) {
        if (s.type === 0) coinIcon(s.x, s.y, 3);
        else {
          ctx.fillStyle = p.ink;
          ctx.fillRect(s.x - 3.5, s.y - 5.5, 7, 11);
          ctx.fillStyle = p.primary;
          ctx.fillRect(s.x - 2, s.y - 4, 4, 8);
          ctx.fillStyle = p.accent;
          ctx.fillRect(s.x - 1, s.y - 8, 2, 3);
        }
      }

      // Beams.
      beams = beams.filter((b) => (b.life += dtMs / (1000 / 60)) < b.max);
      for (const b of beams) {
        const k = 1 - b.life / b.max;
        ctx.globalAlpha = k;
        ctx.lineCap = "round";
        if (b.type === 3) {
          ctx.strokeStyle = p.secondary;
          ctx.lineWidth = 5 + b.level;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          ctx.lineTo(b.tx, b.ty);
          ctx.stroke();
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2;
          ctx.stroke();
          circle(b.tx, b.ty, 5 * k + 2, "#ffffff");
        } else {
          ctx.strokeStyle = ice;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.moveTo(b.x, b.y);
          const n = 6;
          for (let i = 1; i <= n; i++) {
            const f = i / n;
            const j = i < n ? (i & 1 ? 3 : -3) : 0;
            const dx = b.tx - b.x, dy = b.ty - b.y;
            const len = Math.hypot(dx, dy) || 1;
            ctx.lineTo(b.x + dx * f - (dy / len) * j, b.y + dy * f + (dx / len) * j);
          }
          ctx.stroke();
          circle(b.tx, b.ty, 4, "#ffffff");
        }
        ctx.globalAlpha = 1;
      }

      // Rings.
      rings = rings.filter((r) => (r.life += dtMs / (1000 / 60)) < r.max);
      for (const r of rings) {
        const k = r.life / r.max;
        ctx.globalAlpha = 1 - k;
        ringAt(r.x, r.y, r.r * (0.4 + 0.6 * k), r.color, 3);
        ctx.globalAlpha = 1;
      }

      if (v.menu) drawMenu(v);

      // First-time hint.
      if (!v.towers.length && v.wave === 0 && !v.menu) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(clock / 300);
        kit.text("TAP A FREE CELL TO BUILD", FIELD_W / 2, BOARD_Y + BOARD_H / 2, 12, "#ffffff");
        ctx.globalAlpha = 1;
      }

      // Banner.
      if (banner) {
        banner.life += dtMs;
        const b = banner;
        if (b.life > b.max) banner = null;
        else {
          const k = Math.min(1, b.life / 200, (b.max - b.life) / 300);
          const s = 1 + (1 - Math.min(1, b.life / 200)) * 0.5;
          ctx.globalAlpha = Math.max(0, k);
          const by = BOARD_Y + BOARD_H * 0.38;
          ctx.fillStyle = p.ink;
          ctx.globalAlpha = Math.max(0, k) * 0.5;
          ctx.fillRect(0, by - 26, FIELD_W, 52);
          ctx.globalAlpha = Math.max(0, k);
          kit.text(b.text, FIELD_W / 2, by - 6, 22 * s, b.color);
          kit.text(b.sub, FIELD_W / 2, by + 16, 11, p.text);
          ctx.globalAlpha = 1;
        }
      }

      kit.fx.draw(kit, dtMs);
      // HUD bars drawn last, unshaken.
      ctx.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
      drawTop(v);
      drawBottom(v);
    },
  };
}
