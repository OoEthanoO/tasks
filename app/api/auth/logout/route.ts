import { NextRequest, NextResponse } from "next/server";
import { endSession } from "@/lib/server/session";
import { accountsUnavailable } from "@/lib/server/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  const res = NextResponse.json({ ok: true });
  await endSession(req, res);
  return res;
}
