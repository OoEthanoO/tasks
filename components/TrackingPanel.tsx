"use client";
import { useEffect, useState } from "react";
import { formatDuration, RESET_PROGRESS_CONFIRMATION } from "@/lib/tracking";
import { describeFocus } from "@/lib/focus";
import { Tracker } from "./useTracking";
import ConfirmDialog from "./ConfirmDialog";

export default function TrackingPanel({ tracker: t }: { tracker: Tracker }) {
  const [confirmReset, setConfirmReset] = useState(false);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const s = t.state, f = describeFocus(s, t.progress, t.ready);
  return (
    <section className={`card tracking-card${f.working ? "" : " is-idle"}`}>
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="focus-cutoff">Due through {f.cutoff}</span></div>
      <div className="focus-label">{f.label}</div>
      <h3 className="focus-title">{f.title}</h3>
      <div className="focus-clock" role="timer" aria-label={f.clockLabel}>{formatDuration(f.clock, true)}</div>
      <p className="hint">{f.hint}</p>
      <button type="button" className="btn btn-primary focus-action"
        disabled={!t.ready || t.busy || (!f.working && !f.canStart)} onClick={() => void t.command({ type: f.working ? "pause" : "start" })}>
        {t.busy ? "Syncing…" : f.working ? "Pause tracking" : "Start working"}
      </button>
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Work left</span><strong>{t.ready ? formatDuration(f.workLeft) : "—"}</strong></div>
        <div><span>Daily goal</span><strong>{t.ready ? formatDuration(f.budgetMs) : "—"}</strong></div>
      </div>
      <p className="tracking-explainer">Weighted time for {f.includedCount} open {f.includedCount === 1 ? "task" : "tasks"} due within seven days, including overdue tasks. Every included task gets at least 30 minutes. Later tasks are excluded.</p>
      <details className="day-settings">
        <summary><span><strong>Tracking options</strong><span className="settings-summary">Alerts and progress</span></span></summary>
        <div className="settings-body">
          <div className="setting-section">
            <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications()}>{t.permission}</button>
            <p className="setting-help">{("notificationHelp" in t && typeof t.notificationHelp === "string") ? t.notificationHelp : "Browser alerts need this page open. Phone alerts can fire while locked. Completion alerts follow the device that last started, paused or reset tracking."}</p>
          </div>
          <div className="setting-section">
            <p className="tracking-explainer">Work is counted only while tracking. Task edits recalculate future targets without changing logged time. Daily totals reset at midnight ({s.timeZone}).</p>
            <button type="button" className="btn btn-ghost reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress…</button>
          </div>
        </div>
      </details>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
