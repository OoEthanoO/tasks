import { DateKey, diffDays, todayKey } from "./dates";
import { Priority, Task } from "./types";

/**
 * The weight curve, where `n` is the number of days until a task is due
 * (negative once it is overdue).
 *
 *   due tomorrow or later  ->  1 / n
 *                              tomorrow = 1, day after = 1/2, in 3 days = 1/3 ...
 *   due today or overdue   ->  2 - n
 *                              today = 2, yesterday = 3, day before = 4, ...
 */
export function weightForDaysOut(n: number): number {
  return n >= 1 ? 1 / n : 2 - n;
}

/**
 * Rest owns one quarter of every pick or generated schedule. It is an absolute
 * share, not another relative weight in the task pile: open tasks divide the
 * other three quarters in proportion to their due-date weights.
 */
export const REST_SHARE = 1 / 4;
export const REST_LABEL = "Rest";

/**
 * Priority multiplies the due-date weight. Low is the default and leaves the
 * curve as it is; medium doubles it and high quadruples it, so a high-priority
 * task due in four days pulls exactly as hard as a low one due tomorrow.
 */
export const PRIORITIES: readonly Priority[] = ["low", "medium", "high"];
export const DEFAULT_PRIORITY: Priority = "low";
export const PRIORITY_MULTIPLIER: Record<Priority, number> = { low: 1, medium: 2, high: 4 };
export const PRIORITY_LABEL: Record<Priority, string> = { low: "Low", medium: "Medium", high: "High" };

export function isPriority(value: unknown): value is Priority {
  return value === "low" || value === "medium" || value === "high";
}

/** A task's pull on the recommender. Completed tasks weigh 0 and never win. */
export function taskWeight(task: Task, today: DateKey = todayKey()): number {
  if (task.completed) return 0;
  // Tasks copied into a timer snapshot before priorities existed carry none.
  const multiplier = isPriority(task.priority) ? PRIORITY_MULTIPLIER[task.priority] : 1;
  return multiplier * weightForDaysOut(diffDays(task.dueDate, today));
}

export type WeightedTask = {
  task: Task;
  weight: number;
  probability: number;
};

export type WeightTable = {
  entries: WeightedTask[];
  /** Sum of the relative due-date weights for open tasks. */
  taskTotal: number;
  /** One quarter when there is work to schedule; all of it when there is none. */
  restProbability: number;
};

export function buildWeightTable(
  tasks: Task[],
  today: DateKey = todayKey(),
): WeightTable {
  const weighted = tasks.map((task) => ({ task, weight: taskWeight(task, today) }));
  const taskTotal = weighted.reduce((sum, w) => sum + w.weight, 0);
  const restProbability = taskTotal > 0 ? REST_SHARE : 1;
  const taskShare = 1 - restProbability;

  return {
    entries: weighted.map((w) => ({
      ...w,
      probability: taskTotal > 0 ? (w.weight / taskTotal) * taskShare : 0,
    })),
    taskTotal,
    restProbability,
  };
}

/**
 * Fingerprint of everything the scheduler reads. Any task change here
 * invalidates a schedule. The model prefix also invalidates schedules saved by
 * an older allocation algorithm after an app update.
 */
export function taskSignature(tasks: Task[]): string {
  return "balanced-v3|" + tasks
    .map((t) => `${t.id}:${t.dueDate}:${t.completed ? 1 : 0}`)
    .sort()
    .join("|");
}

export function formatProbability(p: number): string {
  if (p <= 0) return "0%";
  if (p < 0.001) return "<0.1%";
  if (p < 0.1) return `${(p * 100).toFixed(1)}%`;
  return `${Math.round(p * 100)}%`;
}

/**
 * How a weight reads in the list, as an exact fraction rather than a rounded
 * decimal. The curve only produces whole numbers or unit fractions 1/n, and a
 * priority multiplies that by 1, 2 or 4 — so any fractional weight is m/n with
 * m dividing 4, and 4/weight is a whole number. Writing it as 4/k and reducing
 * gives 2/3, 4/5 or 4/3 exactly — see the round-trip test that walks the whole
 * curve at every priority.
 */
export function formatWeight(weight: number): string {
  if (weight <= 0) return "0";
  const whole = Math.round(weight);
  if (Math.abs(weight - whole) < 1e-9) return String(whole);
  const scale = PRIORITY_MULTIPLIER.high; // divisible by every multiplier
  const denominator = Math.round(scale / weight);
  const common = gcd(scale, denominator);
  return `${scale / common}/${denominator / common}`;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}
