import { toKey } from "./dates";
import { RestMode, Schedule, ScheduleBlock, Task } from "./types";
import {
  REST_LABEL,
  WeightTable,
  activeRestTypes,
  defaultRestMode,
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
 * Give each choice the closest possible whole-block count, then spread those
 * counts through the day with smooth weighted round-robin. This keeps the
 * finished schedule close to the target shares without clumping one task into
 * a long run. A very small share may round down to zero blocks.
 */
function spreadByShares<T>(
  choices: Array<{ value: T; share: number }>,
  blockCount: number,
): T[] {
  if (blockCount <= 0 || choices.length === 0) return [];

  const shareTotal = choices.reduce((sum, choice) => sum + choice.share, 0);
  if (shareTotal <= 0) return [];

  const targets = choices.map((choice) => (choice.share / shareTotal) * blockCount);
  const quotas = targets.map(Math.floor);
  const left = blockCount - quotas.reduce((sum, quota) => sum + quota, 0);

  const remainderOrder = targets
    .map((target, index) => ({ index, remainder: target - quotas[index] }))
    .sort((a, b) => {
      const difference = b.remainder - a.remainder;
      // Mathematically equal shares can differ by a floating-point hair. Keep
      // the caller's order for a true tie.
      return Math.abs(difference) < 1e-12 ? a.index - b.index : difference;
    });
  for (let i = 0; i < left; i++) quotas[remainderOrder[i].index]++;

  const scores = quotas.map(() => 0);
  const used = quotas.map(() => 0);
  const picks: T[] = [];

  for (let block = 0; block < blockCount; block++) {
    let winner = -1;
    for (let i = 0; i < choices.length; i++) {
      if (used[i] >= quotas[i]) continue;
      scores[i] += quotas[i];
      if (winner < 0 || scores[i] > scores[winner]) winner = i;
    }

    // Quotas always add up to blockCount, so a winner must exist.
    scores[winner] -= blockCount;
    used[winner]++;
    picks.push(choices[winner].value);
  }

  return picks;
}

export function allocateScheduleBlocks(
  table: WeightTable,
  blockCount: number,
): Array<Task | null> {
  return spreadByShares(
    [
      // First so a mathematically exact remainder tie favours keeping Rest's
      // absolute one-third share closest to its target.
      { value: null, share: table.restProbability },
      ...table.entries
        .filter((entry) => entry.probability > 0)
        .map((entry) => ({ value: entry.task, share: entry.probability })),
    ],
    blockCount,
  );
}

/** Divide Rest's blocks evenly and interleave the kinds instead of sampling. */
export function allocateRestLabels(restMode: RestMode, blockCount: number): string[] {
  const types = activeRestTypes(restMode);
  if (types.length === 0) return Array<string>(blockCount).fill(REST_LABEL);
  return spreadByShares(
    types.map((type) => ({ value: type, share: 1 })),
    blockCount,
  );
}

/**
 * Allocate the remainder of the day in proportion to the current weights.
 *
 * Which kind of rest a rest block is gets decided here, at the moment it is
 * allocated, and stored on the block — the same way a task pick is. Deciding it at
 * render time would make the label depend on repainting rather than the stored
 * schedule allocation.
 */
export function generateSchedule(
  tasks: Task[],
  table: WeightTable,
  endTime: string,
  now: Date = new Date(),
  restMode: RestMode = defaultRestMode(),
): Schedule {
  const times = buildBlockTimes(now, endTime);
  const picks = allocateScheduleBlocks(table, times.length);
  const restLabels = allocateRestLabels(
    restMode,
    picks.filter((task) => task === null).length,
  );
  let restIndex = 0;
  const blocks: ScheduleBlock[] = times.map(([start, end], index) => {
    const task = picks[index];
    return {
      start: start.toISOString(),
      end: end.toISOString(),
      taskId: task ? task.id : null,
      title: task ? task.title : restLabels[restIndex++],
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
 * Rebalance the rest blocks of a schedule you already have for a new rest mode.
 *
 * Turning advanced rest on should not cost you the schedule you are working
 * from. Which kind a rest block is does not change *which* blocks are Rest —
 * that is the whole point of it being post-processing — so labels can be
 * rebalanced on their own. Task blocks, their order, the generated
 * time and the signature all come through untouched, which means the schedule
 * does not go stale and nothing asks you to regenerate.
 *
 * Every active kind receives the closest possible whole-block count and the
 * labels are interleaved across the Rest blocks. Adding or removing a kind may
 * therefore rebalance existing Rest labels, while task blocks never move.
 */
export function applyRestMode(
  schedule: Schedule | null,
  restMode: RestMode,
): Schedule | null {
  if (!schedule) return null;

  const types = activeRestTypes(restMode);
  // Nothing on offer means every rest block reads "Rest" anyway, and the kinds
  // already stored are worth keeping for whenever it is switched back on.
  if (types.length === 0) return schedule;

  const labels = allocateRestLabels(
    restMode,
    schedule.blocks.filter((block) => block.taskId === null).length,
  );
  let changed = false;
  let restIndex = 0;
  const blocks = schedule.blocks.map((block) => {
    if (block.taskId !== null) return block;
    const title = labels[restIndex++];
    if (block.title === title) return block;
    changed = true;
    return { ...block, title };
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
 * being considered for its share, which is the opposite of what the list is for.
 *
 * That is why the date rolling over counts, even though nothing was edited.
 * Weights are measured against today, so at midnight every one of them moves:
 * a task due tomorrow becomes a task due today, 1 becomes 2, and the shares
 * used to allocate the blocks are no longer the shares on screen.
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
  // there: every weight used to allocate it belongs to the day before.
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
 * where regenerating silently rebuilds every allocation from the current time.
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
    "of your day. Regenerating rebuilds the schedule from the current time, so the " +
    "blocks on screen now will be replaced.",
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
      return "Your task weights or scheduling rules have changed since it was generated.";
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
    // Advanced rest stores the kind here when the block is allocated. Only a kind
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

/** Longest the on-screen clock may lag real time when nothing is due to change. */
export const TICK_MAX_MS = 20_000;

/**
 * A hair past the boundary, so a timer that fires a moment early still lands on
 * the far side of it instead of needing a second round to notice.
 */
const TICK_GUARD_MS = 50;

/**
 * How long to wait before `now` next has to move.
 *
 * A fixed heartbeat is the wrong shape for this. Blocks change over on the half
 * hour, but a timer started whenever the app happened to open sits at an
 * arbitrary offset from those marks — so at 10:00 the block that has just begun
 * is still drawn as upcoming and the finished one still says "Now", for however
 * much of the interval is left to run. The wait has to be measured to the
 * boundary, not to the next multiple of some interval.
 *
 * So sleep until the first moment something on screen would actually differ:
 * the next block edge, or midnight, where every weight moves and the schedule
 * goes stale. The cap keeps a slow heartbeat underneath it — for a clock that
 * stepped, or a machine that woke up — and bounds the drift on a day with no
 * edges left in it.
 */
export function nextTickDelay(
  now: Date,
  schedule: Schedule | null,
  maxMs: number = TICK_MAX_MS,
): number {
  const nowMs = now.getTime();
  let next = nowMs + maxMs;

  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  if (midnight < next) next = midnight;

  for (const block of schedule?.blocks ?? []) {
    // Both edges. A start is what promotes a block to "Now"; an end is what
    // retires it, and for the last block of the day that is the only edge left.
    for (const edge of [block.start, block.end]) {
      const at = new Date(edge).getTime();
      if (at > nowMs && at < next) next = at;
    }
  }

  return next - nowMs + TICK_GUARD_MS;
}
