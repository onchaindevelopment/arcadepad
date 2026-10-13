import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export async function GET() {
  const s = await getSession();
  return NextResponse.json(s ? { address: s.a, chain: s.c } : { address: null });
}
