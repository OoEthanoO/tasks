/**
 * The database connection, behind a two-method interface.
 *
 * Production talks to Neon Postgres over HTTP, which is what makes this work on
 * Vercel: every request is a stateless fetch, so there is no connection pool to
 * exhaust across serverless instances and nothing is written to the (read-only,
 * ephemeral) function filesystem. Tests swap in an in-process Postgres through
 * `setSql`, so the exact SQL below is what gets exercised.
 */
import { neon } from "@neondatabase/serverless";

export type Statement = { text: string; params?: unknown[] };

export type Sql = {
  query<T>(text: string, params?: unknown[]): Promise<T[]>;
  /** Run the statements as one atomic batch. */
  transaction(statements: Statement[]): Promise<void>;
};

/**
 * Timestamps are ISO-8601 strings rather than `timestamptz`. The app models
 * every time as a string, and `toISOString()` is fixed-width UTC, so ordering
 * and range comparisons are already correct lexically. Keeping them as TEXT
 * means a value round-trips through the database byte-for-byte.
 */
const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS users (
     id             TEXT PRIMARY KEY,
     username       TEXT NOT NULL,
     username_lower TEXT NOT NULL UNIQUE,
     password_hash  TEXT NOT NULL,
     created_at     TEXT NOT NULL
   )`,

  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY,
     user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at TEXT NOT NULL,
     expires_at TEXT NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id)`,

  `CREATE TABLE IF NOT EXISTS tasks (
     user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     id           TEXT NOT NULL,
     title        TEXT NOT NULL,
     description  TEXT NOT NULL DEFAULT '',
     due_date     TEXT NOT NULL,
     completed    BOOLEAN NOT NULL DEFAULT FALSE,
     created_at   TEXT NOT NULL,
     completed_at TEXT,
     position     INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, id)
   )`,

  `CREATE TABLE IF NOT EXISTS prefs (
     user_id        TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     end_time       TEXT NOT NULL,
     recommendation TEXT,
     schedule       TEXT,
     rest_mode      TEXT
   )`,
  // Advanced rest arrived after prefs did, so a database created before it
  // needs the column added rather than the table created. Same self-healing
  // idea as the CREATE statements above: no deploy-time migration step.
  `ALTER TABLE prefs ADD COLUMN IF NOT EXISTS rest_mode TEXT`,

  // Login throttling lives here rather than in process memory, because on
  // Vercel each instance would otherwise hand out its own fresh allowance.
  `CREATE TABLE IF NOT EXISTS rate_limits (
     key      TEXT PRIMARY KEY,
     attempts INTEGER NOT NULL,
     reset_at TEXT NOT NULL
   )`,
];

/**
 * The Neon integration sets DATABASE_URL; the older Vercel Postgres
 * integration sets POSTGRES_URL. Accept either.
 *
 * Exported so the routes can tell "this server has no database" apart from
 * "the database failed", without repeating which variables count.
 */
export function configuredDatabaseUrl(): string | undefined {
  if (override) return "override";
  return process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
}

function connectionString(): string {
  const url = configuredDatabaseUrl();
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Add a Neon Postgres database from the Vercel " +
        "dashboard (Storage → Neon), or set DATABASE_URL locally.",
    );
  }
  return url;
}

function neonDriver(): Sql {
  const sql = neon(connectionString());
  return {
    query: <T>(text: string, params: unknown[] = []) =>
      sql.query(text, params as unknown[]) as Promise<T[]>,
    transaction: async (statements) => {
      // One HTTP round trip for the whole batch.
      await sql.transaction(statements.map((s) => sql.query(s.text, s.params ?? [])));
    },
  };
}

// Next.js reloads modules in dev; the driver and the schema check are cached on
// globalThis so an edit does not re-run setup on every request.
const globalForSql = globalThis as unknown as {
  __yantasksSql?: Sql;
  __yantasksSchema?: Promise<void>;
};

let override: Sql | null = null;

/** Point the data layer at another Postgres. Used by the test suite. */
export function setSql(driver: Sql | null): void {
  override = driver;
  globalForSql.__yantasksSchema = undefined;
}

export function getSql(): Sql {
  if (override) return override;
  if (!globalForSql.__yantasksSql) {
    globalForSql.__yantasksSql = neonDriver();
  }
  return globalForSql.__yantasksSql;
}

/**
 * Create the tables if they are not there yet, once per instance. Every data
 * function awaits this, so a fresh database heals itself on first use instead
 * of requiring a deploy-time migration step.
 */
export function ensureSchema(): Promise<void> {
  if (!globalForSql.__yantasksSchema) {
    globalForSql.__yantasksSchema = getSql()
      .transaction(SCHEMA.map((text) => ({ text })))
      .catch((error: unknown) => {
        // Don't cache a failure — the next request should try again.
        globalForSql.__yantasksSchema = undefined;
        throw error;
      });
  }
  return globalForSql.__yantasksSchema;
}
