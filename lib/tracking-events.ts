import { advanceTracking, configureTracking, dayPlan, type TrackingEvent, type TrackingState } from "./tracking";

/** Recover a boundary lost to polling only if the new checkpoint confirms it.
 * Commands, resets, owner changes and mismatching counters invalidate old predictions.
 */
export function checkpointEvents(previous: TrackingState, next: TrackingState): { events: TrackingEvent[]; confirmed: boolean } {
  const projected = advanceTracking(previous, next.cursor);
  const rejected = { events: projected.events, confirmed: false };
  if (next.cursor <= previous.cursor || next.dayKey !== projected.state.dayKey || next.timeZone !== previous.timeZone ||
      next.controllerId !== previous.controllerId) return rejected;
  const expected = configureTracking(projected.state, next.tasks, next.endTime, next.cursor, dayPlan(next), next.unweighted, next.minimumEnabled, next.minimumMinutes);
  const canonical = configureTracking(next, next.tasks, next.endTime, next.cursor);
  const equal = (a: number, b: number) => Math.abs(a - b) <= 1;
  const a = expected.rotation, b = canonical.rotation;
  if (!a || !b || a.version !== b.version || a.commandSeq !== b.commandSeq || a.turn?.taskId !== b.turn?.taskId ||
      !equal(a.turn?.elapsedMs ?? 0, b.turn?.elapsedMs ?? 0) || !equal(a.turn?.durationMs ?? 0, b.turn?.durationMs ?? 0)) return rejected;
  const countersMatch = (left: Record<string, number>, right: Record<string, number>) =>
    [...new Set([...Object.keys(left), ...Object.keys(right)])].every(id => equal(Object.hasOwn(left, id) ? left[id] : 0, Object.hasOwn(right, id) ? right[id] : 0));
  if (!countersMatch(a.totals, b.totals) || !countersMatch(expected.taskMs, canonical.taskMs) || !equal(expected.workMs, canonical.workMs) ||
      expected.mode !== canonical.mode || expected.taskId !== canonical.taskId) return rejected;
  const current = canonical.tasks.find(task => task.id === canonical.taskId && !task.completed);
  return { confirmed: true, events: projected.events.map(event => ({ ...event,
    body: current && canonical.mode === "work" ? `Now tracking ${current.title}.` : "No open tasks. Tracking is paused.",
  })) };
}
