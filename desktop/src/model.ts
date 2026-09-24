import { dayEnd, formatDuration, REST_CYCLE_MS, taskProgress, WORK_CYCLE_MS } from "../../lib/tracking";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state;
  const entries = taskProgress(s);
  const current = entries.find(p => p.task.id === s.taskId);
  const ended = s.cursor >= dayEnd(s);
  const label = !view.ready ? "Connecting" : s.mode === "work" ? "Working" : s.mode === "rest" ? "Resting" : ended ? "Day complete" : "Paused";
  const title = s.mode === "work" ? current?.task.title ?? "Task" : s.mode === "rest" ? "Take a breather" : ended ? "Done for today" : "Ready when you are";
  const remaining = s.mode === "rest" ? Math.max(0, REST_CYCLE_MS - s.cycleRestMs) : current?.remainingMs ?? 0;
  const elapsed = s.mode === "rest" ? s.cycleRestMs : current?.trackedMs ?? s.workMs;
  const progress = s.mode === "rest" ? s.cycleRestMs / REST_CYCLE_MS : current && current.targetMs > 0 ? current.trackedMs / current.targetMs : -1;
  const canStart = !ended && (s.cycleWorkMs >= WORK_CYCLE_MS || entries.some(p => p.weight > 0 && !p.doneToday));
  const restIn = Math.max(0, WORK_CYCLE_MS - s.cycleWorkMs);
  const caption = s.mode === "idle" ? `Worked ${formatDuration(s.workMs)}` : `${formatDuration(remaining, true)} left`;
  return { label, title, remaining, elapsed, progress: Math.max(-1, Math.min(1, progress)), canStart, restIn, entries,
    windowTitle: `${label} · ${title} · ${caption} — YanTasks`,
    tooltip: `${label}: ${title.slice(0, 42)}\n${caption} · Worked ${formatDuration(s.workMs)}\nRested ${formatDuration(s.restMs)} · Break in ${formatDuration(restIn)}`.slice(0, 127),
  };
}
