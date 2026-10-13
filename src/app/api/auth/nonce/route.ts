import { NextResponse } from "next/server";
import { BRAND } from "@/brand";
import { randomId, sign } from "@/lib/tokens";
import { normalizeAddress, signInMessage, type Chain } from "@/lib/wallet-verify";

// Step 1 of wallet sign-in: the server writes the exact message to sign.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { chain?: Chain; address?: string } | null;
  const chain = body?.chain === "evm" ? "evm" : body?.chain === "solana" ? "solana" : null;
  const address = chain && body?.address ? normalizeAddress(chain, body.address) : null;
  if (!chain || !address) return NextResponse.json({ error: "Unsupported wallet address." }, { status: 400 });

  const domain = req.headers.get("host") ?? "localhost";
  const nonce = randomId(12);
  const issuedAt = new Date().toISOString();
  const message = signInMessage({ domain, address, chain, nonce, issuedAt, brand: BRAND.name });
  const token = sign({ n: nonce, a: address, c: chain, d: domain, i: issuedAt, exp: Date.now() + 5 * 60_000 });
  return NextResponse.json({ message, token });
}
