import type { Task } from "./types";
import { compareLegacyListOrder, compareListOrder } from "./grouping";
import { DEFAULT_PLAN, sanitizePlan, type DayPlan } from "./plan";
import { DEFAULT_MINIMUM_MINUTES } from "./minimum";
import * as legacy from "./legacy-tracking";
import * as paced from "./paced-tracking";

export { dayEnd, dayStart, dayPlan, formatDuration, localTimeZone, trackingDay, validTimeZone, ownsAlerts } from "./legacy-tracking";
export const TURN_MS = 60 * 60_000;
export const ROTATION_VERSION = 3;
export const RESET_PROGRESS_CONFIRMATION = "Clear today’s tracked time and pause tracking? Your tasks will stay unchanged.";
export type Rotation = {
  /** v1 used arbitrary starts; v2 aligned hours; v3 resets nightly and honors saved order. */
  version: 1 | 2 | 3;
  commandSeq: number;
  /** Actual milliseconds tracked today. Old v1/v2 totals are migrated on load. */
  totals: Record<string, number>;
  turn: { taskId: string; elapsedMs: number; durationMs: number } | null;
};
export type TrackingState = paced.TrackingState & { rotation?: Rotation };
export type TrackingAction = paced.TrackingAction;
export type TrackingEvent = paced.TrackingEvent;
export type TaskProgress = legacy.TaskProgress & {
  queuePosition: number; turnElapsedMs: number; turnDurationMs: number; partialTurn: boolean;
};
const EPSILON = 0.001;
const own = (values: Record<string, number>, id: string) => Object.hasOwn(values, id) ? values[id] : 0;
function put(values: Record<string, number>, id: string, value: number) {
  Object.defineProperty(values, id, { value, enumerable: true, configurable: true, writable: true });
}
function copy(original: TrackingState): TrackingState {
  return { ...original, taskMs: { ...original.taskMs }, ...(original.rotation ? { rotation: {
    ...original.rotation, totals: { ...original.rotation.totals }, turn: original.rotation.turn ? { ...original.rotation.turn } : null,
  } } : {}) };
}
export function rotationQueue(state: TrackingState): Task[] {
  const compare = (state.rotation?.version ?? 1) < ROTATION_VERSION ? compareLegacyListOrder : compareListOrder;
  return state.tasks.filter(t => !t.completed).sort(compare);
}
function pick(state: TrackingState, queue = rotationQueue(state)): { task: Task; durationMs: number } | null {
  if (!queue.length) return null;
  const totals = state.rotation?.totals ?? state.taskMs;
  const time = (i: number) => own(totals, queue[i].id);
  const aligned = (state.rotation?.version ?? 1) >= 2;
  let index = -1;
  // Repair rises first: new/reordered tasks catch up before another round.
  for (let i = 0; i < queue.length - 1; i++) {
    if (time(i) + EPSILON < time(i + 1)) {
      index = i;
      while (index > 0 && time(index) + EPSILON >= time(index - 1)) index--;
      break;
    }
  }
  if (index < 0) index = queue.findIndex((_, i) => i > 0 && (aligned
    ? time(i) + hourLeft(time(i)) <= time(i - 1) + EPSILON
    : time(i) + EPSILON < time(i - 1)));
  if (index < 0) index = 0;
  // Partial old turns/edits may leave a fractional gap. Never overshoot it.
  const quantum = aligned ? hourLeft(time(index)) : TURN_MS;
  return { task: queue[index], durationMs: index === 0 ? quantum : Math.min(quantum, time(index - 1) - time(index)) };
}
/** Credit all existing work toward this hour, including earlier partial turns. */
function hourElapsed(total: number): number {
  const elapsed = total % TURN_MS;
  return elapsed <= EPSILON || TURN_MS - elapsed <= EPSILON ? 0 : elapsed;
}
function hourLeft(total: number): number { return TURN_MS - hourElapsed(total); }
function beginTurn(state: TrackingState, queue = rotationQueue(state)) {
  const chosen = pick(state, queue);
  const elapsedMs = chosen && state.rotation!.version >= 2 ? hourElapsed(own(state.rotation!.totals, chosen.task.id)) : 0;
  state.rotation!.turn = chosen ? { taskId: chosen.task.id, elapsedMs, durationMs: elapsedMs + chosen.durationMs } : null;
  state.taskId = chosen?.task.id ?? null;
  if (!chosen) state.mode = "idle";
}
function nextMidnight(state: TrackingState): number {
  const tomorrow = new Date(Date.parse(state.dayKey + "T00:00:00Z") + 86_400_000).toISOString().slice(0, 10);
  return legacy.dayEnd({ ...state, dayKey: tomorrow, endTime: "00:00" });
}
function resetDay(state: TrackingState, now: number) {
  state.dayKey = legacy.trackingDay(now, state.timeZone);
  state.workMs = 0; state.taskMs = {};
  state.rotation!.totals = {}; state.rotation!.turn = null;
  state.mode = "idle"; state.taskId = null;
}
function upgrade(original: TrackingState, now: number): TrackingState {
  // Checkpoint elapsed time under the frozen OLD policy before changing rules.
  const checkpoint = original.pacing ? paced.advanceTracking : legacy.advanceTracking;
  const old = checkpoint(original, now).state as TrackingState;
  const state = copy(old);
  state.rotation = { version: ROTATION_VERSION, commandSeq: original.pacing?.commandSeq ?? 0, totals: { ...old.taskMs }, turn: null };
  delete state.pacing; delete state.chosen;
  // Historical weighted virtual-service scores are not actual work: never invent hours.
  if (old.dayKey !== original.dayKey) { state.mode = "idle"; state.taskId = null; }
  if (state.mode === "work") beginTurn(state);
  return state;
}
export function createTracking(tasks: Task[], endTime = "23:00", timeZone = legacy.localTimeZone(), now = Date.now(), plan: DayPlan = DEFAULT_PLAN, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): TrackingState {
  const state = legacy.createTracking(tasks, endTime, timeZone, now, plan, unweighted, minimumEnabled, minimumMinutes);
  return { ...state, rotation: { version: ROTATION_VERSION, commandSeq: 0, totals: {}, turn: null } };
}
/** Retired preferences stay in storage for compatibility, never in the picker. */
export function trackingConfigKey(tasks: Task[], _endTime?: string, _plan?: DayPlan, _unweighted?: boolean, _minimumEnabled?: boolean, _minimumMinutes?: number): string {
  return JSON.stringify(tasks.map(t => [t.id, t.title, t.description, t.dueDate, t.completed, t.createdAt]));
}
export function suggestedTask(state: TrackingState): Task | undefined {
  const turn = state.rotation?.turn;
  if (turn && turn.elapsedMs + EPSILON < turn.durationMs) {
    const task = state.tasks.find(t => t.id === turn.taskId && !t.completed);
    if (task) return task;
  }
  return pick(state)?.task;
}
export function turnLeftMs(state: TrackingState): number {
  const turn = state.rotation?.turn;
  return turn ? Math.max(0, turn.durationMs - turn.elapsedMs) : pick(state)?.durationMs ?? 0;
}
export function canTrackWork(state: TrackingState, _now = state.cursor): boolean { return state.tasks.some(t => !t.completed); }
// Compatibility for old adapters. No daily work target or idle budget.
export function workLeftMs(state: TrackingState, _now = state.cursor): number { return turnLeftMs(state); }
export const remainingWorkTime = workLeftMs;
export function workBudget(state: TrackingState): number { return turnLeftMs(state); }
export function dayBudget(state: TrackingState): { workMs: number; idleMs: number } { return { workMs: turnLeftMs(state), idleMs: 0 }; }
export function idleLeftMs(_state: TrackingState, _now = _state.cursor): number { return 0; }
export function shouldStartWorking(_state: TrackingState, _now = _state.cursor): boolean { return false; }
export function taskProgress(state: TrackingState): TaskProgress[] {
  const queue = rotationQueue(state), turn = state.rotation?.turn;
  const positions = new Map(queue.map((task, index) => [task.id, index + 1]));
  return state.tasks.map(task => {
    const trackedMs = own(state.rotation?.totals ?? state.taskMs, task.id), ownsTurn = turn?.taskId === task.id;
    const elapsedMs = ownsTurn ? turn.elapsedMs : (state.rotation?.version ?? 1) >= 2 ? hourElapsed(trackedMs) : 0;
    const durationMs = ownsTurn ? turn.durationMs : TURN_MS;
    const remainingMs = task.completed ? 0 : durationMs - elapsedMs;
    return { task, trackedMs, remainingMs, targetMs: trackedMs + remainingMs, turnElapsedMs: elapsedMs, turnDurationMs: durationMs,
      partialTurn: ownsTurn && elapsedMs > 0, queuePosition: positions.get(task.id) ?? 0,
      weight: task.completed ? 0 : 1, probability: 0, doneToday: task.completed, skipped: false, minimumMs: 0 };
  });
}
/** Timestamp projection shared by every client. Only explicit Start accrues time. */
export function advanceTracking(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  if (!Number.isFinite(now) || now < original.cursor) return { state: copy(original), events: [] };
  if (!original.rotation) return { state: upgrade(original, now), events: [] };
  if (original.rotation.version !== ROTATION_VERSION) {
    // First account for elapsed work using the exact old picker and turn.
    // Keep today's actual work, not yesterday's cumulative rotation progress.
    const state = advanceRotation(original, now).state;
    const paused = state.mode !== "work" || state.dayKey !== original.dayKey;
    state.rotation!.version = ROTATION_VERSION;
    state.rotation!.totals = { ...state.taskMs };
    beginTurn(state);
    if (paused) { state.mode = "idle"; state.taskId = null; }
    return { state, events: [] };
  }
  return advanceRotation(original, now);
}
function advanceRotation(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  const state = copy(original), events: TrackingEvent[] = [], queue = rotationQueue(state);
  const r = state.rotation!;
  if (state.mode === "work" && (!r.turn || !queue.some(t => t.id === r.turn!.taskId))) beginTurn(state, queue);
  while (state.mode === "work" && state.cursor < now) {
    const turn = r.turn!;
    const boundary = nextMidnight(state);
    const duration = Math.max(0, Math.min(now - state.cursor, turn.durationMs - turn.elapsedMs, boundary - state.cursor));
    state.workMs += duration;
    put(state.taskMs, turn.taskId, own(state.taskMs, turn.taskId) + duration);
    put(r.totals, turn.taskId, own(r.totals, turn.taskId) + duration);
    turn.elapsedMs += duration;
    state.cursor += duration;
    // Midnight takes precedence over a coinciding turn boundary: never announce
    // another task or silently track it into the next day.
    if (r.version === ROTATION_VERSION && state.cursor >= boundary) {
      resetDay(state, now);
      events.length = 0;
      break;
    }
    if (turn.durationMs - turn.elapsedMs <= EPSILON) {
      const completed = queue.find(t => t.id === turn.taskId)!;
      beginTurn(state, queue);
      const next = queue.find(t => t.id === state.taskId);
      events.push({ id: "rotation:" + r.commandSeq + ":" + Math.round(state.cursor) + ":" + completed.id + ":turn", at: state.cursor, type: "turn-complete",
        title: turn.durationMs < TURN_MS ? "Caught up" : "One-hour turn complete",
        body: next?.id === completed.id ? "Keep working on " + next.title + ". Another turn is tracking."
          : next ? "Now tracking " + next.title + "." : "All tasks are complete. Tracking is paused." });
      if (events.length > 64) events.shift();
    }
    if (state.cursor >= boundary) {
      state.dayKey = legacy.trackingDay(state.cursor, state.timeZone);
      state.workMs = 0; state.taskMs = {};
    }
  }
  state.cursor = now;
  const day = legacy.trackingDay(now, state.timeZone);
  if (day !== state.dayKey) {
    if (r.version === ROTATION_VERSION) { resetDay(state, now); events.length = 0; }
    else { state.dayKey = day; state.workMs = 0; state.taskMs = {}; }
  }
  return { state, events };
}
export function configureTracking(original: TrackingState, tasks: Task[], endTime: string, now: number, plan: DayPlan = legacy.dayPlan(original), unweighted = original.unweighted ?? false, minimumEnabled = original.minimumEnabled ?? true, minimumMinutes = original.minimumMinutes ?? DEFAULT_MINIMUM_MINUTES): TrackingState {
  const state = advanceTracking(original, now).state;
  const previousOrder = JSON.stringify(rotationQueue(state).map(t => t.id));
  state.tasks = tasks; state.endTime = endTime; state.plan = sanitizePlan(plan);
  state.unweighted = unweighted; state.minimumEnabled = minimumEnabled; state.minimumMinutes = minimumMinutes;
  if (previousOrder !== JSON.stringify(rotationQueue(state).map(t => t.id))) {
    const turn = state.rotation!.turn;
    // Evaluate eligibility at this turn's start. Otherwise adding an unrelated
    // later task would cut an ordinary in-progress hour short just because the
    // next task now has less time than the one currently being worked on.
    const atStart = copy(state);
    if (turn) put(atStart.rotation!.totals, turn.taskId, Math.max(0, own(atStart.rotation!.totals, turn.taskId) - turn.elapsedMs));
    const chosen = pick(atStart);
    if (!turn || chosen?.task.id !== turn.taskId || chosen.durationMs + EPSILON < turn.durationMs) {
      state.rotation!.turn = null;
      if (state.mode === "work") beginTurn(state); else state.taskId = null;
    }
  }
  return state;
}
export function actOnTracking(original: TrackingState, action: TrackingAction, controllerId: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  const r = state.rotation!;
  state.controllerId = controllerId; r.commandSeq++;
  if (action.type === "reset") {
    resetDay(state, now);
    return state;
  }
  if (action.type === "pause") { state.mode = "idle"; state.taskId = null; return state; }
  const task = suggestedTask(state);
  if (!task) throw new Error("No unfinished task to track.");
  // Old per-task/continue commands also use the picker; no bypass of ordering.
  if (!r.turn || r.turn.taskId !== task.id || r.turn.elapsedMs + EPSILON >= r.turn.durationMs) beginTurn(state);
  state.mode = "work"; state.taskId = state.rotation!.turn!.taskId;
  return state;
}
export function upcomingTrackingEvents(state: TrackingState, now: number): TrackingEvent[] {
  let current = advanceTracking(state, now).state;
  if (current.mode !== "work") return [];
  // Keep the FIRST upcoming boundaries even if many tiny catch-up gaps exist.
  const events: TrackingEvent[] = [];
  while (current.mode === "work" && events.length < 48) {
    const at = current.cursor + turnLeftMs(current);
    if (at <= current.cursor || at > now + 24 * TURN_MS) break;
    const next = advanceTracking(current, at);
    events.push(...next.events);
    current = next.state;
  }
  return events;
}
export function parseTracking(value: unknown): TrackingState | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as TrackingState;
  if (raw.rotation === undefined) return paced.parseTracking(value);
  const r = raw.rotation;
  const counters = (v: unknown, maxEntries: number) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length <= maxEntries &&
    Object.values(v).every(n => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= Number.MAX_SAFE_INTEGER);
  if (!r || ![1, 2, ROTATION_VERSION].includes(r.version) || !Number.isSafeInteger(r.commandSeq) || r.commandSeq < 0 || !counters(r.totals, 20_000)) return null;
  if (!counters(raw.taskMs, 20_000) || !Number.isFinite(raw.workMs) || raw.workMs < 0 || raw.workMs > 2 * 86_400_000) return null;
  if (r.turn !== null && (!r.turn || typeof r.turn.taskId !== "string" || !Number.isFinite(r.turn.durationMs) || r.turn.durationMs <= EPSILON || r.turn.durationMs > TURN_MS ||
    !Number.isFinite(r.turn.elapsedMs) || r.turn.elapsedMs < 0 || r.turn.elapsedMs > r.turn.durationMs)) return null;
  if (raw.mode === "work" && (!r.turn || r.turn.taskId !== raw.taskId)) return null;
  if (raw.pacing !== undefined) return null;
  // Validate the existing envelope, allowing a 25-hour DST day's daily counter.
  const envelope = legacy.parseTracking({ ...raw, workMs: 0, taskMs: {} });
  return envelope ? { ...envelope, workMs: raw.workMs, taskMs: { ...raw.taskMs }, rotation: { ...r, totals: { ...r.totals }, turn: r.turn ? { ...r.turn } : null } } : null;
}
