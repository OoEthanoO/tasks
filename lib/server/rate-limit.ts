/**
 * Throttling for the password endpoints.
 *
 * The counters live in Postgres rather than in process memory: Vercel runs as
 * many instances as it likes, and a per-process map would quietly hand each one
 * its own full allowance, which is barely a limit at all.
 */
import { clearAttempts, countAttempt } from "@/lib/db";

const WINDOW_MS = 15 * 60_000;
const MAX_ATTEMPTS = 10;

/** Records the attempt; false once a key has burned through its window. */
export function allowAttempt(key: string): Promise<boolean> {
  return countAttempt(key, MAX_ATTEMPTS, WINDOW_MS);
}

export { clearAttempts };

export function clientKey(headers: Headers, scope: string): string {
  const forwarded = headers.get("x-forwarded-for");
  const ip = forwarded ? forwarded.split(",")[0].trim() : "local";
  return `${scope}:${ip}`;
}
