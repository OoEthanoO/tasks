import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  return NextResponse.json({ user: await currentUser(req) });
}
