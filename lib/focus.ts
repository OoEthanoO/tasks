import { dayBudget, dayEnd, formatDuration, suggestedTask, turnLeftMs, workLeftMs, type TaskProgress, type TrackingState } from "./tracking";

/** One presentation for browser, iPhone and Windows. Paused time is never work. */
export function describeFocus(s: TrackingState, progress: TaskProgress[], ready: boolean) {
  const working = s.mode === "work";
  const current = progress.find(p => p.task.id === s.taskId);
  const next = suggestedTask(s);
  const workLeft = workLeftMs(s), done = workLeft <= 0;
  const canStart = !!next;
  const label = !ready ? "LOADING TIMER…" : working ? "WORKING ON" : done && canStart ? "ENOUGH FOR TODAY" : "PAUSED";
  const title = working ? current?.task.title ?? "Working" : !canStart ? "No unfinished tasks." : done ? "Today’s recommendation is met." : "Next: " + next!.title;
  const clock = working ? Math.min(turnLeftMs(s), workLeft > 0 ? workLeft : Infinity) : workLeft;
  const clockLabel = working ? "Time left in this turn" : "Recommended work remaining — not tracking";
  const hint = !ready ? "" : working ? "Tracking only this task. At the end of this turn, tracking pauses for your choice."
    : !canStart ? "Add a task and due date to get a recommendation."
    : done ? "You can stop comfortably, or explicitly track extra work."
    : "Your target stays still while paused. Resume when you can work.";
  const available = Math.max(0, dayEnd(s) - s.cursor);
  const advice = workLeft > available && canStart ? "The recommendation no longer fits before bedtime. It won’t start tracking or carry missed minutes into tomorrow." : null;
  const idleStat = { label: "Recommended", value: dayBudget(s).workMs };
  return { working, paused: !working, canStart, label, title, clock, clockLabel, hint, advice, workLeft, idleStat,
    next, done, goalText: formatDuration(dayBudget(s).workMs) };
}
