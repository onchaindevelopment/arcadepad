// Canvas renderer: draws an engine GameView in a theme pack's look.
// Purely visual; nothing here feeds back into the deterministic engine.
import { BRICK_H, BRICK_W, FIELD_H, FIELD_W, type BrickView, type ExtraKind, type GameEvent, type GameView } from "@/engine/types";
import type { ThemePack } from "@/themes/types";
import { gridToCanvas } from "@/themes/pixel";

const SCALE = 2; // backing-store pixels per field unit

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
}
interface Popup {
  x: number;
  y: number;
  text: string;
  life: number;
  color: string;
}
interface Mote {
  x: number;
  y: number;
  s: number;
  v: number;
  p: number;
  c: string;
}

const GOOD: Partial<Record<ExtraKind, boolean>> = {
  score200: true, score500: true, score1000: true, score2000: true, score5000: true, score10000: true,
  goldshower: true, lengthen: true, life: true, slime: true, metal: true, ball: true, wall: true,
  weapon: true, slow: true, joker: true, timeadd: true, explosive: true, bonusmagnet: true,
};
const LABEL: Record<ExtraKind, string> = {
  score200: "200", score500: "500", score1000: "1K", score2000: "2K", score5000: "5K", score10000: "10K",
  goldshower: "$$", shorten: "><", lengthen: "<>", life: "+1", slime: "GOO", metal: "MTL", ball: "x2",
  wall: "WALL", frozen: "ICE", weapon: "PEW", random: "??", fast: "FST", slow: "SLW", joker: "JKR",
  darkness: "DRK", chaos: "CHS", ghost: "GHO", disable: "OFF", timeadd: "+T", explosive: "BOOM",
  bonusmagnet: "MAG", malusmagnet: "MAG", weakball: "WEAK",
};
export const isGoodExtra = (k: ExtraKind) => !!GOOD[k];
export const extraLabel = (k: ExtraKind) => LABEL[k];

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private ball: HTMLCanvasElement;
  private particles: Particle[] = [];
  private popups: Popup[] = [];
  private motes: Mote[] = [];
  private shake = 0;
  private flash = 0;
  private t = 0;
  private hitFlash = new Map<number, number>(); // brick cell -> remaining ms
  private font = "monospace";

  constructor(private canvas: HTMLCanvasElement, private theme: ThemePack) {
    canvas.width = FIELD_W * SCALE;
    canvas.height = FIELD_H * SCALE;
    this.ctx = canvas.getContext("2d")!;
    const silk = getComputedStyle(document.documentElement).getPropertyValue("--font-silk").trim();
    if (silk) this.font = `${silk}, monospace`;
    this.ball = gridToCanvas(theme.mascot.mini, theme.pixels, 4);
    const p = theme.palette;
    const cols = [p.primary, p.secondary, p.accent, p.text];
    for (let i = 0; i < 46; i++) {
      this.motes.push({ x: Math.random() * FIELD_W, y: Math.random() * FIELD_H, s: 1 + Math.random() * 2.5, v: 6 + Math.random() * 18, p: Math.random() * 6.28, c: cols[i % cols.length] });
    }
  }

  /** Feed the step's events to spawn juice. */
  events(evts: GameEvent[]) {
    const p = this.theme.palette;
    for (const e of evts) {
      switch (e.t) {
        case "brickhit":
          this.hitFlash.set(e.row * 100 + e.col, 120);
          break;
        case "brickgone": {
          const cx = e.col * BRICK_W + BRICK_W / 2;
          const cy = e.row * BRICK_H + BRICK_H / 2;
          const color = this.brickColor(e.id, e.kind);
          for (let i = 0; i < 10; i++) this.spark(cx, cy, color, 60 + Math.random() * 120);
          break;
        }
        case "explode":
          this.shake = Math.max(this.shake, 7);
          for (let i = 0; i < 18; i++) this.spark(e.col * BRICK_W + 20, e.row * BRICK_H + 10, i % 2 ? p.accent : "#ffffff", 120 + Math.random() * 200);
          break;
        case "paddle":
          for (let i = 0; i < 4; i++) this.spark(e.x, e.y, p.primary, 40 + Math.random() * 60, -1);
          break;
        case "extra":
          this.popups.push({ x: e.x, y: e.y - 8, text: LABEL[e.kind], life: 900, color: e.good ? p.primary : p.secondary });
          break;
        case "lifelost":
          this.flash = 1;
          this.shake = Math.max(this.shake, 9);
          break;
        case "levelclear":
          for (let i = 0; i < 60; i++) this.spark(Math.random() * FIELD_W, FIELD_H * 0.6, p.bricks[i % p.bricks.length], 150 + Math.random() * 250, -1);
          break;
      }
    }
  }

  private spark(x: number, y: number, color: string, speed: number, upBias = 0) {
    const a = Math.random() * Math.PI * 2;
    const vy = Math.sin(a) * speed + upBias * speed * 0.8;
    this.particles.push({ x, y, vx: Math.cos(a) * speed, vy, life: 0, max: 380 + Math.random() * 380, color, size: 2 + Math.random() * 3 });
  }

  private brickColor(id: number, kind: BrickView["kind"]): string {
    const p = this.theme.palette;
    if (kind === "wall" || id === 0) return p.wall;
    if (id === 1) return "#9AA7B8"; // only a metal ball breaks it
    if (kind === "explosive") return p.accent;
    if (kind === "chaos") return p.secondary;
    return p.bricks[id % p.bricks.length];
  }

  draw(v: GameView, dtMs: number) {
    const ctx = this.ctx;
    const p = this.theme.palette;
    this.t += dtMs;
    ctx.setTransform(SCALE, 0, 0, SCALE, 0, 0);
    ctx.imageSmoothingEnabled = false;

    // Background
    const g = ctx.createLinearGradient(0, 0, 0, FIELD_H);
    g.addColorStop(0, p.bg2);
    g.addColorStop(1, p.bg);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, FIELD_W, FIELD_H);
    this.drawBackdrop(dtMs);

    ctx.save();
    if (this.shake > 0) {
      ctx.translate((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake);
      this.shake = Math.max(0, this.shake - dtMs * 0.03);
    }

    // Frame walls are implicit in the engine (cols 0 and 15, row 0).
    for (let r = 0; r < 23; r++) {
      this.drawBrick(FRAME(0, r), dtMs);
      this.drawBrick(FRAME(15, r), dtMs);
    }
    for (let c = 1; c < 15; c++) this.drawBrick(FRAME(c, 0), dtMs);
    for (const b of v.bricks) this.drawBrick(b, dtMs);
    if (v.floor) {
      ctx.fillStyle = p.primary;
      ctx.globalAlpha = 0.85 + Math.sin(this.t / 120) * 0.15;
      ctx.fillRect(BRICK_W, FIELD_H - 5, FIELD_W - BRICK_W * 2, 5);
      ctx.globalAlpha = 1;
    }
    for (const s of v.shots) {
      ctx.fillStyle = p.accent;
      ctx.fillRect(s.x - 1.5, s.y - 6, 3, 12);
      ctx.fillStyle = "#fff";
      ctx.fillRect(s.x - 0.5, s.y - 6, 1, 5);
    }
    for (const e of v.extras) this.drawExtra(e.kind, e.x, e.y);
    this.drawPaddle(v);
    for (const b of v.balls) {
      const size = b.r * 2 + 6;
      if (b.explosive) {
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.35 + Math.sin(this.t / 60) * 0.15;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      if (b.metal) {
        ctx.strokeStyle = "#e8eef5";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r + 3, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = b.weak ? 0.55 : 1;
      ctx.drawImage(this.ball, b.x - size / 2, b.y - size / 2, size, size);
      ctx.globalAlpha = 1;
    }
    this.drawParticles(dtMs);
    ctx.restore();

    if (v.darkness) {
      ctx.fillStyle = "rgba(0,0,0,0.82)";
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      ctx.globalCompositeOperation = "destination-out";
      for (const b of v.balls) {
        const rg = ctx.createRadialGradient(b.x, b.y, 4, b.x, b.y, 70);
        rg.addColorStop(0, "rgba(0,0,0,1)");
        rg.addColorStop(1, "rgba(0,0,0,0)");
        ctx.fillStyle = rg;
        ctx.fillRect(b.x - 70, b.y - 70, 140, 140);
      }
      ctx.globalCompositeOperation = "source-over";
    }
    if (this.flash > 0) {
      ctx.fillStyle = `rgba(255,60,100,${this.flash * 0.35})`;
      ctx.fillRect(0, 0, FIELD_W, FIELD_H);
      this.flash = Math.max(0, this.flash - dtMs / 400);
    }
  }

  private drawBackdrop(dtMs: number) {
    const ctx = this.ctx;
    const kind = this.theme.backdrop;
    for (const m of this.motes) {
      if (kind === "bubbles") {
        m.y -= (m.v * dtMs) / 1000;
        if (m.y < -6) m.y = FIELD_H + 6;
        ctx.strokeStyle = m.c;
        ctx.globalAlpha = 0.22;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(m.x + Math.sin(this.t / 900 + m.p) * 4, m.y, m.s * 2, 0, Math.PI * 2);
        ctx.stroke();
      } else if (kind === "confetti") {
        m.y += (m.v * dtMs) / 1000;
        if (m.y > FIELD_H + 6) m.y = -6;
        ctx.fillStyle = m.c;
        ctx.globalAlpha = 0.28;
        ctx.save();
        ctx.translate(m.x + Math.sin(this.t / 700 + m.p) * 6, m.y);
        ctx.rotate(this.t / 600 + m.p);
        ctx.fillRect(-m.s, -m.s / 2, m.s * 2, m.s);
        ctx.restore();
      } else {
        ctx.fillStyle = m.c === this.theme.palette.text ? "#ffffff" : m.c;
        ctx.globalAlpha = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.t / 500 + m.p));
        ctx.fillRect(Math.round(m.x), Math.round(m.y), m.s > 2.5 ? 2 : 1, m.s > 2.5 ? 2 : 1);
      }
    }
    ctx.globalAlpha = 1;
  }

  private drawBrick(b: BrickView, dtMs: number) {
    if (!b.visible) return;
    const ctx = this.ctx;
    const p = this.theme.palette;
    const x = b.col * BRICK_W;
    const y = b.row * BRICK_H;
    const key = b.row * 100 + b.col;
    const hf = this.hitFlash.get(key) ?? 0;
    if (hf > 0) this.hitFlash.set(key, hf - dtMs);
    else if (hf) this.hitFlash.delete(key);

    if (b.kind === "wall") {
      ctx.fillStyle = p.wall;
      ctx.fillRect(x, y, BRICK_W, BRICK_H);
      ctx.fillStyle = "rgba(255,255,255,0.10)";
      ctx.fillRect(x, y, BRICK_W, 2);
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(x, y + BRICK_H - 2, BRICK_W, 2);
      ctx.fillRect(x + BRICK_W - 1, y, 1, BRICK_H);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(x + 4, y + 4, 2, 2);
      ctx.fillRect(x + BRICK_W - 6, y + BRICK_H - 6, 2, 2);
      return;
    }
    const color = this.brickColor(b.id, b.kind);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x + 1, y + 1, BRICK_W - 2, BRICK_H - 2);
    ctx.fillStyle = hf > 0 ? "#ffffff" : color;
    ctx.fillRect(x + 2, y + 2, BRICK_W - 4, BRICK_H - 4);
    // bevel
    ctx.fillStyle = "rgba(255,255,255,0.38)";
    ctx.fillRect(x + 2, y + 2, BRICK_W - 4, 3);
    ctx.fillStyle = "rgba(0,0,0,0.22)";
    ctx.fillRect(x + 2, y + BRICK_H - 5, BRICK_W - 4, 3);

    ctx.fillStyle = p.ink;
    if (b.id === 1) {
      ctx.fillRect(x + 5, y + 8, 3, 3);
      ctx.fillRect(x + BRICK_W - 8, y + 8, 3, 3);
    }
    if (b.kind === "explosive") {
      ctx.fillRect(x + 19, y + 5, 2, 7);
      ctx.fillRect(x + 19, y + 13, 2, 2);
    } else if (b.kind === "grow") {
      ctx.fillRect(x + 16, y + 9, 8, 2);
      ctx.fillRect(x + 19, y + 6, 2, 8);
    } else if (b.kind === "heal") {
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(this.t / 200);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x + 6, y + 8, 28, 3);
      ctx.globalAlpha = 1;
    } else if (b.kind === "chaos") {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      for (let i = 0; i < 4; i++) ctx.fillRect(x + 4 + i * 9, y + 6, 4, 8);
    }
    if (b.hp > 1) {
      for (let i = 0; i < Math.min(b.hp - 1, 4); i++) {
        ctx.fillStyle = p.ink;
        ctx.fillRect(x + 5 + i * 5, y + BRICK_H - 8, 3, 3);
      }
    }
  }

  private drawExtra(kind: ExtraKind, x: number, y: number) {
    const ctx = this.ctx;
    const p = this.theme.palette;
    const good = GOOD[kind];
    const w = 36;
    const h = 16;
    const bob = Math.sin(this.t / 140 + x) * 1.2;
    ctx.fillStyle = p.ink;
    roundRect(ctx, x - w / 2 - 1.5, y - h / 2 - 1.5 + bob, w + 3, h + 3, 9);
    ctx.fillStyle = good ? p.primary : p.secondary;
    roundRect(ctx, x - w / 2, y - h / 2 + bob, w, h, 8);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    roundRect(ctx, x - w / 2 + 3, y - h / 2 + 2 + bob, w - 6, 3, 2);
    ctx.fillStyle = p.ink;
    ctx.font = `bold 9px ${this.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(LABEL[kind], x, y + 1 + bob);
  }

  private drawPaddle(v: GameView) {
    const ctx = this.ctx;
    const p = this.theme.palette;
    const pd = v.paddle;
    ctx.globalAlpha = pd.ghost ? 0.45 : 1;
    ctx.fillStyle = p.ink;
    roundRect(ctx, pd.x - 2, pd.y - 2, pd.w + 4, pd.h + 4, (pd.h + 4) / 2);
    ctx.fillStyle = pd.frozen ? "#bfefff" : p.primary;
    roundRect(ctx, pd.x, pd.y, pd.w, pd.h, pd.h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    roundRect(ctx, pd.x + 6, pd.y + 2, pd.w - 12, 3, 2);
    if (pd.sticky) {
      ctx.fillStyle = p.accent;
      for (let i = 8; i < pd.w - 6; i += 12) ctx.fillRect(pd.x + i, pd.y + pd.h - 1, 3, 4 + ((i / 12) % 2) * 3);
    }
    if (pd.weapon) {
      ctx.fillStyle = p.ink;
      ctx.fillRect(pd.x + 4, pd.y - 6, 4, 6);
      ctx.fillRect(pd.x + pd.w - 8, pd.y - 6, 4, 6);
    }
    if (pd.w >= 50) {
      ctx.fillStyle = p.ink;
      ctx.font = `bold ${pd.w >= 70 ? 8 : 7}px ${this.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`$${this.theme.coin.ticker}`, pd.x + pd.w / 2, pd.y + pd.h / 2 + 1);
    }
    ctx.globalAlpha = 1;
  }

  private drawParticles(dtMs: number) {
    const ctx = this.ctx;
    const dt = dtMs / 1000;
    this.particles = this.particles.filter((q) => (q.life += dtMs) < q.max);
    for (const q of this.particles) {
      q.vy += 420 * dt;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      ctx.globalAlpha = 1 - q.life / q.max;
      ctx.fillStyle = q.color;
      ctx.fillRect(q.x, q.y, q.size, q.size);
    }
    this.popups = this.popups.filter((q) => (q.life -= dtMs) > 0);
    ctx.textAlign = "center";
    ctx.font = `bold 12px ${this.font}`;
    for (const q of this.popups) {
      q.y -= 30 * dt;
      ctx.globalAlpha = Math.min(1, q.life / 400);
      ctx.fillStyle = this.theme.palette.ink;
      ctx.fillText(q.text, q.x + 1, q.y + 1);
      ctx.fillStyle = q.color;
      ctx.fillText(q.text, q.x, q.y);
    }
    ctx.globalAlpha = 1;
  }
}

const FRAME = (col: number, row: number): BrickView => ({ col, row, kind: "wall", id: 0, hp: -1, visible: true });

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, h / 2, w / 2));
  ctx.fill();
}
