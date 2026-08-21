import { NextRequest, NextResponse } from "next/server";
import { deleteUser } from "@/lib/db";
import { currentUser, endSession } from "@/lib/server/session";
import { accountsUnavailable } from "@/lib/server/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  return NextResponse.json({ user: await currentUser(req) });
}

/**
 * Delete the signed-in account. App Store guideline 5.1.1(v) requires an app
 * that can create an account to be able to delete it from inside the app —
 * and it has to be a real deletion, not a disable flag.
 */
export async function DELETE(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  const user = await currentUser(req);
  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  await deleteUser(user.id);

  // The row is gone, so the session token no longer resolves to anything; the
  // cookie is cleared anyway rather than left for the browser to keep sending.
  const res = NextResponse.json({ ok: true });
  await endSession(req, res);
  return res;
}
