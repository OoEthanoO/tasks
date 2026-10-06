import { suggestedTask, turnLeftMs, type TaskProgress, type TrackingState } from "./tracking";

/** One minimal presentation for browser, iPhone and Windows. */
export function describeFocus(s: TrackingState, progress: TaskProgress[], ready: boolean) {
  const working = s.mode === "work", next = suggestedTask(s);
  const current = progress.find(p => p.task.id === s.taskId);
  const canStart = !!next;
  return {
    working, paused: !working, canStart, next, done: !canStart,
    label: !ready ? "LOADING…" : working ? "WORKING ON" : "UP NEXT",
    title: working ? current?.task.title ?? "Working" : next?.title ?? "No unfinished tasks.",
    clock: turnLeftMs(s), clockLabel: "Time left in this turn",
    hint: !ready ? "" : !canStart ? "Add a task to begin." : working ? "The next turn starts automatically. Pause whenever you need."
      : "One hour at a time, from top to bottom.",
  };
}
