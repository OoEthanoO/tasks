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
 * Rest owns one third of every pick or generated schedule. It is an absolute
 * share, not another relative weight in the task pile: open tasks divide the
 * other two thirds in proportion to their due-date weights.
 */
export const REST_SHARE = 1 / 3;
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
 * Rest has already been allocated by the time this runs, and nothing here can
 * widen or narrow its share. This only divides that slice evenly among the
 * kinds on offer, so two of them are 50/50.
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
  /** Sum of the relative due-date weights for open tasks. */
  taskTotal: number;
  /** One third when there is work to schedule; all of it when there is none. */
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
  return "balanced-v1|" + tasks
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
