import { test } from "node:test";
import assert from "node:assert/strict";
import { TrackerEngine } from "../src/engine";
import { statusModel } from "../src/model";
import { hasLiveCountdown, syncDelay, wakeDelay } from "../src/power";
import { trustedPage, validateAction, validateApi } from "../src/security";
import { actOnTracking, advanceTracking, configureTracking, createTracking, dayEnd, dayPlan, taskProgress, workBudget, type TrackingEvent, type TrackingState } from "../../lib/tracking";
import type { Task } from "../../lib/types";
import type { DayPlan } from "../../lib/plan";
import type { ApiReply } from "../src/contract";
import type { AlertDiagnostic } from "../src/diagnostics";
import { APP_ID, desktopIdentity } from "../src/identity";
import fs from "node:fs";

test("installed Windows identity matches the installer and never aliases development or smoke", () => {
  const installer = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.deepEqual(desktopIdentity(true, false), { appId: installer.build.appId, name: installer.productName });
  const development = desktopIdentity(false, false);
  const smoke = desktopIdentity(false, true);
  assert.equal(new Set([APP_ID, development.appId, smoke.appId]).size, 3);
  assert.equal(new Set(["YanTasks", development.name, smoke.name]).size, 3);
  assert.deepEqual(desktopIdentity(true, true), smoke, "packaged smoke must also stay isolated");
});

const T = Date.parse("2026-09-15T10:00:00Z");
const MIN = 60_000;
// The test runner uses UTC. The work day starts at T, split 1:1, so no idle time is used yet.
const PLAN: DayPlan = { startTime: "10:00", workParts: 1, idleParts: 1 };
const task: Task = { id: "a", title: "Code", description: "", dueDate: "2026-09-16", priority: "low", completed: false, createdAt: new Date(T).toISOString(), completedAt: null };
function setup(saved?: TrackingState) {
  let now = T;
  const notifications: TrackingEvent[] = [];
  const diagnostics: AlertDiagnostic[] = [];
  let written: TrackingState | undefined;
  const requests: { path: string; method?: string; body?: any }[] = [];
  let respond = async (_path: string, _method?: string, _body?: unknown): Promise<ApiReply> => ({ status: 503, body: {} });
  const engine = new TrackerEngine({ now: () => now, notify: e => notifications.push(e), diagnostic: e => diagnostics.push(e), saveGuest: s => { written = structuredClone(s); }, publish: () => {}, request: async (path, method, body) => { requests.push({ path, method, body }); return respond(path, method, body); } }, "windows_test", saved);
  return { engine, notifications, diagnostics, requests, set now(value: number) { now = value; }, get now() { return now; }, get written() { return written; }, response(fn: typeof respond) { respond = fn; } };
}
// 10:00–23:00 split 1:1: 6h30m of work and 6h30m of idle time.
function configure(x: ReturnType<typeof setup>) { x.engine.configure({ tasks: [task], endTime: "23:00", plan: { ...PLAN }, accountId: null }); }

test("unweighted IPC settings persist across engine restarts without losing tracked work", async () => {
  const tasks = [task, { ...task, id: "b", dueDate: "2026-09-25", priority: "high" as const }];
  const config = { tasks, endTime: "23:00", plan: { ...PLAN }, accountId: null };
  const x = setup(); x.engine.configure(config); await x.engine.command({ type: "start" });
  x.now += 60_000;
  x.engine.configure({ ...config, unweighted: true });
  assert.equal(x.written?.unweighted, true);
  assert.equal(x.written?.workMs, 60_000);
  assert.deepEqual(taskProgress(x.engine.view().state).map(p => p.weight), [1, 1]);
  const reopened = setup(x.written); reopened.now = x.now; await reopened.engine.identity(null);
  assert.equal(reopened.engine.view().state.unweighted, true);
  reopened.engine.configure({ ...config, unweighted: false });
  assert.equal(reopened.written?.workMs, 60_000);
  assert.deepEqual(taskProgress(reopened.engine.view().state).map(p => p.weight), [1, .4]);
});

test("minimum IPC setting survives restart and preserves tracked time when toggled", async () => {
  const tasks = [task, { ...task, id: "b" }];
  // A 20-minute day: 10 minutes of work, 5 per task without a minimum.
  const config = { tasks, endTime: "10:20", plan: { ...PLAN }, accountId: null, minimumEnabled: false, minimumMinutes: 45 };
  const x = setup(createTracking(tasks, "10:20", "UTC", T, PLAN));
  x.engine.configure(config); await x.engine.command({ type: "start" });
  x.now += 60_000;
  x.engine.configure({ ...config, minimumEnabled: true });
  assert.equal(x.written?.workMs, 60_000); assert.equal(x.written?.minimumEnabled, true);
  assert.equal(taskProgress(x.engine.view().state)[1].skipped, true);
  x.engine.configure(config);
  assert.equal(x.written?.workMs, 60_000); assert.equal(x.written?.minimumEnabled, false);
  const reopened = setup(x.written); reopened.now = x.now; await reopened.engine.identity(null);
  assert.equal(reopened.engine.view().state.minimumEnabled, false);
  assert.equal(reopened.engine.view().state.minimumMinutes, 45);
  assert.ok(taskProgress(reopened.engine.view().state).every(p => !p.skipped));
  reopened.engine.configure({ ...config, minimumEnabled: true, minimumMinutes: 5 });
  assert.equal(reopened.engine.view().state.workMs, 60_000);
  assert.equal(reopened.engine.view().state.minimumMinutes, 5);
  assert.ok(taskProgress(reopened.engine.view().state).every(p => !p.skipped));
});
test("an account without a timer inherits both allocation preferences", async () => {
  const x = setup();
  x.response(async path => ({ status: 200, body: path === "/api/tracking"
    ? { tracking: null, serverNow: x.now }
    : { state: { tasks: [task], endTime: "23:00", unweighted: true, minimumEnabled: false, minimumMinutes: 15 } } }));
  await x.engine.identity("user");
  assert.equal(x.engine.view().state.unweighted, true);
  assert.equal(x.engine.view().state.minimumEnabled, false);
  assert.equal(x.engine.view().state.minimumMinutes, 15);
});
test("a minimum-toggle checkpoint does not swallow an elapsed completion alert", async () => {
  const { x } = await accountBeforeBoundary();
  const original = taskBoundary();
  const remote = { ...configureTracking(original, original.tasks, original.endTime, x.now, dayPlan(original), false, false), revision: 1 };
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.filter(e => e.type === "task-complete").length, 1);
});
test("guest start, elapsed work, pause and reset use the shared model", async () => {
  const x = setup(); configure(x);
  await x.engine.command({ type: "start" }); x.now += 60_000; x.engine.tick();
  assert.equal(x.engine.view().state.workMs, 60_000);
  await x.engine.command({ type: "pause" }); x.now += 60_000; x.engine.tick();
  assert.equal(x.engine.view().state.workMs, 60_000);
  await x.engine.command({ type: "reset" });
  assert.equal(x.engine.view().state.workMs, 0); assert.equal(x.written?.mode, "idle");
});
test("native idle reminders are emitted once without starting work or any renderer", async () => {
  // Nobody has started or paused the timer, so this device owns its alerts.
  const x = setup(createTracking([task], "23:00", "UTC", T, PLAN)); await x.engine.identity(null);
  for (let i = 0; i < 400; i++) { x.now += MIN; x.engine.tick(); x.engine.tick(); }
  // Half the 6h30m of idle time is used at 13:15; it runs out at 16:30.
  assert.deepEqual(x.notifications.map(e => [e.type, e.at]), [["idle-half", T + 195 * MIN + 1], ["idle-soon", T + 385 * MIN], ["idle-out", T + 390 * MIN]]);
  assert.equal(x.engine.view().state.mode, "idle");
  assert.equal(x.engine.view().state.workMs, 0);
  let m = statusModel(x.engine.view()); assert.equal(m.label, "Paused"); assert.equal(m.idleLeft, 0); assert.equal(m.remaining, 380 * MIN);
  await x.engine.command({ type: "start" });
  m = statusModel(x.engine.view()); assert.equal(m.canPause, true);
  await x.engine.command({ type: "pause" }); assert.equal(x.engine.view().state.mode, "idle");
});
test("sleep/resume catches up elapsed time without a flood of old alerts", async () => {
  const x = setup(); configure(x);
  x.now += 4 * 60 * MIN; await x.engine.resume();
  assert.equal(x.notifications.length, 0, "the idle reminder missed while asleep is not replayed");
  assert.equal(statusModel(x.engine.view()).advise, true, "but the advice to start still shows");
  await x.engine.command({ type: "start" });
  x.now += 2 * 60 * MIN; await x.engine.resume();
  assert.equal(x.notifications.length, 0); assert.equal(x.engine.view().state.workMs, 2 * 60 * MIN);
  assert.equal(statusModel(x.engine.view()).advise, false);
});

test("desktop advice starts strictly below half and stays off after all work is tracked", async () => {
  const initial = createTracking([task], "12:00", "UTC", T, PLAN);
  const x = setup(initial); await x.engine.identity(null);
  x.now = T + 30 * MIN; x.engine.tick();
  assert.equal(statusModel(x.engine.view()).advise, false);
  assert.equal(x.notifications.length, 0);
  x.now += 1; x.engine.tick();
  assert.equal(statusModel(x.engine.view()).advise, true);
  assert.deepEqual(x.notifications.map(e => e.type), ["idle-half"]);
  await x.engine.command({ type: "start" });
  assert.equal(statusModel(x.engine.view()).advise, false);
  for (let i = 0; i < 60; i++) { x.now += MIN; x.engine.tick(); }
  const done = x.engine.view();
  assert.equal(done.state.workMs, 60 * MIN);
  assert.equal(statusModel(done).label, "Work done");
  assert.equal(statusModel(done).advise, false);
  const count = x.notifications.length;
  x.now = T + 115 * MIN; x.engine.tick();
  assert.equal(statusModel(x.engine.view()).advise, false);
  assert.equal(x.notifications.length, count);
  const reopened = setup(x.written); reopened.now = x.now; await reopened.engine.identity(null);
  assert.equal(statusModel(reopened.engine.view()).advise, false);
  assert.equal(statusModel(reopened.engine.view()).canStart, false);
  assert.equal(reopened.notifications.length, 0);
});
test("exhausted idle stays paused through a desktop restart with no debt tomorrow", async () => {
  // 10:00–12:00 split 1:1: idle time runs out at 11:00 and stays at zero.
  const saved = advanceTracking(createTracking([task], "12:00", "UTC", T, PLAN), T + 70 * MIN).state;
  assert.equal(saved.mode, "idle");
  const x = setup(JSON.parse(JSON.stringify(saved))); x.now = saved.cursor;
  await x.engine.identity(null);
  assert.equal(statusModel(x.engine.view()).label, "Paused");
  assert.equal(statusModel(x.engine.view()).remaining, 50 * MIN);
  await x.engine.command({ type: "start" });
  assert.equal(statusModel(x.engine.view()).canPause, true);
  for (let i = 0; i < 50; i++) { x.now += MIN; x.engine.tick(); }
  assert.equal(x.engine.view().state.workMs, 50 * MIN);
  assert.equal(x.engine.view().state.mode, "idle");
  assert.deepEqual(x.notifications.filter(e => e.type === "day-end").map(e => e.at), [T + 120 * MIN]);
  assert.equal(statusModel(x.engine.view()).canStart, false);
  x.now = T + 24 * 60 * MIN; x.engine.tick();
  assert.equal(x.written?.carryMs, undefined); assert.equal(x.written?.workMs, 0);
  const reopened = setup(x.written); reopened.now = x.now; await reopened.engine.identity(null);
  assert.equal(statusModel(reopened.engine.view()).idleLeft, 60 * MIN);
  assert.equal(statusModel(reopened.engine.view()).workLeft, 60 * MIN);
});
test("desktop removes old debt once without losing today's per-task work", async () => {
  const saved = createTracking([task], "23:00", "UTC", T, PLAN);
  delete saved.idlePolicyVersion;
  delete saved.workLimitVersion;
  Object.assign(saved, { carryMs: 30 * MIN, workMs: 45 * MIN, taskMs: { a: 45 * MIN }, cursor: T + 90 * MIN, controllerId: "windows_test" });
  const x = setup(saved); x.now = T + 100 * MIN; await x.engine.identity(null); x.engine.tick();
  assert.equal(x.written?.idlePolicyVersion, 2);
  assert.equal(x.written?.carryMs, undefined);
  assert.equal(x.written?.workMs, 45 * MIN);
  assert.deepEqual(x.written?.taskMs, { a: 45 * MIN });
  assert.equal(x.written?.controllerId, "windows_test");
  const reopened = setup(x.written); reopened.now = x.now; await reopened.engine.identity(null);
  assert.equal(reopened.engine.view().state.workMs, 45 * MIN);
  assert.deepEqual(reopened.engine.view().state.taskMs, { a: 45 * MIN });
});
test("disabled alerts do not notify but keep in-app status", async () => {
  const x = setup(createTracking([task], "23:00", "UTC", T, PLAN)); await x.engine.identity(null); x.engine.settings.alerts = false;
  x.now = T + 195 * MIN - 500; x.engine.tick(); x.now += 1000; x.engine.tick();
  assert.equal(x.notifications.length, 0); assert.match(x.engine.view().message!, /start working/i);
});
test("desktop checkpoints a running fixed-goal timer once, then shrinks targets without logging idle", async () => {
  const saved = createTracking([task, { ...task, id: "b" }], "23:00", "UTC", T, PLAN);
  delete saved.workLimitVersion;
  Object.assign(saved, { mode: "work", taskId: "a", workMs: 120 * MIN, taskMs: { a: 120 * MIN }, cursor: T + 600 * MIN, controllerId: "windows_test" });
  const x = setup(saved); x.now = T + 650 * MIN; await x.engine.identity(null); x.engine.tick();
  assert.equal(x.written?.workLimitVersion, 1);
  assert.equal(x.written?.workMs, 170 * MIN); assert.deepEqual(x.written?.taskMs, { a: 170 * MIN });
  assert.equal(statusModel(x.engine.view()).remaining, 130 * MIN);
  const reopened = setup(x.written); reopened.now = x.now; await reopened.engine.identity(null);
  await reopened.engine.command({ type: "pause" }); reopened.now += 10 * MIN; reopened.engine.tick();
  assert.equal(reopened.engine.view().state.workMs, 170 * MIN);
  assert.deepEqual(reopened.engine.view().state.taskMs, { a: 170 * MIN });
  assert.equal(statusModel(reopened.engine.view()).remaining, 120 * MIN);
  assert.equal(statusModel(reopened.engine.view()).label, "Paused");
});
test("a daily target completion alerts once at its exact boundary", async () => {
  // A four-minute day: two minutes of work, all for Code.
  const s = actOnTracking(createTracking([task], "10:04", "UTC", T, PLAN), { type: "start" }, "windows_test", T);
  const x = setup(s); await x.engine.identity(null);
  x.now += 60_000; x.engine.tick(); x.now += 60_000; x.engine.tick(); x.engine.tick();
  assert.equal(x.notifications.filter(e => e.type === "task-complete").length, 1);
  assert.equal(x.notifications[0].at, T + 120_000);
  assert.equal(x.notifications.filter(e => e.type === "work-complete").length, 1);
});
test("stale account state suppresses alerts until the network is fresh", async () => {
  const s = actOnTracking(createTracking([task], "23:00", "UTC", T, PLAN), { type: "start" }, "windows_test", T);
  s.workMs = s.taskMs.a = workBudget(s) - 120_000;
  const x = setup(); x.response(async () => ({ status: 200, body: { tracking: s, serverNow: x.now } }));
  await x.engine.identity("user"); x.now += 60_000; x.engine.tick(); x.now += 60_000; x.engine.tick();
  assert.equal(x.engine.view().connected, false); assert.equal(x.notifications.length, 0);
});

// Two equal tasks in a 10:00–16:00 day split 1:2: two hours of work, so Code
// finishes at 11:00 and Expo starts. No idle reminder falls near 11:00, even after a reset.
const BOUNDARY_PLAN: DayPlan = { startTime: "10:00", workParts: 1, idleParts: 2 };
function taskBoundary() {
  return actOnTracking(createTracking([task, { ...task, id: "b", title: "Expo" }], "16:00", "UTC", T, BOUNDARY_PLAN), { type: "start" }, "windows_test", T);
}
async function accountBeforeBoundary(s = taskBoundary(), at = T + 60 * 60_000) {
  const x = setup();
  let remote = s;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
  await x.engine.identity("user");
  x.now = at - 1000; await x.engine.refresh(); x.engine.tick();
  x.now = at + 25;
  return { x, set remote(value: TrackingState) { remote = value; } };
}

test("sync checkpoints cannot swallow a task completion, regardless of timer/refresh ordering", async () => {
  for (const tickFirst of [false, true]) {
    const { x } = await accountBeforeBoundary();
    const remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
    x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
    if (tickFirst) x.engine.tick();
    await x.engine.refresh(); x.engine.tick();
    await x.engine.refresh(); x.engine.tick();
    assert.equal(x.engine.view().state.taskId, "b");
    assert.equal(x.notifications.length, 1);
    assert.equal(x.notifications[0].type, "task-complete");
    assert.match(x.notifications[0].body, /Now tracking Expo/);
  }
});

test("a real task-edit checkpoint preserves the elapsed transition alert", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture;
  const initial = taskBoundary();
  fixture.remote = { ...configureTracking(initial, initial.tasks.map(t => t.id === "a" ? { ...t, title: "Code (edited)" } : t), initial.endTime, x.now), revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.equal(x.notifications[0].type, "task-complete");
});

// 10:00–18:00 split 1:1, not started: half the idle time is used at 12:00 and it runs out at 14:00.
function reallocationSession() {
  const tasks = ["Physics", "Essay", "Reading"].map((title, i) => ({ ...task, id: String(i), title, createdAt: new Date(T + i).toISOString() }));
  return createTracking(tasks, "18:00", "UTC", T, PLAN);
}

test("a task edit right after an idle reminder keeps it, and later alerts follow the edit", async () => {
  const initial = reallocationSession();
  const fixture = await accountBeforeBoundary(initial, T + 120 * MIN); const { x } = fixture;
  fixture.remote = { ...configureTracking(initial, initial.tasks.map(t => t.id === "0" ? { ...t, completed: true } : t), initial.endTime, x.now), revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.deepEqual(x.notifications.map(e => e.type), ["idle-half"]);
  for (let i = 0; i < 125 * 4; i++) { x.now += 15_000; await x.engine.refresh(); x.engine.tick(); }
  assert.deepEqual(x.notifications.map(e => e.type), ["idle-half", "idle-soon", "idle-out"]);
  assert.match(x.notifications[2].body, /Choose Start working or Track/);
  assert.equal(x.engine.view().state.mode, "idle");
});

test("guest task edits preserve the same idle reminder", async () => {
  const initial = reallocationSession(); const before = T + 120 * MIN - 1000;
  const x = setup(advanceTracking(initial, before).state); x.now = before;
  await x.engine.identity(null); x.now += 1025;
  x.engine.configure({ accountId: null, tasks: initial.tasks.map(t => t.id === "0" ? { ...t, completed: true } : t), endTime: initial.endTime, plan: { ...PLAN } });
  x.engine.tick();
  assert.deepEqual(x.notifications.map(e => e.type), ["idle-half"]);
});

test("a recovered idle-out reminder asks for explicit tracking, never claims work started", async () => {
  const initial = reallocationSession();
  const fixture = await accountBeforeBoundary(initial, T + 240 * MIN); const { x } = fixture;
  fixture.remote = { ...configureTracking(initial, initial.tasks.map(t => t.id === "0" ? { ...t, completed: true } : t), initial.endTime, x.now), revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1);
  assert.equal(x.notifications[0].type, "idle-out");
  assert.match(x.notifications[0].body, /Choose Start working or Track/);
  assert.doesNotMatch(x.notifications[0].body, /Now tracking/);
  assert.equal(x.engine.view().state.mode, "idle");
});

test("a work-day change on another device replaces reminders predicted under the old plan", async () => {
  const initial = createTracking([task], "18:00", "UTC", T, PLAN);
  const fixture = await accountBeforeBoundary(initial, T + 120 * MIN); const { x } = fixture;
  fixture.remote = { ...configureTracking(initial, initial.tasks, initial.endTime, x.now, { ...PLAN, idleParts: 2 }), revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 0);
  assert.ok(x.diagnostics.some(e => e.kind === "alert-skipped" && e.reason === "checkpoint-replaced" && e.eventType === "idle-half"));
});

test("an unchanged account snapshot also delivers its boundary exactly once during refresh", async () => {
  const { x } = await accountBeforeBoundary();
  await x.engine.refresh(); x.engine.tick();
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.match(x.notifications[0].body, /Now tracking Expo/);
});

test("checkpoint recovery handles a server clock offset without replay on initial sign-in", async () => {
  const x = setup(); const offset = 15 * 60_000;
  let remote = taskBoundary();
  x.now = T + 60 * 60_000 - offset - 1000;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now + offset } }));
  await x.engine.identity("user"); x.engine.tick();
  assert.equal(x.notifications.length, 0);
  x.now += 1025;
  remote = { ...advanceTracking(remote, x.now + offset).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1);
  assert.equal(x.notifications[0].at, T + 60 * 60_000);
});

test("checkpoint recovery covers idle reminders, finished work and day end", async () => {
  // 10:00–18:00 split 1:1: four hours each of work and idle time.
  const idle = createTracking([task], "18:00", "UTC", T, PLAN);
  const working = actOnTracking(idle, { type: "start" }, "windows_test", T);
  // Behind at 17:59: the target shrinks to the last minute, completing at cutoff.
  const late: TrackingState = { ...idle, mode: "work", taskId: "a", cursor: T + 479 * MIN };
  const cases: [TrackingState, number, string[]][] = [
    [idle, 120, ["idle-half"]], [idle, 235, ["idle-soon"]], [idle, 240, ["idle-out"]],
    [working, 240, ["task-complete", "work-complete"]], [late, 480, ["task-complete", "day-end"]],
  ];
  for (const [initial, minutes, types] of cases) {
    const fixture = await accountBeforeBoundary(initial, T + minutes * MIN); const { x } = fixture;
    fixture.remote = { ...advanceTracking(initial, x.now).state, revision: 1 };
    await x.engine.refresh(); x.engine.tick();
    assert.deepEqual(x.notifications.map(e => e.type), types, types.join());
  }
});

test("reset, pause, manual switch and ownership changes cancel obsolete checkpoint alerts", async () => {
  for (const mutation of ["reset", "pause", "switch", "owner", "history"] as const) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    const before = x.now - 500;
    let changed: TrackingState;
    if (mutation === "reset" || mutation === "pause") changed = actOnTracking(taskBoundary(), { type: mutation }, "windows_test", before);
    else if (mutation === "switch") changed = actOnTracking(taskBoundary(), { type: "start", taskId: "b" }, "windows_test", before);
    else changed = advanceTracking(taskBoundary(), x.now).state;
    if (mutation === "owner") changed.controllerId = "phone_device";
    if (mutation === "history") { changed.taskMs.a -= 2000; changed.taskMs.b += 2000; }
    fixture.remote = { ...changed, revision: 1 };
    await x.engine.refresh(); x.engine.tick();
    assert.equal(x.notifications.length, 0, mutation);
  }
});
test("disabled alerts still preserve the completion message recovered from sync", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture;
  x.engine.settings.alerts = false;
  fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 0); assert.match(x.engine.view().message!, /Daily target reached/);
  assert.ok(x.diagnostics.some(e => e.kind === "alert-skipped" && e.reason === "alerts-disabled" && e.eventType === "task-complete"));
});

test("diagnostics explain stale sync, ownership and replaced-checkpoint suppression", async () => {
  for (const reason of ["sync-stale", "different-controller", "checkpoint-replaced"] as const) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    if (reason === "sync-stale") {
      x.now += 120_000;
      x.engine.tick();
    } else {
      const initial = taskBoundary();
      const next = reason === "checkpoint-replaced"
        ? actOnTracking(initial, { type: "pause" }, "windows_test", x.now)
        : { ...advanceTracking(initial, x.now).state, controllerId: "phone_device" };
      fixture.remote = { ...next, revision: 1 };
      await x.engine.refresh(); x.engine.tick();
    }
    assert.ok(x.diagnostics.some(e => e.kind === "alert-skipped" && e.reason === reason && e.eventType === "task-complete"), reason);
    assert.equal(x.notifications.length, 0);
  }
});

test("unchanged idle ticks do not generate diagnostic writes", () => {
  const x = setup(); configure(x);
  x.diagnostics.length = 0;
  for (let i = 0; i < 500; i++) { x.now += 1000; x.engine.tick(); }
  assert.equal(x.diagnostics.length, 0);
});

test("a recovered alert is logged once and logger failure cannot break tracking", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture;
  fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick(); await x.engine.refresh(); x.engine.tick();
  assert.equal(x.diagnostics.filter(e => e.kind === "alert-requested" && e.eventType === "task-complete").length, 1);
  let now = T; const delivered: TrackingEvent[] = [];
  const engine = new TrackerEngine({ now: () => now, request: async () => ({ status: 503, body: {} }), saveGuest: () => {}, publish: () => {},
    diagnostic: () => { throw new Error("disk full"); }, notify: e => delivered.push(e),
  }, "windows_test", taskBoundary());
  await engine.identity(null); now += 60 * 60_000 - 1000; engine.tick(); now += 1025; engine.tick();
  assert.equal(delivered.length, 1);
});

test("cold start, reconnection and sleep do not replay checkpoint alerts", async () => {
  for (const scenario of ["cold", "offline", "sleep", "midnight"] as const) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    if (scenario === "cold") await x.engine.identity(null);
    if (scenario === "offline" || scenario === "sleep") x.now += 120_000;
    if (scenario === "midnight") x.now += 24 * 60 * 60_000;
    fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
    if (scenario === "cold") await x.engine.identity("user");
    else if (scenario === "sleep") await x.engine.resume();
    else await x.engine.refresh();
    x.engine.tick(); assert.equal(x.notifications.length, 0, scenario);
  }
});
test("account commands use the latest revision, never a second offline timer", async () => {
  const x = setup(); let remote = createTracking([task], "23:00", "UTC", T, PLAN); remote.revision = 8;
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
  const x = setup(); let remote: TrackingState = { ...taskBoundary(), controllerId: "phone_device" };
  x.now = T + 60 * MIN - 1000;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
  await x.engine.identity("user"); x.now += 1025; x.engine.tick();
  assert.equal(x.engine.view().state.taskId, "b"); assert.equal(x.notifications.length, 0);
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
  assert.throws(() => x.engine.configure({ tasks: [], endTime: "20:00", plan: { ...PLAN }, accountId: "forged" }));
});
test("revision conflicts refresh and report instead of overwriting", async () => {
  const x = setup(); const remote = createTracking([task], "23:00", "UTC", T, PLAN);
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
  assert.deepEqual(validateAction({ type: "pause", taskId: "ignored" }), { type: "pause" });
  assert.throws(() => validateAction({ type: "skip-rest" }), "breaks are gone");
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

test("visible idle countdowns tick each second without increasing hidden wakeups or polling", () => {
  const idle = createTracking([task], "23:00", "UTC", T, PLAN);
  const working = actOnTracking(idle, { type: "start" }, "windows_test", T);
  const paused = advanceTracking(idle, T + 400 * MIN).state;
  for (const state of [idle, working]) {
    assert.equal(hasLiveCountdown(state), true);
    assert.equal(wakeDelay(true && hasLiveCountdown(state), null), 1000);
    assert.equal(wakeDelay(false && hasLiveCountdown(state), null), 60_000);
  }
  assert.equal(hasLiveCountdown(paused), true, "available work shrinks toward the cutoff without logging any work");
  assert.equal(syncDelay(false, true, true), 30_000, "visible idle on battery does not poll every second");
  assert.equal(syncDelay(false, false, true), 60_000);
  const done = advanceTracking(working, T + 390 * MIN).state;
  assert.equal(hasLiveCountdown(done), false);
  assert.equal(hasLiveCountdown({ ...idle, cursor: T - 1000 }), false);
  assert.equal(hasLiveCountdown({ ...idle, cursor: dayEnd(idle) }), false);
});
test("taskbar model covers before the day, idle, working, paused and day end", async () => {
  // 10:30–23:00 split 1:1: 6h15m each of work and idle time.
  const x = setup(); x.engine.configure({ tasks: [task], endTime: "23:00", plan: { ...PLAN, startTime: "10:30" }, accountId: null });
  let m = statusModel(x.engine.view()); assert.equal(m.label, "Before your day"); assert.equal(m.canStart, false);
  x.now += 30 * MIN; x.engine.tick();
  m = statusModel(x.engine.view()); assert.equal(m.label, "Idle"); assert.equal(m.canStart, true); assert.equal(m.advise, false); assert.equal(m.remaining, m.idleLeft);
  await x.engine.command({ type: "start" });
  m = statusModel(x.engine.view()); assert.equal(m.label, "Working"); assert.equal(m.title, "Code"); assert.equal(m.canPause, true);
  assert.ok(m.tooltip.length <= 127); assert.ok(Number.isFinite(m.progress)); assert.equal(m.remaining, m.workLeft);
  await x.engine.command({ type: "pause" });
  x.now += 3.5 * 60 * MIN; x.engine.tick();
  m = statusModel(x.engine.view()); assert.equal(m.label, "Idle"); assert.equal(m.advise, true);
  x.now += 3 * 60 * MIN; x.engine.tick();
  m = statusModel(x.engine.view()); assert.equal(m.label, "Paused"); assert.equal(m.idleLeft, 0);
  assert.equal(m.remaining, 360 * MIN); assert.match(m.windowTitle, /work left/);
  x.now += 1000; x.engine.tick();
  assert.equal(statusModel(x.engine.view()).remaining, m.remaining - 1000);
  assert.equal(x.engine.view().state.workMs, 0);
  x.now = dayEnd(x.engine.view().state) + 1000; x.engine.tick();
  m = statusModel(x.engine.view()); assert.equal(m.label, "Day complete"); assert.equal(m.workLeft, 0); assert.equal(m.canStart, false);
});
