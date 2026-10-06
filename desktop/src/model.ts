import { dayBudget, formatDuration, taskProgress, TURN_MS } from "../../lib/tracking";
import { describeFocus } from "../../lib/focus";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state;
  const entries = taskProgress(s);
  const f = describeFocus(s, entries, view.ready);
  const current = entries.find(p => p.task.id === s.taskId);
  const label = !view.ready ? "Connecting" : f.working ? "Working" : f.done ? "Enough for today" : "Paused";
  const progress = f.working ? (s.pacing?.turn?.elapsedMs ?? 0) / TURN_MS : -1;
  const goal = dayBudget(s).workMs;
  const caption = formatDuration(f.clock, true) + (f.working ? " turn left" : " recommended left");
  return { label, title: f.title, remaining: f.clock, progress: Math.max(-1, Math.min(1, progress)),
    canStart: f.canStart, canPause: f.working, workLeft: f.workLeft, paused: f.paused,
    current, entries, goal, done: f.done, hint: f.hint,
    windowTitle: label + " · " + f.title + " · " + caption + " — YanTasks",
    tooltip: (label + ": " + f.title.slice(0, 42) + "\nRecommended left " + formatDuration(f.workLeft) +
      "\nWorked " + formatDuration(s.workMs) + " / " + formatDuration(goal)).slice(0, 127),
  };
}
