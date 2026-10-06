"use client";

import { describeFocus } from "@/lib/focus";
import { advanceTracking, formatDuration } from "@/lib/tracking";
import type { Tracker } from "./useTracking";

type PanelTracker = Pick<Tracker,
  "state" | "progress" | "ready" | "busy" | "error" | "message" |
  "permission" | "command" | "refresh" | "dismissMessage"
> & Partial<Pick<Tracker, "enableNotifications">>;

export default function TrackingPanel({ tracker: t }: { tracker: PanelTracker }) {
  const f = describeFocus(t.state, t.progress, t.ready);
  const current = t.progress.find(entry => entry.task.id === f.next?.id);
  // Preview the next boundary with the shared picker, including repeated catch-up turns.
  // This projection never changes the saved timer or sends a tracking command.
  const following = t.ready && f.canStart && t.state.rotation
    ? advanceTracking({ ...t.state, mode: "work" }, t.state.cursor + f.clock).state
    : null;
  const next = following?.tasks.find(task => task.id === following.taskId);
  const canEnableNotifications = typeof t.enableNotifications === "function" && t.permission === "Enable alerts";
  const permissionLabel = t.permission === "Alerts enabled"
    ? "Notifications enabled"
    : t.permission.startsWith("Alerts blocked")
      ? "Notifications blocked in this browser"
      : t.permission.startsWith("Browser alerts unsupported")
        ? "Browser notifications unavailable"
        : t.permission;

  return (
    <section className={`card tracking-card${f.working ? "" : " is-paused"}`} aria-label="Task timer">
      <div className="card-head">
        <h2 className="card-title">Current turn</h2>
        <span className="hint">1-hour turns</span>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <div className="focus-label">{f.label}</div>
        <h3 className="focus-title">{f.title}</h3>
      </div>
      <div className="focus-clock" role="timer" aria-live="off" aria-label={f.clockLabel}>
        {t.ready && !f.done ? formatDuration(f.clock, true) : "—"}
      </div>
      {t.ready && current && (f.working || current.partialTurn) && (
        <progress
          className="turn-progress"
          max={current.turnDurationMs}
          value={current.turnElapsedMs}
          aria-label="Current turn progress"
        />
      )}
      <p className="focus-hint">{f.hint}</p>
      <button
        type="button"
        className="btn btn-primary focus-action"
        aria-keyshortcuts="G"
        aria-busy={t.busy}
        disabled={!t.ready || t.busy || (!f.working && !f.canStart)}
        onClick={() => void t.command({ type: f.working ? "pause" : "start" })}
      >
        {f.working ? "Pause" : "Start"}
      </button>
      {next && (
        <p className="focus-next">Next · <span>{next.title}</span></p>
      )}
      {t.error && (
        <div className="banner danger" role="alert">
          <span>{t.error}</span>
          <button type="button" className="btn btn-ghost" disabled={t.busy} onClick={() => void t.refresh()}>
            Retry
          </button>
        </div>
      )}
      {t.message && (
        <div className="banner ok" role="status">
          <span>{t.message}</span>
          <button type="button" className="icon-btn" aria-label="Dismiss timer alert" onClick={t.dismissMessage}>×</button>
        </div>
      )}
      <div className="notification-action">
        {canEnableNotifications ? (
          <button type="button" className="btn btn-ghost" onClick={() => void t.enableNotifications?.()}>
            Enable notifications
          </button>
        ) : (
          <span className="hint" role="status">{permissionLabel}</span>
        )}
      </div>
    </section>
  );
}
