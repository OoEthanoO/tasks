import { NextRequest, NextResponse } from "next/server";
import { endSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const res = NextResponse.json({ ok: true });
  await endSession(req, res);
  return res;
}
