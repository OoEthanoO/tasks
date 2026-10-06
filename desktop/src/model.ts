import { canTrackWork, dayEnd, formatDuration, taskProgress, workLeftMs } from "../../lib/tracking";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state, entries = taskProgress(s), current = entries.find(p => p.task.id === s.taskId);
  const working = s.mode === "work", ended = s.cursor >= dayEnd(s), workLeft = workLeftMs(s);
  const canStart = canTrackWork(s) && entries.some(p => p.weight > 0 && !p.doneToday);
  const paused = !working && !ended;
  const label = !view.ready ? "Connecting" : ended ? "Day complete" : working ? "Working" : "Paused";
  const title = ended ? "Done for today" : working ? current?.task.title ?? "Task" : canStart ? "Ready when you are" : "No unfinished tasks";
  const progress = current && current.targetMs > 0 ? current.trackedMs / current.targetMs : -1;
  return { label, title, remaining: workLeft, progress: Math.max(-1, Math.min(1, progress)), canStart, canPause: working, workLeft, paused, current, entries,
    windowTitle: `${label} · ${title} · ${formatDuration(workLeft, true)} work left — YanTasks`,
    tooltip: `${label}: ${title.slice(0, 42)}\nWork left ${formatDuration(workLeft)} · Ends ${s.endTime}\nWorked ${formatDuration(s.workMs)}`.slice(0, 127),
  };
}
