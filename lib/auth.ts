export {
  PASSWORD_MAX,
  PASSWORD_MIN,
  USERNAME_MAX,
  USERNAME_MIN,
  normalizeUsername,
  validatePassword,
  validateUsername,
} from "./auth-rules";

import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const SESSION_COOKIE = "yantasks_session";
export const SESSION_DAYS = 30;

// scrypt parameters. N=16384/r=8 needs ~16MB and lands around 50ms per hash,
// which is slow enough to matter for guessing and fast enough for a login.
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;

/** "scrypt$N$r$p$salt$key", all base64url — self-describing so params can move. */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const key = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, SCRYPT);
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64url"),
    key.toString("base64url"),
  ].join("$");
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4], "base64url");
    const expected = Buffer.from(parts[5], "base64url");
    const actual = scryptSync(password.normalize("NFKC"), salt, expected.length, {
      N,
      r,
      p,
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Sessions are stored by digest, so a leaked copy of the database cannot be
 * replayed as a live cookie.
 */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function newUserId(): string {
  return randomUUID();
}
