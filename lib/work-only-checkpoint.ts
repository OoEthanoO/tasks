import type { TaskProgress, TrackingState } from "./tracking";
import { compareListOrder } from "./grouping";

/** Attribute an in-flight work-only interval before restoring day/ratio limits.
 * The caller checks the date and clock first. No notifications are replayed.
 * The same allocator is used with the retired policy's time-until-end budget.
 */
export function checkpointWorkOnly(original: TrackingState, now: number, end: number,
  allocate: (state: TrackingState, available: number) => TaskProgress[]): TrackingState {
  const state = { ...original, taskMs: { ...original.taskMs } };
  const progress = () => allocate(state, Math.max(0, end - state.cursor));
  const next = () => progress().filter(p => p.weight > 0 && !p.doneToday)
    .sort((a, b) => compareListOrder(a.task, b.task))[0];
  const working = () => (state.chosen && progress().find(p => p.task.id === state.taskId && p.weight > 0 && !p.doneToday)) || next();
  const select = (task: TaskProgress | undefined) => {
    if (!task || task.task.id !== state.taskId) delete state.chosen;
    state.mode = task ? "work" : "idle"; state.taskId = task?.task.id ?? null;
  };
  const until = Math.min(now, end);
  for (let guard = 0; guard < state.tasks.length * 2 + 20 && state.mode === "work" && state.cursor < until; guard++) {
    const current = working(); select(current);
    if (!current) break;
    const elapsed = Math.min(until - state.cursor, current.remainingMs);
    Object.defineProperty(state.taskMs, current.task.id, { value: current.trackedMs + elapsed, enumerable: true, writable: true, configurable: true });
    state.workMs += elapsed; state.cursor += elapsed;
    if (elapsed + 1 >= current.remainingMs) {
      state.taskId = null; delete state.chosen;
      select(end - state.cursor > 1 ? next() : undefined);
    }
  }
  if (now >= end) select(undefined);
  state.cursor = now;
  delete state.workOnlyVersion;
  return state;
}
