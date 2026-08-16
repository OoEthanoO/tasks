import { DEFAULT_END_TIME, sanitizeEndTime, sanitizeState } from "./app-state";
import { Statement, ensureSchema, getSql } from "./sql";
import { AppState, Recommendation, Schedule, Task, User } from "./types";

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  created_at: string;
};

function toUser(row: UserRow): User {
  return { id: row.id, username: row.username, createdAt: row.created_at };
}

async function query<T>(text: string, params: unknown[] = []): Promise<T[]> {
  await ensureSchema();
  return getSql().query<T>(text, params);
}

/* ---------- users ---------- */

/**
 * True for a Postgres unique-constraint violation. Two signups for the same
 * name can race past `usernameTaken` on separate instances, and the index is
 * the thing that actually decides it.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "23505"
  );
}

export async function createUser(input: {
  id: string;
  username: string;
  usernameLower: string;
  passwordHash: string;
}): Promise<User> {
  const createdAt = new Date().toISOString();

  await ensureSchema();
  // Both rows or neither: an account without prefs would read back a null end
  // time on its very first load.
  await getSql().transaction([
    {
      text: `INSERT INTO users (id, username, username_lower, password_hash, created_at)
             VALUES ($1, $2, $3, $4, $5)`,
      params: [
        input.id,
        input.username,
        input.usernameLower,
        input.passwordHash,
        createdAt,
      ],
    },
    {
      text: `INSERT INTO prefs (user_id, end_time) VALUES ($1, $2)`,
      params: [input.id, DEFAULT_END_TIME],
    },
  ]);

  return { id: input.id, username: input.username, createdAt };
}

/**
 * Erase an account and everything hanging off it. `sessions`, `tasks` and
 * `prefs` all reference `users(id) ON DELETE CASCADE`, so one statement is the
 * whole deletion — there is no soft-delete flag and no copy left behind.
 */
export async function deleteUser(userId: string): Promise<void> {
  await query(`DELETE FROM users WHERE id = $1`, [userId]);
}

export async function usernameTaken(usernameLower: string): Promise<boolean> {
  const rows = await query<{ hit: number }>(
    `SELECT 1 AS hit FROM users WHERE username_lower = $1`,
    [usernameLower],
  );
  return rows.length > 0;
}

export async function findUserByUsername(
  usernameLower: string,
): Promise<(User & { passwordHash: string }) | null> {
  const rows = await query<UserRow>(
    `SELECT id, username, password_hash, created_at
       FROM users WHERE username_lower = $1`,
    [usernameLower],
  );

  const row = rows[0];
  if (!row) return null;
  return { ...toUser(row), passwordHash: row.password_hash };
}

/* ---------- sessions ---------- */

export async function createSession(
  userId: string,
  tokenHash: string,
  expiresAt: Date,
): Promise<void> {
  await query(
    `INSERT INTO sessions (token_hash, user_id, created_at, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [tokenHash, userId, new Date().toISOString(), expiresAt.toISOString()],
  );
}

export async function findSessionUser(tokenHash: string): Promise<User | null> {
  const rows = await query<UserRow & { expires_at: string }>(
    `SELECT u.id, u.username, u.password_hash, u.created_at, s.expires_at
       FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [tokenHash],
  );

  const row = rows[0];
  if (!row) return null;
  if (Date.parse(row.expires_at) <= Date.now()) {
    await deleteSession(tokenHash);
    return null;
  }
  return toUser(row);
}

export async function deleteSession(tokenHash: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
}

/** Opportunistic housekeeping for the two tables that accumulate dead rows. */
export async function deleteExpiredSessions(): Promise<void> {
  const now = new Date().toISOString();
  await ensureSchema();
  await getSql().transaction([
    { text: `DELETE FROM sessions WHERE expires_at <= $1`, params: [now] },
    { text: `DELETE FROM rate_limits WHERE reset_at <= $1`, params: [now] },
  ]);
}

/* ---------- rate limiting ---------- */

/**
 * Count one attempt against `key` and report whether it is still under the cap.
 * The upsert both rolls the window over and increments in a single statement,
 * so two instances racing on the same key cannot each be told "you're first".
 */
export async function countAttempt(
  key: string,
  max: number,
  windowMs: number,
): Promise<boolean> {
  const now = new Date();
  const nowIso = now.toISOString();
  const resetAt = new Date(now.getTime() + windowMs).toISOString();

  const rows = await query<{ attempts: number }>(
    `INSERT INTO rate_limits (key, attempts, reset_at)
          VALUES ($1, 1, $2)
     ON CONFLICT (key) DO UPDATE SET
          attempts = CASE WHEN rate_limits.reset_at <= $3 THEN 1
                          ELSE rate_limits.attempts + 1 END,
          reset_at = CASE WHEN rate_limits.reset_at <= $3 THEN $2
                          ELSE rate_limits.reset_at END
       RETURNING attempts`,
    [key, resetAt, nowIso],
  );

  return Number(rows[0]?.attempts ?? 1) <= max;
}

/** A successful sign-in clears the counter. */
export async function clearAttempts(key: string): Promise<void> {
  await query(`DELETE FROM rate_limits WHERE key = $1`, [key]);
}

/* ---------- state ---------- */

type TaskRow = {
  id: string;
  title: string;
  description: string;
  due_date: string;
  completed: boolean;
  created_at: string;
  completed_at: string | null;
};

export async function loadState(userId: string): Promise<AppState> {
  const rows = await query<TaskRow>(
    `SELECT id, title, description, due_date, completed, created_at, completed_at
       FROM tasks WHERE user_id = $1 ORDER BY position ASC`,
    [userId],
  );

  const tasks: Task[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    completed: row.completed === true,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  }));

  const prefs = (
    await query<{
      end_time: string;
      recommendation: string | null;
      schedule: string | null;
    }>(`SELECT end_time, recommendation, schedule FROM prefs WHERE user_id = $1`, [
      userId,
    ])
  )[0];

  return {
    tasks,
    recommendation: parseJson<Recommendation>(prefs?.recommendation),
    schedule: parseJson<Schedule>(prefs?.schedule),
    endTime: sanitizeEndTime(prefs?.end_time),
  };
}

function parseJson<T>(raw: string | null | undefined): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/**
 * Replace a user's whole state in one transaction. The client owns the task
 * list wholesale, so a full swap is both simpler and safer than diffing.
 */
export async function saveState(userId: string, incoming: AppState): Promise<void> {
  const state = sanitizeState(incoming);

  const statements: Statement[] = [
    { text: `DELETE FROM tasks WHERE user_id = $1`, params: [userId] },
  ];

  state.tasks.forEach((task, index) => {
    statements.push({
      text: `INSERT INTO tasks
               (user_id, id, title, description, due_date, completed, created_at, completed_at, position)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      params: [
        userId,
        task.id,
        task.title,
        task.description,
        task.dueDate,
        task.completed,
        task.createdAt,
        task.completedAt,
        index,
      ],
    });
  });

  statements.push({
    text: `INSERT INTO prefs (user_id, end_time, recommendation, schedule)
                VALUES ($1, $2, $3, $4)
           ON CONFLICT (user_id) DO UPDATE SET
                end_time = excluded.end_time,
                recommendation = excluded.recommendation,
                schedule = excluded.schedule`,
    params: [
      userId,
      state.endTime,
      state.recommendation ? JSON.stringify(state.recommendation) : null,
      state.schedule ? JSON.stringify(state.schedule) : null,
    ],
  });

  await ensureSchema();
  await getSql().transaction(statements);
}
