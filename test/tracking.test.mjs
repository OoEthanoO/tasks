import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require=createRequire(import.meta.url);
const t=require("../.test-build/tracking.js"), old=require("../.test-build/legacy-tracking.js");
const {describeFocus}=require("../.test-build/focus.js");
const {setSql,ensureSchema}=require("../.test-build/sql.js");
const {commandTracking,loadTracking,readAccountTracking,configureAccountTracking,importAccountTracking,TrackingConflict}=require("../.test-build/tracking-db.js");
const {saveState,loadState}=require("../.test-build/db.js");
const MIN=60_000,T=Date.parse("2026-10-05T12:00:00Z");
const task=(id,dueDate="2026-10-05",priority="low")=>({id,title:id,description:"",dueDate,priority,createdAt:new Date(T).toISOString(),completed:false,completedAt:null});
const fresh=(tasks=[task("a"),task("b","2026-10-12")],now=T)=>t.createTracking(tasks,"13:00","UTC",now,{startTime:"12:00",workParts:1,idleParts:1});
const near=(a,b)=>assert.ok(Math.abs(a-b)<.01,a+" != "+b);
let count=0;
const check=(name,fn)=>{fn();count++;console.log("✓ "+name);};
const eligible=p=>p.filter(e=>e.weight>0);
check("Oct 5 includes Oct 12 and overdue tasks, never Oct 13 or completed tasks",()=>{
 const s=fresh([task("old","2026-10-04"),task("now"),task("edge","2026-10-12"),task("later","2026-10-13","high"),{...task("done"),completed:true}]);
 assert.equal(t.coverageCutoff(s),"2026-10-12");
 const p=t.taskProgress(s);assert.deepEqual(p.map(x=>x.weight),[3,2,1/7,0,0]);
 assert.ok(eligible(p).every(x=>x.targetMs+1>=30*MIN));assert.equal(p[3].skipped,true);assert.equal(p[4].skipped,false);
 assert.match(t.skippedExplanation(),/more than seven days/);near(t.workBudget(s),1080*MIN);
});
check("smallest whole-minute budgets respect weights, priority and upward rounding",()=>{
 const s=fresh(),p=t.taskProgress(s);near(t.workBudget(s),450*MIN);near(p[0].targetMs,420*MIN);near(p[1].targetMs,30*MIN);
 const priority=fresh([task("a","2026-10-08","high"),task("b","2026-10-12")]);
 near(t.workBudget(priority),310*MIN);near(t.taskProgress(priority)[0].targetMs,280*MIN);
 const uneven=fresh([task("a","2026-10-08"),task("b","2026-10-12"),task("c","2026-10-10")]);
 for(const state of [s,priority,uneven]){
  assert.equal(t.workBudget(state)%MIN,0);
  assert.ok(eligible(t.taskProgress(state)).every(p=>p.targetMs+.001>=30*MIN));
  assert.ok(eligible(t.taskProgress({...state,coverageGoalMs:t.workBudget(state)-MIN})).some(p=>p.targetMs<30*MIN));
 }
});
check("retired clocks, ratios, unweighted and minimum preferences have no effect",()=>{
 const tasks=[task("a"),task("b","2026-10-12")];
 for(const clock of ["00:00","13:00","23:59"]){
  const s=t.createTracking(tasks,clock,"UTC",T,{startTime:clock,workParts:20,idleParts:1},true,false,1440);
  near(t.workBudget(s),450*MIN);assert.deepEqual(t.taskProgress(s).map(p=>p.weight),[2,1/7]);
  assert.ok(t.canTrackWork(s));assert.equal(t.actOnTracking(s,{type:"start"},"pc",T).mode,"work");
 }
 const s=fresh(tasks),changed=t.configureTracking(s,tasks,"00:00",T,{startTime:"23:59",workParts:1,idleParts:20},true,false,1);
 near(t.workBudget(changed),t.workBudget(s));assert.equal(changed.mode,"idle");
});
check("no eligible tasks means no work or alerts",()=>{
 for(const tasks of [[],[task("later","2026-10-13","high")],[{...task("done"),completed:true}]]){
  const s=fresh(tasks);near(t.workBudget(s),0);assert.equal(t.canTrackWork(s),false);
  assert.throws(()=>t.actOnTracking(s,{type:"start"},"pc",T),/No unfinished/);assert.deepEqual(t.upcomingTrackingEvents(s,T),[]);
 }
});
check("pause freezes targets and never logs work or emits idle reminders",()=>{
 const s=fresh(),copy=JSON.stringify(s),out=t.advanceTracking(s,T+10*60*MIN);
 near(out.state.workMs,0);near(t.workLeftMs(out.state),450*MIN);assert.deepEqual(out.state.taskMs,{});assert.deepEqual(out.events,[]);assert.equal(JSON.stringify(s),copy);
 const f=describeFocus(out.state,t.taskProgress(out.state),true);assert.equal(f.label,"PAUSED");near(f.clock,450*MIN);assert.ok(f.canStart);assert.equal(f.includedCount,2);assert.equal(f.idleStat,undefined);
});
check("tracking after former hours stops at the goal, not the old cutoff",()=>{
 const s=fresh([task("a")],Date.parse("2026-10-05T23:00:00Z")),work=t.actOnTracking(s,{type:"start"},"pc",s.cursor);
 const out=t.advanceTracking(work,s.cursor+35*MIN);
 near(out.state.workMs,30*MIN);near(t.workLeftMs(out.state),0);assert.equal(out.state.mode,"idle");
 assert.deepEqual(out.events.map(e=>e.type),["task-complete","work-complete"]);near(out.events[0].at,s.cursor+30*MIN);
});
check("goals stay fixed when the smaller share is tracked first",()=>{
 let s=t.actOnTracking(fresh([task("a"),task("b","2026-10-06")]),{type:"start",taskId:"b"},"pc",T);
 s=t.advanceTracking(s,T+30*MIN).state;near(s.taskMs.b,30*MIN);near(t.workBudget(s),90*MIN);near(t.workLeftMs(s),60*MIN);assert.equal(s.taskId,"a");
 s=t.advanceTracking(s,T+60*MIN).state;near(t.workLeftMs(s),30*MIN);near(s.taskMs.a,30*MIN);
 s=t.advanceTracking(s,T+90*MIN).state;near(s.taskMs.a,60*MIN);near(s.taskMs.b,30*MIN);assert.equal(s.mode,"idle");
});
check("rename, reordering and out-of-window edits cannot lower a partly worked goal",()=>{
 let s=t.actOnTracking(fresh([task("a"),task("b","2026-10-06")]),{type:"start",taskId:"b"},"pc",T);
 s=t.advanceTracking(s,T+60*MIN).state;
 for(const list of [s.tasks.map(x=>({...x,title:x.title+" renamed"})),[...s.tasks].reverse(),[...s.tasks,task("later","2026-10-20")]]){
  near(t.workLeftMs(t.configureTracking(s,list,"01:00",s.cursor)),30*MIN);
 }
});
check("task edits recalculate future work without erasing history or logging pauses",()=>{
 const s=t.actOnTracking(fresh([task("a"),task("b","2026-10-06")]),{type:"start"},"pc",T);
 const paused=t.actOnTracking(s,{type:"pause"},"pc",T+10*MIN);
 const changed=t.configureTracking(paused,[task("a"),task("b","2026-10-12")],"01:00",T+60*MIN);
 near(changed.workMs,10*MIN);assert.deepEqual(changed.taskMs,paused.taskMs);assert.equal(changed.mode,"idle");near(t.workBudget(changed),450*MIN);
 const completed=t.configureTracking(changed,[{...task("a"),completed:true},task("b","2026-10-12")],"01:00",changed.cursor);
 near(completed.workMs,10*MIN);near(t.workLeftMs(completed),30*MIN);
 const empty=t.configureTracking(completed,[],"01:00",completed.cursor);near(empty.workMs,10*MIN);near(t.workLeftMs(empty),0);
});
check("historical overruns remain logged while every uncovered task gets 30 minutes",()=>{
 const original=old.createTracking([task("a"),task("b")],"23:00","UTC",T);
 Object.assign(original,{workMs:200*MIN+12345,taskMs:{a:200*MIN,deleted:12345}});
 const s=t.advanceTracking(original,T).state;near(s.workMs,original.workMs);assert.deepEqual(s.taskMs,original.taskMs);
 near(t.workBudget(s),231*MIN);near(t.taskProgress(s)[1].targetMs,31*MIN-12345);
 assert.ok(t.taskProgress({...s,coverageGoalMs:230*MIN})[1].targetMs<30*MIN);
});
check("capped, fixed, borrowing and old allocation timers checkpoint exactly once",()=>{
 for(const variant of ["capped","fixed","borrowing","allocation"]){
  let s=old.actOnTracking(old.createTracking([task("a"),task("b")],"23:00","UTC",T),{type:"start"},"pc",T);
  if(variant!=="capped")delete s.workLimitVersion;
  if(variant==="borrowing"){delete s.idlePolicyVersion;s.carryMs=60*MIN;}
  if(variant==="allocation")delete s.allocationVersion;
  const expected=old.advanceTracking(s,T+45*MIN).state,copy=JSON.stringify(s),out=t.advanceTracking(s,T+45*MIN);
  near(out.state.workMs,expected.workMs);assert.deepEqual(out.state.taskMs,expected.taskMs);
  assert.equal(out.state.coverageVersion,1);assert.equal(out.state.carryMs,undefined);assert.equal(out.state.controllerId,"pc");assert.equal(out.state.revision,s.revision);
  assert.equal(JSON.stringify(s),copy);assert.deepEqual(out.events,[]);
  assert.deepEqual(t.advanceTracking(t.parseTracking(JSON.parse(JSON.stringify(out.state))),out.state.cursor).state,out.state);
  assert.ok(eligible(t.taskProgress(out.state)).every(p=>p.targetMs+1>=30*MIN));
 }
});
check("midnight resets and advances the inclusive horizon using the shared time zone",()=>{
 const now=Date.parse("2026-10-06T03:50:00Z"),s=t.createTracking([task("edge","2026-10-13")],"08:00","America/Toronto",now);
 assert.equal(s.dayKey,"2026-10-05");near(t.workLeftMs(s),0);
 const next=t.advanceTracking({...s,controllerId:"pc",revision:9},Date.parse("2026-10-06T04:00:00Z")).state;
 assert.equal(next.dayKey,"2026-10-06");near(t.workLeftMs(next),30*MIN);assert.equal(next.mode,"idle");assert.equal(next.controllerId,"pc");assert.equal(next.revision,9);
 for(const day of ["2026-03-08","2026-11-01"]){
  const a=t.createTracking([task("a",day)],"00:00","America/Toronto",Date.parse(day+"T12:00:00Z"));
  assert.equal(t.trackingDay(t.nextMidnight(a),a.timeZone),day==="2026-03-08"?"2026-03-09":"2026-11-02");
 }
});
check("the seven-day window spans month ends, leap days and year ends",()=>{
 for(const [date,cutoff] of [["2026-10-28","2026-11-04"],["2026-12-29","2027-01-05"],["2028-02-25","2028-03-03"]]){
  const s=fresh([task("edge",cutoff)],Date.parse(date+"T12:00:00Z"));
  assert.equal(t.coverageCutoff(s),cutoff);assert.equal(t.taskProgress(s)[0].skipped,false);near(t.workBudget(s),30*MIN);
 }
});
check("forecasts never notify past midnight and rollover never starts work",()=>{
 const start=Date.parse("2026-10-05T23:50:00Z"),s=t.actOnTracking(fresh([task("a")],start),{type:"start"},"pc",start);
 assert.deepEqual(t.upcomingTrackingEvents(s,start),[]);
 const next=t.advanceTracking(s,t.nextMidnight(s)).state;near(next.workMs,0);assert.equal(next.mode,"idle");near(t.workLeftMs(next),30*MIN);
});
check("reset clears only progress and preserves tasks and the shared zone",()=>{
 const s=t.advanceTracking(t.actOnTracking(fresh(),{type:"start"},"pc",T),T+10*MIN).state;
 const out=t.actOnTracking(s,{type:"reset"},"phone",T+11*MIN);
 near(out.workMs,0);assert.deepEqual(out.taskMs,{});assert.deepEqual(out.tasks,s.tasks);assert.equal(out.mode,"idle");assert.equal(out.controllerId,"phone");near(t.workBudget(out),450*MIN);
});
check("large steps, small ticks and forecasts allocate identical totals and alerts",()=>{
 const start=t.actOnTracking(fresh([task("a"),task("b","2026-10-06"),task("c","2026-10-12")]),{type:"start"},"pc",T);
 const duration=t.workBudget(start),events=[];let small=start;
 for(let at=T+30000;at<=T+duration;at+=30000){const out=t.advanceTracking(small,at);small=out.state;events.push(...out.events);}
 const big=t.advanceTracking(start,T+duration);near(small.workMs,big.state.workMs);
 for(const id of Object.keys(big.state.taskMs))near(small.taskMs[id],big.state.taskMs[id]);
 assert.deepEqual(events.map(e=>[e.type,Math.round(e.at)]),big.events.map(e=>[e.type,Math.round(e.at)]));
 assert.deepEqual(t.upcomingTrackingEvents(start,T).map(e=>e.id),big.events.map(e=>e.id));
});
check("invalid goals and clock rollback cannot create or erase work",()=>{
 const s=fresh();for(const goal of [NaN,Infinity,-1,"30",undefined])assert.equal(t.parseTracking({...s,coverageGoalMs:goal}),null);
 assert.equal(t.parseTracking({...s,coverageVersion:2}),null);const out=t.advanceTracking(s,T-1);assert.deepEqual(out.state,s);assert.deepEqual(out.events,[]);
});
check("reserved task ids cannot pollute counters",()=>{
 let s=t.actOnTracking(fresh([task("__proto__")]),{type:"start"},"pc",T);
 s=t.advanceTracking(s,T+MIN).state;near(s.taskMs.__proto__,MIN);assert.equal(Object.getPrototypeOf(s.taskMs),Object.prototype);assert.ok(t.parseTracking(JSON.parse(JSON.stringify(s))));
});
check("400 randomized histories meet coverage and one fewer minute cannot",()=>{
 let seed=17;const random=()=>((seed=(seed*1664525+1013904223)>>>0)/2**32);
 for(let run=0;run<400;run++){
  const list=Array.from({length:1+Math.floor(random()*15)},(_,i)=>task(String(i),new Date(T+(Math.floor(random()*15)-3)*86400000).toISOString().slice(0,10),["low","medium","high"][Math.floor(random()*3)]));
  const s=fresh(list);s.workMs=0;s.taskMs={};
  for(const x of list){const logged=Math.floor(random()*60000*90);s.taskMs[x.id]=logged;s.workMs+=logged;}
  s.coverageGoalMs=t.minimumCoverageGoal(s);const p=t.taskProgress(s);
  assert.ok(eligible(p).every(p=>p.targetMs+.001>=30*MIN));near(p.reduce((sum,e)=>sum+e.remainingMs,0),t.workLeftMs(s));
  if(s.coverageGoalMs>s.workMs){assert.equal(s.coverageGoalMs%MIN,0);const lower=s.coverageGoalMs-MIN;
   if(lower>=s.workMs)assert.ok(eligible(t.taskProgress({...s,coverageGoalMs:lower})).some(p=>p.targetMs<30*MIN));}
 }
});
console.log(count+" seven-day allocation scenarios passed");
const pg=new PGlite(),realNow=Date.now;Date.now=()=>T;
setSql({query:async(text,params=[]) => (await pg.query(text,params)).rows,transaction:async statements=>pg.transaction(async tx=>{for(const s of statements)await tx.query(s.text,s.params??[]);})});
try{
 await ensureSchema();
 for(const id of ["alice","bob"])await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)",[id,new Date(T).toISOString()]);
 const tasks=[task("a"),task("b")],plan={startTime:"12:00",workParts:1,idleParts:1};
 await saveState("alice",{tasks,endTime:"13:00",plan,recommendation:null,schedule:null});
 const s=await commandTracking("alice",0,{type:"start"},"desktop_device","UTC",tasks,"13:00",plan,T);
 const races=await Promise.allSettled([commandTracking("alice",s.revision,{type:"pause"},"one_device","UTC",tasks,"13:00",plan,T+10*MIN),commandTracking("alice",s.revision,{type:"start",taskId:"b"},"two_device","UTC",tasks,"13:00",plan,T+10*MIN)]);
 assert.equal(races.filter(r=>r.status==="fulfilled").length,1);assert.ok(races.find(r=>r.status==="rejected").reason instanceof TrackingConflict);
 let state=await loadTracking("alice");near(state.workMs,10*MIN);assert.equal(await loadTracking("bob"),null);
 const stale=state.revision,reset=await commandTracking("alice",stale,{type:"reset"},"reset_device","UTC",tasks,"13:00",plan,T+11*MIN);
 assert.equal(reset.mode,"idle");near(reset.workMs,0);near(t.workBudget(reset),60*MIN);
 await assert.rejects(commandTracking("alice",stale,{type:"pause"},"stale_device","UTC",tasks,"13:00",plan,T+12*MIN),TrackingConflict);
 assert.equal((await loadTracking("alice")).revision,reset.revision);
 const legacy=old.actOnTracking(old.createTracking(tasks,"23:00","UTC",T,plan),{type:"start"},"desktop_device",T);
 await pg.query("UPDATE tracking SET state=$1 WHERE user_id=$2",[JSON.stringify(legacy),"alice"]);
 const [a,b]=await Promise.all([readAccountTracking("alice",T+45*MIN),readAccountTracking("alice",T+45*MIN)]);
 assert.deepEqual(a,b);assert.equal(a.coverageVersion,1);assert.equal(a.revision,reset.revision+1);
 const before=old.advanceTracking(legacy,T+45*MIN).state;near(a.workMs,before.workMs);assert.deepEqual(a.taskMs,before.taskMs);
 assert.deepEqual(await readAccountTracking("alice",T+46*MIN),a);
 await configureAccountTracking("alice",tasks,"00:00",{startTime:"23:59",workParts:20,idleParts:1},T+46*MIN,true,false,1);
 assert.deepEqual(await loadTracking("alice"),a);
 const paused=await commandTracking("alice",a.revision,{type:"pause"},"pc_device","UTC",tasks,"00:00",plan,T+46*MIN);
 await configureAccountTracking("alice",[...tasks,task("c","2026-10-12")],"00:00",plan,T+47*MIN);
 const edited=await loadTracking("alice");near(edited.workMs,paused.workMs);assert.deepEqual(edited.taskMs,paused.taskMs);assert.equal(edited.mode,"idle");assert.ok(eligible(t.taskProgress(edited)).every(p=>p.targetMs+1>=30*MIN));
 const account=await loadState("alice");Date.now=()=>T+48*MIN;
 await saveState("alice",{...account,tracking:{...fresh(),workMs:999999},tasks:edited.tasks});near((await loadTracking("alice")).workMs,edited.workMs);
 await importAccountTracking("alice",fresh(),tasks,"00:00",plan,T+49*MIN);near((await loadTracking("alice")).workMs,edited.workMs);
 await importAccountTracking("bob",edited,edited.tasks,"00:00",plan,T+50*MIN);
 const imported=await loadTracking("bob");near(imported.workMs,edited.workMs);assert.equal(imported.mode,"idle");assert.equal(imported.controllerId,null);
 console.log("Shared account coverage, migration, conflicts, reset, isolation and import checks passed");
}finally{Date.now=realNow;await pg.close();setSql(null);}
