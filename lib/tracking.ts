import { Task } from "./types";
import { isPriority, taskWeight, WeightedTask } from "./weights";
import { compareListOrder } from "./grouping";
import { DEFAULT_PLAN, DayPlan, samePlan, sanitizePlan } from "./plan";
import { DEFAULT_MINIMUM_MINUTES, sanitizeMinimumMinutes } from "./minimum";

export const RESET_PROGRESS_CONFIRMATION = "Clear all of today’s tracked work? Tracking will pause on your synced devices, and time already passed today will count as idle. Your tasks and work day settings stay unchanged. This cannot be undone.";
const EPSILON = 1;
const formatters = new Map<string, Intl.DateTimeFormat>();
const wallCache = new Map<string, number>();

/**
 * One timestamp-based session, not one counter per device. Only work is
 * counted: between the day's start and now, every minute not tracked as work
 * is idle, so idle time is derived rather than accumulated.
 */
export type TrackingState = {
  version: 1;
  /** Absent on legacy sessions; checkpoint their old projection before upgrading. */
  allocationVersion?: 2;
  revision: number;
  dayKey: string;
  timeZone: string;
  endTime: string;
  /** Start time and work:idle ratio. Absent on timers from before them, which use the default. */
  plan?: DayPlan;
  cursor: number;
  tasks: Task[];
  taskMs: Record<string, number>;
  workMs: number;
  mode: "idle" | "work";
  taskId: string | null;
  /**
   * The task was picked with Track. It stays until its target is met. Without
   * this, the timer always works on the first unfinished task in list order,
   * so a task added or moved above it takes over.
   */
  chosen?: true;
  controllerId: string | null;
  /** Missing on older snapshots, which retain due-date/priority weighting. */
  unweighted?: boolean;
  /** Missing on older snapshots, which keep the 30-minute minimum enabled. */
  minimumEnabled?: boolean;
  /** Missing on older snapshots, which use 30 minutes. */
  minimumMinutes?: number;
};
export type TrackingAction = { type: "start"; taskId?: string } | { type: "pause" } | { type: "reset" };
export type TrackingEvent = {
  id: string;
  at: number;
  type: "task-complete" | "work-complete" | "idle-half" | "idle-soon" | "idle-out" | "day-end";
  title: string;
  body: string;
};
/**
 * When the minimum is enabled, a task whose whole day would come to less than this is skipped. A few
 * minutes on something due weeks away barely counts; that time does more
 * good on the tasks that are more urgent.
 */
export const MIN_DAILY_TARGET_MS = DEFAULT_MINIMUM_MINUTES * 60_000;
export function skippedExplanation(minimumMs: number): string {
  return `Its share of today’s work would come to under ${minimumMs / 60_000} minutes, so that time goes to higher-weight or earlier tasks instead.`;
}
export type TaskProgress = WeightedTask & {
  trackedMs: number; targetMs: number; remainingMs: number; doneToday: boolean;
  /** The configured threshold, for labels explaining skipped tasks. */
  minimumMs: number;
  /** Its day would total under the enabled minimum, so its share went to other tasks. */
  skipped: boolean;
};

export function validTimeZone(value: unknown): string {
  if (typeof value === "string") {
    try { new Intl.DateTimeFormat("en", { timeZone: value }).format(); return value; } catch { /* invalid zone */ }
  }
  return "UTC";
}
export function localTimeZone(): string {
  return validTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}
function dateParts(at: number, timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    if (formatters.size > 64) formatters.clear();
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(at));
  const get = (key: string) => parts.find(p => p.type === key)?.value ?? "00";
  return { day: `${get("year")}-${get("month")}-${get("day")}`, hour: +get("hour"), minute: +get("minute"), second: +get("second") };
}
export function trackingDay(at: number, timeZone: string): string { return dateParts(at, timeZone).day; }

/** Resolve an account wall-clock time on the timer's day, including DST, independently of the server's zone. */
function wallClock(dayKey: string, time: string, timeZone: string): number {
  const key = `${dayKey}/${time}/${timeZone}`;
  const cached = wallCache.get(key);
  if (cached !== undefined) return cached;
  const [y, m, d] = dayKey.split("-").map(Number);
  const [h, minute] = time.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, minute);
  let result = wall;
  for (let i = 0; i < 4; i++) {
    const p = dateParts(result, timeZone);
    const [py, pm, pd] = p.day.split("-").map(Number);
    const delta = wall - Date.UTC(py, pm - 1, pd, p.hour, p.minute, p.second);
    if (!delta) break;
    result += delta;
  }
  if (wallCache.size > 128) wallCache.clear();
  wallCache.set(key, result);
  return result;
}
export function dayEnd(state: Pick<TrackingState, "dayKey" | "endTime" | "timeZone">): number {
  return wallClock(state.dayKey, state.endTime, state.timeZone);
}
/** The plan a timer runs by. */
export function dayPlan(state: Pick<TrackingState, "plan">): DayPlan {
  return state.plan ?? DEFAULT_PLAN;
}
export function dayStart(state: Pick<TrackingState, "dayKey" | "timeZone" | "plan">): number {
  return wallClock(state.dayKey, dayPlan(state).startTime, state.timeZone);
}
/** The whole day's work goal and idle allowance: the start–end window split by the ratio. */
export function dayBudget(state: Pick<TrackingState, "dayKey" | "endTime" | "timeZone" | "plan">): { workMs: number; idleMs: number } {
  const window = Math.max(0, dayEnd(state) - dayStart(state));
  const { workParts, idleParts } = dayPlan(state);
  const workMs = Math.round(window * workParts / (workParts + idleParts));
  return { workMs, idleMs: window - workMs };
}
/** Work still to track today. Idling never shrinks it: running out of idle time starts work instead. */
export function workLeftMs(state: TrackingState): number {
  return Math.max(0, dayBudget(state).workMs - state.workMs);
}
/**
 * Idle time still allowed: the allowance minus every untracked minute since
 * the day started. Work left plus idle left is the time left in the day. Goes
 * negative only when idle time ran out with nothing to work on.
 */
export function idleLeftMs(state: TrackingState, now = state.cursor): number {
  const elapsed = Math.max(0, Math.min(now, dayEnd(state)) - dayStart(state));
  return dayBudget(state).idleMs - Math.max(0, elapsed - state.workMs);
}
/** Whether work can be tracked now: inside the day, with work left to do. */
export function canTrackWork(state: TrackingState, now = state.cursor): boolean {
  return now >= dayStart(state) && now < dayEnd(state) && workLeftMs(state) > EPSILON;
}
/** Idle time has run out with work still to do: work can't be paused. */
export function workRequired(state: TrackingState, now = state.cursor): boolean {
  return canTrackWork(state, now) && idleLeftMs(state, now) <= EPSILON;
}
/** Under half the idle allowance is left, work remains and there is a task to start: time to start. */
export function shouldStartWorking(state: TrackingState, now = state.cursor): boolean {
  return state.mode === "idle" && canTrackWork(state, now) && idleLeftMs(state, now) < dayBudget(state).idleMs / 2 && nextTask(state) !== undefined;
}
/**
 * Alerts belong to the device that last started, paused or reset the timer.
 * Idle reminders and the automatic start come due without anyone pressing
 * anything, so until a device has, every device alerts.
 */
export function ownsAlerts(state: Pick<TrackingState, "controllerId">, controllerId: string): boolean {
  return state.controllerId === null || state.controllerId === controllerId;
}
/** Kept for the "Work left" displays: work still to track today. */
export function remainingWorkTime(state: TrackingState): number {
  return workLeftMs(state);
}
export function workBudget(state: TrackingState): number {
  return dayBudget(state).workMs;
}

/** Fingerprint of everything that shapes the timer; any change means reconfiguring it. */
export function trackingConfigKey(tasks: Task[], endTime: string, plan: DayPlan = DEFAULT_PLAN, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): string {
  return JSON.stringify([endTime, unweighted, minimumEnabled, sanitizeMinimumMinutes(minimumMinutes), [plan.startTime, plan.workParts, plan.idleParts], tasks.map(t => [t.id, t.title, t.dueDate, t.priority ?? "low", t.completed, t.createdAt])]);
}

export function createTracking(tasks: Task[], endTime: string, timeZone = localTimeZone(), now = Date.now(), plan: DayPlan = DEFAULT_PLAN, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): TrackingState {
  timeZone = validTimeZone(timeZone);
  return {
    version: 1, allocationVersion: 2, revision: 0, dayKey: trackingDay(now, timeZone), timeZone,
    endTime, plan: { ...plan }, unweighted, minimumEnabled, minimumMinutes: sanitizeMinimumMinutes(minimumMinutes),
    cursor: now, tasks, taskMs: {}, workMs: 0, mode: "idle", taskId: null, controllerId: null,
  };
}

/**
 * Weighted water filling: the level at which sum(max(0, weight * level -
 * tracked)) = available. Tasks already above the level keep their logged time
 * but receive no more; the rest approach proportional totals. `open` must be
 * sorted by tracked / weight and hold only positive weights.
 */
function waterLevel(open: { weight: number; trackedMs: number }[], available: number): number {
  let level = 0, weight = 0, tracked = 0;
  for (let i = 0; i < open.length; i++) {
    weight += open[i].weight; tracked += open[i].trackedMs;
    level = (available + tracked) / weight;
    if (i + 1 === open.length || level <= open[i + 1].trackedMs / open[i + 1].weight) break;
  }
  return level;
}

/** Each task's share of the day's work goal, as daily targets. */
export function taskProgress(state: TrackingState): TaskProgress[] {
  const minimumMs = sanitizeMinimumMinutes(state.minimumMinutes) * 60_000;
  const entries = state.tasks.map((task, index) => ({
    task, index, weight: taskWeight(task, state.dayKey, state.unweighted),
    trackedMs: Object.hasOwn(state.taskMs, task.id) ? state.taskMs[task.id] : 0,
  }));
  const open = entries.filter(e => e.weight > 0);
  const byRatio = [...open].sort((a, b) => a.trackedMs / a.weight - b.trackedMs / b.weight);
  const remaining = entries.map(() => 0);
  const skipped = entries.map(() => false);
  const receives = entries.map(e => e.weight > 0);
  const pour = (available: number) => {
    const level = waterLevel(byRatio.filter(e => receives[e.index]), available);
    for (const e of open) if (receives[e.index]) remaining[e.index] = Math.max(0, e.weight * level - e.trackedMs);
  };
  pour(workLeftMs(state));
  // In both modes, least important first (lowest weight; among equal weights, lowest
  // on the list), skip each task whose day would total under the minimum. Its share goes
  // only to the tasks above it, never sideways to less urgent ones, and the
  // most important task is never skipped: there would be nowhere to send its
  // time. The day's total, not just what is left, decides — so a task is
  // never cut off in its last few minutes, and one with the minimum already
  // logged is never skipped.
  if (state.minimumEnabled !== false) {
    const ascending = [...open].sort((a, b) => a.weight - b.weight || compareListOrder(b.task, a.task) || b.index - a.index);
    for (const e of ascending.slice(0, -1)) {
      receives[e.index] = false;
      const freed = remaining[e.index];
      // Nothing left to give (the day's work is done, or it is past its share): done, not skipped.
      if (freed <= EPSILON || e.trackedMs + freed + EPSILON >= minimumMs) continue;
      skipped[e.index] = true;
      remaining[e.index] = 0;
      pour(freed + open.reduce((sum, o) => sum + (receives[o.index] ? remaining[o.index] : 0), 0));
    }
  }
  const keptWeight = open.reduce((sum, e) => sum + (skipped[e.index] ? 0 : e.weight), 0);
  return entries.map(({ task, index, weight, trackedMs }) => ({
    task, weight, trackedMs, minimumMs,
    probability: skipped[index] || keptWeight <= 0 ? 0 : weight / keptWeight,
    targetMs: trackedMs + remaining[index], remainingMs: remaining[index],
    doneToday: remaining[index] <= EPSILON, skipped: skipped[index],
  }));
}

/** Only used once to preserve elapsed history when upgrading a running timer. */
function legacyTaskProgress(state: TrackingState): TaskProgress[] {
  const entries = state.tasks.map(task => ({ task, weight: taskWeight(task, state.dayKey) }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const budget = state.workMs + Math.max(0, dayEnd(state) - state.cursor);
  return entries.map(entry => {
    const probability = total > 0 ? entry.weight / total : 0;
    const trackedMs = Object.hasOwn(state.taskMs, entry.task.id) ? state.taskMs[entry.task.id] : 0;
    const targetMs = probability * budget;
    return { ...entry, probability, trackedMs, targetMs, minimumMs: MIN_DAILY_TARGET_MS, remainingMs: Math.max(0, targetMs - trackedMs), doneToday: trackedMs + EPSILON >= targetMs, skipped: false };
  });
}
/**
 * The task the timer works on next, on Start, after each target and when idle
 * time runs out: the first unfinished one in list order. Weight decides how
 * much time a task gets, not when. The sort is stable, so full ties keep saved
 * order, as in the list.
 */
function nextTask(state: TrackingState, progressFor = taskProgress): TaskProgress | undefined {
  return progressFor(state).filter(p => p.weight > 0 && !p.doneToday)
    .sort((a, b) => compareListOrder(a.task, b.task))[0];
}
/** What to work on now: a task picked with Track until its target is met, otherwise the list's first. */
function workingTask(state: TrackingState, progressFor = taskProgress): TaskProgress | undefined {
  const chosen = state.chosen && progressFor(state).find(p => p.task.id === state.taskId && p.weight > 0 && !p.doneToday);
  return chosen || nextTask(state, progressFor);
}
/** Work on `task`, or go idle without one. A choice ends once the timer moves off it. */
function select(state: TrackingState, task: TaskProgress | undefined) {
  if (!task || task.task.id !== state.taskId) delete state.chosen;
  state.mode = task ? "work" : "idle"; state.taskId = task?.task.id ?? null;
}

/**
 * Integrate elapsed time exactly at task, goal, idle and day boundaries. This
 * same pure projection runs on the server, in the browser and after iOS wakes
 * up. No heartbeat or background JavaScript is needed to keep time accurately.
 */
function integrateTracking(original: TrackingState, now: number, progressFor: typeof taskProgress): { state: TrackingState; events: TrackingEvent[] } {
  const state: TrackingState = { ...original, taskMs: { ...original.taskMs }, mode: original.mode === "work" ? "work" : "idle" };
  const events: TrackingEvent[] = [];
  const emit = (type: TrackingEvent["type"], title: string, body: string, taskId = "", at = state.cursor) => {
    const event = { id: `${state.dayKey}:${Math.round(at)}:${type}:${taskId}`, at, type, title, body };
    events.push(event);
    return event;
  };
  if (!Number.isFinite(now) || now < state.cursor) return { state, events };
  // Never restart automatically on a new day, even if a client slept overnight.
  if (trackingDay(now, state.timeZone) !== state.dayKey) {
    return { state: { ...createTracking(state.tasks, state.endTime, state.timeZone, now, dayPlan(state), state.unweighted, state.minimumEnabled, state.minimumMinutes), revision: state.revision, controllerId: state.controllerId }, events };
  }
  const start = dayStart(state), end = dayEnd(state);
  const { workMs: goal, idleMs: allowance } = dayBudget(state);
  const until = Math.min(now, end);
  // Each pass ends at a task, goal, idle-allowance or day boundary.
  for (let guard = 0; guard < state.tasks.length * 2 + 20; guard++) {
    if (state.cursor >= until) break;
    if (state.mode === "work") {
      const current = state.cursor < start || goal - state.workMs <= EPSILON ? undefined : workingTask(state, progressFor);
      select(state, current);
      if (!current) continue;
      const elapsed = Math.min(until - state.cursor, current.remainingMs, goal - state.workMs);
      Object.defineProperty(state.taskMs, current.task.id, { value: current.trackedMs + elapsed, enumerable: true, writable: true, configurable: true });
      state.workMs += elapsed; state.cursor += elapsed;
      let completion: TrackingEvent | undefined;
      if (elapsed + EPSILON >= current.remainingMs) {
        completion = emit("task-complete", "Daily target reached", `${current.task.title} is complete for today.`, current.task.id);
        state.taskId = null; delete state.chosen;
      }
      if (goal - state.workMs <= EPSILON) {
        select(state, undefined);
        emit("work-complete", "Today’s work is done", `You tracked all ${formatDuration(goal)} of today’s work. The rest of the day is idle time.`);
      } else if (!state.taskId) {
        select(state, nextTask(state, progressFor));
      }
      if (completion) {
        // Describe the actual next step in the completion alert.
        const next = state.tasks.find(t => t.id === state.taskId);
        completion.body += state.cursor >= end ? " Tracking has stopped for today."
          : next ? ` Now tracking ${next.title}.` : " Today’s work is done.";
      }
      continue;
    }
    // Idle. Before the day starts nothing counts; once the work is done, the
    // rest of the day is simply idle.
    if (state.cursor < start) { state.cursor = Math.min(start, until); continue; }
    if (goal - state.workMs <= EPSILON) { state.cursor = until; break; }
    const next = nextTask(state, progressFor);
    const runsOut = state.cursor + Math.max(0, idleLeftMs(state, state.cursor));
    // Match the advice's strict "less than half" rule: alert at the first
    // millisecond below half, not while exactly half remains. Each reminder
    // belongs only to the stretch of idle time actually being crossed.
    const halfAt = Math.floor(runsOut - allowance / 2) + 1, soonAt = runsOut - 5 * 60_000;
    if (next && halfAt > state.cursor && halfAt <= until) {
      emit("idle-half", "Time to start working", `Less than half of today’s idle time is left. ${formatDuration(goal - state.workMs)} of work is left.`, "", halfAt);
    }
    if (next && soonAt > state.cursor && soonAt <= until) {
      emit("idle-soon", "Idle time ends in 5 minutes", "Tracking will then start on its own and can’t be paused until today’s work is done.", "", soonAt);
    }
    // With nothing to work on, idle time simply runs over.
    if (!next || runsOut > until) { state.cursor = until; break; }
    state.cursor = runsOut;
    select(state, next);
    emit("idle-out", "Idle time is up", `Now tracking ${next.task.title}. Work continues until today’s work is done.`);
  }
  if (now >= end && state.mode === "work") {
    state.cursor = Math.max(state.cursor, end);
    select(state, undefined);
    emit("day-end", "Work day complete", "Tracking has stopped for today.");
  }
  state.cursor = now;
  return { state, events: events.sort((a, b) => a.at - b.at) };
}

export function advanceTracking(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  if (original.allocationVersion === 2) return integrateTracking(original, now, taskProgress);
  // Old snapshots may be hours behind the live display. Integrate that elapsed
  // work with the old rule first; only future time uses the corrected targets.
  const result = integrateTracking(original, now, legacyTaskProgress);
  result.state.allocationVersion = 2;
  if (result.state.mode === "work") select(result.state, workingTask(result.state));
  return result;
}

/**
 * Preferences default to the timer's own, so task/end-time edits keep them.
 * A plan change keeps time already worked; the goal and allowance are simply
 * recalculated, so a smaller allowance can start work at once.
 */
export function configureTracking(original: TrackingState, tasks: Task[], endTime: string, now: number, plan: DayPlan = dayPlan(original), unweighted = original.unweighted ?? false, minimumEnabled = original.minimumEnabled ?? true, minimumMinutes = original.minimumMinutes ?? DEFAULT_MINIMUM_MINUTES): TrackingState {
  const state = advanceTracking(original, now).state;
  state.tasks = tasks; state.endTime = endTime; state.unweighted = unweighted; state.minimumEnabled = minimumEnabled; state.minimumMinutes = sanitizeMinimumMinutes(minimumMinutes);
  if (!state.plan || !samePlan(state.plan, plan)) state.plan = { ...plan };
  // An automatically picked task follows the list, so a new or moved task above it takes over.
  select(state, state.mode === "work" && canTrackWork(state, now) ? workingTask(state) : undefined);
  return state;
}

export function actOnTracking(original: TrackingState, action: TrackingAction, controllerId: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  state.controllerId = controllerId;
  if (action.type === "reset") {
    // A new checkpoint prevents any pre-reset elapsed time from being replayed.
    // The persistence layer increments the revision, just as for start/pause.
    return { ...createTracking(state.tasks, state.endTime, state.timeZone, now, dayPlan(state), state.unweighted, state.minimumEnabled, state.minimumMinutes), revision: state.revision, controllerId };
  }
  if (action.type === "pause") {
    if (state.mode === "work" && workRequired(state, now)) throw new Error("Idle time is used up, so work can’t be paused until today’s work is done.");
    select(state, undefined);
    return state;
  }
  if (now < dayStart(state)) throw new Error(`Your work day starts at ${dayPlan(state).startTime}.`);
  if (now >= dayEnd(state)) throw new Error("The work day has ended. Extend the end time or start tomorrow.");
  if (workLeftMs(state) <= EPSILON) throw new Error("Today’s work is done. The rest of the day is idle time.");
  const listed = nextTask(state);
  const next = action.taskId
    ? taskProgress(state).find(p => p.task.id === action.taskId && p.weight > 0 && !p.doneToday)
    : listed;
  if (!next) throw new Error("No unfinished daily target to track.");
  select(state, next);
  // Tracking the task the list would pick anyway keeps following the list.
  if (next.task.id !== listed?.task.id) state.chosen = true; else delete state.chosen;
  return state;
}

/** Predict OS notifications without depending on a live JavaScript timer. */
export function upcomingTrackingEvents(state: TrackingState, now: number): TrackingEvent[] {
  const current = advanceTracking(state, now).state;
  return advanceTracking(current, Math.max(now, dayEnd(current))).events.filter(e => e.at > now).slice(0, 60);
}
export function formatDuration(ms: number, seconds = false): string {
  // Allocations are compared with a 1 ms tolerance, so a share that comes to
  // 30 minutes less a millisecond (clock and floating-point rounding) counts
  // as 30 minutes. Display it the same way instead of flooring it to 29m.
  const total = Math.max(0, Math.floor((ms + EPSILON) / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  if (seconds) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/**
 * Guest storage is untrusted. Corrupt counters must never mint work time.
 * Timers saved by the break-based model load as idle, without their break
 * counters: rest was never work, and idle time is derived from the clock.
 */
export function parseTracking(value: unknown): TrackingState | null {
  if (!value || typeof value !== "object") return null;
  const s = value as TrackingState & Record<string, unknown>;
  if (s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Number.isFinite(s.cursor) || s.cursor < 0 || s.cursor > 8.64e15) return null;
  if (s.allocationVersion !== undefined && s.allocationVersion !== 2) return null;
  if (s.unweighted !== undefined && typeof s.unweighted !== "boolean") return null;
  if (s.minimumEnabled !== undefined && typeof s.minimumEnabled !== "boolean") return null;
  if (s.minimumMinutes !== undefined && (typeof s.minimumMinutes !== "number" || sanitizeMinimumMinutes(s.minimumMinutes) !== s.minimumMinutes)) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.dayKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.endTime)) return null;
  if (s.plan !== undefined && (!s.plan || typeof s.plan !== "object" || !samePlan(sanitizePlan(s.plan), s.plan))) return null;
  if (typeof s.timeZone !== "string" || validTimeZone(s.timeZone) !== s.timeZone || !Array.isArray(s.tasks) || s.tasks.length > 2000) return null;
  if (!s.taskMs || typeof s.taskMs !== "object" || Array.isArray(s.taskMs)) return null;
  if (!["idle", "work", "rest"].includes(s.mode)) return null;
  if (s.taskId !== null && typeof s.taskId !== "string") return null;
  if (s.chosen !== undefined && s.chosen !== true) return null;
  if (s.controllerId !== null && typeof s.controllerId !== "string") return null;
  if ([s.workMs, ...Object.values(s.taskMs)].some(v => !Number.isFinite(v) || v < 0 || v > 86_400_000)) return null;
  // Snapshots from before priorities existed carry none; those weigh as low.
  if (s.tasks.some(t => !t || typeof t.id !== "string" || typeof t.title !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) || typeof t.createdAt !== "string" || (t.priority !== undefined && !isPriority(t.priority)))) return null;
  const { restMs: _restMs, cycleWorkMs: _cycleWorkMs, cycleRestMs: _cycleRestMs, restWorkCreditMs: _credit, deferredBreak: _deferred, rest: _rest, chosen, ...current } = s;
  const working = s.mode === "work";
  return { ...current, mode: working ? "work" : "idle", taskId: working ? s.taskId : null, ...(working && chosen ? { chosen } : {}) } as TrackingState;
}
