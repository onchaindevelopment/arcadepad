// Star Swarm renderer: parallax starfield and nebula clouds, the coin mascot
// in a cockpit ship, original FUD drones and mothership. Palette-only colours.
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { BOSS_HW, CHAIN_FRAMES, H, MAGNET_FRAMES, SHIELD_FRAMES, W, WEAPON, type SwarmView } from "./index.ts";

const DROP_LABEL = ["S", "L", "+", "M", "B"];
const DROP_NAME = ["SPREAD SHOT", "LASER", "SHIELD", "COIN MAGNET", "SMART BOMB"];
const WEAPON_NAME = ["BLASTER", "SPREAD", "LASER"];
const TAU = Math.PI * 2;

interface Ring { x: number; y: number; r: number; grow: number; life: number; max: number; color: string; width: number }
interface Timed { at: number; fn: () => void }

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<SwarmView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const brick = (i: number) => p.bricks[i % p.bricks.length] ?? p.primary;
  const coinC = brick(4);
  const kindC = [brick(0), brick(1), brick(2), brick(3)];
  const dropC = [brick(1), brick(3), brick(5), coinC, p.accent];

  // Parallax layers (purely visual randomness).
  const stars = [0, 1, 2].map((layer) =>
    Array.from({ length: [46, 26, 12][layer] }, () => ({ x: Math.random() * W, y: Math.random() * H, tw: Math.random() * TAU })),
  );
  const STAR_SPEED = [12, 30, 70]; // px per second
  const mkCloud = (far: boolean) => ({
    x: Math.random() * W,
    y: Math.random() * H,
    s: far ? 50 + Math.random() * 60 : 30 + Math.random() * 40,
    c: [p.secondary, p.bg2, p.accent, p.primary][Math.floor(Math.random() * 4)],
    blobs: Array.from({ length: 4 }, () => ({ dx: (Math.random() - 0.5) * 1.6, dy: (Math.random() - 0.5) * 0.6, r: 0.45 + Math.random() * 0.4 })),
  });
  const farClouds = Array.from({ length: 5 }, () => mkCloud(true));
  const nearClouds = Array.from({ length: 3 }, () => mkCloud(false));

  let t = 0;
  let mood: "happy" | "sad" | null = null;
  let moodT = 0;
  let bank = 0;
  let lastX = W / 2;
  let muzzle = 0;
  let banner = "";
  let bannerT = 0;
  let bannerC = p.text;
  const rings: Ring[] = [];
  const timed: Timed[] = [];
  const sparks: { x: number; y: number; life: number }[] = [];

  function ring(x: number, y: number, color: string, grow: number, max = 500, width = 3, r = 6) {
    rings.push({ x, y, r, grow, life: 0, max, color, width });
  }
  function say(s: string, ms: number, color = p.text) {
    banner = s;
    bannerT = ms;
    bannerC = color;
  }

  // ---------------------------------------------------------------- backdrop

  function cloud(c: ReturnType<typeof mkCloud>, alpha: number) {
    ctx.fillStyle = c.c;
    ctx.globalAlpha = alpha;
    for (const b of c.blobs) {
      ctx.beginPath();
      ctx.ellipse(c.x + b.dx * c.s, c.y + b.dy * c.s, c.s * b.r * 1.3, c.s * b.r, 0, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function backdrop(dtMs: number) {
    const dt = dtMs / 1000;
    for (const c of farClouds) {
      c.y += 20 * dt;
      if (c.y - c.s * 1.5 > H) { Object.assign(c, mkCloud(true)); c.y = -c.s * 1.5; }
      cloud(c, 0.08);
    }
    stars.forEach((layer, li) => {
      for (const s of layer) {
        s.y += STAR_SPEED[li] * dt;
        if (s.y > H + 4) { s.y = -4; s.x = Math.random() * W; }
        const a = li === 0 ? 0.35 : li === 1 ? 0.6 : 0.9;
        ctx.globalAlpha = a * (0.6 + 0.4 * Math.sin(t / 300 + s.tw));
        ctx.fillStyle = li === 2 ? "#ffffff" : li === 1 ? p.text : p.secondary;
        if (li === 2) ctx.fillRect(s.x, s.y, 1.5, 6);
        else ctx.fillRect(s.x, s.y, li + 1, li + 1);
      }
    });
    ctx.globalAlpha = 1;
  }

  function foreground(dtMs: number) {
    const dt = dtMs / 1000;
    for (const c of nearClouds) {
      c.y += 110 * dt;
      if (c.y - c.s * 1.5 > H) { Object.assign(c, mkCloud(false)); c.y = -c.s * 1.5; }
      cloud(c, 0.07);
    }
  }

  // ---------------------------------------------------------------- actors

  function eye(x: number, y: number, r: number, tx: number, ty: number, iris: string) {
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x, y, r + 1.2, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    const a = Math.atan2(ty - y, tx - x);
    const k = r * 0.4;
    ctx.fillStyle = iris;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * k, y + Math.sin(a) * k, r * 0.55, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(x + Math.cos(a) * k, y + Math.sin(a) * k, r * 0.28, 0, TAU);
    ctx.fill();
  }

  function outlined(path: () => void, fill: string, lw = 3) {
    path();
    ctx.lineJoin = "round";
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = lw;
    ctx.stroke();
    ctx.fillStyle = fill;
    ctx.fill();
  }

  function drawEnemy(e: SwarmView["enemies"][number], sx: number, sy: number) {
    const c = e.flash > 0 ? "#ffffff" : kindC[e.kind];
    ctx.save();
    ctx.translate(e.x, e.y);
    if (e.kind === 0) {
      // Gnat: round bug with buzzing wings and a stinger.
      const flap = 0.35 + 0.65 * Math.abs(Math.sin(t / 40 + e.id));
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 1.5;
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(side * 8, -4, 7, 4 * flap + 1, side * 0.5, 0, TAU);
        ctx.fill();
        ctx.stroke();
      }
      outlined(() => { ctx.beginPath(); ctx.moveTo(-3, 6); ctx.lineTo(0, 13); ctx.lineTo(3, 6); ctx.closePath(); }, p.ink, 1);
      outlined(() => { ctx.beginPath(); ctx.arc(0, 0, 7.5, 0, TAU); }, c);
      eye(0, -0.5, 3.6, sx, sy, p.accent);
    } else if (e.kind === 1) {
      // Spinner: toothed disc with one angry eye.
      const rot = t / 160 + e.id;
      outlined(() => {
        ctx.beginPath();
        for (let i = 0; i < 12; i++) {
          const a = rot + (i * TAU) / 12;
          const r = i % 2 ? 9 : 13;
          ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
        }
        ctx.closePath();
      }, c);
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.beginPath();
      ctx.arc(0, 0, 7.5, 0, TAU);
      ctx.fill();
      eye(0, 0, 5, sx, sy, p.secondary);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-6, -7, 12, 2);
    } else if (e.kind === 2) {
      // Brute: armoured hexagon, two eyes, scowl, hp pips.
      const wob = Math.sin(t / 220 + e.id) * 0.06;
      ctx.rotate(wob);
      outlined(() => {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (i * TAU) / 6 + Math.PI / 6;
          ctx.lineTo(Math.cos(a) * 21, Math.sin(a) * 19);
        }
        ctx.closePath();
      }, c, 4);
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.fillRect(-12, -15, 24, 3);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(-15, 8, 30, 4);
      eye(-7, -3, 5, sx, sy, p.accent);
      eye(7, -3, 5, sx, sy, p.accent);
      ctx.fillStyle = p.ink;
      ctx.save();
      ctx.rotate(0.35); ctx.fillRect(-14, -12, 9, 2.5);
      ctx.restore();
      ctx.save();
      ctx.rotate(-0.35); ctx.fillRect(5, -12, 9, 2.5);
      ctx.restore();
      ctx.fillRect(-6, 7, 12, 2.5);
      ctx.rotate(-wob);
      if (e.hp < e.maxHp) {
        ctx.fillStyle = p.ink;
        ctx.fillRect(-16, 23, 32, 5);
        ctx.fillStyle = p.primary;
        ctx.fillRect(-15, 24, (30 * e.hp) / e.maxHp, 3);
      }
    } else {
      // Darter: kite that points where it flies, with an exhaust flicker.
      const a = e.vx === 0 && e.vy === 0 ? Math.PI / 2 : Math.atan2(e.vy, e.vx);
      ctx.rotate(a);
      ctx.fillStyle = p.accent;
      ctx.globalAlpha = 0.6 + Math.random() * 0.4;
      ctx.beginPath();
      ctx.moveTo(-8, -3); ctx.lineTo(-16 - Math.random() * 6, 0); ctx.lineTo(-8, 3);
      ctx.fill();
      ctx.globalAlpha = 1;
      outlined(() => {
        ctx.beginPath();
        ctx.moveTo(13, 0); ctx.lineTo(-6, -10); ctx.lineTo(-2, 0); ctx.lineTo(-6, 10);
        ctx.closePath();
      }, c);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(2, -2, 5, 4);
      ctx.fillStyle = p.ink;
      ctx.fillRect(5, -1, 2, 2);
    }
    ctx.restore();
  }

  function drawBoss(b: NonNullable<SwarmView["boss"]>, sx: number, sy: number) {
    const hot = b.flash > 0;
    const body = hot ? "#ffffff" : b.phase === 2 ? p.accent : b.phase === 1 ? brick(1) : p.secondary;
    ctx.save();
    ctx.translate(b.x, b.y);
    // Phase-3 aura
    if (b.phase === 2) {
      ctx.globalAlpha = 0.18 + 0.12 * Math.sin(t / 90);
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.ellipse(0, 0, 76, 48, 0, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    // Side cannons
    for (const side of [-1, 1]) {
      kit.block(side * 44 - 9, -2, 18, 22, hot ? "#ffffff" : p.wall, 4);
      ctx.fillStyle = p.ink;
      ctx.fillRect(side * 44 - 4, 16, 8, 6);
    }
    // Spiky crown
    outlined(() => {
      ctx.beginPath();
      for (let i = 0; i <= 8; i++) {
        const x = -44 + i * 11;
        ctx.lineTo(x, -22 - (i % 2 ? 14 : 2) - (i === 4 ? 6 : 0));
      }
      ctx.lineTo(44, -10);
      ctx.lineTo(-44, -10);
      ctx.closePath();
    }, hot ? "#ffffff" : p.wall);
    // Hull
    outlined(() => { ctx.beginPath(); ctx.ellipse(0, 0, BOSS_HW, 30, 0, 0, TAU); }, body, 4);
    ctx.fillStyle = "rgba(255,255,255,0.28)";
    ctx.beginPath();
    ctx.ellipse(-10, -16, 30, 6, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.2)";
    ctx.beginPath();
    ctx.ellipse(0, 18, 40, 8, 0, 0, TAU);
    ctx.fill();
    // Cracks as it weakens
    if (b.phase >= 1) {
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(-36, -8); ctx.lineTo(-28, -2); ctx.lineTo(-32, 6); ctx.lineTo(-24, 12);
      if (b.phase === 2) { ctx.moveTo(30, -12); ctx.lineTo(24, -4); ctx.lineTo(32, 2); ctx.lineTo(26, 10); }
      ctx.stroke();
    }
    // Big eye + brow
    eye(0, -2, 13, sx, sy, b.phase === 2 ? p.primary : p.accent);
    ctx.fillStyle = p.ink;
    ctx.save();
    ctx.rotate(b.phase === 0 ? 0 : 0.18);
    ctx.fillRect(-18, -20, 16, 4);
    ctx.restore();
    ctx.save();
    ctx.rotate(b.phase === 0 ? 0 : -0.18);
    ctx.fillRect(2, -20, 16, 4);
    ctx.restore();
    // Grille mouth
    ctx.fillStyle = p.ink;
    ctx.fillRect(-16, 14, 32, 8);
    ctx.fillStyle = "#ffffff";
    for (let i = 0; i < 4; i++) ctx.fillRect(-14 + i * 8, 15, 5, 3 + (b.phase === 2 ? Math.abs(Math.sin(t / 60 + i)) * 3 : 0));
    ctx.restore();
  }

  function drawBossBar(b: NonNullable<SwarmView["boss"]>) {
    const x = 30, y = 46, w = W - 60;
    kit.text("FUD MOTHERSHIP", W / 2, y - 9, 9, p.text);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x - 2, y - 2, w + 4, 10);
    ctx.fillStyle = "rgba(255,255,255,0.12)";
    ctx.fillRect(x, y, w, 6);
    ctx.fillStyle = b.phase === 2 ? p.accent : b.phase === 1 ? brick(1) : p.primary;
    ctx.fillRect(x, y, (w * Math.max(0, b.hp)) / b.max, 6);
    ctx.fillStyle = "rgba(255,255,255,0.45)";
    ctx.fillRect(x, y, (w * Math.max(0, b.hp)) / b.max, 2);
    ctx.fillStyle = p.ink;
    ctx.fillRect(x + w / 3 - 1, y - 2, 2, 10);
    ctx.fillRect(x + (2 * w) / 3 - 1, y - 2, 2, 10);
  }

  function drawShip(v: SwarmView, dtMs: number) {
    const s = v.ship;
    const x = s.x, y = s.y;
    // Bank toward the direction of travel.
    const dx = x - lastX;
    lastX = x;
    bank += (Math.max(-1, Math.min(1, dx / 5)) - bank) * Math.min(1, dtMs / 80);
    if (!s.alive) return;
    if (s.invuln > 0 && Math.floor(t / 70) % 2 === 0) return;
    ctx.save();
    ctx.translate(x, y);
    // Engine flames
    for (const ox of [-9, 9]) {
      const fl = 8 + Math.random() * 7;
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.moveTo(ox - 4, 13); ctx.lineTo(ox, 13 + fl); ctx.lineTo(ox + 4, 13);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.moveTo(ox - 2, 13); ctx.lineTo(ox, 13 + fl * 0.55); ctx.lineTo(ox + 2, 13);
      ctx.fill();
    }
    // Wings (squashed on the side we bank toward)
    const wl = 1 - Math.max(0, -bank) * 0.35, wr = 1 - Math.max(0, bank) * 0.35;
    outlined(() => {
      ctx.beginPath();
      ctx.moveTo(0, -20);
      ctx.lineTo(8, -4);
      ctx.lineTo(24 * wr, 8);
      ctx.lineTo(22 * wr, 14);
      ctx.lineTo(8, 11);
      ctx.lineTo(-8, 11);
      ctx.lineTo(-22 * wl, 14);
      ctx.lineTo(-24 * wl, 8);
      ctx.lineTo(-8, -4);
      ctx.closePath();
    }, p.secondary);
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(0, -17); ctx.lineTo(6, -4); ctx.lineTo(-6, -4); ctx.closePath();
    ctx.fill();
    // Wingtip lights
    ctx.fillStyle = Math.floor(t / 250) % 2 ? p.primary : "#ffffff";
    ctx.fillRect(22 * wr - 2, 8, 3, 3);
    ctx.fillRect(-22 * wl - 1, 8, 3, 3);
    // Engine pods
    kit.block(-13, 4, 8, 11, p.wall, 2);
    kit.block(5, 4, 8, 11, p.wall, 2);
    // Cockpit dome with the mascot
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, 12.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = p.bg2;
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, TAU);
    ctx.fill();
    const spr = moodT > 0 && mood === "sad" ? kit.sprites.sad : moodT > 0 && mood === "happy" ? kit.sprites.happy : kit.sprites.idle;
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, 11, 0, TAU);
    ctx.clip();
    ctx.drawImage(spr, -10, -10, 20, 20);
    ctx.restore();
    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(-4, -6, 5, 2.5, -0.5, 0, TAU);
    ctx.fill();
    ctx.restore();

    if (v.shield > 0) {
      const fade = v.shield < 120 && Math.floor(t / 100) % 2 === 0;
      if (!fade) {
        ctx.strokeStyle = brick(5);
        ctx.lineWidth = 2;
        ctx.globalAlpha = 0.55 + 0.25 * Math.sin(t / 110);
        ctx.beginPath();
        ctx.arc(x, y, 26, 0, TAU);
        ctx.stroke();
        ctx.globalAlpha = 0.12;
        ctx.fillStyle = brick(5);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    if (v.magnet > 0) {
      ctx.strokeStyle = coinC;
      ctx.lineWidth = 1.5;
      for (let i = 0; i < 2; i++) {
        const k = ((t / 600 + i / 2) % 1);
        ctx.globalAlpha = (1 - k) * 0.5;
        ctx.beginPath();
        ctx.arc(x, y, 60 - k * 40, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    if (muzzle > 0 && v.weapon !== WEAPON.LASER) {
      ctx.globalAlpha = muzzle / 60;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(x, y - 19, 4 + (1 - muzzle / 60) * 3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  function drawLaser(l: NonNullable<SwarmView["laser"]>, sy: number) {
    const y0 = sy - 16;
    const h = y0 - l.top;
    if (h <= 0) return;
    const wob = 1 + Math.sin(t / 30) * 0.25;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = p.primary;
    ctx.fillRect(l.x - (l.half + 4) * wob, l.top, (l.half + 4) * 2 * wob, h);
    ctx.globalAlpha = 1;
    ctx.fillStyle = p.primary;
    ctx.fillRect(l.x - l.half * wob, l.top, l.half * 2 * wob, h);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(l.x - l.half * 0.4, l.top, l.half * 0.8, h);
    if (l.top > 0) {
      ctx.globalAlpha = 0.8;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath();
      ctx.arc(l.x, l.top, l.half + 3 + Math.random() * 3, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (Math.random() < 0.4) sparks.push({ x: l.x + (Math.random() - 0.5) * 10, y: l.top, life: 160 });
    }
  }

  function drawCoin(x: number, y: number, k: number) {
    const w = Math.abs(Math.cos(t / 140 + k)) * 5 + 1;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.ellipse(x, y, w + 1.5, 6.5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = coinC;
    ctx.beginPath();
    ctx.ellipse(x, y, w, 5, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(x - w * 0.4, y - 3, Math.max(1, w * 0.5), 2);
  }

  function drawDrop(d: SwarmView["drops"][number]) {
    const bob = Math.sin(t / 180 + d.x) * 2;
    const y = d.y + bob;
    ctx.globalAlpha = 0.3 + 0.2 * Math.sin(t / 120);
    ctx.fillStyle = dropC[d.kind];
    ctx.beginPath();
    ctx.arc(d.x, y, 16, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    kit.block(d.x - 11, y - 9, 22, 18, dropC[d.kind], 6);
    kit.text(DROP_LABEL[d.kind], d.x, y + 1, 11, p.ink);
  }

  function drawHud(v: SwarmView) {
    // Bombs, bottom left
    for (let i = 0; i < v.bombs; i++) {
      const x = 14 + i * 16, y = H - 14;
      ctx.fillStyle = p.ink;
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(x, y, 5, 0, TAU);
      ctx.fill();
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(x - 2, y - 3, 2, 2);
    }
    // Weapon + level, bottom centre
    kit.text(`${WEAPON_NAME[v.weapon]} ${"I".repeat(v.level)}`, W / 2, H - 13, 9, p.text);
    // Chain multiplier, bottom right
    if (v.mult > 1 || v.chain > 0) {
      const big = v.mult > 1;
      kit.text(big ? `x${v.mult}` : `${v.chain}`, W - 30, H - 22, big ? 16 : 10, big ? coinC : p.text);
      ctx.fillStyle = p.ink;
      ctx.fillRect(W - 54, H - 10, 48, 5);
      ctx.fillStyle = coinC;
      ctx.fillRect(W - 53, H - 9, (46 * v.chainT) / CHAIN_FRAMES, 3);
    }
    // Timed power-ups, above the bombs
    let row = 0;
    for (const [label, left, max, c] of [["SHIELD", v.shield, SHIELD_FRAMES, brick(5)], ["MAGNET", v.magnet, MAGNET_FRAMES, coinC]] as const) {
      if (left <= 0) continue;
      const y = H - 32 - row * 12;
      kit.text(label, 8, y, 8, p.text, "left");
      ctx.fillStyle = p.ink;
      ctx.fillRect(52, y - 3, 52, 6);
      ctx.fillStyle = c;
      ctx.fillRect(53, y - 2, (50 * left) / max, 4);
      row++;
    }
  }

  return {
    onEvents(events: readonly GameEvent[], v: SwarmView) {
      for (const e of events) {
        const x = e.x ?? 0, y = e.y ?? 0;
        switch (e.t) {
          case "shot":
            muzzle = 60;
            break;
          case "ehit":
          case "bosshit":
            for (let i = 0; i < 3; i++) sparks.push({ x: x + (Math.random() - 0.5) * 12, y: y + (Math.random() - 0.5) * 12, life: 140 });
            break;
          case "kill": {
            const k = e.kind as number;
            const big = k === 2;
            kit.fx.burst(x, y, kindC[k], big ? 30 : 14, big ? 220 : 160, 120);
            kit.fx.burst(x, y, "#ffffff", big ? 10 : 5, 120, 0);
            ring(x, y, kindC[k], big ? 160 : 110, big ? 450 : 300, big ? 4 : 2);
            const mult = e.mult as number;
            kit.fx.popup(x, y - 10, `${e.points as number}`, mult > 1 ? coinC : p.text);
            if (big) kit.fx.addShake(5);
            break;
          }
          case "squad":
            kit.fx.popup(x, y - 26, `SQUAD +${e.points as number}`, coinC);
            ring(x, y, coinC, 200, 500, 3);
            break;
          case "coin":
            kit.fx.burst(x, y, coinC, 3, 60, 0);
            break;
          case "power":
            kit.fx.burst(x, y, dropC[e.kind as number], 16, 160, 0);
            ring(x, y, dropC[e.kind as number], 140, 400, 3);
            kit.fx.popup(x, y - 18, DROP_NAME[e.kind as number], p.text);
            mood = "happy"; moodT = 900;
            break;
          case "bomb":
            kit.fx.flash("255,255,255");
            kit.fx.addShake(14);
            ring(x, y, "#ffffff", 900, 600, 6, 10);
            ring(x, y, p.accent, 650, 700, 4, 4);
            say("SMART BOMB!", 900, p.accent);
            break;
          case "shieldpop":
            ring(x, y, brick(5), 220, 400, 4, 24);
            kit.fx.burst(x, y, brick(5), 18, 180, 0);
            kit.fx.addShake(4);
            break;
          case "hit":
            kit.fx.burst(x, y, p.secondary, 26, 230);
            kit.fx.burst(x, y, p.primary, 12, 160);
            ring(x, y, p.accent, 300, 500, 5);
            kit.fx.addShake(12);
            kit.fx.flash();
            mood = "sad"; moodT = 1800;
            break;
          case "chainend":
            kit.fx.popup(x, y, `CHAIN ${e.chain as number}!`, coinC);
            break;
          case "wave":
            say(`WAVE ${(e.wave as number) + 1}`, 1300);
            break;
          case "bossin":
            say("WARNING: MOTHERSHIP", 2400, p.accent);
            kit.fx.flash();
            break;
          case "bossphase":
            kit.fx.burst(x, y, p.accent, 30, 240);
            kit.fx.burst(x, y, "#ffffff", 14, 180);
            ring(x, y, p.accent, 300, 500, 5, 30);
            kit.fx.flash("255,255,255");
            kit.fx.addShake(8);
            say((e.phase as number) === 2 ? "IT'S ANGRY NOW" : "ARMOUR CRACKED", 1200, p.accent);
            break;
          case "bossdie":
            for (let i = 0; i < 8; i++) {
              const ox = (Math.random() - 0.5) * 100, oy = (Math.random() - 0.5) * 50;
              timed.push({ at: t + i * 110, fn: () => {
                kit.fx.burst(x + ox, y + oy, brick(i), 24, 220);
                ring(x + ox, y + oy, brick(i), 220, 400, 4);
                kit.fx.addShake(8);
              } });
            }
            kit.fx.popup(x, y, `+${e.points as number}`, coinC);
            kit.fx.flash("255,255,255");
            mood = "happy"; moodT = 2500;
            break;
          case "waveclear":
            say(e.boss ? `BOSS DOWN!  +${e.bonus as number}` : `WAVE CLEAR  +${e.bonus as number}`, 2000, coinC);
            if (!e.boss) for (let i = 0; i < 5; i++) kit.fx.burst(40 + Math.random() * (W - 80), H * 0.4, brick(i), 10, 200);
            mood = "happy"; moodT = 1500;
            break;
          case "gameover":
            mood = "sad"; moodT = 1e9;
            break;
        }
      }
      void v;
    },

    draw(v, dtMs) {
      t += dtMs;
      if (moodT > 0) moodT -= dtMs;
      if (muzzle > 0) muzzle -= dtMs;
      kit.background(dtMs);
      backdrop(dtMs);

      for (let i = timed.length - 1; i >= 0; i--) if (timed[i].at <= t) { timed[i].fn(); timed.splice(i, 1); }

      const sx = v.ship.x, sy = v.ship.y;

      // Coins and power-ups under the action
      v.coinsList.forEach((c, i) => drawCoin(c.x, c.y, i));
      for (const d of v.drops) drawDrop(d);

      if (v.boss) drawBoss(v.boss, sx, sy);
      for (const e of v.enemies) drawEnemy(e, sx, sy);

      // Player fire
      if (v.laser) drawLaser(v.laser, sy);
      for (const b of v.pbullets) {
        if (b.kind === 0) {
          ctx.fillStyle = p.ink;
          ctx.fillRect(b.x - 2.5, b.y - 7, 5, 14);
          ctx.fillStyle = p.primary;
          ctx.fillRect(b.x - 1.5, b.y - 6, 3, 12);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(b.x - 0.5, b.y - 6, 1, 6);
        } else {
          ctx.fillStyle = p.ink;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 4, 0, TAU);
          ctx.fill();
          ctx.fillStyle = coinC;
          ctx.beginPath();
          ctx.arc(b.x, b.y, 2.8, 0, TAU);
          ctx.fill();
        }
      }

      drawShip(v, dtMs);

      // Enemy bullets on top so they are always readable
      for (const b of v.ebullets) {
        const r = b.kind === 1 ? 5 : 3.8;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 1.5, 0, TAU);
        ctx.fill();
        ctx.fillStyle = b.kind === 1 ? p.secondary : p.accent;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, TAU);
        ctx.fill();
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(b.x - r * 0.25, b.y - r * 0.25, r * 0.45, 0, TAU);
        ctx.fill();
      }

      // Sparks and rings
      for (let i = sparks.length - 1; i >= 0; i--) {
        const s = sparks[i];
        s.life -= dtMs;
        if (s.life <= 0) { sparks.splice(i, 1); continue; }
        ctx.globalAlpha = s.life / 160;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
      }
      ctx.globalAlpha = 1;
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i];
        r.life += dtMs;
        if (r.life >= r.max) { rings.splice(i, 1); continue; }
        const k = r.life / r.max;
        ctx.globalAlpha = 1 - k;
        ctx.strokeStyle = r.color;
        ctx.lineWidth = r.width * (1 - k) + 0.5;
        ctx.beginPath();
        ctx.arc(r.x, r.y, r.r + (r.grow * r.life) / 1000, 0, TAU);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      kit.fx.draw(kit, dtMs);
      foreground(dtMs);

      if (v.boss) drawBossBar(v.boss);
      drawHud(v);

      if (v.boss?.entering && Math.floor(t / 250) % 2 === 0) {
        ctx.fillStyle = p.accent;
        ctx.globalAlpha = 0.18;
        ctx.fillRect(0, H * 0.42 - 18, W, 36);
        ctx.globalAlpha = 1;
      }
      if (bannerT > 0) {
        bannerT -= dtMs;
        ctx.globalAlpha = Math.min(1, bannerT / 300);
        kit.text(banner, W / 2, H * 0.42, banner.length > 16 ? 16 : 22, bannerC);
        ctx.globalAlpha = 1;
      }
      if (v.frame < 200 && !v.over) {
        ctx.globalAlpha = Math.min(1, (200 - v.frame) / 60);
        kit.text("DRAG TO FLY - IT FIRES ON ITS OWN", W / 2, H * 0.62, 10, p.text);
        kit.text("LONG PRESS / X = SMART BOMB", W / 2, H * 0.62 + 16, 10, p.text);
        ctx.globalAlpha = 1;
      }
    },
  };
}
