import { DateKey, diffDays, todayKey } from "./dates";
import { Task } from "./types";

/** The hidden "Rest" task is always in the pool at a fixed weight. */
export const REST_WEIGHT = 1 / 7;
export const REST_LABEL = "Rest";

/**
 * A task's pull on the recommender, where `n` is the number of days until it is
 * due (negative once it is overdue).
 *
 *   due tomorrow or later  ->  1 / n
 *                              tomorrow = 1, day after = 1/2, in 3 days = 1/3 ...
 *   due today or overdue   ->  2 - n
 *                              today = 2, yesterday = 3, day before = 4, ...
 *   completed              ->  0, so it can never be drawn again
 */
export function taskWeight(task: Task, today: DateKey = todayKey()): number {
  if (task.completed) return 0;

  const n = diffDays(task.dueDate, today);
  return n >= 1 ? 1 / n : 2 - n;
}

export type WeightedTask = {
  task: Task;
  weight: number;
  probability: number;
};

export type WeightTable = {
  entries: WeightedTask[];
  /** Sum of every task weight plus Rest. */
  total: number;
  taskTotal: number;
  restProbability: number;
};

export function buildWeightTable(
  tasks: Task[],
  today: DateKey = todayKey(),
): WeightTable {
  const weighted = tasks.map((task) => ({ task, weight: taskWeight(task, today) }));
  const taskTotal = weighted.reduce((sum, w) => sum + w.weight, 0);
  const total = taskTotal + REST_WEIGHT;

  return {
    entries: weighted.map((w) => ({ ...w, probability: w.weight / total })),
    total,
    taskTotal,
    restProbability: REST_WEIGHT / total,
  };
}

/**
 * Draw one task proportional to its weight. Returns null when Rest wins.
 * Rest occupies its 1/7 slice of the wheel whether or not anything else does.
 */
export function pickWeighted(table: WeightTable): Task | null {
  let roll = Math.random() * table.total;
  for (const entry of table.entries) {
    if (entry.weight <= 0) continue;
    roll -= entry.weight;
    if (roll < 0) return entry.task;
  }
  return null;
}

/**
 * Fingerprint of everything the recommender reads. Any change here — a new
 * task, a deletion, a moved due date, a completion — invalidates a schedule.
 */
export function taskSignature(tasks: Task[]): string {
  return tasks
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
