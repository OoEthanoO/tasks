import type { TrackingState } from "./legacy-tracking";
import { compareListOrder } from "./grouping";
import { diffDays } from "./dates";
import { taskWeight } from "./weights";

/**
 * Input-only compatibility with the retired date-range policy. Attribute the
 * elapsed part of an active session using its saved goal before restoring the
 * day-based budget. Never recompute that goal or apply the restored cutoff to
 * work that was already being tracked under the other policy.
 */
export function checkpointCoverage(original: TrackingState, now: number): TrackingState {
  const state = { ...original, taskMs: { ...original.taskMs } };
  const days = state.coverageDays ?? 7; // The first release had a fixed seven-day window.
  const goal = Math.max(state.workMs, state.coverageGoalMs!);
  const progress = () => {
    const entries = state.tasks.map(task => ({
      task,
      weight: !task.completed && diffDays(task.dueDate, state.dayKey) <= days ? taskWeight(task, state.dayKey) : 0,
      trackedMs: Object.hasOwn(state.taskMs, task.id) ? state.taskMs[task.id] : 0,
    }));
    const open = entries.filter(e => e.weight > 0).sort((a, b) => a.trackedMs / a.weight - b.trackedMs / b.weight);
    let level = 0, weight = 0, tracked = 0;
    for (let i = 0; i < open.length; i++) {
      weight += open[i].weight; tracked += open[i].trackedMs;
      level = (Math.max(0, goal - state.workMs) + tracked) / weight;
      if (i + 1 === open.length || level <= open[i + 1].trackedMs / open[i + 1].weight) break;
    }
    return entries.map(e => ({ ...e, remainingMs: e.weight > 0 ? Math.max(0, e.weight * level - e.trackedMs) : 0 }))
      .filter(e => e.weight > 0 && e.remainingMs > 1).sort((a, b) => compareListOrder(a.task, b.task));
  };
  const select = () => {
    const unfinished = progress();
    const current = (state.chosen && unfinished.find(e => e.task.id === state.taskId)) || unfinished[0];
    if (!current || current.task.id !== state.taskId) delete state.chosen;
    state.mode = current ? "work" : "idle"; state.taskId = current?.task.id ?? null;
    return current;
  };
  for (let guard = 0; guard < state.tasks.length + 2 && state.mode === "work" && state.cursor < now; guard++) {
    const current = select();
    if (!current) break;
    const elapsed = Math.min(now - state.cursor, current.remainingMs, Math.max(0, goal - state.workMs));
    Object.defineProperty(state.taskMs, current.task.id, { value: current.trackedMs + elapsed, enumerable: true, writable: true, configurable: true });
    state.workMs += elapsed; state.cursor += elapsed;
    if (elapsed + 1 >= current.remainingMs) { state.taskId = null; delete state.chosen; }
    if (goal - state.workMs <= 1) {
      state.mode = "idle"; state.taskId = null; delete state.chosen;
    } else if (!state.taskId) select();
  }
  state.cursor = now;
  delete state.coverageVersion; delete state.coverageGoalMs; delete state.coverageDays;
  return state;
}
