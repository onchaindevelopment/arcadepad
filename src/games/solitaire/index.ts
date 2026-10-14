/*
 * Moon Solitaire: original Klondike (draw-1) implementation for ArcadePad.
 * ArcadePad, GPL-3.0-or-later. Klondike's rules are public domain; no code,
 * names, art or sounds from any commercial solitaire.
 *
 * Rules: 7 tableau piles (1..7 cards, top card face up), stock, waste and 4
 * foundations. Draw one card at a time, unlimited recycles of the waste.
 * Tableau builds down in alternating colours, only kings on empty piles;
 * foundations build up by suit from the ace. Face-down tableau cards flip
 * automatically when uncovered. When stock and waste are empty and every
 * card is face up, the game finishes itself.
 *
 * Scoring (classic, not Vegas): +10 to a foundation, +5 waste to tableau,
 * +5 per card flipped, -15 foundation back to tableau, -100 per waste
 * recycle (never below 0), and a time bonus of 10 per second left on a win.
 *
 * Run ends on a win, a give-up (ALT held 1 s, or END when no moves are
 * left) or after 10 minutes.
 *
 * Input: tap a card to auto-move it (foundation first, then tableau), drag a
 * card or run onto a pile, tap the stock to draw. Keys: arrows move a cursor,
 * FIRE picks up / places (FIRE twice = auto-move), ALT draws.
 * Pure integer logic; the shuffle comes only from Rng.
 */
import { Rng } from "../core/rng.ts";
import { BTN, type GameDef, type GameEngine, type GameEvent, type GameResult, type Hud, type Input } from "../core/types.ts";

// ---- Layout (shared by engine hit-testing, renderer and bot) ----
export const FIELD_W = 360;
export const FIELD_H = 600;
export const CW = 46; // card width
export const CH = 64; // card height
export const GAP = 4;
export const MX = (FIELD_W - (7 * CW + 6 * GAP)) / 2; // 7
export const TOP_Y = 44;
export const TAB_Y = TOP_Y + CH + 12; // 120
export const TAB_BOTTOM = 588;
export const DOWN_OFF = 7;
export const UP_OFF = 19;
export const FAN = 9; // waste fan step
export const END_BTN = { x: 110, y: 520, w: 140, h: 40 };

// ---- Piles: 0 stock, 1 waste, 2..5 foundations, 6..12 tableau ----
export const STOCK = 0;
export const WASTE = 1;
export const FOUND0 = 2;
export const TAB0 = 6;

export const TIME_LIMIT = 10 * 60 * 60; // frames
export const WIN_FRAMES = 330; // celebration before the run ends
const AUTO_EVERY = 5; // frames per auto-finish card
const DRAG_PX = 5;
const GIVEUP_FRAMES = 60;

export const SCORE = { FOUND: 10, WASTE_TAB: 5, FLIP: 5, FOUND_TAB: -15, RECYCLE: -100 } as const;
export const TIME_BONUS_PER_SEC = 10;

/** card = suit * 13 + (rank - 1). Suits 0 hearts, 1 diamonds (red), 2 clubs, 3 spades (black). */
export const suitOf = (c: number) => Math.floor(c / 13);
export const rankOf = (c: number) => (c % 13) + 1;
export const isRed = (c: number) => suitOf(c) < 2;

export const colX = (col: number) => MX + col * (CW + GAP);
/** Column (0..6) where a pile sits. */
export const pileCol = (pile: number) => (pile === STOCK ? 0 : pile === WASTE ? 1 : pile < TAB0 ? pile + 1 : pile - TAB0);

export interface TabPile {
  cards: number[];
  down: number; // cards[0..down) are face down
}

export interface Held {
  pile: number;
  idx: number;
}

export interface Drag extends Held {
  /** Top-left of the dragged base card, in field units. */
  x: number;
  y: number;
}

export interface SolitaireView {
  frame: number;
  stock: number[]; // face down, last = next to draw
  waste: number[]; // last = top
  found: number[][]; // 4 piles, last = top
  tab: TabPile[];
  score: number;
  timeLeft: number; // frames
  phase: "play" | "auto" | "won" | "over";
  wonFrame: number; // frame the win happened (0 if not)
  stuck: boolean;
  cursor: Held; // keyboard cursor
  keyMode: boolean;
  held: Held | null; // keyboard pick
  drag: Drag | null; // pointer drag
  giveUp: number; // 0..1 ALT hold progress
  moves: number;
  recycles: number;
  timeBonus: number;
}

/** Vertical offset of face-up cards in a tableau pile (shrinks for tall piles). */
export function upOffset(p: TabPile): number {
  const up = p.cards.length - p.down;
  if (up <= 1) return UP_OFF;
  const room = TAB_BOTTOM - TAB_Y - CH - p.down * DOWN_OFF;
  return Math.max(10, Math.min(UP_OFF, Math.floor(room / (up - 1))));
}

export function tabCardY(p: TabPile, i: number): number {
  const d = Math.min(i, p.down);
  return TAB_Y + d * DOWN_OFF + Math.max(0, i - p.down) * upOffset(p);
}

/** Top-left of card idx in pile (idx -1 = empty slot / top). */
export function cardPos(v: { waste: number[]; tab: TabPile[] }, pile: number, idx: number): { x: number; y: number } {
  const x = colX(pileCol(pile));
  if (pile >= TAB0) return { x, y: idx < 0 ? TAB_Y : tabCardY(v.tab[pile - TAB0], idx) };
  if (pile === WASTE) {
    const n = Math.min(3, v.waste.length);
    const k = idx < 0 ? n - 1 : idx - (v.waste.length - n);
    return { x: x + Math.max(0, k) * FAN, y: TOP_Y };
  }
  return { x, y: TOP_Y };
}

/** Pile under a point (generous columns), or -1. */
export function pileAt(x: number, y: number): number {
  const col = Math.floor((x - MX + GAP / 2) / (CW + GAP));
  if (col < 0 || col > 6 || y < TOP_Y - 8) return -1;
  if (y < TAB_Y - 4) {
    if (col === 0) return STOCK;
    if (col === 1) return WASTE;
    if (col === 2) return -1;
    return FOUND0 + col - 3;
  }
  return TAB0 + col;
}

const inRect = (x: number, y: number, rx: number, ry: number, rw: number, rh: number) => x >= rx && x < rx + rw && y >= ry && y < ry + rh;

export class SolitaireEngine implements GameEngine<SolitaireView> {
  private rng: Rng;
  stock: number[] = [];
  waste: number[] = [];
  found: number[][] = [[], [], [], []];
  tab: TabPile[] = [];
  score = 0;
  frame = 0;
  events: GameEvent[] = [];
  private timeLeft = TIME_LIMIT;
  private phase: "play" | "auto" | "won" | "over" = "play";
  private wonFrame = 0;
  private status: "playing" | "over" | "won" = "playing";
  private stuck = false;
  private dirty = true;
  private prevB = 0;
  private px = -1;
  private py = -1;
  private cursor: Held = { pile: TAB0, idx: 0 };
  private keyMode = false;
  private held: Held | null = null;
  private press: { pile: number; idx: number; sx: number; sy: number; ox: number; oy: number } | null = null;
  private drag: Drag | null = null;
  private altFrames = 0;
  private autoTimer = 0;
  private moves = 0;
  private recycles = 0;
  private timeBonus = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    const deck: number[] = [];
    for (let c = 0; c < 52; c++) deck.push(c);
    for (let i = 51; i > 0; i--) {
      const j = this.rng.int(i + 1);
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    for (let p = 0; p < 7; p++) {
      const cards: number[] = [];
      for (let k = 0; k <= p; k++) cards.push(deck.pop()!);
      this.tab.push({ cards, down: p });
    }
    this.stock = deck;
    this.cursor = { pile: TAB0, idx: 0 };
  }

  /** Test helper: replace the layout. */
  setLayout(s: { stock?: number[]; waste?: number[]; found?: number[][]; tab?: TabPile[] }) {
    if (s.stock) this.stock = s.stock.slice();
    if (s.waste) this.waste = s.waste.slice();
    if (s.found) this.found = s.found.map((f) => f.slice());
    if (s.tab) this.tab = s.tab.map((t) => ({ cards: t.cards.slice(), down: t.down }));
    this.dirty = true;
  }

  // ---------- rules ----------
  private pileCards(pile: number): number[] {
    if (pile === STOCK) return this.stock;
    if (pile === WASTE) return this.waste;
    if (pile < TAB0) return this.found[pile - FOUND0];
    return this.tab[pile - TAB0].cards;
  }

  /** Can cards[idx..] of src be picked up? */
  canPick(pile: number, idx: number): boolean {
    if (pile === STOCK) return false;
    const cards = this.pileCards(pile);
    if (idx < 0 || idx >= cards.length) return false;
    if (pile < TAB0) return idx === cards.length - 1;
    return idx >= this.tab[pile - TAB0].down;
  }

  canFoundation(card: number, f: number): boolean {
    const fp = this.found[f];
    if (!fp.length) return rankOf(card) === 1;
    const top = fp[fp.length - 1];
    return suitOf(top) === suitOf(card) && rankOf(card) === rankOf(top) + 1;
  }

  canTableau(card: number, t: number): boolean {
    const tp = this.tab[t];
    if (!tp.cards.length) return rankOf(card) === 13;
    const top = tp.cards[tp.cards.length - 1];
    return isRed(top) !== isRed(card) && rankOf(card) === rankOf(top) - 1;
  }

  canMove(src: number, idx: number, dst: number): boolean {
    if (src === dst || dst < FOUND0 || !this.canPick(src, idx)) return false;
    const cards = this.pileCards(src);
    const card = cards[idx];
    if (dst < TAB0) return idx === cards.length - 1 && this.canFoundation(card, dst - FOUND0);
    return this.canTableau(card, dst - TAB0);
  }

  /** Best auto destination for cards[idx..] of src, or -1. */
  bestTarget(src: number, idx: number): number {
    if (!this.canPick(src, idx)) return -1;
    const cards = this.pileCards(src);
    if ((idx === cards.length - 1 && src >= TAB0) || src === WASTE) {
      for (let f = 0; f < 4; f++) if (this.canMove(src, idx, FOUND0 + f)) return FOUND0 + f;
    }
    let empty = -1;
    const base = src >= TAB0 ? src - TAB0 : 0;
    for (let k = 0; k < 7; k++) {
      const t = (base + 1 + k) % 7; // scan to the right of the source first
      if (!this.canMove(src, idx, TAB0 + t)) continue;
      if (this.tab[t].cards.length) return TAB0 + t;
      // A king that already heads its pile gains nothing from an empty pile.
      if (empty < 0 && !(src >= TAB0 && idx === 0)) empty = TAB0 + t;
    }
    return empty;
  }

  private addScore(n: number) {
    this.score = Math.max(0, this.score + n);
  }

  /** Execute a validated move. */
  private doMove(src: number, idx: number, dst: number) {
    const cards = this.pileCards(src);
    const moving = cards.splice(idx);
    const dstCards = this.pileCards(dst);
    const p0 = cardPos(this, dst, dstCards.length);
    for (const c of moving) dstCards.push(c);
    this.moves++;
    this.dirty = true;
    this.held = null;
    let gain = 0;
    if (dst < TAB0) gain = SCORE.FOUND;
    else if (src === WASTE) gain = SCORE.WASTE_TAB;
    else if (src >= FOUND0 && src < TAB0) gain = SCORE.FOUND_TAB;
    this.addScore(gain);
    const card = moving[0];
    const pos = cardPos(this, dst, dstCards.length - moving.length);
    const ex = pos.x + CW / 2, ey = (dst >= TAB0 ? p0.y : pos.y) + CH / 2;
    if (dst < TAB0) {
      const full = dstCards.length === 13;
      this.events.push({ t: "found", card, pile: dst, gain, sfx: full ? "extraGood" : "brick", mood: full ? "happy" : undefined, x: ex, y: ey });
    } else {
      this.events.push({ t: "place", card, pile: dst, n: moving.length, gain, sfx: "paddle", x: ex, y: ey });
    }
    if (src >= TAB0) {
      const tp = this.tab[src - TAB0];
      if (tp.down > 0 && tp.down >= tp.cards.length) {
        tp.down--;
        this.addScore(SCORE.FLIP);
        const fp = cardPos(this, src, tp.cards.length - 1);
        this.events.push({ t: "flip", card: tp.cards[tp.down], pile: src, gain: SCORE.FLIP, sfx: "brickgone", x: fp.x + CW / 2, y: fp.y + CH / 2 });
      }
    }
    this.checkEnd();
  }

  private tryMove(src: number, idx: number, dst: number): boolean {
    if (!this.canMove(src, idx, dst)) {
      this.events.push({ t: "bad", pile: src, sfx: "wall", shake: 2 });
      return false;
    }
    this.doMove(src, idx, dst);
    return true;
  }

  private autoMove(src: number, idx: number): boolean {
    const dst = this.bestTarget(src, idx);
    if (dst < 0) {
      const p = cardPos(this, src, idx);
      this.events.push({ t: "bad", pile: src, sfx: "wall", shake: 2, x: p.x + CW / 2, y: p.y + CH / 2 });
      return false;
    }
    this.doMove(src, idx, dst);
    return true;
  }

  private draw() {
    this.held = null;
    if (this.stock.length) {
      this.waste.push(this.stock.pop()!);
      this.dirty = true;
      const p = cardPos(this, WASTE, -1);
      this.events.push({ t: "draw", card: this.waste[this.waste.length - 1], sfx: "shot", x: p.x + CW / 2, y: p.y + CH / 2 });
    } else if (this.waste.length) {
      while (this.waste.length) this.stock.push(this.waste.pop()!);
      this.recycles++;
      this.addScore(SCORE.RECYCLE);
      this.dirty = true;
      this.events.push({ t: "recycle", gain: SCORE.RECYCLE, sfx: "launch", x: colX(0) + CW / 2, y: TOP_Y + CH / 2 });
    } else {
      this.events.push({ t: "bad", pile: STOCK, sfx: "wall" });
    }
  }

  private checkEnd() {
    if (this.found.every((f) => f.length === 13)) {
      this.phase = "won";
      this.status = "won";
      this.wonFrame = this.frame;
      this.timeBonus = Math.floor(this.timeLeft / 60) * TIME_BONUS_PER_SEC;
      this.addScore(this.timeBonus);
      this.held = null;
      this.drag = null;
      this.press = null;
      this.events.push({ t: "won", bonus: this.timeBonus, sfx: "won", mood: "happy", toast: "levelClear" });
      return;
    }
    if (this.phase === "play" && !this.stock.length && !this.waste.length && this.tab.every((t) => t.down === 0)) {
      this.phase = "auto";
      this.held = null;
      this.drag = null;
      this.press = null;
      this.autoTimer = 0;
      this.events.push({ t: "autofinish", sfx: "levelclear", mood: "happy" });
    }
  }

  private end(reason: string) {
    if (this.phase === "over" || this.phase === "won") return;
    this.phase = "over";
    this.status = "over";
    this.held = null;
    this.drag = null;
    this.press = null;
    this.events.push({ t: "end", reason, sfx: "gameover", mood: this.score > 0 ? "happy" : "sad" });
  }

  // ---------- "no more moves" ----------
  /** Moves that make progress (used for the stuck check and the bot). Foundation-to-tableau moves are ignored. */
  usefulMoves(): { src: number; idx: number; dst: number }[] {
    const out: { src: number; idx: number; dst: number }[] = [];
    for (let t = 0; t < 7; t++) {
      const tp = this.tab[t];
      const n = tp.cards.length;
      if (!n) continue;
      for (let f = 0; f < 4; f++) if (this.canMove(TAB0 + t, n - 1, FOUND0 + f)) { out.push({ src: TAB0 + t, idx: n - 1, dst: FOUND0 + f }); break; }
      if (tp.down > 0) {
        for (let u = 0; u < 7; u++) if (this.canMove(TAB0 + t, tp.down, TAB0 + u)) { out.push({ src: TAB0 + t, idx: tp.down, dst: TAB0 + u }); break; }
      }
    }
    if (this.waste.length) {
      const i = this.waste.length - 1;
      for (let d = FOUND0; d < TAB0 + 7; d++) if (this.canMove(WASTE, i, d)) { out.push({ src: WASTE, idx: i, dst: d }); break; }
    }
    return out;
  }

  /** Any stock or waste card (reachable by cycling) that can be played somewhere. */
  private reserveHasPlay(): boolean {
    const cards = this.stock.concat(this.waste);
    for (const c of cards) {
      for (let f = 0; f < 4; f++) if (this.canFoundation(c, f)) return true;
      for (let t = 0; t < 7; t++) if (this.canTableau(c, t)) return true;
    }
    return false;
  }

  private updateStuck() {
    if (!this.dirty) return;
    this.dirty = false;
    const was = this.stuck;
    this.stuck = this.phase === "play" && this.usefulMoves().length === 0 && !this.reserveHasPlay();
    if (this.stuck && !was) this.events.push({ t: "stuck", sfx: "extraBad", mood: "sad" });
  }

  // ---------- input ----------
  private hitCard(x: number, y: number): Held | null {
    // Tableau: topmost card whose rect contains the point.
    for (let t = 0; t < 7; t++) {
      const tp = this.tab[t];
      const cx = colX(t);
      if (x < cx || x >= cx + CW) continue;
      for (let i = tp.cards.length - 1; i >= 0; i--) {
        const cy = tabCardY(tp, i);
        if (inRect(x, y, cx, cy, CW, CH)) return { pile: TAB0 + t, idx: i };
      }
      if (inRect(x, y, cx, TAB_Y, CW, CH)) return { pile: TAB0 + t, idx: -1 };
    }
    if (y >= TOP_Y - 4 && y < TOP_Y + CH + 4) {
      if (inRect(x, y, colX(0) - 2, TOP_Y - 4, CW + 4, CH + 8)) return { pile: STOCK, idx: this.stock.length - 1 };
      if (this.waste.length) {
        const p = cardPos(this, WASTE, -1);
        if (inRect(x, y, p.x - 2, TOP_Y - 4, CW + 4, CH + 8)) return { pile: WASTE, idx: this.waste.length - 1 };
      }
      for (let f = 0; f < 4; f++) {
        const fx = colX(f + 3);
        if (inRect(x, y, fx, TOP_Y - 4, CW, CH + 8)) return { pile: FOUND0 + f, idx: this.found[f].length - 1 };
      }
    }
    return null;
  }

  private clampCursor() {
    const c = this.cursor;
    if (c.pile >= TAB0) {
      const tp = this.tab[c.pile - TAB0];
      const top = tp.cards.length - 1;
      if (c.idx > top || c.idx < tp.down) c.idx = top;
    } else {
      c.idx = this.pileCards(c.pile).length - 1;
    }
  }

  private topRowPile(col: number): number {
    if (col <= 0) return STOCK;
    if (col === 1 || col === 2) return WASTE;
    return FOUND0 + col - 3;
  }

  private keyNav(pressed: number) {
    const c = this.cursor;
    const col = pileCol(c.pile);
    if (pressed & (BTN.LEFT | BTN.RIGHT)) {
      const d = pressed & BTN.LEFT ? -1 : 1;
      if (c.pile >= TAB0) {
        c.pile = TAB0 + ((col + d + 7) % 7);
        c.idx = this.tab[c.pile - TAB0].cards.length - 1;
      } else {
        const order = [STOCK, WASTE, FOUND0, FOUND0 + 1, FOUND0 + 2, FOUND0 + 3];
        const k = order.indexOf(c.pile);
        c.pile = order[(k + d + order.length) % order.length];
      }
    } else if (pressed & BTN.UP) {
      if (c.pile >= TAB0) {
        const tp = this.tab[c.pile - TAB0];
        if (c.idx - 1 >= tp.down && c.idx - 1 >= 0) c.idx--;
        else c.pile = this.topRowPile(col);
      }
    } else if (pressed & BTN.DOWN) {
      if (c.pile < TAB0) {
        c.pile = TAB0 + col;
        c.idx = this.tab[col].cards.length - 1;
      } else if (c.idx < this.tab[c.pile - TAB0].cards.length - 1) c.idx++;
    }
    this.clampCursor();
  }

  private keyFire() {
    const c = this.cursor;
    if (!this.held) {
      if (c.pile === STOCK) return this.draw();
      if (this.canPick(c.pile, c.idx)) {
        this.held = { pile: c.pile, idx: c.idx };
        this.events.push({ t: "pick", pile: c.pile, idx: c.idx });
      } else this.events.push({ t: "bad", pile: c.pile, sfx: "wall" });
      return;
    }
    const h = this.held;
    this.held = null;
    if (c.pile === h.pile) this.autoMove(h.pile, h.idx);
    else if (c.pile === STOCK) this.draw();
    else this.tryMove(h.pile, h.idx, c.pile);
  }

  private handleInput(inp: Input) {
    const pressed = inp.b & ~this.prevB;
    const released = this.prevB & ~inp.b;
    this.prevB = inp.b;
    const moved = inp.x !== this.px || inp.y !== this.py;
    this.px = inp.x;
    this.py = inp.y;

    // ALT: tap draws (or ends when stuck), hold 1 s gives up.
    if (inp.b & BTN.ALT) {
      if (++this.altFrames === GIVEUP_FRAMES) {
        this.end("giveup");
        return;
      }
    } else if (released & BTN.ALT) {
      const held = this.altFrames;
      this.altFrames = 0;
      if (held > 0 && held < GIVEUP_FRAMES) {
        if (this.stuck) return this.end("stuck");
        this.draw();
      }
    } else this.altFrames = 0;

    if (pressed & (BTN.UP | BTN.DOWN | BTN.LEFT | BTN.RIGHT)) {
      this.keyMode = true;
      this.press = null;
      this.drag = null;
      this.keyNav(pressed);
      return;
    }
    if (moved) {
      if (this.keyMode) this.held = null;
      this.keyMode = false;
      const hit = this.hitCard(inp.x, inp.y);
      if (hit && !this.press) {
        this.cursor = { pile: hit.pile, idx: hit.idx };
        this.clampCursor();
      }
    }

    if (pressed & BTN.FIRE) {
      if (this.stuck && inRect(inp.x, inp.y, END_BTN.x, END_BTN.y, END_BTN.w, END_BTN.h)) return this.end("stuck");
      if (this.keyMode) return this.keyFire();
      const hit = this.hitCard(inp.x, inp.y);
      if (!hit) return;
      if (hit.pile === STOCK) return this.draw();
      if (this.canPick(hit.pile, hit.idx)) {
        const p = cardPos(this, hit.pile, hit.idx);
        this.press = { pile: hit.pile, idx: hit.idx, sx: inp.x, sy: inp.y, ox: inp.x - p.x, oy: inp.y - p.y };
        this.events.push({ t: "pick", pile: hit.pile, idx: hit.idx });
      }
      return;
    }

    const pr = this.press;
    if (!pr) return;
    if (inp.b & BTN.FIRE) {
      if (!this.drag && Math.abs(inp.x - pr.sx) + Math.abs(inp.y - pr.sy) >= DRAG_PX) this.drag = { pile: pr.pile, idx: pr.idx, x: 0, y: 0 };
      if (this.drag) {
        this.drag.x = inp.x - pr.ox;
        this.drag.y = inp.y - pr.oy;
      }
      return;
    }
    // Released.
    this.press = null;
    if (this.drag) {
      const d = this.drag;
      this.drag = null;
      const dst = pileAt(d.x + CW / 2, d.y + 18);
      if (dst >= FOUND0 && dst !== d.pile && this.canMove(d.pile, d.idx, dst)) this.doMove(d.pile, d.idx, dst);
      else if (dst !== d.pile) this.events.push({ t: "bad", pile: d.pile, sfx: "wall", shake: 2 });
    } else {
      this.autoMove(pr.pile, pr.idx);
    }
  }

  step(inp: Input) {
    this.frame++;
    this.events = [];
    if (this.phase === "over") return;
    if (this.phase === "won") {
      if (this.frame - this.wonFrame >= WIN_FRAMES) this.phase = "over";
      return;
    }
    if (--this.timeLeft <= 0) {
      this.timeLeft = 0;
      this.end("time");
      return;
    }
    if (this.phase === "auto") {
      this.prevB = inp.b;
      if (++this.autoTimer >= AUTO_EVERY) {
        this.autoTimer = 0;
        // Lowest rank first, so the foundations rise evenly.
        let best = -1, bestRank = 99, bestF = -1;
        for (let t = 0; t < 7; t++) {
          const tp = this.tab[t];
          if (!tp.cards.length) continue;
          const c = tp.cards[tp.cards.length - 1];
          for (let f = 0; f < 4; f++) {
            if (this.canFoundation(c, f) && rankOf(c) < bestRank) {
              best = t;
              bestRank = rankOf(c);
              bestF = f;
            }
          }
        }
        if (best >= 0) this.doMove(TAB0 + best, this.tab[best].cards.length - 1, FOUND0 + bestF);
        else this.phase = "play"; // cannot happen with a full deck; stay safe
      }
      return;
    }
    this.handleInput(inp);
    if (this.phase === "play") this.clampCursor();
    this.updateStuck();
  }

  view(): SolitaireView {
    return {
      frame: this.frame,
      stock: this.stock.slice(),
      waste: this.waste.slice(),
      found: this.found.map((f) => f.slice()),
      tab: this.tab.map((t) => ({ cards: t.cards.slice(), down: t.down })),
      score: this.score,
      timeLeft: this.timeLeft,
      phase: this.phase,
      wonFrame: this.wonFrame,
      stuck: this.stuck,
      cursor: { ...this.cursor },
      keyMode: this.keyMode,
      held: this.held ? { ...this.held } : null,
      drag: this.drag ? { ...this.drag } : null,
      giveUp: this.altFrames / GIVEUP_FRAMES,
      moves: this.moves,
      recycles: this.recycles,
      timeBonus: this.timeBonus,
    };
  }

  hud(): Hud {
    const s = Math.ceil(this.timeLeft / 60);
    const home = this.found.reduce((n, f) => n + f.length, 0);
    return { score: this.score, label: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}  ${home}/52` };
  }

  result(): GameResult {
    const home = this.found.reduce((n, f) => n + f.length, 0);
    return { score: this.score, level: 0, levelsCleared: home === 52 ? 1 : 0, frames: this.frame, status: this.status };
  }

  get done() {
    return this.phase === "over";
  }
}

// ---------- bot ----------
const BOT_EVERY = 18;

function botTarget(v: SolitaireView): { x: number; y: number } | null {
  if (v.stuck) return { x: END_BTN.x + END_BTN.w / 2, y: END_BTN.y + END_BTN.h / 2 };
  // Rebuild a throwaway engine state to reuse the rules.
  const e = new SolitaireEngine(0);
  e.setLayout({ stock: v.stock, waste: v.waste, found: v.found, tab: v.tab });
  const moves = e.usefulMoves();
  // Prefer foundation moves, then uncovering moves, then waste plays. The bot
  // is greedy and never plans ahead, so it loses plenty of deals.
  moves.sort((a, b) => (a.dst < TAB0 ? 0 : a.src === WASTE ? 2 : 1) - (b.dst < TAB0 ? 0 : b.src === WASTE ? 2 : 1));
  const m = moves[0];
  if (m) {
    const p = cardPos(v, m.src, m.idx);
    return { x: Math.round(p.x + CW / 2), y: Math.round(p.y + 8) };
  }
  if (v.stock.length || v.waste.length) return { x: colX(0) + CW / 2, y: TOP_Y + CH / 2 };
  return null;
}

export const solitaire: GameDef<SolitaireView> = {
  id: "solitaire",
  name: "Moon Solitaire",
  tagline: "The classic patience game, coin edition. Clear all 52 cards to the moon before the clock runs out.",
  genre: "Card solitaire",
  session: "3–10 min",
  controls: "Tap a card to auto-move it, or drag it onto a pile. Tap the deck to draw. Keys: arrows move, Space picks/places, X draws, hold X to give up.",
  field: { w: FIELD_W, h: FIELD_H },
  input: { pointer: true, swipe: false, arrowsAsButtons: true },
  maxFrames: TIME_LIMIT + WIN_FRAMES + 120,
  credits: {
    basedOn: "Original",
    url: "",
    authors: "ArcadePad",
    licence: "GPL-3.0-or-later",
    notes: "Original implementation of public-domain Klondike rules (draw one, classic scoring). All code, card art and sounds written for ArcadePad; no names, look or assets from any commercial solitaire.",
  },
  create: (seed) => new SolitaireEngine(seed),
  bot(v, frame) {
    if (v.phase !== "play") return { x: FIELD_W / 2, y: FIELD_H / 2, b: 0 };
    const k = frame % BOT_EVERY;
    const t = botTarget(v);
    if (!t) return { x: FIELD_W / 2, y: FIELD_H - 4, b: BTN.ALT }; // nothing left: hold ALT to give up
    // Move onto the target, then tap (press one frame, release the next).
    return { x: t.x, y: t.y, b: k === BOT_EVERY - 2 ? BTN.FIRE : 0 };
  },
};
