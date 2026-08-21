import { toKey, todayKey } from "./dates";
import { Schedule, ScheduleBlock, Task } from "./types";
import { REST_LABEL, WeightTable, pickWeighted, taskSignature } from "./weights";

export const BLOCK_MINUTES = 30;

/** Parse "23:00" into a Date on the same calendar day as `ref`. */
export function endOfDayFrom(ref: Date, endTime: string): Date {
  const [h, m] = endTime.split(":").map(Number);
  return new Date(ref.getFullYear(), ref.getMonth(), ref.getDate(), h, m, 0, 0);
}

/**
 * Slice the rest of the working day into blocks. The first block is a stub that
 * runs from now to the next :00 or :30 mark; everything after it is a full
 * half hour, and the last block is clipped to the end of the work day.
 */
export function buildBlockTimes(now: Date, endTime: string): Array<[Date, Date]> {
  const end = endOfDayFrom(now, endTime);
  const start = new Date(now);
  start.setSeconds(0, 0);
  if (start >= end) return [];

  const times: Array<[Date, Date]> = [];

  // Next half-hour boundary after `start`.
  let cursor = new Date(start);
  const minutes = cursor.getMinutes();
  const nextMark = minutes < 30 ? 30 : 60;
  let boundary = new Date(cursor);
  boundary.setMinutes(nextMark, 0, 0);

  if (boundary > end) {
    times.push([cursor, end]);
    return times;
  }

  // Skip a sliver of a first block (already sitting on the boundary).
  if (boundary.getTime() - cursor.getTime() >= 60_000) {
    times.push([cursor, boundary]);
  }
  cursor = boundary;

  while (cursor < end) {
    const next = new Date(cursor.getTime() + BLOCK_MINUTES * 60_000);
    times.push([cursor, next > end ? end : next]);
    cursor = next;
  }

  return times;
}

/** Roll the recommender once per block for the remainder of the day. */
export function generateSchedule(
  tasks: Task[],
  table: WeightTable,
  endTime: string,
  now: Date = new Date(),
): Schedule {
  const blocks: ScheduleBlock[] = buildBlockTimes(now, endTime).map(([start, end]) => {
    const task = pickWeighted(table);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      taskId: task ? task.id : null,
      title: task ? task.title : REST_LABEL,
    };
  });

  return {
    blocks,
    generatedAt: now.toISOString(),
    dayKey: toKey(now),
    signature: taskSignature(tasks),
    endTime,
  };
}

export type StaleReason = "day" | "tasks" | null;

/** A schedule is only good for the day and task list it was built from. */
export function scheduleStaleReason(
  schedule: Schedule | null,
  tasks: Task[],
  today: string = todayKey(),
): StaleReason {
  if (!schedule) return null;
  if (schedule.dayKey !== today) return "day";
  if (schedule.signature !== taskSignature(tasks)) return "tasks";
  return null;
}

export type ResolvedBlock = {
  /** What the block should say now — not what it said when generated. */
  title: string;
  isRest: boolean;
  /** The task was deleted after this schedule was built. */
  isMissing: boolean;
};

/** Index tasks by id so a whole schedule can be resolved in one pass. */
export function indexTasks(tasks: Task[]): Map<string, Task> {
  return new Map(tasks.map((task) => [task.id, task]));
}

/**
 * Resolve a stored block against the current task list.
 *
 * Block titles are snapshotted at generation time so that a block whose task
 * was since deleted still reads as something rather than a blank. But renaming
 * a task deliberately does *not* make the schedule stale — the weights are
 * unchanged, so there is nothing to regenerate — which means the snapshot would
 * otherwise keep showing the old name for the rest of the day. Prefer the live
 * title whenever the task is still there, and fall back to the snapshot only
 * once it is genuinely gone.
 */
export function resolveBlock(
  block: ScheduleBlock,
  byId: Map<string, Task>,
): ResolvedBlock {
  if (block.taskId === null) {
    return { title: REST_LABEL, isRest: true, isMissing: false };
  }
  const live = byId.get(block.taskId);
  return {
    title: live ? live.title : block.title,
    isRest: false,
    isMissing: !live,
  };
}
