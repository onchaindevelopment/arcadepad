// Ball Barrage renderer: chunky numbered tiles in the coin's palette, coin
// balls, the mascot as the launcher, dotted aim guide and lots of juice.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import {
  BALL_R, CELL, COLS, FIELD_H, FIELD_W, FLOOR, GAP, LAUNCH_Y, LEFT, PICK_R, RIGHT, ROWS, TOP,
  traceGuide, type BarrageView,
} from "./index.ts";

const BANDS = [4, 8, 14, 22, 34, 50, 75, 110];

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<BarrageView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const p = theme.palette;
  const bricks = p.bricks.length ? p.bricks : [p.primary, p.secondary, p.accent];
  const flash = new Map<number, number>(); // block id -> ms of white flash left
  const squash = new Map<number, number>();
  let t = 0;
  let happyMs = 0;
  let sadMs = 0;
  let launchMs = 0;
  let speedPop = 0;

  const colorFor = (hp: number) => {
    let band = 0;
    while (band < BANDS.length && hp > BANDS[band]) band++;
    return bricks[band % bricks.length];
  };

  function coin(x: number, y: number, r: number, alpha = 1) {
    const { ctx } = kit;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.arc(x, y, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.fillRect(x - r * 0.55, y - r * 0.6, r * 0.5, r * 0.35);
    ctx.globalAlpha = 1;
  }

  return {
    onEvents(events: readonly GameEvent[], v) {
      for (const e of events) {
        if (e.t === "hit") {
          flash.set(e.id as number, 90);
          squash.set(e.id as number, 120);
          if (Math.random() < 0.5) kit.fx.burst(e.x!, e.y!, p.text, 2, 60, 200);
        } else if (e.t === "break") {
          const col = colorFor(e.max as number);
          kit.fx.burst(e.x!, e.y!, col, 16, 170);
          kit.fx.burst(e.x!, e.y!, "#ffffff", 5, 120);
          kit.fx.popup(e.x!, e.y! - 6, "+1", p.primary);
          kit.fx.addShake((e.max as number) >= 20 ? 4 : 2);
          happyMs = 500;
        } else if (e.t === "pickup") {
          kit.fx.burst(e.x!, e.y!, p.primary, 12, 140, 0);
          kit.fx.popup(e.x!, e.y! - 12, "+1 BALL", p.primary);
        } else if (e.t === "launch") {
          launchMs = 200;
        } else if (e.t === "land") {
          kit.fx.burst(e.x!, FLOOR - 1, p.accent, 6, 80);
        } else if (e.t === "wall") {
          kit.fx.burst(e.x!, e.y!, p.secondary, 2, 50, 0);
        } else if (e.t === "speed") {
          speedPop = 900;
        } else if (e.t === "clear") {
          kit.fx.flash("255,255,255");
          for (let i = 0; i < 5; i++) kit.fx.burst(LEFT + Math.random() * (RIGHT - LEFT), TOP + 60 + Math.random() * 200, bricks[i % bricks.length], 12, 200);
          kit.fx.popup(FIELD_W / 2, FIELD_H / 2, "BOARD CLEAR!", p.primary);
        } else if (e.t === "milestone") {
          kit.fx.popup(FIELD_W / 2, FIELD_H / 2 - 20, `TURN ${e.turn as number}!`, p.accent);
          for (let i = 0; i < 4; i++) kit.fx.burst(LEFT + Math.random() * (RIGHT - LEFT), FIELD_H * 0.5, bricks[i % bricks.length], 10, 200);
        } else if (e.t === "danger") {
          sadMs = 600;
          kit.fx.addShake(2);
        } else if (e.t === "over") {
          kit.fx.flash();
          kit.fx.addShake(10);
          for (const b of v.blocks) if (b.r === ROWS - 1) kit.fx.burst(LEFT + b.c * CELL + CELL / 2, TOP + b.r * CELL + CELL / 2, p.secondary, 14, 200);
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      happyMs = Math.max(0, happyMs - dtMs);
      sadMs = Math.max(0, sadMs - dtMs);
      launchMs = Math.max(0, launchMs - dtMs);
      speedPop = Math.max(0, speedPop - dtMs);
      for (const [k, ms] of flash) {
        if (ms - dtMs <= 0) flash.delete(k);
        else flash.set(k, ms - dtMs);
      }
      for (const [k, ms] of squash) {
        if (ms - dtMs <= 0) squash.delete(k);
        else squash.set(k, ms - dtMs);
      }
      const { ctx } = kit;
      kit.background(dtMs);

      // Playfield frame: side walls, ceiling, danger row and floor.
      ctx.fillStyle = p.wall;
      ctx.fillRect(0, TOP - 4, LEFT, FLOOR - TOP + 4);
      ctx.fillRect(RIGHT, TOP - 4, FIELD_W - RIGHT, FLOOR - TOP + 4);
      ctx.fillRect(0, TOP - 4, FIELD_W, 4);
      ctx.fillStyle = "rgba(255,255,255,0.03)";
      for (let r = 1; r < ROWS; r++) for (let c = r & 1; c < COLS; c += 2) ctx.fillRect(LEFT + c * CELL, TOP + r * CELL, CELL, CELL);
      const dangerY = TOP + (ROWS - 1) * CELL;
      const near = v.blocks.some((b) => b.r >= ROWS - 2);
      ctx.globalAlpha = near ? 0.18 + 0.12 * Math.sin(t / 150) : 0.08;
      ctx.fillStyle = p.secondary;
      for (let x = LEFT - 50; x < RIGHT; x += 16) {
        ctx.beginPath();
        ctx.moveTo(x, FLOOR);
        ctx.lineTo(x + 8, FLOOR);
        ctx.lineTo(x + 8 + CELL, dangerY);
        ctx.lineTo(x + CELL, dangerY);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = p.wall;
      ctx.fillRect(0, FLOOR, FIELD_W, FIELD_H - FLOOR);
      ctx.fillStyle = p.ink;
      ctx.fillRect(0, FLOOR, FIELD_W, 2);

      // Top bar
      kit.text(`TURN ${v.turn}`, 12, 22, 14, p.text, "left");
      kit.text(`${v.score}`, FIELD_W - 12, 22, 16, p.primary, "right");
      kit.text(`BROKEN ${v.broken}`, 12, 42, 9, p.text, "left");
      if (v.phase === "fly" && v.speed > 1) kit.text(`>> x${v.speed}`, FIELD_W / 2, 30, 12 + (speedPop > 0 ? 4 * (speedPop / 900) : 0), p.accent);

      // Blocks + pickups slide down during the shift phase.
      const ease = 1 - (1 - v.shiftT) * (1 - v.shiftT);
      const off = v.phase === "shift" ? -(1 - ease) * CELL : 0;
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, TOP, FIELD_W, FLOOR - TOP);
      ctx.clip();
      for (const pk of v.pickups) {
        const cx = LEFT + pk.c * CELL + CELL / 2;
        const cy = TOP + pk.r * CELL + CELL / 2 + off;
        const pr = PICK_R + Math.sin(t / 180 + pk.c) * 1.5;
        ctx.strokeStyle = p.ink;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, pr, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 1;
        kit.text("+1", cx, cy + 1, 9, p.primary);
      }
      for (const b of v.blocks) {
        const sq = (squash.get(b.id) ?? 0) / 120;
        const shrink = sq * 2.5;
        const x = LEFT + b.c * CELL + GAP + shrink;
        const y = TOP + b.r * CELL + GAP + off + shrink;
        const s = CELL - 2 * GAP - 2 * shrink;
        const col = colorFor(b.hp);
        kit.block(x, y, s, s, col, 7);
        // Damage cracks: a darker inner fill growing as hp drops.
        const dmg = 1 - b.hp / b.max;
        if (dmg > 0) {
          ctx.fillStyle = `rgba(0,0,0,${0.12 + dmg * 0.18})`;
          ctx.fillRect(x + 4, y + s - 4 - (s - 8) * dmg * 0.6, s - 8, (s - 8) * dmg * 0.6);
        }
        if (flash.has(b.id)) {
          ctx.fillStyle = `rgba(255,255,255,${(flash.get(b.id)! / 90) * 0.55})`;
          ctx.beginPath();
          ctx.roundRect(x + 1.5, y + 1.5, s - 3, s - 3, 7);
          ctx.fill();
        }
        const size = b.hp >= 1000 ? 11 : b.hp >= 100 ? 14 : 18;
        kit.text(String(b.hp), x + s / 2, y + s / 2 + 1, size, "#ffffff");
      }
      ctx.restore();

      // Aim guide: dots to the first bounce, fainter after.
      if (v.showGuide) {
        const pts = traceGuide(v);
        const phase = (t / 40) % 12;
        for (let i = 0; i + 1 < pts.length; i++) {
          const a = pts[i];
          const b = pts[i + 1];
          const len = Math.hypot(b.x - a.x, b.y - a.y);
          ctx.fillStyle = i === 0 ? p.text : p.accent;
          ctx.globalAlpha = i === 0 ? 0.9 : 0.55;
          for (let d = i === 0 ? phase + 10 : phase; d < len; d += 12) {
            const k = d / len;
            const r = i === 0 ? 2.2 : 1.7 * (1 - d / (len + 20));
            ctx.beginPath();
            ctx.arc(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, Math.max(0.8, r), 0, Math.PI * 2);
            ctx.fill();
          }
          if (i === 0 && pts.length > 2) {
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = p.text;
            ctx.beginPath();
            ctx.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
            ctx.stroke();
          }
        }
        ctx.globalAlpha = 1;
      }

      // Balls
      for (const s of v.shots) coin(s.x, s.y, BALL_R, s.landed ? 0.8 : 1);

      // Launcher: the mascot sits on the floor, a coin ready on its head.
      const lx = v.launcherX;
      const sprite = v.phase === "over" || sadMs > 0 ? kit.sprites.sad : happyMs > 0 ? kit.sprites.happy : kit.sprites.idle;
      const bob = Math.sin(t / 260) * 1.2;
      const hop = launchMs > 0 ? -3 * (launchMs / 200) : 0;
      const ms = 34;
      ctx.drawImage(sprite, lx - ms / 2, FLOOR + 4 + bob + hop, ms, ms);
      if (v.phase === "aim") coin(lx, LAUNCH_Y, BALL_R + 0.5);
      if (v.queued > 0) {
        const left = lx > FIELD_W - 70;
        kit.text(`x${v.queued}`, lx + (left ? -24 : 24), FLOOR + 22, 12, p.text, left ? "right" : "left");
      }
      if (v.phase === "fly" && v.firstLanded) {
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(t / 90);
        ctx.fillStyle = p.accent;
        ctx.fillRect(v.nextX - 6, FLOOR - 2, 12, 3);
        ctx.globalAlpha = 1;
      }
      if (v.gained > 0) kit.text(`+${v.gained}`, FIELD_W / 2, FLOOR + 30, 11, p.primary);

      // Hints
      if (v.phase === "aim" && v.turn <= 2 && !v.aim.dragging) {
        ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 300);
        kit.text("DRAG UP TO AIM, RELEASE TO FIRE", FIELD_W / 2, FLOOR - 70, 10, p.text);
        kit.text("OR  < >  +  SPACE", FIELD_W / 2, FLOOR - 54, 9, p.text);
        ctx.globalAlpha = 1;
      }
      if (v.phase === "aim" && v.aim.dragging && !v.aim.valid) kit.text("AIM HIGHER", FIELD_W / 2, FLOOR - 60, 11, p.accent);

      kit.fx.draw(kit, dtMs);
    },
  };
}
