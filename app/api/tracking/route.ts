import { NextRequest, NextResponse } from "next/server";
import { currentUser } from "@/lib/server/session";
import { accountsUnavailable } from "@/lib/server/db-status";
import { loadState } from "@/lib/db";
import { commandTracking, readAccountTracking, TrackingConflict } from "@/lib/tracking-db";
import { TrackingAction, validTimeZone } from "@/lib/tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  return NextResponse.json({ tracking: await readAccountTracking(user.id), serverNow: Date.now() }, { headers: { "Cache-Control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  const user = await currentUser(req);
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  let body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Malformed request." }, { status: 400 }); }
  if (!body || !Number.isSafeInteger(body.revision) || body.revision < 0 ||
    typeof body.controllerId !== "string" || !/^[a-zA-Z0-9_-]{8,100}$/.test(body.controllerId) ||
    !["start", "pause", "reset", "skip-rest"].includes(body.action?.type) ||
    (body.action.taskId !== undefined && (typeof body.action.taskId !== "string" || body.action.taskId.length > 100))) {
    return NextResponse.json({ error: "Invalid timer command." }, { status: 400 });
  }
  try {
    const state = await loadState(user.id);
    const tracking = await commandTracking(user.id, body.revision, body.action as TrackingAction, body.controllerId,
      validTimeZone(body.timeZone), state.tasks, state.endTime, state.rest);
    return NextResponse.json({ tracking, serverNow: Date.now() });
  } catch (error) {
    if (error instanceof TrackingConflict) return NextResponse.json({ error: error.message }, { status: 409 });
    if (error instanceof Error && /work day has ended|No unfinished/.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("[tracking.command] failed", error);
    return NextResponse.json({ error: "Could not update the timer. Please refresh and try again." }, { status: 500 });
  }
}
