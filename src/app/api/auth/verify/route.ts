import { NextResponse } from "next/server";
import { BRAND } from "@/brand";
import { setSession } from "@/lib/session";
import { store } from "@/lib/store";
import { verify } from "@/lib/tokens";
import { signInMessage, verifyWalletSignature, type Chain } from "@/lib/wallet-verify";

interface NonceToken {
  n: string;
  a: string;
  c: Chain;
  d: string;
  i: string;
  exp: number;
}

// Step 2: check the signature over the server-built message, then start a session.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: string; signature?: string } | null;
  const t = verify<NonceToken>(body?.token);
  if (!t || !body?.signature) return NextResponse.json({ error: "Sign-in request expired. Try again." }, { status: 400 });
  if (t.d !== (req.headers.get("host") ?? "localhost")) return NextResponse.json({ error: "Wrong domain." }, { status: 400 });

  const message = signInMessage({ domain: t.d, address: t.a, chain: t.c, nonce: t.n, issuedAt: t.i, brand: BRAND.name });
  const ok = await verifyWalletSignature(t.c, t.a, message, body.signature);
  if (!ok) return NextResponse.json({ error: "Signature did not match this wallet." }, { status: 401 });
  if (!(await store.useNonce(t.n, t.exp))) return NextResponse.json({ error: "This sign-in was already used." }, { status: 409 });

  await setSession(t.a, t.c);
  return NextResponse.json({ address: t.a, chain: t.c });
}
