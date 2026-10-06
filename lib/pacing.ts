import type { Task } from "./types";

export const TURN_MS = 30 * 60_000;
export const DAILY_CAP_MS = 3 * 60 * 60_000;

/** Calendar arithmetic in the account's date keys, independent of host timezone/DST. */
export function daysUntil(due: string, today: string): number {
  return Math.max(0, Math.round((Date.parse(`${due}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000));
}
/** Budget pressure is NOT a per-task allocation or an effort estimate. */
export function contributionMs(task: Task, today: string): number {
  return task.completed ? 0 : 60 * 60_000 / (daysUntil(task.dueDate, today) + 1);
}
/** Fairness floor of 1, bounded deadline boost of at most 1. No manual priority multiplier. */
export function rotationWeight(task: Task, today: string): number {
  return task.completed ? 0 : 1 + 1 / (daysUntil(task.dueDate, today) + 1);
}
export function recommendDay(tasks: Task[], day: string) {
  const rawMs = tasks.reduce((sum, task) => sum + contributionMs(task, day), 0);
  // Avoid adding a whole session for floating-point dust, while keeping distant tasks eligible.
  const roundedMs = rawMs > 0 ? Math.max(TURN_MS, Math.ceil((rawMs - 0.001) / TURN_MS) * TURN_MS) : 0;
  return { rawMs, roundedMs, capMs: DAILY_CAP_MS, goalMs: Math.min(DAILY_CAP_MS, roundedMs), capped: roundedMs > DAILY_CAP_MS };
}
/** Titles, weekdays and clock ticks do not change the recommendation. */
export function recommendationKey(tasks: Task[], day: string): string {
  return JSON.stringify([day, tasks.map(t => [t.id, t.dueDate, t.completed]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))]);
}
