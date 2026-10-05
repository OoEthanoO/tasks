import { borrowedDayName, borrowedMs, canTrackWork, dayBudget, dayEnd, dayStart, formatDuration, idleLeftMs, idleSource, shouldStartWorking, taskProgress, workLeftMs } from "../../lib/tracking";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state;
  const entries = taskProgress(s);
  const current = entries.find(p => p.task.id === s.taskId);
  const working = s.mode === "work";
  const before = s.cursor < dayStart(s), ended = s.cursor >= dayEnd(s);
  const workLeft = workLeftMs(s), idleLeft = Math.max(0, idleLeftMs(s));
  const done = !before && workLeft <= 0;
  // Past today's allowance, untracked time comes out of later days' idle time.
  const source = working ? null : idleSource(s);
  const from = source ? borrowedDayName(source) : null;
  const borrowed = borrowedMs(s);
  const borrowing = !working && canTrackWork(s) && idleLeftMs(s) <= 0 && entries.some(p => p.weight > 0 && !p.doneToday);
  const label = !view.ready ? "Connecting" : before ? "Before your day" : ended ? "Day complete" : done ? "Work done"
    : working ? "Working" : "Idle";
  const title = working ? current?.task.title ?? "Task" : before ? "Your day hasn’t started" : ended || done ? "Done for today" : "Idle time";
  // The clock counts down whichever budget is being spent; before the day, the goal.
  const remaining = before ? dayBudget(s).workMs : working || done ? workLeft : source ? source.idleLeftMs : borrowing ? borrowed : idleLeft;
  const progress = current && current.targetMs > 0 ? current.trackedMs / current.targetMs : -1;
  const canStart = canTrackWork(s) && entries.some(p => p.weight > 0 && !p.doneToday);
  const canPause = working;
  const advise = shouldStartWorking(s);
  const clock = formatDuration(remaining, true);
  const caption = working || done || before ? `${clock} work left` : from ? `${clock} of ${from}’s idle time left` : borrowing ? `${clock} idle borrowed` : `${clock} idle left`;
  const idleText = borrowed >= 1000 ? `Borrowed ${formatDuration(borrowed)}` : `Idle left ${formatDuration(idleLeft)}`;
  return { label, title, remaining, progress: Math.max(-1, Math.min(1, progress)), canStart, canPause, advise, workLeft, idleLeft, borrowed, borrowing, from, current, entries,
    windowTitle: `${label} · ${title} · ${caption} — YanTasks`,
    tooltip: `${label}: ${title.slice(0, 42)}\nWork left ${formatDuration(workLeft)} · ${idleText}\nWorked ${formatDuration(s.workMs)}`.slice(0, 127),
  };
}
