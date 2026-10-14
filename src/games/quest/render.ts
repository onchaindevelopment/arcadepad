// Coin Quest renderer: parallax hills, chunky tiles, spinning coins, bears,
// ghosts and spiky rugs, with the coin mascot as the hero. All colours come
// from the coin theme (plus ink/white). Purely visual.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { FIELD_H, FIELD_W, PH, PW, ROWS, TILE, TILES, type Enemy, type QuestView } from "./index.ts";

interface Puff { x: number; y: number; vx: number; vy: number; r: number; life: number; max: number }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<QuestView> {
  const kit = makeKit(canvas, theme, FIELD_W, FIELD_H);
  const { ctx } = kit;
  const p = theme.palette;
  const others = p.bricks.filter((c) => ![p.primary, p.secondary, p.accent].includes(c));
  const bearC = others[0] ?? p.bricks[1 % p.bricks.length];
  const rugC = others[1] ?? p.bricks[2 % p.bricks.length];
  const coinC = p.accent;
  let t = 0;
  let sx = 1, sy = 1; // mascot squash / stretch
  let happyMs = 0;
  let banner = { ms: 0, title: "", sub: "" };
  let shownLevel = -1;
  let clearInfo = { bonus: 0, secs: 0 };
  let deathAt = { x: 0, y: 0 };
  let puffs: Puff[] = [];
  const padHits = new Map<string, number>(); // "c,r" -> time of bounce
  const clouds = Array.from({ length: 9 }, (_, i) => ({ x: i * 150 + Math.random() * 80, y: 20 + Math.random() * 90, s: 0.7 + Math.random() * 0.8 }));

  function puff(x: number, y: number, n: number, spread: number) {
    for (let i = 0; i < n; i++) {
      const dir = i % 2 ? 1 : -1;
      puffs.push({ x: x + dir * Math.random() * 5, y: y - 1, vx: dir * spread * (0.4 + Math.random() * 0.8), vy: -8 - Math.random() * 18, r: 1.5 + Math.random() * 2.5, life: 0, max: 260 + Math.random() * 260 });
    }
  }

  // ---------------------------------------------------------------- backdrop
  function hills(scroll: number, base: number, amp: number, freq: number, color: string, alpha: number) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, FIELD_H);
    for (let x = 0; x <= FIELD_W + 8; x += 8) {
      const wx = x + scroll;
      ctx.lineTo(x, base - Math.abs(Math.sin(wx * freq)) * amp - Math.sin(wx * freq * 0.37 + 1.3) * amp * 0.35);
    }
    ctx.lineTo(FIELD_W, FIELD_H);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  function backdrop(camX: number) {
    // Clouds
    ctx.fillStyle = "#ffffff";
    for (const c of clouds) {
      const span = FIELD_W + 200;
      const x = ((((c.x - camX * 0.08 - t * 0.004) % span) + span) % span) - 100;
      ctx.globalAlpha = 0.12;
      ctx.beginPath();
      ctx.ellipse(x, c.y, 26 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 14 * c.s, c.y - 6 * c.s, 16 * c.s, 9 * c.s, 0, 0, Math.PI * 2);
      ctx.ellipse(x - 14 * c.s, c.y - 3 * c.s, 13 * c.s, 7 * c.s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    hills(camX * 0.2, 250, 70, 0.006, p.wall, 0.55);
    hills(camX * 0.45 + 300, 300, 50, 0.011, p.secondary, 0.22);
  }

  // ---------------------------------------------------------------- tiles
  function tileAt(v: QuestView, c: number, r: number): number {
    if (c < 0 || c >= v.cols || r < 0 || r >= ROWS) return TILES.EMPTY;
    return v.tiles[r * v.cols + c];
  }
  const isGround = (k: number) => k === TILES.GROUND;

  function drawCoin(cx: number, cy: number, phase: number, size = 7) {
    const w = Math.max(1.2, Math.abs(Math.cos(t / 160 + phase)) * size);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w + 1.5, size + 1.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = coinC;
    ctx.beginPath();
    ctx.ellipse(cx, cy, w, size, 0, 0, Math.PI * 2);
    ctx.fill();
    if (w > 3) {
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.fillRect(cx - w * 0.45, cy - size * 0.55, Math.max(1, w * 0.3), size * 0.9);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(cx - 0.75, cy - size * 0.45, 1.5, size * 0.9);
    }
  }

  function drawTiles(v: QuestView) {
    const c0 = Math.max(0, Math.floor(v.camX / TILE) - 1);
    const c1 = Math.min(v.cols - 1, c0 + Math.ceil(FIELD_W / TILE) + 2);
    for (let r = 0; r < ROWS; r++) {
      for (let c = c0; c <= c1; c++) {
        const k = v.tiles[r * v.cols + c];
        if (k === TILES.EMPTY) continue;
        const x = c * TILE, y = r * TILE;
        if (k === TILES.GROUND) {
          ctx.fillStyle = p.wall;
          ctx.fillRect(x, y, TILE, TILE);
          if ((c + r) % 2 === 0) {
            ctx.fillStyle = "rgba(0,0,0,0.16)";
            ctx.fillRect(x + 4, y + 9, 3, 3);
            ctx.fillRect(x + 13, y + 15, 2, 2);
          } else {
            ctx.fillStyle = "rgba(255,255,255,0.07)";
            ctx.fillRect(x + 10, y + 6, 3, 2);
          }
          ctx.fillStyle = p.ink;
          if (!isGround(tileAt(v, c - 1, r)) && c > 0) ctx.fillRect(x, y, 1.5, TILE);
          if (!isGround(tileAt(v, c + 1, r)) && c < v.cols - 1) ctx.fillRect(x + TILE - 1.5, y, 1.5, TILE);
          if (!isGround(tileAt(v, c, r - 1))) {
            ctx.fillStyle = p.ink;
            ctx.fillRect(x, y, TILE, 7);
            ctx.fillStyle = p.primary;
            ctx.fillRect(x, y + 1, TILE, 4.5);
            ctx.fillStyle = "rgba(255,255,255,0.35)";
            ctx.fillRect(x, y + 1, TILE, 1.5);
            // tufts
            ctx.fillStyle = p.primary;
            const s = (c * 7) % 5;
            ctx.fillRect(x + 3 + s, y - 2, 2, 3);
            ctx.fillRect(x + 12 + (s % 3), y - 1.5, 2, 2);
          }
        } else if (k === TILES.STONE) {
          kit.block(x, y, TILE, TILE, p.bricks[(c * 7 + r * 3) % p.bricks.length], 3);
        } else if (k === TILES.BLOCK || k === TILES.USED) {
          let oy = 0;
          for (const b of v.bumps) {
            if (b.c === c && b.r === r) {
              const q = (v.frame - b.at) / 10;
              if (q >= 0 && q < 1) oy = -Math.sin(q * Math.PI) * 6;
            }
          }
          if (k === TILES.BLOCK) {
            const glow = 0.5 + 0.5 * Math.sin(t / 220 + c);
            kit.block(x, y + oy, TILE, TILE, p.accent, 3);
            ctx.fillStyle = `rgba(255,255,255,${0.15 + glow * 0.25})`;
            ctx.fillRect(x + 3, y + oy + 3, TILE - 6, TILE - 6);
            ctx.fillStyle = p.ink;
            ctx.beginPath();
            ctx.arc(x + 10, y + oy + 10, 5.5, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.text;
            ctx.beginPath();
            ctx.arc(x + 10, y + oy + 10, 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = p.accent;
            ctx.fillRect(x + 9, y + oy + 7, 2, 6);
          } else {
            kit.block(x, y + oy, TILE, TILE, p.wall, 3);
            ctx.fillStyle = "rgba(0,0,0,0.3)";
            for (const [dx, dy] of [[4, 4], [14, 4], [4, 14], [14, 14]]) ctx.fillRect(x + dx, y + oy + dy, 2, 2);
          }
        } else if (k === TILES.LEDGE) {
          kit.block(x - 0.5, y, TILE + 1, 9, p.secondary, 2);
          ctx.fillStyle = "rgba(0,0,0,0.2)";
          ctx.fillRect(x + 9, y + 2, 2, 5);
        } else if (k === TILES.PAD) {
          const hit = padHits.get(`${c},${r}`);
          const q = hit !== undefined ? Math.min(1, (t - hit) / 260) : 1;
          const squash = q < 1 ? Math.sin(q * Math.PI) * 6 : 0;
          kit.block(x, y + 12, TILE, 8, p.wall, 2);
          ctx.strokeStyle = p.text;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          const top = y + 5 + squash;
          const bot = y + 13;
          for (let i = 0; i <= 4; i++) ctx.lineTo(x + (i % 2 ? 6 : 14), top + ((bot - top) * i) / 4);
          ctx.stroke();
          kit.block(x - 1, top - 5 + 0.5, TILE + 2, 6, p.accent, 2);
        } else if (k === TILES.SPIKE) {
          ctx.fillStyle = p.wall;
          ctx.fillRect(x, y + 17, TILE, 3);
          for (let i = 0; i < 3; i++) {
            const bx = x + 1 + i * 6;
            ctx.fillStyle = p.ink;
            ctx.beginPath();
            ctx.moveTo(bx - 0.8, y + 18.5);
            ctx.lineTo(bx + 3, y + 7);
            ctx.lineTo(bx + 6.8, y + 18.5);
            ctx.fill();
            ctx.fillStyle = "#ffffff";
            ctx.beginPath();
            ctx.moveTo(bx + 0.8, y + 17.5);
            ctx.lineTo(bx + 3, y + 10);
            ctx.lineTo(bx + 5.2, y + 17.5);
            ctx.fill();
          }
        } else if (k === TILES.COIN) {
          drawCoin(x + 10, y + 10 + Math.sin(t / 300 + c * 0.7) * 1.2, c * 0.45);
        }
      }
    }
  }

  function drawCheckpoint(v: QuestView) {
    const { c, r, active } = v.checkpoint;
    const x = c * TILE + 6, base = (r + 1) * TILE;
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 1, base - 46, 4, 46);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x, base - 45, 2, 45);
    const wave = Math.sin(t / 160) * 2;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(x + 2, base - 45);
    ctx.lineTo(x + 20 + wave, base - 40);
    ctx.lineTo(x + 2, base - 32);
    ctx.fill();
    ctx.fillStyle = active ? p.primary : p.wall;
    ctx.beginPath();
    ctx.moveTo(x + 3, base - 43.5);
    ctx.lineTo(x + 17 + wave, base - 39.5);
    ctx.lineTo(x + 3, base - 34);
    ctx.fill();
    kit.block(x - 6, base - 5, 14, 5, p.wall, 2);
  }

  function drawFlag(v: QuestView) {
    const { c, r } = v.flag;
    const x = c * TILE + 9, base = (r + 1) * TILE, top = base - 8 * TILE;
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 1.5, top, 5, base - top);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(x - 0.5, top, 3, base - top);
    drawCoin(x + 1, top - 4, 0, 6);
    // Banner with the mascot on it.
    const fw = 40, fh = 30;
    const fy = top + 6;
    ctx.save();
    ctx.translate(x + 3, fy);
    const wave = Math.sin(t / 180);
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.quadraticCurveTo(fw / 2, -1 + wave * 3, fw + 1, -1);
    ctx.lineTo(fw + 1, fh + 1);
    ctx.quadraticCurveTo(fw / 2, fh + 1 + wave * 3, 0, fh + 1);
    ctx.fill();
    ctx.fillStyle = p.primary;
    ctx.beginPath();
    ctx.moveTo(0, 1);
    ctx.quadraticCurveTo(fw / 2, 1 + wave * 3, fw - 1, 1);
    ctx.lineTo(fw - 1, fh - 1);
    ctx.quadraticCurveTo(fw / 2, fh - 1 + wave * 3, 0, fh - 1);
    ctx.fill();
    ctx.drawImage(kit.sprites.mini, fw / 2 - 11, fh / 2 - 11 + wave * 1.5, 22, 22);
    ctx.restore();
    kit.block(x - 9, base - 8, 22, 8, p.wall, 2);
  }

  // ---------------------------------------------------------------- foes
  function drawEnemy(e: Enemy, frame: number) {
    if (!e.alive && (e.deadT < 0 || e.deadT >= 30)) return;
    const dead = !e.alive;
    const fade = dead ? 1 - e.deadT / 30 : 1;
    ctx.globalAlpha = fade;
    const cx = e.x + e.w / 2;
    const by = e.y + e.h;
    ctx.save();
    ctx.translate(cx, by);
    if (dead) ctx.scale(1.3, 0.35);
    if (e.kind === "bear") {
      const bob = e.onGround ? Math.abs(Math.sin(frame * 0.18 + e.id)) * 1.5 : 0;
      ctx.translate(0, -bob);
      // ears
      for (const s of [-1, 1]) {
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(s * 6, -17, 4.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = bearC;
        ctx.beginPath();
        ctx.arc(s * 6, -17, 3, 0, Math.PI * 2);
        ctx.fill();
      }
      kit.block(-10, -19, 20, 19, bearC, 7);
      // feet
      ctx.fillStyle = p.ink;
      const step = e.onGround ? Math.sin(frame * 0.3 + e.id) * 2 : 0;
      ctx.fillRect(-8 + step, -2, 6, 3);
      ctx.fillRect(2 - step, -2, 6, 3);
      // face
      const f = e.face;
      ctx.fillStyle = "rgba(255,255,255,0.4)";
      ctx.beginPath();
      ctx.ellipse(f * 3, -7, 5, 3.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.ink;
      ctx.fillRect(f * 3 - 1.5, -9, 3, 2);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-5 + f * 2, -14, 4, 4);
      ctx.fillRect(2 + f * 2, -14, 4, 4);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-4 + f * 3, -13, 2, 2.5);
      ctx.fillRect(3 + f * 3, -13, 2, 2.5);
      // grumpy brows
      ctx.fillRect(-6 + f * 2, -16, 5, 1.2);
      ctx.fillRect(2 + f * 2, -16, 5, 1.2);
    } else if (e.kind === "ghost") {
      const float = Math.sin(frame * 0.1 + e.id) * 1;
      ctx.translate(0, float);
      ctx.globalAlpha = fade * 0.92;
      const body = (pad: number) => {
        ctx.beginPath();
        ctx.moveTo(-8 - pad, -1);
        ctx.lineTo(-8 - pad, -9);
        ctx.arc(0, -9, 8 + pad, Math.PI, 0);
        ctx.lineTo(8 + pad, -1);
        for (let i = 0; i < 4; i++) {
          const x0 = 8 + pad - ((16 + pad * 2) * (i + 0.5)) / 4;
          const wig = Math.sin(frame * 0.25 + i) * 1.2;
          ctx.quadraticCurveTo(x0, -5 + wig, x0 - (16 + pad * 2) / 8, pad + wig * 0.5);
        }
        ctx.closePath();
      };
      ctx.fillStyle = p.ink;
      body(1.5);
      ctx.fill();
      ctx.fillStyle = p.text;
      body(0);
      ctx.fill();
      ctx.globalAlpha = fade;
      const f = e.face;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.ellipse(-3 + f * 2, -10, 2, 3, 0, 0, Math.PI * 2);
      ctx.ellipse(3 + f * 2, -10, 2, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.ellipse(f * 2, -5, 2.2, 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Spiky rug: striped mat with white spikes.
      const ripple = Math.sin(frame * 0.2 + e.id) * 1;
      kit.block(-11, -7 + ripple * 0.3, 22, 7, rugC, 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = -7; i <= 7; i += 5) ctx.fillRect(i, -5, 2, 3);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-13, -4, 2, 1);
      ctx.fillRect(11, -4, 2, 1);
      ctx.fillRect(-13, -2, 2, 1);
      ctx.fillRect(11, -2, 2, 1);
      for (let i = 0; i < 4; i++) {
        const bx = -9 + i * 5.3;
        const h = 5 + ((i + Math.floor(frame / 12)) % 2);
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.moveTo(bx - 0.8, -6);
        ctx.lineTo(bx + 2, -6 - h - 1.2);
        ctx.lineTo(bx + 4.8, -6);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.moveTo(bx + 0.5, -6.5);
        ctx.lineTo(bx + 2, -6 - h);
        ctx.lineTo(bx + 3.5, -6.5);
        ctx.fill();
      }
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(-3 + e.face * 4, -5, 2, 2);
      ctx.fillRect(1 + e.face * 4, -5, 2, 2);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- mascot
  function drawPlayer(v: QuestView) {
    const pl = v.player;
    let cx = pl.x + PW / 2;
    let by = pl.y + PH;
    let sprite = happyMs > 0 || v.state === "clear" ? kit.sprites.happy : kit.sprites.idle;
    let rot = 0;
    if (v.state === "dying") {
      const f = v.stateT;
      cx = deathAt.x;
      by = deathAt.y + PH / 2 - 4.5 * f + 0.22 * f * f;
      sprite = kit.sprites.sad;
      rot = f * 0.12;
    } else if (v.state === "over") {
      return;
    }
    if (pl.invuln > 0 && v.state === "play" && Math.floor(pl.invuln / 4) % 2 === 0) ctx.globalAlpha = 0.35;
    const size = 24;
    ctx.save();
    ctx.translate(cx, by);
    if (rot) {
      ctx.translate(0, -size / 2);
      ctx.rotate(rot);
      ctx.translate(0, size / 2);
    } else if (pl.onGround && Math.abs(pl.vx) > 0.6) {
      rot = Math.sin(v.frame * 0.45) * 0.08;
      ctx.translate(0, -Math.abs(Math.sin(v.frame * 0.45)) * 1.5);
      ctx.rotate(rot);
    }
    ctx.scale(pl.face < 0 ? -sx : sx, sy);
    // shadow-ish outline glow for readability
    ctx.drawImage(sprite, -size / 2, -size + 1, size, size);
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawPuffs(dtMs: number) {
    const dt = dtMs / 1000;
    puffs = puffs.filter((q) => (q.life += dtMs) < q.max);
    ctx.fillStyle = p.text;
    for (const q of puffs) {
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      q.vy *= 0.94;
      ctx.globalAlpha = 0.5 * (1 - q.life / q.max);
      ctx.beginPath();
      ctx.arc(q.x, q.y, q.r * (1 + q.life / q.max), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ---------------------------------------------------------------- HUD
  function hud(v: QuestView) {
    const secs = Math.ceil(v.timeLeft / 60);
    const hurry = secs <= 30 && v.state === "play";
    // coins
    drawCoin(FIELD_W - 120, 16, t / 400, 6);
    kit.text(`x${v.coins}`, FIELD_W - 110, 17, 11, p.text, "left");
    // timer
    const tc = hurry && Math.floor(t / 250) % 2 === 0 ? p.accent : p.text;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(FIELD_W - 56, 16, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = tc;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(FIELD_W - 56, 16, 6, 0, Math.PI * 2);
    ctx.moveTo(FIELD_W - 56, 16);
    ctx.lineTo(FIELD_W - 56, 12);
    ctx.moveTo(FIELD_W - 56, 16);
    ctx.lineTo(FIELD_W - 53, 16);
    ctx.stroke();
    kit.text(String(secs), FIELD_W - 46, 17, 11, tc, "left");
    kit.text(`STAGE ${v.level + 1}`, 12, 17, 10, p.text, "left");

    if (banner.ms > 0) {
      const a = Math.min(1, banner.ms / 400);
      ctx.globalAlpha = a;
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(0, FIELD_H / 2 - 44, FIELD_W, 70);
      kit.text(banner.title, FIELD_W / 2, FIELD_H / 2 - 22, 20, p.primary);
      kit.text(banner.sub, FIELD_W / 2, FIELD_H / 2 + 4, 11, p.text);
      ctx.globalAlpha = 1;
    }
    if (v.state === "clear") {
      const a = Math.min(1, v.stateT / 20);
      ctx.globalAlpha = a;
      kit.text("STAGE CLEAR!", FIELD_W / 2, FIELD_H / 2 - 50, 22, p.primary);
      kit.text(`+1000   TIME BONUS +${clearInfo.bonus}`, FIELD_W / 2, FIELD_H / 2 - 24, 11, p.text);
      ctx.globalAlpha = 1;
    }
    if (v.level === 0 && v.state === "play" && v.frame < 60 * 7) {
      const a = Math.min(1, (60 * 7 - v.frame) / 60);
      ctx.globalAlpha = a;
      kit.text(v.pointerMode ? "HOLD LEFT / RIGHT OF THE HERO TO RUN" : "ARROWS / A D TO RUN", FIELD_W / 2, FIELD_H - 34, 10, p.text);
      kit.text(v.pointerMode ? "TAP ON OR ABOVE IT TO JUMP (HOLD = HIGHER)" : "UP / SPACE TO JUMP (HOLD = HIGHER)", FIELD_W / 2, FIELD_H - 20, 10, p.text);
      ctx.globalAlpha = 1;
    }
    if (secs <= 30 && v.state === "play" && secs > 27) kit.text("HURRY!", FIELD_W / 2, 50, 16, p.accent);
  }

  return {
    onEvents(events: readonly GameEvent[], v: QuestView) {
      for (const e of events) {
        const x = e.x ?? 0, y = e.y ?? 0;
        switch (e.t) {
          case "jump":
            sx = 0.78; sy = 1.25;
            puff(x, y, 4, 22);
            break;
          case "land":
            sx = 1.3; sy = 0.72;
            puff(x, y, 6, 30);
            break;
          case "bounce":
            sx = 0.7; sy = 1.35;
            padHits.set(`${e.c as number},${e.r as number}`, t);
            kit.fx.burst(x, y, p.accent, 10, 120, 300);
            break;
          case "coin":
            kit.fx.burst(x, y, coinC, 8, 90, 200);
            kit.fx.popup(x, y - 8, `+${e.pts as number}`, p.text);
            happyMs = 250;
            break;
          case "block":
            kit.fx.burst(x, y - 6, coinC, 14, 130, 380);
            kit.fx.popup(x, y - 16, `+${e.pts as number}`, coinC);
            happyMs = 300;
            break;
          case "head":
            kit.fx.burst(x, y, p.text, 4, 50, 300);
            break;
          case "stomp":
            kit.fx.burst(x, y, e.kind === "ghost" ? p.text : bearC, 14, 150, 380);
            kit.fx.popup(x, y - 12, `+${e.pts as number}`, p.primary);
            kit.fx.addShake(3);
            sx = 1.25; sy = 0.8;
            happyMs = 400;
            break;
          case "checkpoint":
            kit.fx.burst(x, y, p.primary, 18, 160, 300);
            kit.fx.popup(x, y - 30, "CHECKPOINT", p.primary);
            break;
          case "die":
            deathAt = { x, y };
            kit.fx.addShake(8);
            kit.fx.flash();
            kit.fx.burst(x, y, p.secondary, 18, 170);
            break;
          case "respawn":
            kit.fx.burst(x, y, p.primary, 14, 120, 0);
            break;
          case "clear":
            clearInfo = { bonus: e.bonus as number, secs: e.secs as number };
            for (let i = 0; i < 5; i++) kit.fx.burst(x, y - 40 - i * 20, p.bricks[i % p.bricks.length], 14, 200);
            break;
          case "hurry":
            kit.fx.flash("255,200,60");
            break;
        }
      }
      if (v.level !== shownLevel) {
        shownLevel = v.level;
        banner = { ms: 2200, title: `STAGE ${v.level + 1}`, sub: v.lap > 0 ? `${v.name.toUpperCase()} - LAP ${v.lap + 1}` : v.name.toUpperCase() };
      }
    },
    draw(v, dtMs) {
      t += dtMs;
      if (v.level !== shownLevel) {
        shownLevel = v.level;
        banner = { ms: 2200, title: `STAGE ${v.level + 1}`, sub: v.lap > 0 ? `${v.name.toUpperCase()} - LAP ${v.lap + 1}` : v.name.toUpperCase() };
      }
      banner.ms = Math.max(0, banner.ms - dtMs);
      happyMs = Math.max(0, happyMs - dtMs);
      const k = Math.min(1, dtMs / 90);
      sx += (1 - sx) * k;
      sy += (1 - sy) * k;

      kit.background(dtMs);
      backdrop(v.camX);
      ctx.save();
      ctx.translate(-Math.round(v.camX), 0);
      drawTiles(v);
      drawCheckpoint(v);
      drawFlag(v);
      for (const m of v.platforms) {
        if (m.x + m.w < v.camX - 10 || m.x > v.camX + FIELD_W + 10) continue;
        kit.block(m.x, m.y, m.w, 10, p.secondary, 3);
        const arrows = m.vertical ? ["^", "v"] : ["<", ">"];
        kit.text(arrows[0], m.x + 10, m.y + 5.5, 8, p.text);
        kit.text(arrows[1], m.x + m.w - 10, m.y + 5.5, 8, p.text);
      }
      for (const e of v.enemies) if (e.active || e.x < v.camX + FIELD_W + 30) drawEnemy(e, v.frame);
      drawPuffs(dtMs);
      drawPlayer(v);
      kit.fx.draw(kit, dtMs);
      ctx.restore();
      hud(v);
    },
  };
}
