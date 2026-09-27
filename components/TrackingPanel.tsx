"use client";
import { useEffect, useState } from "react";
import { dayEnd, formatDuration, RESET_PROGRESS_CONFIRMATION, restCycleMs, restOwed, restSettings, skipRestHint, workCycleMs } from "@/lib/tracking";
import { clampMinutes, REST_MINUTES, RestSettings, WORK_MINUTES } from "@/lib/rest";
import { MINIMUM_MINUTES } from "@/lib/minimum";
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

export default function TrackingPanel({ tracker: t, endTime, onEndTimeChange, rest, onRestChange, unweighted, onUnweightedChange, minimumEnabled, onMinimumChange, minimumMinutes, onMinimumMinutesChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void; rest: RestSettings; onRestChange: (value: RestSettings) => void;
  unweighted: boolean; onUnweightedChange: (value: boolean) => void;
  minimumEnabled: boolean; onMinimumChange: (value: boolean) => void;
  minimumMinutes: number; onMinimumMinutesChange: (value: number) => void;
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
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="focus-cutoff">Ends {endTime}</span></div>
      <div className="focus-label">{!t.ready ? "Loading timer…" : resting ? "RESTING" : s.mode === "work" ? "WORKING ON" : ended ? "DAY COMPLETE" : "PAUSED"}</div>
      <h3 className="focus-title">{resting ? "Take a breather." : current?.task.title ?? (ended ? "You’re done for today." : "Ready when you are.")}</h3>
      <div className="focus-clock" role="timer" aria-label={resting ? "Rest time remaining" : current ? "Time tracked on current task" : "Total work tracked today"}>
        {formatDuration(resting ? restCycleMs(s) - s.cycleRestMs : current?.trackedMs ?? s.workMs, true)}
      </div>
      <p className="hint">{resting ? "Rest time remaining · work resumes automatically" : current ? `${formatDuration(current.remainingMs)} left to today’s target` : "Start the first unfinished task, or choose one from your list."}</p>
      <button type="button" className="btn btn-primary focus-action" disabled={!t.ready || t.busy || (s.mode === "idle" && !canStart)} onClick={() => void t.command({ type: s.mode === "idle" ? "start" : "pause" })}>
        {t.busy ? "Syncing…" : s.mode === "idle" ? restOwed(s) ? "Resume rest" : "Start working" : "Pause tracking"}
      </button>
      {breakDue && <button type="button" className="btn btn-ghost skip-rest" disabled={!t.ready || t.busy} onClick={() => void t.command({ type: "skip-rest" })}>Skip break and keep working</button>}
      {breakDue && <p className="hint">{skipRestHint(s)}</p>}
      {restSettings(s).enabled && !restOwed(s) && <p className="break-preview">Rest after {formatDuration(workCycleMs(s) - s.cycleWorkMs)} more tracked work · {s.deferredBreak ? "pause to take the break you skipped" : `${restSettings(s).restMinutes}-minute breaks`}</p>}
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Rested today</span><strong>{formatDuration(s.restMs, true)}</strong></div>
        <div><span>Work left</span><strong>{t.ready ? formatDuration(t.remainingWorkMs) : "—"}</strong></div>
      </div>
      <details className="day-settings">
        <summary>
          <span><strong>Day settings</strong><span className="settings-summary">{unweighted ? "Equal weights" : "Weighted"} · {minimumEnabled ? `${minimumMinutes}m minimum` : "No minimum"} · {rest.enabled ? `${rest.workMinutes}/${rest.restMinutes} breaks` : "No breaks"}</span></span>
        </summary>
        <div className="settings-body">
          <div className="setting-row">
            <label htmlFor="end-time"><strong>Work day ends</strong><span className="setting-help">{t.ready ? s.timeZone : "Local time"}</span></label>
            <input id="end-time" type="time" className="input time-input" value={endTime} onChange={e => e.target.value && onEndTimeChange(e.target.value)} />
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
              <MinutesInput label="Minimum daily target in minutes" value={minimumMinutes} range={MINIMUM_MINUTES} onCommit={onMinimumMinutesChange} />
              <span>min per task</span><span className="setting-note">{minimumEnabled ? "First eligible task is always kept." : "Off — your value is saved for later."}</span>
            </div>
          </div>
          <div className="setting-section">
            <div className="setting-row">
              <label htmlFor="breaks-enabled"><strong>Take breaks</strong><span className="setting-help">Alternate tracked work with rest.</span></label>
              <input id="breaks-enabled" className="setting-check" type="checkbox" checked={rest.enabled} onChange={e => onRestChange({ ...rest, enabled: e.target.checked })} />
            </div>
            {rest.enabled && <div className="break-durations">
              <label><span>Work</span><span className="duration-field"><MinutesInput label="Minutes of work before each break" value={rest.workMinutes} range={WORK_MINUTES} onCommit={workMinutes => onRestChange({ ...rest, workMinutes })} /><span>min</span></span></label>
              <label><span>Rest</span><span className="duration-field"><MinutesInput label="Minutes of rest in each break" value={rest.restMinutes} range={REST_MINUTES} onCommit={restMinutes => onRestChange({ ...rest, restMinutes })} /><span>min</span></span></label>
            </div>}
          </div>
          <div className="setting-section">
            <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications()}>{t.permission}</button>
            <p className="setting-help">{("notificationHelp" in t && typeof t.notificationHelp === "string") ? t.notificationHelp : "Browser alerts need this page open. Phone alerts can fire while locked. Alerts follow the device that last started or switched tracking."}</p>
          </div>
          <div className="setting-section">
            <p className="tracking-explainer">Targets fit the work time left after breaks. Settings change future targets, never time already logged. Progress resets at midnight.</p>
            <button type="button" className="btn btn-ghost reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress…</button>
          </div>
          <p className="settings-save-note">Settings save automatically.</p>
        </div>
      </details>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
