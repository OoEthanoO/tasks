import type { Sql } from "./sql";

export async function databaseReady(sql: Pick<Sql, "query">): Promise<boolean> {
  try {
    // Read-only: readiness must never reset progress or create a fresh database.
    await sql.query("SELECT 1 FROM users LIMIT 1");
    return true;
  } catch {
    return false;
  }
}
