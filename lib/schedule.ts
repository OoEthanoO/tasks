import { toKey } from "./dates";
import { RestMode, Schedule, ScheduleBlock, Task } from "./types";
import {
  REST_LABEL,
  WeightTable,
  activeRestTypes,
  defaultRestMode,
  pickRestLabel,
  pickWeighted,
  taskSignature,
} from "./weights";

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

/**
 * Roll the recommender once per block for the remainder of the day.
 *
 * Which kind of rest a rest block is gets decided here, at the moment it is
 * drawn, and stored on the block — the same way a task pick is. Deciding it at
 * render time instead would either re-roll the label on every repaint or need
 * the block to be hashed into a kind, and neither is what "a schedule" means
 * everywhere else in this file: a snapshot of one set of rolls.
 */
export function generateSchedule(
  tasks: Task[],
  table: WeightTable,
  endTime: string,
  now: Date = new Date(),
  restMode: RestMode = defaultRestMode(),
): Schedule {
  const blocks: ScheduleBlock[] = buildBlockTimes(now, endTime).map(([start, end]) => {
    const task = pickWeighted(table);
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      taskId: task ? task.id : null,
      title: task ? task.title : pickRestLabel(restMode),
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

/**
 * Re-draw the rest blocks of a schedule you already have for a new rest mode.
 *
 * Turning advanced rest on should not cost you the schedule you are working
 * from. Which kind a rest block is was never part of the draw that decided
 * *what* each block is — that is the whole point of it being post-processing —
 * so it can be redrawn on its own. Task blocks, their order, the generated
 * time and the signature all come through untouched, which means the schedule
 * does not go stale and nothing asks you to regenerate.
 *
 * Only blocks showing a kind that is not currently on offer are redrawn. That
 * is what makes this safe to call on every edit: switching off and back on, or
 * adding a kind, leaves labels that are still valid exactly where they were,
 * and only a removed kind forces the blocks that used it to pick again.
 */
export function applyRestMode(
  schedule: Schedule | null,
  restMode: RestMode,
  roll: () => number = Math.random,
): Schedule | null {
  if (!schedule) return null;

  const types = activeRestTypes(restMode);
  // Nothing on offer means every rest block reads "Rest" anyway, and the kinds
  // already stored are worth keeping for whenever it is switched back on.
  if (types.length === 0) return schedule;

  const onOffer = new Set(types);
  let changed = false;
  const blocks = schedule.blocks.map((block) => {
    if (block.taskId !== null || onOffer.has(block.title)) return block;
    changed = true;
    return { ...block, title: pickRestLabel(restMode, roll()) };
  });

  return changed ? { ...schedule, blocks } : schedule;
}

export type StaleReason = "elapsed" | "day" | "hours" | "tasks" | null;

/**
 * Whether a stored schedule still describes the day in front of you.
 *
 * The rule it has to keep is that a schedule always reflects the weights of the
 * current task list. Anything that moves a weight has to invalidate it —
 * otherwise a task added after generation would sit at a zero chance of ever
 * being scheduled, which is the opposite of what the list is for.
 *
 * That is why the date rolling over counts, even though nothing was edited.
 * Weights are measured against today, so at midnight every one of them moves:
 * a task due tomorrow becomes a task due today, 1 becomes 2, and the shares
 * every block was drawn from are no longer the shares on screen.
 */
export function scheduleStaleReason(
  schedule: Schedule | null,
  tasks: Task[],
  endTime: string,
  now: Date = new Date(),
): StaleReason {
  if (!schedule) return null;

  const last = schedule.blocks[schedule.blocks.length - 1];
  if (last && now.getTime() >= new Date(last.end).getTime()) return "elapsed";

  // A schedule may legitimately run past midnight, but it cannot stay valid
  // there: every weight it was drawn from belongs to the day before.
  if (schedule.dayKey !== toKey(now)) return "day";

  // The stored end time was written on every schedule but never read, so moving
  // the end of your day left a schedule that stops short of it — or runs past
  // it — with nothing prompting a regenerate.
  if (schedule.endTime !== endTime) return "hours";
  if (schedule.signature !== taskSignature(tasks)) return "tasks";
  return null;
}

/**
 * Whether regenerating would throw away a schedule that is still good, and so
 * is worth stopping to ask about.
 *
 * A stale schedule needs regenerating, so asking would only be in the way. A
 * schedule that does not exist has nothing to lose, and neither does one with
 * no blocks in it — that is the work-day-already-over case, where the empty
 * panel is itself telling you to push the end time out and generate again.
 * What is left is a live schedule that still describes the day accurately,
 * where regenerating silently replaces every pick with a fresh draw.
 */
export function needsRegenerateConfirmation(
  schedule: Schedule | null,
  staleReason: StaleReason,
): boolean {
  return schedule !== null && schedule.blocks.length > 0 && staleReason === null;
}

/** One wording for that question, so the two apps cannot drift. */
export const REGENERATE_CONFIRM = {
  title: "Regenerate this schedule?",
  body:
    "Nothing has changed since it was generated, so it still describes the rest " +
    "of your day. Regenerating draws every block again, so the picks on screen " +
    "now will be replaced.",
  confirm: "Regenerate",
  cancel: "Keep it",
} as const;

/** One wording for why a schedule is stale, so the two apps cannot drift. */
export function staleMessage(reason: Exclude<StaleReason, null>): string {
  switch (reason) {
    case "elapsed":
      return "It has run past the end of its work day.";
    case "day":
      return "The date has changed, so every task's weight has moved.";
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
  restMode: RestMode = defaultRestMode(),
): ResolvedBlock {
  if (block.taskId === null) {
    // Advanced rest stores the kind here when the block is drawn. Only a kind
    // that is still on offer is shown, so switching the mode off reads as
    // plain Rest again, and a kind that was deleted cannot linger on screen.
    const kind = block.title.trim();
    const onOffer = activeRestTypes(restMode).includes(kind);
    return { title: onOffer ? kind : REST_LABEL, isRest: true, isMissing: false };
  }
  const live = byId.get(block.taskId);
  return {
    title: live ? live.title : block.title,
    isRest: false,
    isMissing: !live,
  };
}
