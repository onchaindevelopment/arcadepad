// Moon Defense renderer: a cratered moon surface, coin-tower cities, domed
// launch bases manned by the coin mascot, FUD rockets with smoky trails and
// blooming blasts. All colours come from the theme palette (plus ink/white).
import type { ThemePack } from "../../themes/types.ts";
import { makeKit } from "../core/render-kit.ts";
import type { GameEvent, GameRenderer } from "../core/types.ts";
import { AIM_MAX_Y, BASE_Y, GROUND, H, W, type DefenseView, type SiteV } from "./index.ts";

export default function createRenderer(canvas: HTMLCanvasElement, theme: ThemePack): GameRenderer<DefenseView> {
  const kit = makeKit(canvas, theme, W, H);
  const { ctx } = kit;
  const p = theme.palette;
  const brick = (i: number) => p.bricks[((i % p.bricks.length) + p.bricks.length) % p.bricks.length] ?? p.primary;
  const ticker = "$" + theme.coin.ticker;
  let t = 0;
  const lostAt = new Map<number, number>(); // site -> time it fell (for smoke)

  // Fixed crater layout for the surface.
  const craters = Array.from({ length: 14 }, (_, i) => ({
    x: ((i * 97) % W) + 6,
    y: GROUND + 8 + ((i * 53) % 28),
    r: 3 + ((i * 7) % 6),
  }));
  // A big planet in the sky (decor only).
  const planet = { x: W * 0.78, y: 92, r: 34 };

  // Per-city tower heights so each skyline looks different.
  const towers = [0, 1, 2, 3, 4, 5].map((c) => [10 + ((c * 7) % 8), 18 + ((c * 5) % 9), 12 + ((c * 11) % 7)]);

  function drawPlanet() {
    ctx.save();
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = p.secondary;
    ctx.beginPath();
    ctx.arc(planet.x, planet.y, planet.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = p.bg;
    ctx.beginPath();
    ctx.arc(planet.x + 12, planet.y - 8, planet.r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = p.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.ellipse(planet.x, planet.y, planet.r + 14, 6, -0.3, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawGround() {
    ctx.fillStyle = p.ink;
    ctx.fillRect(0, GROUND - 2, W, H - GROUND + 2);
    ctx.fillStyle = p.wall;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect(0, GROUND, W, 2);
    for (const c of craters) {
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.beginPath();
      ctx.ellipse(c.x, c.y, c.r * 1.6, c.r * 0.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.12)";
      ctx.fillRect(c.x - c.r, c.y + c.r * 0.4, c.r * 2, 1);
    }
  }

  function drawCity(i: number, s: SiteV) {
    const cx = s.x;
    if (!s.alive) {
      // Rubble + smoke.
      ctx.fillStyle = p.ink;
      ctx.fillRect(cx - 14, GROUND - 5, 28, 5);
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(cx - 12, GROUND - 8, 8, 4);
      ctx.fillRect(cx + 2, GROUND - 7, 9, 3);
      const since = t - (lostAt.get(i) ?? -1e9);
      if (since < 6000) {
        for (let k = 0; k < 3; k++) {
          const ph = (t / 900 + k / 3) % 1;
          ctx.globalAlpha = (1 - ph) * 0.35 * (1 - since / 6000);
          ctx.fillStyle = p.text;
          ctx.beginPath();
          ctx.arc(cx - 4 + k * 4 + Math.sin(t / 400 + k) * 3, GROUND - 8 - ph * 26, 2 + ph * 4, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
      return;
    }
    const hs = towers[i - 3];
    const xs = [cx - 13, cx - 4, cx + 5];
    for (let k = 0; k < 3; k++) {
      const h = hs[k];
      kit.block(xs[k], GROUND - h, 9, h + 2, brick(i + k), 2);
      // Lit windows.
      ctx.fillStyle = "rgba(255,255,255,0.55)";
      for (let wy = GROUND - h + 5; wy < GROUND - 3; wy += 4) {
        if (((wy + k * 3 + i) >> 2) % 3 !== 0) ctx.fillRect(xs[k] + 3, wy, 3, 1.5);
      }
    }
    // Coin on the tallest tower.
    const top = GROUND - hs[1] - 6;
    const bob = Math.sin(t / 300 + i) * 1;
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(cx + 0.5, top + bob, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.accent;
    ctx.beginPath();
    ctx.arc(cx + 0.5, top + bob, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.fillRect(cx - 1, top + bob - 2, 2, 1);
  }

  function drawBase(i: number, s: SiteV, v: DefenseView) {
    const bx = s.x;
    // Mound.
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.moveTo(bx - 22, GROUND + 1);
    ctx.lineTo(bx - 12, BASE_Y + 2);
    ctx.lineTo(bx + 12, BASE_Y + 2);
    ctx.lineTo(bx + 22, GROUND + 1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = s.alive ? p.wall : "rgba(0,0,0,0.4)";
    ctx.beginPath();
    ctx.moveTo(bx - 19, GROUND);
    ctx.lineTo(bx - 11, BASE_Y + 4);
    ctx.lineTo(bx + 11, BASE_Y + 4);
    ctx.lineTo(bx + 19, GROUND);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(bx - 10, BASE_Y + 4, 20, 1.5);
    // Gunner mascot on top.
    const spr = !s.alive ? kit.sprites.sad : v.phase === "tally" ? kit.sprites.happy : kit.sprites.mini;
    const sz = s.alive ? 20 : 16;
    ctx.globalAlpha = s.alive ? 1 : 0.6;
    ctx.drawImage(spr, bx - sz / 2, BASE_Y + 4 - sz + (s.alive ? Math.sin(t / 260 + i) * 0.8 : 4), sz, sz);
    ctx.globalAlpha = 1;
    // Selected base marker.
    if (v.sel === i) {
      ctx.strokeStyle = p.primary;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t / 120);
      ctx.strokeRect(bx - 16, BASE_Y - 20, 32, 36);
      ctx.globalAlpha = 1;
    }
    // Ammo pips on the ground (2 rows of 5).
    const pipY = GROUND + 14;
    for (let k = 0; k < 10; k++) {
      const px = bx - 11 + (k % 5) * 5;
      const py = pipY + (k >= 5 ? 6 : 0);
      ctx.fillStyle = p.ink;
      ctx.fillRect(px - 0.5, py - 0.5, 4, 5);
      ctx.fillStyle = k < s.ammo ? p.primary : "rgba(255,255,255,0.12)";
      ctx.fillRect(px, py, 3, 4);
    }
    if (s.alive && s.ammo === 0) kit.text("OUT", bx, pipY + 20, 8, p.accent);
    else if (s.alive && s.ammo <= 3) kit.text("LOW", bx, pipY + 20, 8, p.text);
  }

  function drawRocket(r: DefenseView["rockets"][number]) {
    // Smoky trail from launch point.
    const g = ctx.createLinearGradient(r.sx, r.sy, r.x, r.y);
    g.addColorStop(0, "rgba(255,255,255,0)");
    g.addColorStop(1, p.accent);
    ctx.strokeStyle = g;
    ctx.lineWidth = r.kind === 2 ? 1 : 2;
    ctx.beginPath();
    ctx.moveTo(r.sx, r.sy);
    ctx.lineTo(r.x, r.y);
    ctx.stroke();
    if (r.kind === 2) {
      // Smart bomb: spinning diamond.
      ctx.save();
      ctx.translate(r.x, r.y);
      ctx.rotate(t / 150);
      ctx.fillStyle = p.ink;
      ctx.fillRect(-5, -5, 10, 10);
      ctx.fillStyle = (t / 100) % 2 < 1 ? p.accent : "#ffffff";
      ctx.fillRect(-3.5, -3.5, 7, 7);
      ctx.restore();
      return;
    }
    // Rocket body pointing along velocity.
    const a = Math.atan2(r.vy, r.vx);
    ctx.save();
    ctx.translate(r.x, r.y);
    ctx.rotate(a);
    ctx.fillStyle = p.ink;
    ctx.fillRect(-7, -3, 11, 6);
    ctx.fillStyle = r.kind === 1 ? p.secondary : p.accent;
    ctx.fillRect(-6, -2, 9, 4);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(2, -1, 2, 2);
    // Flame.
    ctx.fillStyle = (t / 60) % 2 < 1 ? "#ffffff" : brick(4);
    ctx.fillRect(-10, -1, 3, 2);
    ctx.restore();
    if (r.kind === 1) {
      ctx.fillStyle = p.secondary;
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin(t / 80);
      ctx.fillRect(r.x - 1, r.y - 7, 2, 2);
      ctx.globalAlpha = 1;
    }
  }

  function drawBomber(b: DefenseView["bombers"][number]) {
    const bob = Math.sin(t / 200 + b.id) * 1.5;
    kit.block(b.x - 16, b.y - 7 + bob, 32, 14, p.secondary, 6);
    ctx.fillStyle = p.ink;
    ctx.fillRect(b.x - 6, b.y + 6 + bob, 12, 3);
    kit.text("FUD", b.x, b.y + bob + 0.5, 8, p.text);
    // Little propeller at the back.
    const bx = b.x - b.dir * 18;
    ctx.fillStyle = (t / 40) % 2 < 1 ? p.text : p.accent;
    ctx.fillRect(bx - 1, b.y - 5 + bob, 2, 10);
  }

  function drawCross(v: DefenseView) {
    const { x, y } = v.cross;
    const pulse = 1 + Math.sin(t / 150) * 0.8;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 3;
    const arms = () => {
      ctx.beginPath();
      ctx.moveTo(x - 10 - pulse, y);
      ctx.lineTo(x - 4, y);
      ctx.moveTo(x + 4, y);
      ctx.lineTo(x + 10 + pulse, y);
      ctx.moveTo(x, y - 10 - pulse);
      ctx.lineTo(x, y - 4);
      ctx.moveTo(x, y + 4);
      ctx.lineTo(x, y + 10 + pulse);
      ctx.stroke();
    };
    arms();
    ctx.strokeStyle = p.text;
    ctx.lineWidth = 1.5;
    arms();
    ctx.fillStyle = p.primary;
    ctx.fillRect(x - 1, y - 1, 2, 2);
  }

  return {
    onEvents(events: readonly GameEvent[]) {
      for (const e of events) {
        switch (e.t) {
          case "kill":
            kit.fx.burst(e.x!, e.y!, e.kind === 2 ? p.accent : brick(e.x! | 0), e.kind === 2 ? 18 : 9, 110, 160);
            kit.fx.popup(e.x!, e.y! - 8, `+${e.pts as number}`, e.kind === 2 ? p.accent : p.primary);
            break;
          case "killBomber":
            kit.fx.burst(e.x!, e.y!, p.secondary, 22, 160, 200);
            kit.fx.burst(e.x!, e.y!, p.text, 10, 90, 200);
            kit.fx.popup(e.x!, e.y! - 12, `+${e.pts as number}`, p.accent);
            kit.fx.addShake(4);
            break;
          case "blast":
            kit.fx.burst(e.x!, e.y!, "#ffffff", 5, 60, 0);
            break;
          case "split":
            kit.fx.burst(e.x!, e.y!, p.secondary, 8, 70, 0);
            break;
          case "cityLost":
            lostAt.set(e.site as number, t);
            kit.fx.addShake(9);
            kit.fx.flash();
            kit.fx.burst(e.x!, e.y! - 8, brick(e.site as number), 26, 200, 380);
            kit.fx.burst(e.x!, e.y! - 8, p.ink, 12, 120, 300);
            break;
          case "baseLost":
            kit.fx.addShake(7);
            kit.fx.burst(e.x!, e.y! - 8, p.wall, 20, 180, 380);
            kit.fx.burst(e.x!, e.y! - 8, p.accent, 10, 140, 300);
            break;
          case "thud":
            kit.fx.burst(e.x!, e.y!, p.wall, 6, 80, 300);
            break;
          case "cityBack":
            kit.fx.burst(e.x!, e.y!, p.primary, 16, 120, 200);
            kit.fx.popup(e.x!, e.y! - 14, "REBUILT", p.primary);
            break;
          case "extraCity":
            kit.fx.popup(W / 2, 170, "BONUS CITY!", p.primary);
            kit.fx.flash("255,255,255");
            break;
          case "dry":
            kit.fx.popup(e.x!, e.y!, "NO AMMO", p.accent);
            break;
          case "fire":
            kit.fx.burst(e.x!, e.y! - 4, "#ffffff", 4, 60, 100);
            break;
          case "waveClear":
            for (let i = 0; i < 5; i++) kit.fx.burst(40 + i * 70, 260 + (i % 2) * 30, brick(i), 12, 180, 260);
            break;
          case "gameover":
            kit.fx.flash();
            kit.fx.addShake(10);
            break;
        }
      }
    },

    draw(v, dtMs) {
      t += dtMs;
      kit.background(dtMs);
      drawPlanet();

      // Rocket trails and bodies (behind blasts).
      for (const r of v.rockets) drawRocket(r);
      for (const b of v.bombers) drawBomber(b);

      // Interceptor trails, heads and target marks.
      for (const s of v.shots) {
        ctx.strokeStyle = p.primary;
        ctx.globalAlpha = 0.7;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.sx, s.sy);
        ctx.lineTo(s.x, s.y);
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(s.x - 1.5, s.y - 1.5, 3, 3);
        const blink = (t / 90) % 2 < 1;
        ctx.strokeStyle = blink ? p.primary : p.text;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(s.tx - 4, s.ty - 4);
        ctx.lineTo(s.tx + 4, s.ty + 4);
        ctx.moveTo(s.tx + 4, s.ty - 4);
        ctx.lineTo(s.tx - 4, s.ty + 4);
        ctx.stroke();
      }

      // Blasts: flickering palette rings.
      for (const e of v.booms) {
        if (e.r <= 0) continue;
        const fade = e.kind === 2 ? 0.75 : 1;
        ctx.globalAlpha = fade;
        ctx.fillStyle = p.ink;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r + 1.5, 0, Math.PI * 2);
        ctx.fill();
        const c1 = e.kind === 2 ? p.accent : brick((e.t >> 2) + e.id);
        ctx.fillStyle = c1;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = e.kind === 2 ? p.secondary : "#ffffff";
        ctx.globalAlpha = fade * 0.75;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }

      drawGround();
      for (let i = 3; i < 9; i++) drawCity(i, v.sites[i]);
      for (let i = 0; i < 3; i++) drawBase(i, v.sites[i], v);
      kit.text(ticker, W / 2, H - 10, 8, p.text);

      // Wave intro.
      if (v.phase === "play" && v.intro > 0) {
        const a = Math.min(1, v.intro / 20);
        ctx.globalAlpha = a;
        kit.text(`WAVE ${v.wave}`, W / 2, 230, 26, p.primary);
        if (v.mult > 1) kit.text(`x${v.mult} POINTS`, W / 2, 262, 14, p.accent);
        kit.text(v.wave === 1 ? "TAP TO FIRE · LEAD YOUR SHOTS" : "HOLD THE LINE", W / 2, 292, 9, p.text);
        ctx.globalAlpha = 1;
      }

      // Bonus tally.
      if (v.phase === "tally" && v.bonus) {
        const b = v.bonus;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(30, 170, W - 60, 170);
        ctx.strokeStyle = p.primary;
        ctx.lineWidth = 2;
        ctx.strokeRect(30, 170, W - 60, 170);
        kit.text(`WAVE ${v.wave} CLEAR`, W / 2, 192, 16, p.primary);
        const sz = 40;
        ctx.drawImage(kit.sprites.happy, W / 2 - sz / 2, 206 + Math.sin(t / 150) * 2, sz, sz);
        const show = v.phaseT;
        if (show > 20) kit.text(`AMMO  ${b.ammo} = ${b.ammoPts}`, W / 2, 268, 11, p.text);
        if (show > 45) kit.text(`CITIES  ${b.cities} = ${b.cityPts}`, W / 2, 290, 11, p.text);
        if (show > 70) kit.text(`BONUS +${b.total}`, W / 2, 318, 15, p.accent);
      }

      // Game over.
      if (v.phase === "over" || (v.citiesLeft === 0 && v.phase === "play")) {
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(0, 200, W, 110);
        const sz = 44;
        ctx.drawImage(kit.sprites.sad, W / 2 - sz / 2, 206, sz, sz);
        kit.text("THE MOON FELL", W / 2, 272, 20, p.accent);
        kit.text(`WAVE ${v.wave} · ${v.score}`, W / 2, 296, 11, p.text);
      }

      if (v.phase === "play" && v.citiesLeft > 0 && v.cross.y <= AIM_MAX_Y) drawCross(v);
      // Bank of extra cities.
      if (v.bank > 0) kit.text(`+${v.bank} CITY`, W - 6, 14, 9, p.primary, "right");
      kit.fx.draw(kit, dtMs);
    },
  };
}
