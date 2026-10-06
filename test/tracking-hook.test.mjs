import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTrackingHook } = require("../.test-build/use-tracking.js");
const { createTracking, actOnTracking } = require("../.test-build/tracking.js");
const legacyCreate = require("../.test-build/legacy-tracking.js").createTracking;
const { api } = require("../.test-build/remote.js");

// Exercise the shared hook through its injected hook/adapter boundary without
// adding another React renderer (web and mobile use separate React versions).
// 08:00–18:00 at 3:1 holds 450 minutes of work, matching the timer tests.
const PLAN = { startTime: "08:00", workParts: 3, idleParts: 1 };
function mount(adapter, { tasks = [], endTime = "23:00", plan = PLAN, accountId = null, unweighted = false, minimumEnabled = true, minimumMinutes = 30 } = {}) {
  const slots = [];
  let index = 0, dirty = true, effects = [], result;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = {
    useState(initial) {
      const i = index++;
      slots[i] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[i].value, value => {
        const next = typeof value === "function" ? value(slots[i].value) : value;
        if (!Object.is(next, slots[i].value)) { slots[i].value = next; dirty = true; }
      }];
    },
    useRef(initial) { const i = index++; slots[i] ??= { current: initial }; return slots[i]; },
    useMemo(fn, deps) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() };
      return slots[i].value;
    },
    useCallback(fn, deps) { return hooks.useMemo(() => fn, deps); },
    useEffect(fn, deps) {
      const i = index++;
      if (!same(slots[i]?.deps, deps)) effects.push(() => {
        slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() };
      });
    },
  };
  const useTracking = createTrackingHook(hooks, adapter);
  const beforeCommand = async () => {};
  return {
    get value() { return result; },
    setUnweighted(value) { unweighted = value; dirty = true; },
    setMinimumEnabled(value) { minimumEnabled = value; dirty = true; },
    setMinimumMinutes(value) { minimumMinutes = value; dirty = true; },
    async flush() {
      for (let i = 0; i < 12; i++) {
        if (dirty) {
          dirty = false; index = 0; effects = [];
          result = useTracking(tasks, endTime, plan, accountId, true, beforeCommand, unweighted, minimumEnabled, minimumMinutes);
          for (const effect of effects) effect();
        }
        await new Promise(resolve => setImmediate(resolve));
      }
      assert.equal(dirty, false, "hook should settle");
    },
    unmount() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

let permission = "Alerts enabled", foreground, requested = 0, unsubscribed = 0;
const adapter = {
  read: async () => null, write: async () => {}, controllerId: async () => "test-device",
  notificationPermission: async () => permission,
  onForeground: listener => { foreground = listener; return () => { foreground = null; unsubscribed++; }; },
  enableNotifications: async () => { requested++; permission = "Alerts enabled"; return permission; },
  scheduleNotifications: async () => {}, notify: () => {},
};
let tracker = mount(adapter);
try {
  await tracker.flush();
  assert.equal(tracker.value.permission, "Alerts enabled");
  assert.equal(requested, 0, "startup must only read permission, not prompt");
  permission = "Alerts blocked — enable in device settings";
  foreground(); await tracker.flush();
  assert.equal(tracker.value.permission, permission, "returning from settings refreshes permission");
  await tracker.value.enableNotifications(); await tracker.flush();
  assert.equal(tracker.value.permission, "Alerts enabled"); assert.equal(requested, 1);
} finally { tracker.unmount(); }
tracker = mount(adapter);
try {
  await tracker.flush();
  assert.equal(tracker.value.permission, "Alerts enabled", "a fresh mount restores granted permission");
  assert.equal(requested, 1, "refresh never asks again");
} finally { tracker.unmount(); }
assert.equal(unsubscribed, 2);

let finishRead;
tracker = mount({ ...adapter, notificationPermission: () => new Promise(resolve => { finishRead = resolve; }) });
try {
  await tracker.flush();
  assert.equal(tracker.value.permission, "Checking alerts…");
  await tracker.value.enableNotifications();
  finishRead("Enable alerts"); await tracker.flush();
  assert.equal(tracker.value.permission, "Alerts enabled", "a stale startup read must not undo a grant");
} finally { tracker.unmount(); }
console.log("5 alert permission lifecycle scenarios passed");

const realNow=Date.now, start=Date.parse("2026-09-14T08:00:00Z"), minute=60_000;
const tasks=["a","b"].map(id=>({id,title:id,description:"",dueDate:"2026-09-14",createdAt:new Date(start).toISOString(),completed:false,completedAt:null}));
const legacy={...legacyCreate(tasks,"10:00","UTC",start,PLAN),mode:"work",taskId:"a",controllerId:"test-device"};
delete legacy.allocationVersion;
let saved=JSON.stringify(legacy), writes=0;
Date.now=()=>start+60*minute;
tracker=mount({...adapter,read:async()=>saved,write:async value=>{saved=value;writes++;}}, {tasks,endTime:"10:00"});
try {
  await tracker.flush();
  assert.equal(writes,1,"guest migration must persist its checkpoint");
  assert.equal(tracker.value.state.allocationVersion,2);
  assert.equal(tracker.value.state.taskMs.a,60*minute);
  assert.equal(tracker.value.state.taskMs.b??0,0);
  assert.equal(tracker.value.remainingWorkMs,60*minute);
  await tracker.value.refresh(); await tracker.flush();
  assert.equal(writes,1,"polling must not repeat the migration");
  assert.equal(JSON.parse(saved).revision,1);
} finally { tracker.unmount(); Date.now=realNow; }
console.log("1 guest allocation upgrade scenario passed");

Date.now = () => start + 70 * minute;
saved = JSON.stringify({ ...legacyCreate(tasks, "10:00", "UTC", start, PLAN), workOnlyVersion: 1, mode: "work", taskId: "a", controllerId: "test-device" });
writes = 0;
const workOnlyAdapter = { ...adapter, read: async () => saved, write: async value => { saved = value; writes++; } };
tracker = mount(workOnlyAdapter, { tasks, endTime: "10:00" });
try {
  await tracker.flush();
  assert.equal(writes, 1); assert.equal(JSON.parse(saved).workOnlyVersion, undefined);
  assert.equal(tracker.value.state.workMs, 70 * minute);
  assert.deepEqual(tracker.value.state.taskMs, { a: 60 * minute, b: 10 * minute });
  assert.equal(tracker.value.state.controllerId, "test-device");
  tracker.unmount(); tracker = mount(workOnlyAdapter, { tasks, endTime: "10:00" });
  await tracker.flush(); await tracker.value.refresh(); await tracker.flush();
  assert.equal(writes, 1); assert.equal(tracker.value.state.workMs, 70 * minute);
} finally { tracker.unmount(); Date.now = realNow; }
console.log("1 guest work-only rollback and remount scenario passed");

const coverage = { ...legacyCreate(tasks, "18:00", "UTC", start, PLAN), coverageVersion: 1, coverageDays: 3, coverageGoalMs: 100 * minute, mode: "work", taskId: "a", controllerId: "test-device" };
Date.now = () => start + 70 * minute;
saved = JSON.stringify(coverage); writes = 0;
const rollbackAdapter = { ...adapter, read: async () => saved, write: async value => { saved = value; writes++; } };
tracker = mount(rollbackAdapter, { tasks, endTime: "18:00" });
try {
  await tracker.flush();
  assert.equal(writes, 1); assert.equal(JSON.parse(saved).coverageVersion, undefined);
  assert.equal(tracker.value.state.workMs, 70 * minute);
  assert.equal(tracker.value.state.taskMs.a, 50 * minute); assert.equal(tracker.value.state.taskMs.b, 20 * minute);
  assert.equal(tracker.value.state.controllerId, "test-device");
  await tracker.value.refresh(); await tracker.flush(); assert.equal(writes, 1);
  tracker.unmount(); tracker = mount(rollbackAdapter, { tasks, endTime: "18:00" });
  await tracker.flush(); assert.equal(writes, 1); assert.equal(tracker.value.state.workMs, 70 * minute);
} finally { tracker.unmount(); Date.now = realNow; }
console.log("1 guest coverage rollback and remount scenario passed");

Date.now = () => start;
saved = JSON.stringify(createTracking(tasks, "18:00", "UTC", start, PLAN));
const persistentAdapter = { ...adapter, read: async () => saved, write: async value => { saved = value; } };
tracker = mount(persistentAdapter, { tasks, endTime: "18:00" });
try {
  await tracker.flush();
  const goal = tracker.value.remainingWorkMs;
  tracker.setUnweighted(true); tracker.setMinimumEnabled(false); tracker.setMinimumMinutes(5);
  await tracker.flush();
  assert.equal(tracker.value.remainingWorkMs,goal,"retired allocation controls cannot change pacing");
  assert.ok(tracker.value.progress.every(p=>p.weight===2 && !p.skipped));
  await tracker.value.command({type:"start"}); await tracker.flush();
  Date.now = () => start + 10*minute;
  await tracker.value.command({type:"pause"}); await tracker.flush();
  assert.equal(tracker.value.state.workMs,10*minute);
  tracker.unmount(); Date.now = () => start + 60*minute;
  tracker=mount(persistentAdapter,{tasks,endTime:"18:00"});
  await tracker.flush();
  assert.equal(tracker.value.state.workMs,10*minute);
  assert.equal(tracker.value.state.pacing.turn.elapsedMs,10*minute);
  assert.equal(tracker.value.remainingWorkMs,goal-10*minute,"paused time leaves the recommendation alone");
  await tracker.value.command({type:"start"}); await tracker.flush();
  Date.now=()=>start+90*minute; await tracker.value.refresh(); await tracker.flush();
  assert.equal(tracker.value.state.workMs,30*minute,"resume stops at the original turn boundary");
  assert.equal(tracker.value.state.mode,"idle");
} finally { tracker.unmount(); Date.now=realNow; }
console.log("1 guest pacing, retired-settings and partial-turn persistence scenario passed");

// Persist the no-borrowing checkpoint without a command, preserving today's
// work on both the first load and a remount. Tomorrow starts without old debt.
const beforeBorrowing = legacyCreate(tasks, "18:00", "UTC", start, PLAN);
delete beforeBorrowing.idlePolicyVersion;
delete beforeBorrowing.workLimitVersion;
beforeBorrowing.carryMs = 60 * minute;
beforeBorrowing.workMs = 40 * minute;
beforeBorrowing.taskMs = { a: 30 * minute, b: 10 * minute };
beforeBorrowing.cursor = start + 40 * minute;
Date.now = () => start + 160 * minute;
saved = JSON.stringify(beforeBorrowing);
tracker = mount(persistentAdapter, { tasks, endTime: "18:00" });
try {
  await tracker.flush();
  assert.equal(JSON.parse(saved).carryMs, undefined);
  assert.equal(JSON.parse(saved).idlePolicyVersion, 2);
  assert.equal(tracker.value.state.mode, "idle"); assert.equal(tracker.value.state.workMs, 40 * minute);
  assert.deepEqual(tracker.value.state.taskMs, beforeBorrowing.taskMs);
  tracker.unmount();
  tracker = mount(persistentAdapter, { tasks, endTime: "18:00" });
  await tracker.flush();
  assert.equal(tracker.value.state.workMs, 40 * minute);
  assert.deepEqual(tracker.value.state.taskMs, beforeBorrowing.taskMs);
  tracker.unmount();
  Date.now = () => start + 24 * 60 * minute;
  tracker = mount(persistentAdapter, { tasks, endTime: "18:00" });
  await tracker.flush();
  assert.equal(JSON.parse(saved).carryMs, undefined);
  assert.equal(tracker.value.remainingWorkMs, 120 * minute);
  assert.equal(tracker.value.state.workMs, 0); assert.equal(tracker.value.state.mode, "idle");
  await tracker.value.command({ type: "reset" }); await tracker.flush();
  assert.equal(JSON.parse(saved).carryMs, undefined);
} finally { tracker.unmount(); Date.now = realNow; }
console.log("1 data-preserving guest no-borrowing upgrade, remount and rollover scenario passed");

const fixedGoal = legacyCreate(tasks, "18:00", "UTC", start, PLAN);
delete fixedGoal.workLimitVersion;
Object.assign(fixedGoal, { mode: "work", taskId: "a", workMs: 140 * minute, taskMs: { a: 140 * minute }, cursor: start + 400 * minute, controllerId: "test-device" });
Date.now = () => start + 450 * minute;
saved = JSON.stringify(fixedGoal);
let capWrites = 0;
const capAdapter = { ...persistentAdapter, write: async value => { saved = value; capWrites++; } };
tracker = mount(capAdapter, { tasks, endTime: "18:00" });
try {
  await tracker.flush();
  assert.equal(capWrites, 1);
  assert.equal(JSON.parse(saved).workLimitVersion, 1);
  assert.equal(tracker.value.state.workMs, 190 * minute);
  assert.deepEqual(tracker.value.state.taskMs, { a: 190 * minute });
  assert.equal(tracker.value.remainingWorkMs, 0);
  tracker.unmount();
  tracker = mount(capAdapter, { tasks, endTime: "18:00" });
  await tracker.flush();
  assert.equal(capWrites, 1, "remount must not repeat the allocation checkpoint");
  assert.deepEqual(tracker.value.state.taskMs, { a: 190 * minute });
  await tracker.value.command({ type: "pause" }); await tracker.flush();
  Date.now = () => start + 460 * minute;
  await tracker.value.refresh(); await tracker.flush();
  assert.equal(tracker.value.state.workMs, 190 * minute);
  assert.equal(tracker.value.remainingWorkMs, 0);
  assert.equal(tracker.value.state.mode, "idle");
} finally { tracker.unmount(); Date.now = realNow; }
console.log("1 guest capped-target migration and paused-time regression scenario passed");

// Poll responses used to reset both the offset and the repaint phase, causing
// seconds to repeat or skip as response latency changed. Fake only scheduling;
// the real hook, projection, and asynchronous adoption still run.
const realTimers = { setTimeout, clearTimeout, setInterval, clearInterval };
const realLoadTracking = api.loadTracking;
let wall = start + 123, nextTimer = 0;
const timeouts = new Map(), intervals = new Map();
globalThis.setTimeout = (fn, delay) => { const id = ++nextTimer; timeouts.set(id, { fn, at: wall + delay }); return id; };
globalThis.clearTimeout = id => timeouts.delete(id);
globalThis.setInterval = (fn, delay) => { const id = ++nextTimer; intervals.set(id, { fn, delay }); return id; };
globalThis.clearInterval = id => intervals.delete(id);
Date.now = () => wall;
let responseDelay = 0;
let remote = { ...actOnTracking(createTracking(tasks, "18:00", "UTC", start, PLAN), { type: "start" }, "test-device", start), revision: 2 };
api.loadTracking = async () => ({ tracking: remote, serverNow: wall + 8000 - responseDelay });
tracker = mount(adapter, { tasks, endTime: "18:00", accountId: "account" });
const tickAt = async when => {
  wall = when;
  // The old implementation used an interval; keep this reproduction valid for both versions.
  for (const { fn, delay } of intervals.values()) if (delay === 1000) fn();
  for (const [id, timer] of [...timeouts]) if (timer.at <= wall) { timeouts.delete(id); timer.fn(); }
  await tracker.flush();
};
try {
  await tracker.flush();
  assert.equal(Math.floor(tracker.value.state.cursor / 1000) * 1000, start + 8000);
  await tickAt(start + 1000);
  const initialRemaining = tracker.value.remainingWorkMs;
  assert.equal(tracker.value.state.cursor, start + 9000);
  wall = start + 1300; responseDelay = 800;
  await tracker.value.refresh(); await tracker.flush();
  assert.equal(tracker.value.state.cursor, start + 9000, "a slow response must not rewind or insert a partial display second");
  await tickAt(start + 2000);
  assert.equal(tracker.value.remainingWorkMs, initialRemaining - 1000);
  wall = start + 2300; responseDelay = 20;
  await tracker.value.refresh(); await tracker.flush();
  assert.equal(tracker.value.state.cursor, start + 10_000, "a fast response must not accelerate the display");
  wall = start + 2400; remote = { ...remote, revision: 1 }; responseDelay = 60_000;
  await tracker.value.refresh(); await tracker.flush();
  await tickAt(start + 3000);
  assert.equal(tracker.value.state.cursor, start + 11_000, "a stale revision cannot alter the clock offset");
  assert.equal(tracker.value.remainingWorkMs, initialRemaining - 2000);
  remote = { ...remote, revision: 2 }; responseDelay = 50;
  wall = start + 5 * minute + 650;
  foreground(); await tracker.flush();
  assert.equal(tracker.value.state.cursor, start + 5 * minute + 8000, "foreground catches up immediately after throttling");
  assert.equal(tracker.value.state.workMs, 5 * minute + 8000, "foreground catches up only the explicitly tracked task");
} finally {
  tracker.unmount();
  Date.now = realNow; api.loadTracking = realLoadTracking;
  Object.assign(globalThis, realTimers);
}
assert.equal(timeouts.size, 0, "unmount removes the repaint timer");
assert.equal(intervals.size, 0, "unmount removes polling");
console.log("1 account countdown cadence and latency regression scenario passed");
