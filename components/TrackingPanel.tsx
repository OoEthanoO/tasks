"use client";
import { useEffect, useState } from "react";
import { dayEnd, formatDuration, outingAdvice, RESET_PROGRESS_CONFIRMATION, TURN_MS } from "@/lib/tracking";
import { recommendDay } from "@/lib/pacing";
import { describeFocus } from "@/lib/focus";
import type { DayPlan } from "@/lib/plan";
import { Tracker } from "./useTracking";
import ConfirmDialog from "./ConfirmDialog";

export default function TrackingPanel({ tracker: t, endTime, onEndTimeChange }: {
  tracker: Tracker; endTime: string; onEndTimeChange: (value: string) => void;
  plan?: DayPlan; onPlanChange?: (value: DayPlan) => void;
  unweighted?: boolean; onUnweightedChange?: (value: boolean) => void;
  minimumEnabled?: boolean; onMinimumChange?: (value: boolean) => void;
  minimumMinutes?: number; onMinimumMinutesChange?: (value: number) => void;
}) {
  const [confirmReset, setConfirmReset] = useState(false);
  const [travel, setTravel] = useState(0), [reserved, setReserved] = useState(0);
  useEffect(() => { if (!t.ready) setConfirmReset(false); }, [t.ready]);
  const s = t.state, f = describeFocus(s, t.progress, t.ready);
  const calculation = recommendDay(s.tasks, s.dayKey);
  const last = s.tasks.find(task => task.id === s.pacing?.turn?.taskId && !task.completed);
  const offerContinue = !f.working && last && s.pacing?.turn && s.pacing.turn.elapsedMs >= TURN_MS && last.id !== f.next?.id;
  const outing = outingAdvice(s, s.cursor, travel, reserved);
  const clockTime = (at: number) => new Intl.DateTimeFormat(undefined, { timeZone: s.timeZone, hour: "numeric", minute: "2-digit" }).format(at);
  return (
    <section className={"card tracking-card" + (f.working ? "" : " is-idle")}>
      <div className="card-head"><h2 className="card-title">Today’s focus</h2><span className="focus-cutoff">30-minute turns</span></div>
      <div className="focus-label">{f.label}</div>
      <h3 className="focus-title">{f.title}</h3>
      <div className="focus-clock" role="timer" aria-label={f.clockLabel}>{formatDuration(f.clock, true)}</div>
      <p className="hint">{f.hint}</p>
      {f.advice && <div className="banner warn start-advice" role="status">{f.advice}</div>}
      <button type="button" className="btn btn-primary focus-action" disabled={!t.ready || t.busy || (!f.working && !f.canStart)}
        onClick={() => void t.command({ type: f.working ? "pause" : "start" })}>
        {t.busy ? "Syncing…" : f.working ? "Pause tracking" : f.done ? "Track extra work" : "Start suggested task"}
      </button>
      {offerContinue && <button type="button" className="btn focus-action" disabled={t.busy || !t.ready} onClick={() => void t.command({ type: "continue" })}>Continue {last.title}</button>}
      {t.error && <div className="banner danger" role="alert">{t.error} <button className="btn btn-ghost" onClick={() => void t.refresh()}>Refresh timer</button></div>}
      {t.message && <div className="banner ok" role="status">{t.message}<button className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button></div>}
      <div className="tracking-totals">
        <div><span>Worked today</span><strong>{formatDuration(s.workMs, true)}</strong></div>
        <div><span>Recommended left</span><strong>{t.ready ? formatDuration(f.workLeft) : "—"}</strong></div>
        <div><span>Today’s recommendation</span><strong>{t.ready ? f.goalText : "—"}</strong></div>
      </div>
      <details className="day-settings">
        <summary><span><strong>How today is calculated</strong><span className="settings-summary">Deadlines set the total · fair turns choose the tasks</span></span></summary>
        <div className="settings-body">
          <p className="tracking-explainer">Each unfinished task contributes 60 minutes ÷ (days until due + 1). Today and overdue count as zero days. Add them, round up to 30 minutes, and cap the recommendation at 3 hours. The same rule applies every day.</p>
          <p className="break-preview">{formatDuration(calculation.rawMs)} combined → {formatDuration(calculation.roundedMs)} rounded{calculation.capped ? " → 3h recommendation ceiling" : ""}.</p>
          {calculation.capped && <p className="hint">Task pressure exceeds the recommendation ceiling. This is pacing advice, not a guarantee of meeting every deadline. Extra work is optional.</p>}
          <p className="tracking-explainer">Every open task stays in the rotation. Near deadlines get a bounded boost, not exclusive access. Rotation position continues across days; only daily counters reset. Task-list changes can recalculate the total. Pausing never does.</p>
        </div>
      </details>
      <details className="day-settings">
        <summary><span><strong>Can I go out now?</strong><span className="settings-summary">Fit the remaining recommendation before bedtime</span></span></summary>
        <div className="settings-body">
          <div className="setting-row"><label htmlFor="outing-travel"><strong>Travel, total</strong><span className="setting-help">Outbound and return, in minutes.</span></label><input id="outing-travel" className="input time-input" type="number" min={0} max={1440} value={travel} onChange={e => setTravel(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))} /></div>
          <div className="setting-row"><label htmlFor="outing-reserved"><strong>Other time to reserve</strong><span className="setting-help">Meals, other commitments, and buffer, in minutes.</span></label><input id="outing-reserved" className="input time-input" type="number" min={0} max={1440} value={reserved} onChange={e => setReserved(Math.max(0, Math.min(1440, Number(e.target.value) || 0)))} /></div>
          <p className="break-preview">{s.mode === "work" ? "Pause tracking before leaving. " : ""}{s.cursor >= dayEnd(s) ? "It is already past your saved bedtime." : outing.availableMs > 0 ? "You can spend about " + formatDuration(outing.availableMs) + " there, leaving by " + clockTime(outing.latestReturn + travel * 60_000 / 2) + " if travel is split equally each way." : "There is no outing time left after the recommendation and the time you reserved."}</p>
          <p className="hint">Assumes you leave now and can use the remaining time for work. This checks today’s recommendation, not whether every task will be finished by its deadline. Nothing is booked or tracked automatically.</p>
        </div>
      </details>
      <details className="day-settings">
        <summary><span><strong>Settings</strong><span className="settings-summary">Bedtime and alerts · no idle allowance</span></span></summary>
        <div className="settings-body">
          <div className="setting-row"><label htmlFor="end-time"><strong>Bedtime</strong><span className="setting-help">Used for outing advice, not the work target. {s.timeZone}</span></label><input id="end-time" type="time" className="input time-input" value={endTime} onChange={e => e.target.value && onEndTimeChange(e.target.value)} /></div>
          <p className="tracking-explainer">Start and pause whenever you want. A completed turn pauses for your choice. Reaching the daily recommendation never marks a task complete; only its checkbox does. Extra tracking is always available.</p>
          <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications()}>{t.permission}</button>
          <p className="setting-help">{("notificationHelp" in t && typeof t.notificationHelp === "string") ? t.notificationHelp : "Browser alerts need this page open. Phone alerts can fire while locked. Alerts follow the device that last controlled tracking."}</p>
          <button type="button" className="btn btn-ghost reset-progress" disabled={!t.ready || t.busy} onClick={() => setConfirmReset(true)}>Reset today’s progress…</button>
        </div>
      </details>
      {confirmReset && <ConfirmDialog title="Reset today’s progress?" body={RESET_PROGRESS_CONFIRMATION} confirmLabel="Reset progress" cancelLabel="Keep progress" onCancel={() => setConfirmReset(false)} onConfirm={() => { setConfirmReset(false); void t.command({ type: "reset" }); }} />}
    </section>
  );
}
