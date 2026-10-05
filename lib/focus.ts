import { canTrackWork, dayBudget, dayEnd, dayPlan, dayStart, formatDuration, idleLeftMs, shouldStartWorking, workLeftMs, type TaskProgress, type TrackingState } from "./tracking";

/** What the focus card shows, shared by the web and iPhone apps so their wording stays in step. */
export function describeFocus(s: TrackingState, progress: TaskProgress[], ready: boolean) {
  const current = progress.find(p => p.task.id === s.taskId);
  const working = s.mode === "work";
  const before = s.cursor < dayStart(s), ended = s.cursor >= dayEnd(s);
  const budget = dayBudget(s), workLeft = workLeftMs(s), idleLeft = Math.max(0, idleLeftMs(s));
  const done = !before && workLeft <= 0;
  const canStart = canTrackWork(s) && progress.some(p => p.weight > 0 && !p.doneToday);
  const paused = !working && !before && !ended && !done && idleLeft <= 0;
  const label = !ready ? "LOADING TIMER…" : before ? "BEFORE YOUR DAY" : ended ? "DAY COMPLETE" : done ? "WORK DONE"
    : working ? "WORKING ON" : paused ? "PAUSED" : "IDLE";
  const title = working ? current?.task.title ?? "Working" : before ? `Your day starts at ${dayPlan(s).startTime}.`
    : ended ? "You’re done for today." : done ? "Today’s work is done." : paused ? "Ready when you are." : "Idle time";
  // Once idle is used, show the remaining work frozen until the user starts.
  const clock = before ? budget.workMs : working || done || paused ? workLeft : idleLeft;
  const clockLabel = paused ? "Work time left today — paused" : working || done ? "Work time left today" : before ? "Today’s work goal" : "Idle time left today";
  const hint = !ready ? "" : before ? `${formatDuration(budget.workMs)} of work and ${formatDuration(budget.idleMs)} of idle time today.`
    : ended ? "Tracking has stopped for today. Tomorrow starts fresh."
    : done ? "All of today’s work is tracked. The rest of the day is idle time."
    : working ? `Work time left today${current ? ` · ${formatDuration(current.remainingMs)} left on this task` : ""}`
    : paused ? "Idle time is used up. No work is being tracked. Choose Start working or Track when you’re ready."
    : canStart ? "Idle time left. When it runs out, tracking stays paused until you start working." : "Idle time left. Add a task to have work to track.";
  const advice = !shouldStartWorking(s) ? null
    : paused ? "Today’s idle time is used up. Start working now."
    : "Less than half of today’s idle time is left. Start working now.";
  const idleStat = { label: "Idle left", value: idleLeft };
  return { working, paused, canStart, label, title, clock, clockLabel, hint, advice, workLeft, idleStat };
}
