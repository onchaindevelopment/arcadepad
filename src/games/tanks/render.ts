// Tank Duel renderer: rolling dirt hills in the coin's palette (cached and
// redrawn only when craters change them), a round coin-tank with the mascot
// peeking out of the hatch, a grumpy bear tank, shell trails, blast rings,
// dirt sprays, damage popups, wind gauge and aim guide.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit, RENDER_SCALE, type Kit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BARREL, FIELD_H, FIELD_W, FLOOR, TURRET_DY, WEAPONS, W_BOMB, W_ROLLER, aimPreview, type TankView, type TanksView } from "./index.ts";

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<TanksView> {
  const kit: Kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary];
  let t = 0;

  // Terrain cache.
  const land = document.createElement("canvas");
  land.width = FIELD_W * RENDER_SCALE;
  land.height = FIELD_H * RENDER_SCALE;
  const lctx = land.getContext("2d")!;
  let landVer = -1;

  const rings: { x: number; y: number; r: number; life: number; max: number }[] = [];
  const trails: { x: number; y: number; life: number }[] = [];
  const smoke: { x: number; y: number; life: number }[] = [];
  let mood: [number, number] = [0, 0]; // per tank: >0 happy frames, <0 sad frames

  const disc = (c: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) => {
    c.fillStyle = color;
    c.beginPath();
    c.arc(x, y, Math.max(0.5, r), 0, Math.PI * 2);
    c.fill();
  };
  const odisc = (x: number, y: number, r: number, color: string) => {
    disc(ctx, x, y, r + 1.5, p.ink);
    disc(ctx, x, y, r, color);
  };

  function drawLand(v: TanksView) {
    const c = lctx;
    c.setTransform(RENDER_SCALE, 0, 0, RENDER_SCALE, 0, 0);
    c.clearRect(0, 0, FIELD_W, FIELD_H);
    const { top, gapA, gapB } = v.terr;
    const g = c.createLinearGradient(0, 120, 0, FIELD_H);
    g.addColorStop(0, p.wall);
    g.addColorStop(1, p.bg);
    // Dirt body.
    c.fillStyle = g;
    for (let x = 0; x < FIELD_W; x++) {
      if (gapB[x] > gapA[x]) {
        c.fillRect(x, top[x], 1, gapA[x] - top[x]);
        c.fillRect(x, gapB[x], 1, FIELD_H - gapB[x]);
      } else c.fillRect(x, top[x], 1, FIELD_H - top[x]);
    }
    // Strata speckles.
    c.fillStyle = "rgba(0,0,0,0.18)";
    for (let x = 0; x < FIELD_W; x += 3) {
      for (let y = 150 + ((x * 37) % 23); y < FIELD_H; y += 22) {
        if (y > top[x] + 8 && !(y >= gapA[x] && y < gapB[x])) c.fillRect(x, y, 2, 2);
      }
    }
    // Ink edge + grassy crust on the surface.
    c.fillStyle = p.ink;
    for (let x = 0; x < FIELD_W; x++) c.fillRect(x, top[x] - 1.5, 1, 1.5);
    c.fillStyle = p.primary;
    for (let x = 0; x < FIELD_W; x++) c.fillRect(x, top[x], 1, 3);
    c.fillStyle = "rgba(255,255,255,0.3)";
    for (let x = 0; x < FIELD_W; x++) c.fillRect(x, top[x], 1, 1);
    // Bedrock.
    c.fillStyle = p.ink;
    c.fillRect(0, FLOOR, FIELD_W, FIELD_H - FLOOR);
  }

  function barrel(x: number, y: number, angle: number, color: string) {
    const a = (angle / 256) * Math.PI * 2;
    const bx = x + Math.cos(a) * BARREL, by = y - TURRET_DY + Math.sin(a) * BARREL;
    ctx.lineCap = "round";
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(x, y - TURRET_DY);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x, y - TURRET_DY);
    ctx.lineTo(bx, by);
    ctx.stroke();
  }

  function treads(x: number, y: number) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.roundRect(x - 14, y - 7, 28, 8, 4);
    ctx.fill();
    for (let i = -10; i <= 10; i += 5) disc(ctx, x + i, y - 3, 1.6, p.wall);
  }

  function drawPlayer(tk: TankView, v: TanksView) {
    const { x } = tk;
    const y = Math.round(tk.y);
    const dead = tk.hp <= 0;
    const body = dead ? p.wall : p.primary;
    barrel(x, y, tk.angle, dead ? p.wall : p.accent);
    // Mascot head in the hatch.
    const m = mood[0];
    const spr = dead || v.dead ? kit.sprites.sad : m > 0 ? kit.sprites.happy : m < 0 ? kit.sprites.sad : kit.sprites.mini;
    const bob = dead ? 3 : Math.sin(t / 260) * 1;
    ctx.drawImage(spr, x - 9, y - 30 + bob, 18, 18);
    // Hull: a round coin dome.
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(x, y - 7, 15, 9, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = body;
    ctx.beginPath();
    ctx.ellipse(x, y - 7, 13.5, 7.5, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.fillRect(x - 8, y - 13, 7, 2);
    // Coin emblem on the side.
    odisc(x + 6, y - 9, 3, p.accent);
    treads(x, y);
  }

  function drawBear(tk: TankView, v: TanksView) {
    const { x } = tk;
    const y = Math.round(tk.y);
    const dead = tk.hp <= 0;
    const body = dead ? p.wall : p.secondary;
    barrel(x, y, tk.angle, dead ? p.wall : bricks[3 % bricks.length]);
    // Bear head in the hatch.
    const hy = y - 20 + (dead ? 4 : Math.sin(t / 300 + 1) * 1);
    odisc(x - 6, hy - 6, 3, body);
    odisc(x + 6, hy - 6, 3, body);
    odisc(x, hy, 7.5, body);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.ellipse(x - 1, hy + 3, 4, 3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    if (dead) {
      ctx.fillRect(x - 5, hy - 2, 3, 1);
      ctx.fillRect(x + 1, hy - 2, 3, 1);
    } else {
      const glare = mood[1] < 0 ? 1 : 0;
      ctx.fillRect(x - 5, hy - 2 + glare, 2, 2);
      ctx.fillRect(x + 2, hy - 2 + glare, 2, 2);
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x - 6, hy - 5);
      ctx.lineTo(x - 2, hy - 3);
      ctx.moveTo(x + 5, hy - 5);
      ctx.lineTo(x + 1, hy - 3);
      ctx.stroke();
    }
    ctx.fillRect(x - 2, hy + 2, 3, 2);
    // Boxy hull with a bear-claw stripe.
    kit.block(x - 15, y - 15, 30, 10, body, 3);
    ctx.fillStyle = p.ink;
    for (let i = 0; i < 3; i++) ctx.fillRect(x - 8 + i * 4, y - 12, 2, 4);
    treads(x, y);
    void v;
  }

  function hpBar(tk: TankView, color: string) {
    const w = 34, x = tk.x - w / 2, y = Math.round(tk.y) - 44;
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 1, y - 1, w + 2, 6);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(x, y, w, 4);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, (w * Math.max(0, tk.hp)) / tk.maxHp, 4);
    kit.text(String(tk.hp), tk.x, y - 6, 8, p.text);
  }

  function windGauge(v: TanksView) {
    const cx = FIELD_W / 2, y = 16;
    kit.text("WIND", cx, y, 9, p.text);
    const len = Math.abs(v.wind) * 5;
    const dir = Math.sign(v.wind);
    ctx.fillStyle = p.ink;
    ctx.fillRect(cx - 52, y + 9, 104, 6);
    ctx.fillStyle = "rgba(255,255,255,0.15)";
    ctx.fillRect(cx - 51, y + 10, 102, 4);
    if (dir !== 0) {
      ctx.fillStyle = p.accent;
      ctx.fillRect(dir > 0 ? cx : cx - len, y + 10, len, 4);
      const tip = cx + dir * len;
      ctx.beginPath();
      ctx.moveTo(tip + dir * 5, y + 12);
      ctx.lineTo(tip, y + 7);
      ctx.lineTo(tip, y + 17);
      ctx.closePath();
      ctx.fill();
    }
    kit.text(dir === 0 ? "CALM" : String(Math.abs(v.wind)), cx + 70, y + 12, 9, p.text);
  }

  function hudPanels(v: TanksView) {
    const me = v.tanks[0];
    const deg = Math.round(((256 - me.angle) * 360) / 256);
    kit.text(`ANGLE ${deg}`, 10, FIELD_H - 26, 10, p.text, "left");
    kit.text(`POWER ${me.power}`, 10, FIELD_H - 12, 10, p.text, "left");
    const w = WEAPONS[me.weapon];
    kit.text(w.name + (w.ammo >= 0 ? ` x${me.ammo[me.weapon]}` : ""), FIELD_W - 10, FIELD_H - 26, 10, p.accent, "right");
    kit.text(`DUEL ${v.duel + 1}`, FIELD_W - 10, FIELD_H - 12, 10, p.text, "right");
  }

  return {
    onEvents(events: readonly GameEvent[], v: TanksView) {
      for (const e of events) {
        if (e.t === "boom") {
          const r = e.r as number;
          rings.push({ x: e.x!, y: e.y!, r, life: 0, max: e.big ? 600 : 380 });
          kit.fx.burst(e.x!, e.y!, p.accent, e.big ? 30 : 14, e.big ? 260 : 170);
          kit.fx.burst(e.x!, e.y!, p.wall, e.big ? 26 : 12, 150);
          kit.fx.burst(e.x!, e.y!, p.primary, 6, 120);
          kit.fx.addShake((e.shake as number) ?? 4);
          if (e.big) kit.fx.flash("255,240,200");
        } else if (e.t === "hit") {
          const i = e.tank as number;
          kit.fx.popup(e.x!, e.y!, `-${e.dmg as number}`, i === 1 ? p.primary : p.accent);
          kit.fx.burst(e.x!, e.y! + 12, i === 1 ? p.secondary : p.primary, 10, 160);
          mood = i === 1 ? [90, -90] : [-90, 90];
          if (i === 0) kit.fx.flash();
        } else if (e.t === "fire") {
          kit.fx.burst(e.x!, e.y!, "#ffffff", 6, 90, 0);
        } else if (e.t === "land") {
          kit.fx.burst(e.x!, e.y!, p.wall, 8, 80);
        } else if (e.t === "duelWon") {
          for (let i = 0; i < 6; i++) kit.fx.burst(e.x! + (Math.random() - 0.5) * 60, e.y! - 10, bricks[i % bricks.length], 14, 230);
          kit.fx.popup(e.x!, e.y! - 40, "+1000", p.primary);
        } else if (e.t === "dead") {
          kit.fx.burst(e.x!, e.y!, p.secondary, 26, 220);
          kit.fx.addShake(10);
          kit.fx.flash();
        } else if (e.t === "duel") {
          rings.length = 0;
          trails.length = 0;
          mood = [0, 0];
        }
      }
      void v;
    },
    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);

      // Soft moon.
      ctx.globalAlpha = 0.12;
      disc(ctx, 520, 70, 40, p.text);
      ctx.globalAlpha = 0.5;
      disc(ctx, 520, 70, 26, p.text);
      ctx.globalAlpha = 1;

      if (v.terrVer !== landVer) {
        drawLand(v);
        landVer = v.terrVer;
      }
      ctx.drawImage(land, 0, 0, FIELD_W, FIELD_H);

      // Shell trails.
      for (const s of v.shells) trails.push({ x: s.x, y: s.y, life: 350 });
      for (let i = trails.length - 1; i >= 0; i--) {
        const q = trails[i];
        q.life -= dtMs;
        if (q.life <= 0) {
          trails.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = (q.life / 350) * 0.5;
        disc(ctx, q.x, q.y, 1.5, p.text);
      }
      ctx.globalAlpha = 1;

      // Tanks.
      const [me, bear] = v.tanks;
      drawBear(bear, v);
      drawPlayer(me, v);
      hpBar(me, p.primary);
      hpBar(bear, p.accent);
      for (const [i, tk] of v.tanks.entries()) {
        if (tk.hp <= 0 && Math.random() < dtMs / 120) smoke.push({ x: tk.x + (Math.random() - 0.5) * 10, y: tk.y - 14, life: 1200 });
        void i;
      }
      for (let i = smoke.length - 1; i >= 0; i--) {
        const s = smoke[i];
        s.life -= dtMs;
        s.y -= dtMs * 0.02;
        if (s.life <= 0) {
          smoke.splice(i, 1);
          continue;
        }
        ctx.globalAlpha = (s.life / 1200) * 0.35;
        disc(ctx, s.x, s.y, 3 + (1 - s.life / 1200) * 6, p.ink);
      }
      ctx.globalAlpha = 1;
      mood = [mood[0] - Math.sign(mood[0]), mood[1] - Math.sign(mood[1])];

      // Aim guide (first arc segment only) on the player's turn.
      if (v.phase === "aim" && v.turn === 0) {
        const pts = aimPreview(me.x, me.y, me.angle, me.power, 8 + Math.round(me.power / 10));
        for (let i = 2; i < pts.length; i += 2) {
          ctx.globalAlpha = 1 - i / pts.length;
          odisc(pts[i], pts[i + 1], v.dragging ? 2 : 1.5, i % 4 === 0 ? p.text : p.accent);
        }
        ctx.globalAlpha = 1;
        if (v.dragging) {
          ctx.strokeStyle = p.accent;
          ctx.globalAlpha = 0.35;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(me.x, me.y - TURRET_DY, 18 + me.power * 0.9, 0, Math.PI * 2);
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
      }

      // Shells.
      for (const s of v.shells) {
        const r = s.w === W_BOMB ? 5 : s.w === W_ROLLER ? 3.5 : 3;
        odisc(s.x, s.y - (s.roll ? 2 : 0), r, s.w === W_BOMB ? p.accent : s.w === W_ROLLER ? p.secondary : p.text);
      }

      // Blast rings.
      for (let i = rings.length - 1; i >= 0; i--) {
        const q = rings[i];
        q.life += dtMs;
        if (q.life >= q.max) {
          rings.splice(i, 1);
          continue;
        }
        const f = q.life / q.max;
        ctx.globalAlpha = 1 - f;
        disc(ctx, q.x, q.y, q.r * (0.4 + f * 0.8), f < 0.25 ? "#ffffff" : p.accent);
        ctx.strokeStyle = p.text;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.r * (0.6 + f * 1.1), 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      windGauge(v);
      hudPanels(v);

      // Banners.
      if (v.phase === "aim" && v.phaseT < 70) {
        const msg = v.turn === 0 ? (v.turnNo === 0 ? `DUEL ${v.duel + 1}: YOUR SHOT` : "YOUR TURN") : "BEAR IS AIMING...";
        kit.text(msg, FIELD_W / 2, 64, 16, v.turn === 0 ? p.primary : p.accent);
        if (v.turn === 0 && v.turnNo === 0 && v.duel === 0) kit.text("DRAG FROM YOUR TANK TO AIM, RELEASE TO FIRE", FIELD_W / 2, 84, 9, p.text);
      } else if (v.phase === "duelWon") {
        kit.text("BEAR BUSTED!", FIELD_W / 2, 90, 22, p.primary);
        kit.text("A TOUGHER BEAR ROLLS IN...", FIELD_W / 2, 116, 10, p.text);
      } else if (v.dead) {
        kit.text("TANK DOWN", FIELD_W / 2, 100, 22, p.accent);
      }

      kit.fx.draw(kit, dtMs);
    },
  };
}
