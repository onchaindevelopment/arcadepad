// Breakout: adapter from the LBreakout2 port (src/engine) to the ArcadePad game contract.
// ArcadePad, GPL-3.0-or-later.
import { Game, runLevels } from "../../engine/index.ts";
import { FIELD_H, FIELD_W, type GameEvent as BEvent, type GameView } from "../../engine/types.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

const KEY_SPEED = 9;

function mapEvent(e: BEvent): GameEvent {
  const base: GameEvent = { t: e.t, raw: e };
  switch (e.t) {
    case "paddle": return { ...base, sfx: "paddle" };
    case "wall": return { ...base, sfx: "wall" };
    case "brickhit": return { ...base, sfx: "brick" };
    case "brickgone": return { ...base, sfx: "brickgone" };
    case "explode": return { ...base, sfx: "explode" };
    case "extra": return { ...base, sfx: e.good ? "extraGood" : "extraBad", mood: e.good ? "happy" : undefined };
    case "shot": return { ...base, sfx: "shot" };
    case "launch": return { ...base, sfx: "launch" };
    case "lifelost": return { ...base, sfx: "lost", mood: "sad", toast: "lifeLost" };
    case "levelclear": return { ...base, sfx: "levelclear", mood: "happy", toast: "levelClear" };
    case "gameover": return { ...base, sfx: "gameover" };
    case "won": return { ...base, sfx: "won", mood: "happy" };
    default: return base;
  }
}

class BreakoutEngine implements GameEngine<GameView> {
  private g: Game;
  private tx = FIELD_W / 2;
  private lastPointerX = FIELD_W / 2;
  private v: GameView;
  events: GameEvent[] = [];

  constructor(seed: number, ticker: string) {
    this.g = new Game({ seed, levels: runLevels(ticker) });
    this.v = this.g.view();
  }
  step(inp: Input) {
    // Arrows nudge the paddle target; otherwise follow the pointer when it moves.
    if (inp.b & BTN.LEFT) this.tx -= KEY_SPEED;
    if (inp.b & BTN.RIGHT) this.tx += KEY_SPEED;
    if (!(inp.b & (BTN.LEFT | BTN.RIGHT)) && inp.x !== this.lastPointerX) this.tx = inp.x;
    this.lastPointerX = inp.x;
    this.tx = Math.max(0, Math.min(FIELD_W, this.tx));
    this.v = this.g.step({ x: Math.round(this.tx), fire: (inp.b & (BTN.FIRE | BTN.UP)) !== 0 });
    this.events = this.v.events.map(mapEvent);
  }
  view() {
    return this.v;
  }
  hud(): Hud {
    return { score: this.v.score, lives: this.v.lives, level: this.v.level + 1, label: this.v.levelTitle };
  }
  result(): GameResult {
    const r = this.g.result();
    return { score: r.score, level: r.level, levelsCleared: r.levelsCleared, frames: r.frames, status: r.status === "won" ? "won" : r.status === "gameover" ? "over" : "playing" };
  }
  get done() {
    return this.g.done;
  }
  get frame() {
    return this.v.frame;
  }
}

export const breakout: GameDef<GameView> = {
  id: "breakout",
  name: "Breakout",
  tagline: "Bounce your mascot through a wall of bricks. Level 1 spells your ticker.",
  genre: "Paddle & bricks",
  session: "2–6 min",
  controls: "Mouse, touch or ← →. Click / Space to launch and fire.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: 15 * 60 * 60,
  credits: {
    basedOn: "LBreakout2 2.6.5",
    url: "https://lgames.sourceforge.io/LBreakout2/",
    authors: "Michael Speck and contributors",
    licence: "GPL-2.0-or-later",
    notes: "Game logic ported to TypeScript. Graphics, sounds and level sets were not used; all levels and art are new.",
  },
  create: (seed, ctx) => new BreakoutEngine(seed, ctx.ticker),
  bot(v, frame) {
    let best: { x: number; y: number } | null = null;
    for (const b of v.balls) if (!best || b.y > best.y) best = b;
    const x = (best ? best.x : FIELD_W / 2) + Math.sin(frame / 45) * 14;
    return { x: Math.round(Math.max(0, Math.min(FIELD_W, x))), y: 0, b: BTN.FIRE };
  },
  titleFor: (theme) => theme.game.title,
};
