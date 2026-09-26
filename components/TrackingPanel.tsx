"use client";
import { useEffect, useState } from "react";
import { dayEnd, formatDuration, RESET_PROGRESS_CONFIRMATION, restCycleMs, restOwed, restSettings, skipRestHint, workCycleMs } from "@/lib/tracking";
import { clampMinutes, REST_MINUTES, RestSettings, WORK_MINUTES } from "@/lib/rest";
import { Tracker } from "./useTracking";
import ConfirmDialog from "./ConfirmDialog";

/** A whole-minutes field that commits on blur or Enter, so typing "25" never saves a passing "2". */
function MinutesInput({ label, value, range, onCommit }: { label: string; value: number; range: { min: number; max: number }; onCommit: (value: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const next = draft.trim() === "" ? value : clampMinutes(Number(draft), range, value);
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return <input type="number" className="input time-input minutes-input" aria-label={label} inputMode="numeric"
    min={range.min} max={range.max} step={1} value={draft} onChange={e => setDraft(e.target.value)} onBlur={commit}
    onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }} />;
}

export default function TrackingPanel({ tracker: t, endTime, onEndTimeChange, rest, onRestChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void; rest: RestSettings; onRestChange: (value: RestSettings) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const s = t.state;
  const current = t.progress.find(p => p.task.id === s.taskId);
  const resting = s.mode === "rest";
  const ended = s.cursor >= dayEnd(s);
  const canStart = !ended && (restOwed(s) || t.progress.some(p => p.weight > 0 && !p.doneToday));
  const breakDue = !ended && restOwed(s);
  return (
    <section className={`card tracking-card${resting ? " is-resting" : ""}`}>
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="hint">{s.timeZone}</span></div>
      <div className="tracking-controls">
        <label htmlFor="end-time">Work day ends at</label>
        <input id="end-time" type="time" className="input time-input" value={endTime} onChange={e => e.target.value && onEndTimeChange(e.target.value)} />
      </div>
      <div className="tracking-controls rest-controls">
        <label className="rest-toggle"><input type="checkbox" checked={rest.enabled} onChange={e => onRestChange({ ...rest, enabled: e.target.checked })} /> Breaks</label>
        {rest.enabled && <>
          <span>Work</span>
          <MinutesInput label="Minutes of work before each break" value={rest.workMinutes} range={WORK_MINUTES} onCommit={workMinutes => onRestChange({ ...rest, workMinutes })} />
          <span>min per</span>
          <MinutesInput label="Minutes of rest in each break" value={rest.restMinutes} range={REST_MINUTES} onCommit={restMinutes => onRestChange({ ...rest, restMinutes })} />
          <span>min of rest</span>
        </>}
      </div>
      <div className="focus-label">{!t.ready ? "Loading timer…" : resting ? "RESTING" : s.mode === "work" ? "WORKING ON" : ended ? "DAY COMPLETE" : "PAUSED"}</div>
      <h3 className="focus-title">{resting ? "Take a breather." : current?.task.title ?? (ended ? "You’re done for today." : "Ready when you are.")}</h3>
      <div className="focus-clock" role="timer" aria-label={resting ? "Rest time remaining" : "Time tracked on current task"}>
        {formatDuration(resting ? restCycleMs(s) - s.cycleRestMs : current?.trackedMs ?? s.workMs, true)}
      </div>
      <p className="hint">{resting ? "Rest time remaining · work resumes automatically" : current ? `${formatDuration(current.remainingMs)} left to today’s target` : "Start with the first unfinished task in your list, or choose one below."}</p>
      <button type="button" className="btn btn-primary focus-action" disabled={!t.ready || t.busy || (s.mode === "idle" && !canStart)} onClick={() => void t.command({ type: s.mode === "idle" ? "start" : "pause" })}>
        {t.busy ? "Syncing…" : s.mode === "idle" ? restOwed(s) ? "Resume rest" : "Start working" : "Pause tracking"}
      </button>
      {breakDue && <button type="button" className="btn btn-ghost skip-rest" disabled={!t.ready || t.busy} onClick={() => void t.command({ type: "skip-rest" })}>Skip break and keep working</button>}
      {breakDue && <p className="hint">{skipRestHint(s)}</p>}
      {restSettings(s).enabled && !restOwed(s) && <p className="hint">Rest after {formatDuration(workCycleMs(s) - s.cycleWorkMs)} more tracked work · {s.deferredBreak ? "pause to take the break you skipped" : `${restSettings(s).restMinutes}-minute breaks`}</p>}
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Rested today</span><strong>{formatDuration(s.restMs, true)}</strong></div>
        <div><span>Work left</span><strong>{formatDuration(t.remainingWorkMs)}</strong></div>
      </div>
      <button type="button" className="btn btn-danger reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress</button>
      <div className="tracking-explainer">Remaining targets fit the work time left after reserving breaks. Logged time stays fixed; unfinished targets balance by weight. Time resets at midnight.</div>
      <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications()}>{t.permission}</button>
      <p className="hint">{("notificationHelp" in t && typeof t.notificationHelp === "string") ? t.notificationHelp : "Browser alerts need this page open. Phone alerts can fire while locked. Alerts follow the device that last started or switched tracking."}</p>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
