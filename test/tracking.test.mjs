import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const pace = require("../.test-build/pacing.js");
const tr = require("../.test-build/tracking.js");
const old = require("../.test-build/legacy-tracking.js");
const { describeFocus } = require("../.test-build/focus.js");
const { setSql, ensureSchema } = require("../.test-build/sql.js");
const db = require("../.test-build/tracking-db.js");
const { saveState, loadState } = require("../.test-build/db.js");
const MIN = 60_000, T = Date.parse("2026-10-06T08:00:00Z");
const PLAN = { startTime: "06:30", workParts: 1, idleParts: 1 };
const task = (id, days = 0) => ({ id, title: id, description: "", dueDate: new Date(T + days * 86_400_000).toISOString().slice(0,10), createdAt: new Date(T).toISOString(), priority: "low", completed: false, completedAt: null });
const tasks = [task("a"), task("b", 1), task("c", 30)];
const fresh = (list = tasks, now = T) => tr.createTracking(list, "21:30", "UTC", now, PLAN);
const start = s => tr.actOnTracking(s, { type: "start" }, "desktop", s.cursor);
const near = (a,b) => assert.ok(Math.abs(a-b)<0.01, a + " != " + b);
let count = 0;
function check(name, fn) { fn(); count++; console.log("✓ " + name); }

check("recommendation adds deadline pressure and rounds up to 30 minutes", () => {
  const p = pace.recommendDay(tasks, "2026-10-06");
  near(p.rawMs, (60 + 30 + 60/31)*MIN); near(p.goalMs, 120*MIN);
  near(pace.recommendDay([task("x",2),task("y",5)],"2026-10-06").goalMs,30*MIN);
  near(pace.recommendDay([task("x",10000)],"2026-10-06").goalMs,30*MIN);
  near(pace.recommendDay([],"2026-10-06").goalMs,0);
  near(pace.recommendDay([{...task("x"),completed:true}],"2026-10-06").goalMs,0);
});
check("every weekday, weekend and holiday uses exactly the same 3-hour ceiling", () => {
  for (let i=0;i<14;i++) {
    const now=T+i*86_400_000, list=Array.from({length:20},(_,n)=>({...task(String(n)),dueDate:new Date(now).toISOString().slice(0,10)}));
    const s=fresh(list,now); near(tr.dayBudget(s).workMs,180*MIN);
    assert.equal(pace.recommendDay(list,s.dayKey).capped,true);
  }
});
check("there is no eligibility horizon, priority multiplier, daily minimum or day-plan quota", () => {
  const list=[task("a",-100),task("b",365),{...task("c",2),priority:"high"}];
  const s=tr.createTracking(list,"08:01","UTC",T,{startTime:"23:00",workParts:20,idleParts:1},true,true,1440);
  const p=tr.taskProgress(s);
  assert.ok(p.every(t=>!t.skipped && t.weight>=1 && t.weight<=2 && t.remainingMs===30*MIN));
  near(p[0].weight,2); near(p[2].weight,1+1/3);
  near(p.reduce((sum,t)=>sum+t.probability,0),1);
  assert.equal(start(s).mode,"work");
});
check("waiting never reduces a recommendation, tracks work, emits idle alerts or creates debt", () => {
  const s=fresh(), later=tr.advanceTracking(s,T+12*60*MIN);
  near(later.state.workMs,0); near(tr.workLeftMs(later.state),tr.workLeftMs(s));
  assert.deepEqual(later.events,[]); assert.deepEqual(tr.upcomingTrackingEvents(s,T),[]);
  near(tr.idleLeftMs(later.state),0); assert.equal(tr.shouldStartWorking(later.state),false);
  assert.equal(describeFocus(later.state,tr.taskProgress(later.state),true).paused,true);
});
check("recommendation keys ignore display metadata, ordering, clock and retired preferences", () => {
  const s=fresh(); const edited=tr.configureTracking(s,[...tasks].reverse().map(t=>({...t,title:t.title+"!",priority:"high"})),"20:00",T+MIN,{...PLAN,workParts:10},true,false,99);
  near(edited.pacing.goalMs,s.pacing.goalMs); assert.equal(edited.pacing.goalKey,s.pacing.goalKey);
  assert.equal(tr.trackingConfigKey(tasks,"21:30",PLAN),tr.trackingConfigKey(tasks,"21:30",{...PLAN,workParts:20},true,false,100));
});
check("a turn pauses after exactly 30 minutes and never credits the next task", () => {
  const s=start(fresh()), copy=structuredClone(s);
  const r=tr.advanceTracking(s,T+65*MIN);
  near(r.state.workMs,30*MIN); assert.deepEqual(r.state.taskMs,{a:30*MIN});
  assert.equal(r.state.mode,"idle"); assert.equal(r.state.taskId,null);
  assert.equal(r.events.length,1); assert.equal(r.events[0].type,"turn-complete");
  assert.equal(r.events[0].at,T+30*MIN); assert.match(r.events[0].body,/paused/);
  assert.deepEqual(s,copy); assert.equal(tr.suggestedTask(r.state).id,"b");
  assert.equal(r.state.tasks.every(t=>!t.completed),true);
});
check("partial turns survive pause, refresh and resume without counting the gap", () => {
  let s=tr.actOnTracking(start(fresh()),{type:"pause"},"phone",T+10*MIN);
  s=tr.advanceTracking(s,T+3*60*MIN).state;
  near(s.workMs,10*MIN); near(tr.turnLeftMs(s),20*MIN); assert.equal(tr.suggestedTask(s).id,"a");
  s=start(s);
  const r=tr.advanceTracking(s,s.cursor+25*MIN); near(r.state.workMs,30*MIN); assert.equal(r.state.mode,"idle");
});
check("manual switches preserve history and start a fresh turn for the selected task", () => {
  const s=tr.actOnTracking(start(fresh()),{type:"start",taskId:"c"},"phone",T+7*MIN);
  assert.equal(s.taskId,"c"); near(s.taskMs.a,7*MIN); near(tr.turnLeftMs(s),30*MIN);
  const r=tr.advanceTracking(s,T+40*MIN).state; near(r.taskMs.c,30*MIN); near(r.workMs,37*MIN);
});
check("continue explicitly gives the same task a new turn", () => {
  const s=tr.advanceTracking(start(fresh()),T+30*MIN).state;
  const again=tr.actOnTracking(s,{type:"continue"},"desktop",T+45*MIN);
  assert.equal(again.taskId,"a"); near(tr.turnLeftMs(again),30*MIN);
});
check("goal reached pauses once; additional work requires an explicit start", () => {
  const s=start(fresh([task("a",10)]));
  const r=tr.advanceTracking(s,T+60*MIN);
  near(r.state.workMs,30*MIN); assert.equal(r.events.length,1); assert.equal(r.events[0].type,"work-complete");
  assert.equal(tr.canTrackWork(r.state),true); assert.equal(tr.workLeftMs(r.state),0);
  assert.deepEqual(tr.advanceTracking(r.state,T+120*MIN).events,[]);
  const extra=start(r.state), r2=tr.advanceTracking(extra,extra.cursor+30*MIN);
  near(r2.state.workMs,60*MIN); assert.equal(r2.events[0].type,"turn-complete");
});
check("a migrated partial goal stops at its exact remainder, not after an extra full turn", () => {
  const base=fresh([task("a")]); base.workMs=50*MIN; base.taskMs={a:50*MIN};
  const r=tr.advanceTracking(start(base),T+30*MIN);
  near(r.state.workMs,60*MIN); near(r.state.pacing.turn.elapsedMs,10*MIN); assert.equal(r.events[0].at,T+10*MIN);
  near(tr.taskProgress(start(base))[0].remainingMs,10*MIN);
});
check("bedtime limits outing advice but does not alter target or block explicit extra tracking", () => {
  let s=fresh([task("a")],Date.parse("2026-10-06T22:00:00Z"));
  assert.equal(start(s).mode,"work"); near(tr.workLeftMs(s),60*MIN);
  const f=describeFocus(s,tr.taskProgress(s),true);
  assert.match(f.advice,/no longer fits/);
});
check("task completion and deletion pause, never silently switch; earned work remains", () => {
  for(const remove of [false,true]) {
    const list=remove?tasks.slice(1):tasks.map(t=>t.id==="a"?{...t,completed:true}:t);
    const s=tr.configureTracking(start(fresh()),list,"21:30",T+8*MIN);
    near(s.workMs,8*MIN); near(s.taskMs.a,8*MIN); assert.equal(s.mode,"idle");
    assert.notEqual(tr.suggestedTask(s)?.id,"a"); assert.equal(s.controllerId,"desktop");
  }
});
check("a reduced recommendation cannot silently turn ongoing work into extra work", () => {
  let s=tr.actOnTracking(fresh([task("a"),task("b")]),{type:"start",taskId:"b"},"desktop",T);
  s.workMs=70*MIN; s.taskMs={a:70*MIN};
  s=tr.configureTracking(s,s.tasks.map(t=>t.id==="a"?{...t,completed:true}:t),"21:30",T+MIN);
  near(s.workMs,71*MIN); assert.equal(s.mode,"idle"); near(tr.workLeftMs(s),0);
});
check("equal weights receive equal service to within one turn without daily starvation", () => {
  let s=fresh(Array.from({length:7},(_,i)=>task(String(i),200)));
  const total={};
  for(let d=0;d<28;d++) {
    s=tr.advanceTracking(s,T+d*86_400_000).state;
    const working=start(s), id=working.taskId;
    s=tr.advanceTracking(working,working.cursor+30*MIN).state;
    total[id]=(total[id]??0)+30;
  }
  assert.deepEqual(Object.values(total),Array(7).fill(120));
});
check("urgency boost is bounded and distant tasks still get repeated turns", () => {
  let s=fresh([task("near"),task("far",10000)]), now=T, totals={near:0,far:0};
  for(let i=0;i<24;i++) {
    s=tr.actOnTracking(s,{type:"start"},"desktop",now);
    const id=s.taskId; const r=tr.advanceTracking(s,now+30*MIN);
    totals[id]+=30; s=r.state; now+=30*MIN;
  }
  assert.ok(totals.far>=7*30); assert.ok(Math.abs(totals.near/2-totals.far)<=30);
});
check("a new task joins at the service frontier rather than with unlimited historical debt", () => {
  let s=fresh([task("a"),task("b")]); s.pacing.service={a:100000*MIN,b:100015*MIN};
  s=tr.configureTracking(s,[...s.tasks,task("new",10)],"21:30",T);
  near(s.pacing.service.new,0); near(s.pacing.service.a,0); near(s.pacing.service.b,15*MIN);
  assert.ok(tr.rotationQueue(s).every(t=>s.pacing.service[t.id]<=15*MIN));
});
check("a daily reset keeps long-term fairness and all task metadata", () => {
  const s=tr.advanceTracking(start(fresh()),T+30*MIN).state, copy=structuredClone(s);
  const reset=tr.actOnTracking(s,{type:"reset"},"phone",T+40*MIN);
  assert.equal(reset.mode,"idle"); near(reset.workMs,0); assert.deepEqual(reset.taskMs,{});
  assert.deepEqual(reset.pacing.service,s.pacing.service); assert.deepEqual(reset.tasks,s.tasks);
  assert.equal(reset.pacing.turn,null); assert.equal(reset.controllerId,"phone"); assert.deepEqual(s,copy);
});
check("account-local midnight resets daily work, carries rotation and pauses active work", () => {
  const now=Date.parse("2026-10-07T03:50:00Z");
  const s=tr.actOnTracking(tr.createTracking(tasks,"21:30","America/Toronto",now,PLAN),{type:"start"},"phone",now);
  const r=tr.advanceTracking(s,now+20*MIN);
  assert.equal(r.state.dayKey,"2026-10-07"); near(r.state.workMs,0); assert.deepEqual(r.state.taskMs,{});
  assert.equal(r.state.mode,"idle"); near(r.state.pacing.turn.elapsedMs,10*MIN);
  assert.equal(r.events[0].type,"day-end"); assert.equal(r.events[0].at,now+10*MIN);
});
check("DST calendar boundaries and missed days never add phantom work or debt", () => {
  for (const date of ["2026-03-08T04:50:00Z","2026-11-01T03:50:00Z"]) {
    const now=Date.parse(date);
    const s=tr.actOnTracking(tr.createTracking(tasks,"21:30","America/Toronto",now,PLAN),{type:"start"},"phone",now);
    const r=tr.advanceTracking(s,now+7*86_400_000);
    near(r.state.workMs,0); assert.equal(r.state.mode,"idle"); assert.ok(r.state.pacing.turn.elapsedMs<=30*MIN);
    assert.equal(r.state.carryMs,undefined);
  }
  assert.equal(pace.daysUntil("2026-03-09","2026-03-08"),1);
});
check("large projection and one-second ticks produce identical state and alerts", () => {
  const initial=start(fresh()); let s=initial, events=[];
  for(let i=1;i<=4000;i++) { const r=tr.advanceTracking(s,T+i*1000); s=r.state; events.push(...r.events); }
  const direct=tr.advanceTracking(initial,T+4000*1000);
  assert.deepEqual(s,direct.state); assert.deepEqual(events,direct.events);
  assert.deepEqual(tr.upcomingTrackingEvents(initial,T),direct.events);
});
check("backward and invalid clocks cannot erase, duplicate or mutate tracked work", () => {
  const s=tr.advanceTracking(start(fresh()),T+10*MIN).state;
  for(const now of [T,NaN,Infinity]) assert.deepEqual(tr.advanceTracking(s,now),{state:s,events:[]});
});
check("no open tasks cannot be started, while completed data and past work remain visible", () => {
  for(const list of [[],[{...task("a"),completed:true}]]) assert.throws(()=>start(fresh(list)),/No unfinished/);
});
check("reserved object keys are safe task IDs for counters and virtual service", () => {
  for(const id of ["__proto__","constructor","toString"]) {
    const s=tr.advanceTracking(start(fresh([task(id)])),T+MIN).state;
    near(s.taskMs[id],MIN); near(s.pacing.service[id],MIN/2);
    assert.equal(Object.getPrototypeOf(s.taskMs),Object.prototype);
    assert.ok(tr.parseTracking(JSON.parse(JSON.stringify(s))));
  }
});
check("pacing parser rejects corrupt service, goals and turn counters", () => {
  const s=start(fresh());
  for(const patch of [{version:2},{goalMs:Infinity},{goalMs:-1},{goalMs:181*MIN},{service:[]},{service:{a:NaN}},{service:{a:-1}},{turn:null},{turn:{taskId:"b",elapsedMs:0}},{turn:{taskId:"a",elapsedMs:31*MIN}}])
    assert.equal(tr.parseTracking({...s,pacing:{...s.pacing,...patch}}),null);
  assert.deepEqual(tr.parseTracking(JSON.parse(JSON.stringify(s))),s);
});
check("outing advice reserves work, round-trip travel and other commitments without changing the timer", () => {
  const at=Date.parse("2026-10-06T15:30:00Z"), s=fresh([task("a"),task("b")],at), copy=structuredClone(s);
  const advice=tr.outingAdvice(s,at,60,60);
  near(advice.availableMs,120*MIN); near(advice.workLeftMs,120*MIN); assert.deepEqual(s,copy);
  near(tr.outingAdvice(s,at,500,60).availableMs,0);
});
check("legacy migrations checkpoint old elapsed attribution once without replaying alerts", () => {
  for(let seed=0;seed<500;seed++) {
    const list=[task("a"),task("b",1),task("c",20)];
    let s=old.createTracking(list,"21:30","UTC",T,PLAN,seed%2===0,seed%3===0,10+seed%50);
    s=old.actOnTracking(s,{type:"start"},"owner",T);
    s=old.advanceTracking(s,T+(seed%40)*MIN).state;
    if(seed%4===0) s=old.actOnTracking(s,{type:"pause"},"owner",s.cursor);
    if(seed%5===0) {delete s.workLimitVersion; delete s.idlePolicyVersion; s.carryMs=MIN;}
    if(seed%7===0) {s.coverageVersion=1; s.coverageGoalMs=240*MIN; s.coverageDays=3;}
    if(seed%11===0) {delete s.coverageVersion; s.workOnlyVersion=1;}
    const now=T+(60+seed%400)*MIN, copy=structuredClone(s);
    const expected=old.advanceTracking(s,now).state, migrated=tr.advanceTracking(s,now);
    for(const key of ["workMs","taskMs","taskId","mode","controllerId","dayKey","cursor","revision"])
      assert.deepEqual(migrated.state[key],expected[key],"migration "+seed+" "+key);
    assert.deepEqual(migrated.events,[]); assert.deepEqual(s,copy);
    assert.equal(migrated.state.pacing.version,1);
    assert.deepEqual(tr.advanceTracking(migrated.state,now).state,migrated.state);
  }
});
check("parsing a legacy rest snapshot preserves work and does not count rest as work", () => {
  const legacy={...old.createTracking(tasks,"21:30","UTC",T,PLAN),mode:"rest",workMs:100*MIN,taskMs:{a:100*MIN},restMs:30*MIN};
  const s=tr.advanceTracking(tr.parseTracking(legacy),T+60*MIN).state;
  assert.equal(s.mode,"idle"); near(s.workMs,100*MIN); assert.equal(s.restMs,undefined);
});

console.log("== shared account pacing (in-process Postgres) ==");
const pg=new PGlite();
setSql({query:async(text,params=[]) => (await pg.query(text,params)).rows,transaction:async statements=>pg.transaction(async tx=>{for(const s of statements)await tx.query(s.text,s.params??[]);})});
await ensureSchema();
for(const id of ["alice","bob","migration"]) await pg.query("INSERT INTO users (id,username,username_lower,password_hash,created_at) VALUES ($1,$1,$1,'test',$2)",[id,new Date(T).toISOString()]);
const prefs={tasks,recommendation:null,schedule:null,endTime:"21:30",plan:PLAN};
await saveState("alice",prefs);
let shared=await db.commandTracking("alice",0,{type:"start"},"web","UTC",tasks,"21:30",PLAN,T);
assert.equal(shared.revision,1); assert.equal(shared.taskId,"a"); count++;
const race=await Promise.allSettled([
 db.commandTracking("alice",1,{type:"pause"},"phone","UTC",tasks,"21:30",PLAN,T+10*MIN),
 db.commandTracking("alice",1,{type:"start",taskId:"b"},"desktop","UTC",tasks,"21:30",PLAN,T+10*MIN)
]);
assert.equal(race.filter(r=>r.status==="fulfilled").length,1); assert.ok(race.find(r=>r.status==="rejected").reason instanceof db.TrackingConflict); count++;
shared=await db.loadTracking("alice"); near(shared.workMs,10*MIN); assert.equal(shared.revision,2);
const accountBefore=await loadState("alice");
const reset=await db.commandTracking("alice",shared.revision,{type:"reset"},"desktop","UTC",tasks,"21:30",PLAN,T+12*MIN);
near(reset.workMs,0); assert.equal(reset.mode,"idle"); assert.deepEqual(await loadState("alice"),accountBefore);
assert.equal(await db.loadTracking("bob"),null); count++;
for(const type of ["start","continue","pause","reset"]) await assert.rejects(db.commandTracking("alice",shared.revision,{type},"stale","UTC",tasks,"21:30",PLAN,T+13*MIN),db.TrackingConflict);
assert.deepEqual(await db.loadTracking("alice"),reset); count++;
await db.importAccountTracking("alice",fresh(),tasks,"21:30",PLAN,T+20*MIN);
assert.deepEqual(await db.loadTracking("alice"),reset,"import must never overwrite an account timer"); count++;
let active=await db.commandTracking("alice",reset.revision,{type:"start"},"phone","UTC",tasks,"21:30",PLAN,T+20*MIN);
await db.configureAccountTracking("alice",tasks.filter(t=>t.id!==active.taskId),"21:30",PLAN,T+25*MIN);
shared=await db.loadTracking("alice");
near(shared.workMs,5*MIN); assert.equal(shared.mode,"idle"); assert.equal(shared.controllerId,"phone"); count++;
await saveState("migration",{...prefs,unweighted:true,minimumEnabled:false,minimumMinutes:15});
let legacy=old.actOnTracking(old.createTracking(tasks,"21:30","UTC",T,PLAN),{type:"start"},"owner",T);
await pg.query("INSERT INTO tracking(user_id,state) VALUES($1,$2)",["migration",JSON.stringify(legacy)]);
const expected=old.advanceTracking(legacy,T+70*MIN).state;
const migrated=await db.readAccountTracking("migration",T+70*MIN);
near(migrated.workMs,expected.workMs); assert.deepEqual(migrated.taskMs,expected.taskMs); assert.equal(migrated.controllerId,"owner");
assert.equal(migrated.pacing.version,1); assert.equal(migrated.revision,1); count++;
assert.deepEqual(await db.readAccountTracking("migration",T+71*MIN),migrated,"ordinary reads leave the checkpoint stable");
await assert.rejects(db.commandTracking("migration",0,{type:"pause"},"stale","UTC",tasks,"21:30",PLAN,T+72*MIN),db.TrackingConflict); count++;
const tomorrow=await db.readAccountTracking("migration",T+86_400_000);
assert.equal(tomorrow.mode,"idle"); near(tomorrow.workMs,0); assert.equal(tomorrow.pacing.version,1); assert.ok(Object.values(tomorrow.pacing.service).some(v=>v>0)); count++;
await pg.query("DELETE FROM users WHERE id=$1",["migration"]); assert.equal(await db.loadTracking("migration"),null); count++;
await pg.close(); setSql(null);
console.log(count+" pacing and database scenarios passed (including 500 legacy migration samples)");
