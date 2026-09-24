import type { ApiRequest } from "./contract";
import type { TrackingAction } from "../../lib/tracking";

const routes = new Set([
  "GET /api/auth/me", "DELETE /api/auth/me", "POST /api/auth/login",
  "POST /api/auth/signup", "POST /api/auth/logout", "GET /api/state", "PUT /api/state",
]);
export function validateApi(value: unknown): ApiRequest {
  if (!value || typeof value !== "object") throw new Error("Invalid request.");
  const r = value as ApiRequest;
  if (!routes.has(`${r.method} ${r.path}`)) throw new Error("This API is not exposed to the desktop renderer.");
  if (r.body !== undefined && (typeof r.body !== "string" || r.body.length > 12_000_000)) throw new Error("Invalid request body.");
  if (r.body) JSON.parse(r.body);
  return { path: r.path, method: r.method, ...(r.body ? { body: r.body } : {}) };
}
export function validateAction(value: unknown): TrackingAction {
  if (!value || typeof value !== "object") throw new Error("Invalid timer action.");
  const a = value as TrackingAction;
  if (a.type === "pause" || a.type === "reset") return { type: a.type };
  if (a.type === "start" && (!("taskId" in a) || typeof a.taskId === "string" && a.taskId.length <= 100)) {
    return { type: "start", ...(a.taskId ? { taskId: a.taskId } : {}) };
  }
  throw new Error("Invalid timer action.");
}
export function trustedPage(url: string): boolean {
  try { const u = new URL(url); return u.origin === "null" && u.protocol === "yantasks:" && u.host === "app" && u.pathname === "/index.html"; }
  catch { return false; }
}
