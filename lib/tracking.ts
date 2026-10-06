import type { Task } from "./types";
import { compareListOrder } from "./grouping";
import { DEFAULT_PLAN, type DayPlan } from "./plan";
import { DEFAULT_MINIMUM_MINUTES, sanitizeMinimumMinutes } from "./minimum";
import * as legacy from "./legacy-tracking";

export { dayEnd, dayPlan, formatDuration, localTimeZone, ownsAlerts, skippedExplanation, trackingDay, validTimeZone, MIN_DAILY_TARGET_MS } from "./legacy-tracking";
export type TrackingAction = legacy.TrackingAction;
export type TrackingEvent = legacy.TrackingEvent;
export type TaskProgress = legacy.TaskProgress;
/** "idle" is retained in storage for compatibility; it only means paused. */
export type TrackingState = legacy.TrackingState & { workOnlyVersion?: 1 };
export const RESET_PROGRESS_CONFIRMATION = "Clear all of today’s tracked work? Tracking will pause on your synced devices. Your tasks and end time stay unchanged. This cannot be undone.";
const EPSILON = 1;

/** All time until today's end is available; no start time, ratio or idle budget. */
export function workLeftMs(state: TrackingState, now = state.cursor): number {
  return Math.max(0, legacy.dayEnd(state) - now);
}
export const remainingWorkTime = workLeftMs;
export function workBudget(state: TrackingState): number {
  return state.workMs + workLeftMs(state);
}
export function canTrackWork(state: TrackingState, now = state.cursor): boolean {
  return workLeftMs(state, now) > EPSILON;
}
export function trackingConfigKey(tasks: Task[], endTime: string, _plan: DayPlan = DEFAULT_PLAN, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): string {
  return JSON.stringify([endTime, unweighted, minimumEnabled, sanitizeMinimumMinutes(minimumMinutes), tasks.map(t => [t.id, t.title, t.dueDate, t.priority ?? "low", t.completed, t.createdAt])]);
}
export function createTracking(tasks: Task[], endTime: string, timeZone = legacy.localTimeZone(), now = Date.now(), plan: DayPlan = DEFAULT_PLAN, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): TrackingState {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error("Choose a valid end time.");
  return { ...legacy.createTracking(tasks, endTime, timeZone, now, plan, unweighted, minimumEnabled, minimumMinutes), workOnlyVersion: 1 };
}
export function taskProgress(state: TrackingState): TaskProgress[] {
  return legacy.allocateTaskProgress(state, workLeftMs(state));
}
function nextTask(state: TrackingState) {
  return taskProgress(state).filter(p => p.weight > 0 && !p.doneToday).sort((a, b) => compareListOrder(a.task, b.task))[0];
}
function workingTask(state: TrackingState) {
  return (state.chosen && taskProgress(state).find(p => p.task.id === state.taskId && p.weight > 0 && !p.doneToday)) || nextTask(state);
}
function select(state: TrackingState, task: TaskProgress | undefined) {
  if (!task || task.task.id !== state.taskId) delete state.chosen;
  state.mode = task ? "work" : "idle"; state.taskId = task?.task.id ?? null;
}
export function advanceTracking(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  if (!Number.isFinite(now) || now < original.cursor) return { state: { ...original, taskMs: { ...original.taskMs } }, events: [] };
  if (legacy.trackingDay(now, original.timeZone) !== original.dayKey) {
    return { state: { ...createTracking(original.tasks, original.endTime, original.timeZone, now, legacy.dayPlan(original), original.unweighted, original.minimumEnabled, original.minimumMinutes), revision: original.revision, controllerId: original.controllerId }, events: [] };
  }
  if (original.workOnlyVersion !== 1) {
    // Attribute the old running interval under its old policy exactly once.
    // Do not invent work during a pause or replay retired idle/rest alerts.
    const state: TrackingState = legacy.advanceTracking(original, now).state;
    state.workOnlyVersion = 1;
    if (state.mode === "work") select(state, canTrackWork(state) ? workingTask(state) : undefined);
    return { state, events: [] };
  }
  const state = { ...original, taskMs: { ...original.taskMs } };
  const events: TrackingEvent[] = [];
  const emit = (type: TrackingEvent["type"], title: string, body: string, taskId = "") => {
    const event = { id: `${state.dayKey}:${Math.round(state.cursor)}:${type}:${taskId}`, at: state.cursor, type, title, body };
    events.push(event); return event;
  };
  const end = legacy.dayEnd(state), until = Math.min(now, end);
  for (let guard = 0; guard < state.tasks.length * 2 + 20 && state.mode === "work" && state.cursor < until; guard++) {
    const current = workingTask(state);
    select(state, current);
    if (!current) break;
    const elapsed = Math.min(until - state.cursor, current.remainingMs);
    Object.defineProperty(state.taskMs, current.task.id, { value: current.trackedMs + elapsed, enumerable: true, writable: true, configurable: true });
    state.workMs += elapsed; state.cursor += elapsed;
    if (elapsed + EPSILON >= current.remainingMs) {
      const completion = emit("task-complete", "Daily target reached", `${current.task.title} is complete for today.`, current.task.id);
      state.taskId = null; delete state.chosen;
      select(state, workLeftMs(state) > EPSILON ? nextTask(state) : undefined);
      completion.body += state.cursor + EPSILON >= end ? " Tracking has stopped for today."
        : state.taskId ? ` Now tracking ${state.tasks.find(t => t.id === state.taskId)!.title}.` : " No unfinished task to track.";
    }
  }
  if (original.mode === "work" && original.cursor < end && now >= end) {
    state.cursor = end; select(state, undefined);
    emit("day-end", "Work day complete", "Your end time has been reached. Tracking has stopped for today.");
  } else if (now >= end) select(state, undefined);
  state.cursor = now;
  return { state, events };
}
export function configureTracking(original: TrackingState, tasks: Task[], endTime: string, now: number, plan: DayPlan = legacy.dayPlan(original), unweighted = original.unweighted ?? false, minimumEnabled = original.minimumEnabled ?? true, minimumMinutes = original.minimumMinutes ?? DEFAULT_MINIMUM_MINUTES): TrackingState {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)) throw new Error("Choose a valid end time.");
  const state = advanceTracking(original, now).state;
  state.tasks = tasks; state.endTime = endTime; state.plan = { ...plan };
  state.unweighted = unweighted; state.minimumEnabled = minimumEnabled; state.minimumMinutes = sanitizeMinimumMinutes(minimumMinutes);
  select(state, state.mode === "work" && canTrackWork(state, now) ? workingTask(state) : undefined);
  return state;
}
export function actOnTracking(original: TrackingState, action: TrackingAction, controllerId: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  state.controllerId = controllerId;
  if (action.type === "reset") return { ...createTracking(state.tasks, state.endTime, state.timeZone, now, legacy.dayPlan(state), state.unweighted, state.minimumEnabled, state.minimumMinutes), revision: state.revision, controllerId };
  if (action.type === "pause") { select(state, undefined); return state; }
  if (!canTrackWork(state, now)) throw new Error("The work day has ended. Extend the end time or start tomorrow.");
  const listed = nextTask(state);
  const next = action.taskId ? taskProgress(state).find(p => p.task.id === action.taskId && p.weight > 0 && !p.doneToday) : listed;
  if (!next) throw new Error("No unfinished daily target to track.");
  select(state, next);
  if (next.task.id !== listed?.task.id) state.chosen = true; else delete state.chosen;
  return state;
}
export function upcomingTrackingEvents(state: TrackingState, now: number): TrackingEvent[] {
  const current = advanceTracking(state, now).state;
  return advanceTracking(current, Math.max(now, legacy.dayEnd(current))).events.filter(e => e.at > now).slice(0, 60);
}
export function parseTracking(value: unknown): TrackingState | null {
  const state = legacy.parseTracking(value) as TrackingState | null;
  if (!state || (state.workOnlyVersion !== undefined && state.workOnlyVersion !== 1)) return null;
  return state;
}
