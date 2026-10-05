import { canTrackWork, coverageCutoff, formatDuration, workBudget, workLeftMs, type TaskProgress, type TrackingState } from "./tracking";

/** Shared focus presentation for web, Windows and iPhone. */
export function describeFocus(s: TrackingState, progress: TaskProgress[], ready: boolean) {
  const current = progress.find(p => p.task.id === s.taskId);
  const working = s.mode === "work";
  const workLeft = workLeftMs(s), budgetMs = workBudget(s);
  const includedCount = progress.filter(p => p.weight > 0).length;
  const done = workLeft <= 1;
  const canStart = canTrackWork(s) && progress.some(p => p.weight > 0 && !p.doneToday);
  const paused = !working && !done;
  const label = !ready ? "LOADING TIMER…" : working ? "WORKING ON" : !includedCount ? "NOTHING DUE SOON" : done ? "WORK DONE" : "PAUSED";
  const title = working ? current?.task.title ?? "Working" : !includedCount ? "Your next seven days are clear."
    : done ? "Today’s targets are complete." : "Ready when you are.";
  const hint = !ready ? "" : working ? `Work time left today${current ? ` · ${formatDuration(current.remainingMs)} left on this task` : ""}`
    : !includedCount ? "Add a task due within seven days to create a work target."
    : done ? "All allocated work is tracked. Tomorrow’s targets reset at midnight."
    : "Start working or choose Track on a task. Pausing does not use up work time.";
  return { working, paused, canStart, label, title, clock: workLeft,
    clockLabel: paused ? "Work remaining — paused" : "Work remaining today",
    hint, workLeft, budgetMs, includedCount, cutoff: coverageCutoff(s) };
}
