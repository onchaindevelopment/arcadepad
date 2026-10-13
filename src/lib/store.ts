// Storage: Postgres (Neon) when DATABASE_URL is set, otherwise a JSON file in
// ./data for local development. Both backends share one async API.
import "server-only";
import { pgStore } from "./store-pg";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface RunRecord {
  id: string;
  theme: string;
  seed: number;
  wallet: string | null;
  chain: string | null;
  startedAt: number;
  submittedAt?: number;
}

export interface ScoreRecord {
  id: string;
  runId: string;
  theme: string;
  wallet: string | null;
  chain: string | null;
  score: number;
  level: number;
  levelsCleared: number;
  frames: number;
  status: string;
  createdAt: number;
}

export interface OrderRecord {
  id: string;
  createdAt: number;
  coinName: string;
  ticker: string;
  chain: string;
  contract: string;
  game: string;
  mascot: string;
  colors: string;
  links: string;
  contact: string;
  timeline: string;
  notes: string;
  rightsConfirmed: boolean;
}

interface Db {
  runs: Record<string, RunRecord>;
  scores: ScoreRecord[];
  orders: OrderRecord[];
  usedNonces: Record<string, number>; // nonce -> expiry ms
}

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), "data");
const FILE = path.join(DATA_DIR, "db.json");

let cache: Db | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<Db> {
  if (cache) return cache;
  try {
    cache = JSON.parse(await fs.readFile(FILE, "utf8")) as Db;
  } catch {
    cache = { runs: {}, scores: [], orders: [], usedNonces: {} };
  }
  return cache;
}

function persist(db: Db): Promise<void> {
  writing = writing.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const tmp = FILE + ".tmp";
    await fs.writeFile(tmp, JSON.stringify(db));
    await fs.rename(tmp, FILE);
  });
  return writing;
}

function prune(db: Db) {
  const now = Date.now();
  for (const [n, exp] of Object.entries(db.usedNonces)) if (exp < now) delete db.usedNonces[n];
  // Unsubmitted runs older than a day are dead.
  for (const [id, r] of Object.entries(db.runs)) if (!r.submittedAt && r.startedAt < now - 86_400_000) delete db.runs[id];
}

const fileStore = {
  async createRun(r: RunRecord) {
    const db = await load();
    prune(db);
    db.runs[r.id] = r;
    await persist(db);
  },
  async getRun(id: string): Promise<RunRecord | undefined> {
    return (await load()).runs[id];
  },
  /** Marks the run submitted; returns false if it already was (single use). */
  async claimRun(id: string, at: number): Promise<boolean> {
    const db = await load();
    const r = db.runs[id];
    if (!r || r.submittedAt) return false;
    r.submittedAt = at;
    await persist(db);
    return true;
  },
  async addScore(s: ScoreRecord) {
    const db = await load();
    db.scores.push(s);
    await persist(db);
  },
  async getScore(id: string) {
    return (await load()).scores.find((s) => s.id === id);
  },
  /** Best score per wallet for a theme (or all themes), ranked. Guests are excluded. */
  async leaderboard(theme: string | null, limit = 50): Promise<ScoreRecord[]> {
    const db = await load();
    const best = new Map<string, ScoreRecord>();
    for (const s of db.scores) {
      if (!s.wallet || (theme && s.theme !== theme)) continue;
      const key = theme ? s.wallet : `${s.wallet}:${s.theme}`;
      const cur = best.get(key);
      if (!cur || s.score > cur.score || (s.score === cur.score && s.createdAt < cur.createdAt)) best.set(key, s);
    }
    return [...best.values()].sort((a, b) => b.score - a.score || a.createdAt - b.createdAt).slice(0, limit);
  },
  async rankOf(s: ScoreRecord): Promise<number | null> {
    if (!s.wallet) return null;
    const board = await fileStore.leaderboard(s.theme, 100000);
    const i = board.findIndex((b) => b.wallet === s.wallet);
    if (i < 0) return null;
    // Rank of this score even if it isn't the wallet's best.
    return board.filter((b) => b.score > s.score).length + 1;
  },
  async useNonce(nonce: string, expiresAt: number): Promise<boolean> {
    const db = await load();
    prune(db);
    if (db.usedNonces[nonce]) return false;
    db.usedNonces[nonce] = expiresAt;
    await persist(db);
    return true;
  },
  async addOrder(o: OrderRecord) {
    const db = await load();
    db.orders.push(o);
    await persist(db);
  },
};

export type Store = typeof fileStore;
export const store: Store = process.env.DATABASE_URL ? pgStore(process.env.DATABASE_URL) : fileStore;
