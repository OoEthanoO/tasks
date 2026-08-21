import { NextResponse } from "next/server";
import { configuredDatabaseUrl } from "@/lib/sql";

/**
 * Refuse account work when this deployment has no database, and say so.
 *
 * Without one, the first query throws a perfectly clear error — "DATABASE_URL
 * is not set" — into the server log, and the browser gets a bare 500 that the
 * client renders as "the server had a problem, please try again in a moment".
 * That is the wrong advice: nothing about waiting fixes an unset environment
 * variable, so the button just fails forever with no hint why.
 *
 * A missing variable is knowable before any work happens, so it is answered
 * separately from a database that is configured but unwell — that one really
 * is worth retrying, and still returns a 500.
 */
export function accountsUnavailable(): NextResponse | null {
  if (configuredDatabaseUrl()) return null;
  return NextResponse.json(
    {
      error:
        "Accounts are not set up on this server. Your tasks are still saved on this device.",
    },
    { status: 503 },
  );
}
