import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { createTracking, advanceTracking, configureTracking, actOnTracking, taskProgress, remainingWorkTime, workBudget, dayEnd, dayStart, dayBudget, dayPlan, workLeftMs, idleLeftMs, canTrackWork, shouldStartWorking, ownsAlerts, trackingDay, parseTracking, trackingConfigKey, upcomingTrackingEvents, formatDuration, MIN_DAILY_TARGET_MS } = require("../.test-build/tracking.js");
const { describeFocus } = require("../.test-build/focus.js");
const { setSql, ensureSchema } = require("../.test-build/sql.js");
const { DEFAULT_PLAN } = require("../.test-build/plan.js");
const { commandTracking, loadTracking, readAccountTracking, configureAccountTracking, TrackingConflict } = require("../.test-build/tracking-db.js");
const { saveState, loadState } = require("../.test-build/db.js");
const MIN = 60_000;
const T = Date.parse("2026-09-14T08:00:00Z");
const task = (id, dueDate = "2026-09-14") => ({ id, title: id, description: "", dueDate, createdAt: new Date(T).toISOString(), completed: false, completedAt: null });
const tasks = [task("first"), task("second"), task("later", "2026-09-15")];
// 08:00–18:00 at 3:1: 450 minutes of work and 150 of idle time.
const PLAN = { startTime: "08:00", workParts: 3, idleParts: 1 };
const fresh = (list = tasks, end = "18:00") => createTracking(list, end, "UTC", T, PLAN);
// A 1:1 day from 08:00 that holds exactly `minutes` of work (and as much idle).
const clockAt = minutes => new Date(T + minutes * MIN).toISOString().slice(11, 16);
const day = (list, minutes, ...settings) => createTracking(list, clockAt(2 * minutes), "UTC", T, { startTime: "08:00", workParts: 1, idleParts: 1 }, ...settings);
let count = 0;
function check(name, fn) { fn(); count++; console.log(`✓ ${name}`); }
function near(a, b) { assert.ok(Math.abs(a-b) < 0.01, `${a} != ${b}`); }

console.log("== the work day ==");
check("the day's work goal and idle allowance come from its start, end and ratio", () => {
  assert.deepEqual(DEFAULT_PLAN, { startTime: "09:00", workParts: 1, idleParts: 1 });
  // The default 1:1 over 09:00–23:00 is seven hours of each.
  const standard = createTracking([], "23:00", "UTC", T);
  assert.deepEqual(dayBudget(standard), { workMs: 7 * 60 * MIN, idleMs: 7 * 60 * MIN });
  const twoToOne = createTracking([], "23:00", "UTC", T, { ...DEFAULT_PLAN, workParts: 2 });
  assert.deepEqual(dayBudget(twoToOne), { workMs: 560 * MIN, idleMs: 280 * MIN });
  assert.deepEqual(dayBudget(fresh()), { workMs: 450 * MIN, idleMs: 150 * MIN });
  near(workBudget(fresh()), 450 * MIN); near(remainingWorkTime(fresh()), 450 * MIN);
  // A start at or after the end leaves no day to work in.
  const backwards = createTracking(tasks, "08:00", "UTC", T, { ...PLAN, startTime: "09:00" });
  assert.deepEqual(dayBudget(backwards), { workMs: 0, idleMs: 0 }); assert.equal(canTrackWork(backwards, T + 90 * MIN), false);
});
check("idle time is spent from the idle allowance, never from work", () => {
  const s = advanceTracking(fresh(), T + 40 * MIN).state;
  assert.equal(s.workMs, 0); near(workLeftMs(s), 450 * MIN); near(idleLeftMs(s), 110 * MIN);
  near(taskProgress(s)[0].targetMs, 180 * MIN);
});
check("working counts work down and leaves idle time alone", () => {
  const s = advanceTracking(actOnTracking(fresh(), { type: "start" }, "device-1", T), T + 40 * MIN).state;
  near(s.taskMs.first, 40 * MIN); near(s.workMs, 40 * MIN); near(workLeftMs(s), 410 * MIN); near(idleLeftMs(s), 150 * MIN);
  near(workBudget(s), 450 * MIN);
});
check("paused time counts as idle, and work picks up where it stopped", () => {
  let s = actOnTracking(fresh(), { type: "start" }, "device-1", T);
  s = actOnTracking(s, { type: "pause" }, "device-1", T + 30 * MIN);
  s = actOnTracking(s, { type: "start" }, "device-1", T + 60 * MIN);
  s = advanceTracking(s, T + 90 * MIN).state;
  near(s.workMs, 60 * MIN); near(idleLeftMs(s), 120 * MIN); near(workLeftMs(s), 390 * MIN);
});
check("before idle is exhausted, work left plus idle left equals time left in the day", () => {
  let s = fresh();
  // Idle use stays inside the 150-minute allowance, so every pause is allowed.
  for (const [at, action] of [[0, "start"], [37, "pause"], [80, "start"], [91, "pause"], [150, "start"], [260, "pause"]]) {
    s = actOnTracking(s, { type: action }, "device-1", T + at * MIN);
    for (const step of [0, 5, 13]) {
      const now = T + (at + step) * MIN, projected = advanceTracking(s, now).state;
      near(workLeftMs(projected) + idleLeftMs(projected, now), dayEnd(s) - now);
    }
  }
});
check("before the day starts nothing counts and work cannot start", () => {
  const s = createTracking(tasks, "18:00", "UTC", T, { ...PLAN, startTime: "09:00" });
  near(dayStart(s) - T, 60 * MIN);
  const waiting = advanceTracking(s, T + 30 * MIN).state;
  near(idleLeftMs(waiting), dayBudget(s).idleMs); assert.equal(shouldStartWorking(waiting), false);
  assert.throws(() => actOnTracking(s, { type: "start" }, "device-1", T + 30 * MIN), /Your work day starts at 09:00/);
  const started = actOnTracking(s, { type: "start" }, "device-1", T + 60 * MIN);
  assert.equal(started.mode, "work"); near(advanceTracking(started, T + 70 * MIN).state.workMs, 10 * MIN);
});
check("finishing the day's work stops tracking for the rest of the day", () => {
  const s = actOnTracking(day([task("a"), task("b")], 60), { type: "start" }, "device-1", T);
  const out = advanceTracking(s, T + 60 * MIN);
  assert.equal(out.state.mode, "idle"); near(out.state.workMs, 60 * MIN); near(workLeftMs(out.state), 0);
  const done = out.events.find(e => e.type === "work-complete");
  assert.equal(done.at, T + 60 * MIN); assert.equal(done.body, "You tracked all 1h 0m of today’s work. The rest of the day is idle time.");
  for (const action of [{ type: "start" }, { type: "start", taskId: "b" }]) {
    assert.throws(() => actOnTracking(out.state, action, "device-1", T + 70 * MIN), /Today’s work is done/);
  }
  // No advice, no forced work and no further alerts once the work is done.
  const later = advanceTracking(out.state, T + 110 * MIN).state;
  assert.equal(shouldStartWorking(later), false); assert.equal(canTrackWork(later), false);
  assert.deepEqual(upcomingTrackingEvents(out.state, T + 60 * MIN), []);
});
check("with under half the idle time left, it advises starting work, and says so once", () => {
  const s = fresh();
  assert.equal(shouldStartWorking(advanceTracking(s, T + 74 * MIN).state), false);
  const halfway = advanceTracking(s, T + 75 * MIN);
  assert.equal(shouldStartWorking(halfway.state), false);
  assert.deepEqual(halfway.events, [], "exactly half left is not below half");
  const belowHalf = advanceTracking(halfway.state, T + 75 * MIN + 1);
  assert.equal(shouldStartWorking(belowHalf.state), true);
  assert.deepEqual(belowHalf.events.map(e => e.type), ["idle-half"]);
  assert.deepEqual(advanceTracking(belowHalf.state, T + 100 * MIN).events, [], "checkpointing cannot repeat the advice alert");
  assert.equal(shouldStartWorking(advanceTracking(s, T + 76 * MIN).state), true);
  const events = advanceTracking(s, T + 100 * MIN).events;
  assert.deepEqual(events.map(e => [e.type, e.at]), [["idle-half", T + 75 * MIN + 1]]);
  assert.equal(events[0].title, "Time to start working");
  // Not while working, and not without a task to start.
  const working = actOnTracking(advanceTracking(s, T + 76 * MIN).state, { type: "start" }, "device-1", T + 76 * MIN);
  assert.equal(shouldStartWorking(working), false);
  assert.equal(shouldStartWorking(advanceTracking(fresh([]), T + 100 * MIN).state), false);
});
check("finishing or exceeding a revised work goal suppresses all idle advice and reminders", () => {
  const working = actOnTracking(day([task("a")], 60), { type: "start" }, "device-1", T);
  const completed = advanceTracking(working, T + 60 * MIN).state;
  // Lowering the work share after tracking must not erase logged time or ask for more work.
  const smallerGoal = configureTracking(completed, completed.tasks, completed.endTime, completed.cursor,
    { ...completed.plan, idleParts: 3 });
  for (const state of [completed, smallerGoal]) {
    const restored = parseTracking(JSON.parse(JSON.stringify(state)));
    const later = advanceTracking(restored, T + 110 * MIN);
    assert.ok(idleLeftMs(later.state) < dayBudget(later.state).idleMs / 2);
    assert.equal(later.state.workMs, 60 * MIN);
    assert.equal(shouldStartWorking(later.state), false);
    assert.deepEqual(later.events, []);
    assert.deepEqual(upcomingTrackingEvents(restored, restored.cursor), []);
  }
});
check("when idle runs out, tracking stays paused until Start or Track", () => {
  const s = fresh([task("a"), task("b")]);
  const out = advanceTracking(s, T + 160 * MIN);
  assert.deepEqual(out.events.map(e => [e.type, e.at]), [["idle-half", T + 75 * MIN + 1], ["idle-soon", T + 145 * MIN], ["idle-out", T + 150 * MIN]]);
  assert.match(out.events[2].body, /Choose Start working or Track/);
  assert.equal(out.state.mode, "idle"); assert.equal(out.state.taskId, null); near(out.state.workMs, 0);
  near(idleLeftMs(out.state), 0); near(workLeftMs(out.state), 450 * MIN);
  assert.equal(actOnTracking(out.state, { type: "pause" }, "device-1", T + 160 * MIN).mode, "idle");
  // Starting and then pausing are both allowed, even with an idle deficit.
  const switched = actOnTracking(out.state, { type: "start", taskId: "b" }, "device-1", T + 160 * MIN);
  assert.equal(switched.taskId, "b");
  const paused = actOnTracking(switched, { type: "pause" }, "device-1", T + 170 * MIN);
  near(paused.workMs, 10 * MIN); assert.equal(paused.mode, "idle"); near(idleLeftMs(paused), 0);
  // Starting late leaves real unfinished work, never fictitious logged time.
  const end = advanceTracking(switched, dayEnd(s));
  near(end.state.workMs, 440 * MIN); assert.equal(end.state.mode, "idle"); assert.equal(end.state.carryMs, undefined);
  assert.equal(end.events.at(-1).type, "day-end"); near(end.events.at(-1).at, dayEnd(s));
  assert.equal(actOnTracking(end.state, { type: "pause" }, "device-1", dayEnd(s)).mode, "idle");
});
check("with nothing to work on, running out of idle time forces nothing", () => {
  for (const list of [[], [{ ...task("done"), completed: true }]]) {
    const out = advanceTracking(fresh(list), T + 400 * MIN);
    assert.equal(out.state.mode, "idle"); assert.deepEqual(out.events, []);
    near(idleLeftMs(out.state), 0); assert.equal(out.state.carryMs, undefined);
    assert.throws(() => actOnTracking(out.state, { type: "start" }, "device-1", T + 400 * MIN), /No unfinished/);
  }
});
check("changing the plan keeps time worked and recalculates the rest", () => {
  const working = advanceTracking(actOnTracking(fresh(), { type: "start" }, "device-1", T), T + 60 * MIN).state;
  const even = configureTracking(working, tasks, "18:00", T + 60 * MIN, { ...PLAN, workParts: 1 });
  near(even.workMs, 60 * MIN); near(workLeftMs(even), 240 * MIN); near(idleLeftMs(even), 300 * MIN);
  assert.equal(even.mode, "work"); assert.deepEqual(even.taskMs, working.taskMs);
  // A smaller allowance than the idle time already used stays paused.
  const idle = advanceTracking(fresh(), T + 100 * MIN).state;
  const tight = configureTracking(idle, tasks, "18:00", T + 100 * MIN, { ...PLAN, workParts: 9 });
  near(idleLeftMs(tight), 0);
  const paused = advanceTracking(tight, T + 101 * MIN);
  assert.equal(paused.state.mode, "idle"); near(paused.state.workMs, 0);
  assert.deepEqual(paused.events, [], "past boundaries are not replayed after settings change");
  // A later start, mid-day, stops counting time before it.
  const later = configureTracking(working, tasks, "18:00", T + 60 * MIN, { ...PLAN, startTime: "12:00" });
  assert.equal(later.mode, "idle"); near(later.workMs, 60 * MIN);
});
check("timers saved by the break model load as idle, keeping their work", () => {
  const legacy = { ...fresh(), mode: "rest", taskId: null, workMs: 90 * MIN, taskMs: { first: 90 * MIN }, restMs: 10 * MIN, cycleWorkMs: 90 * MIN, cycleRestMs: 10 * MIN, restWorkCreditMs: 0, deferredBreak: { cycleRestMs: 0 }, rest: { enabled: true, workMinutes: 90, restMinutes: 30 } };
  delete legacy.plan;
  const parsed = parseTracking(JSON.parse(JSON.stringify(legacy)));
  assert.equal(parsed.mode, "idle"); assert.equal(parsed.taskId, null); near(parsed.workMs, 90 * MIN);
  for (const key of ["restMs", "cycleWorkMs", "cycleRestMs", "restWorkCreditMs", "deferredBreak", "rest"]) assert.equal(key in parsed, false);
  assert.deepEqual(dayPlan(parsed), DEFAULT_PLAN);
  assert.equal(parseTracking({ ...legacy, mode: "work", taskId: "first" }).mode, "work");
  // Even unparsed, a projection never treats rest as work.
  assert.equal(advanceTracking(legacy, T + MIN).state.mode, "idle");
});
check("the plan is part of the timer's configuration and is validated", () => {
  assert.notEqual(trackingConfigKey(tasks, "18:00", PLAN), trackingConfigKey(tasks, "18:00", { ...PLAN, workParts: 2 }));
  assert.notEqual(trackingConfigKey(tasks, "18:00", PLAN), trackingConfigKey(tasks, "18:00", { ...PLAN, startTime: "08:30" }));
  assert.equal(trackingConfigKey(tasks, "18:00"), trackingConfigKey(tasks, "18:00", DEFAULT_PLAN));
  assert.deepEqual(parseTracking(JSON.parse(JSON.stringify(fresh()))).plan, PLAN);
  for (const plan of [{ ...PLAN, workParts: 0 }, { ...PLAN, idleParts: 1.5 }, { ...PLAN, startTime: "25:00" }, "early", null]) {
    assert.equal(parseTracking({ ...fresh(), plan }), null);
  }
});

check("idle reminders reach every device until one starts, pauses or resets the timer", () => {
  // Idle time runs out with nobody pressing anything, so an unclaimed timer alerts everywhere.
  const unclaimed = fresh();
  assert.equal(unclaimed.controllerId, null);
  assert.ok(ownsAlerts(unclaimed, "phone") && ownsAlerts(unclaimed, "windows"));
  assert.ok(upcomingTrackingEvents(unclaimed, T).some(e => e.type === "idle-out"));
  for (const action of [{ type: "start" }, { type: "pause" }, { type: "reset" }]) {
    const claimed = actOnTracking(unclaimed, action, "phone", T + MIN);
    assert.ok(ownsAlerts(claimed, "phone"), action.type); assert.ok(!ownsAlerts(claimed, "windows"), action.type);
  }
});
console.log("== manual-only work and borrowing migration ==");
check("idle stops at zero; paused work never moves, even hours later", () => {
  for (const minutes of [150,160,300,450,599]) {
    const s=advanceTracking(fresh(),T+minutes*MIN).state;
    near(idleLeftMs(s),0); near(workLeftMs(s),450*MIN); near(s.workMs,0);
    assert.equal(s.mode,"idle"); assert.deepEqual(s.taskMs,{}); assert.equal(s.carryMs,undefined);
  }
  const s=actOnTracking(fresh(),{type:"start"},"desktop",T+160*MIN);
  const paused=actOnTracking(s,{type:"pause"},"desktop",T+200*MIN);
  const later=advanceTracking(paused,T+300*MIN).state;
  near(later.workMs,40*MIN); assert.deepEqual(later.taskMs,paused.taskMs);
  near(workLeftMs(later),410*MIN); near(idleLeftMs(later),0);
});
check("midnight and missed days start fresh, with no debt and no automatic work", () => {
  const initial={...fresh(),controllerId:"desktop",revision:8};
  let daily=initial;
  for(let days=1;days<=7;days++) daily=advanceTracking(daily,T+days*24*60*MIN).state;
  const once=advanceTracking(initial,daily.cursor);
  assert.deepEqual(once.state,daily); assert.deepEqual(once.events,[]);
  assert.deepEqual(dayBudget(daily),dayBudget(fresh())); assert.equal(daily.carryMs,undefined);
  near(daily.workMs,0); assert.deepEqual(daily.taskMs,{}); assert.equal(daily.mode,"idle");
  assert.equal(daily.controllerId,"desktop"); assert.equal(daily.revision,8);
});
const borrowingSnapshot=(overrides={})=>{
  const s={...fresh(),carryMs:60*MIN,...overrides}; delete s.idlePolicyVersion; return s;
};
check("migration removes borrowed debt but preserves every logged task and total", () => {
  const old=borrowingSnapshot({cursor:T+300*MIN,workMs:120*MIN,taskMs:{first:80*MIN,second:40*MIN},revision:17,controllerId:"desktop"});
  const copy=JSON.stringify(old);
  const s=advanceTracking(parseTracking(JSON.parse(copy)),T+330*MIN).state;
  near(s.workMs,old.workMs); assert.deepEqual(s.taskMs,old.taskMs); assert.deepEqual(s.tasks,old.tasks);
  assert.equal(s.controllerId,old.controllerId); assert.equal(s.revision,old.revision);
  assert.equal(s.mode,"idle"); assert.equal(s.carryMs,undefined); assert.equal(s.idlePolicyVersion,2);
  assert.deepEqual(dayBudget(s),{workMs:450*MIN,idleMs:150*MIN}); assert.equal(JSON.stringify(old),copy);
  assert.deepEqual(advanceTracking(parseTracking(JSON.parse(JSON.stringify(s))),s.cursor).state,s);
});
check("migration retains active elapsed work even above the new work goal", () => {
  const old=borrowingSnapshot({tasks:[task("a")],cursor:T+440*MIN,workMs:440*MIN,taskMs:{a:440*MIN},mode:"work",taskId:"a",controllerId:"desktop"});
  const s=advanceTracking(old,T+460*MIN).state;
  near(s.workMs,460*MIN); near(s.taskMs.a,460*MIN); assert.equal(s.mode,"idle");
  assert.equal(s.carryMs,undefined); near(workLeftMs(s),0); assert.equal(shouldStartWorking(s),false);
  near(advanceTracking(s,T+470*MIN).state.workMs,460*MIN);
});
check("migration preserves elapsed per-task allocation and an explicit task selection", () => {
  const old=borrowingSnapshot({tasks:[task("a"),task("b")],cursor:T+240*MIN,workMs:240*MIN,taskMs:{a:240*MIN},mode:"work",taskId:"a",controllerId:"desktop"});
  // The old goal is 510m: 255 per task, so the next 20m splits 15/5.
  const s=advanceTracking(old,T+260*MIN).state;
  near(s.taskMs.a,255*MIN); near(s.taskMs.b,5*MIN); near(s.workMs,260*MIN); assert.equal(s.taskId,"b");
  const chosen=borrowingSnapshot({tasks:[task("a"),task("b")],mode:"work",taskId:"b",chosen:true});
  const selected=advanceTracking(chosen,T+10*MIN).state;
  assert.equal(selected.taskId,"b"); assert.equal(selected.chosen,true); near(selected.taskMs.b,10*MIN);
});
check("over-target history and clock rollback cannot erase or duplicate tracked time", () => {
  const old=borrowingSnapshot({cursor:T+550*MIN,workMs:510*MIN,taskMs:{first:510*MIN}});
  assert.deepEqual(advanceTracking(old,old.cursor-1000).state,old);
  const s=advanceTracking(old,old.cursor).state;
  near(s.workMs,510*MIN); assert.deepEqual(s.taskMs,old.taskMs); assert.equal(s.carryMs,undefined);
  near(workLeftMs(s),0); assert.equal(describeFocus(s,taskProgress(s),true).advice,null);
});
check("settings changes keep tracked history and do not restart an exhausted timer", () => {
  const initial=actOnTracking(fresh(),{type:"start"},"desktop",T);
  const paused=actOnTracking(initial,{type:"pause"},"desktop",T+40*MIN);
  const s=configureTracking(paused,tasks,"18:00",T+400*MIN,{...PLAN,workParts:1});
  near(s.workMs,40*MIN); assert.deepEqual(s.taskMs,paused.taskMs);
  assert.equal(s.mode,"idle"); near(idleLeftMs(s),0); assert.equal(s.carryMs,undefined);
});
check("shared focus shows Paused and freezes the work clock until Track", () => {
  const s=advanceTracking(fresh(),T+160*MIN).state, f=describeFocus(s,taskProgress(s),true);
  assert.equal(f.label,"PAUSED"); near(f.clock,450*MIN);
  assert.equal(f.clockLabel,"Work time left today — paused");
  assert.deepEqual(f.idleStat,{label:"Idle left",value:0}); assert.match(f.hint,/No work is being tracked/);
  const later=advanceTracking(s,T+200*MIN).state;
  near(describeFocus(later,taskProgress(later),true).clock,f.clock);
  const started=actOnTracking(s,{type:"start",taskId:"second"},"desktop",s.cursor);
  const worked=advanceTracking(started,s.cursor+MIN).state;
  near(worked.taskMs.second,MIN); assert.equal(describeFocus(worked,taskProgress(worked),true).label,"WORKING ON");
  near(describeFocus(worked,taskProgress(worked),true).clock,f.clock-MIN);
});
check("an exhausted timer never repeats idle reminders after migration", () => {
  const old=borrowingSnapshot({cursor:T+200*MIN}), s=advanceTracking(old,old.cursor).state;
  assert.deepEqual(upcomingTrackingEvents(s,s.cursor),[]);
  for(let i=1;i<=10;i++) assert.deepEqual(advanceTracking(s,s.cursor+i*1000).events,[]);
});
check("old borrowing balances are accepted only for migration, not future day budgets", () => {
  for(const carryMs of [0,60*MIN,10_000*24*60*MIN]) {
    const old=parseTracking(borrowingSnapshot({carryMs})); assert.ok(old);
    const s=advanceTracking(old,old.cursor).state;
    assert.equal(s.carryMs,undefined); assert.equal(s.idlePolicyVersion,2);
    assert.deepEqual(dayBudget(s),dayBudget(fresh()));
  }
  for(const carryMs of [-1,Infinity,NaN,"100",Number.MAX_SAFE_INTEGER+1]) assert.equal(parseTracking(borrowingSnapshot({carryMs})),null);
  assert.equal(parseTracking({...fresh(),idlePolicyVersion:99}),null);
});

console.log("== allocation ==");
check("task percentages sum to 100% of work", () => {
  const p = taskProgress(fresh()); near(p[0].probability, .4); near(p[1].probability,.4); near(p[2].probability,.2);
  near(p.reduce((sum,p)=>sum+p.probability,0), 1);
});
check("unweighted gives every open task weight 1 regardless of due date or priority", () => {
  const list = [{ ...task("urgent", "2026-09-10"), priority: "high" }, task("later", "2026-10-14"), { ...task("done"), completed: true }];
  const s = createTracking(list, "12:00", "UTC", T, PLAN, true);
  const p = taskProgress(s);
  assert.deepEqual(p.map(p => p.weight), [1, 1, 0]);
  assert.deepEqual(p.map(p => p.probability), [.5, .5, 0]);
  near(p[0].targetMs, 90 * MIN); near(p[1].targetMs, 90 * MIN);
  const running = actOnTracking(s, { type: "start" }, "device-1", T);
  const projected = advanceTracking(running, dayEnd(s));
  near(projected.state.taskMs.urgent, 90 * MIN); near(projected.state.taskMs.later, 90 * MIN);
  assert.deepEqual(upcomingTrackingEvents(running, T), projected.events);
});
check("unweighted applies the minimum, redistributes short shares and keeps equal retained targets", () => {
  for (const minutes of [1, 20, 59, 60, 89, 90]) {
    const s = day([task("a"), task("b"), task("c")], minutes, true);
    const p = taskProgress(s);
    const kept = Math.max(1, Math.floor(minutes / 30));
    for (const [i, entry] of p.entries()) {
      assert.equal(entry.weight, 1);
      near(entry.targetMs, i < kept ? minutes * MIN / kept : 0);
      assert.equal(entry.skipped, i >= kept); assert.equal(entry.doneToday, i >= kept);
    }
    near(p.reduce((sum, entry) => sum + entry.remainingMs, 0), workLeftMs(s));
    const running = actOnTracking(s, { type: "start" }, "device-1", T);
    const end = advanceTracking(running, dayEnd(s));
    for (const entry of p) near(end.state.taskMs[entry.task.id] ?? 0, entry.targetMs);
    assert.equal(end.events.filter(e => e.type === "task-complete").length, kept);
    assert.deepEqual(upcomingTrackingEvents(running, T), end.events);
    assert.equal(end.state.mode, "idle");
  }
});
check("unweighted minimum respects the work goal and already tracked time", () => {
  const s = day([task("a"), task("b"), task("c")], 90, true);
  s.workMs = 85 * MIN; s.taskMs.a = 85 * MIN;
  const p = taskProgress(s);
  near(workLeftMs(s), 5 * MIN);
  near(p[0].remainingMs, 5 * MIN); near(p[0].targetMs, 90 * MIN);
  near(p[1].remainingMs, 0); near(p[2].remainingMs, 0);
  assert.deepEqual(p.map(entry => entry.skipped), [false, true, true]);
  const end = advanceTracking(actOnTracking(s, { type: "start" }, "device-1", T), dayEnd(s)).state;
  near(end.workMs, 90 * MIN);
});
check("switching weighting modes keeps the minimum without losing progress", () => {
  const list = [task("a"), task("b")];
  const weighted = day(list, 20);
  assert.equal(taskProgress(weighted)[1].skipped, true);
  const running = actOnTracking(weighted, { type: "start" }, "device-1", T);
  const flat = configureTracking(running, list, weighted.endTime, T + 8 * MIN, weighted.plan, true);
  const p = taskProgress(flat);
  near(flat.workMs, 8 * MIN); near(p[0].remainingMs, 12 * MIN); near(p[1].remainingMs, 0);
  assert.deepEqual(p.map(entry => entry.skipped), [false, true]);
  const restored = configureTracking(flat, list, weighted.endTime, flat.cursor, weighted.plan, false);
  assert.equal(taskProgress(restored)[1].skipped, true);
  near(taskProgress(restored)[0].remainingMs, 12 * MIN);
  assert.deepEqual(restored.taskMs, flat.taskMs); near(restored.workMs, flat.workMs);
});
check("toggling weights checkpoints elapsed work and preserves task metadata", () => {
  const list = [{ ...task("a"), priority: "high" }, task("b", "2026-09-16")];
  const original = actOnTracking(fresh(list), { type: "start" }, "device-1", T);
  const checkpoint = advanceTracking(original, T + 20 * MIN).state;
  const flat = configureTracking(original, list, "18:00", T + 20 * MIN, PLAN, true);
  for (const key of ["taskMs", "workMs", "taskId", "mode", "controllerId", "tasks"]) assert.deepEqual(flat[key], checkpoint[key]);
  const p = taskProgress(flat); near(p[0].targetMs, p[1].targetMs);
  near(p.reduce((sum, p) => sum + p.remainingMs, 0), workLeftMs(flat));
  const restored = configureTracking(flat, list, "18:00", flat.cursor, PLAN, false);
  assert.deepEqual(restored.taskMs, flat.taskMs);
  assert.deepEqual(taskProgress(restored).map(p => p.weight), [8, .5]);
});
check("unweighted persists through reset, rollover, parsing and task-only edits", () => {
  const s = createTracking(tasks, "18:00", "UTC", T, PLAN, true);
  assert.equal(actOnTracking(s, { type: "reset" }, "device-1", T).unweighted, true);
  assert.equal(advanceTracking(s, T + 24 * 60 * MIN).state.unweighted, true);
  assert.equal(configureTracking(s, tasks.slice(1), "19:00", T).unweighted, true);
  assert.equal(parseTracking(JSON.parse(JSON.stringify(s))).unweighted, true);
  assert.equal(parseTracking({ ...s, unweighted: "true" }), null);
  const { unweighted, ...legacy } = s;
  assert.ok(parseTracking(legacy)); assert.equal(taskProgress(legacy)[0].weight, 2);
  assert.notEqual(trackingConfigKey(tasks, "18:00", PLAN, true), trackingConfigKey(tasks, "18:00", PLAN, false));
});
check("minimum is independent of weighting, keeps smaller shares when off and predicts their alerts", () => {
  const list = [task("a"), task("b", "2026-09-15")];
  for (const unweighted of [false, true]) for (const minimumEnabled of [false, true]) {
    const s = day(list, 20, unweighted, minimumEnabled);
    const p = taskProgress(s);
    near(p[0].targetMs, (minimumEnabled ? 20 : unweighted ? 10 : 20 * 2 / 3) * MIN);
    near(p[1].targetMs, (minimumEnabled ? 0 : unweighted ? 10 : 20 / 3) * MIN);
    assert.equal(p[1].skipped, minimumEnabled);
    near(p.reduce((sum, entry) => sum + entry.remainingMs, 0), workLeftMs(s));
    const running = actOnTracking(s, { type: "start" }, "device-1", T);
    const projected = advanceTracking(running, dayEnd(s));
    for (const entry of p) near(projected.state.taskMs[entry.task.id] ?? 0, entry.targetMs);
    assert.deepEqual(upcomingTrackingEvents(running, T), projected.events);
    assert.equal(projected.events.filter(e => e.type === "task-complete").length, minimumEnabled ? 1 : 2);
  }
});
check("toggling the minimum checkpoints work without reallocating elapsed time or changing ownership", () => {
  const list = [task("a"), task("b")];
  const s = day(list, 20);
  const running = actOnTracking(s, { type: "start" }, "device-1", T);
  const off = configureTracking(running, list, s.endTime, T + 8 * MIN, s.plan, false, false);
  near(off.workMs, 8 * MIN); near(off.taskMs.a, 8 * MIN);
  assert.equal(off.controllerId, "device-1"); assert.equal(off.taskId, "a"); assert.equal(off.mode, "work");
  near(taskProgress(off)[0].remainingMs, 2 * MIN); near(taskProgress(off)[1].remainingMs, 10 * MIN);
  const on = configureTracking(off, list, s.endTime, off.cursor, s.plan, false, true);
  assert.deepEqual(on.taskMs, off.taskMs); near(on.workMs, off.workMs);
  near(taskProgress(on)[0].remainingMs, 12 * MIN); assert.equal(taskProgress(on)[1].skipped, true);
});
check("minimum off persists through reset, rollover and task edits; legacy defaults on", () => {
  const s = day(tasks, 20, false, false);
  assert.equal(actOnTracking(s, { type: "reset" }, "device-1", T).minimumEnabled, false);
  assert.equal(advanceTracking(s, T + 24 * 60 * MIN).state.minimumEnabled, false);
  assert.equal(configureTracking(s, tasks.slice(1), "19:00", T).minimumEnabled, false);
  assert.equal(parseTracking(JSON.parse(JSON.stringify(s))).minimumEnabled, false);
  assert.equal(parseTracking({ ...s, minimumEnabled: "false" }), null);
  const { minimumEnabled, ...legacy } = s;
  assert.ok(parseTracking(legacy)); assert.equal(taskProgress(legacy)[1].skipped, true);
  assert.equal(trackingConfigKey(tasks, "08:20"), trackingConfigKey(tasks, "08:20", DEFAULT_PLAN, false, true));
  assert.notEqual(trackingConfigKey(tasks, "08:20"), trackingConfigKey(tasks, "08:20", DEFAULT_PLAN, false, false));
});
check("custom minimums control allocation and labels in either weighting mode", () => {
  const list = [task("a"), task("b"), task("c")];
  for (const unweighted of [false, true]) for (const minimum of [1, 5, 15, 30, 45, 120, 1440]) {
    const s = day(list, 90, unweighted, true, minimum);
    const p = taskProgress(s), kept = Math.max(1, Math.min(3, Math.floor(90 / minimum)));
    assert.equal(p.filter(p => !p.skipped).length, kept);
    for (const [i, entry] of p.entries()) {
      near(entry.targetMs, i < kept ? 90 * MIN / kept : 0);
      assert.equal(entry.minimumMs, minimum * MIN);
    }
    const running = actOnTracking(s, { type: "start" }, "device-1", T);
    const projected = advanceTracking(running, dayEnd(s));
    assert.deepEqual(upcomingTrackingEvents(running, T), projected.events);
    for (const entry of p) near(projected.state.taskMs[entry.task.id] ?? 0, entry.targetMs);
  }
  const weighted = day([task("a"), task("b", "2026-09-15")], 15, false, true, 5);
  near(taskProgress(weighted)[0].targetMs, 10 * MIN); near(taskProgress(weighted)[1].targetMs, 5 * MIN);
});
check("editing custom minimums keeps earned work and the setting through reset and rollover", () => {
  const list = [task("a"), task("b")];
  const s = day(list, 20);
  const running = actOnTracking(s, { type: "start" }, "device-1", T);
  const shorter = configureTracking(running, list, s.endTime, T + 8 * MIN, s.plan, false, true, 5);
  near(shorter.workMs, 8 * MIN); near(shorter.taskMs.a, 8 * MIN);
  near(taskProgress(shorter)[1].remainingMs, 10 * MIN);
  const longer = configureTracking(shorter, list, s.endTime, shorter.cursor, s.plan, false, true, 15);
  assert.equal(taskProgress(longer)[1].skipped, true);
  assert.deepEqual(longer.taskMs, shorter.taskMs); assert.equal(longer.controllerId, shorter.controllerId);
  const off = configureTracking(longer, list, longer.endTime, longer.cursor, s.plan, false, false);
  assert.equal(off.minimumMinutes, 15); assert.ok(taskProgress(off).every(p => !p.skipped));
  assert.equal(actOnTracking(off, { type: "reset" }, "device-1", off.cursor).minimumMinutes, 15);
  assert.equal(advanceTracking(off, T + 24 * 60 * MIN).state.minimumMinutes, 15);
  const changed = configureTracking(off, list, off.endTime, off.cursor, s.plan, false, true, 120);
  assert.equal(parseTracking(JSON.parse(JSON.stringify(changed))).minimumMinutes, 120);
  for (const invalid of [0, 1441, 1.5, "15", null, NaN, Infinity]) assert.equal(parseTracking({ ...changed, minimumMinutes: invalid }), null);
  const { minimumMinutes, ...legacy } = changed;
  assert.ok(parseTracking(legacy)); assert.equal(taskProgress(legacy)[0].minimumMs, 30 * MIN);
  assert.notEqual(trackingConfigKey(list, "08:20", DEFAULT_PLAN, false, true, 5), trackingConfigKey(list, "08:20", DEFAULT_PLAN, false, true, 15));
});
check("Start takes the first unfinished task in list order, not the heaviest", () => {
  assert.equal(actOnTracking(fresh(), {type:"start"}, "device-1", T).taskId, "first");
  // Nearest due date first; full ties keep saved order, as the list does.
  assert.equal(actOnTracking(fresh([tasks[2],tasks[1],tasks[0]]), {type:"start"}, "device-1", T).taskId, "second");
  // Medium priority makes tomorrow's task weigh as much as today's, and it was
  // created first, but today's task is higher on the list.
  const leading={...task("leading","2026-09-15"),priority:"medium",createdAt:new Date(T-86_400_000).toISOString()};
  assert.equal(actOnTracking(fresh([leading,task("physics")]),{type:"start"},"device-1",T).taskId,"physics");
  // Even a heavier task waits its turn in the list.
  assert.equal(actOnTracking(fresh([{...task("urgent","2026-09-15"),priority:"high"},task("today")]),{type:"start"},"device-1",T).taskId,"today");
});
check("after a target is met, the timer moves to the next task down the list", () => {
  // Shares of a 450-minute day: a 112.5, big 225, c 112.5. "a" finishes at
  // 112.5 minutes; "c" is next on the list, not "big".
  const s=actOnTracking(fresh([task("a"),{...task("big","2026-09-15"),priority:"high"},task("c")]),{type:"start"},"device-1",T);
  const out=advanceTracking(s,T+115*MIN);
  assert.equal(out.state.taskId,"c"); assert.ok(out.events.some(e=>e.type==="task-complete"));
  assert.equal(out.events.find(e=>e.type==="task-complete").body,"a is complete for today. Now tracking c.");
});
check("completion alert says when today's work is done", () => {
  const out=advanceTracking(actOnTracking(day([task("a")],30),{type:"start"},"device-1",T),T+30*MIN);
  assert.equal(out.state.mode,"idle");
  assert.equal(out.events.find(e=>e.type==="task-complete").body,"a is complete for today. Today’s work is done.");
  assert.deepEqual(out.events.map(e=>e.type),["task-complete","work-complete"]);
});
check("completion at cutoff says tracking stopped and never suggests a next task", () => {
  // Explicitly start when the idle allowance runs out.
  const out=advanceTracking(actOnTracking(day([task("a")],30),{type:"start"},"device-1",T+30*MIN),T+60*MIN);
  assert.equal(out.state.mode,"idle");
  assert.equal(out.events.find(e=>e.type==="task-complete").body,"a is complete for today. Tracking has stopped for today.");
  assert.deepEqual(out.events.map(e=>e.type),["task-complete","work-complete"]);
});
check("manual selection overrides default without changing weights", () => {
  assert.equal(actOnTracking(fresh(), {type:"start",taskId:"later"}, "device-1", T).taskId,"later");
});
check("switching keeps both tasks' accumulated time", () => {
  let s = actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"start",taskId:"second"},"device-1",T+20*MIN);
  s=advanceTracking(s,T+35*MIN).state;
  near(s.taskMs.first,20*MIN); near(s.taskMs.second,15*MIN); near(s.workMs,35*MIN);
});
check("task completion notifies and selects next without permanent completion", () => {
  const s=actOnTracking(fresh([task("a"),task("b")],"10:00"),{type:"start"},"device-1",T);
  const out=advanceTracking(s,T+60*MIN);
  assert.equal(out.state.taskId,"b"); assert.equal(out.events[0].type,"task-complete");
  assert.equal(taskProgress(out.state)[0].doneToday,true); assert.equal(out.state.tasks[0].completed,false);
});

console.log("== days, resets and edits ==");
check("midnight wipes every counter, pauses, and makes tasks eligible anew", () => {
  const s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const reset=advanceTracking(s,Date.parse("2026-09-15T08:00:00Z")).state;
  assert.deepEqual(reset.taskMs,{}); near(reset.workMs,0); assert.equal(reset.mode,"idle"); assert.equal(reset.dayKey,"2026-09-15");
  assert.deepEqual(reset.plan,PLAN);
  assert.ok(taskProgress(reset).every(p=>!p.doneToday));
});
check("manual reset wipes all task time and pauses without mutating the old session", () => {
  let before=actOnTracking(fresh(),{type:"start"},"device-1",T);
  before=actOnTracking(before,{type:"start",taskId:"second"},"device-1",T+20*MIN);
  const copy=JSON.stringify(before);
  const reset=actOnTracking(before,{type:"reset"},"device-2",T+40*MIN);
  assert.deepEqual(reset.taskMs,{}); near(reset.workMs,0);
  assert.equal(reset.mode,"idle"); assert.equal(reset.taskId,null);
  assert.equal(reset.controllerId,"device-2"); assert.equal(reset.cursor,T+40*MIN);
  assert.equal(JSON.stringify(before),copy);
});
check("reset preserves task metadata, permanent completion, cutoff, plan, zone and revision", () => {
  const list=[...tasks,{...task("done"),completed:true,completedAt:new Date(T).toISOString()}];
  const initial={...createTracking(list,"20:15","America/Toronto",T,PLAN),revision:42};
  // 12:00 UTC is 08:00 in Toronto, when this day starts.
  const before=actOnTracking(initial,{type:"start"},"device-1",T+240*MIN);
  const reset=actOnTracking(before,{type:"reset"},"device-2",T+280*MIN);
  assert.deepEqual(reset.tasks,list); assert.equal(reset.endTime,"20:15"); assert.deepEqual(reset.plan,PLAN);
  assert.equal(reset.timeZone,initial.timeZone); assert.equal(reset.dayKey,initial.dayKey); assert.equal(reset.revision,42);
});
check("after a reset, time already passed counts as idle", () => {
  // 90 minutes of work and 30 of idle; 60 worked, then a reset.
  const before=advanceTracking(actOnTracking(fresh([task("a"),task("b")],"10:00"),{type:"start"},"device-1",T),T+60*MIN).state;
  assert.equal(taskProgress(before)[0].doneToday,true);
  const reset=actOnTracking(before,{type:"reset"},"device-1",T+60*MIN);
  near(workBudget(reset),90*MIN); near(idleLeftMs(reset),0);
  assert.ok(taskProgress(reset).every(p=>!p.doneToday && p.trackedMs===0 && p.targetMs===45*MIN));
  // Exhausted idle never creates tracked work or future debt.
  assert.equal(reset.carryMs,undefined);
  assert.equal(advanceTracking(reset,T+61*MIN).state.mode,"idle");
});
check("reset checkpoint cannot replay old time or old alerts", () => {
  const before=actOnTracking(fresh(),{type:"start"},"device-1",T);
  assert.ok(upcomingTrackingEvents(before,T).length>0);
  const reset=actOnTracking(before,{type:"reset"},"device-2",T+40*MIN);
  const restored=parseTracking(JSON.parse(JSON.stringify(reset)));
  assert.deepEqual(restored,reset);
  const projected=advanceTracking(restored,T+80*MIN);
  near(projected.state.workMs,0);
  assert.deepEqual(projected.events.map(e=>e.type),["idle-half"]);
  // Only reminders for the reset day are ahead: idle time is used from the reset on.
  const upcoming=upcomingTrackingEvents(restored,T+40*MIN);
  assert.equal(upcoming[0].type,"idle-half"); near(upcoming[0].at,T+75*MIN+1);
  const started=actOnTracking(restored,{type:"start"},"device-2",T+80*MIN);
  near(advanceTracking(started,T+90*MIN).state.workMs,10*MIN);
});
check("reset is allowed after cutoff but cannot extend the work day", () => {
  const before=actOnTracking(fresh([task("a")],"08:20"),{type:"start"},"device-1",T);
  const reset=actOnTracking(before,{type:"reset"},"device-1",T+40*MIN);
  near(reset.workMs,0); assert.equal(canTrackWork(reset),false); assert.equal(reset.endTime,"08:20");
  assert.throws(()=>actOnTracking(reset,{type:"start"},"device-1",T+40*MIN),/work day has ended/);
});
check("reset handles empty sessions and repeated requests without starting work", () => {
  for(const initial of [fresh([]),fresh([{...task("done"),completed:true}])]) {
    const reset=actOnTracking(initial,{type:"reset"},"device-1",T+MIN);
    assert.deepEqual(actOnTracking(reset,{type:"reset"},"device-1",T+MIN),reset);
    near(reset.workMs,0); assert.equal(reset.mode,"idle");
  }
});
check("work day ends without tracking beyond the cutoff", () => {
  // 20 minutes at 3:1 hold 15 of work.
  const s=actOnTracking(fresh([task("a")],"08:20"),{type:"start"},"device-1",T);
  const out=advanceTracking(s,T+80*MIN).state;
  near(out.workMs,15*MIN); assert.equal(out.mode,"idle");
  assert.throws(()=>actOnTracking(out,{type:"start"},"device-1",T+80*MIN),/work day has ended/);
});
check("changing deadline checkpoints past time and adjusts future targets", () => {
  const s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const changed=configureTracking(s,tasks,"08:15",T+20*MIN);
  near(changed.workMs,20*MIN); assert.equal(changed.mode,"idle");
});
check("deleting the active task keeps earned time and advances to another", () => {
  const s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const changed=configureTracking(s,tasks.slice(1),"18:00",T+20*MIN);
  near(changed.workMs,20*MIN); near(changed.taskMs.first,20*MIN); assert.equal(changed.taskId,"second");
});
check("empty and permanently completed tasks cannot start", () => {
  assert.throws(()=>actOnTracking(fresh([]),{type:"start"},"device-1",T),/No unfinished/);
  assert.throws(()=>actOnTracking(fresh([{...task("done"),completed:true}]),{type:"start"},"device-1",T),/No unfinished/);
});
check("background projection equals a thousand incremental ticks", () => {
  for (const initial of [actOnTracking(fresh(),{type:"start"},"device-1",T), fresh()]) {
    const once=advanceTracking(initial,T+8*60*MIN).state;
    let incremental=initial;
    for(let i=1;i<=960;i++) incremental=advanceTracking(incremental,T+i*30_000).state;
    near(incremental.workMs,once.workMs);
    for(const id of Object.keys(once.taskMs)) near(incremental.taskMs[id],once.taskMs[id]);
    assert.equal(incremental.mode,once.mode); assert.equal(incremental.taskId,once.taskId);
  }
});
check("notification forecasts match automatic transitions", () => {
  const initial=actOnTracking(fresh(),{type:"start"},"device-1",T);
  assert.deepEqual(upcomingTrackingEvents(initial,T),advanceTracking(initial,dayEnd(initial)).events);
  assert.ok(upcomingTrackingEvents(initial,T).some(e=>e.type==="work-complete"));
  // Paused, the forecast contains only reminders, never fictional work transitions.
  const paused=actOnTracking(initial,{type:"pause"},"device-1",T);
  assert.deepEqual(upcomingTrackingEvents(paused,T),advanceTracking(paused,dayEnd(paused)).events);
  assert.deepEqual(upcomingTrackingEvents(paused,T).map(e=>e.type),["idle-half","idle-soon","idle-out"]);
});
check("account time zone governs midnight, DST and the length of the day", () => {
  assert.equal(trackingDay(Date.parse("2026-09-15T02:00:00Z"),"America/Toronto"),"2026-09-14");
  assert.equal(new Date(dayEnd({dayKey:"2026-03-08",endTime:"23:00",timeZone:"America/Toronto"})).toISOString(),"2026-03-09T03:00:00.000Z");
  assert.equal(new Date(dayEnd({dayKey:"2026-11-01",endTime:"23:00",timeZone:"America/Toronto"})).toISOString(),"2026-11-02T04:00:00.000Z");
  // 01:00–04:00 on the spring-forward night is two real hours, so one of work at 1:1.
  const spring={dayKey:"2026-03-08",endTime:"04:00",timeZone:"America/Toronto",plan:{startTime:"01:00",workParts:1,idleParts:1}};
  assert.equal(new Date(dayStart(spring)).toISOString(),"2026-03-08T06:00:00.000Z");
  assert.deepEqual(dayBudget(spring),{workMs:60*MIN,idleMs:60*MIN});
});
check("clock rollback cannot subtract or duplicate tracked time", () => {
  const s=advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+20*MIN).state;
  assert.deepEqual(advanceTracking(s,T).state,s);
});
check("corrupt guest counters are rejected", () => {
  assert.equal(parseTracking({...fresh(),workMs:-1}),null); assert.equal(parseTracking({...fresh(),taskMs:{first:Infinity}}),null);
  assert.equal(parseTracking({...fresh(),endTime:"25:99"}),null); assert.equal(parseTracking({...fresh(),timeZone:"not/a/zone"}),null);
  assert.equal(parseTracking({...fresh(),mode:"nap"}),null);
  assert.ok(parseTracking(fresh()));
});
check("reserved property names can be valid task ids without corrupting counters", () => {
  const s=advanceTracking(actOnTracking(fresh([task("__proto__")]),{type:"start"},"device-1",T),T+MIN).state;
  near(s.taskMs.__proto__,MIN); near(s.workMs,MIN);
});

check("a task added above an automatically picked task takes over at once", () => {
  const later = task("later", "2026-09-16");
  const s = actOnTracking(day([later], 240), { type: "start" }, "device-1", T);
  assert.equal(s.taskId, "later"); assert.equal("chosen" in s, false);
  const workout = { ...task("workout"), createdAt: new Date(T + 10 * MIN).toISOString() };
  const edited = configureTracking(s, [later, workout], s.endTime, T + 10 * MIN);
  assert.equal(edited.taskId, "workout", "the new task is first in the list");
  near(edited.taskMs.later, 10 * MIN);
  near(advanceTracking(edited, T + 25 * MIN).state.taskMs.workout, 15 * MIN);
  // A snapshot saved before choices were recorded follows the list from its last checkpoint.
  const old = advanceTracking({ ...s, tasks: [later, workout], cursor: T + 10 * MIN, taskMs: { later: 10 * MIN }, workMs: 10 * MIN }, T + 20 * MIN).state;
  assert.equal(old.taskId, "workout"); near(old.taskMs.workout, 10 * MIN);
});
check("a task tracked by hand stays until its target is met, then the list resumes", () => {
  const list = [task("a"), task("b", "2026-09-15")];
  let s = actOnTracking(day(list, 240), { type: "start", taskId: "b" }, "device-1", T);
  assert.equal(s.taskId, "b"); assert.equal(s.chosen, true);
  // Adding a task above does not replace a hand-picked one.
  s = configureTracking(s, [...list, { ...task("c"), createdAt: new Date(T + 1).toISOString() }], s.endTime, T + 5 * MIN);
  assert.equal(s.taskId, "b"); assert.equal(s.chosen, true);
  assert.equal(parseTracking(JSON.parse(JSON.stringify(s))).chosen, true, "the choice survives sync");
  const target = taskProgress(s).find(p => p.task.id === "b").remainingMs;
  const after = advanceTracking(s, T + 5 * MIN + target + MIN);
  assert.equal(after.state.taskId, "a", "the list takes over after its target"); assert.equal("chosen" in after.state, false);
  assert.match(after.events.find(e => e.type === "task-complete").body, /Now tracking a\./);
  // Tracking the list's own first task is no choice; pausing ends one; idle states never carry one.
  assert.equal("chosen" in actOnTracking(day(list, 240), { type: "start", taskId: "a" }, "device-1", T), false);
  assert.equal("chosen" in actOnTracking(s, { type: "pause" }, "device-1", T + 6 * MIN), false);
  assert.equal("chosen" in parseTracking({ ...JSON.parse(JSON.stringify(s)), mode: "idle" }), false);
  assert.equal(parseTracking({ ...JSON.parse(JSON.stringify(s)), chosen: "yes" }), null);
});

console.log("== water filling and the minimum ==");
check("overruns cannot book more than the 16 minutes left, and slivers go to the tasks above", () => {
  const list=[...["chemistry","english","physics","yanvpn"].map(id=>task(id,"2026-09-15")),task("isu","2026-09-17"),task("ee","2026-09-17")];
  const s={...day(list,106),taskMs:{chemistry:41*MIN,english:24*MIN,physics:20*MIN,yanvpn:5*MIN},workMs:90*MIN};
  const before=JSON.stringify(s), p=taskProgress(s), get=id=>p.find(p=>p.task.id===id);
  near(p.reduce((sum,p)=>sum+p.remainingMs,0),16*MIN);
  // Without the minimum these would get 7.6, 4.2 and 4.2 minutes: days of
  // 12.6, 4.2 and 4.2 minutes in all. Each is skipped instead.
  for(const id of ["yanvpn","isu","ee"]) { assert.equal(get(id).skipped,true); assert.equal(get(id).remainingMs,0); assert.equal(get(id).probability,0); }
  // Their 16 minutes go up the list, bringing physics and english to 30 each.
  near(get("physics").remainingMs,10*MIN); near(get("english").remainingMs,6*MIN); assert.equal(get("chemistry").remainingMs,0);
  for(const id of ["chemistry","english","physics"]) assert.equal(get(id).skipped,false);
  assert.equal(JSON.stringify(s),before,"rebalancing never rewrites logged time");
});
check("remaining allocation catches up underworked tasks instead of splitting blindly", () => {
  const s={...day([task("a"),task("b")],74),taskMs:{a:14*MIN,b:0},workMs:14*MIN};
  const p=taskProgress(s); near(p[0].remainingMs,23*MIN); near(p[1].remainingMs,37*MIN);
  near(p[0].targetMs,p[1].targetMs);
});
check("unequal weights preserve proportional final totals when feasible", () => {
  const s={...day([task("a"),task("b","2026-09-15")],105),taskMs:{a:9*MIN,b:6*MIN},workMs:15*MIN};
  const p=taskProgress(s); near(p[0].targetMs,70*MIN); near(p[1].targetMs,35*MIN);
  near(p[0].remainingMs+p[1].remainingMs,90*MIN);
});
check("overruns never inflate later tasks and removed/completed work stays in history", () => {
  const s={...day([task("a"),task("b"),{...task("done"),completed:true}],120),taskMs:{a:40*MIN,b:0,done:15*MIN,deleted:30*MIN},workMs:85*MIN};
  const p=taskProgress(s); near(p[0].remainingMs,0); near(p[1].remainingMs,35*MIN); near(p[2].remainingMs,0);
  near(p[0].targetMs,40*MIN); near(p[2].targetMs,15*MIN); near(s.workMs,85*MIN);
});
check("legacy running sessions checkpoint the old elapsed allocation before upgrading", () => {
  const legacy={...fresh([task("a"),task("b")],"10:00"),mode:"work",taskId:"a",controllerId:"old-device"};
  delete legacy.allocationVersion;
  assert.ok(parseTracking(legacy));
  const upgraded=advanceTracking(legacy,T+60*MIN).state;
  near(upgraded.taskMs.a,60*MIN); near(upgraded.taskMs.b??0,0);
  assert.equal(upgraded.allocationVersion,2); assert.equal(upgraded.cursor,T+60*MIN);
  const later=advanceTracking(upgraded,T+70*MIN).state;
  near(later.taskMs.a,60*MIN); near(later.taskMs.b,10*MIN);
  const end=advanceTracking(upgraded,T+120*MIN).state;
  near(end.workMs,90*MIN);
});
check("legacy paused counters are preserved and allocation upgrades are idempotent", () => {
  const legacy={...fresh(),taskMs:{first:100*MIN},workMs:100*MIN};
  delete legacy.allocationVersion;
  const upgraded=advanceTracking(legacy,T+MIN).state;
  assert.deepEqual(upgraded.taskMs,legacy.taskMs); near(upgraded.workMs,legacy.workMs);
  assert.deepEqual(advanceTracking(upgraded,T+MIN).state,upgraded);
  assert.equal(parseTracking({...upgraded,allocationVersion:99}),null);
});
check("priority multiplies a task's share of work time", () => {
  const p = taskProgress(fresh([task("a"), {...task("b"), priority:"medium"}, {...task("c"), priority:"high"}]));
  near(p[1].probability/p[0].probability, 2); near(p[2].probability/p[0].probability, 4);
  near(p[2].targetMs, 4*p[0].targetMs);
  // Priority changes how long a task gets, not when the timer reaches it.
  assert.equal(actOnTracking(fresh([task("a"), {...task("c"), priority:"high"}]),{type:"start"},"device-1",T).taskId,"a");
});
check("raising a priority rebalances future targets and keeps earned time", () => {
  const s = advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+30*MIN).state;
  const raised = tasks.map(t => t.id==="second" ? {...t, priority:"high"} : t);
  assert.notEqual(trackingConfigKey(raised,"18:00",PLAN), trackingConfigKey(tasks,"18:00",PLAN));
  // No priority and an explicit low are the same configuration: no needless checkpoint.
  assert.equal(trackingConfigKey(tasks.map(t => ({...t, priority:"low"})),"18:00"), trackingConfigKey(tasks,"18:00"));
  const next = configureTracking(s, raised, "18:00", T+30*MIN);
  near(next.taskMs.first, 30*MIN);
  const before = taskProgress(s).find(p=>p.task.id==="second"), after = taskProgress(next).find(p=>p.task.id==="second");
  assert.ok(after.targetMs > before.targetMs); near(workBudget(next), workBudget(s));
});
check("snapshots from before priorities load; unknown priorities are rejected", () => {
  assert.ok(parseTracking(fresh()));
  assert.ok(parseTracking(fresh([{...task("a"), priority:"medium"}])));
  assert.equal(parseTracking(fresh([{...task("a"), priority:"urgent"}])), null);
});
check("a task whose day would total under 30 minutes is skipped and its time goes to the rest", () => {
  assert.equal(MIN_DAILY_TARGET_MS, 30*MIN);
  const s=fresh([task("a"),task("b"),task("far","2026-11-13")]);
  const p=taskProgress(s), far=p[2];
  assert.equal(far.skipped,true); assert.equal(far.remainingMs,0); assert.equal(far.targetMs,0); assert.equal(far.doneToday,true); assert.equal(far.probability,0);
  near(p[0].remainingMs,225*MIN); near(p[1].remainingMs,225*MIN); near(p[0].probability,.5); near(p[1].probability,.5);
  near(p.reduce((sum,p)=>sum+p.remainingMs,0),workLeftMs(s));
  // Start never lands on it, it cannot be tracked by hand, and a full day of work gives it nothing.
  assert.throws(()=>actOnTracking(s,{type:"start",taskId:"far"},"device-1",T),/No unfinished daily target/);
  const end=advanceTracking(actOnTracking(s,{type:"start"},"device-1",T),dayEnd(s)).state;
  assert.equal(end.taskMs.far,undefined); near(end.taskMs.a,225*MIN); near(end.taskMs.b,225*MIN);
});
check("exactly 30 minutes is kept; just under is skipped", () => {
  // Weight 1/7 against 2: 450 * (1/7) / (15/7) = 30 minutes exactly.
  const kept=taskProgress(fresh([task("a"),task("week","2026-09-21")]))[1];
  assert.equal(kept.skipped,false); near(kept.targetMs,30*MIN);
  // Weight 1/8: 450 / 17 = 26.5 minutes, so it goes.
  const gone=taskProgress(fresh([task("a"),task("eight","2026-09-22")]))[1];
  assert.equal(gone.skipped,true);
});
check("a share within a millisecond of 30 minutes is kept and reads as 30m", () => {
  // 40 minutes on "a" plus 2 ms elsewhere leave 49:59.998 of a 90-minute goal,
  // and a 2:1 split gives "b" 29:59.99933. The rule keeps it, so the display
  // must not floor it to 29m.
  const s={...day([task("a"),task("b","2026-09-15")],90),workMs:40*MIN+2,taskMs:{a:40*MIN,other:2}};
  const b=taskProgress(s)[1];
  assert.equal(b.skipped,false); assert.ok(b.targetMs<30*MIN&&b.targetMs>30*MIN-1);
  assert.equal(formatDuration(b.targetMs),"30m"); assert.equal(formatDuration(b.remainingMs),"30m");
  assert.equal(formatDuration(30*MIN-1000),"29m"); assert.equal(formatDuration(0,true),"0:00:00");
});
check("among equal weights, the task lowest on the list is skipped first", () => {
  // Three weight-2 tasks share 60 minutes, 20 each. "tomorrow" is medium
  // priority, so it ties with the two due today but sits below them.
  const p=taskProgress(day([task("x"),{...task("tomorrow","2026-09-15"),priority:"medium"},task("z")],60));
  assert.deepEqual(p.map(p=>p.skipped),[false,true,false]);
  near(p[0].remainingMs,30*MIN); near(p[2].remainingMs,30*MIN);
});
check("tied tasks drop one at a time, lowest on the list first, until the rest reach 30 minutes", () => {
  // 60 minutes over three equal tasks is 20 each. Dropping one gives 30 each.
  const p=taskProgress(day([task("a"),task("b"),task("c")],60));
  assert.deepEqual(p.map(p=>p.skipped),[false,false,true]);
  near(p[0].remainingMs,30*MIN); near(p[1].remainingMs,30*MIN);
});
check("the most important task is never skipped, so short days are not wasted", () => {
  const s=day([task("a"),task("tomorrow","2026-09-15")],20);
  const p=taskProgress(s);
  assert.equal(p[0].skipped,false); near(p[0].remainingMs,20*MIN); assert.equal(p[1].skipped,true);
  assert.equal(actOnTracking(s,{type:"start"},"device-1",T).taskId,"a");
});
check("skipped time goes only to more urgent tasks, never to less urgent ones", () => {
  // "mid" would get all 20 minutes left (a 20-minute day) and is skipped.
  // "light" sits below it, so none of that time may go there, even though
  // light is nearer its share than "heavy", which is far over its own.
  const list=[task("light","2026-09-16"),task("mid","2026-09-15"),task("heavy")];
  const s={...day(list,360),taskMs:{light:40*MIN,heavy:300*MIN},workMs:340*MIN};
  const p=taskProgress(s);
  assert.equal(p[1].skipped,true); near(p[0].remainingMs,0); near(p[2].remainingMs,20*MIN);
});
check("30 logged minutes protect a task, and nothing reads as skipped once the work is done", () => {
  const s={...fresh([task("a"),task("far","2026-11-13")]),taskMs:{far:35*MIN},workMs:35*MIN};
  const far=taskProgress(s)[1];
  assert.equal(far.skipped,false); assert.equal(far.doneToday,true); near(far.targetMs,35*MIN);
  const over=advanceTracking(actOnTracking(fresh([task("a"),task("b"),task("far","2026-11-13")]),{type:"start"},"device-1",T),dayEnd(fresh())).state;
  near(workLeftMs(over),0); assert.ok(taskProgress(over).every(p=>!p.skipped));
});
check("randomized days conserve actual work and never count paused time", () => {
  let seed=73191;
  const random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32; };
  for(let trial=0;trial<300;trial++) {
    const list=Array.from({length:1+Math.floor(random()*12)},(_,i)=>task(`task-${i}`,`2026-09-${String(14+Math.floor(random()*12)).padStart(2,"0")}`));
    const plan={startTime:"08:00",workParts:1+Math.floor(random()*4),idleParts:1+Math.floor(random()*4)};
    const s=createTracking(list,"18:00","UTC",T,plan,random()<.3,random()<.7);
    const { workMs: goal, idleMs: allowance }=dayBudget(s);
    // A consistent state: some work and some idle time already used, never more idle than allowed.
    const worked=Math.floor(random()*goal/MIN)*MIN, idled=Math.floor(random()*allowance/MIN)*MIN;
    s.cursor=T+worked+idled;
    let left=worked;
    for(const t of list) { const share=Math.min(left,Math.floor(random()*120)*MIN); s.taskMs[t.id]=share; left-=share; }
    s.taskMs[list[0].id]+=left; s.workMs=worked;
    const p=taskProgress(s), available=workLeftMs(s);
    near(p.reduce((sum,p)=>sum+p.remainingMs,0),available);
    near(available+idleLeftMs(s),dayEnd(s)-s.cursor);
    for(const entry of p) { assert.ok(entry.targetMs>=entry.trackedMs); assert.ok(entry.remainingMs>=0); }
    const unfinished=p.filter(p=>!p.doneToday);
    for(const entry of unfinished) near(entry.targetMs/entry.weight,unfinished[0].targetMs/unfinished[0].weight);
    for(const begin of [s, canTrackWork(s)&&unfinished.length ? actOnTracking(s,{type:"start"},"test-device",s.cursor) : s]) {
      const end=advanceTracking(begin,dayEnd(begin)).state;
      if(begin.mode==="idle") {
        near(end.workMs,s.workMs); near(idleLeftMs(end),0); assert.equal(end.carryMs,undefined);
        assert.equal(end.mode,"idle"); continue;
      }
      assert.ok(Math.abs(end.workMs-s.workMs-available)<0.01,JSON.stringify({trial,available,plan}));
      const endProgress=taskProgress(end);
      for(const entry of p) near(endProgress.find(p=>p.task.id===entry.task.id).trackedMs,entry.targetMs);
      assert.ok(endProgress.every(p=>p.doneToday)); assert.equal(end.mode,"idle");
    }
  }
});

console.log("== shared account timer (real Postgres) ==");
const pg=new PGlite();
setSql({ query:async(text,params=[]) => (await pg.query(text,params)).rows, transaction:async statements=>pg.transaction(async tx=>{ for(const s of statements) await tx.query(s.text,s.params??[]); }) });
await ensureSchema();
for (const id of ["timer-alice","timer-bob"]) await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)",[id,new Date(T).toISOString()]);
await saveState("timer-alice",{tasks,recommendation:null,schedule:null,endTime:"18:00",plan:PLAN});
let shared=await commandTracking("timer-alice",0,{type:"start"},"device-1","UTC",tasks,"18:00",PLAN,T);
assert.equal(shared.revision,1); count++;
const races=await Promise.allSettled([
  commandTracking("timer-alice",1,{type:"start",taskId:"second"},"device-2","UTC",tasks,"18:00",PLAN,T+10*MIN),
  commandTracking("timer-alice",1,{type:"pause"},"device-3","UTC",tasks,"18:00",PLAN,T+10*MIN),
]);
assert.equal(races.filter(r=>r.status==="fulfilled").length,1); assert.ok(races.find(r=>r.status==="rejected").reason instanceof TrackingConflict); count++;
shared=await loadTracking("timer-alice"); near(shared.workMs,10*MIN); assert.equal(shared.revision,2); count++;
assert.equal(await loadTracking("timer-bob"),null); count++;
// Old clients still send whole-state PUTs without a plan. The stored plan is
// kept, and they cannot overwrite any timer fields.
await saveState("timer-alice",{tasks,recommendation:null,schedule:null,endTime:"18:00"},{plan:true});
assert.deepEqual((await loadState("timer-alice")).plan,PLAN);
assert.deepEqual(await loadTracking("timer-alice"),shared); count++;
await configureAccountTracking("timer-alice",tasks.slice(1),"18:00",PLAN,T+20*MIN);
const changed=await loadTracking("timer-alice"); assert.ok(changed.revision>shared.revision); assert.deepEqual(changed.tasks,tasks.slice(1)); count++;
assert.ok((await loadState("timer-alice")).tasks.length===3); count++;
// A reset uses the same revision-checked command path as every other client.
const accountBeforeReset=await loadState("timer-alice");
const reset=await commandTracking("timer-alice",changed.revision,{type:"reset"},"device-reset","America/Toronto",tasks,"18:00",PLAN,T+25*MIN);
assert.equal(reset.revision,changed.revision+1); assert.equal(reset.timeZone,"UTC");
assert.equal(reset.mode,"idle"); assert.equal(reset.controllerId,"device-reset");
assert.deepEqual(reset.taskMs,{}); near(reset.workMs,0);
assert.deepEqual(await loadTracking("timer-alice"),reset); count++;
for(const type of ["start","pause","reset"]) {
  await assert.rejects(commandTracking("timer-alice",changed.revision,{type},"stale-device","UTC",tasks,"18:00",PLAN,T+26*MIN),TrackingConflict);
}
assert.deepEqual(await loadTracking("timer-alice"),reset); count++;
assert.deepEqual(await loadState("timer-alice"),accountBeforeReset);
assert.equal(await loadTracking("timer-bob"),null); count++;
await saveState("timer-alice",accountBeforeReset);
assert.deepEqual(await loadTracking("timer-alice"),reset); count++;
const resumed=await commandTracking("timer-alice",reset.revision,{type:"start"},"device-3","UTC",tasks,"18:00",PLAN,T+30*MIN);
near(advanceTracking(resumed,T+40*MIN).state.workMs,10*MIN);
assert.equal(resumed.taskId,"first"); count++;
// Priority and plan changes saved from any client reconfigure the shared timer.
await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)",["timer-carol",new Date(T).toISOString()]);
await saveState("timer-carol",{tasks,recommendation:null,schedule:null,endTime:"18:00",plan:PLAN});
const carolTimer=await commandTracking("timer-carol",0,{type:"start"},"device-1","UTC",tasks,"18:00",PLAN,T);
await saveState("timer-carol",{tasks:tasks.map(t=>t.id==="later"?{...t,priority:"high"}:t),recommendation:null,schedule:null,endTime:"18:00",plan:PLAN});
const carolAfter=await loadTracking("timer-carol");
assert.ok(carolAfter.revision>carolTimer.revision); assert.equal(carolAfter.tasks.find(t=>t.id==="later").priority,"high"); count++;
const evenPlan={startTime:"08:00",workParts:1,idleParts:1};
await saveState("timer-carol",{tasks,recommendation:null,schedule:null,endTime:"18:00",plan:evenPlan});
assert.deepEqual(dayPlan(await loadTracking("timer-carol")),evenPlan);
assert.deepEqual((await loadState("timer-carol")).plan,evenPlan); count++;
await pg.query("DELETE FROM users WHERE id = $1",["timer-carol"]);
// A synced toggle changes the shared policy, and legacy saves cannot turn it off.
await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)", ["timer-unweighted", new Date(T).toISOString()]);
const oldNow = Date.now;
try {
  Date.now = () => T + 10 * MIN;
  await saveState("timer-unweighted", { tasks, recommendation: null, schedule: null, endTime: "18:00", plan: PLAN });
  const initial = await commandTracking("timer-unweighted", 0, { type: "start" }, "device-1", "UTC", tasks, "18:00", PLAN, T);
  const prefs = { tasks, recommendation: null, schedule: null, endTime: "18:00", plan: PLAN, unweighted: true };
  await saveState("timer-unweighted", prefs);
  const synced = await loadTracking("timer-unweighted");
  assert.equal((await loadState("timer-unweighted")).unweighted, true);
  assert.equal(synced.unweighted, true); assert.ok(synced.revision > initial.revision);
  near(synced.workMs, 10 * MIN); assert.equal(synced.controllerId, "device-1"); count++;
  const { unweighted, ...legacyPrefs } = prefs;
  await saveState("timer-unweighted", legacyPrefs, { unweighted: true });
  assert.equal((await loadState("timer-unweighted")).unweighted, true);
  assert.deepEqual(await loadTracking("timer-unweighted"), synced); count++;
  await saveState("timer-unweighted", { ...prefs, unweighted: false });
  assert.equal((await loadTracking("timer-unweighted")).unweighted, false);
  assert.equal((await loadState("timer-unweighted")).unweighted, false); count++;
} finally { Date.now = oldNow; }
await pg.query("DELETE FROM users WHERE id = $1", ["timer-unweighted"]);
// The minimum preference is independent, synced, and protected against older clients.
await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)", ["timer-minimum", new Date(T).toISOString()]);
try {
  Date.now = () => T + 8 * MIN;
  assert.equal((await loadState("timer-minimum")).minimumEnabled, true);
  // 08:00–08:20 at 3:1 holds 15 minutes of work.
  const list = [task("a"), task("b")];
  await saveState("timer-minimum", { tasks: list, recommendation: null, schedule: null, endTime: "08:20", plan: PLAN });
  const initial = await commandTracking("timer-minimum", 0, { type: "start" }, "device-1", "UTC", list, "08:20", PLAN, T);
  const prefs = { tasks: list, recommendation: null, schedule: null, endTime: "08:20", plan: PLAN, unweighted: true, minimumEnabled: false };
  await saveState("timer-minimum", prefs);
  const synced = await loadTracking("timer-minimum");
  assert.equal((await loadState("timer-minimum")).minimumEnabled, false);
  assert.equal(synced.minimumEnabled, false); assert.ok(synced.revision > initial.revision);
  near(synced.workMs, 8 * MIN); assert.equal(synced.controllerId, "device-1");
  assert.ok(taskProgress(synced).every(p => !p.skipped)); count++;
  const { minimumEnabled, ...legacyPrefs } = prefs;
  await saveState("timer-minimum", legacyPrefs, { minimumEnabled: true });
  assert.equal((await loadState("timer-minimum")).minimumEnabled, false);
  assert.deepEqual(await loadTracking("timer-minimum"), synced); count++;
  await saveState("timer-minimum", { ...prefs, minimumEnabled: true });
  const restored = await loadTracking("timer-minimum");
  assert.equal(restored.minimumEnabled, true); assert.equal(restored.unweighted, true);
  assert.deepEqual(restored.taskMs, synced.taskMs); assert.equal(taskProgress(restored)[1].skipped, true); count++;
  await saveState("timer-minimum", { ...prefs, minimumEnabled: true, minimumMinutes: 5 });
  const custom = await loadTracking("timer-minimum");
  assert.equal((await loadState("timer-minimum")).minimumMinutes, 5);
  assert.equal(custom.minimumMinutes, 5); assert.ok(taskProgress(custom).every(p => !p.skipped));
  assert.deepEqual(custom.taskMs, synced.taskMs); count++;
  await saveState("timer-minimum", { ...prefs, minimumEnabled: true }, { minimumMinutes: true });
  assert.equal((await loadState("timer-minimum")).minimumMinutes, 5);
  assert.deepEqual(await loadTracking("timer-minimum"), custom); count++;
  const paused = await commandTracking("timer-minimum", custom.revision, { type: "pause" }, "device-1", "UTC", list, "08:20", PLAN, Date.now(), true, true, 5);
  assert.equal(paused.minimumMinutes, 5); assert.deepEqual(paused.taskMs, custom.taskMs); count++;
} finally { Date.now = oldNow; }
await pg.query("DELETE FROM users WHERE id = $1", ["timer-minimum"]);
// Upgrading on GET is revision-checked and persisted once, so other clients
// inherit the same checkpoint rather than reinterpreting old elapsed work.
const legacy={...fresh([task("a"),task("b")],"10:00"),revision:resumed.revision,mode:"work",taskId:"a",controllerId:"old-device"};
delete legacy.allocationVersion;
await pg.query("UPDATE tracking SET state=$1 WHERE user_id=$2",[JSON.stringify(legacy),"timer-alice"]);
const [migrated,otherClient]=await Promise.all([readAccountTracking("timer-alice",T+60*MIN),readAccountTracking("timer-alice",T+60*MIN)]);
assert.deepEqual(otherClient,migrated);
assert.equal(migrated.revision,resumed.revision+1); assert.equal(migrated.allocationVersion,2);
near(migrated.taskMs.a,60*MIN); near(migrated.taskMs.b??0,0);
assert.deepEqual(await loadTracking("timer-alice"),migrated); count++;
assert.deepEqual(await readAccountTracking("timer-alice",T+65*MIN),migrated);
near(advanceTracking(await loadTracking("timer-alice"),T+65*MIN).state.taskMs.b,5*MIN); count++;
// A timer stored by the break model loads on the server as idle, with its work.
const breakEra={...fresh(),revision:migrated.revision,mode:"rest",workMs:90*MIN,taskMs:{first:90*MIN},restMs:5*MIN,cycleWorkMs:90*MIN,cycleRestMs:5*MIN};
delete breakEra.plan;
await pg.query("UPDATE tracking SET state=$1 WHERE user_id=$2",[JSON.stringify(breakEra),"timer-alice"]);
const loaded=await loadTracking("timer-alice");
assert.equal(loaded.mode,"idle"); near(loaded.workMs,90*MIN); assert.equal("restMs" in loaded,false); count++;
await pg.query("DELETE FROM users WHERE id = $1",["timer-alice"]); assert.equal(await loadTracking("timer-alice"),null); count++;
// Two devices crossing midnight share one persisted fresh day, without debt.
await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)", ["timer-carry", new Date(T).toISOString()]);
const lateStart = await commandTracking("timer-carry", 0, { type: "start" }, "desktop", "UTC", tasks, "18:00", PLAN, T + 160 * MIN);
const nextMorning = T + 24 * 60 * MIN;
const [rolled, duplicate] = await Promise.all([readAccountTracking("timer-carry", nextMorning), readAccountTracking("timer-carry", nextMorning)]);
assert.deepEqual(duplicate, rolled); assert.equal(rolled.carryMs, undefined);
assert.equal(rolled.revision, lateStart.revision + 1); assert.equal(rolled.controllerId, "desktop"); count++;
assert.deepEqual(await readAccountTracking("timer-carry", nextMorning + MIN), rolled);
assert.deepEqual(await loadTracking("timer-carry"), rolled); count++;
await assert.rejects(commandTracking("timer-carry", lateStart.revision, { type: "reset" }, "stale", "UTC", tasks, "18:00", PLAN, nextMorning), TrackingConflict);
assert.deepEqual(await loadTracking("timer-carry"), rolled); count++;
const carryReset = await commandTracking("timer-carry", rolled.revision, { type: "reset" }, "phone", "UTC", tasks, "18:00", PLAN, nextMorning + MIN);
assert.equal(carryReset.carryMs, undefined); assert.equal(carryReset.mode, "idle");
assert.deepEqual(dayBudget(carryReset), { workMs: 450 * MIN, idleMs: 150 * MIN }); count++;
// An old client state upgrades at one revision-checked checkpoint.
const preBorrowing = borrowingSnapshot({ revision: carryReset.revision, cursor: T + 120 * MIN, workMs: 90 * MIN, taskMs: { first: 90 * MIN }, controllerId: "desktop" });
await pg.query("UPDATE tracking SET state=$1 WHERE user_id=$2", [JSON.stringify(preBorrowing), "timer-carry"]);
const [upgradeA, upgradeB] = await Promise.all([readAccountTracking("timer-carry", T + 160 * MIN), readAccountTracking("timer-carry", T + 160 * MIN)]);
assert.deepEqual(upgradeA, upgradeB); assert.equal(upgradeA.carryMs, undefined); near(upgradeA.workMs, 90 * MIN);
assert.deepEqual(upgradeA.taskMs, preBorrowing.taskMs); assert.equal(upgradeA.controllerId, "desktop"); assert.equal(upgradeA.idlePolicyVersion, 2);
assert.equal(upgradeA.revision, carryReset.revision + 1);
assert.deepEqual(await readAccountTracking("timer-carry", T + 161 * MIN), upgradeA); count++;
await pg.query("DELETE FROM users WHERE id=$1", ["timer-carry"]);
await pg.close(); setSql(null);
console.log(`${count} tracking scenarios passed`);
