"use client";
import { useEffect, useState } from "react";
import { canTrackWork, dayBudget, dayEnd, dayStart, formatDuration, idleLeftMs, RESET_PROGRESS_CONFIRMATION, shouldStartWorking, workLeftMs, workRequired } from "@/lib/tracking";
import { clampWhole, DayPlan, SPLIT_PARTS } from "@/lib/plan";
import { MINIMUM_MINUTES } from "@/lib/minimum";
import { Tracker } from "./useTracking";
import ConfirmDialog from "./ConfirmDialog";

/** A whole-number field that commits on blur or Enter, so typing "25" never saves a passing "2". */
function WholeInput({ label, value, range, onCommit }: { label: string; value: number; range: { min: number; max: number }; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = draft.trim() === "" ? value : clampWhole(Number(draft), range, value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <input type="number" className="input time-input minutes-input" aria-label={label} inputMode="numeric"
    min={range.min} max={range.max} step={1} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

export default function TrackingPanel({ tracker: t, endTime, onEndTimeChange, plan, onPlanChange, unweighted, onUnweightedChange, minimumEnabled, onMinimumChange, minimumMinutes, onMinimumMinutesChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void; plan: DayPlan; onPlanChange: (value: DayPlan) => void;
  unweighted: boolean; onUnweightedChange: (value: boolean) => void;
  minimumEnabled: boolean; onMinimumChange: (value: boolean) => void;
  minimumMinutes: number; onMinimumMinutesChange: (value: number) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const s = t.state;
  const current = t.progress.find(p => p.task.id === s.taskId);
  const working = s.mode === "work";
  const before = s.cursor < dayStart(s), ended = s.cursor >= dayEnd(s);
  const workLeft = workLeftMs(s), idleLeft = Math.max(0, idleLeftMs(s)), budget = dayBudget(s);
  const done = !before && workLeft <= 0;
  const forced = working && workRequired(s);
  const advise = shouldStartWorking(s);
  const canStart = canTrackWork(s) && t.progress.some(p => p.weight > 0 && !p.doneToday);
  const label = !t.ready ? "Loading timer…" : before ? "BEFORE YOUR DAY" : ended ? "DAY COMPLETE" : done ? "WORK DONE"
    : working ? (forced ? "WORKING · IDLE TIME USED" : "WORKING ON") : "IDLE";
  const title = working ? current?.task.title ?? "Working" : before ? `Your day starts at ${plan.startTime}.`
    : ended ? "You’re done for today." : done ? "Today’s work is done." : "Idle time";
  // The clock counts down whichever budget is being spent: work while
  // tracking, idle time otherwise. Before the day starts it shows the goal.
  const clock = before ? budget.workMs : working || done ? workLeft : idleLeft;
  const hint = !t.ready ? "" : before ? `${formatDuration(budget.workMs)} of work and ${formatDuration(budget.idleMs)} of idle time today.`
    : ended ? "Tracking has stopped for today." : done ? "All of today’s work is tracked. The rest of the day is idle time."
    : forced ? "Idle time is used up, so tracking continues until today’s work is done."
    : working ? `Work time left today${current ? ` · ${formatDuration(current.remainingMs)} left on this task` : ""}`
    : canStart ? "Idle time left. When it runs out, work starts on its own." : "Idle time left. Add a task to have work to track.";
  // What the settings mean for an ordinary day, shown beside them.
  const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const dayMinutes = Math.max(0, minutesOf(endTime) - minutesOf(plan.startTime));
  const workMinutes = Math.round(dayMinutes * plan.workParts / (plan.workParts + plan.idleParts));
  const plannedWork = dayMinutes
    ? `${formatDuration(workMinutes * 60_000)} of work and ${formatDuration((dayMinutes - workMinutes) * 60_000)} of idle time a day.`
    : "The work day must start before it ends.";
  return (
    <section className={`card tracking-card${working ? "" : " is-idle"}`}>
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="focus-cutoff">{plan.startTime}–{endTime}</span></div>
      <div className="focus-label">{label}</div>
      <h3 className="focus-title">{title}</h3>
      <div className="focus-clock" role="timer" aria-label={working || done ? "Work time left today" : before ? "Today’s work goal" : "Idle time left today"}>
        {formatDuration(clock, true)}
      </div>
      <p className="hint">{hint}</p>
      {advise && <div className="banner warn start-advice" role="status">Less than half of today’s idle time is left. Start working now.</div>}
      <button type="button" className="btn btn-primary focus-action" title={forced ? "Idle time is used up, so work can’t be paused until today’s work is done." : undefined}
        disabled={!t.ready || t.busy || (working ? forced : !canStart)} onClick={() => void t.command({ type: working ? "pause" : "start" })}>
        {t.busy ? "Syncing…" : working ? "Pause tracking" : "Start working"}
      </button>
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Work left</span><strong>{t.ready ? formatDuration(workLeft) : "—"}</strong></div>
        <div><span>Idle left</span><strong>{t.ready ? formatDuration(idleLeft) : "—"}</strong></div>
      </div>
      <details className="day-settings">
        <summary>
          <span><strong>Day settings</strong><span className="settings-summary">{plan.workParts}:{plan.idleParts} work:idle · {unweighted ? "Equal weights" : "Weighted"} · {minimumEnabled ? `${minimumMinutes}m minimum` : "No minimum"}</span></span>
        </summary>
        <div className="settings-body">
          <div className="setting-row">
            <label htmlFor="start-time"><strong>Work day starts</strong><span className="setting-help">{t.ready ? s.timeZone : "Local time"}</span></label>
            <input id="start-time" type="time" className="input time-input" value={plan.startTime} onChange={e => e.target.value && onPlanChange({ ...plan, startTime: e.target.value })} />
          </div>
          <div className="setting-row">
            <label htmlFor="end-time"><strong>Work day ends</strong><span className="setting-help">Tracking stops here.</span></label>
            <input id="end-time" type="time" className="input time-input" value={endTime} onChange={e => e.target.value && onEndTimeChange(e.target.value)} />
          </div>
          <div className="setting-section">
            <div className="setting-row">
              <label><strong>Work : idle</strong><span className="setting-help">Untracked time is idle. 1:1 is recommended.</span></label>
            </div>
            <div className="break-durations split-fields">
              <label><span>Work</span><span className="duration-field"><WholeInput label="Work parts of the ratio" value={plan.workParts} range={SPLIT_PARTS} onCommit={workParts => onPlanChange({ ...plan, workParts })} /></span></label>
              <label><span>Idle</span><span className="duration-field"><WholeInput label="Idle parts of the ratio" value={plan.idleParts} range={SPLIT_PARTS} onCommit={idleParts => onPlanChange({ ...plan, idleParts })} /></span></label>
            </div>
            <p className="break-preview day-preview">{plannedWork}</p>
          </div>
          <div className="setting-section">
            <div className="setting-row">
              <label htmlFor="unweighted"><strong>Unweighted</strong><span className="setting-help" id="unweighted-hint">Give every open task equal weight.</span></label>
              <input id="unweighted" className="setting-check" type="checkbox" checked={unweighted} onChange={e => onUnweightedChange(e.target.checked)} aria-describedby="unweighted-hint" />
            </div>
            <div className="setting-row">
              <label htmlFor="minimum-enabled"><strong>Daily minimum</strong><span className="setting-help" id="minimum-hint">Redistribute targets below this length.</span></label>
              <input id="minimum-enabled" className="setting-check" type="checkbox" checked={minimumEnabled} onChange={e => onMinimumChange(e.target.checked)} aria-describedby="minimum-hint" />
            </div>
            <div className="setting-duration">
              <WholeInput label="Minimum daily target in minutes" value={minimumMinutes} range={MINIMUM_MINUTES} onCommit={onMinimumMinutesChange} />
              <span>min per task</span><span className="setting-note">{minimumEnabled ? "First eligible task is always kept." : "Off — your value is saved for later."}</span>
            </div>
          </div>
          <div className="setting-section">
            <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications()}>{t.permission}</button>
            <p className="setting-help">{("notificationHelp" in t && typeof t.notificationHelp === "string") ? t.notificationHelp : "Browser alerts need this page open. Phone alerts can fire while locked. Alerts follow the device that last started, paused or reset tracking; until one has, every device alerts."}</p>
          </div>
          <div className="setting-section">
            <p className="tracking-explainer">Targets divide today’s work time between your tasks. Settings change future targets, never time already logged. Progress resets at midnight.</p>
            <button type="button" className="btn btn-ghost reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress…</button>
          </div>
          <p className="settings-save-note">Settings save automatically.</p>
        </div>
      </details>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
