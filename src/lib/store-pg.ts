// Postgres backend for the store (Neon serverless driver over HTTP).
import "server-only";
import { neon } from "@neondatabase/serverless";
import type { ArcadeRecord, OrderRecord, RunRecord, ScoreRecord, Store } from "./store";

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS runs (
    id text PRIMARY KEY, theme text NOT NULL, seed bigint NOT NULL, wallet text, chain text,
    started_at bigint NOT NULL, submitted_at bigint)`,
  `CREATE TABLE IF NOT EXISTS scores (
    id text PRIMARY KEY, run_id text NOT NULL UNIQUE, theme text NOT NULL, wallet text, chain text,
    score integer NOT NULL, level integer NOT NULL, levels_cleared integer NOT NULL,
    frames integer NOT NULL, status text NOT NULL, created_at bigint NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS scores_board ON scores (theme, wallet, score DESC, created_at)`,
  `CREATE TABLE IF NOT EXISTS orders (id text PRIMARY KEY, created_at bigint NOT NULL, data jsonb NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS used_nonces (nonce text PRIMARY KEY, expires_at bigint NOT NULL)`,
  `ALTER TABLE runs ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'breakout'`,
  `ALTER TABLE scores ADD COLUMN IF NOT EXISTS game text NOT NULL DEFAULT 'breakout'`,
  `CREATE INDEX IF NOT EXISTS scores_game_board ON scores (game, theme, wallet, score DESC, created_at)`,
  `CREATE TABLE IF NOT EXISTS arcades (slug text PRIMARY KEY, owner text NOT NULL, chain text NOT NULL, created_at bigint NOT NULL, hidden boolean NOT NULL DEFAULT false, theme jsonb NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS arcades_owner ON arcades (owner, created_at)`,
  `CREATE INDEX IF NOT EXISTS arcades_new ON arcades (hidden, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS arcade_reports (slug text NOT NULL, reporter text NOT NULL, created_at bigint NOT NULL, PRIMARY KEY (slug, reporter))`,
];

type Row = Record<string, unknown>;

const toRun = (r: Row): RunRecord => ({
  id: String(r.id),
  game: String(r.game ?? "breakout"),
  theme: String(r.theme),
  seed: Number(r.seed),
  wallet: (r.wallet as string) ?? null,
  chain: (r.chain as string) ?? null,
  startedAt: Number(r.started_at),
  submittedAt: r.submitted_at == null ? undefined : Number(r.submitted_at),
});

const toArcade = (r: Row): ArcadeRecord => ({
  slug: String(r.slug),
  owner: String(r.owner),
  chain: String(r.chain),
  createdAt: Number(r.created_at),
  hidden: Boolean(r.hidden),
  theme: typeof r.theme === "string" ? r.theme : JSON.stringify(r.theme),
});

const toScore = (r: Row): ScoreRecord => ({
  id: String(r.id),
  runId: String(r.run_id),
  game: String(r.game ?? "breakout"),
  theme: String(r.theme),
  wallet: (r.wallet as string) ?? null,
  chain: (r.chain as string) ?? null,
  score: Number(r.score),
  level: Number(r.level),
  levelsCleared: Number(r.levels_cleared),
  frames: Number(r.frames),
  status: String(r.status),
  createdAt: Number(r.created_at),
});

export function pgStore(url: string): Store {
  const sql = neon(url);
  let ready: Promise<void> | null = null;
  const schema = () =>
    (ready ??= (async () => {
      for (const q of SCHEMA) await sql.query(q);
    })().catch((e) => {
      ready = null;
      throw e;
    }));

  return {
    async createRun(r: RunRecord) {
      await schema();
      await sql`INSERT INTO runs (id, game, theme, seed, wallet, chain, started_at)
                VALUES (${r.id}, ${r.game}, ${r.theme}, ${r.seed}, ${r.wallet}, ${r.chain}, ${r.startedAt})`;
      // Housekeeping: abandoned runs older than a day.
      if (Math.random() < 0.05) await sql`DELETE FROM runs WHERE submitted_at IS NULL AND started_at < ${Date.now() - 86_400_000}`;
    },
    async getRun(id: string) {
      await schema();
      const rows = await sql`SELECT * FROM runs WHERE id = ${id}`;
      return rows[0] ? toRun(rows[0]) : undefined;
    },
    async claimRun(id: string, at: number) {
      await schema();
      const rows = await sql`UPDATE runs SET submitted_at = ${at} WHERE id = ${id} AND submitted_at IS NULL RETURNING id`;
      return rows.length === 1;
    },
    async addScore(s: ScoreRecord) {
      await schema();
      await sql`INSERT INTO scores (id, run_id, game, theme, wallet, chain, score, level, levels_cleared, frames, status, created_at)
                VALUES (${s.id}, ${s.runId}, ${s.game}, ${s.theme}, ${s.wallet}, ${s.chain}, ${s.score}, ${s.level}, ${s.levelsCleared}, ${s.frames}, ${s.status}, ${s.createdAt})`;
    },
    async getScore(id: string) {
      await schema();
      const rows = await sql`SELECT * FROM scores WHERE id = ${id}`;
      return rows[0] ? toScore(rows[0]) : undefined;
    },
    async leaderboard(game: string, theme: string | null, limit = 50) {
      await schema();
      const rows = theme
        ? await sql`SELECT * FROM (
              SELECT DISTINCT ON (wallet) * FROM scores WHERE wallet IS NOT NULL AND game = ${game} AND theme = ${theme}
              ORDER BY wallet, score DESC, created_at ASC) best
            ORDER BY score DESC, created_at ASC LIMIT ${limit}`
        : await sql`SELECT * FROM (
              SELECT DISTINCT ON (wallet, theme) * FROM scores WHERE wallet IS NOT NULL AND game = ${game}
              ORDER BY wallet, theme, score DESC, created_at ASC) best
            ORDER BY score DESC, created_at ASC LIMIT ${limit}`;
      return rows.map(toScore);
    },
    async rankOf(s: ScoreRecord) {
      if (!s.wallet) return null;
      await schema();
      const rows = await sql`SELECT count(*)::int AS n FROM (
          SELECT wallet, max(score) AS best FROM scores WHERE wallet IS NOT NULL AND game = ${s.game} AND theme = ${s.theme} GROUP BY wallet) t
        WHERE best > ${s.score}`;
      return Number(rows[0].n) + 1;
    },
    async useNonce(nonce: string, expiresAt: number) {
      await schema();
      if (Math.random() < 0.05) await sql`DELETE FROM used_nonces WHERE expires_at < ${Date.now()}`;
      const rows = await sql`INSERT INTO used_nonces (nonce, expires_at) VALUES (${nonce}, ${expiresAt})
                             ON CONFLICT (nonce) DO NOTHING RETURNING nonce`;
      return rows.length === 1;
    },
    async addOrder(o: OrderRecord) {
      await schema();
      const { id, createdAt, ...data } = o;
      await sql`INSERT INTO orders (id, created_at, data) VALUES (${id}, ${createdAt}, ${JSON.stringify(data)}::jsonb)`;
    },
    async createArcade(a: ArcadeRecord) {
      await schema();
      const rows = await sql`INSERT INTO arcades (slug, owner, chain, created_at, hidden, theme)
                VALUES (${a.slug}, ${a.owner}, ${a.chain}, ${a.createdAt}, ${a.hidden}, ${a.theme}::jsonb)
                ON CONFLICT (slug) DO NOTHING RETURNING slug`;
      return rows.length === 1;
    },
    async getArcade(slug: string) {
      await schema();
      const rows = await sql`SELECT * FROM arcades WHERE slug = ${slug}`;
      return rows[0] ? toArcade(rows[0]) : undefined;
    },
    async listArcades(limit = 24) {
      await schema();
      const rows = await sql`SELECT * FROM arcades WHERE hidden = false ORDER BY created_at DESC LIMIT ${limit}`;
      return rows.map(toArcade);
    },
    async countArcadesBy(owner: string, since: number) {
      await schema();
      const rows = await sql`SELECT count(*)::int AS n FROM arcades WHERE owner = ${owner} AND created_at >= ${since}`;
      return Number(rows[0].n);
    },
    async reportArcade(slug: string, reporter: string) {
      await schema();
      await sql`INSERT INTO arcade_reports (slug, reporter, created_at) VALUES (${slug}, ${reporter}, ${Date.now()}) ON CONFLICT DO NOTHING`;
      const rows = await sql`SELECT count(*)::int AS n FROM arcade_reports WHERE slug = ${slug}`;
      return Number(rows[0].n);
    },
    async setArcadeHidden(slug: string, hidden: boolean) {
      await schema();
      await sql`UPDATE arcades SET hidden = ${hidden} WHERE slug = ${slug}`;
    },
    async deleteArcade(slug: string) {
      await schema();
      await sql`DELETE FROM arcade_reports WHERE slug = ${slug}`;
      await sql`DELETE FROM arcades WHERE slug = ${slug}`;
    },
  };
}
