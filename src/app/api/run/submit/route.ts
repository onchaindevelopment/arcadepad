import { NextResponse } from "next/server";
import { getGame } from "@/games/registry";
import { replayGame } from "@/games/core/replay";
import { STEP_MS } from "@/games/core/types";
import { getTheme } from "@/themes";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";
import { randomId } from "@/lib/tokens";

const MAX_INPUT_CHARS = 2 * 1024 * 1024;
const MAX_RUN_AGE_MS = 45 * 60_000;
const CLOCK_SLACK_MS = 4000;

// Anti-cheat: the client's score is only a claim. The server replays the
// recorded inputs on the deterministic engine with the seed it issued and
// stores the score that the replay produces.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { runId?: string; inputs?: string; score?: number; frames?: number } | null;
  if (!body?.runId || typeof body.inputs !== "string" || body.inputs.length > MAX_INPUT_CHARS)
    return NextResponse.json({ error: "Bad submission." }, { status: 400 });

  const run = await store.getRun(body.runId);
  if (!run) return NextResponse.json({ error: "Unknown run." }, { status: 404 });
  const theme = getTheme(run.theme);
  const game = getGame(run.game ?? "breakout");
  if (!theme || !game) return NextResponse.json({ error: "Unknown game or skin." }, { status: 400 });

  const now = Date.now();
  if (now - run.startedAt > MAX_RUN_AGE_MS) return NextResponse.json({ error: "Run expired." }, { status: 410 });

  const session = await getSession();
  if (run.wallet && session?.a !== run.wallet) return NextResponse.json({ error: "Signed-in wallet changed during the run." }, { status: 403 });

  let result;
  try {
    result = replayGame(game, run.seed, { ticker: theme.coin.ticker }, body.inputs);
  } catch {
    return NextResponse.json({ error: "Replay could not be read." }, { status: 422 });
  }

  // A run can't be played faster than real time.
  if (result.frames * STEP_MS > now - run.startedAt + CLOCK_SLACK_MS)
    return NextResponse.json({ error: "Run finished faster than the clock allows." }, { status: 422 });
  if (body.score !== result.score || body.frames !== result.frames)
    return NextResponse.json({ error: "Replay check failed: the score could not be reproduced.", replayScore: result.score }, { status: 422 });

  if (!(await store.claimRun(run.id, now))) return NextResponse.json({ error: "Run already submitted." }, { status: 409 });

  const score = {
    id: randomId(8),
    runId: run.id,
    game: game.id,
    theme: run.theme,
    wallet: run.wallet,
    chain: run.chain,
    score: result.score,
    level: result.level,
    levelsCleared: result.levelsCleared,
    frames: result.frames,
    status: result.status,
    createdAt: now,
  };
  await store.addScore(score);
  return NextResponse.json({ scoreId: score.id, score: score.score, rank: await store.rankOf(score), ranked: !!score.wallet });
}
