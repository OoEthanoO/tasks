import { canTrackWork, dayEnd, formatDuration, workLeftMs, type TaskProgress, type TrackingState } from "./tracking";

/** Shared work-only presentation: a paused countdown never means logged work. */
export function describeFocus(s: TrackingState, progress: TaskProgress[], ready: boolean) {
  const current = progress.find(p => p.task.id === s.taskId);
  const working = s.mode === "work", ended = s.cursor >= dayEnd(s);
  const workLeft = workLeftMs(s), paused = !working && !ended;
  const canStart = canTrackWork(s) && progress.some(p => p.weight > 0 && !p.doneToday);
  const label = !ready ? "LOADING TIMER…" : ended ? "DAY COMPLETE" : working ? "WORKING ON" : "PAUSED";
  const title = ended ? "You’re done for today." : working ? current?.task.title ?? "Working" : canStart ? "Ready when you are." : "No unfinished tasks.";
  const clockLabel = working ? "Work time left today" : "Work time available — not tracking";
  const hint = !ready ? "" : ended ? "Your end time has been reached. Extend it to continue, or start fresh tomorrow."
    : working ? `Work time left today${current ? ` · ${formatDuration(current.remainingMs)} left on this task` : ""}`
    : canStart ? "No work is being tracked. Available time and task targets decrease until your end time. Choose Start working when you’re ready."
    : "Add an unfinished task to start tracking work.";
  return { working, paused, canStart, label, title, clock: workLeft, clockLabel, hint, workLeft };
}
