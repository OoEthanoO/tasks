import type * as React from "react";
import { api, ApiError } from "./remote";
import { Task } from "./types";
import { actOnTracking, advanceTracking, configureTracking, createTracking, localTimeZone, parseTracking, taskProgress, trackingConfigKey, TrackingAction, TrackingEvent, TrackingState, upcomingTrackingEvents, workBudget } from "./tracking";

export const TRACKING_KEY = "yantasks.tracking.v1";
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
  return function useTracking(tasks: Task[], endTime: string, accountId: string | null, enabled: boolean, beforeCommand: () => Promise<void>) {
    const [snapshot, setSnapshot] = useState<TrackingState | null>(null);
    const [clock, setClock] = useState(Date.now());
    const [ready, setReady] = useState(false);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [message, setMessage] = useState<string | null>(null);
    const [permission, setPermission] = useState("Checking alerts…");
    const [controller, setController] = useState("");
    const snapshotRef = useRef(snapshot); snapshotRef.current = snapshot;
    const config = useRef({ tasks, endTime }); config.current = { tasks, endTime };
    const scope = useRef(0);
    const offset = useRef(0);
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
      const unsubscribe = adapter.onForeground(() => void readPermission());
      return () => { cancelled = true; unsubscribe(); };
    }, []);

    const adopt = useCallback((value: TrackingState | null, serverNow?: number) => {
      if (serverNow !== undefined) offset.current = serverNow - Date.now();
      const next = value ?? createTracking(config.current.tasks, config.current.endTime, localTimeZone(), Date.now() + offset.current);
      // A slow poll must never replace a more recent command response.
      if (snapshotRef.current && next.revision < snapshotRef.current.revision) return;
      if (JSON.stringify(snapshotRef.current) !== JSON.stringify(next)) {
        if (next.mode === "idle" && next.workMs === 0 && next.restMs === 0) {
          // Also clear stale in-app alerts when another client resets the day.
          setMessage(null); seen.current.clear(); lastCheck.current = next.cursor;
        }
        snapshotRef.current = next;
        setSnapshot(next);
      }
      setClock(Date.now() + offset.current); setReady(true);
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
          if (saved && advanceTracking(saved, Date.now()).state.dayKey !== saved.dayKey) {
            saved = { ...advanceTracking(saved, Date.now()).state, revision: saved.revision + 1 };
            await adapter.write(JSON.stringify(saved));
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
      offset.current = 0; seen.current.clear(); lastCheck.current = Date.now();
      let cancelled = false;
      void adapter.controllerId().then(id => { if (!cancelled) setController(id); });
      void refresh();
      const poll = setInterval(() => void refresh(), 3000);
      const tick = setInterval(() => setClock(Date.now() + offset.current), 1000);
      return () => { cancelled = true; scope.current++; clearInterval(poll); clearInterval(tick); void adapter.scheduleNotifications([]); };
    }, [refresh]);

    // Guest task edits use exactly the same checkpoint rule as account edits.
    useEffect(() => {
      const previous = snapshotRef.current;
      if (accountId || !ready || !previous) return;
      if (trackingConfigKey(previous.tasks, previous.endTime) === trackingConfigKey(tasks, endTime)) return;
      const next = configureTracking(previous, tasks, endTime, Date.now());
      next.revision++;
      adopt(next);
      void adapter.write(JSON.stringify(next)).catch(() => setError("Timer changes could not be saved on this device."));
    }, [tasks, endTime, accountId, ready, adopt]);

    const projected = useMemo(() => snapshot ? advanceTracking(snapshot, clock) : null, [snapshot, clock]);
    const state = projected?.state ?? createTracking(tasks, endTime, localTimeZone(), clock);
    const progress = useMemo(() => taskProgress(state), [state]);

    useEffect(() => {
      if (!snapshot || !controller) return;
      const events = snapshot.controllerId === controller ? upcomingTrackingEvents(snapshot, Date.now() + offset.current) : [];
      void adapter.scheduleNotifications(events).catch(() => setPermission("Alerts unavailable — check device settings"));
    }, [snapshot, controller, permission]);

    useEffect(() => {
      if (!projected) return;
      const fresh = projected.events.filter(e => !seen.current.has(e.id) && e.at >= lastCheck.current && e.at <= clock);
      for (const e of fresh) {
        seen.current.add(e.id);
        setMessage(`${e.title}. ${e.body}`);
        if (snapshot?.controllerId === controller) adapter.notify(e);
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
          const configured = configureTracking(previous, config.current.tasks, config.current.endTime, Date.now());
          const next = actOnTracking(configured, action, controller, Date.now());
          next.revision++;
          await adapter.write(JSON.stringify(next));
          if (scope.current === token) adopt(next);
        }
        if (scope.current === token && action.type === "reset") {
          setMessage("Today’s progress was reset. Tracking is paused.");
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
        if (current?.controllerId === controller) await adapter.scheduleNotifications(upcomingTrackingEvents(current, Date.now() + offset.current));
      } catch { setPermission("Alerts unavailable — check device settings"); }
    }, [controller]);

    return { state, progress, budgetMs: workBudget(state), ready: ready && !!controller, busy, error, message, permission, command, refresh, enableNotifications, dismissMessage: () => setMessage(null) };
  };
}
