// Frozen deadline-pacing policy, used only to checkpoint pre-rotation timers once.
import type { Task } from "./types";
import { compareListOrder } from "./grouping";
import { DEFAULT_PLAN, sanitizePlan, type DayPlan } from "./plan";
import { DEFAULT_MINIMUM_MINUTES } from "./minimum";
import * as legacy from "./legacy-tracking";
import { contributionMs, recommendDay, recommendationKey, rotationWeight, TURN_MS, DAILY_CAP_MS } from "./pacing";

export { dayEnd, dayStart, dayPlan, formatDuration, localTimeZone, trackingDay, validTimeZone, ownsAlerts, MIN_DAILY_TARGET_MS, skippedExplanation } from "./legacy-tracking";
export { TURN_MS } from "./pacing";
export const RESET_PROGRESS_CONFIRMATION = "Clear today’s tracked work? Tracking will pause on your synced devices. Your tasks, settings, and long-term rotation position stay unchanged. This cannot be undone.";
type Pacing = {
  version: 1;
  goalMs: number;
  goalKey: string;
  /** Distinguishes an explicit command from an automatic checkpoint at the same boundary. */
  commandSeq: number;
  /** Virtual service time: tracked milliseconds divided by the weight when served. */
  service: Record<string, number>;
  turn: { taskId: string; elapsedMs: number } | null;
};
export type TrackingState = legacy.TrackingState & { pacing?: Pacing };
export type TrackingAction = legacy.TrackingAction | { type: "continue" };
export type TrackingEvent = Omit<legacy.TrackingEvent, "type"> & { type: legacy.TrackingEvent["type"] | "turn-complete" };
export type TaskProgress = legacy.TaskProgress & { queuePosition?: number; contributionMs?: number; turnElapsedMs?: number; partialTurn?: boolean };
const EPSILON = 0.001;
const own = (values: Record<string, number>, id: string) => Object.hasOwn(values, id) ? values[id] : 0;
function put(values: Record<string, number>, id: string, value: number) {
  Object.defineProperty(values, id, { value, enumerable: true, configurable: true, writable: true });
}
function copy(original: TrackingState): TrackingState {
  return { ...original, taskMs: { ...original.taskMs }, ...(original.pacing ? { pacing: { ...original.pacing, service: { ...original.pacing.service }, turn: original.pacing.turn ? { ...original.pacing.turn } : null } } : {}) };
}
function reconcile(state: TrackingState) {
  const p = state.pacing!;
  const open = state.tasks.filter(t => !t.completed);
  const old = open.filter(t => Object.hasOwn(p.service, t.id)).map(t => p.service[t.id]);
  const floor = old.length ? Math.min(...old) : 0;
  // New tasks join at the current frontier, not with imaginary pre-creation debt.
  const service: Record<string, number> = {};
  for (const task of state.tasks) put(service, task.id, Math.max(0, (Object.hasOwn(p.service, task.id) ? p.service[task.id] : floor) - floor));
  p.service = service;
  if (p.turn && !open.some(t => t.id === p.turn!.taskId)) p.turn = null;
  const key = recommendationKey(state.tasks, state.dayKey);
  if (p.goalKey !== key) {
    p.goalKey = key;
    p.goalMs = recommendDay(state.tasks, state.dayKey).goalMs;
  }
}
function upgrade(original: TrackingState): TrackingState {
  const state = copy(original);
  const service: Record<string, number> = {};
  for (const task of state.tasks) put(service, task.id, own(state.taskMs, task.id) / (rotationWeight(task, state.dayKey) || 1));
  state.pacing = { version: 1, goalMs: 0, goalKey: "", commandSeq: 0, service, turn: state.mode === "work" && state.taskId ? { taskId: state.taskId, elapsedMs: 0 } : null };
  reconcile(state);
  return state;
}
export function createTracking(tasks: Task[], endTime: string, timeZone = legacy.localTimeZone(), now = Date.now(), plan: DayPlan = DEFAULT_PLAN, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): TrackingState {
  return upgrade(legacy.createTracking(tasks, endTime, timeZone, now, sanitizePlan(plan), unweighted, minimumEnabled, minimumMinutes));
}
/** Obsolete preferences remain readable for migrations, but do not change pacing. */
export function trackingConfigKey(tasks: Task[], endTime: string, _plan: DayPlan = DEFAULT_PLAN, _unweighted = false, _minimumEnabled = true, _minimumMinutes = DEFAULT_MINIMUM_MINUTES): string {
  return JSON.stringify([endTime, tasks.map(t => [t.id, t.title, t.description, t.dueDate, t.completed, t.createdAt])]);
}
export function dayBudget(state: TrackingState): { workMs: number; idleMs: number } {
  return { workMs: state.pacing?.goalMs ?? recommendDay(state.tasks, state.dayKey).goalMs, idleMs: 0 };
}
export function workLeftMs(state: TrackingState, _now = state.cursor): number { return Math.max(0, dayBudget(state).workMs - state.workMs); }
export const remainingWorkTime = workLeftMs;
export function workBudget(state: TrackingState): number { return dayBudget(state).workMs; }
/** Compatibility only: there is no idle allowance. */
export function idleLeftMs(_state: TrackingState, _now = _state.cursor): number { return 0; }
export function shouldStartWorking(_state: TrackingState, _now = _state.cursor): boolean { return false; }
/** Extra work stays trackable after the recommendation and bedtime. */
export function canTrackWork(state: TrackingState, _now = state.cursor): boolean { return state.tasks.some(t => !t.completed); }
export function turnLeftMs(state: TrackingState): number { return Math.max(0, TURN_MS - (state.pacing?.turn?.elapsedMs ?? 0)); }
export function rotationQueue(state: TrackingState): Task[] {
  return state.tasks.filter(t => !t.completed).sort((a, b) => {
    const difference = own(state.pacing?.service ?? {}, a.id) - own(state.pacing?.service ?? {}, b.id);
    return Math.abs(difference) > EPSILON ? difference : compareListOrder(a, b) || a.id.localeCompare(b.id);
  });
}
export function suggestedTask(state: TrackingState): Task | undefined {
  const turn = state.pacing?.turn;
  if (turn && turn.elapsedMs < TURN_MS - EPSILON) {
    const resume = state.tasks.find(t => t.id === turn.taskId && !t.completed);
    if (resume) return resume;
  }
  return rotationQueue(state)[0];
}
export function taskProgress(state: TrackingState): TaskProgress[] {
  const queue = rotationQueue(state), total = queue.reduce((sum, t) => sum + rotationWeight(t, state.dayKey), 0);
  const positions = new Map(queue.map((task, index) => [task.id, index + 1]));
  const workLeft = workLeftMs(state);
  return state.tasks.map(task => {
    const weight = rotationWeight(task, state.dayKey), trackedMs = own(state.taskMs, task.id);
    const ownsTurn = state.pacing?.turn?.taskId === task.id;
    const partialTurn = ownsTurn && (state.pacing?.turn?.elapsedMs ?? 0) > 0 && turnLeftMs(state) > EPSILON;
    const turnRemaining = ownsTurn && turnLeftMs(state) > 0 ? turnLeftMs(state) : TURN_MS;
    const remainingMs = task.completed ? 0 : state.mode === "work" && state.taskId === task.id
      ? Math.min(turnRemaining, workLeft > 0 ? workLeft : Infinity) : turnRemaining;
    return { task, weight, probability: total ? weight / total : 0, trackedMs, targetMs: trackedMs + remainingMs, remainingMs,
      doneToday: task.completed, skipped: false, minimumMs: 0, queuePosition: positions.get(task.id) ?? 0, contributionMs: contributionMs(task, state.dayKey),
      turnElapsedMs: ownsTurn ? state.pacing?.turn?.elapsedMs ?? 0 : 0, partialTurn };
  });
}
function midnight(state: TrackingState): number {
  const tomorrow = new Date(Date.parse(`${state.dayKey}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  return legacy.dayEnd({ ...state, dayKey: tomorrow, endTime: "00:00" });
}
/** Same timestamp projection on every client. No untracked work or automatic task switching. */
export function advanceTracking(original: TrackingState, now: number): { state: TrackingState; events: TrackingEvent[] } {
  if (!Number.isFinite(now) || now < original.cursor) return { state: copy(original), events: [] };
  if (!original.pacing) {
    // Freeze the old projection once before migration; never reinterpret earned work.
    return { state: upgrade(legacy.advanceTracking(original, now).state), events: [] };
  }
  const state = copy(original), events: TrackingEvent[] = [];
  const p = state.pacing!;
  const boundary = midnight(state);
  const until = Math.min(now, boundary);
  if (state.mode === "work") {
    const task = state.tasks.find(t => t.id === state.taskId && !t.completed);
    if (!task || !p.turn || p.turn.taskId !== task.id) { state.mode = "idle"; state.taskId = null; }
    else {
      const goalLeft = workLeftMs(state);
      const duration = Math.max(0, Math.min(until - state.cursor, turnLeftMs(state), goalLeft > EPSILON ? goalLeft : Infinity));
      state.workMs += duration;
      if (duration > 0) {
        put(state.taskMs, task.id, own(state.taskMs, task.id) + duration);
        put(p.service, task.id, own(p.service, task.id) + duration / rotationWeight(task, state.dayKey));
      }
      p.turn.elapsedMs += duration;
      state.cursor += duration;
      const goalReached = goalLeft > EPSILON && workLeftMs(state) <= EPSILON;
      const turnEnded = turnLeftMs(state) <= EPSILON;
      if (goalReached || turnEnded || state.cursor >= boundary) {
        state.mode = "idle"; state.taskId = null;
        const type = goalReached ? "work-complete" : turnEnded ? "turn-complete" : "day-end";
        const next = suggestedTask(state);
        events.push({ id: `${state.dayKey}:${Math.round(state.cursor)}:${type}:${task.id}`, at: state.cursor, type,
          title: goalReached ? "Enough for today" : turnEnded ? "30-minute turn complete" : "New day — tracking paused",
          body: goalReached ? "You’ve reached today’s recommendation. Tracking is paused; extra work is optional."
            : turnEnded ? `Tracking is paused. ${next ? `Next: ${next.title}. ` : ""}Choose your next task or continue this one.`
            : "Your rotation is saved. Start again when you’re ready." });
      }
    }
  }
  state.cursor = now;
  if (legacy.trackingDay(now, state.timeZone) !== state.dayKey) {
    state.dayKey = legacy.trackingDay(now, state.timeZone);
    state.workMs = 0; state.taskMs = {}; state.mode = "idle"; state.taskId = null;
    p.goalKey = "";
    reconcile(state);
  }
  return { state, events };
}
export function configureTracking(original: TrackingState, tasks: Task[], endTime: string, now: number, plan: DayPlan = legacy.dayPlan(original), unweighted = original.unweighted ?? false, minimumEnabled = original.minimumEnabled ?? true, minimumMinutes = original.minimumMinutes ?? DEFAULT_MINIMUM_MINUTES): TrackingState {
  const state = advanceTracking(original, now).state;
  const oldGoal = state.pacing!.goalMs;
  state.tasks = tasks; state.endTime = endTime; state.plan = sanitizePlan(plan);
  state.unweighted = unweighted; state.minimumEnabled = minimumEnabled; state.minimumMinutes = minimumMinutes;
  reconcile(state);
  if (state.mode === "work" && (!tasks.some(t => t.id === state.taskId && !t.completed) || (state.pacing!.goalMs < oldGoal && workLeftMs(state) <= EPSILON))) {
    state.mode = "idle"; state.taskId = null;
  }
  return state;
}
export function actOnTracking(original: TrackingState, action: TrackingAction, controllerId: string, now: number): TrackingState {
  const state = advanceTracking(original, now).state;
  state.controllerId = controllerId;
  state.pacing!.commandSeq++;
  if (action.type === "reset") {
    // A daily reset must not erase the service already given to tasks in the persistent rotation.
    state.workMs = 0; state.taskMs = {}; state.mode = "idle"; state.taskId = null; state.pacing!.turn = null;
    return state;
  }
  if (action.type === "pause") { state.mode = "idle"; state.taskId = null; return state; }
  const wanted = action.type === "continue" ? state.pacing!.turn?.taskId : action.taskId;
  const task = wanted ? state.tasks.find(t => t.id === wanted && !t.completed) : suggestedTask(state);
  if (!task) throw new Error("No unfinished task to track.");
  if (!state.pacing!.turn || state.pacing!.turn.taskId !== task.id || turnLeftMs(state) <= EPSILON) state.pacing!.turn = { taskId: task.id, elapsedMs: 0 };
  state.mode = "work"; state.taskId = task.id;
  return state;
}
export function upcomingTrackingEvents(state: TrackingState, now: number): TrackingEvent[] {
  const current = advanceTracking(state, now).state;
  if (current.mode !== "work") return [];
  return advanceTracking(current, Math.min(midnight(current), now + TURN_MS)).events.filter(e => e.at > now);
}
/** Outing advice reserves recommended work plus the user's travel/other commitments. */
export function outingAdvice(state: TrackingState, departure: number, travelMinutes = 0, otherMinutes = 0) {
  const latestReturn = legacy.dayEnd(state) - workLeftMs(state) - (Math.max(0, travelMinutes) + Math.max(0, otherMinutes)) * 60_000;
  return { latestReturn, availableMs: Math.max(0, latestReturn - departure), workLeftMs: workLeftMs(state) };
}
export function parseTracking(value: unknown): TrackingState | null {
  const state = legacy.parseTracking(value) as TrackingState | null;
  if (!state) return null;
  if (state.pacing !== undefined) {
    const p = state.pacing;
    if (!p || typeof p !== "object" || p.version !== 1 || !Number.isSafeInteger(p.commandSeq) || p.commandSeq < 0 || !Number.isFinite(p.goalMs) || p.goalMs < 0 || p.goalMs > DAILY_CAP_MS || typeof p.goalKey !== "string" || p.goalKey.length > 500_000) return null;
    if (!p.service || typeof p.service !== "object" || Array.isArray(p.service) || Object.keys(p.service).length > 2000 || Object.values(p.service).some(v => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER)) return null;
    if (p.turn !== null && (!p.turn || typeof p.turn.taskId !== "string" || !Number.isFinite(p.turn.elapsedMs) || p.turn.elapsedMs < 0 || p.turn.elapsedMs > TURN_MS)) return null;
    if (state.mode === "work" && (!p.turn || p.turn.taskId !== state.taskId)) return null;
  }
  return state;
}
