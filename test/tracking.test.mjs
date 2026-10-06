import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const t = require("../.test-build/tracking.js"), old = require("../.test-build/legacy-tracking.js");
const { describeFocus } = require("../.test-build/focus.js");
const { setSql, ensureSchema } = require("../.test-build/sql.js");
const { readAccountTracking, loadTracking, commandTracking, configureAccountTracking, TrackingConflict } = require("../.test-build/tracking-db.js");
const { loadState, saveState } = require("../.test-build/db.js");
const MIN=60_000,T=Date.parse("2026-10-06T16:00:00Z"),PLAN={startTime:"09:00",workParts:1,idleParts:1};
const task=(id,dueDate="2026-10-06")=>({id,title:id,description:"",dueDate,priority:"low",createdAt:new Date(T).toISOString(),completed:false,completedAt:null});
const tasks=[task("a"),task("b"),task("c","2026-10-07")];
const fresh=(list=tasks,end="18:00",plan=PLAN)=>t.createTracking(list,end,"UTC",T,plan);
const near=(a,b)=>assert.ok(Math.abs(a-b)<.01,`${a} != ${b}`);
let count=0;
const check=(name,fn)=>{fn();count++;console.log("✓ "+name);};

check("all time until the end is work capacity, independent of retired settings",()=>{
 for(const plan of [PLAN,{startTime:"23:00",workParts:20,idleParts:1},{startTime:"00:00",workParts:1,idleParts:20}]){
  const s=fresh(tasks,"18:00",plan);near(t.workLeftMs(s),120*MIN);near(t.workBudget(s),120*MIN);
  assert.equal(t.canTrackWork(s),true);assert.equal(t.actOnTracking(s,{type:"start"},"desktop",T).mode,"work");
  assert.equal(t.trackingConfigKey(tasks,"18:00",plan),t.trackingConfigKey(tasks,"18:00",PLAN));
 }
 assert.throws(()=>fresh(tasks,""),/end time/);assert.throws(()=>fresh(tasks,"25:00"),/end time/);
});
check("paused time reduces work left and targets but never logs work or sends idle alerts",()=>{
 const before=fresh(),out=t.advanceTracking(before,T+10*MIN);
 near(out.state.workMs,0);assert.deepEqual(out.state.taskMs,{});near(t.workLeftMs(out.state),110*MIN);
 near(t.taskProgress(out.state).reduce((sum,p)=>sum+p.remainingMs,0),110*MIN);
 assert.deepEqual(out.events,[]);assert.deepEqual(t.upcomingTrackingEvents(before,T),[]);
 assert.equal(out.state.mode,"idle");
});
check("working preserves a constant total budget, and transitions follow list order",()=>{
 const before=t.actOnTracking(fresh([task("a"),task("b")]),{type:"start"},"desktop",T);
 const out=t.advanceTracking(before,T+75*MIN);
 near(out.state.workMs,75*MIN);near(out.state.taskMs.a,60*MIN);near(out.state.taskMs.b,15*MIN);
 near(t.workBudget(out.state),120*MIN);near(t.workLeftMs(out.state),45*MIN);assert.equal(out.state.taskId,"b");
 assert.equal(out.events.length,1);assert.equal(out.events[0].type,"task-complete");assert.match(out.events[0].body,/Now tracking b/);
});
check("pause, resume and manual task choices preserve all previously tracked work",()=>{
 let s=t.actOnTracking(fresh([task("a"),task("b")]),{type:"start",taskId:"b"},"desktop",T);
 s=t.actOnTracking(s,{type:"pause"},"desktop",T+10*MIN);s=t.advanceTracking(s,T+30*MIN).state;
 near(s.workMs,10*MIN);near(s.taskMs.b,10*MIN);near(t.workLeftMs(s),90*MIN);
 s=t.actOnTracking(s,{type:"start",taskId:"b"},"desktop",T+30*MIN);
 s=t.advanceTracking(s,T+40*MIN).state;near(s.workMs,20*MIN);near(s.taskMs.b,20*MIN);assert.equal(s.chosen,true);
});
check("weighted targets fit the cutoff even with large earlier overruns",()=>{
 const s={...fresh(),workMs:100*MIN,taskMs:{a:100*MIN},cursor:T+100*MIN};
 const p=t.taskProgress(s);near(p.reduce((sum,x)=>sum+x.remainingMs,0),20*MIN);near(p[0].trackedMs,100*MIN);
 assert.ok(p.every(x=>x.targetMs>=x.trackedMs));near(t.workBudget(s),120*MIN);
 const noMin={...s,minimumEnabled:false};const entries=t.taskProgress(noMin);near(entries[1].remainingMs,2*entries[2].remainingMs);
});
check("the minimum is adjustable, can be disabled, and equal weighting still works",()=>{
 const s={...fresh([task("a"),task("b")],"16:20"),minimumMinutes:30};
 assert.equal(t.taskProgress(s)[1].skipped,true);
 for(const prefs of [{minimumEnabled:false},{minimumMinutes:5}]){
  assert.ok(t.taskProgress({...s,...prefs}).every(p=>!p.skipped));
 }
 const even={...fresh(),unweighted:true,minimumEnabled:false};assert.ok(t.taskProgress(even).every(p=>p.weight===1));
});
check("the end time stops work exactly once without changing work already earned",()=>{
 const s=t.actOnTracking(fresh([task("a")],"16:20"),{type:"start"},"desktop",T);
 const out=t.advanceTracking(s,T+60*MIN);
 near(out.state.workMs,20*MIN);near(out.state.taskMs.a,20*MIN);near(t.workLeftMs(out.state),0);
 assert.equal(out.state.mode,"idle");assert.deepEqual(out.events.map(e=>e.type),["task-complete","day-end"]);
 assert.deepEqual(t.advanceTracking(out.state,T+70*MIN).events,[]);
 assert.throws(()=>t.actOnTracking(out.state,{type:"start"},"desktop",T+70*MIN),/work day has ended/);
});
check("end-time edits checkpoint history, and extending an ended day never auto-starts",()=>{
 const before=t.actOnTracking(fresh([task("a")]),{type:"start"},"desktop",T);
 const shortened=t.configureTracking(before,before.tasks,"16:10",T+30*MIN);
 near(shortened.workMs,30*MIN);assert.equal(shortened.mode,"idle");near(t.workLeftMs(shortened),0);
 const extended=t.configureTracking(shortened,shortened.tasks,"19:00",T+40*MIN);
 near(extended.workMs,30*MIN);near(t.workLeftMs(extended),140*MIN);assert.equal(extended.mode,"idle");
 assert.throws(()=>t.configureTracking(extended,tasks,"",T+40*MIN),/end time/);
});
check("deleting or completing tasks keeps history and stops if no unfinished task remains",()=>{
 const before=t.actOnTracking(fresh([task("a"),task("b")]),{type:"start"},"desktop",T);
 const next=t.configureTracking(before,[task("b")],"18:00",T+10*MIN);near(next.taskMs.a,10*MIN);assert.equal(next.taskId,"b");
 const done=t.configureTracking(next,[],"18:00",T+20*MIN);near(done.workMs,20*MIN);assert.equal(done.mode,"idle");
 assert.throws(()=>t.actOnTracking(done,{type:"start"},"desktop",T+20*MIN),/No unfinished/);
});
check("legacy active, paused, completed, borrowing and coverage snapshots migrate without lost work",()=>{
 const initial=old.createTracking(tasks,"18:00","UTC",T,PLAN);
 const cases=[initial,old.actOnTracking(initial,{type:"start"},"desktop",T),{...initial,workMs:300*MIN,taskMs:{a:300*MIN}},{...initial,idlePolicyVersion:undefined,workLimitVersion:undefined,carryMs:50*MIN},{...initial,coverageVersion:1,coverageGoalMs:120*MIN,coverageDays:3,mode:"work",taskId:"a"}];
 for(const before of cases){
  const now=T+40*MIN,expected=old.advanceTracking(before,now).state,out=t.advanceTracking(before,now);
  near(out.state.workMs,expected.workMs);assert.deepEqual(out.state.taskMs,expected.taskMs);assert.equal(out.state.controllerId,expected.controllerId);
  assert.equal(out.state.workOnlyVersion,1);assert.deepEqual(out.events,[]);assert.deepEqual(t.advanceTracking(out.state,now).state,out.state);
  if(expected.mode==="idle")assert.equal(out.state.mode,"idle");
 }
});
check("midnight resets the day and pauses; backwards clocks never change counters",()=>{
 const s=t.advanceTracking(t.actOnTracking(fresh(),{type:"start"},"desktop",T),T+MIN).state;
 for(const at of [T,NaN,Infinity])assert.deepEqual(t.advanceTracking(s,at).state,s);
 const tomorrow=t.advanceTracking(s,T+24*60*MIN).state;
 near(tomorrow.workMs,0);assert.deepEqual(tomorrow.taskMs,{});assert.equal(tomorrow.mode,"idle");assert.equal(tomorrow.workOnlyVersion,1);
 const reset=t.actOnTracking(s,{type:"reset"},"desktop",T+10*MIN);near(reset.workMs,0);assert.equal(reset.endTime,"18:00");assert.equal(reset.mode,"idle");
});
check("time zones, DST, validation and reserved task IDs remain safe",()=>{
 const dst={...fresh(),dayKey:"2026-11-01",timeZone:"America/Toronto",endTime:"04:00",cursor:Date.parse("2026-11-01T04:00:00Z")};
 near(t.workLeftMs(dst),5*60*MIN);
 for(const bad of [{workOnlyVersion:2},{workMs:-1},{endTime:""},{taskMs:{a:Infinity}}])assert.equal(t.parseTracking({...fresh(),...bad}),null);
 assert.ok(t.parseTracking(fresh()));
 const reserved=t.advanceTracking(t.actOnTracking(fresh([task("__proto__")]),{type:"start"},"desktop",T),T+MIN).state;
 near(reserved.taskMs.__proto__,MIN);assert.equal(Object.getPrototypeOf(reserved.taskMs),Object.prototype);
});
check("forecasts match completions; repeated projection never emits idle or rest alerts",()=>{
 const before=t.actOnTracking(fresh(),{type:"start"},"desktop",T);
 assert.deepEqual(t.upcomingTrackingEvents(before,T),t.advanceTracking(before,t.dayEnd(before)).events);
 assert.ok(t.upcomingTrackingEvents(before,T).every(e=>["task-complete","day-end"].includes(e.type)));
});
check("one background projection equals incremental ticks across weighted tasks",()=>{
 for(const unweighted of [true,false])for(const minimumEnabled of [true,false]){
  const before=t.actOnTracking({...fresh(),unweighted,minimumEnabled},{type:"start"},"desktop",T);
  const once=t.advanceTracking(before,T+100*MIN).state;let stepped=before;
  for(let i=1;i<=200;i++)stepped=t.advanceTracking(stepped,T+i*30_000).state;
  near(once.workMs,stepped.workMs);for(const id of Object.keys(once.taskMs))near(once.taskMs[id],stepped.taskMs[id]);
 }
});
check("focus UI only shows work, paused and ended states",()=>{
 const paused=fresh(),f=describeFocus(paused,t.taskProgress(paused),true);
 assert.equal(f.label,"PAUSED");assert.equal(f.canStart,true);near(f.clock,120*MIN);
 assert.ok(!/idle|rest|ratio/i.test(JSON.stringify(f)));
 const active=t.actOnTracking(paused,{type:"start"},"desktop",T);assert.equal(describeFocus(active,t.taskProgress(active),true).label,"WORKING ON");
 const end=t.advanceTracking(paused,T+120*MIN).state;assert.equal(describeFocus(end,t.taskProgress(end),true).canStart,false);
});

// Real in-process Postgres: migration, concurrency, preferences and ownership.
const pg=new PGlite();
setSql({query:async(text,params)=>(await pg.query(text,params)).rows,transaction:async statements=>pg.transaction(async tx=>{const results=[];for(const s of statements)results.push((await tx.query(s.text,s.params)).rows);return results;})});
await ensureSchema();
await pg.query("INSERT INTO users(id,username,username_lower,password_hash,created_at) VALUES('work-only','test','test','unused',$1)",[new Date(T).toISOString()]);
const preferences={tasks,recommendation:null,schedule:null,endTime:"18:00",plan:PLAN,unweighted:true,minimumEnabled:false,minimumMinutes:15};
await saveState("work-only",preferences);const prefsBefore=await loadState("work-only");
const oldTimer=old.actOnTracking(old.createTracking(tasks,"18:00","UTC",T,PLAN,true,false,15),{type:"start"},"desktop",T);
await pg.query("INSERT INTO tracking(user_id,state) VALUES($1,$2)",["work-only",JSON.stringify(oldTimer)]);
const [a,b]=await Promise.all([readAccountTracking("work-only",T+30*MIN),readAccountTracking("work-only",T+30*MIN)]);
assert.deepEqual(a,b);assert.equal(a.revision,1);assert.equal(a.workOnlyVersion,1);near(a.workMs,30*MIN);assert.equal(a.controllerId,"desktop");
assert.deepEqual(await readAccountTracking("work-only",T+40*MIN),a);assert.deepEqual(await loadState("work-only"),prefsBefore);
await assert.rejects(commandTracking("work-only",0,{type:"reset"},"stale","UTC",tasks,"18:00",PLAN,T+40*MIN),TrackingConflict);
const races=await Promise.allSettled([commandTracking("work-only",1,{type:"pause"},"desktop","UTC",tasks,"18:00",PLAN,T+40*MIN,true,false,15),commandTracking("work-only",1,{type:"pause"},"phone","UTC",tasks,"18:00",PLAN,T+40*MIN,true,false,15)]);
assert.equal(races.filter(x=>x.status==="fulfilled").length,1);const saved=await loadTracking("work-only");near(saved.workMs,40*MIN);assert.equal(saved.mode,"idle");
await configureAccountTracking("work-only",tasks,"18:00",{startTime:"23:00",workParts:20,idleParts:1},T+50*MIN,true,false,15);
assert.deepEqual(await loadTracking("work-only"),saved,"retired plan changes must not reconfigure the timer");
assert.deepEqual(await loadState("work-only"),prefsBefore);
await pg.close();setSql(null);
console.log(`${count} work-only scenarios and account concurrency checks passed`);
