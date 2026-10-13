import { NextResponse } from "next/server";
import { store, type OrderRecord } from "@/lib/store";
import { randomId } from "@/lib/tokens";

const FIELDS = ["coinName", "ticker", "chain", "contract", "game", "mascot", "colors", "links", "contact", "timeline", "notes"] as const;
const MAX: Record<(typeof FIELDS)[number], number> = {
  coinName: 60, ticker: 12, chain: 20, contract: 100, game: 60, mascot: 1000, colors: 200, links: 600, contact: 120, timeline: 60, notes: 2000,
};

// Order requests are stored locally; nothing is charged and nothing is sent anywhere.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ error: "Bad request." }, { status: 400 });
  if (typeof body.website === "string" && body.website) return NextResponse.json({ ok: true }); // honeypot

  const o: Record<string, string> = {};
  for (const f of FIELDS) {
    const v = typeof body[f] === "string" ? (body[f] as string).trim() : "";
    if (v.length > MAX[f]) return NextResponse.json({ error: `${f} is too long.` }, { status: 400 });
    o[f] = v;
  }
  if (!o.coinName || !o.ticker || !o.contact) return NextResponse.json({ error: "Coin name, ticker and a contact are required." }, { status: 400 });
  if (body.rightsConfirmed !== true) return NextResponse.json({ error: "Please confirm you have the rights to the mascot and branding." }, { status: 400 });

  let skin: string | undefined;
  if (body.skin !== undefined) {
    if (typeof body.skin !== "string" || body.skin.length > 40_000) return NextResponse.json({ error: "Skin data is too large." }, { status: 400 });
    try {
      const parsed = JSON.parse(body.skin) as { coin?: unknown; mascot?: unknown; palette?: unknown };
      if (!parsed.coin || !parsed.mascot || !parsed.palette) throw new Error("bad skin");
    } catch {
      return NextResponse.json({ error: "Skin data is invalid." }, { status: 400 });
    }
    skin = body.skin;
  }

  const order = { id: randomId(6), createdAt: Date.now(), ...o, rightsConfirmed: true, ...(skin ? { skin } : {}) } as OrderRecord;
  await store.addOrder(order);
  return NextResponse.json({ id: order.id });
}
