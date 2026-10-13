import "server-only";
import { cookies } from "next/headers";
import { sign, verify } from "./tokens";
import type { Chain } from "./wallet-verify";

export interface Session {
  a: string; // wallet address
  c: Chain;
  exp: number;
}

const COOKIE = "gp_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export async function getSession(): Promise<Session | null> {
  const jar = await cookies();
  return verify<Session>(jar.get(COOKIE)?.value);
}

export async function setSession(address: string, chain: Chain) {
  const jar = await cookies();
  jar.set(COOKIE, sign({ a: address, c: chain, exp: Date.now() + MAX_AGE * 1000 }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(COOKIE);
}

export function shortAddress(a: string | null | undefined): string {
  if (!a) return "guest";
  return a.startsWith("0x") ? `${a.slice(0, 6)}…${a.slice(-4)}` : `${a.slice(0, 4)}…${a.slice(-4)}`;
}
