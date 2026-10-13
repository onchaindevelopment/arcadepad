#!/usr/bin/env node
// End-to-end check of sign-in + replay anti-cheat against a running dev server.
//   npm run dev   (port 4155)   then   npm run test:e2e
import { ed25519 } from "@noble/curves/ed25519.js";
import { base58 } from "@scure/base";
import { encodeInputs } from "../src/games/core/replay.ts";
import { getGame } from "../src/games/registry.ts";

const BASE = process.env.BASE_URL ?? "http://localhost:4155";
let cookie = "";
let failures = 0;

async function api(path, body) {
  const r = await fetch(BASE + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: r.status, data: await r.json().catch(() => ({})) };
}
function check(name, ok, extra = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  " + extra : ""}`);
  if (!ok) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function bot(gameId, seed, frames, ticker) {
  const def = getGame(gameId);
  const g = def.create(seed, { ticker });
  const inputs = [];
  for (let i = 0; i < frames && !g.done; i++) {
    const inp = def.bot(g.view(), g.frame);
    inputs.push(inp);
    g.step(inp);
  }
  return { inputs, result: g.result() };
}

// 1. Wallet sign-in (Solana-style ed25519 key)
const sk = ed25519.utils.randomSecretKey();
const address = base58.encode(ed25519.getPublicKey(sk));
console.log(`test wallet: ${address}`);
const n = await api("/api/auth/nonce", { chain: "solana", address });
check("nonce issued", n.status === 200 && n.data.message.includes(address));
const badSig = base58.encode(ed25519.sign(new TextEncoder().encode(n.data.message + "x"), sk));
check("forged signature rejected", (await api("/api/auth/verify", { token: n.data.token, signature: badSig })).status === 401);
const sig = base58.encode(ed25519.sign(new TextEncoder().encode(n.data.message), sk));
const v = await api("/api/auth/verify", { token: n.data.token, signature: sig });
check("signature accepted", v.status === 200 && v.data.address === address);
check("nonce single-use", (await api("/api/auth/verify", { token: n.data.token, signature: sig })).status === 409);
check("session active", (await api("/api/auth/me")).data.address === address);

// 2. Honest ranked run: 10 s of bot play, in real time
const start = await api("/api/run/start", { game: "breakout", theme: "glorp" });
check("run started (ranked)", start.status === 200 && start.data.ranked === true);
const FRAMES = 600;
const { inputs, result } = bot("breakout", start.data.seed, FRAMES, "GLORP");
await sleep((FRAMES / 60) * 1000 + 300);
const enc = encodeInputs(inputs);

const tampered = await api("/api/run/submit", { runId: start.data.runId, inputs: enc, score: result.score + 5000, frames: result.frames });
check("tampered score rejected", tampered.status === 422, `server replay says ${tampered.data.replayScore}`);

const honest = await api("/api/run/submit", { runId: start.data.runId, inputs: enc, score: result.score, frames: result.frames });
check("honest run accepted", honest.status === 200 && honest.data.score === result.score, `score ${result.score}, rank ${honest.data.rank}`);
check("resubmit rejected", (await api("/api/run/submit", { runId: start.data.runId, inputs: enc, score: result.score, frames: result.frames })).status === 409);

// 3. Too fast: a 2-minute run submitted right away
const fast = await api("/api/run/start", { game: "breakout", theme: "nubbin" });
const long = bot("breakout", fast.data.seed, 7200, "NUBBIN");
const fr = await api("/api/run/submit", { runId: fast.data.runId, inputs: encodeInputs(long.inputs), score: long.result.score, frames: long.result.frames });
check("faster-than-real-time rejected", fr.status === 422, fr.data.error);

// 3b. A second game through the same pipeline (Snake, 8 s)
const sn = await api("/api/run/start", { game: "snake", theme: "wobbl" });
const snRun = bot("snake", sn.data.seed, 480, "WOBBL");
await sleep((snRun.result.frames / 60) * 1000 + 300);
const snSub = await api("/api/run/submit", { runId: sn.data.runId, inputs: encodeInputs(snRun.inputs), score: snRun.result.score, frames: snRun.result.frames });
check("second game (snake) verified", snSub.status === 200 && snSub.data.score === snRun.result.score, `score ${snRun.result.score}`);

// 4. Card + leaderboard
const card = await fetch(`${BASE}/api/card/${honest.data.scoreId}`);
check("score card renders PNG", card.status === 200 && card.headers.get("content-type") === "image/png", `${(await card.arrayBuffer()).byteLength} bytes`);
const lb = await api("/api/leaderboard?game=breakout&theme=glorp");
check("leaderboard lists the run", lb.data.rows.some((r) => r.id === honest.data.scoreId));

console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
console.log(`Share page: ${BASE}/s/${honest.data.scoreId}`);
process.exit(failures ? 1 : 0);
