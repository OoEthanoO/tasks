import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { createTracking, advanceTracking, configureTracking, actOnTracking, taskProgress, remainingWorkTime, workBudget, dayEnd, trackingDay, parseTracking, trackingConfigKey, upcomingTrackingEvents, MIN_DAILY_TARGET_MS, WORK_CYCLE_MS, REST_CYCLE_MS } = require("../.test-build/tracking.js");
const { setSql, ensureSchema } = require("../.test-build/sql.js");
const { commandTracking, loadTracking, readAccountTracking, configureAccountTracking, TrackingConflict } = require("../.test-build/tracking-db.js");
const { saveState, loadState } = require("../.test-build/db.js");
const MIN = 60_000;
const T = Date.parse("2026-09-14T08:00:00Z");
const task = (id, dueDate = "2026-09-14") => ({ id, title: id, description: "", dueDate, createdAt: new Date(T).toISOString(), completed: false, completedAt: null });
const tasks = [task("first"), task("second"), task("later", "2026-09-15")];
const fresh = (list = tasks, end = "18:00") => createTracking(list, end, "UTC", T);
let count = 0;
function check(name, fn) { fn(); count++; console.log(`✓ ${name}`); }
function near(a, b) { assert.ok(Math.abs(a-b) < 0.01, `${a} != ${b}`); }

check("task percentages sum to 100% of work, excluding rest", () => {
  const p = taskProgress(fresh()); near(p[0].probability, .4); near(p[1].probability,.4); near(p[2].probability,.2);
  near(p.reduce((sum,p)=>sum+p.probability,0), 1);
});
check("default is the highest-weight task, with display-order ties", () => {
  assert.equal(actOnTracking(fresh(), {type:"start"}, "device-1", T).taskId, "first");
  assert.equal(actOnTracking(fresh([tasks[2],tasks[1],tasks[0]]), {type:"start"}, "device-1", T).taskId, "second");
});
check("manual selection overrides default without changing weights", () => {
  assert.equal(actOnTracking(fresh(), {type:"start",taskId:"later"}, "device-1", T).taskId,"later");
});
check("idle shrinks the budget and does not accumulate time", () => {
  const s = advanceTracking(fresh(), T+40*MIN).state;
  assert.equal(s.workMs,0); near(workBudget(s),440*MIN); near(taskProgress(s)[0].targetMs,176*MIN);
});
check("active work keeps the budget constant", () => {
  const s = advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+40*MIN).state;
  near(s.taskMs.first,40*MIN); near(s.workMs,40*MIN); near(workBudget(s),450*MIN);
});
check("switching keeps both tasks' accumulated time", () => {
  let s = actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"start",taskId:"second"},"device-1",T+20*MIN);
  s=advanceTracking(s,T+35*MIN).state;
  near(s.taskMs.first,20*MIN); near(s.taskMs.second,15*MIN); near(s.workMs,35*MIN);
});
check("pause/resume preserves the cycle and excludes paused time", () => {
  let s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"pause"},"device-1",T+30*MIN);
  s=actOnTracking(s,{type:"start"},"device-1",T+60*MIN);
  s=advanceTracking(s,T+90*MIN).state;
  near(s.workMs,60*MIN); near(s.cycleWorkMs,60*MIN); near(workBudget(s),450*MIN);
});
check("90 cumulative work minutes force rest across task switches", () => {
  let s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"start",taskId:"second"},"device-1",T+45*MIN);
  const result=advanceTracking(s,T+90*MIN);
  assert.equal(result.state.mode,"rest"); near(result.state.workMs,90*MIN); assert.equal(result.state.taskId,null);
  assert.deepEqual(result.events.map(e=>e.type),["rest-soon","rest-start"]);
});
check("rest is reserved up front and does not change targets while taken", () => {
  const start=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const s=advanceTracking(start,T+120*MIN).state;
  near(s.workMs,90*MIN); near(s.restMs,30*MIN); near(workBudget(s),450*MIN);
  assert.deepEqual(taskProgress(s).map(p=>p.targetMs),taskProgress(start).map(p=>p.targetMs));
  near(s.restMs/(s.workMs+s.restMs),.25); assert.equal(s.mode,"work"); near(s.cycleWorkMs,0);
});
check("pausing rest cannot bypass the remaining break", () => {
  let s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"pause"},"device-1",T+100*MIN);
  s=actOnTracking(s,{type:"start",taskId:"second"},"device-2",T+130*MIN);
  assert.equal(s.mode,"rest"); near(s.cycleRestMs,10*MIN);
  s=advanceTracking(s,T+150*MIN).state; near(s.restMs,30*MIN); assert.equal(s.mode,"work");
});
check("skipping a break goes straight back to work and restarts the 90-minute stretch", () => {
  let s=advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+100*MIN).state;
  assert.equal(s.mode,"rest"); near(s.cycleRestMs,10*MIN);
  const left=remainingWorkTime(s);
  s=actOnTracking(s,{type:"skip-rest"},"device-2",T+100*MIN);
  assert.equal(s.mode,"work"); assert.equal(s.taskId,"first");
  near(s.cycleWorkMs,0); near(s.cycleRestMs,0); near(s.restMs,10*MIN);
  // The 20 unserved break minutes become work time for today's targets.
  near(remainingWorkTime(s),left+20*MIN);
  const later=advanceTracking(s,T+190*MIN);
  assert.equal(later.state.mode,"rest"); near(later.state.workMs,180*MIN);
  assert.ok(later.events.some(e=>e.type==="rest-start"&&e.at===T+190*MIN));
  // Alerts follow: the old "rest complete" is gone, the next break is predicted.
  const upcoming=upcomingTrackingEvents(s,T+100*MIN);
  assert.ok(!upcoming.some(e=>e.type==="rest-complete"&&e.at===T+120*MIN));
  assert.ok(upcoming.some(e=>e.type==="rest-start"&&e.at===T+190*MIN));
});
check("a break that is due while paused can be skipped too", () => {
  const s={...fresh(),cycleWorkMs:90*MIN,workMs:90*MIN,taskMs:{first:90*MIN}};
  assert.equal(actOnTracking(s,{type:"start"},"device-1",T).mode,"rest");
  const skipped=actOnTracking(s,{type:"skip-rest"},"device-1",T);
  assert.equal(skipped.mode,"work"); near(skipped.cycleWorkMs,0);
});
check("skipping when no break is due leaves the stretch alone", () => {
  // Another device already ended the break: a running task carries on untouched.
  const working=advanceTracking(actOnTracking(fresh(),{type:"start",taskId:"second"},"device-1",T),T+40*MIN).state;
  const same=actOnTracking(working,{type:"skip-rest"},"device-2",T+40*MIN);
  assert.equal(same.mode,"work"); assert.equal(same.taskId,"second"); near(same.cycleWorkMs,40*MIN);
  // Paused mid-stretch, it resumes and keeps the progress toward the next break.
  const paused=actOnTracking(working,{type:"pause"},"device-1",T+40*MIN);
  const resumed=actOnTracking(paused,{type:"skip-rest"},"device-1",T+40*MIN);
  assert.equal(resumed.mode,"work"); near(resumed.cycleWorkMs,40*MIN);
  assert.throws(()=>actOnTracking(paused,{type:"skip-rest"},"device-1",dayEnd(paused)),/work day has ended/);
});
check("task completion notifies and selects next without permanent completion", () => {
  const s=actOnTracking(fresh([task("a"),task("b")],"10:00"),{type:"start"},"device-1",T);
  const out=advanceTracking(s,T+60*MIN);
  assert.equal(out.state.taskId,"b"); assert.equal(out.events[0].type,"task-complete");
  assert.equal(taskProgress(out.state)[0].doneToday,true); assert.equal(out.state.tasks[0].completed,false);
});
check("shrinking targets mark previously tracked tasks done while paused", () => {
  let s=actOnTracking(fresh([task("a"),task("b")],"10:00"),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"pause"},"device-1",T+30*MIN);
  s=advanceTracking(s,T+90*MIN).state;
  assert.equal(taskProgress(s)[0].doneToday,true);
  assert.equal(actOnTracking(s,{type:"start"},"device-1",T+90*MIN).taskId,"b");
});
check("midnight wipes every counter, pauses, and makes tasks eligible anew", () => {
  const s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const reset=advanceTracking(s,Date.parse("2026-09-15T08:00:00Z")).state;
  assert.deepEqual(reset.taskMs,{}); near(reset.workMs,0); near(reset.restMs,0); near(reset.cycleWorkMs,0); assert.equal(reset.mode,"idle"); assert.equal(reset.dayKey,"2026-09-15");
  assert.ok(taskProgress(reset).every(p=>!p.doneToday));
});
check("manual reset wipes all task time and pauses without mutating the old session", () => {
  let before=actOnTracking(fresh(),{type:"start"},"device-1",T);
  before=actOnTracking(before,{type:"start",taskId:"second"},"device-1",T+20*MIN);
  const copy=JSON.stringify(before);
  const reset=actOnTracking(before,{type:"reset"},"device-2",T+40*MIN);
  assert.deepEqual(reset.taskMs,{});
  for(const key of ["workMs","restMs","cycleWorkMs","cycleRestMs"]) near(reset[key],0);
  assert.equal(reset.mode,"idle"); assert.equal(reset.taskId,null);
  assert.equal(reset.controllerId,"device-2"); assert.equal(reset.cursor,T+40*MIN);
  assert.equal(JSON.stringify(before),copy);
});
check("manual reset clears active rest and paused rest debt", () => {
  const initial=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const resting=advanceTracking(initial,T+100*MIN).state;
  assert.equal(resting.mode,"rest"); near(resting.cycleRestMs,10*MIN);
  for(const before of [resting,actOnTracking(resting,{type:"pause"},"device-1",T+100*MIN)]) {
    const reset=actOnTracking(before,{type:"reset"},"device-2",T+105*MIN);
    near(reset.restMs,0); near(reset.cycleRestMs,0); near(reset.cycleWorkMs,0);
    assert.equal(reset.mode,"idle");
    const resumed=actOnTracking(reset,{type:"start"},"device-2",T+110*MIN);
    assert.equal(resumed.mode,"work");
    near(advanceTracking(resumed,T+120*MIN).state.workMs,10*MIN);
  }
});
check("reset preserves task metadata, permanent completion, cutoff, zone and revision", () => {
  const list=[...tasks,{...task("done"),completed:true,completedAt:new Date(T).toISOString()}];
  const initial={...createTracking(list,"20:15","America/Toronto",T),revision:42};
  const before=actOnTracking(initial,{type:"start"},"device-1",T);
  const reset=actOnTracking(before,{type:"reset"},"device-2",T+40*MIN);
  assert.deepEqual(reset.tasks,list); assert.equal(reset.endTime,"20:15");
  assert.equal(reset.timeZone,initial.timeZone); assert.equal(reset.dayKey,initial.dayKey); assert.equal(reset.revision,42);
});
check("reset makes daily-complete tasks eligible and uses only the remaining day", () => {
  const before=advanceTracking(actOnTracking(fresh([task("a"),task("b")],"10:00"),{type:"start"},"device-1",T),T+60*MIN).state;
  assert.equal(taskProgress(before)[0].doneToday,true);
  const reset=actOnTracking(before,{type:"reset"},"device-1",T+60*MIN);
  near(workBudget(reset),60*MIN);
  assert.ok(taskProgress(reset).every(p=>!p.doneToday && p.trackedMs===0 && p.targetMs===30*MIN));
  assert.equal(actOnTracking(reset,{type:"start"},"device-1",T+60*MIN).taskId,"a");
});
check("reset checkpoint cannot replay old time and cancels upcoming alerts", () => {
  const before=actOnTracking(fresh(),{type:"start"},"device-1",T);
  assert.ok(upcomingTrackingEvents(before,T).length>0);
  const reset=actOnTracking(before,{type:"reset"},"device-2",T+40*MIN);
  const restored=parseTracking(JSON.parse(JSON.stringify(reset)));
  assert.deepEqual(restored,reset);
  const projected=advanceTracking(restored,T+80*MIN);
  near(projected.state.workMs,0); near(projected.state.restMs,0);
  assert.deepEqual(projected.events,[]); assert.deepEqual(upcomingTrackingEvents(restored,T+40*MIN),[]);
  const started=actOnTracking(restored,{type:"start"},"device-2",T+80*MIN);
  near(advanceTracking(started,T+90*MIN).state.workMs,10*MIN);
});
check("reset is allowed after cutoff but cannot extend the work day", () => {
  const before=actOnTracking(fresh([task("a")],"08:20"),{type:"start"},"device-1",T);
  const reset=actOnTracking(before,{type:"reset"},"device-1",T+40*MIN);
  near(reset.workMs,0); near(workBudget(reset),0); assert.equal(reset.endTime,"08:20");
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
  const s=actOnTracking(fresh([task("a")],"08:20"),{type:"start"},"device-1",T);
  const out=advanceTracking(s,T+80*MIN).state;
  near(out.workMs,20*MIN); assert.equal(out.mode,"idle");
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
  const initial=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const once=advanceTracking(initial,T+8*60*MIN).state;
  let incremental=initial;
  for(let i=1;i<=960;i++) incremental=advanceTracking(incremental,T+i*30_000).state;
  near(incremental.workMs,once.workMs); near(incremental.restMs,once.restMs);
  for(const id of Object.keys(once.taskMs)) near(incremental.taskMs[id],once.taskMs[id]);
  assert.equal(incremental.mode,once.mode); assert.equal(incremental.taskId,once.taskId);
});
check("notification forecasts match automatic transitions", () => {
  const initial=actOnTracking(fresh(),{type:"start"},"device-1",T);
  assert.deepEqual(upcomingTrackingEvents(initial,T),advanceTracking(initial,dayEnd(initial)).events);
  assert.ok(upcomingTrackingEvents(initial,T).some(e=>e.type==="rest-complete"));
  assert.deepEqual(upcomingTrackingEvents(actOnTracking(initial,{type:"pause"},"device-1",T),T),[]);
});
check("account time zone governs midnight and DST", () => {
  assert.equal(trackingDay(Date.parse("2026-09-15T02:00:00Z"),"America/Toronto"),"2026-09-14");
  assert.equal(new Date(dayEnd({dayKey:"2026-03-08",endTime:"23:00",timeZone:"America/Toronto"})).toISOString(),"2026-03-09T03:00:00.000Z");
  assert.equal(new Date(dayEnd({dayKey:"2026-11-01",endTime:"23:00",timeZone:"America/Toronto"})).toISOString(),"2026-11-02T04:00:00.000Z");
});
check("clock rollback cannot subtract or duplicate tracked time", () => {
  const s=advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+20*MIN).state;
  assert.deepEqual(advanceTracking(s,T).state,s);
});
check("corrupt guest counters are rejected", () => {
  assert.equal(parseTracking({...fresh(),workMs:-1}),null); assert.equal(parseTracking({...fresh(),cycleWorkMs:Infinity}),null);
  assert.equal(parseTracking({...fresh(),endTime:"25:99"}),null); assert.equal(parseTracking({...fresh(),timeZone:"not/a/zone"}),null);
  assert.ok(parseTracking(fresh()));
});
check("reserved property names can be valid task ids without corrupting counters", () => {
  const s=advanceTracking(actOnTracking(fresh([task("__proto__")]),{type:"start"},"device-1",T),T+MIN).state;
  near(s.taskMs.__proto__,MIN); near(s.workMs,MIN);
});

check("overruns cannot book more than the 16 minutes left, and slivers go to the tasks above", () => {
  const list=[...["chemistry","english","physics","yanvpn"].map(id=>task(id,"2026-09-15")),task("isu","2026-09-17"),task("ee","2026-09-17")];
  const s={...fresh(list,"08:16"),taskMs:{chemistry:41*MIN,english:24*MIN,physics:20*MIN,yanvpn:5*MIN},workMs:90*MIN,cycleWorkMs:28*MIN};
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
  const s={...fresh([task("a"),task("b")],"09:00"),taskMs:{a:14*MIN,b:0},workMs:14*MIN,cycleWorkMs:14*MIN};
  const p=taskProgress(s); near(p[0].remainingMs,23*MIN); near(p[1].remainingMs,37*MIN);
  near(p[0].targetMs,p[1].targetMs);
});
check("unequal weights preserve proportional final totals when feasible", () => {
  const s={...fresh([task("a"),task("b","2026-09-15")],"10:00"),taskMs:{a:9*MIN,b:6*MIN},workMs:15*MIN,cycleWorkMs:15*MIN};
  const p=taskProgress(s); near(p[0].targetMs,70*MIN); near(p[1].targetMs,35*MIN);
  near(p[0].remainingMs+p[1].remainingMs,90*MIN);
});
check("overruns never inflate later tasks and removed/completed work stays in history", () => {
  const s={...fresh([task("a"),task("b"),{...task("done"),completed:true}],"08:35"),taskMs:{a:40*MIN,b:0,done:15*MIN,deleted:30*MIN},workMs:85*MIN,cycleWorkMs:20*MIN};
  const p=taskProgress(s); near(p[0].remainingMs,0); near(p[1].remainingMs,35*MIN); near(p[2].remainingMs,0);
  near(p[0].targetMs,40*MIN); near(p[2].targetMs,15*MIN); near(s.workMs,85*MIN);
});
check("16 wall minutes with a break due in 5 only allocate 5 work minutes", () => {
  const s={...fresh(tasks,"08:16"),cycleWorkMs:85*MIN,workMs:85*MIN,taskMs:{first:85*MIN}};
  near(remainingWorkTime(s),5*MIN);
  near(taskProgress(s).reduce((sum,p)=>sum+p.remainingMs,0),5*MIN);
  const end=advanceTracking(actOnTracking(s,{type:"start"},"device-1",T),T+16*MIN).state;
  near(end.workMs,90*MIN); near(end.restMs,11*MIN); assert.equal(end.mode,"idle");
});
check("active and paused partial breaks reserve only their unserved rest", () => {
  for(const mode of ["rest","idle"]) {
    const s={...fresh(tasks,"08:16"),mode,cycleWorkMs:90*MIN,cycleRestMs:20*MIN,workMs:90*MIN,restMs:20*MIN,taskMs:{first:90*MIN}};
    near(remainingWorkTime(s),6*MIN);
    near(taskProgress(s).reduce((sum,p)=>sum+p.remainingMs,0),6*MIN);
  }
});
check("finishing a break does not reserve the same break again", () => {
  const s={...fresh([task("a")],"08:42"),mode:"rest",cycleWorkMs:90*MIN,workMs:90*MIN,taskMs:{a:90*MIN}};
  const resumed=advanceTracking(s,T+30*MIN).state;
  assert.equal(resumed.mode,"work"); near(remainingWorkTime(resumed),12*MIN);
  const end=advanceTracking(s,T+42*MIN).state;
  near(end.workMs,102*MIN); near(end.restMs,30*MIN);
});
check("work capacity agrees with a separate minute-by-minute rest simulation", () => {
  for(const worked of [0,30,85,89,90]) for(const rested of (worked===90?[0,10,29]:[0])) {
    for(const minutes of [0,1,5,16,30,89,90,91,119,120,121,239,600,900]) {
      const now=dayEnd(fresh())-minutes*MIN;
      const s={...fresh(),cursor:now,cycleWorkMs:worked*MIN,cycleRestMs:rested*MIN};
      let work=worked, rest=rested, available=0;
      for(let m=0;m<minutes;m++) {
        if(work===90) { rest++; if(rest===30) { work=0; rest=0; } }
        else { work++; available++; }
      }
      near(remainingWorkTime(s),available*MIN);
    }
  }
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
  near(end.workMs,90*MIN); near(end.restMs,30*MIN);
});
check("legacy paused counters are preserved and allocation upgrades are idempotent", () => {
  const legacy={...fresh(),taskMs:{first:100*MIN},workMs:100*MIN,restMs:30*MIN,cycleWorkMs:10*MIN};
  delete legacy.allocationVersion;
  const upgraded=advanceTracking(legacy,T+MIN).state;
  assert.deepEqual(upgraded.taskMs,legacy.taskMs); near(upgraded.workMs,legacy.workMs); near(upgraded.restMs,legacy.restMs);
  assert.deepEqual(advanceTracking(upgraded,T+MIN).state,upgraded);
  assert.equal(parseTracking({...upgraded,allocationVersion:99}),null);
});
check("priority multiplies a task's share of work time", () => {
  const p = taskProgress(fresh([task("a"), {...task("b"), priority:"medium"}, {...task("c"), priority:"high"}]));
  near(p[1].probability/p[0].probability, 2); near(p[2].probability/p[0].probability, 4);
  near(p[2].targetMs, 4*p[0].targetMs);
  assert.equal(actOnTracking(fresh([task("a"), {...task("c"), priority:"high"}]),{type:"start"},"device-1",T).taskId,"c");
});
check("raising a priority rebalances future targets and keeps earned time", () => {
  const s = advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+30*MIN).state;
  const raised = tasks.map(t => t.id==="second" ? {...t, priority:"high"} : t);
  assert.notEqual(trackingConfigKey(raised,"18:00"), trackingConfigKey(tasks,"18:00"));
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
// 08:00 to 18:00 leaves 450 minutes of work after breaks.
check("a task whose day would total under 30 minutes is skipped and its time goes to the rest", () => {
  assert.equal(MIN_DAILY_TARGET_MS, 30*MIN);
  const s=fresh([task("a"),task("b"),task("far","2026-11-13")]);
  const p=taskProgress(s), far=p[2];
  assert.equal(far.skipped,true); assert.equal(far.remainingMs,0); assert.equal(far.targetMs,0); assert.equal(far.doneToday,true); assert.equal(far.probability,0);
  near(p[0].remainingMs,225*MIN); near(p[1].remainingMs,225*MIN); near(p[0].probability,.5); near(p[1].probability,.5);
  near(p.reduce((sum,p)=>sum+p.remainingMs,0),remainingWorkTime(s));
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
check("tied tasks drop one at a time, newest first, until the rest reach 30 minutes", () => {
  // 60 minutes over three equal tasks is 20 each. Dropping one gives 30 each.
  const p=taskProgress(fresh([task("a"),task("b"),task("c")],"09:00"));
  assert.deepEqual(p.map(p=>p.skipped),[false,false,true]);
  near(p[0].remainingMs,30*MIN); near(p[1].remainingMs,30*MIN);
});
check("the most important task is never skipped, so short days are not wasted", () => {
  const s=fresh([task("a"),task("tomorrow","2026-09-15")],"08:20");
  const p=taskProgress(s);
  assert.equal(p[0].skipped,false); near(p[0].remainingMs,20*MIN); assert.equal(p[1].skipped,true);
  assert.equal(actOnTracking(s,{type:"start"},"device-1",T).taskId,"a");
});
check("skipped time goes only to more urgent tasks, never to less urgent ones", () => {
  // "mid" would get all 20 minutes (a 20-minute day) and is skipped. "light"
  // sits below it, so none of that time may go there, even though light is
  // nearer its share than "heavy", which is far over its own.
  const list=[task("light","2026-09-16"),task("mid","2026-09-15"),task("heavy")];
  const s={...fresh(list,"08:20"),taskMs:{light:40*MIN,heavy:300*MIN},workMs:340*MIN};
  const p=taskProgress(s);
  assert.equal(p[1].skipped,true); near(p[0].remainingMs,0); near(p[2].remainingMs,20*MIN);
});
check("30 logged minutes protect a task, and nothing reads as skipped once the day is over", () => {
  const s={...fresh([task("a"),task("far","2026-11-13")]),taskMs:{far:35*MIN},workMs:35*MIN};
  const far=taskProgress(s)[1];
  assert.equal(far.skipped,false); assert.equal(far.doneToday,true); near(far.targetMs,35*MIN);
  const over=advanceTracking(fresh([task("a"),task("b"),task("far","2026-11-13")]),dayEnd(fresh())).state;
  assert.ok(taskProgress(over).every(p=>!p.skipped));
});
check("randomized overrun cases conserve remaining time and finish with projected totals", () => {
  let seed=73191;
  const random=()=>{ seed=(Math.imul(seed,1664525)+1013904223)>>>0; return seed/2**32; };
  for(let trial=0;trial<300;trial++) {
    const list=Array.from({length:1+Math.floor(random()*12)},(_,i)=>task(`task-${i}`,`2026-09-${String(14+Math.floor(random()*12)).padStart(2,"0")}`));
    const s=fresh(list);
    s.cursor=T+Math.floor(random()*580)*MIN;
    s.cycleWorkMs=Math.floor(random()*91)*MIN;
    s.cycleRestMs=s.cycleWorkMs===WORK_CYCLE_MS?Math.floor(random()*30)*MIN:0;
    s.mode=s.cycleWorkMs===WORK_CYCLE_MS?"rest":"idle";
    for(const t of list) s.taskMs[t.id]=Math.floor(random()*120)*MIN;
    s.workMs=Object.values(s.taskMs).reduce((a,b)=>a+b,0);
    const p=taskProgress(s), available=remainingWorkTime(s);
    near(p.reduce((sum,p)=>sum+p.remainingMs,0),available);
    assert.ok(available<=dayEnd(s)-s.cursor);
    const unfinished=p.filter(p=>!p.doneToday);
    for(const entry of p) { assert.ok(entry.targetMs>=entry.trackedMs); assert.ok(entry.remainingMs>=0); }
    for(const entry of unfinished) near(entry.targetMs/entry.weight,unfinished[0].targetMs/unfinished[0].weight);
    const start=actOnTracking(s,{type:"start"},"test-device",s.cursor);
    const end=advanceTracking(start,dayEnd(start)).state;
    assert.ok(Math.abs(end.workMs-s.workMs-available)<0.01,JSON.stringify({trial,available,start,end,p}));
    const endProgress=taskProgress(end);
    for(const entry of p) near(endProgress.find(p=>p.task.id===entry.task.id).trackedMs,entry.targetMs);
    assert.ok(endProgress.every(p=>p.doneToday));
  }
});

console.log("== shared account timer (real Postgres) ==");
const pg=new PGlite();
setSql({ query:async(text,params=[]) => (await pg.query(text,params)).rows, transaction:async statements=>pg.transaction(async tx=>{ for(const s of statements) await tx.query(s.text,s.params??[]); }) });
await ensureSchema();
for (const id of ["timer-alice","timer-bob"]) await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)",[id,new Date(T).toISOString()]);
let shared=await commandTracking("timer-alice",0,{type:"start"},"device-1","UTC",tasks,"18:00",T);
assert.equal(shared.revision,1); count++;
const races=await Promise.allSettled([
  commandTracking("timer-alice",1,{type:"start",taskId:"second"},"device-2","UTC",tasks,"18:00",T+10*MIN),
  commandTracking("timer-alice",1,{type:"pause"},"device-3","UTC",tasks,"18:00",T+10*MIN),
]);
assert.equal(races.filter(r=>r.status==="fulfilled").length,1); assert.ok(races.find(r=>r.status==="rejected").reason instanceof TrackingConflict); count++;
shared=await loadTracking("timer-alice"); near(shared.workMs,10*MIN); assert.equal(shared.revision,2); count++;
assert.equal(await loadTracking("timer-bob"),null); count++;
// Old clients still send whole-state PUTs. They cannot overwrite any timer fields.
await saveState("timer-alice",{tasks,recommendation:null,schedule:null,endTime:"18:00"});
assert.deepEqual(await loadTracking("timer-alice"),shared); count++;
await configureAccountTracking("timer-alice",tasks.slice(1),"18:00",T+20*MIN);
const changed=await loadTracking("timer-alice"); assert.ok(changed.revision>shared.revision); assert.deepEqual(changed.tasks,tasks.slice(1)); count++;
assert.ok((await loadState("timer-alice")).tasks.length===3); count++;
// A reset uses the same revision-checked command path as every other client.
const accountBeforeReset=await loadState("timer-alice");
const reset=await commandTracking("timer-alice",changed.revision,{type:"reset"},"device-reset","America/Toronto",tasks,"18:00",T+25*MIN);
assert.equal(reset.revision,changed.revision+1); assert.equal(reset.timeZone,"UTC");
assert.equal(reset.mode,"idle"); assert.equal(reset.controllerId,"device-reset");
assert.deepEqual(reset.taskMs,{}); near(reset.workMs,0); near(reset.restMs,0); near(reset.cycleWorkMs,0); near(reset.cycleRestMs,0);
assert.deepEqual(await loadTracking("timer-alice"),reset); count++;
for(const type of ["start","pause","reset"]) {
  await assert.rejects(commandTracking("timer-alice",changed.revision,{type},"stale-device","UTC",tasks,"18:00",T+26*MIN),TrackingConflict);
}
assert.deepEqual(await loadTracking("timer-alice"),reset); count++;
assert.deepEqual(await loadState("timer-alice"),accountBeforeReset);
assert.equal(await loadTracking("timer-bob"),null); count++;
await saveState("timer-alice",accountBeforeReset);
assert.deepEqual(await loadTracking("timer-alice"),reset); count++;
const resumed=await commandTracking("timer-alice",reset.revision,{type:"start"},"device-3","UTC",tasks,"18:00",T+30*MIN);
near(advanceTracking(resumed,T+40*MIN).state.workMs,10*MIN);
assert.equal(resumed.taskId,"first"); count++;
// A priority change saved from any client reconfigures the shared timer.
await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)",["timer-carol",new Date(T).toISOString()]);
const carolTimer=await commandTracking("timer-carol",0,{type:"start"},"device-1","UTC",tasks,"18:00",T);
await saveState("timer-carol",{tasks:tasks.map(t=>t.id==="later"?{...t,priority:"high"}:t),recommendation:null,schedule:null,endTime:"18:00"});
const carolAfter=await loadTracking("timer-carol");
assert.ok(carolAfter.revision>carolTimer.revision); assert.equal(carolAfter.tasks.find(t=>t.id==="later").priority,"high"); count++;
await pg.query("DELETE FROM users WHERE id = $1",["timer-carol"]);
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
await pg.query("DELETE FROM users WHERE id = $1",["timer-alice"]); assert.equal(await loadTracking("timer-alice"),null); count++;
await pg.close(); setSql(null);
console.log(`${count} tracking scenarios passed`);
