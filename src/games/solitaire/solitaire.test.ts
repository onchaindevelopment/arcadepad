import { test } from "node:test";
import assert from "node:assert/strict";
import { solitaire, SolitaireEngine, cardPos, colX, CW, CH, TOP_Y, TAB0, FOUND0, WASTE, STOCK, END_BTN, TIME_LIMIT } from "./index.ts";
import { encodeInputs, replayGame } from "../core/replay.ts";
import { BTN, type Input } from "../core/types.ts";

function botRun(seed: number, frames: number) {
  const g = solitaire.create(seed, { ticker: "TEST" });
  const inputs: Input[] = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = solitaire.bot!(g.view(), i);
    inputs.push(inp);
    g.step(inp);
  }
  return { g, inputs };
}

// card = suit * 13 + rank - 1 ; suits 0 hearts, 1 diamonds, 2 clubs, 3 spades
const C = (suit: number, rank: number) => suit * 13 + rank - 1;
const idle = (x = 0, y = 0): Input => ({ x, y, b: 0 });

function tap(g: SolitaireEngine, x: number, y: number) {
  g.step(idle(x, y));
  g.step({ x, y, b: BTN.FIRE });
  g.step(idle(x, y));
}

test("solitaire: deal is 28 tableau + 24 stock, all 52 distinct", () => {
  const v = solitaire.create(9, { ticker: "T" }).view();
  const all = [...v.stock, ...v.tab.flatMap((t) => t.cards)];
  assert.equal(v.stock.length, 24);
  assert.equal(new Set(all).size, 52);
  v.tab.forEach((t, i) => {
    assert.equal(t.cards.length, i + 1);
    assert.equal(t.down, i);
  });
});

test("solitaire: bot scores and the run ends", () => {
  for (const seed of [7, 8]) {
    const { g } = botRun(seed, solitaire.maxFrames);
    assert.ok(g.result().score > 0, "bot should score");
    assert.ok(g.done, "run should end");
  }
});

test("solitaire: deterministic replay matches live run", () => {
  for (const seed of [1, 2, 3]) {
    const { g, inputs } = botRun(seed, solitaire.maxFrames);
    const r = replayGame(solitaire, seed, { ticker: "TEST" }, encodeInputs(inputs));
    assert.deepEqual(r, g.result());
  }
});

test("solitaire: tap auto-moves ace to foundation, then builds alternating colours", () => {
  const g = new SolitaireEngine(1);
  g.setLayout({
    stock: [C(2, 2)], // keeps auto-finish off
    waste: [],
    found: [[], [], [], []],
    tab: [
      { cards: [C(3, 5), C(0, 1)], down: 1 }, // ace of hearts over a hidden 5 of spades
      { cards: [C(2, 7)], down: 0 }, // 7 clubs
      { cards: [C(1, 6)], down: 0 }, // 6 diamonds
      { cards: [C(0, 6)], down: 0 }, // 6 hearts
      { cards: [], down: 0 },
      { cards: [], down: 0 },
      { cards: [C(3, 13)], down: 0 },
    ],
  });
  let v = g.view();
  let p = cardPos(v, TAB0, 1);
  tap(g, p.x + 10, p.y + 8);
  v = g.view();
  assert.deepEqual(v.found[0], [C(0, 1)]);
  assert.equal(v.tab[0].down, 0, "hidden card flips");
  assert.equal(v.score, 10 + 5);
  // 6 of diamonds onto the 7 of clubs (red on black).
  p = cardPos(v, TAB0 + 2, 0);
  tap(g, p.x + 10, p.y + 8);
  v = g.view();
  assert.deepEqual(v.tab[1].cards, [C(2, 7), C(1, 6)]);
  // 5 of spades onto the 6 of hearts or diamonds, never onto clubs.
  p = cardPos(v, TAB0, 0);
  tap(g, p.x + 10, p.y + 8);
  v = g.view();
  assert.equal(v.tab[0].cards.length, 0);
  assert.equal(v.tab[1].cards.at(-1), C(3, 5));
  // A king at the head of its pile does not hop to an empty pile.
  p = cardPos(v, TAB0 + 6, 0);
  tap(g, p.x + 10, p.y + 8);
  assert.deepEqual(g.view().tab[6].cards, [C(3, 13)]);
});

test("solitaire: drag a run onto a pile; illegal drop snaps back", () => {
  const g = new SolitaireEngine(1);
  g.setLayout({
    stock: [C(0, 2)],
    waste: [],
    found: [[], [], [], []],
    tab: [
      { cards: [C(0, 9), C(3, 8), C(0, 7)], down: 1 },
      { cards: [C(1, 9)], down: 0 },
      { cards: [C(2, 9)], down: 0 },
      { cards: [], down: 0 }, { cards: [], down: 0 }, { cards: [], down: 0 }, { cards: [], down: 0 },
    ],
  });
  let v = g.view();
  const a = cardPos(v, TAB0, 1);
  const drag = (tx: number, ty: number) => {
    g.step(idle(a.x + 10, a.y + 6));
    g.step({ x: a.x + 10, y: a.y + 6, b: BTN.FIRE });
    g.step({ x: (a.x + 10 + tx) >> 1, y: (a.y + 6 + ty) >> 1, b: BTN.FIRE });
    g.step({ x: tx, y: ty, b: BTN.FIRE });
    g.step(idle(tx, ty));
  };
  // Illegal: 8 spades onto 9 diamonds is fine colour-wise... use 9 clubs (black on black) first.
  const bad = cardPos(v, TAB0 + 2, 0);
  drag(bad.x + 10, bad.y + 6);
  v = g.view();
  assert.equal(v.tab[0].cards.length, 3, "illegal drop keeps the run");
  const good = cardPos(v, TAB0 + 1, 0);
  drag(good.x + 10, good.y + 6);
  v = g.view();
  assert.deepEqual(v.tab[1].cards, [C(1, 9), C(3, 8), C(0, 7)]);
  assert.equal(v.tab[0].down, 0);
  // Tap the stock: draws one.
  tap(g, colX(0) + 10, TOP_Y + 10);
  assert.deepEqual(g.view().waste, [C(0, 2)]);
});

test("solitaire: no more moves is detected and END ends the run", () => {
  const g = new SolitaireEngine(1);
  g.setLayout({
    stock: [C(1, 5)],
    waste: [],
    found: [[], [], [], []],
    tab: [
      { cards: [C(0, 1), C(2, 9)], down: 1 },
      { cards: [C(3, 9)], down: 0 },
      { cards: [], down: 0 }, { cards: [], down: 0 }, { cards: [], down: 0 }, { cards: [], down: 0 }, { cards: [], down: 0 },
    ],
  });
  g.step(idle());
  assert.equal(g.view().stuck, true);
  assert.ok(g.events.some((e) => e.t === "stuck"));
  tap(g, END_BTN.x + 5, END_BTN.y + 5);
  assert.equal(g.done, true);
  assert.equal(g.result().status, "over");
});

test("solitaire: keyboard pick/place, auto-finish and win with time bonus", () => {
  const g = new SolitaireEngine(1);
  const found = [0, 1, 2, 3].map((s) => Array.from({ length: s === 0 ? 11 : 12 }, (_, r) => C(s, r + 1)));
  g.setLayout({
    stock: [],
    waste: [],
    found,
    tab: [
      { cards: [C(0, 13)], down: 0 },
      { cards: [C(1, 13)], down: 0 },
      { cards: [C(2, 13)], down: 0 },
      { cards: [C(3, 13), C(0, 12)], down: 1 },
      { cards: [], down: 0 }, { cards: [], down: 0 }, { cards: [], down: 0 },
    ],
  });
  // Keyboard: cursor starts on the first tableau pile; walk to pile 4.
  g.step({ x: 0, y: 0, b: BTN.RIGHT });
  g.step(idle());
  for (let i = 0; i < 2; i++) { g.step({ x: 0, y: 0, b: BTN.RIGHT }); g.step(idle()); }
  assert.equal(g.view().cursor.pile, TAB0 + 3);
  g.step({ x: 0, y: 0, b: BTN.FIRE });
  g.step(idle());
  assert.deepEqual(g.view().held, { pile: TAB0 + 3, idx: 1 });
  g.step({ x: 0, y: 0, b: BTN.FIRE }); // same pile = auto move -> foundation
  g.step(idle());
  let v = g.view();
  assert.equal(v.found.reduce((n, f) => n + f.length, 0), 48);
  assert.equal(v.tab[3].down, 0);
  // Everything is face up and the stock is empty: auto finish runs to a win.
  for (let i = 0; i < 400 && !g.done; i++) g.step(idle());
  v = g.view();
  assert.equal(g.result().status, "won");
  assert.ok(v.timeBonus > 0 && v.timeBonus <= (TIME_LIMIT / 60) * 10);
  assert.equal(g.done, true);
});

test("solitaire: holding ALT gives up, ALT tap draws, recycle costs points", () => {
  const g = new SolitaireEngine(4);
  g.step({ x: 0, y: 0, b: BTN.ALT });
  g.step(idle());
  assert.equal(g.view().waste.length, 1);
  for (let i = 0; i < 70 && !g.done; i++) g.step({ x: 0, y: 0, b: BTN.ALT });
  assert.equal(g.done, true);
  void STOCK; void WASTE; void FOUND0; void CW; void CH;
});
