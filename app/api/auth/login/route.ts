import { NextRequest, NextResponse } from "next/server";
import { normalizeUsername, verifyPassword } from "@/lib/auth";
import { findUserByUsername, loadState } from "@/lib/db";
import { allowAttempt, clearAttempts, clientKey } from "@/lib/server/rate-limit";
import { startSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const key = clientKey(req.headers, "login");
  if (!(await allowAttempt(key))) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a few minutes." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }

  const { username, password } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
  };

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  const record = await findUserByUsername(normalizeUsername(username));
  // One message for both halves, so this cannot be used to enumerate accounts.
  const invalid = NextResponse.json(
    { error: "Incorrect username or password." },
    { status: 401 },
  );
  if (!record) return invalid;
  if (!verifyPassword(password, record.passwordHash)) return invalid;

  await clearAttempts(key);

  const user = { id: record.id, username: record.username, createdAt: record.createdAt };
  const res = NextResponse.json({ user, state: await loadState(user.id) });
  await startSession(res, user.id);
  return res;
}
