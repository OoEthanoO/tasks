import { toKey } from "./dates";
import { Schedule, ScheduleBlock, Task } from "./types";
import { REST_LABEL, WeightTable, pickWeighted, taskSignature } from "./weights";

export const BLOCK_MINUTES = 30;

/** An end time before this hour reads as the end of a night, not a morning. */
const SMALL_HOURS_BEFORE = 5;

/**
 * The moment the work day ends.
 *
 * Usually that is today at `endTime`. But an end time in the small hours means
 * the night that is beginning, not one already gone: "my day ends at 12:00 AM",
 * set at nine in the morning, means tonight's midnight fifteen hours away.
 * Reading it as this morning's put the end before the start, which left the
 * schedule permanently empty and told the user to pick a later time — advice
 * there is no way to follow when the time you want is midnight.
 *
 * It only shifts when the end has genuinely not happened yet. At 2 AM an end
 * time of 1 AM really has gone by, and the work day really is over.
 */
export function endOfWorkDay(now: Date, endTime: string): Date {
  const [h, m] = endTime.split(":").map(Number);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);

  const endsInSmallHours = h < SMALL_HOURS_BEFORE;
  const nowInSmallHours = now.getHours() < SMALL_HOURS_BEFORE;
  if (end <= now && endsInSmallHours && !nowInSmallHours) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}

/**
 * Slice the rest of the working day into blocks. The first block is a stub that
 * runs from now to the next :00 or :30 mark; everything after it is a full
 * half hour, and the last block is clipped to the end of the work day.
 */
export function buildBlockTimes(now: Date, endTime: string): Array<[Date, Date]> {
  const end = endOfWorkDay(now, endTime);
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

export type StaleReason = "elapsed" | "hours" | "tasks" | null;

/**
 * Whether a stored schedule still describes the day in front of you.
 *
 * The span it covers is what matters, not the calendar day it was built on. A
 * schedule generated at 11:50 PM to run until 1 AM is still the current plan at
 * half past midnight, even though the date has rolled over; one built yesterday
 * morning is not, whatever today's date is.
 */
export function scheduleStaleReason(
  schedule: Schedule | null,
  tasks: Task[],
  endTime: string,
  now: Date = new Date(),
): StaleReason {
  if (!schedule) return null;

  const last = schedule.blocks[schedule.blocks.length - 1];
  if (last) {
    if (now.getTime() >= new Date(last.end).getTime()) return "elapsed";
  } else if (schedule.dayKey !== toKey(now)) {
    // No blocks to run out, so fall back to the day it was generated for.
    return "elapsed";
  }

  // The stored end time was written on every schedule but never read, so moving
  // the end of your day left a schedule that stops short of it — or runs past
  // it — with nothing prompting a regenerate.
  if (schedule.endTime !== endTime) return "hours";
  if (schedule.signature !== taskSignature(tasks)) return "tasks";
  return null;
}

/** One wording for why a schedule is stale, so the two apps cannot drift. */
export function staleMessage(reason: Exclude<StaleReason, null>): string {
  switch (reason) {
    case "elapsed":
      return "It has run past the end of its work day.";
    case "hours":
      return "Your work day now ends at a different time.";
    case "tasks":
      return "Your task list has changed since it was generated.";
  }
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
