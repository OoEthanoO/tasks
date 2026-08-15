import { NextRequest, NextResponse } from "next/server";
import { isEmptyState, sanitizeState } from "@/lib/app-state";
import {
  hashPassword,
  newUserId,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "@/lib/auth";
import {
  createUser,
  isUniqueViolation,
  loadState,
  saveState,
  usernameTaken,
} from "@/lib/db";
import { allowAttempt, clientKey } from "@/lib/server/rate-limit";
import { startSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  if (!(await allowAttempt(clientKey(req.headers, "signup")))) {
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

  const { username, password, importState } = (body ?? {}) as {
    username?: unknown;
    password?: unknown;
    importState?: unknown;
  };

  if (typeof username !== "string" || typeof password !== "string") {
    return NextResponse.json(
      { error: "Username and password are required." },
      { status: 400 },
    );
  }

  const usernameError = validateUsername(username);
  if (usernameError) return NextResponse.json({ error: usernameError }, { status: 400 });

  const passwordError = validatePassword(password);
  if (passwordError) return NextResponse.json({ error: passwordError }, { status: 400 });

  const trimmed = username.trim();
  const lower = normalizeUsername(trimmed);
  const taken = NextResponse.json(
    { error: "That username is already taken." },
    { status: 409 },
  );
  if (await usernameTaken(lower)) return taken;

  let user;
  try {
    user = await createUser({
      id: newUserId(),
      username: trimmed,
      usernameLower: lower,
      passwordHash: hashPassword(password),
    });
  } catch (error) {
    // Lost a race with a concurrent signup for the same name.
    if (isUniqueViolation(error)) return taken;
    throw error;
  }

  // The migration payload: whatever the browser had while signed out.
  let migrated = false;
  if (importState !== undefined && importState !== null) {
    const incoming = sanitizeState(importState);
    if (!isEmptyState(incoming)) {
      await saveState(user.id, incoming);
      migrated = true;
    }
  }

  const res = NextResponse.json({
    user,
    state: await loadState(user.id),
    migrated,
  });
  await startSession(res, user.id);
  return res;
}
