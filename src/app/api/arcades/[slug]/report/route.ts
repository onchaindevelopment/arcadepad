import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { store } from "@/lib/store";
import { HIDE_AFTER_REPORTS, reporterKey } from "@/lib/arcades";

// Anyone can report a launched arcade; enough distinct reports hide it until reviewed.
export async function POST(req: Request, ctx: RouteContext<"/api/arcades/[slug]/report">) {
  const { slug } = await ctx.params;
  const a = await store.getArcade(slug);
  if (!a) return NextResponse.json({ error: "Unknown arcade." }, { status: 404 });
  const session = await getSession();
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "local";
  const n = await store.reportArcade(slug, reporterKey(session?.a ?? null, ip, req.headers.get("user-agent") ?? ""));
  if (n >= HIDE_AFTER_REPORTS && !a.hidden) await store.setArcadeHidden(slug, true);
  return NextResponse.json({ ok: true });
}
