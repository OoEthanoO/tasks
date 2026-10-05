import type { Task } from "./types";
import { compareListOrder } from "./grouping";
import { diffDays } from "./dates";
import { taskWeight } from "./weights";
import { DEFAULT_PLAN, type DayPlan } from "./plan";
import * as legacy from "./legacy-tracking";

export { formatDuration, localTimeZone, trackingDay, validTimeZone, ownsAlerts, dayPlan } from "./legacy-tracking";
export type TrackingAction = legacy.TrackingAction;
export type TrackingEvent = legacy.TrackingEvent;
export type TaskProgress = legacy.TaskProgress;
export type TrackingState = legacy.TrackingState & {
  /** Fixed weighted goal. Checkpoint on task edits/rollover, never on a clock tick. */
  coverageVersion?: 1;
  coverageGoalMs?: number;
};
export const MIN_DAILY_TARGET_MS = 30 * 60_000;
export const COVERAGE_DAYS = 7;
export const RESET_PROGRESS_CONFIRMATION = "Clear all of today’s tracked work? Tracking will pause on your synced devices. Your tasks stay unchanged, and today’s weighted targets will be recalculated. This cannot be undone.";
const EPSILON = 1;
const MINUTE = 60_000;

export function coverageCutoff(state: Pick<TrackingState, "dayKey">): string {
  const [year, month, day] = state.dayKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + COVERAGE_DAYS)).toISOString().slice(0, 10);
}
export function includedTask(task: Task, dayKey: string): boolean {
  return !task.completed && diffDays(task.dueDate, dayKey) <= COVERAGE_DAYS;
}
export function skippedExplanation(_minimumMs = MIN_DAILY_TARGET_MS): string {
  return "This task is due more than seven days away. It will be included when its due date enters the seven-day window.";
}
function entriesFor(state: TrackingState) {
  return state.tasks.map(task => ({ task,
    weight: includedTask(task, state.dayKey) ? taskWeight(task, state.dayKey) : 0,
    trackedMs: Object.hasOwn(state.taskMs, task.id) ? state.taskMs[task.id] : 0,
  }));
}

/**
 * Smallest water level giving every included task at least 30 minutes, with
 * logged work as a lower bound. Round the total up to a whole minute.
 * Save once per configuration: recalculating on each tick would prematurely
 * lower the goal when individual tasks reach 30 minutes.
 */
export function minimumCoverageGoal(state: TrackingState): number {
  const included = entriesFor(state).filter(e => e.weight > 0);
  let level = 0;
  for (const e of included) {
    if (e.trackedMs < MIN_DAILY_TARGET_MS) level = Math.max(level, MIN_DAILY_TARGET_MS / e.weight);
  }
  const remaining = included.reduce((sum, e) => sum + Math.max(0, e.weight * level - e.trackedMs), 0);
  if (remaining <= 0) return state.workMs;
  // Only remove floating-point noise at exact whole-minute boundaries.
  return Math.max(state.workMs, Math.ceil((state.workMs + remaining) / MINUTE - 1e-9) * MINUTE);
}
export function workBudget(state: TrackingState): number {
  return state.coverageVersion === 1 && state.coverageGoalMs !== undefined
    ? Math.max(state.workMs, state.coverageGoalMs) : minimumCoverageGoal(state);
}
export function workLeftMs(state: TrackingState, _now = state.cursor): number {
  return Math.max(0, workBudget(state) - state.workMs);
}
export const remainingWorkTime = workLeftMs;
export function canTrackWork(state: TrackingState, _now = state.cursor): boolean {
  return workLeftMs(state) > EPSILON && state.tasks.some(t => includedTask(t, state.dayKey));
}

/** Retired preference arguments are accepted for old clients/storage, but ignored. */
export function trackingConfigKey(tasks: Task[], _endTime?: string, _plan?: DayPlan, _unweighted?: boolean, _minimumEnabled?: boolean, _minimumMinutes?: number): string {
  return JSON.stringify(tasks.map(t => [t.id, t.title, t.dueDate, t.priority ?? "low", t.completed, t.createdAt]));
}
export function createTracking(tasks: Task[], endTime = "23:00", timeZone = legacy.localTimeZone(), now = Date.now(), plan = DEFAULT_PLAN, _unweighted?: boolean, _minimumEnabled?: boolean, _minimumMinutes?: number): TrackingState {
  const state: TrackingState = legacy.createTracking(tasks, endTime, timeZone, now, plan);
  state.coverageVersion = 1;
  state.coverageGoalMs = minimumCoverageGoal(state);
  return state;
}

/** Weighted water filling preserves history, including after mid-day task edits. */
export function taskProgress(state: TrackingState): TaskProgress[] {
  const entries = entriesFor(state);
  const open = entries.filter(e => e.weight > 0).sort((a, b) => a.trackedMs / a.weight - b.trackedMs / b.weight);
  const available = workLeftMs(state);
  let level = 0, weight = 0, tracked = 0;
  for (let i = 0; i < open.length; i++) {
    weight += open[i].weight; tracked += open[i].trackedMs;
    level = (available + tracked) / weight;
    if (i + 1 === open.length || level <= open[i + 1].trackedMs / open[i + 1].weight) break;
  }
  const totalWeight = open.reduce((sum, e) => sum + e.weight, 0);
  return entries.map(e => {
    const remainingMs = e.weight > 0 ? Math.max(0, e.weight * level - e.trackedMs) : 0;
    return { ...e, probability: totalWeight > 0 ? e.weight / totalWeight : 0,
      minimumMs: MIN_DAILY_TARGET_MS, targetMs: e.trackedMs + remainingMs, remainingMs,
      doneToday: remainingMs <= EPSILON, skipped: !e.task.completed && e.weight === 0 };
  });
}
function nextTask(state: TrackingState) {
  return taskProgress(state).filter(p => p.weight > 0 && !p.doneToday)
    .sort((a, b) => compareListOrder(a.task, b.task))[0];
}
function workingTask(state: TrackingState) {
  return (state.chosen && taskProgress(state).find(p => p.task.id === state.taskId && p.weight > 0 && !p.doneToday)) || nextTask(state);
}
function select(state: TrackingState, task: TaskProgress | undefined) {
  if (!task || task.task.id !== state.taskId) delete state.chosen;
  state.mode = task ? "work" : "idle"; state.taskId = task?.task.id ?? null;
}

/** Calendar midnight in the shared zone, not a configurable work-day cutoff. */
export function nextMidnight(state: TrackingState): number {
  const [year, month, day] = state.dayKey.split("-").map(Number);
  const nextDay = new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
  return legacy.dayEnd({ ...state, dayKey: nextDay, endTime: "00:00" });
}
function integrate(state: TrackingState, until: number): { state: TrackingState; events: TrackingEvent[] } {
  const events: TrackingEvent[] = [];
  const emit = (type: TrackingEvent["type"], title: string, body: string, taskId = "") => {
    const event = { id: `${state.dayKey}:${Math.round(state.cursor)}:${type}:${taskId}`, at: state.cursor, type, title, body };
    events.push(event); return event;
  };
  for (let guard = 0; guard < state.tasks.length + 2 && state.mode === "work" && state.cursor < until; guard++) {
    const current = workingTask(state);
    select(state, current);
    if (!current) break;
    const elapsed = Math.min(until - state.cursor, current.remainingMs, workLeftMs(state));
    Object.defineProperty(state.taskMs, current.task.id, { value: current.trackedMs + elapsed, enumerable: true, writable: true, configurable: true });
    state.workMs += elapsed; state.cursor += elapsed;
    let completion: TrackingEvent | undefined;
    if (elapsed + EPSILON >= current.remainingMs) {
      completion = emit("task-complete", "Daily target reached", `${current.task.title} is complete for today.`, current.task.id);
      state.taskId = null; delete state.chosen;
    }
    if (workLeftMs(state) <= EPSILON) {
      select(state, undefined);
      emit("work-complete", "Today’s work is done", "You reached all of today’s weighted targets. No more work is scheduled for today.");
    } else if (!state.taskId) select(state, nextTask(state));
    if (completion) completion.body += state.taskId ? ` Now tracking ${state.tasks.find(t => t.id === state.taskId)!.title}.` : " Today’s work is done.";
  }
  state.cursor = until;
  return { state, events };
}
export function advanceTracking(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  if (!Number.isFinite(now) || now < original.cursor) return { state: { ...original, taskMs: { ...original.taskMs } }, events: [] };
  if (legacy.trackingDay(now, original.timeZone) !== original.dayKey) {
    return { state: { ...createTracking(original.tasks, original.endTime, original.timeZone, now, legacy.dayPlan(original)), revision: original.revision, controllerId: original.controllerId }, events: [] };
  }
  if (original.coverageVersion !== 1) {
    // Preserve elapsed work under the old allocation exactly once before changing goals.
    const result = legacy.advanceTracking(original, now);
    const state: TrackingState = result.state;
    state.coverageVersion = 1; state.coverageGoalMs = minimumCoverageGoal(state);
    state.unweighted = false; state.minimumEnabled = true; state.minimumMinutes = 30;
    if (state.mode === "work") select(state, workingTask(state));
    return { state, events: [] }; // Retired idle/cutoff alerts must never replay on upgrade.
  }
  return integrate({ ...original, taskMs: { ...original.taskMs } }, now);
}
export function configureTracking(original: TrackingState, tasks: Task[], _endTime: string, now: number, _plan?: DayPlan, _unweighted?: boolean, _minimumEnabled?: boolean, _minimumMinutes?: number): TrackingState {
  const state = advanceTracking(original, now).state;
  const allocationKey = (items: Task[]) => JSON.stringify(items.filter(t => includedTask(t, state.dayKey))
    .map(t => [t.id, t.dueDate, t.priority ?? "low"]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
  const changed = allocationKey(state.tasks) !== allocationKey(tasks);
  state.tasks = tasks;
  if (changed) state.coverageGoalMs = minimumCoverageGoal(state);
  if (state.mode === "work") select(state, workingTask(state));
  return state;
}
export function actOnTracking(original: TrackingState, action: TrackingAction, controllerId: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  state.controllerId = controllerId;
  if (action.type === "reset") return { ...createTracking(state.tasks, state.endTime, state.timeZone, now, legacy.dayPlan(state)), revision: state.revision, controllerId };
  if (action.type === "pause") { select(state, undefined); return state; }
  const listed = nextTask(state);
  const next = action.taskId ? taskProgress(state).find(p => p.task.id === action.taskId && p.weight > 0 && !p.doneToday) : listed;
  if (!next) throw new Error("No unfinished daily target to track.");
  select(state, next);
  if (next.task.id !== listed?.task.id) state.chosen = true; else delete state.chosen;
  return state;
}
export function upcomingTrackingEvents(state: TrackingState, now: number): TrackingEvent[] {
  const current = advanceTracking(state, now).state;
  // Project within this calendar day so rollover does not erase predictions.
  return integrate({ ...current, taskMs: { ...current.taskMs } }, nextMidnight(current) - 1).events.filter(e => e.at > now).slice(0, 60);
}
export function parseTracking(value: unknown): TrackingState | null {
  const state = legacy.parseTracking(value) as TrackingState | null;
  if (!state) return null;
  if (state.coverageVersion !== undefined && state.coverageVersion !== 1) return null;
  if (state.coverageVersion === 1 && (typeof state.coverageGoalMs !== "number" || !Number.isFinite(state.coverageGoalMs) || state.coverageGoalMs < 0)) return null;
  return state;
}
