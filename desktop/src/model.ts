import { formatDuration, taskProgress } from "../../lib/tracking";
import { describeFocus } from "../../lib/focus";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state, entries = taskProgress(s), f = describeFocus(s, entries, view.ready);
  const current = entries.find(p => p.task.id === s.taskId);
  const label = !view.ready ? "Connecting" : f.working ? "Working" : !f.includedCount ? "Nothing due soon" : f.paused ? "Paused" : "Work done";
  const title = f.working ? current?.task.title ?? "Task" : !f.includedCount ? "No tasks in date range" : f.paused ? "Ready when you are" : "Done for today";
  const progress = current && current.targetMs > 0 ? current.trackedMs / current.targetMs : -1;
  return { label, title, remaining: f.workLeft, progress: Math.max(-1, Math.min(1, progress)), canStart: f.canStart, canPause: f.working,
    workLeft: f.workLeft, budgetMs: f.budgetMs, paused: f.paused, current, entries,
    windowTitle: `${label} · ${title} · ${formatDuration(f.workLeft, true)} work left — YanTasks`,
    tooltip: `${label}: ${title.slice(0, 42)}\nWork left ${formatDuration(f.workLeft)} · Goal ${formatDuration(f.budgetMs)}\nWorked ${formatDuration(s.workMs)}`.slice(0, 127),
  };
}
