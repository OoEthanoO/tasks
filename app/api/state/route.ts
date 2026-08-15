import { NextRequest, NextResponse } from "next/server";
import { sanitizeState } from "@/lib/app-state";
import { loadState, saveState } from "@/lib/db";
import { currentUser } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () =>
  NextResponse.json({ error: "Not signed in." }, { status: 401 });

export async function GET(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return unauthorized();
  return NextResponse.json({ state: await loadState(user.id) });
}

export async function PUT(req: NextRequest) {
  const user = await currentUser(req);
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  await saveState(user.id, sanitizeState((body as { state?: unknown })?.state));
  return NextResponse.json({ ok: true });
}
