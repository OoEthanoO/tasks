import { NextRequest, NextResponse } from "next/server";
import { sanitizeState } from "@/lib/app-state";
import { loadState, saveState } from "@/lib/db";
import { currentUser } from "@/lib/server/session";
import { accountsUnavailable } from "@/lib/server/db-status";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const unauthorized = () =>
  NextResponse.json({ error: "Not signed in." }, { status: 401 });

export async function GET(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  const user = await currentUser(req);
  if (!user) return unauthorized();
  return NextResponse.json({ state: await loadState(user.id) });
}

export async function PUT(req: NextRequest) {
  const offline = accountsUnavailable();
  if (offline) return offline;
  const user = await currentUser(req);
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const state = sanitizeState((body as { state?: unknown })?.state);

  try {
    await saveState(user.id, state);
  } catch (error) {
    // This is the failure the client shows as "the server had a problem", and
    // an uncaught throw here leaves nothing in the logs but a stack. Postgres
    // puts the useful part in `code` (SQLSTATE) — 22021 is a NUL in the text,
    // 40P01 a deadlock, 23505 a duplicate key — so record that, plus enough
    // shape to tell which write it was. Never echoed to the browser.
    const e = error as { code?: string; message?: string; detail?: string };
    console.error("[state.save] failed", {
      userId: user.id,
      tasks: state.tasks.length,
      hasSchedule: state.schedule !== null,
      blocks: state.schedule?.blocks.length ?? 0,
      code: e.code,
      message: e.message,
      detail: e.detail,
    });
    return NextResponse.json(
      { error: "The server had a problem. Please try again in a moment." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true });
}
