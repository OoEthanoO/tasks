"use client";
import { useEffect, useState } from "react";
import { dayEnd, formatDuration, RESET_PROGRESS_CONFIRMATION, REST_CYCLE_MS, WORK_CYCLE_MS } from "@/lib/tracking";
import { Tracker } from "./useTracking";
import ConfirmDialog from "./ConfirmDialog";

export default function TrackingPanel({ tracker: t, endTime, onEndTimeChange }: { tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void }) {
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const s = t.state;
  const current = t.progress.find(p => p.task.id === s.taskId);
  const resting = s.mode === "rest";
  const ended = s.cursor >= dayEnd(s);
  const canStart = !ended && (s.cycleWorkMs >= WORK_CYCLE_MS || t.progress.some(p => p.weight > 0 && !p.doneToday));
  return (
    <section className={`card tracking-card${resting ? " is-resting" : ""}`}>
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="hint">{s.timeZone}</span></div>
      <div className="tracking-controls">
        <label htmlFor="end-time">Work day ends at</label>
        <input id="end-time" type="time" className="input time-input" value={endTime} onChange={e => e.target.value && onEndTimeChange(e.target.value)} />
      </div>
      <div className="focus-label">{!t.ready ? "Loading timer…" : resting ? "RESTING" : s.mode === "work" ? "WORKING ON" : ended ? "DAY COMPLETE" : "PAUSED"}</div>
      <h3 className="focus-title">{resting ? "Take a breather." : current?.task.title ?? (ended ? "You’re done for today." : "Ready when you are.")}</h3>
      <div className="focus-clock" role="timer" aria-label={resting ? "Rest time remaining" : "Time tracked on current task"}>
        {formatDuration(resting ? REST_CYCLE_MS - s.cycleRestMs : current?.trackedMs ?? s.workMs, true)}
      </div>
      <p className="hint">{resting ? "Rest time remaining · work resumes automatically" : current ? `${formatDuration(current.remainingMs)} left to today’s target` : "Start with your highest-weight unfinished task, or choose one below."}</p>
      <button type="button" className="btn btn-primary focus-action" disabled={!t.ready || t.busy || (s.mode === "idle" && !canStart)} onClick={() => void t.command({ type: s.mode === "idle" ? "start" : "pause" })}>
        {t.busy ? "Syncing…" : s.mode === "idle" ? s.cycleWorkMs >= WORK_CYCLE_MS ? "Resume rest" : "Start working" : "Pause tracking"}
      </button>
      {!resting && s.cycleWorkMs < WORK_CYCLE_MS && <p className="hint">Rest after {formatDuration(WORK_CYCLE_MS - s.cycleWorkMs)} more tracked work · 30-minute breaks</p>}
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Rested today</span><strong>{formatDuration(s.restMs, true)}</strong></div>
        <div><span>Work budget</span><strong>{formatDuration(t.budgetMs)}</strong></div>
      </div>
      <button type="button" className="btn btn-danger reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress</button>
      <div className="tracking-explainer">Daily target = task share × (time until day end + work already tracked). Targets shrink while paused or resting. Time resets at midnight.</div>
      <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications()}>{t.permission}</button>
      <p className="hint">Browser alerts need this page open. Phone alerts can fire while locked. Alerts follow the device that last started or switched tracking.</p>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
