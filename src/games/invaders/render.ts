// FUD Defense renderer: original pixel critters, coin piles, bonus whale and
// the coin mascot on a hover-pad. All colours come from the theme palette.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { CELL_H, CELL_W, EH, EW, H, PLAYER_Y, PW, W, WHALE_H, WHALE_W, type InvadersView } from "./index.ts";

// 12x10 critter grids, two walk poses each. X = body, Y = trim, k = ink, w = white.
const GRIDS: string[][][] = [
  // 0: grumpy bear
  [
    [".kk......kk.", "kXXk....kXXk", "kXXXkkkkXXXk", "kXkkXXXXkkXk", "kXwkXXXXkwXk", "kXXXXYYXXXXk", "kXXXkkkkXXXk", ".kXXXXXXXXk.", ".kXk.kk.kXk.", ".kk......kk."],
    [".kk......kk.", "kXXk....kXXk", "kXXXkkkkXXXk", "kXkkXXXXkkXk", "kXwkXXXXkwXk", "kXXXXYYXXXXk", "kXXXkkkkXXXk", ".kXXXXXXXXk.", "..kXk..kXk..", "...kk..kk..."],
  ],
  // 1: paper-hand ghost (little paper hands flap)
  [
    ["...kkkkkk...", "..kXXXXXXk..", ".kXXXXXXXXk.", ".kXwkXXwkXk.", "wkXXXXXXXXkw", "wkXXXkkXXXkw", ".kXXkYYkXXk.", ".kXXXXXXXXk.", ".kXkXXkXXkk.", ".k.kk.k.kk.."],
    ["...kkkkkk...", "..kXXXXXXk..", "wkXXXXXXXXkw", "wkXwkXXwkXkw", ".kXXXXXXXXk.", ".kXXXkkXXXk.", ".kXXkYYkXXk.", ".kXXXXXXXXk.", ".kkXXkXXkXk.", "..kk.k.kk.k."],
  ],
  // 2: rug monster (fringed carpet with teeth)
  [
    ["k.k.k.k.k.k.", "kkkkkkkkkkkk", "kXYXYXYXYXYk", "kXwwXXXXwwXk", "kXwkXXXXkwXk", "kXXXXXXXXXXk", "kkwkwkwkwkwk", "kXYXYXYXYXYk", "kkkkkkkkkkkk", "k.k.k.k.k.k."],
    [".k.k.k.k.k.k", "kkkkkkkkkkkk", "kYXYXYXYXYXk", "kXwwXXXXwwXk", "kXkwXXXXwkXk", "kXXXXXXXXXXk", "kwkwkwkwkwkk", "kYXYXYXYXYXk", "kkkkkkkkkkkk", ".k.k.k.k.k.k"],
  ],
];
const GRID_W = 12;
const GRID_H = 10;
const POWER_LABEL = ["x2", "S", "Z"];
const POWER_NAME = ["DOUBLE SHOT", "SHIELD", "SLOW-MO"];

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<InvadersView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const brick = (i: number) => p.bricks[i % p.bricks.length] ?? p.primary;
  const coin = brick(4);
  const body = [brick(1), p.text, brick(0)];
  const trim = [p.accent, p.secondary, brick(2)];
  const whaleC = brick(3);

  // Pre-render critter sprites at 4x for crisp scaling.
  const SCALE = 4;
  const sprites = GRIDS.map((poses, kind) =>
    poses.map((rows) => {
      const c = document.createElement("canvas");
      c.width = GRID_W * SCALE;
      c.height = GRID_H * SCALE;
      const g = c.getContext("2d")!;
      rows.forEach((row, y) =>
        [...row].forEach((ch, x) => {
          if (ch === ".") return;
          g.fillStyle = ch === "k" ? p.ink : ch === "w" ? "#ffffff" : ch === "Y" ? trim[kind] : body[kind];
          g.fillRect(x * SCALE, y * SCALE, SCALE, SCALE);
        }),
      );
      return c;
    }),
  );

  let t = 0;
  let muzzle = 0;
  let muzzleDouble = false;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;
  let banner = "";
  let bannerT = 0;
  const flashes: { x: number; y: number; life: number }[] = []; // enemy fire sparks

  function drawCoinCell(x: number, y: number, hp: number) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x, y, CELL_W, CELL_H, 3);
    ctx.fill();
    ctx.fillStyle = coin;
    ctx.globalAlpha = hp >= 2 ? 1 : 0.55;
    ctx.beginPath();
    ctx.roundRect(x + 1, y + 1, CELL_W - 2, CELL_H - 2, 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.fillRect(x + 2, y + 2, CELL_W - 4, 1);
    if (hp < 2) {
      ctx.fillStyle = p.ink;
      ctx.fillRect(x + 4, y + 3, 2, 2);
      ctx.fillRect(x + 7, y + 4, 2, 1);
    }
  }

  function drawWhale(x: number, y: number, dir: number) {
    ctx.save();
    ctx.translate(x, y + Math.sin(t / 180) * 2);
    ctx.scale(dir, 1);
    const hw = WHALE_W / 2, hh = WHALE_H / 2;
    // tail
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(-hw + 6, 0);
    ctx.lineTo(-hw - 12, -10 + Math.sin(t / 120) * 3);
    ctx.lineTo(-hw - 8, 0);
    ctx.lineTo(-hw - 12, 10 - Math.sin(t / 120) * 3);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.beginPath();
    ctx.ellipse(0, 0, hw + 1.5, hh + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = whaleC;
    ctx.beginPath();
    ctx.ellipse(0, 0, hw, hh, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.ellipse(2, hh * 0.45, hw * 0.7, hh * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
    // eye and grin
    ctx.fillStyle = p.ink;
    ctx.fillRect(hw - 14, -4, 4, 4);
    ctx.fillRect(hw - 10, 4, 8, 2);
    // spout
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 3; i++) {
      const k = ((t / 300 + i / 3) % 1);
      ctx.globalAlpha = 1 - k;
      ctx.fillRect(4 + (i - 1) * 5 * k * 2, -hh - 4 - k * 14, 3, 3);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    kit.text("?", x, y - WHALE_H, 10, coin);
  }

  function drawBolt(x: number, y: number, kind: number) {
    ctx.save();
    ctx.translate(x, y);
    if (kind === 0) {
      // jagged growl bolt
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 4;
      const zig = () => {
        ctx.beginPath();
        ctx.moveTo(0, -7);
        ctx.lineTo(3, -3);
        ctx.lineTo(-3, 1);
        ctx.lineTo(2, 7);
        ctx.stroke();
      };
      zig();
      ctx.strokeStyle = body[0];
      ctx.lineWidth = 2;
      zig();
    } else if (kind === 1) {
      // fluttering paper note
      ctx.rotate(Math.sin(t / 90 + x) * 0.6);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-4, -5, 8, 10);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-3, -4, 6, 8);
      ctx.fillStyle = trim[1];
      ctx.fillRect(-2, -2, 4, 1);
      ctx.fillRect(-2, 1, 4, 1);
    } else {
      // spinning rug tassel
      ctx.rotate(t / 80);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-4.5, -4.5, 9, 9);
      ctx.fillStyle = trim[2];
      ctx.fillRect(-3, -3, 6, 6);
    }
    ctx.restore();
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        const x = e.x ?? 0, y = e.y ?? 0;
        switch (e.t) {
          case "shot":
            muzzle = 90;
            muzzleDouble = e.double === true;
            break;
          case "eshot":
            flashes.push({ x, y, life: 120 });
            break;
          case "kill": {
            const k = e.kind as number;
            kit.fx.burst(x, y, body[k], 14, 170);
            kit.fx.burst(x, y, trim[k], 6, 120);
            kit.fx.burst(x, y, p.ink, 4, 90);
            kit.fx.popup(x, y - 8, `+${e.points as number}`, p.text);
            kit.fx.addShake(2);
            break;
          }
          case "chip":
            kit.fx.burst(x, y, coin, e.gone ? 8 : 4, 90, 500);
            break;
          case "whale":
            kit.fx.burst(x, y, whaleC, 26, 230);
            kit.fx.burst(x, y, "#ffffff", 12, 160);
            kit.fx.popup(x, y + 6, `+${e.points as number}`, coin);
            kit.fx.addShake(6);
            kit.fx.flash("255,255,255");
            mood = "happy"; moodT = 900;
            break;
          case "power":
            kit.fx.burst(x, y, coin, 16, 160);
            kit.fx.popup(x, y - 14, POWER_NAME[e.kind as number], p.text);
            mood = "happy"; moodT = 900;
            break;
          case "shieldpop":
            kit.fx.burst(x, y, whaleC, 18, 180);
            kit.fx.addShake(3);
            break;
          case "hit":
            kit.fx.burst(x, y, p.primary, 22, 220);
            kit.fx.burst(x, y, p.ink, 10, 150);
            kit.fx.addShake(10);
            kit.fx.flash();
            mood = "sad"; moodT = 1600;
            break;
          case "invaded":
            kit.fx.addShake(12);
            kit.fx.flash();
            mood = "sad"; moodT = 5000;
            break;
          case "stepdown":
            kit.fx.addShake(1.5);
            break;
          case "waveclear":
            for (let i = 0; i < 6; i++) kit.fx.burst(60 + Math.random() * (W - 120), H * 0.45, brick(i), 12, 220);
            banner = `WAVE CLEAR  +${e.bonus as number}`;
            bannerT = 1800;
            mood = "happy"; moodT = 1500;
            break;
          case "wave":
            banner = `WAVE ${(e.wave as number) + 1}`;
            bannerT = 1200;
            break;
          case "gameover":
            mood = "sad"; moodT = 1e9;
            break;
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);

      // Ground strip under the pad
      ctx.fillStyle = p.wall;
      ctx.fillRect(0, H - 14, W, 14);
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(0, H - 14, W, 2);

      // Coin piles
      for (const c of v.cells) drawCoinCell(c.x, c.y, c.hp);

      // Formation: walk pose + per-column bob
      for (const c of v.critters) {
        const bob = Math.round(Math.sin(t / 260 + c.col * 0.7) * 1.5);
        const spr = sprites[c.kind][v.pose];
        ctx.drawImage(spr, c.x, c.y + bob - 1, EW, EH + 1);
      }

      // Whale
      if (v.whale) drawWhale(v.whale.x, v.whale.y, v.whale.dir);

      // Enemy fire sparks + bolts
      for (let i = flashes.length - 1; i >= 0; i--) {
        const f = flashes[i];
        f.life -= dtMs;
        if (f.life <= 0) { flashes.splice(i, 1); continue; }
        ctx.globalAlpha = f.life / 120;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(f.x - 3, f.y - 1, 6, 3);
        ctx.globalAlpha = 1;
      }
      for (const s of v.eshots) drawBolt(s.x, s.y, s.kind);

      // Player bullets
      for (const b of v.bullets) {
        ctx.fillStyle = p.ink;
        ctx.fillRect(b.x - 2.5, b.y - 7, 5, 14);
        ctx.fillStyle = b.kind ? coin : p.primary;
        ctx.fillRect(b.x - 1.5, b.y - 6, 3, 12);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(b.x - 0.5, b.y - 6, 1, 5);
      }

      // Power-up coins
      for (const d of v.drops) {
        const wob = Math.abs(Math.cos(t / 160 + d.x)) * 8 + 1;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, wob + 1.5, 9.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = coin;
        ctx.beginPath();
        ctx.ellipse(d.x, d.y, wob, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        if (wob > 5) kit.text(POWER_LABEL[d.kind], d.x, d.y + 1, 8, p.ink);
      }

      // Player: hover-pad + mascot
      const px = Math.round(v.player.x);
      const blink = v.player.invuln > 0 && Math.floor(t / 90) % 2 === 0;
      if (v.player.alive && !blink) {
        // thruster
        const fl = 3 + Math.random() * 4;
        ctx.fillStyle = p.accent;
        ctx.fillRect(px - 12, PLAYER_Y + 6, 5, fl);
        ctx.fillRect(px + 7, PLAYER_Y + 6, 5, fl);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(px - 11, PLAYER_Y + 6, 3, fl / 2);
        ctx.fillRect(px + 8, PLAYER_Y + 6, 3, fl / 2);
        const hover = Math.round(Math.sin(t / 220) * 1.5);
        kit.block(px - PW / 2, PLAYER_Y - 4 + hover, PW, 11, p.secondary, 4);
        if (moodT > 0) moodT -= dtMs;
        const spr = moodT > 0 && mood === "sad" ? kit.sprites.sad : moodT > 0 && mood === "happy" ? kit.sprites.happy : kit.sprites.idle;
        ctx.drawImage(spr, px - 16, PLAYER_Y - 34 + hover, 32, 32);
        if (v.power.shield > 0) {
          ctx.strokeStyle = whaleC;
          ctx.lineWidth = 2;
          ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t / 120);
          ctx.beginPath();
          ctx.arc(px, PLAYER_Y - 14, 27, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      } else if (!v.player.alive) {
        ctx.drawImage(kit.sprites.sad, px - 16, PLAYER_Y - 30, 32, 32);
      }

      // Muzzle flash
      if (muzzle > 0) {
        muzzle -= dtMs;
        const a = Math.max(0, muzzle / 90);
        ctx.globalAlpha = a;
        for (const ox of muzzleDouble ? [-9, 9] : [0]) {
          ctx.fillStyle = "#ffffff";
          ctx.beginPath();
          ctx.arc(px + ox, PLAYER_Y - 30, 5 + (1 - a) * 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = p.primary;
          ctx.fillRect(px + ox - 7, PLAYER_Y - 31, 14, 2);
          ctx.fillRect(px + ox - 1, PLAYER_Y - 38, 2, 14);
        }
        ctx.globalAlpha = 1;
      }

      // Slow-mo tint
      if (v.power.slow > 0) {
        ctx.fillStyle = "rgba(120,200,255,0.07)";
        ctx.fillRect(0, 0, W, H);
      }

      kit.fx.draw(kit, dtMs);

      // Active power-up timers
      let row = 0;
      const timers: [string, number, number][] = [["x2", v.power.double, 600], ["SHIELD", v.power.shield, 900], ["SLOW", v.power.slow, 420]];
      for (const [label, left, max] of timers) {
        if (left <= 0) continue;
        const y = H - 30 - row * 14;
        kit.text(label, 8, y, 9, p.text, "left");
        ctx.fillStyle = p.ink;
        ctx.fillRect(56, y - 3, 62, 7);
        ctx.fillStyle = coin;
        ctx.fillRect(57, y - 2, (60 * left) / max, 5);
        row++;
      }

      // Banners
      if (v.ready > 0 && v.frame < 70) kit.text("HOLD THE LINE!", W / 2, H * 0.62, 18, p.text);
      if (bannerT > 0) {
        bannerT -= dtMs;
        ctx.globalAlpha = Math.min(1, bannerT / 300);
        kit.text(banner, W / 2, H * 0.55, 22, coin);
        ctx.globalAlpha = 1;
      }
    },
  };
}
