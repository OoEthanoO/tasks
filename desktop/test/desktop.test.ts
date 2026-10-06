import { test } from "node:test";
import assert from "node:assert/strict";
import { TrackerEngine } from "../src/engine";
import { statusModel } from "../src/model";
import { eventScheduleKey, hasLiveCountdown, syncDelay, wakeDelay } from "../src/power";
import { trustedPage, validateAction, validateApi } from "../src/security";
import { actOnTracking, advanceTracking, configureTracking, createTracking, dayPlan, taskProgress, TURN_MS, type TrackingEvent, type TrackingState } from "../../lib/tracking";
import { createTracking as legacyCreate } from "../../lib/legacy-tracking";
import { createTracking as pacedCreate } from "../../lib/paced-tracking";
import { TRACKING_UPDATE_REQUIRED } from "../../lib/tracking-protocol";
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
  assert.deepEqual(desktopIdentity(true, true), smoke);
});

const T = Date.parse("2026-09-15T10:00:00Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
// Retired data is deliberately kept in fixtures to exercise backwards compatibility.
const PLAN: DayPlan = { startTime: "10:00", workParts: 1, idleParts: 1 };
const task: Task = { id: "a", title: "Code", description: "", dueDate: "2026-09-16", priority: "low", completed: false, createdAt: new Date(T).toISOString(), completedAt: null };
const second: Task = { ...task, id: "b", title: "Expo", createdAt: new Date(T + 1).toISOString() };
const third: Task = { ...task, id: "c", title: "Read", createdAt: new Date(T + 2).toISOString() };

function setup(saved?: TrackingState, initialNow = T) {
  let now = initialNow;
  const notifications: TrackingEvent[] = [];
  const diagnostics: AlertDiagnostic[] = [];
  let written: TrackingState | undefined;
  let writes = 0;
  const requests: { path: string; method?: string; body?: any }[] = [];
  let respond = async (_path: string, _method?: string, _body?: unknown): Promise<ApiReply> => ({ status: 503, body: {} });
  const engine = new TrackerEngine({
    now: () => now, notify: e => notifications.push(e), diagnostic: e => diagnostics.push(e),
    saveGuest: s => { written = structuredClone(s); writes++; }, publish: () => {},
    request: async (path, method, body) => { requests.push({ path, method, body }); return respond(path, method, body); },
  }, "windows_test", saved);
  return { engine, notifications, diagnostics, requests,
    set now(value: number) { now = value; }, get now() { return now; },
    get written() { return written; }, get writes() { return writes; },
    response(fn: typeof respond) { respond = fn; },
  };
}
function configure(x: ReturnType<typeof setup>, tasks = [task]) {
  x.engine.configure({ tasks, endTime: "23:00", plan: PLAN, accountId: null });
}
function tickMinutes(x: ReturnType<typeof setup>, minutes: number) {
  for (let i = 0; i < minutes; i++) { x.now += MIN; x.engine.tick(); }
}
function taskBoundary(now = T) {
  return actOnTracking(createTracking([task, second], "16:00", "UTC", now, PLAN), { type: "start" }, "windows_test", now);
}
async function accountBeforeBoundary(s = taskBoundary(), at = s.cursor + HOUR) {
  const x = setup(undefined, s.cursor);
  let remote = s;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
  await x.engine.identity("user");
  x.now = at - 1000; await x.engine.refresh(); x.engine.tick();
  x.now = at + 25;
  return { x, set remote(value: TrackingState) { remote = value; } };
}

test("guest Start runs hourly turns continuously until Pause", async () => {
  assert.equal(TURN_MS, HOUR);
  const x = setup(); configure(x, [task, second]);
  await x.engine.command({ type: "start" });
  tickMinutes(x, 60);
  assert.equal(x.engine.view().state.mode, "work");
  assert.equal(x.engine.view().state.taskId, "b");
  assert.equal(x.engine.view().state.workMs, HOUR);
  assert.deepEqual(x.notifications.map(e => e.type), ["turn-complete"]);
  tickMinutes(x, 60);
  assert.equal(x.engine.view().state.taskId, "a");
  assert.deepEqual(x.engine.view().state.rotation?.totals, { a: HOUR, b: HOUR });
  await x.engine.command({ type: "pause" });
  tickMinutes(x, 120);
  assert.equal(x.engine.view().state.workMs, 2 * HOUR);
  assert.equal(x.notifications.length, 2);
  assert.equal(statusModel(x.engine.view()).done, false);
});

test("new middle tasks catch up in consecutive one-hour turns", async () => {
  const saved = createTracking([task, second, third], "10:01", "UTC", T, PLAN);
  saved.rotation!.totals = { a: 2 * HOUR, b: 0, c: 2 * HOUR };
  const x = setup(saved); await x.engine.identity(null); await x.engine.command({ type: "start" });
  assert.equal(x.engine.view().state.taskId, "b");
  const firstKey = eventScheduleKey(x.engine.view().state);
  tickMinutes(x, 60);
  assert.equal(x.engine.view().state.taskId, "b");
  assert.notEqual(eventScheduleKey(x.engine.view().state), firstKey);
  assert.equal(statusModel(x.engine.view()).remaining, HOUR);
  assert.match(x.notifications[0].body, /Keep working on Expo/);
  tickMinutes(x, 60);
  assert.equal(x.engine.view().state.taskId, "a");
  assert.deepEqual(x.engine.view().state.rotation?.totals, { a: 2 * HOUR, b: 2 * HOUR, c: 2 * HOUR });
  assert.equal(new Set(x.notifications.map(e => e.id)).size, 2);
});

test("fractional catch-up progress and wakeups use the actual turn duration", async () => {
  const saved = createTracking([task, second], "23:00", "UTC", T, PLAN);
  saved.rotation!.totals = { a: 2 * HOUR, b: HOUR + 30 * MIN };
  const x = setup(saved); await x.engine.identity(null); await x.engine.command({ type: "start" });
  assert.equal(x.engine.view().state.rotation?.turn?.durationMs, 30 * MIN);
  const key = eventScheduleKey(x.engine.view().state);
  tickMinutes(x, 15);
  const m = statusModel(x.engine.view());
  assert.equal(m.progress, 0.5); assert.equal(m.remaining, 15 * MIN);
  assert.equal(eventScheduleKey(x.engine.view().state), key);
  tickMinutes(x, 15);
  assert.equal(x.engine.view().state.taskId, "a");
  assert.equal(x.notifications[0].title, "Caught up");
});

test("completion and removal immediately switch active work to an eligible task", async () => {
  for (const remove of [false, true]) {
    const x = setup(); configure(x, [task, second]); await x.engine.command({ type: "start" });
    x.now += 5 * MIN;
    configure(x, remove ? [second] : [{ ...task, completed: true }, second]);
    assert.equal(x.engine.view().state.mode, "work");
    assert.equal(x.engine.view().state.taskId, "b");
    configure(x, []);
    assert.equal(x.engine.view().state.mode, "idle");
    assert.equal(statusModel(x.engine.view()).done, true);
    assert.equal(statusModel(x.engine.view()).canStart, false);
    assert.equal(x.engine.view().state.rotation?.totals.a, 5 * MIN);
  }
});

test("old daily preferences never affect the desktop picker or stop active work", async () => {
  const tasks = [task, { ...second, dueDate: "2030-01-01", priority: "high" as const }];
  const x = setup();
  x.engine.configure({ tasks, endTime: "10:01", plan: PLAN, accountId: null, minimumMinutes: 1440 });
  await x.engine.command({ type: "start" }); tickMinutes(x, 60);
  assert.equal(x.engine.view().state.taskId, "b");
  x.engine.configure({ tasks, endTime: "09:00", plan: { ...PLAN, idleParts: 20 }, accountId: null, unweighted: true, minimumEnabled: false });
  assert.equal(x.engine.view().state.mode, "work");
  assert.equal(x.engine.view().state.taskId, "b");
  assert.deepEqual(taskProgress(x.engine.view().state).map(p => p.trackedMs), [HOUR, 0]);
});

test("paused turns stay quiet and static without a renderer or recurring disk writes", async () => {
  const x = setup(createTracking([task], "23:00", "UTC", T, PLAN)); await x.engine.identity(null);
  tickMinutes(x, 400);
  assert.equal(x.notifications.length, 0); assert.equal(x.engine.view().state.workMs, 0);
  assert.equal(statusModel(x.engine.view()).remaining, HOUR); assert.equal(x.writes, 0);
  await x.engine.command({ type: "start" }); tickMinutes(x, 1); await x.engine.command({ type: "pause" });
  const writes = x.writes; tickMinutes(x, 1);
  assert.equal(x.writes, writes); assert.equal(statusModel(x.engine.view()).remaining, 59 * MIN);
});

test("sleep resumes the ongoing rotation without replaying old alerts", async () => {
  const x = setup(); configure(x, [task, second]);
  x.now += 4 * HOUR; await x.engine.resume();
  assert.equal(x.engine.view().state.workMs, 0);
  await x.engine.command({ type: "start" }); x.now += 2 * HOUR; await x.engine.resume();
  assert.equal(x.notifications.length, 0);
  assert.equal(x.engine.view().state.workMs, 2 * HOUR); assert.equal(x.engine.view().state.mode, "work");
  assert.deepEqual(x.engine.view().state.rotation?.totals, { a: HOUR, b: HOUR });
});

test("midnight resets today's counters while rotation survives desktop restart", async () => {
  const midnight = Date.parse("2026-09-16T00:00:00Z");
  const x = setup(taskBoundary(midnight - HOUR), midnight - HOUR); await x.engine.identity(null);
  tickMinutes(x, 60);
  assert.equal(x.written?.workMs, 0); assert.deepEqual(x.written?.taskMs, {});
  assert.equal(x.written?.mode, "work"); assert.equal(x.written?.taskId, "b");
  assert.deepEqual(x.written?.rotation?.totals, { a: HOUR });
  const reopened = setup(x.written, x.now); await reopened.engine.identity(null);
  tickMinutes(reopened, 1);
  assert.equal(reopened.engine.view().state.workMs, MIN);
  assert.deepEqual(taskProgress(reopened.engine.view().state).map(p => p.trackedMs), [HOUR, MIN]);
});

test("legacy and pacing migrations persist once without losing work, ownership or alert choices", async () => {
  for (const make of [legacyCreate, pacedCreate]) {
    const saved = make([task, second], "23:00", "UTC", T, PLAN);
    Object.assign(saved, { workMs: 45 * MIN, taskMs: { a: 45 * MIN }, controllerId: "windows_test" });
    const x = setup(saved); x.engine.settings = { alerts: false, sound: false, mini: true, launchAtLogin: true };
    await x.engine.identity(null); x.engine.tick();
    assert.equal(x.written?.rotation?.version, 1); assert.equal(x.written?.pacing, undefined);
    assert.equal(x.written?.workMs, 45 * MIN); assert.deepEqual(x.written?.rotation?.totals, { a: 45 * MIN });
    assert.equal(x.written?.controllerId, "windows_test");
    assert.deepEqual(x.engine.view().settings, { alerts: false, sound: false, mini: true, launchAtLogin: true });
    assert.equal(x.notifications.length, 0);
    const reopened = setup(x.written); await reopened.engine.identity(null); reopened.engine.tick();
    assert.equal(reopened.writes, 0);
    assert.deepEqual(reopened.engine.view().state.rotation, x.written?.rotation);
  }
});

test("legacy reset clears only today's counters and leaves cumulative hours intact", async () => {
  const x = setup(); configure(x); await x.engine.command({ type: "start" }); tickMinutes(x, 5);
  await x.engine.command({ type: "reset" });
  assert.equal(x.written?.workMs, 0); assert.equal(x.written?.mode, "idle");
  assert.deepEqual(x.written?.rotation?.totals, { a: 5 * MIN });
});

test("account timer creation preserves saved compatibility fields", async () => {
  const x = setup();
  x.response(async path => ({ status: 200, body: path === "/api/tracking"
    ? { tracking: null, serverNow: x.now }
    : { state: { tasks: [task], endTime: "23:00", unweighted: true, minimumEnabled: false, minimumMinutes: 15 } } }));
  await x.engine.identity("user");
  assert.equal(x.engine.view().state.unweighted, true); assert.equal(x.engine.view().state.minimumEnabled, false);
  assert.equal(x.engine.view().state.minimumMinutes, 15); assert.equal(x.engine.view().state.rotation?.version, 1);
});

test("sync checkpoints cannot swallow or duplicate boundaries in either timer/refresh ordering", async () => {
  for (const tickFirst of [false, true]) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
    if (tickFirst) x.engine.tick();
    await x.engine.refresh(); x.engine.tick(); await x.engine.refresh(); x.engine.tick();
    assert.equal(x.engine.view().state.taskId, "b"); assert.equal(x.engine.view().state.mode, "work");
    assert.equal(x.notifications.length, 1); assert.equal(x.notifications[0].type, "turn-complete");
    assert.match(x.notifications[0].body, /Now tracking Expo/);
  }
});

test("unchanged account snapshots deliver ongoing hourly boundaries exactly once", async () => {
  const { x } = await accountBeforeBoundary();
  await x.engine.refresh(); x.engine.tick(); await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1);
  for (let i = 0; i < 60; i++) { x.now += MIN; await x.engine.refresh(); x.engine.tick(); }
  assert.equal(x.notifications.length, 2); assert.equal(x.engine.view().state.taskId, "a");
});

test("metadata edits and obsolete preference changes preserve a due turn notification", async () => {
  const initial = taskBoundary(), fixture = await accountBeforeBoundary(initial); const { x } = fixture;
  fixture.remote = { ...configureTracking(initial, initial.tasks.map(t => ({ ...t, title: t.title + "!" })), "10:00", x.now, { ...PLAN, idleParts: 20 }, true, false), revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.match(x.notifications[0].body, /Expo!/);
});

test("task edits after a boundary keep running and update recovered notification text", async () => {
  for (const removeNext of [false, true]) {
    const initial = taskBoundary(), fixture = await accountBeforeBoundary(initial); const { x } = fixture;
    const tasks = removeNext ? [task] : initial.tasks.map(t => t.id === "a" ? { ...t, completed: true } : t);
    fixture.remote = { ...configureTracking(initial, tasks, initial.endTime, x.now), revision: 1 };
    await x.engine.refresh(); x.engine.tick();
    assert.equal(x.notifications.length, 1); assert.equal(x.engine.view().state.mode, "work");
    assert.equal(x.engine.view().state.taskId, removeNext ? "a" : "b");
    if (removeNext) assert.doesNotMatch(x.notifications[0].body, /Expo/);
    for (let i = 0; i < 10; i++) { x.now += MIN; await x.engine.refresh(); x.engine.tick(); }
    assert.equal(x.notifications.length, 1); assert.ok(x.engine.view().state.workMs > HOUR);
  }
});

test("guest task edits preserve a due notification with the latest task title", async () => {
  const initial = taskBoundary(), before = T + HOUR - 1000;
  const x = setup(advanceTracking(initial, before).state, before); await x.engine.identity(null); x.now += 1025;
  configure(x, [task, { ...second, title: "Expo edited" }]);
  x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.match(x.notifications[0].body, /Expo edited/);
});

test("midnight server checkpoint recovery preserves the alert and cumulative history", async () => {
  const at = Date.parse("2026-09-16T00:00:00Z"), initial = taskBoundary(at - HOUR);
  const fixture = await accountBeforeBoundary(initial, at); const { x } = fixture;
  fixture.remote = { ...advanceTracking(initial, x.now).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick(); await x.engine.refresh();
  assert.equal(x.notifications.length, 1); assert.equal(x.notifications[0].at, at);
  assert.equal(x.engine.view().state.workMs, 25);
  assert.deepEqual(x.engine.view().state.rotation?.totals, { a: HOUR, b: 25 });
});

test("a server migration checkpoint preserves command sequence, ownership and following hour alerts", async () => {
  const old = pacedCreate([task, second], "23:00", "UTC", T, PLAN);
  Object.assign(old, { controllerId: "windows_test", workMs: 10 * MIN, taskMs: { a: 10 * MIN }, revision: 3 });
  old.pacing!.commandSeq = 8;
  const x = setup();
  let remote: TrackingState = old;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now } }));
  await x.engine.identity("user");
  remote = { ...advanceTracking(old, T).state, revision: 4 };
  await x.engine.refresh();
  assert.equal(x.engine.view().state.rotation?.commandSeq, 8);
  assert.equal(x.engine.view().state.controllerId, "windows_test");
  remote = { ...actOnTracking(remote, { type: "start" }, "windows_test", T), revision: 5 };
  await x.engine.refresh();
  x.now = T + 10 * MIN - 1000; await x.engine.refresh(); x.engine.tick();
  x.now += 1025; await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.equal(x.notifications[0].title, "Caught up");
  assert.equal(x.engine.view().state.taskId, "a");
});

test("delayed polls cannot replace a newer checkpoint or replay a delivered alert", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture;
  const latest = { ...advanceTracking(taskBoundary(), x.now).state, revision: 2 };
  fixture.remote = latest; await x.engine.refresh();
  fixture.remote = { ...taskBoundary(), revision: 2, controllerId: "stale_owner" };
  x.now += 1000; await x.engine.refresh(); x.engine.tick();
  assert.equal(x.engine.view().state.taskId, "b"); assert.equal(x.engine.view().state.controllerId, "windows_test");
  fixture.remote = { ...latest, revision: 1, controllerId: "stale_owner" };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.equal(x.engine.view().state.revision, 2);
});

test("checkpoint recovery handles a server clock offset without replay on initial sign-in", async () => {
  const x = setup(); const offset = 15 * MIN;
  let remote = taskBoundary(); x.now = T + HOUR - offset - 1000;
  x.response(async () => ({ status: 200, body: { tracking: remote, serverNow: x.now + offset } }));
  await x.engine.identity("user"); x.engine.tick(); assert.equal(x.notifications.length, 0);
  x.now += 1025; remote = { ...advanceTracking(remote, x.now + offset).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 1); assert.equal(x.notifications[0].at, T + HOUR);
});

test("reset, pause, command-sequence, ownership and history changes cancel obsolete alerts", async () => {
  for (const mutation of ["reset", "pause", "command", "owner", "today", "totals", "duration"] as const) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    let changed = mutation === "reset" || mutation === "pause"
      ? actOnTracking(taskBoundary(), { type: mutation }, "windows_test", x.now - 500)
      : advanceTracking(taskBoundary(), x.now).state;
    if (mutation === "command") changed.rotation!.commandSeq++;
    if (mutation === "owner") changed.controllerId = "phone_device";
    if (mutation === "today") { changed.taskMs.a -= 2000; changed.taskMs.b += 2000; }
    if (mutation === "totals") changed.rotation!.totals.a -= 2000;
    if (mutation === "duration") changed.rotation!.turn!.durationMs -= 2000;
    fixture.remote = { ...changed, revision: 1 };
    await x.engine.refresh(); x.engine.tick();
    assert.equal(x.notifications.length, 0, mutation);
  }
});

test("disabled alerts retain the latest message and dedupe recovered events", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture; x.engine.settings.alerts = false;
  fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 0); assert.match(x.engine.view().message!, /One-hour turn complete/);
  assert.ok(x.diagnostics.some(e => e.kind === "alert-skipped" && e.reason === "alerts-disabled"));
  x.engine.settings.alerts = true; await x.engine.refresh(); x.engine.tick();
  assert.equal(x.notifications.length, 0);
});

test("stale sync, ownership and replaced checkpoints have diagnostic suppression reasons", async () => {
  for (const reason of ["sync-stale", "different-controller", "checkpoint-replaced"] as const) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    if (reason === "sync-stale") { x.now += 120_000; x.engine.tick(); }
    else {
      const next = reason === "checkpoint-replaced"
        ? actOnTracking(taskBoundary(), { type: "pause" }, "windows_test", x.now)
        : { ...advanceTracking(taskBoundary(), x.now).state, controllerId: "phone_device" };
      fixture.remote = { ...next, revision: 1 }; await x.engine.refresh(); x.engine.tick();
    }
    assert.ok(x.diagnostics.some(e => e.kind === "alert-skipped" && e.reason === reason && e.eventType === "turn-complete"), reason);
    assert.equal(x.notifications.length, 0);
  }
});

test("unchanged paused ticks do not generate diagnostic writes", () => {
  const x = setup(); configure(x); x.diagnostics.length = 0;
  for (let i = 0; i < 500; i++) { x.now += 1000; x.engine.tick(); }
  assert.equal(x.diagnostics.length, 0);
});

test("a recovered alert is logged once and logger failure cannot break tracking", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture;
  fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
  await x.engine.refresh(); x.engine.tick(); await x.engine.refresh(); x.engine.tick();
  assert.equal(x.diagnostics.filter(e => e.kind === "alert-requested").length, 1);
  let now = T; const delivered: TrackingEvent[] = [];
  const engine = new TrackerEngine({ now: () => now, request: async () => ({ status: 503, body: {} }), saveGuest: () => {}, publish: () => {},
    diagnostic: () => { throw new Error("disk full"); }, notify: e => delivered.push(e),
  }, "windows_test", taskBoundary());
  await engine.identity(null); now += HOUR - 1000; engine.tick(); now += 1025; engine.tick();
  assert.equal(delivered.length, 1);
});

test("cold start, reconnection and sleep do not replay old checkpoint alerts", async () => {
  for (const scenario of ["cold", "offline", "sleep", "next-day"] as const) {
    const fixture = await accountBeforeBoundary(); const { x } = fixture;
    if (scenario === "cold") await x.engine.identity(null);
    if (scenario === "offline" || scenario === "sleep") x.now += 120_000;
    if (scenario === "next-day") x.now += 24 * HOUR;
    fixture.remote = { ...advanceTracking(taskBoundary(), x.now).state, revision: 1 };
    if (scenario === "cold") await x.engine.identity("user");
    else if (scenario === "sleep") await x.engine.resume();
    else await x.engine.refresh();
    x.engine.tick(); assert.equal(x.notifications.length, 0, scenario);
  }
});

test("account commands use the latest revision and never create an offline timer", async () => {
  const x = setup(); let remote = createTracking([task], "23:00", "UTC", T, PLAN); remote.revision = 8;
  x.response(async (_path, method, body: any) => {
    if (method === "POST") { assert.equal(body.revision, remote.revision); remote = { ...actOnTracking(remote, body.action, body.controllerId, x.now), revision: remote.revision + 1 }; }
    return { status: 200, body: { tracking: remote, serverNow: x.now } };
  });
  await x.engine.identity("user-a"); await x.engine.command({ type: "start" });
  assert.equal(x.engine.view().state.mode, "work"); assert.equal(x.engine.view().state.revision, 9);
  x.response(async () => ({ status: 0, body: {} })); await assert.rejects(x.engine.command({ type: "pause" }));
  assert.equal(x.engine.view().state.mode, "work"); assert.equal(x.written, undefined);
});

test("another device's pause and alert ownership are respected", async () => {
  const x = setup(); let remote: TrackingState = { ...taskBoundary(), controllerId: "phone_device" };
  x.now = T + HOUR - 1000;
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
  const pending = x.engine.identity("account"); await x.engine.identity(null);
  resolve({ status: 200, body: { tracking: createTracking([], "20:00", "UTC", T), serverNow: T } }); await pending;
  assert.equal(x.engine.view().accountId, null); assert.equal(x.engine.view().state.taskId, "a");
  assert.throws(() => x.engine.configure({ tasks: [], endTime: "20:00", plan: PLAN, accountId: "forged" }));
});

test("revision conflicts refresh and report instead of overwriting", async () => {
  const x = setup(); const remote = createTracking([task], "23:00", "UTC", T, PLAN);
  x.response(async (_path, method) => method === "POST" ? { status: 409, body: { error: "Changed elsewhere" } } : { status: 200, body: { tracking: remote, serverNow: x.now } });
  await x.engine.identity("user"); await assert.rejects(x.engine.command({ type: "start" }), /Changed elsewhere/);
  assert.equal(x.engine.view().state.mode, "idle");
});

test("cold offline account does not allow tracking before loading its state", async () => {
  const x = setup(); await x.engine.identity("user");
  assert.equal(x.engine.view().ready, false); await assert.rejects(x.engine.command({ type: "start" }));
});

test("an incompatible tracking protocol shows the update error and blocks commands and alerts", async () => {
  const fixture = await accountBeforeBoundary(); const { x } = fixture;
  x.response(async () => ({ status: 426, body: { error: TRACKING_UPDATE_REQUIRED } }));
  await x.engine.refresh(); x.engine.tick();
  assert.equal(x.engine.view().ready, false);
  assert.equal(x.engine.view().error, TRACKING_UPDATE_REQUIRED);
  assert.equal(x.notifications.length, 0);
  assert.equal(x.engine.view().state.controllerId, "windows_test");
  await assert.rejects(x.engine.command({ type: "pause" }));
  assert.equal(x.written, undefined);
});

test("IPC accepts only picker starts and rejects obsolete per-task and continue controls", () => {
  assert.deepEqual(validateApi({ path: "/api/state", method: "GET" }), { path: "/api/state", method: "GET" });
  for (const path of ["https://evil.test", "file:///C:/private", "/api/state?x=y", "/api/tracking", "/api/../secret"]) assert.throws(() => validateApi({ path, method: "GET" }));
  assert.throws(() => validateApi({ path: "/api/state", method: "PUT", body: "{" }));
  assert.deepEqual(validateAction({ type: "start" }), { type: "start" });
  assert.deepEqual(validateAction({ type: "pause", taskId: "ignored" }), { type: "pause" });
  for (const action of [{ type: "shell" }, { type: "skip-rest" }, { type: "continue" }, { type: "start", taskId: "b" }, { type: "start", taskId: 42 }]) assert.throws(() => validateAction(action));
  assert.ok(trustedPage("yantasks://app/index.html?mini=1"));
  assert.ok(!trustedPage("https://app/index.html")); assert.ok(!trustedPage("yantasks://evil/index.html"));
});

test("power policy preserves boundary wakeups while lowering paused and battery polling", () => {
  assert.equal(syncDelay(false, false, true), 60_000); assert.equal(syncDelay(true, false, true), 30_000);
  assert.equal(syncDelay(true, false, false), 15_000); assert.equal(syncDelay(true, true, false), 5000);
  assert.equal(wakeDelay(false, null), 60_000); assert.equal(wakeDelay(false, 2300), 2325);
  assert.equal(wakeDelay(true, 60_000), 1000); assert.equal(wakeDelay(false, -10), 100);
  const paused = createTracking([task], "23:00", "UTC", T, PLAN);
  const working = actOnTracking(paused, { type: "start" }, "windows_test", T);
  assert.equal(hasLiveCountdown(paused), false); assert.equal(hasLiveCountdown(working), true);
  assert.equal(hasLiveCountdown(advanceTracking(working, T + HOUR).state), true);
});

test("taskbar model shows a running or paused turn and is done only with no open tasks", async () => {
  const x = setup(); configure(x);
  let m = statusModel(x.engine.view()); assert.equal(m.label, "Paused"); assert.equal(m.canStart, true);
  assert.equal(m.remaining, HOUR);
  await x.engine.command({ type: "start" }); tickMinutes(x, 1);
  m = statusModel(x.engine.view()); assert.equal(m.label, "Working"); assert.equal(m.title, "Code");
  assert.equal(m.remaining, 59 * MIN); assert.ok(m.tooltip.length <= 127); assert.equal(m.progress, 1 / 60);
  await x.engine.command({ type: "pause" }); tickMinutes(x, 60);
  m = statusModel(x.engine.view()); assert.equal(m.remaining, 59 * MIN); assert.equal(m.progress, -1);
  assert.equal(m.canStart, true); assert.equal(m.done, false); assert.equal(x.engine.view().state.workMs, MIN);
  assert.doesNotMatch(m.windowTitle + m.tooltip, /recommend|goal|budget|idle/i);
  configure(x, [{ ...task, completed: true }]);
  m = statusModel(x.engine.view()); assert.equal(m.done, true); assert.equal(m.canStart, false); assert.equal(m.label, "All done");
});
