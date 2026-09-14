import { Task } from "./types";
import { taskWeight, WeightedTask } from "./weights";

export const WORK_CYCLE_MS = 90 * 60_000;
export const REST_CYCLE_MS = 30 * 60_000;
const EPSILON = 1;
const formatters = new Map<string, Intl.DateTimeFormat>();
const endCache = new Map<string, number>();

/** One timestamp-based session, not one counter per device. */
export type TrackingState = {
  version: 1;
  revision: number;
  dayKey: string;
  timeZone: string;
  endTime: string;
  cursor: number;
  tasks: Task[];
  taskMs: Record<string, number>;
  workMs: number;
  restMs: number;
  cycleWorkMs: number;
  cycleRestMs: number;
  mode: "idle" | "work" | "rest";
  taskId: string | null;
  controllerId: string | null;
};
export type TrackingAction = { type: "start"; taskId?: string } | { type: "pause" };
export type TrackingEvent = {
  id: string;
  at: number;
  type: "task-complete" | "rest-soon" | "rest-start" | "rest-complete" | "day-end";
  title: string;
  body: string;
};
export type TaskProgress = WeightedTask & { trackedMs: number; targetMs: number; remainingMs: number; doneToday: boolean };

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

/** Resolve account wall-clock time, including DST, independently of the server's zone. */
export function dayEnd(state: Pick<TrackingState, "dayKey" | "endTime" | "timeZone">): number {
  const key = `${state.dayKey}/${state.endTime}/${state.timeZone}`;
  const cached = endCache.get(key);
  if (cached !== undefined) return cached;
  const [y, m, d] = state.dayKey.split("-").map(Number);
  const [h, minute] = state.endTime.split(":").map(Number);
  const wall = Date.UTC(y, m - 1, d, h, minute);
  let result = wall;
  for (let i = 0; i < 4; i++) {
    const p = dateParts(result, state.timeZone);
    const [py, pm, pd] = p.day.split("-").map(Number);
    const delta = wall - Date.UTC(py, pm - 1, pd, p.hour, p.minute, p.second);
    if (!delta) break;
    result += delta;
  }
  if (endCache.size > 128) endCache.clear();
  endCache.set(key, result);
  return result;
}

export function trackingConfigKey(tasks: Task[], endTime: string): string {
  return JSON.stringify([endTime, tasks.map(t => [t.id, t.title, t.dueDate, t.completed, t.createdAt])]);
}

export function createTracking(tasks: Task[], endTime: string, timeZone = localTimeZone(), now = Date.now()): TrackingState {
  timeZone = validTimeZone(timeZone);
  return {
    version: 1, revision: 0, dayKey: trackingDay(now, timeZone), timeZone,
    endTime, cursor: now, tasks, taskMs: {}, workMs: 0, restMs: 0,
    cycleWorkMs: 0, cycleRestMs: 0, mode: "idle", taskId: null, controllerId: null,
  };
}

export function workBudget(state: TrackingState, now = state.cursor): number {
  return state.workMs + Math.max(0, dayEnd(state) - now);
}
export function taskProgress(state: TrackingState, now = state.cursor): TaskProgress[] {
  const entries = state.tasks.map(task => ({ task, weight: taskWeight(task, state.dayKey) }));
  const total = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const budget = workBudget(state, now);
  return entries.map(entry => {
    const probability = total > 0 ? entry.weight / total : 0;
    const trackedMs = Object.hasOwn(state.taskMs, entry.task.id) ? state.taskMs[entry.task.id] : 0;
    const targetMs = probability * budget;
    return { ...entry, probability, trackedMs, targetMs, remainingMs: Math.max(0, targetMs - trackedMs), doneToday: trackedMs + EPSILON >= targetMs };
  });
}
function nextTask(state: TrackingState): TaskProgress | undefined {
  return taskProgress(state).filter(p => p.weight > 0 && !p.doneToday)
    .sort((a, b) => b.weight - a.weight || a.task.createdAt.localeCompare(b.task.createdAt) || state.tasks.indexOf(a.task) - state.tasks.indexOf(b.task))[0];
}

/**
 * Integrate elapsed time exactly at task/rest/end boundaries. This same pure
 * projection runs on the server, in the browser and after iOS wakes up. No
 * heartbeat or background JavaScript is needed to keep time accurately.
 */
export function advanceTracking(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  const state: TrackingState = { ...original, taskMs: { ...original.taskMs } };
  const events: TrackingEvent[] = [];
  const emit = (type: TrackingEvent["type"], title: string, body: string, taskId = "") => {
    events.push({ id: `${state.dayKey}:${Math.round(state.cursor)}:${type}:${taskId}`, at: state.cursor, type, title, body });
  };
  if (!Number.isFinite(now) || now < state.cursor) return { state, events };
  // Never restart automatically on a new day, even if a client slept overnight.
  if (trackingDay(now, state.timeZone) !== state.dayKey) {
    return { state: { ...createTracking(state.tasks, state.endTime, state.timeZone, now), revision: state.revision, controllerId: state.controllerId }, events };
  }
  const end = dayEnd(state);
  const until = Math.min(now, end);
  for (let guard = 0; guard < state.tasks.length * 2 + 100; guard++) {
    if (state.mode === "idle" || state.cursor >= until) break;
    if (state.mode === "rest") {
      const elapsed = Math.min(until - state.cursor, REST_CYCLE_MS - state.cycleRestMs);
      state.restMs += elapsed;
      state.cycleRestMs += elapsed;
      state.cursor += elapsed;
      if (state.cycleRestMs + EPSILON >= REST_CYCLE_MS) {
        state.cycleWorkMs = 0; state.cycleRestMs = 0;
        const next = nextTask(state);
        state.mode = next ? "work" : "idle"; state.taskId = next?.task.id ?? null;
        emit("rest-complete", "Rest complete", next ? `Now tracking ${next.task.title}.` : "All daily targets are met. Nice work.");
      }
      continue;
    }
    const current = taskProgress(state).find(p => p.task.id === state.taskId && p.weight > 0 && !p.doneToday) ?? nextTask(state);
    if (!current) { state.mode = "idle"; state.taskId = null; break; }
    state.taskId = current.task.id;
    const toRest = Math.max(0, WORK_CYCLE_MS - state.cycleWorkMs);
    const elapsed = Math.min(until - state.cursor, current.remainingMs, toRest);
    const previousCycle = state.cycleWorkMs;
    Object.defineProperty(state.taskMs, current.task.id, { value: current.trackedMs + elapsed, enumerable: true, writable: true, configurable: true });
    state.workMs += elapsed; state.cycleWorkMs += elapsed; state.cursor += elapsed;
    if (previousCycle < WORK_CYCLE_MS - 5 * 60_000 && state.cycleWorkMs >= WORK_CYCLE_MS - 5 * 60_000) {
      const warningAt = state.cursor - (state.cycleWorkMs - (WORK_CYCLE_MS - 5 * 60_000));
      events.push({ id: `${state.dayKey}:${Math.round(warningAt)}:rest-soon`, at: warningAt, type: "rest-soon", title: "Rest in 5 minutes", body: "Five more minutes of tracked work, then a 30-minute break." });
    }
    if (elapsed + EPSILON >= current.remainingMs) {
      emit("task-complete", "Daily target reached", `${current.task.title} is complete for today.`, current.task.id);
      state.taskId = null;
    }
    if (state.cycleWorkMs + EPSILON >= WORK_CYCLE_MS) {
      state.mode = "rest"; state.taskId = null;
      emit("rest-start", "Time to rest", "90 minutes of work complete. Now tracking a 30-minute break.");
    } else if (!state.taskId) {
      const next = nextTask(state);
      state.mode = next ? "work" : "idle"; state.taskId = next?.task.id ?? null;
    }
  }
  if (now >= end && state.mode !== "idle") {
    state.cursor = Math.max(state.cursor, end);
    state.mode = "idle"; state.taskId = null;
    emit("day-end", "Work day complete", "Tracking has stopped for today.");
  }
  state.cursor = now;
  return { state, events: events.sort((a, b) => a.at - b.at) };
}

export function configureTracking(original: TrackingState, tasks: Task[], endTime: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  state.tasks = tasks; state.endTime = endTime;
  if (now >= dayEnd(state)) { state.mode = "idle"; state.taskId = null; }
  if (state.mode === "work") {
    const current = taskProgress(state).find(p => p.task.id === state.taskId && p.weight > 0 && !p.doneToday);
    const next = current ?? nextTask(state);
    state.mode = next ? "work" : "idle"; state.taskId = next?.task.id ?? null;
  }
  return state;
}

export function actOnTracking(original: TrackingState, action: TrackingAction, controllerId: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  state.controllerId = controllerId;
  if (action.type === "pause") { state.mode = "idle"; state.taskId = null; return state; }
  if (now >= dayEnd(state)) throw new Error("The work day has ended. Extend the end time or start tomorrow.");
  // Pausing or switching devices cannot bypass a break already earned.
  if (state.cycleWorkMs + EPSILON >= WORK_CYCLE_MS) { state.mode = "rest"; state.taskId = null; return state; }
  const next = action.taskId
    ? taskProgress(state).find(p => p.task.id === action.taskId && p.weight > 0 && !p.doneToday)
    : nextTask(state);
  if (!next) throw new Error("No unfinished daily target to track.");
  state.mode = "work"; state.taskId = next.task.id;
  return state;
}

/** Predict OS notifications without depending on a live JavaScript timer. */
export function upcomingTrackingEvents(state: TrackingState, now: number): TrackingEvent[] {
  const current = advanceTracking(state, now).state;
  return advanceTracking(current, Math.max(now, dayEnd(current))).events.filter(e => e.at > now).slice(0, 60);
}
export function formatDuration(ms: number, seconds = false): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  if (seconds) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

/** Guest storage is untrusted. Corrupt counters must never mint work time. */
export function parseTracking(value: unknown): TrackingState | null {
  if (!value || typeof value !== "object") return null;
  const s = value as TrackingState;
  if (s.version !== 1 || !Number.isSafeInteger(s.revision) || s.revision < 0 || !Number.isFinite(s.cursor) || s.cursor < 0 || s.cursor > 8.64e15) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.dayKey) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.endTime)) return null;
  if (typeof s.timeZone !== "string" || validTimeZone(s.timeZone) !== s.timeZone || !Array.isArray(s.tasks) || s.tasks.length > 2000) return null;
  if (!s.taskMs || typeof s.taskMs !== "object" || Array.isArray(s.taskMs)) return null;
  if (!["idle", "work", "rest"].includes(s.mode)) return null;
  if (s.taskId !== null && typeof s.taskId !== "string") return null;
  if (s.controllerId !== null && typeof s.controllerId !== "string") return null;
  if ([s.workMs, s.restMs, s.cycleWorkMs, s.cycleRestMs, ...Object.values(s.taskMs)].some(v => !Number.isFinite(v) || v < 0 || v > 86_400_000)) return null;
  if (s.cycleWorkMs > WORK_CYCLE_MS || s.cycleRestMs > REST_CYCLE_MS) return null;
  if (s.tasks.some(t => !t || typeof t.id !== "string" || typeof t.title !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(t.dueDate) || typeof t.createdAt !== "string")) return null;
  return s;
}
