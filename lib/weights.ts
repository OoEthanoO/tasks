import { DateKey, diffDays, todayKey } from "./dates";
import { RestMode, Task } from "./types";

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
 * The hidden "Rest" task sits in the pool permanently, weighted the same as one
 * task due tomorrow — in effect an extra tomorrow-task that never gets crossed
 * off. Because it is a constant while the task pile is not, its share shrinks
 * as work accumulates and grows back as you complete things.
 *
 * Deriving it from the curve rather than hardcoding a number keeps that meaning
 * intact if the curve is ever retuned.
 */
export const REST_WEIGHT = weightForDaysOut(1);
export const REST_LABEL = "Rest";

/** Advanced rest off, with the example kinds ready for whoever turns it on. */
export function defaultRestMode(): RestMode {
  return { advanced: false, types: ["Code", "Game"] };
}

/** The kinds in play right now — empty whenever plain "Rest" is what shows. */
export function activeRestTypes(restMode: RestMode): string[] {
  return restMode.advanced ? restMode.types : [];
}

/**
 * Which kind of rest this one turned out to be.
 *
 * Rest has already won by the time this runs: its share of the wheel is fixed
 * by REST_WEIGHT and decided in `pickWeighted`, and nothing here can widen or
 * narrow it. This only divides that slice evenly among the kinds on offer, so
 * two of them are 50/50 and the amount of rest in a day is exactly what it
 * was before the feature existed.
 *
 * `roll` is injectable so the split can be walked deterministically in tests.
 */
export function pickRestLabel(restMode: RestMode, roll: number = Math.random()): string {
  const types = activeRestTypes(restMode);
  if (types.length === 0) return REST_LABEL;
  // Clamped rather than modulo'd: a roll of exactly 1 would otherwise wrap to
  // the first kind and give it a hair more than its share.
  const index = Math.min(types.length - 1, Math.floor(roll * types.length));
  return types[index];
}

/** A task's pull on the recommender. Completed tasks weigh 0 and never win. */
export function taskWeight(task: Task, today: DateKey = todayKey()): number {
  if (task.completed) return 0;
  return weightForDaysOut(diffDays(task.dueDate, today));
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
 * Rest occupies its slice of the wheel whether or not anything else does.
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

/**
 * How a weight reads in the list. The curve only ever produces small integers
 * (2, 3, 4…) or unit fractions (1/2, 1/3…), so "1/n" is exact rather than an
 * approximation — see the round-trip test that walks the whole curve.
 */
export function formatWeight(weight: number): string {
  if (weight <= 0) return "0";
  if (weight >= 1) return String(Math.round(weight * 100) / 100);
  return `1/${Math.round(1 / weight)}`;
}
