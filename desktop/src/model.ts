import { formatDuration, taskProgress, TURN_MS } from "../../lib/tracking";
import { describeFocus } from "../../lib/focus";
import type { DesktopState } from "./contract";

export function statusModel(view: DesktopState) {
  const s = view.state;
  const entries = taskProgress(s);
  const f = describeFocus(s, entries, view.ready);
  const current = entries.find(p => p.task.id === s.taskId);
  const label = !view.ready ? "Connecting" : f.working ? "Working" : f.done ? "All done" : "Paused";
  const turn = s.rotation?.turn;
  const progress = f.working ? (turn?.elapsedMs ?? 0) / (turn?.durationMs || TURN_MS) : -1;
  const caption = formatDuration(f.clock, true) + " turn left";
  return { label, title: f.title, remaining: f.clock, progress: Math.max(-1, Math.min(1, progress)),
    canStart: f.canStart, canPause: f.working, paused: f.paused,
    current, entries, done: f.done, hint: f.hint, clockLabel: f.clockLabel,
    windowTitle: label + " · " + f.title + (f.done ? "" : " · " + caption) + " — YanTasks",
    tooltip: (label + ": " + f.title.slice(0, 42) + (f.done ? "" : "\n" + caption) +
      "\nWorked today " + formatDuration(s.workMs)).slice(0, 127),
  };
}
