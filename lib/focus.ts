import { borrowedDayName, borrowedMs, canTrackWork, dayBudget, dayEnd, dayPlan, dayStart, formatDuration, idleLeftMs, idleSource, shouldStartWorking, workLeftMs, type TaskProgress, type TrackingState } from "./tracking";

/** What the focus card shows, shared by the web and iPhone apps so their wording stays in step. */
export function describeFocus(s: TrackingState, progress: TaskProgress[], ready: boolean) {
  const current = progress.find(p => p.task.id === s.taskId);
  const working = s.mode === "work";
  const before = s.cursor < dayStart(s), ended = s.cursor >= dayEnd(s);
  const budget = dayBudget(s), workLeft = workLeftMs(s), idleLeft = Math.max(0, idleLeftMs(s));
  const done = !before && workLeft <= 0;
  const canStart = canTrackWork(s) && progress.some(p => p.weight > 0 && !p.doneToday);
  // Past today's allowance, untracked time comes out of later days' idle time.
  const source = working ? null : idleSource(s);
  const from = source ? borrowedDayName(source) : "tomorrow";
  const borrowed = borrowedMs(s);
  const borrowing = !working && canStart && idleLeftMs(s) <= 0;
  const carried = budget.carriedMs > 0 ? ` Today includes ${formatDuration(budget.carriedMs)} of work carried over.` : "";
  const label = !ready ? "LOADING TIMER…" : before ? "BEFORE YOUR DAY" : ended ? "DAY COMPLETE" : done ? "WORK DONE"
    : working ? "WORKING ON" : source ? `IDLE · FROM ${from.toUpperCase()}` : borrowing ? "IDLE · BORROWING" : "IDLE";
  const title = working ? current?.task.title ?? "Working" : before ? `Your day starts at ${dayPlan(s).startTime}.`
    : ended ? "You’re done for today." : done ? "Today’s work is done." : "Idle time";
  // The clock counts down whichever budget is being spent: work while
  // tracking, idle time otherwise (a later day's once today's is used).
  // Before the day starts it shows the goal.
  const clock = before ? budget.workMs : working || done ? workLeft : source ? source.idleLeftMs : borrowing ? borrowed : idleLeft;
  const clockLabel = working || done ? "Work time left today" : before ? "Today’s work goal" : source ? `Idle time left from ${from}` : borrowing ? "Idle time borrowed from future days" : "Idle time left today";
  const hint = !ready ? "" : before ? `${formatDuration(budget.workMs)} of work${budget.carriedMs > 0 ? ` (${formatDuration(budget.carriedMs)} carried over)` : ""} and ${formatDuration(budget.idleMs)} of idle time today.`
    : ended ? `Tracking has stopped for today.${borrowed >= 1000 ? ` ${formatDuration(borrowed)} of work carries over to tomorrow.` : ""}`
    : done ? "All of today’s work is tracked. The rest of the day is idle time."
    : working ? `Work time left today${current ? ` · ${formatDuration(current.remainingMs)} left on this task` : ""}`
    : source ? `Today’s idle time is used, so idle time now comes out of ${from}’s. Work you don’t finish today carries over.`
    : borrowing ? "Today’s idle time is used. Further idle time is borrowed from future days; work you don’t finish carries over."
    : canStart ? `Idle time left. When it runs out, idle time comes out of tomorrow’s.${carried}` : "Idle time left. Add a task to have work to track.";
  const advice = !shouldStartWorking(s) ? null
    : borrowing || budget.idleMs <= 0 ? "Today’s idle time is used up. Start working now."
    : "Less than half of today’s idle time is left. Start working now.";
  // Once any idle time is borrowed, show how much instead of today's (empty) allowance.
  const idleStat = borrowed >= 1000 ? { label: "Borrowed", value: borrowed } : { label: "Idle left", value: idleLeft };
  return { working, canStart, label, title, clock, clockLabel, hint, advice, workLeft, idleStat };
}
