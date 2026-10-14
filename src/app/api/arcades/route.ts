import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";
import { LAUNCHES_PER_DAY, launchArcade, validateLaunch } from "@/lib/arcades";

// Instant launch: a signed-in wallet launches a coin's arcade, live at once. The theme is
// rebuilt here from validated inputs; nothing the browser sends is stored as-is.
export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Connect a wallet to launch." }, { status: 401 });
  const text = await req.text();
  if (text.length > 30_000) return NextResponse.json({ error: "Launch data is too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  if ((body as { confirm?: unknown })?.confirm !== true) return NextResponse.json({ error: "Please confirm the launch rules." }, { status: 400 });
  const v = validateLaunch(body);
  if ("error" in v) return NextResponse.json({ error: v.error }, { status: 400 });
  const recent = await store.countArcadesBy(session.a, Date.now() - 86_400_000);
  if (recent >= LAUNCHES_PER_DAY) return NextResponse.json({ error: `You can launch ${LAUNCHES_PER_DAY} arcades a day. Try again tomorrow.` }, { status: 429 });
  const r = await launchArcade(v.input, session.a);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: 400 });
  return NextResponse.json({ slug: r.slug, url: `/a/${r.slug}` });
}
