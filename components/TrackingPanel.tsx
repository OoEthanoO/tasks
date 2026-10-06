"use client";
import { useEffect, useState } from "react";
import { formatDuration, RESET_PROGRESS_CONFIRMATION } from "@/lib/tracking";
import { describeFocus } from "@/lib/focus";
import { clampWhole, DayPlan } from "@/lib/plan";
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

export default function TrackingPanel({ tracker: t, endTime, onEndTimeChange, unweighted, onUnweightedChange, minimumEnabled, onMinimumChange, minimumMinutes, onMinimumMinutesChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void; plan: DayPlan; onPlanChange: (value: DayPlan) => void;
  unweighted: boolean; onUnweightedChange: (value: boolean) => void;
  minimumEnabled: boolean; onMinimumChange: (value: boolean) => void;
  minimumMinutes: number; onMinimumMinutesChange: (value: number) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const s = t.state;
  const f = describeFocus(s, t.progress, t.ready);
  const working = f.working;
  return (
    <section className={`card tracking-card${working ? "" : " is-idle"}`}>
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="focus-cutoff">Ends {endTime}</span></div>
      <div className="setting-row">
        <label htmlFor="end-time"><strong>Work ends at</strong><span className="setting-help">Time available until this end time · {s.timeZone}</span></label>
        <input id="end-time" type="time" required className="input time-input" value={endTime} onChange={e => e.target.value && onEndTimeChange(e.target.value)} />
      </div>
      <div className="focus-label">{f.label}</div>
      <h3 className="focus-title">{f.title}</h3>
      <div className="focus-clock" role="timer" aria-label={f.clockLabel}>
        {formatDuration(f.clock, true)}
      </div>
      <p className="hint">{f.hint}</p>
      <button type="button" className="btn btn-primary focus-action"
        disabled={!t.ready || t.busy || (!working && !f.canStart)} onClick={() => void t.command({ type: working ? "pause" : "start" })}>
        {t.busy ? "Syncing…" : working ? "Pause tracking" : "Start working"}
      </button>
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Work left</span><strong>{t.ready ? formatDuration(f.workLeft) : "—"}</strong></div>
      </div>
      <details className="day-settings">
        <summary>
          <span><strong>Day settings</strong><span className="settings-summary">{unweighted ? "Equal weights" : "Weighted"} · {minimumEnabled ? `${minimumMinutes}m minimum` : "No minimum"}</span></span>
        </summary>
        <div className="settings-body">
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
            <p className="tracking-explainer">Remaining targets shrink to fit the time until your day ends. Only explicit tracking adds worked time; pausing never does. Time already logged stays unchanged. Each day starts fresh at midnight.</p>
            <button type="button" className="btn btn-ghost reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress…</button>
          </div>
          <p className="settings-save-note">Settings save automatically.</p>
        </div>
      </details>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
