import { canTrackWork, dayBudget, dayEnd, dayStart, formatDuration, idleLeftMs, shouldStartWorking, taskProgress, workLeftMs, workRequired } from "../../lib/tracking";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state;
  const entries = taskProgress(s);
  const current = entries.find(p => p.task.id === s.taskId);
  const working = s.mode === "work";
  const before = s.cursor < dayStart(s), ended = s.cursor >= dayEnd(s);
  const workLeft = workLeftMs(s), idleLeft = Math.max(0, idleLeftMs(s));
  const done = !before && workLeft <= 0;
  // Idle time is used up: work can't be paused until today's work is done.
  const forced = working && workRequired(s);
  const label = !view.ready ? "Connecting" : before ? "Before your day" : ended ? "Day complete" : done ? "Work done"
    : working ? "Working" : "Idle";
  const title = working ? current?.task.title ?? "Task" : before ? "Your day hasn’t started" : ended || done ? "Done for today" : "Idle time";
  // The clock counts down whichever budget is being spent; before the day, the goal.
  const remaining = before ? dayBudget(s).workMs : working || done ? workLeft : idleLeft;
  const progress = current && current.targetMs > 0 ? current.trackedMs / current.targetMs : -1;
  const canStart = canTrackWork(s) && entries.some(p => p.weight > 0 && !p.doneToday);
  const canPause = working && !forced;
  const advise = shouldStartWorking(s);
  const caption = `${formatDuration(remaining, true)} ${working || done || before ? "work" : "idle"} left`;
  return { label, title, remaining, progress: Math.max(-1, Math.min(1, progress)), canStart, canPause, forced, advise, workLeft, idleLeft, current, entries,
    windowTitle: `${label} · ${title} · ${caption} — YanTasks`,
    tooltip: `${label}: ${title.slice(0, 42)}\nWork left ${formatDuration(workLeft)} · Idle left ${formatDuration(idleLeft)}\nWorked ${formatDuration(s.workMs)}`.slice(0, 127),
  };
}
