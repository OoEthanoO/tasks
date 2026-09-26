import { useCallback, useEffect, useRef, useState } from "react";
import { createTracking, remainingWorkTime, taskProgress, trackingConfigKey, workBudget, type TrackingAction } from "../../lib/tracking";
import type { Task } from "../../lib/types";
import type { RestSettings } from "../../lib/rest";
import { defaults, type DesktopState } from "./contract";

const initial = (): DesktopState => ({ state: createTracking([], "23:00"), accountId: null, ready: false, busy: false, connected: true, error: null, message: null, settings: defaults });

export function useDesktopState() {
  const [value, setValue] = useState<DesktopState>(initial);
  useEffect(() => {
    let live = true;
    let received = false;
    const unsubscribe = window.desktop.subscribe(next => { received = true; if (live) setValue(next); });
    void window.desktop.snapshot().then(next => { if (live && !received) setValue(next); });
    const visible = () => { if (!document.hidden) void window.desktop.snapshot().then(next => { if (live) setValue(next); }); };
    document.addEventListener("visibilitychange", visible);
    return () => { live = false; unsubscribe(); document.removeEventListener("visibilitychange", visible); };
  }, []);
  return value;
}

// Reuses the task UI but not its browser timer. One main-process engine drives
// both windows, so a hidden/unresponsive renderer cannot stop desktop alerts.
export function useTracking(tasks: Task[], endTime: string, rest: RestSettings, accountId: string | null, enabled: boolean, beforeCommand?: () => Promise<void>) {
  const view = useDesktopState();
  const [localError, setError] = useState<string | null>(null);
  const config = useRef({ tasks, endTime, rest, accountId });
  config.current = { tasks, endTime, rest, accountId };
  const key = trackingConfigKey(tasks, endTime, rest);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void window.desktop.configure(config.current).then(() => { if (live) setError(null); }).catch(e => { if (live) setError(e.message); });
    return () => { live = false; };
  }, [key, accountId, enabled]);
  useEffect(() => {
    if (!view.accountId && view.ready) window.localStorage.setItem("yantasks.tracking.v1", JSON.stringify(view.state));
  }, [view.state.revision, view.state.dayKey, view.accountId, view.ready]);
  const command = useCallback(async (action: TrackingAction) => {
    setError(null);
    try { await beforeCommand?.(); await window.desktop.configure(config.current); await window.desktop.command(action); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not update tracking."); }
  }, [beforeCommand]);
  return {
    state: view.state, progress: taskProgress(view.state), budgetMs: workBudget(view.state), remainingWorkMs: remainingWorkTime(view.state),
    ready: enabled && view.ready && view.accountId === accountId, busy: view.busy, error: localError ?? view.error, message: view.message,
    permission: view.settings.alerts ? "Windows alerts enabled" : "Enable Windows alerts",
    notificationHelp: "Alerts continue in the system tray while this PC is awake. They follow the device that last started or switched tracking. Windows Do Not Disturb can silence them.",
    command, refresh: async () => { setError(null); await window.desktop.refresh(); },
    enableNotifications: async () => { await window.desktop.settings({ alerts: true }); await window.desktop.window("test-alert"); },
    dismissMessage: () => { void window.desktop.window("dismiss"); },
  };
}
