import type { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  SESSION_DAYS,
  hashToken,
  newToken,
} from "@/lib/auth";
import { createSession, deleteExpiredSessions, deleteSession, findSessionUser } from "@/lib/db";
import { User } from "@/lib/types";

const DAY_MS = 86_400_000;

export async function currentUser(req: NextRequest): Promise<User | null> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  return findSessionUser(hashToken(token));
}

/** Mint a session for `userId` and attach the cookie to `res`. */
export async function startSession(res: NextResponse, userId: string): Promise<void> {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  await createSession(userId, hashToken(token), expiresAt);

  // Opportunistic cleanup of expired sessions and stale throttle rows. It must
  // not be able to fail a sign-in that has otherwise already succeeded.
  void deleteExpiredSessions().catch(() => {});

  res.cookies.set({
    name: SESSION_COOKIE,
    value: token,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export async function endSession(req: NextRequest, res: NextResponse): Promise<void> {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await deleteSession(hashToken(token));

  res.cookies.set({
    name: SESSION_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
