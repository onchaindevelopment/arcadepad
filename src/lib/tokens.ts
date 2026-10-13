// HMAC-signed tokens for sessions, sign-in nonces and run tickets.
import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET (32+ chars) is required in production");
  // Dev only: stable per process. Put SESSION_SECRET in .env.local to keep sessions across restarts.
  const g = globalThis as unknown as { __devSecret?: string };
  g.__devSecret ??= randomBytes(32).toString("hex");
  return g.__devSecret;
}

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");

export function sign(payload: object): string {
  const body = b64(JSON.stringify(payload));
  const mac = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify<T>(token: string | undefined | null): T | null {
  if (!token) return null;
  const [body, mac] = token.split(".");
  if (!body || !mac) return null;
  const want = createHmac("sha256", secret()).update(body).digest();
  const got = Buffer.from(mac, "base64url");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T & { exp?: number };
    if (typeof p.exp === "number" && p.exp < Date.now()) return null;
    return p;
  } catch {
    return null;
  }
}

export const randomId = (bytes = 9) => randomBytes(bytes).toString("base64url");
export const randomSeed = () => randomBytes(4).readUInt32BE(0);
