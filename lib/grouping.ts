import { DateKey, diffDays } from "./dates";
import { Task } from "./types";
import { WeightedTask } from "./weights";

/** Which of the four lists a task belongs in, and how urgent it reads. */
export type DueBucket = "overdue" | "today" | "upcoming" | "done";

/**
 * The one place a task's urgency is decided.
 *
 * Both apps need this twice over — once to pick the list a task is filed
 * under, and again to colour its due date — and each had written it out
 * separately. Three copies of one rule is three chances for the heading a task
 * sits under to disagree with the colour beside it.
 */
export function dueBucket(task: Task, today: DateKey): DueBucket {
  if (task.completed) return "done";
  const delta = diffDays(task.dueDate, today);
  if (delta < 0) return "overdue";
  if (delta === 0) return "today";
  return "upcoming";
}

/**
 * Nearest due date first. The stable sort preserves saved array order for
 * same-date tasks, including manual moves. The one-hour rotation follows
 * this exact order. Due dates never change the length of a turn.
 */
export function compareListOrder(a: Task, b: Task): number {
  return a.dueDate.localeCompare(b.dueDate);
}

/** Frozen ordering for checkpointing work accrued under the old algorithms. */
export function compareLegacyListOrder(a: Task, b: Task): number {
  return a.dueDate.localeCompare(b.dueDate) || a.createdAt.localeCompare(b.createdAt);
}

export type TaskMoveDirection = "up" | "down";

/** Swap with the adjacent open task of the same date, leaving all data intact. */
export function moveTaskWithinDueDate(tasks: Task[], id: string, direction: TaskMoveDirection): Task[] {
  if (direction !== "up" && direction !== "down") return tasks;
  const from = tasks.findIndex(task => task.id === id && !task.completed);
  if (from < 0) return tasks;
  const step = direction === "up" ? -1 : 1;
  for (let to = from + step; to >= 0 && to < tasks.length; to += step) {
    if (tasks[to].completed || tasks[to].dueDate !== tasks[from].dueDate) continue;
    const reordered = [...tasks];
    [reordered[from], reordered[to]] = [reordered[to], reordered[from]];
    return reordered;
  }
  return tasks;
}

/** Completion recency, not due date. Missing dates go last; ties stay stable. */
export function compareCompletedOrder(a: Task, b: Task): number {
  const at = a.completedAt ? Date.parse(a.completedAt) : NaN;
  const bt = b.completedAt ? Date.parse(b.completedAt) : NaN;
  if (!Number.isFinite(at)) return Number.isFinite(bt) ? 1 : 0;
  if (!Number.isFinite(bt)) return -1;
  return bt - at;
}

export type TaskGroup = {
  key: string;
  label: string;
  /** Set on the bucket the UIs colour as urgent. */
  tone?: "overdue";
  items: WeightedTask[];
};

/**
 * Sort a task list into the four buckets both apps show, in display order.
 *
 * Shared rather than written twice: the web list and the phone list have to
 * agree on what "overdue" means and on the order within a bucket, and a copy
 * in each is a copy that can be fixed in one and not the other.
 *
 * Within a bucket the nearest due date comes first, with saved manual order
 * deciding ties. Completed tasks are ordered by
 * when they were finished, most recent first, which is the opposite question:
 * you want to see what you just did, not what is most overdue.
 */
export function groupTasks(entries: WeightedTask[], today: DateKey): TaskGroup[] {
  const overdue: WeightedTask[] = [];
  const dueToday: WeightedTask[] = [];
  const upcoming: WeightedTask[] = [];
  const done: WeightedTask[] = [];

  const buckets: Record<DueBucket, WeightedTask[]> = {
    overdue,
    today: dueToday,
    upcoming,
    done,
  };
  for (const entry of entries) {
    buckets[dueBucket(entry.task, today)].push(entry);
  }

  const byDue = (a: WeightedTask, b: WeightedTask) => compareListOrder(a.task, b.task);

  overdue.sort(byDue);
  dueToday.sort(byDue);
  upcoming.sort(byDue);
  done.sort((a, b) => compareCompletedOrder(a.task, b.task));

  return [
    { key: "overdue", label: "Overdue", tone: "overdue" as const, items: overdue },
    { key: "today", label: "Today", items: dueToday },
    { key: "upcoming", label: "Upcoming", items: upcoming },
    { key: "done", label: "Completed", items: done },
  ].filter((g) => g.items.length > 0);
}
