import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { createTracking, advanceTracking, configureTracking, actOnTracking, taskProgress, workBudget, dayEnd, trackingDay, parseTracking, upcomingTrackingEvents, WORK_CYCLE_MS, REST_CYCLE_MS } = require("../.test-build/tracking.js");
const { setSql, ensureSchema } = require("../.test-build/sql.js");
const { commandTracking, loadTracking, configureAccountTracking, TrackingConflict } = require("../.test-build/tracking-db.js");
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
  const s = advanceTracking(fresh(), T+30*MIN).state;
  assert.equal(s.workMs,0); near(workBudget(s),570*MIN); near(taskProgress(s)[0].targetMs,228*MIN);
});
check("active work keeps the budget constant", () => {
  const s = advanceTracking(actOnTracking(fresh(),{type:"start"},"device-1",T),T+40*MIN).state;
  near(s.taskMs.first,40*MIN); near(s.workMs,40*MIN); near(workBudget(s),600*MIN);
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
  near(s.workMs,60*MIN); near(s.cycleWorkMs,60*MIN); near(workBudget(s),570*MIN);
});
check("90 cumulative work minutes force rest across task switches", () => {
  let s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"start",taskId:"second"},"device-1",T+45*MIN);
  const result=advanceTracking(s,T+90*MIN);
  assert.equal(result.state.mode,"rest"); near(result.state.workMs,90*MIN); assert.equal(result.state.taskId,null);
  assert.deepEqual(result.events.map(e=>e.type),["rest-soon","rest-start"]);
});
check("rest is separate and reduces targets, then resumes work", () => {
  const start=actOnTracking(fresh(),{type:"start"},"device-1",T);
  const s=advanceTracking(start,T+120*MIN).state;
  near(s.workMs,90*MIN); near(s.restMs,30*MIN); near(workBudget(s),570*MIN);
  near(s.restMs/(s.workMs+s.restMs),.25); assert.equal(s.mode,"work"); near(s.cycleWorkMs,0);
});
check("pausing rest cannot bypass the remaining break", () => {
  let s=actOnTracking(fresh(),{type:"start"},"device-1",T);
  s=actOnTracking(s,{type:"pause"},"device-1",T+100*MIN);
  s=actOnTracking(s,{type:"start",taskId:"second"},"device-2",T+130*MIN);
  assert.equal(s.mode,"rest"); near(s.cycleRestMs,10*MIN);
  s=advanceTracking(s,T+150*MIN).state; near(s.restMs,30*MIN); assert.equal(s.mode,"work");
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
await pg.query("DELETE FROM users WHERE id = $1",["timer-alice"]); assert.equal(await loadTracking("timer-alice"),null); count++;
await pg.close(); setSql(null);
console.log(`${count} tracking scenarios passed`);
