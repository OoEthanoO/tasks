import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createTrackingHook } = require("../.test-build/use-tracking.js");
const { createTracking } = require("../.test-build/tracking.js");
const old=require("../.test-build/legacy-tracking.js");
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
const legacy={...old.createTracking(tasks,"10:00","UTC",start,PLAN),mode:"work",taskId:"a",controllerId:"test-device"};
delete legacy.allocationVersion;
let saved=JSON.stringify(legacy),writes=0;
Date.now=()=>start+60*minute;
const persistentAdapter={...adapter,read:async()=>saved,write:async value=>{saved=value;writes++;}};
tracker=mount(persistentAdapter,{tasks,endTime:"10:00"});
try {
 await tracker.flush();assert.equal(writes,1);assert.equal(tracker.value.state.coverageVersion,1);
 assert.equal(tracker.value.state.taskMs.a,60*minute);assert.equal(tracker.value.state.taskMs.b??0,0);
 assert.equal(tracker.value.remainingWorkMs,30*minute);
 await tracker.value.refresh();await tracker.flush();assert.equal(writes,1);
 tracker.unmount();tracker=mount(persistentAdapter,{tasks,endTime:"00:00",unweighted:true,minimumEnabled:false,minimumMinutes:1});
 await tracker.flush();assert.equal(writes,1);assert.equal(tracker.value.remainingWorkMs,30*minute);
 await tracker.value.command({type:"pause"});await tracker.flush();
 Date.now=()=>start+120*minute;await tracker.value.refresh();await tracker.flush();
 assert.equal(tracker.value.state.workMs,60*minute);assert.equal(tracker.value.remainingWorkMs,30*minute);
 assert.equal(tracker.value.state.mode,"idle");
}finally{tracker.unmount();Date.now=realNow;}
console.log("Guest policy upgrade, remount, removed settings and paused countdown checks passed");

for(const kind of ["capped","fixed","borrowing"]){
 const previous=old.createTracking(tasks,"18:00","UTC",start,PLAN);
 if(kind!=="capped")delete previous.workLimitVersion;
 if(kind==="borrowing"){delete previous.idlePolicyVersion;previous.carryMs=60*minute;}
 Object.assign(previous,{workMs:40*minute,taskMs:{a:30*minute,b:10*minute},cursor:start+40*minute,controllerId:"test-device"});
 saved=JSON.stringify(previous);writes=0;Date.now=()=>start+160*minute;
 tracker=mount(persistentAdapter,{tasks,endTime:"18:00"});
 try{
  await tracker.flush();assert.equal(writes,1);assert.equal(JSON.parse(saved).carryMs,undefined);
  assert.equal(tracker.value.state.coverageVersion,1);assert.equal(tracker.value.state.workMs,40*minute);
  assert.deepEqual(tracker.value.state.taskMs,previous.taskMs);assert.equal(tracker.value.remainingWorkMs,20*minute);
  tracker.unmount();tracker=mount(persistentAdapter,{tasks,endTime:"18:00"});
  await tracker.flush();assert.equal(writes,1);assert.deepEqual(tracker.value.state.taskMs,previous.taskMs);
  tracker.unmount();Date.now=()=>start+24*60*minute;tracker=mount(persistentAdapter,{tasks,endTime:"18:00"});
  await tracker.flush();assert.equal(tracker.value.state.mode,"idle");assert.equal(tracker.value.state.workMs,0);assert.equal(tracker.value.remainingWorkMs,60*minute);
 }finally{tracker.unmount();Date.now=realNow;}
}
console.log("Guest fixed, capped and borrowing migrations preserve work and reset without debt");

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
let remote = { ...createTracking(tasks, "18:00", "UTC", start, PLAN), revision: 2, mode: "work", taskId: "a" };
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
  const initialWork = tracker.value.remainingWorkMs;
  assert.equal(tracker.value.state.cursor, start + 9000);
  wall = start + 1300; responseDelay = 800;
  await tracker.value.refresh(); await tracker.flush();
  assert.equal(tracker.value.state.cursor, start + 9000, "a slow response must not rewind or insert a partial display second");
  await tickAt(start + 2000);
  assert.equal(tracker.value.remainingWorkMs, initialWork - 1000);
  wall = start + 2300; responseDelay = 20;
  await tracker.value.refresh(); await tracker.flush();
  assert.equal(tracker.value.state.cursor, start + 10_000, "a fast response must not accelerate the display");
  wall = start + 2400; remote = { ...remote, revision: 1 }; responseDelay = 60_000;
  await tracker.value.refresh(); await tracker.flush();
  await tickAt(start + 3000);
  assert.equal(tracker.value.state.cursor, start + 11_000, "a stale revision cannot alter the clock offset");
  assert.equal(tracker.value.remainingWorkMs, initialWork - 2000);
  remote = { ...remote, revision: 2 }; responseDelay = 50;
  wall = start + 5 * minute + 650;
  foreground(); await tracker.flush();
  assert.equal(tracker.value.state.cursor, start + 5 * minute + 8000, "foreground catches up immediately after throttling");
  assert.equal(tracker.value.state.workMs, 5 * minute + 8000, "only the existing active timer tracks work");
} finally {
  tracker.unmount();
  Date.now = realNow; api.loadTracking = realLoadTracking;
  Object.assign(globalThis, realTimers);
}
assert.equal(timeouts.size, 0, "unmount removes the repaint timer");
assert.equal(intervals.size, 0, "unmount removes polling");
console.log("1 account countdown cadence and latency regression scenario passed");
