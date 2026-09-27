import { actOnTracking, advanceTracking, configureTracking, createTracking, localTimeZone, parseTracking, restSettings, SKIPPED_REST_MESSAGE, trackingConfigKey, type TrackingAction, type TrackingEvent, type TrackingState } from "../../lib/tracking";
import { sanitizeState } from "../../lib/app-state";
import { sameRest } from "../../lib/rest";
import type { ApiReply, DesktopState, GuestConfig, Settings } from "./contract";
import { defaults } from "./contract";
import type { AlertDiagnostic, Suppression } from "./diagnostics";

type Dependencies = {
  now: () => number;
  request: (path: string, method?: string, body?: unknown) => Promise<ApiReply>;
  saveGuest: (state: TrackingState) => void;
  notify: (event: TrackingEvent) => void;
  publish: (state: DesktopState) => void;
  diagnostic?: (record: AlertDiagnostic) => void;
};

/** Recover only elapsed transitions that the incoming checkpoint corroborates.
 * Task edits checkpoint elapsed time too, so metadata/revision need not match.
 * Reconfigure the projected state before comparing mode/task: an early
 * completion can legitimately reopen an earlier target. Elapsed counters still
 * have to match, so a reset/pause/manual switch cannot revive a prediction.
 */
function checkpointEvents(previous: TrackingState, next: TrackingState): { events: TrackingEvent[]; confirmed: boolean } {
  const projected = advanceTracking(previous, next.cursor);
  const rejected = { events: projected.events, confirmed: false };
  if (next.cursor <= previous.cursor || next.dayKey !== previous.dayKey || next.timeZone !== previous.timeZone ||
      next.controllerId !== previous.controllerId || !sameRest(restSettings(previous), restSettings(next))) return rejected;
  const expected = configureTracking(projected.state, next.tasks, next.endTime, next.cursor, restSettings(next), next.unweighted);
  if (expected.mode !== next.mode || expected.taskId !== next.taskId || expected.allocationVersion !== next.allocationVersion) return rejected;
  const equalTime = (a: number, b: number) => Math.abs(a - b) <= 1;
  for (const key of ["workMs", "restMs", "cycleWorkMs", "cycleRestMs"] as const) {
    if (!equalTime(expected[key], next[key])) return rejected;
  }
  if (!!expected.deferredBreak !== !!next.deferredBreak ||
      !equalTime(expected.deferredBreak?.cycleRestMs ?? 0, next.deferredBreak?.cycleRestMs ?? 0)) return rejected;
  for (const id of new Set([...Object.keys(expected.taskMs), ...Object.keys(next.taskMs)])) {
    const time = (s: TrackingState) => Object.hasOwn(s.taskMs, id) ? s.taskMs[id] : 0;
    if (!equalTime(time(expected), time(next))) return rejected;
  }
  const changedNextStep = projected.state.mode !== next.mode || projected.state.taskId !== next.taskId;
  const task = next.tasks.find(t => t.id === next.taskId);
  const nextStep = next.mode === "rest" ? `Now tracking a ${restSettings(next).restMinutes}-minute break.`
    : next.mode === "work" && task ? `Now tracking ${task.title}.` : "Tracking is paused.";
  return { confirmed: true, events: projected.events.map(event => changedNextStep && (event.type === "task-complete" || event.type === "rest-complete")
    ? { ...event, body: `${event.type === "task-complete" ? "A daily target was reached. " : ""}Targets were updated. ${nextStep}` }
    : event) };
}
// This runs in Electron's main process, not a background Chromium tab. Timers
// reconcile against the same CAS/revision API and pure time model as iOS/web.
export class TrackerEngine {
  private snapshot: TrackingState;
  private guest: TrackingState;
  private accountId: string | null = null;
  private epoch = 0;
  private offset = 0;
  private checkedAt = 0;
  private lastTick: number;
  private busy = false;
  private refreshing: Promise<void> | null = null;
  private ready = false;
  private error: string | null = null;
  private message: string | null = null;
  private delivered = new Set<string>();
  private diagnosticStatus = "";
  settings: Settings = { ...defaults };

  constructor(private d: Dependencies, readonly controllerId: string, saved?: unknown) {
    this.guest = parseTracking(saved) ?? createTracking([], "23:00", localTimeZone(), d.now());
    this.snapshot = this.guest;
    this.lastTick = d.now();
  }

  view(): DesktopState {
    return {
      state: advanceTracking(this.snapshot, this.d.now() + this.offset).state,
      accountId: this.accountId, ready: this.ready, busy: this.busy,
      error: this.error, message: this.message,
      connected: !this.accountId || this.d.now() - this.checkedAt < 90_000,
      settings: this.settings,
    };
  }
  publish() {
    const view = this.view();
    const status: AlertDiagnostic = {
      kind: "engine-status", scope: this.accountId ? "account" : "guest",
      owner: !this.snapshot.controllerId ? "unassigned" : this.snapshot.controllerId === this.controllerId ? "this-device" : "another-device",
      mode: view.state.mode, taskId: view.state.taskId, ready: this.ready,
      fresh: view.connected, busy: this.busy, alerts: this.settings.alerts, hasError: !!this.error,
    };
    const key = JSON.stringify(status);
    if (key !== this.diagnosticStatus) {
      this.diagnosticStatus = key;
      this.trace({ ...status, revision: this.snapshot.revision });
    }
    this.d.publish(view);
  }
  private trace(record: AlertDiagnostic) { try { this.d.diagnostic?.(record); } catch { /* Diagnostics cannot interrupt tracking. */ } }
  dismiss() { this.message = null; this.publish(); }
  report(error: string) { this.error = error; this.publish(); }

  async identity(id: string | null) {
    if (this.ready && id === this.accountId) return;
    this.epoch++;
    this.accountId = id;
    this.offset = 0; this.checkedAt = 0; this.error = null; this.message = null;
    this.delivered.clear();
    this.diagnosticStatus = "";
    this.ready = !id; this.busy = false;
    this.snapshot = id ? createTracking([], "23:00", localTimeZone(), this.d.now()) : this.guest;
    this.lastTick = this.d.now();
    this.refreshing = null;
    this.publish();
    if (id) await this.refresh();
  }

  configure(input: GuestConfig) {
    // The account identity comes only from authenticated API responses, not IPC.
    if (input.accountId !== this.accountId) throw new Error("Account changed. Reopen the task list to reconnect.");
    if (this.accountId) return;
    const clean = sanitizeState(input);
    if (trackingConfigKey(clean.tasks, clean.endTime, clean.rest, clean.unweighted) !== trackingConfigKey(this.snapshot.tasks, this.snapshot.endTime, restSettings(this.snapshot), this.snapshot.unweighted)) {
      const now = this.d.now(), previousTick = this.lastTick;
      const reason = this.suppression(now, previousTick);
      const next = configureTracking(this.snapshot, clean.tasks, clean.endTime, now, clean.rest, clean.unweighted);
      const recovered = checkpointEvents(this.snapshot, next);
      this.snapshot = next;
      this.snapshot.revision++;
      this.lastTick = now;
      this.deliver(recovered.events, previousTick, now, reason ?? (recovered.confirmed ? null : "checkpoint-replaced"), "guest-config");
      this.persist();
    }
    this.ready = true; this.publish();
  }

  private persist() {
    if (this.accountId) return;
    this.guest = this.snapshot;
    this.d.saveGuest(this.guest);
  }

  private adopt(value: unknown, serverNow: unknown) {
    const next = parseTracking(value);
    if (!next || typeof serverNow !== "number" || !Number.isFinite(serverNow)) throw new Error("The server returned an invalid timer.");
    if (next.revision < this.snapshot.revision) return;
    const previousTick = this.lastTick;
    // A refresh may arrive before the boundary wakeup. Reconcile both sides of
    // the checkpoint before replacing it, not just the new snapshot in tick().
    // Freshness is checked BEFORE refreshing checkedAt: reconnecting must not
    // replay alerts from a period when another device might have taken over.
    const reason = this.suppression(serverNow, previousTick) ?? (next.controllerId === this.controllerId ? null : "different-controller");
    const recovered = next.cursor > previousTick && next.cursor <= serverNow ? checkpointEvents(this.snapshot, next) : null;
    const events = advanceTracking(next, serverNow).events;
    this.offset = serverNow - this.d.now();
    this.snapshot = next;
    this.checkedAt = this.d.now(); this.ready = true; this.error = null;
    this.lastTick = serverNow;
    if (recovered) this.deliver(recovered.events, previousTick, serverNow, reason ?? (recovered.confirmed ? null : "checkpoint-replaced"), "sync");
    this.deliver(events, previousTick, serverNow, reason, "sync");
  }

  private suppression(now: number, after: number): Suppression | null {
    if (!this.ready) return "not-ready";
    if (this.busy) return "command-in-progress";
    if (this.accountId && this.d.now() - this.checkedAt >= 90_000) return "sync-stale";
    if (now < after || now - after >= 90_000) return "sleep-or-clock-gap";
    if (this.snapshot.controllerId !== this.controllerId) return "different-controller";
    return null;
  }

  private deliver(events: TrackingEvent[], after: number, now: number, suppression: Suppression | null, source: AlertDiagnostic["source"]) {
    for (const event of events) {
      if (event.at <= after || event.at > now || this.delivered.has(event.id)) continue;
      const reason = suppression ?? (source !== "tick" && this.snapshot.mode === "idle" && event.type === "rest-soon" ? "checkpoint-replaced" : null);
      this.trace({ kind: reason || !this.settings.alerts ? "alert-skipped" : "alert-requested", source,
        eventId: event.id, eventType: event.type, eventAt: event.at, revision: this.snapshot.revision,
        ...(reason || !this.settings.alerts ? { reason: reason ?? "alerts-disabled" } : {}) });
      if (reason) continue;
      this.delivered.add(event.id);
      this.message = `${event.title} ${event.body}`;
      if (this.settings.alerts) this.d.notify(event);
    }
    if (this.delivered.size > 500) this.delivered = new Set([...this.delivered].slice(-250));
  }

  async refresh(): Promise<void> {
    if (!this.accountId) { this.tick(); return; }
    if (this.refreshing) return this.refreshing;
    const epoch = this.epoch;
    const job = (async () => {
      try {
        const result = await this.d.request("/api/tracking");
        if (epoch !== this.epoch) return;
        if (result.status === 401) { this.ready = false; throw new Error("Session expired. Open the task list and sign in again."); }
        if (result.status !== 200) throw new Error("Cannot sync the timer. Checking again automatically.");
        const body = result.body as { tracking: unknown; serverNow: number };
        if (body.tracking === null) {
          const data = await this.d.request("/api/state");
          if (epoch !== this.epoch) return;
          if (data.status !== 200) throw new Error("Cannot load your tasks.");
          const state = sanitizeState((data.body as { state: unknown }).state);
          body.tracking = createTracking(state.tasks, state.endTime, localTimeZone(), body.serverNow, state.rest);
        }
        this.adopt(body.tracking, body.serverNow);
      } catch (e) {
        if (epoch === this.epoch) this.error = e instanceof Error ? e.message : "Cannot sync the timer.";
      } finally { if (epoch === this.epoch) this.publish(); }
    })();
    this.refreshing = job;
    await job;
    if (this.refreshing === job) this.refreshing = null;
  }

  async command(action: TrackingAction) {
    if (this.busy) throw new Error("Please wait for the timer to sync.");
    if (!this.ready) throw new Error("Open the task list and connect before tracking.");
    const epoch = this.epoch;
    this.busy = true; this.error = null; this.publish();
    try {
      if (this.accountId) {
        await this.refresh();
        if (epoch !== this.epoch) return;
        if (this.error) throw new Error(this.error);
        const result = await this.d.request("/api/tracking", "POST", {
          revision: this.snapshot.revision, action, controllerId: this.controllerId, timeZone: localTimeZone(),
        });
        if (epoch !== this.epoch) return;
        const body = result.body as { tracking?: unknown; serverNow?: number; error?: string };
        if (result.status !== 200) {
          await this.refresh();
          throw new Error(body.error ?? "Timer changed on another device. Please try again.");
        }
        this.adopt(body.tracking, body.serverNow);
      } else {
        this.snapshot = actOnTracking(this.snapshot, action, this.controllerId, this.d.now());
        this.snapshot.revision++;
        this.persist();
      }
      this.lastTick = this.d.now() + this.offset;
      this.message = action.type === "reset" ? "Today’s progress was reset. Tracking is paused." : action.type === "skip-rest" ? SKIPPED_REST_MESSAGE : null;
    } catch (e) {
      if (epoch === this.epoch) this.error = e instanceof Error ? e.message : "Could not update the timer.";
      throw e;
    } finally { if (epoch === this.epoch) { this.busy = false; this.publish(); } }
  }

  tick() {
    const now = this.d.now() + this.offset;
    const previous = this.lastTick;
    this.lastTick = now;
    if (!this.ready) { this.publish(); return; }
    const { state, events } = advanceTracking(this.snapshot, now);
    // No stale flood after sleep/restart, nor misleading alerts after losing
    // contact with another device. Alerts belong to the last controlling device.
    this.deliver(events, previous, now, this.suppression(now, previous), "tick");
    if (!this.accountId) {
      this.snapshot = state;
      // Checkpoint on transitions and once per active minute; timestamps preserve all
      // intervening elapsed time if the app is restarted between checkpoints.
      if (events.length || state.dayKey !== this.guest.dayKey || (state.mode !== "idle" && Math.floor(previous / 60_000) !== Math.floor(now / 60_000))) this.persist();
    }
    this.publish();
  }

  async resume() {
    this.lastTick = this.d.now() + this.offset;
    await this.refresh();
    this.lastTick = this.d.now() + this.offset;
    this.tick();
  }
}
