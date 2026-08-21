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
 * Within a bucket the nearest due date comes first, ties broken by creation
 * order so the list never reshuffles under you. Completed tasks are ordered by
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

  const byDue = (a: WeightedTask, b: WeightedTask) =>
    a.task.dueDate.localeCompare(b.task.dueDate) ||
    a.task.createdAt.localeCompare(b.task.createdAt);

  overdue.sort(byDue);
  dueToday.sort(byDue);
  upcoming.sort(byDue);
  done.sort((a, b) => (b.task.completedAt ?? "").localeCompare(a.task.completedAt ?? ""));

  return [
    { key: "overdue", label: "Overdue", tone: "overdue" as const, items: overdue },
    { key: "today", label: "Today", items: dueToday },
    { key: "upcoming", label: "Upcoming", items: upcoming },
    { key: "done", label: "Completed", items: done },
  ].filter((g) => g.items.length > 0);
}
