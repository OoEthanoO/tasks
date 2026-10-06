import { DEFAULT_MINIMUM_MINUTES } from "../../lib/minimum";
import { useCallback, useEffect, useRef, useState } from "react";
import { createTracking, taskProgress, trackingConfigKey, type TrackingAction } from "../../lib/tracking";
import type { Task } from "../../lib/types";
import type { DayPlan } from "../../lib/plan";
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
export function useTracking(tasks: Task[], endTime: string, plan: DayPlan, accountId: string | null, enabled: boolean, beforeCommand?: () => Promise<void>, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES) {
  const view = useDesktopState();
  const [localError, setError] = useState<string | null>(null);
  const config = useRef({ tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes, accountId });
  config.current = { tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes, accountId };
  const key = trackingConfigKey(tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes);
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
    state: view.state, progress: taskProgress(view.state),
    ready: enabled && view.ready && view.accountId === accountId, busy: view.busy, error: localError ?? view.error, message: view.message,
    permission: view.settings.alerts ? "Windows alerts enabled" : "Windows alerts disabled",
    // Shared UI renders this as a read-only Windows status. Keep its hook
    // contract without changing the user's saved notification preference.
    enableNotifications: async () => {},
    command, refresh: async () => { setError(null); await window.desktop.refresh(); },
    dismissMessage: () => { void window.desktop.window("dismiss"); },
  };
}
