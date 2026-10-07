import type { Task } from "./types";

/** One calendar month after completion, clamped to the next month's last day.
 * UTC keeps the rule identical on the server, phone, and desktop. */
export function completedTaskExpiresAt(task: Pick<Task, "completed" | "completedAt">): number | null {
  if (!task.completed || !task.completedAt) return null;
  const completed = new Date(task.completedAt);
  if (!Number.isFinite(completed.getTime())) return null;
  const expiry = new Date(completed);
  expiry.setUTCDate(1);
  expiry.setUTCMonth(expiry.getUTCMonth() + 2);
  expiry.setUTCDate(0);
  expiry.setUTCDate(Math.min(completed.getUTCDate(), expiry.getUTCDate()));
  return Number.isFinite(expiry.getTime()) ? expiry.getTime() : null;
}

/** Never delete open tasks, or guess the age of an undated completion. */
export function isExpiredCompletedTask(task: Pick<Task, "completed" | "completedAt">, now = Date.now()): boolean {
  const expiry = completedTaskExpiresAt(task);
  return expiry !== null && expiry <= now;
}

/** Keep the original array when nothing expires, avoiding needless saves. */
export function pruneCompletedTasks(tasks: Task[], now = Date.now()): Task[] {
  const kept = tasks.filter(task => !isExpiredCompletedTask(task, now));
  return kept.length === tasks.length ? tasks : kept;
}

/** A single sleeping timer, not a frequent poll. Recheck after long sleeps or
 * clock changes; the host calls this again whenever the task list changes. */
export function scheduleCompletedTaskCleanup(tasks: Task[], onExpire: () => void): () => void {
  const expiries = tasks.map(completedTaskExpiresAt).filter((at): at is number => at !== null);
  if (!expiries.length) return () => {};
  const next = Math.min(...expiries);
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    timer = setTimeout(() => {
      if (Date.now() >= next) onExpire();
      else arm();
    }, Math.max(1, Math.min(next - Date.now(), 86_400_000)));
  };
  arm();
  return () => clearTimeout(timer);
}
