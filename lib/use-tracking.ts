import { DEFAULT_MINIMUM_MINUTES } from "./minimum";
import type * as React from "react";
import { api, ApiError } from "./remote";
import { Task } from "./types";
import type { DayPlan } from "./plan";
import { actOnTracking, advanceTracking, configureTracking, createTracking, dayPlan, idleLeftMs, localTimeZone, ownsAlerts, parseTracking, remainingWorkTime, taskProgress, trackingConfigKey, TrackingAction, TrackingEvent, TrackingState, upcomingTrackingEvents, workBudget } from "./tracking";

export const TRACKING_KEY = "yantasks.tracking.v1";
// Poll responses and UI ticks share one second boundary. A response arriving
// between ticks must not create an extra, short-lived countdown update.
const displayTime = (now: number) => Math.floor(now / 1000) * 1000;
export type TrackingAdapter = {
  read(): Promise<string | null>;
  write(value: string): Promise<void>;
  controllerId(): Promise<string>;
  notificationPermission(): Promise<string>;
  onForeground(listener: () => void): () => void;
  enableNotifications(): Promise<string>;
  scheduleNotifications(events: TrackingEvent[]): Promise<void>;
  notify(event: TrackingEvent): void;
};
type Hooks = Pick<typeof React, "useState" | "useRef" | "useCallback" | "useMemo"> & {
  useEffect: (effect: () => void | (() => void), deps?: readonly unknown[]) => void;
};

/** Inject React so Metro never resolves the web app's separate React copy. */
export function createTrackingHook({ useState, useRef, useEffect, useCallback, useMemo }: Hooks, adapter: TrackingAdapter) {
  return function useTracking(tasks: Task[], endTime: string, plan: DayPlan, accountId: string | null, enabled: boolean, beforeCommand: () => Promise<void>, unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES) {
    const [snapshot, setSnapshot] = useState<TrackingState | null>(null);
    const [clock, setClock] = useState(() => displayTime(Date.now()));
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [permission, setPermission] = useState("Checking alerts…");
    const [controller, setController] = useState("");
    const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
    const config = useRef({ tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes }); config.current = { tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes };
    const scope = useRef(0);
    const offset = useRef(0);
    const clockSynced = useRef(false);
    const foregroundClock = useRef<(() => void) | null>(null);
    const fetching = useRef(false);
    const commanding = useRef(false);
    const seen = useRef(new Set<string>());
    const lastCheck = useRef(Date.now());
    const permissionRead = useRef(0);

    useEffect(() => {
      let cancelled = false;
      const readPermission = async () => {
        const read = ++permissionRead.current;
        try {
          const label = await adapter.notificationPermission();
          if (!cancelled && read === permissionRead.current) setPermission(label);
        } catch {
          if (!cancelled && read === permissionRead.current) setPermission("Alerts unavailable — check device settings");
        }
      };
      void readPermission();
      const unsubscribe = adapter.onForeground(() => { void readPermission(); foregroundClock.current?.(); });
      return () => { cancelled = true; unsubscribe(); };
    }, []);

    const adopt = useCallback((value: TrackingState | null, serverNow?: number) => {
      // Reject stale replies before they can change the display's clock.
      if (value && snapshotRef.current && value.revision < snapshotRef.current.revision) return;
      // Calibrate once per account/session. Replacing this offset on every
      // poll makes variable response latency slow down or rewind the clock.
      if (serverNow !== undefined && !clockSynced.current) {
        offset.current = serverNow - Date.now(); clockSynced.current = true;
      }
      const next = value ?? createTracking(config.current.tasks, config.current.endTime, localTimeZone(), Date.now() + offset.current, config.current.plan, config.current.unweighted, config.current.minimumEnabled, config.current.minimumMinutes);
      // A slow poll must never replace a more recent command response.
      if (snapshotRef.current && next.revision < snapshotRef.current.revision) return;
      if (JSON.stringify(snapshotRef.current) !== JSON.stringify(next)) {
        if (next.mode === "idle" && next.workMs === 0) {
          // Also clear stale in-app alerts when another client resets the day.
          setMessage(null); seen.current.clear(); lastCheck.current = next.cursor;
        }
        snapshotRef.current = next;
        setSnapshot(next);
      }
      setClock(displayTime(Date.now() + offset.current)); setReady(true);
    }, []);

    const refresh = useCallback(async () => {
      if (!enabled || fetching.current || commanding.current) return;
      const token = scope.current;
      fetching.current = true;
      try {
        if (accountId) {
          const remote = await api.loadTracking();
          if (scope.current === token && !commanding.current) adopt(remote.tracking, remote.serverNow);
        } else {
          const raw = await adapter.read();
          let saved: TrackingState | null = null;
          try { saved = raw ? parseTracking(JSON.parse(raw)) : null; } catch { /* reset corrupt guest state */ }
          if (saved) {
            const advanced = advanceTracking(saved, Date.now()).state;
            if (advanced.dayKey !== saved.dayKey || advanced.allocationVersion !== saved.allocationVersion || advanced.idlePolicyVersion !== saved.idlePolicyVersion || advanced.workLimitVersion !== saved.workLimitVersion || saved.carryMs !== undefined) {
              saved = { ...advanced, revision: saved.revision + 1 };
              await adapter.write(JSON.stringify(saved));
            }
          }
          if (scope.current === token) adopt(saved);
        }
        if (scope.current === token) setError(null);
      } catch (e) {
        if (scope.current === token) setError(e instanceof Error ? e.message : "Could not sync the timer.");
      } finally { fetching.current = false; }
    }, [enabled, accountId, adopt]);

    useEffect(() => {
      scope.current++;
      snapshotRef.current = null; setSnapshot(null); setReady(false); setError(null);
      fetching.current = false; commanding.current = false; setBusy(false);
      offset.current = 0; clockSynced.current = false; seen.current.clear(); lastCheck.current = Date.now();
      let cancelled = false;
      void adapter.controllerId().then(id => { if (!cancelled) setController(id); });
      void refresh();
      const poll = setInterval(() => void refresh(), 3000);
      let tick: ReturnType<typeof setTimeout>;
      const repaint = () => {
        const now = Date.now() + offset.current;
        setClock(displayTime(now));
        clearTimeout(tick);
        tick = setTimeout(repaint, 1000 - now % 1000);
      };
      repaint();
      foregroundClock.current = () => { repaint(); void refresh(); };
      return () => { cancelled = true; scope.current++; foregroundClock.current = null; clearInterval(poll); clearTimeout(tick); void adapter.scheduleNotifications([]); };
    }, [refresh]);

    // Guest task edits use exactly the same checkpoint rule as account edits.
    useEffect(() => {
      const previous = snapshotRef.current;
      if (accountId || !ready || !previous) return;
      if (trackingConfigKey(previous.tasks, previous.endTime, dayPlan(previous), previous.unweighted, previous.minimumEnabled, previous.minimumMinutes) === trackingConfigKey(tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes)) return;
      const next = configureTracking(previous, tasks, endTime, Date.now(), plan, unweighted, minimumEnabled, minimumMinutes);
      next.revision++;
      adopt(next);
      void adapter.write(JSON.stringify(next)).catch(() => setError("Timer changes could not be saved on this device."));
    }, [tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes, accountId, ready, adopt]);

    const projected = useMemo(() => snapshot ? advanceTracking(snapshot, clock) : null, [snapshot, clock]);
    const state = projected?.state ?? createTracking(tasks, endTime, localTimeZone(), clock, plan, unweighted, minimumEnabled, minimumMinutes);
    const progress = useMemo(() => taskProgress(state), [state]);

    useEffect(() => {
      if (!snapshot || !controller) return;
      const events = ownsAlerts(snapshot, controller) ? upcomingTrackingEvents(snapshot, Date.now() + offset.current) : [];
      void adapter.scheduleNotifications(events).catch(() => setPermission("Alerts unavailable — check device settings"));
    }, [snapshot, controller, permission]);

    useEffect(() => {
      if (!projected) return;
      const fresh = projected.events.filter(e => !seen.current.has(e.id) && e.at >= lastCheck.current && e.at <= clock);
      for (const e of fresh) {
        seen.current.add(e.id);
        setMessage(`${e.title}. ${e.body}`);
        if (snapshot && ownsAlerts(snapshot, controller)) adapter.notify(e);
      }
      lastCheck.current = clock;
    }, [projected, clock, snapshot, controller]);

    const command = useCallback(async (action: TrackingAction) => {
      if (commanding.current || !snapshotRef.current || !enabled) return;
      const token = scope.current;
      commanding.current = true; setBusy(true); setError(null);
      try {
        await beforeCommand();
        if (scope.current !== token) return;
        if (accountId) {
          // Reload immediately before issuing a compare-and-swap command. Two
          // clients that race from here cannot both change the same revision.
          const remote = await api.loadTracking();
          if (scope.current !== token) return;
          const result = await api.track({ revision: remote.tracking?.revision ?? 0, action, controllerId: controller, timeZone: localTimeZone() });
          if (scope.current === token) adopt(result.tracking, result.serverNow);
        } else {
          const raw = await adapter.read();
          const previous = (raw && parseTracking(JSON.parse(raw))) || snapshotRef.current!;
          const configured = configureTracking(previous, config.current.tasks, config.current.endTime, Date.now(), config.current.plan, config.current.unweighted, config.current.minimumEnabled, config.current.minimumMinutes);
          const next = actOnTracking(configured, action, controller, Date.now());
          next.revision++;
          await adapter.write(JSON.stringify(next));
          if (scope.current === token) adopt(next);
        }
        // Like the desktop app, each command replaces the last notice.
        if (scope.current === token) {
          setMessage(action.type === "reset" ? "Today’s progress was reset. Tracking is paused." : null);
        }
      } catch (e) {
        if (scope.current === token) {
          // Ambiguous network failures never create a second local timer.
          setError(e instanceof Error ? e.message : "Could not update the timer.");
          if (e instanceof ApiError && e.status === 409) {
            const remote = await api.loadTracking().catch(() => null);
            if (remote && scope.current === token) adopt(remote.tracking, remote.serverNow);
          }
        }
      } finally { commanding.current = false; if (scope.current === token) setBusy(false); }
    }, [accountId, beforeCommand, controller, enabled, adopt]);

    const enableNotifications = useCallback(async () => {
      // An older startup/resume check must not replace the prompt's new result.
      permissionRead.current++;
      try {
        const label = await adapter.enableNotifications();
        permissionRead.current++; setPermission(label);
        const current = snapshotRef.current;
        if (current && ownsAlerts(current, controller)) await adapter.scheduleNotifications(upcomingTrackingEvents(current, Date.now() + offset.current));
      } catch { setPermission("Alerts unavailable — check device settings"); }
    }, [controller]);

    return { state, progress, budgetMs: workBudget(state), remainingWorkMs: remainingWorkTime(state), idleLeftMs: idleLeftMs(state), ready: ready && !!controller, busy, error, message, permission, command, refresh, enableNotifications, dismissMessage: () => setMessage(null) };
  };
}
