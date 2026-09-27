import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type { TrackingEvent, TrackingState } from "../../lib/tracking";

export type Suppression = "not-ready" | "command-in-progress" | "sync-stale" | "sleep-or-clock-gap" | "different-controller" | "alerts-disabled" | "checkpoint-replaced";
export type AlertDiagnostic = {
  kind: "app-start" | "app-stop" | "suspend" | "resume" | "engine-status" | "alert-requested" | "alert-skipped" | "native-requested" | "native-shown" | "native-failed";
  source?: "sync" | "tick" | "guest-config";
  eventType?: TrackingEvent["type"] | "test";
  eventId?: string;
  eventAt?: number;
  reason?: Suppression | "unsupported" | "os-rejected" | "exception";
  scope?: "account" | "guest";
  owner?: "this-device" | "another-device" | "unassigned";
  mode?: TrackingState["mode"];
  taskId?: string | null;
  revision?: number;
  ready?: boolean;
  fresh?: boolean;
  busy?: boolean;
  alerts?: boolean;
  hasError?: boolean;
};

export const DIAGNOSTIC_FILE = "alert-diagnostics.jsonl";
export const DIAGNOSTIC_PREVIOUS = "alert-diagnostics.previous.jsonl";
const MAX_BYTES = 128 * 1024;
const opaque = (value: string | null | undefined) => value ? createHash("sha256").update(value).digest("hex").slice(0, 16) : undefined;

/** Transition-only local diagnostics: no timer, network, task text or credentials.
 * Two capped files bound disk use. Logging failure must never stop a timer/alert.
 */
export class AlertLog {
  private bytes = 0;
  private disabled = false;
  constructor(private directory: string, private now = Date.now, private maxBytes = MAX_BYTES) {
    try {
      fs.mkdirSync(directory, { recursive: true });
      const file = path.join(directory, DIAGNOSTIC_FILE);
      if (fs.existsSync(file)) this.bytes = fs.statSync(file).size;
    } catch { this.disabled = true; }
  }

  record(input: AlertDiagnostic): void {
    if (this.disabled) return;
    try {
      // Explicit allowlist: even an accidentally spread TrackingEvent cannot
      // put a task title/body, account id, or a raw controller id into the log.
      const line = JSON.stringify({
        at: new Date(this.now()).toISOString(), kind: input.kind, source: input.source,
        eventType: input.eventType, eventKey: opaque(input.eventId), eventAt: input.eventAt,
        reason: input.reason, scope: input.scope, owner: input.owner, mode: input.mode,
        taskKey: opaque(input.taskId), revision: input.revision, ready: input.ready,
        fresh: input.fresh, busy: input.busy, alerts: input.alerts, hasError: input.hasError,
      }) + "\n";
      const size = Buffer.byteLength(line);
      if (size > this.maxBytes) return;
      const file = path.join(this.directory, DIAGNOSTIC_FILE);
      if (this.bytes && this.bytes + size > this.maxBytes) {
        fs.renameSync(file, path.join(this.directory, DIAGNOSTIC_PREVIOUS));
        this.bytes = 0;
      }
      fs.appendFileSync(file, line, { mode: 0o600 });
      this.bytes += size;
    } catch { this.disabled = true; }
  }
}
