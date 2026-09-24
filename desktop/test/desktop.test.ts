import { test } from "node:test";
import assert from "node:assert/strict";
import { TrackerEngine } from "../src/engine";
import { statusModel } from "../src/model";
import { syncDelay, wakeDelay } from "../src/power";
import { trustedPage, validateAction, validateApi } from "../src/security";
import { actOnTracking, createTracking, dayEnd, WORK_CYCLE_MS, type TrackingEvent, type TrackingState } from "../../lib/tracking";
import type { Task } from "../../lib/types";
import type { ApiReply } from "../src/contract";

const T = Date.parse("2026-09-15T10:00:00Z");
const task: Task = { id: "a", title: "Code", description: "", dueDate: "2026-09-16", priority: "low", completed: false, createdAt: new Date(T).toISOString(), completedAt: null };
function setup(saved?: TrackingState) {
  let now = T;
  const notifications: TrackingEvent[] = [];
  let written: TrackingState | undefined;
  const requests: { path: string; method?: string; body?: any }[] = [];
  let respond = async (_path: string, _method?: string, _body?: unknown): Promise<ApiReply> => ({ status: 503, body: {} });
  const engine = new TrackerEngine({ now: () => now, notify: e => notifications.push(e), saveGuest: s => { written = structuredClone(s); }, publish: () => {}, request: async (path, method, body) => { requests.push({ path, method, body }); return respond(path, method, body); } }, "windows_test", saved);
  return { engine, notifications, requests, set now(value: number) { now = value; }, get now() { return now; }, get written() { return written; }, response(fn: typeof respond) { respond = fn; } };
}
function configure(x: ReturnType<typeof setup>) { x.engine.configure({ tasks: [task], endTime: "23:00", accountId: null }); }

test("guest start, elapsed work, pause and reset use the shared model", async () => {
  const x = setup(); configure(x);
  await x.engine.command({ type: "start" }); x.now += 60_000; x.engine.tick();
  assert.equal(x.engine.view().state.workMs, 60_000);
  await x.engine.command({ type: "pause" }); x.now += 60_000; x.engine.tick();
  assert.equal(x.engine.view().state.workMs, 60_000);
  await x.engine.command({ type: "reset" });
  assert.equal(x.engine.view().state.workMs, 0); assert.equal(x.written?.mode, "idle");
});
test("native rest warning and rest start are emitted once without any renderer", async () => {
  const s = actOnTracking(createTracking([task], "23:00", "UTC", T), { type: "start" }, "windows_test", T);
  s.workMs = s.cycleWorkMs = 85 * 60_000 - 500; s.taskMs.a = s.workMs;
  const x = setup(s); await x.engine.identity(null); x.now += 1000; x.engine.tick(); x.engine.tick();
  assert.equal(x.notifications.filter(e => e.type === "rest-soon").length, 1);
  for (let i = 0; i < 5; i++) { x.now += 60_000; x.engine.tick(); }
  assert.equal(x.notifications.filter(e => e.type === "rest-start").length, 1);
  assert.equal(x.engine.view().state.mode, "rest");
  for (let i = 0; i < 30; i++) { x.now += 60_000; x.engine.tick(); }
  assert.equal(x.notifications.filter(e => e.type === "rest-complete").length, 1);
});
test("sleep/resume catches up elapsed time without a flood of old alerts", async () => {
  const x = setup(); configure(x); await x.engine.command({ type: "start" });
  x.now += 2 * 60 * 60_000; await x.engine.resume();
  assert.equal(x.notifications.length, 0); assert.ok(x.engine.view().state.restMs > 0);
});
test("disabled alerts do not notify but keep in-app status", async () => {
  const s = actOnTracking(createTracking([task], "23:00", "UTC", T), { type: "start" }, "windows_test", T);
  s.workMs = s.cycleWorkMs = WORK_CYCLE_MS - 500; s.taskMs.a = s.workMs;
  const x = setup(s); await x.engine.identity(null); x.engine.settings.alerts = false; x.now += 1000; x.engine.tick();
  assert.equal(x.notifications.length, 0); assert.match(x.engine.view().message!, /rest|break/i);
});
test("a daily target completion alerts once at its exact boundary", async () => {
  const s = actOnTracking(createTracking([task], "10:02", "UTC", T), { type: "start" }, "windows_test", T);
  const x = setup(s); await x.engine.identity(null);
  x.now += 60_000; x.engine.tick(); x.now += 60_000; x.engine.tick(); x.engine.tick();
  assert.equal(x.notifications.filter(e => e.type === "task-complete").length, 1);
  assert.equal(x.notifications[0].at, T + 120_000);
});
test("stale account state suppresses alerts until the network is fresh", async () => {
  const s = actOnTracking(createTracking([task], "23:00", "UTC", T), { type: "start" }, "windows_test", T);
  s.workMs = s.cycleWorkMs = WORK_CYCLE_MS - 120_000; s.taskMs.a = s.workMs;
  const x = setup(); x.response(async () => ({ status: 200, body: { tracking: s, serverNow: x.now } }));
  await x.engine.identity("user"); x.now += 60_000; x.engine.tick(); x.now += 60_000; x.engine.tick();
  assert.equal(x.engine.view().connected, false); assert.equal(x.notifications.length, 0);
});
test("account commands use the latest revision, never a second offline timer", async () => {
  const x = setup(); let remote = createTracking([task], "23:00", "UTC", T); remote.revision = 8;
  x.response(async (_path, method, body: any) => {
    if (method === "POST") { assert.equal(body.revision, remote.revision); remote = { ...actOnTracking(remote, body.action, body.controllerId, x.now), revision: remote.revision + 1 }; }
    return { status: 200, body: { tracking: remote, serverNow: x.now } };
  });
  await x.engine.identity("user-a"); await x.engine.command({ type: "start" });
  assert.equal(x.engine.view().state.mode, "work"); assert.equal(x.engine.view().state.revision, 9);
  x.response(async () => ({ status: 0, body: {} }));
  await assert.rejects(x.engine.command({ type: "pause" }));
  assert.equal(x.engine.view().state.mode, "work");
  assert.equal(x.written, undefined);
});
test("another device's pause and alert ownership are respected", async () => {
  const x = setup(); let remote = actOnTracking(createTracking([task], "23:00", "UTC", T), { type: "start" }, "phone_device", T);
  remote.cycleWorkMs = remote.workMs = WORK_CYCLE_MS - 500; remote.taskMs.a = remote.workMs;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
  await x.engine.identity("user"); x.now += 1000; x.engine.tick(); assert.equal(x.notifications.length, 0);
  remote = { ...actOnTracking(remote, { type: "pause" }, "phone_device", x.now), revision: 2 };
  await x.engine.refresh(); assert.equal(x.engine.view().state.mode, "idle");
});
test("old in-flight account replies cannot overwrite the guest/account scope", async () => {
  const x = setup(); configure(x); await x.engine.command({ type: "start" });
  let resolve!: (reply: ApiReply) => void;
  x.response(() => new Promise(r => { resolve = r; }));
  const pending = x.engine.identity("account");
  await x.engine.identity(null);
  resolve({ status: 200, body: { tracking: createTracking([], "20:00", "UTC", T), serverNow: T } });
  await pending;
  assert.equal(x.engine.view().accountId, null); assert.equal(x.engine.view().state.taskId, "a");
  assert.throws(() => x.engine.configure({ tasks: [], endTime: "20:00", accountId: "forged" }));
});
test("revision conflicts refresh and report instead of overwriting", async () => {
  const x = setup(); const remote = createTracking([task], "23:00", "UTC", T);
  x.response(async (_path, method) => method === "POST" ? { status: 409, body: { error: "Changed elsewhere" } } : { status: 200, body: { tracking: remote, serverNow: x.now } });
  await x.engine.identity("user"); await assert.rejects(x.engine.command({ type: "start" }), /Changed elsewhere/);
  assert.equal(x.engine.view().state.mode, "idle");
});
test("cold offline account does not allow tracking until its state is loaded", async () => {
  const x = setup(); await x.engine.identity("user");
  assert.equal(x.engine.view().ready, false); await assert.rejects(x.engine.command({ type: "start" }));
});
test("IPC allowlists reject URL injection, unsupported verbs, malformed data and frames", () => {
  assert.deepEqual(validateApi({ path: "/api/state", method: "GET" }), { path: "/api/state", method: "GET" });
  for (const path of ["https://evil.test", "file:///C:/private", "/api/state?x=y", "/api/tracking", "/api/../secret"]) assert.throws(() => validateApi({ path, method: "GET" }));
  assert.throws(() => validateApi({ path: "/api/state", method: "PUT", body: "{" }));
  assert.throws(() => validateAction({ type: "shell" }));
  assert.deepEqual(validateAction({ type: "skip-rest", taskId: "ignored" }), { type: "skip-rest" });
  assert.throws(() => validateAction({ type: "start", taskId: 42 }));
  assert.ok(trustedPage("yantasks://app/index.html?mini=1"));
  assert.ok(!trustedPage("https://app/index.html")); assert.ok(!trustedPage("yantasks://evil/index.html"));
});
test("power policy lowers idle/battery polling while preserving exact alert wakeups", () => {
  assert.equal(syncDelay(false, false, true), 60_000);
  assert.equal(syncDelay(true, false, true), 30_000);
  assert.equal(syncDelay(true, false, false), 15_000);
  assert.equal(syncDelay(true, true, false), 5000);
  assert.equal(wakeDelay(false, null), 60_000);
  assert.equal(wakeDelay(false, 2300), 2325);
  assert.equal(wakeDelay(true, 60_000), 1000);
  assert.equal(wakeDelay(false, -10), 100);
});
test("taskbar model covers paused, working, resting and day-end states", async () => {
  const x = setup(); configure(x);
  assert.equal(statusModel(x.engine.view()).label, "Paused");
  await x.engine.command({ type: "start" });
  const m = statusModel(x.engine.view()); assert.equal(m.title, "Code"); assert.ok(m.tooltip.length <= 127); assert.ok(Number.isFinite(m.progress));
  x.now += 90 * 60_000; x.engine.tick(); assert.equal(statusModel(x.engine.view()).label, "Resting");
  x.now = dayEnd(x.engine.view().state) + 1000; x.engine.tick(); assert.equal(statusModel(x.engine.view()).label, "Day complete");
});
