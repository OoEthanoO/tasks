import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const tr = require("../.test-build/tracking.js");
const old = require("../.test-build/legacy-tracking.js");
const paced = require("../.test-build/paced-tracking.js");
const { describeFocus } = require("../.test-build/focus.js");
const protocol = require("../.test-build/tracking-protocol.js");
const { setSql, ensureSchema } = require("../.test-build/sql.js");
const db = require("../.test-build/tracking-db.js");
const { saveState, loadState } = require("../.test-build/db.js");
const MIN = 60_000, H = 60*MIN, T = Date.parse("2026-10-06T08:00:00Z");
const PLAN = { startTime:"06:30",workParts:1,idleParts:1 };
const task=(id,days=0)=>({id,title:id,description:"",dueDate:new Date(T+days*86_400_000).toISOString().slice(0,10),createdAt:new Date(T).toISOString(),priority:"low",completed:false,completedAt:null});
const tasks=[task("a"),task("b",1),task("c",30)];
const fresh=(list=tasks,now=T)=>tr.createTracking(list,"21:30","UTC",now,PLAN);
const start=s=>tr.actOnTracking(s,{type:"start"},"desktop",s.cursor);
const near=(a,b)=>assert.ok(Math.abs(a-b)<0.01,a+" != "+b);
const totals=(s,values)=>{s.rotation.totals=Object.fromEntries(s.tasks.map((t,i)=>[t.id,values[i]*H]));return s;};
const ordered=s=>{const q=tr.rotationQueue(s),v=q.map(t=>s.rotation.totals[t.id]??0);return v.every((n,i)=>i===0||n<=v[i-1]+0.001);};
let count=0;
function check(name,fn){fn();count++;console.log("✓ "+name);}

check("only matching tracking protocols may read or command the new calculation",()=>{
 assert.equal(protocol.supportsTrackingProtocol(new Headers()),false);
 assert.equal(protocol.supportsTrackingProtocol(new Headers({[protocol.TRACKING_PROTOCOL_HEADER]:"pacing-v1"})),false);
 assert.equal(protocol.supportsTrackingProtocol(new Headers({[protocol.TRACKING_PROTOCOL_HEADER]:protocol.TRACKING_PROTOCOL})),true);
});

check("equal one-hour turns run top to bottom and repeat automatically",()=>{
 const initial=start(fresh()),copy=structuredClone(initial);
 let s=initial;
 for(let i=1;i<=9;i++){
  const r=tr.advanceTracking(s,T+i*H);s=r.state;
  assert.equal(s.taskId,tasks[i%3].id);assert.equal(s.mode,"work");
  assert.equal(r.events.length,1);assert.equal(r.events[0].type,"turn-complete");
  near(s.workMs,i*H);assert.ok(ordered(s));near(tr.turnLeftMs(s),H);
 }
 assert.deepEqual(s.rotation.totals,{a:3*H,b:3*H,c:3*H});
 assert.deepEqual(initial,copy);assert.ok(s.tasks.every(t=>!t.completed));
});
check("2h,0h,2h catches the new middle task up for two consecutive hours",()=>{
 let s=start(totals(fresh(),[2,0,2]));assert.equal(s.taskId,"b");
 let r=tr.advanceTracking(s,T+H);s=r.state;assert.equal(s.taskId,"b");near(s.rotation.totals.b,H);assert.match(r.events[0].body,/Keep working on b/);
 r=tr.advanceTracking(s,T+2*H);s=r.state;assert.deepEqual(s.rotation.totals,{a:2*H,b:2*H,c:2*H});assert.equal(s.taskId,"a");assert.match(r.events[0].body,/Now tracking a/);
 s=tr.advanceTracking(s,T+3*H).state;assert.equal(s.taskId,"b");near(s.rotation.totals.a,3*H);
});
check("repairs actual rises before adding another ordinary round",()=>{
 const list=[task("a"),task("b",1),task("new",2),task("c",3)];
 let s=start(totals(fresh(list),[3,2,0,2]));assert.equal(s.taskId,"new");
 s=tr.advanceTracking(s,T+2*H).state;near(s.rotation.totals.new,2*H);assert.equal(s.taskId,"b");assert.ok(ordered(s));
});
check("a new task at the top catches up before adding time to later tasks",()=>{
 let s=start(totals(fresh(),[0,2,2]));assert.equal(s.taskId,"a");
 s=tr.advanceTracking(s,T+2*H).state;assert.deepEqual(s.rotation.totals,{a:2*H,b:2*H,c:2*H});assert.equal(s.taskId,"a");
});
check("fractional catch-up stops exactly at the preceding total",()=>{
 let s=start(totals(fresh(),[2.25,0.5,2.25]));assert.equal(s.taskId,"b");near(tr.turnLeftMs(s),H);
 s=tr.advanceTracking(s,T+H).state;assert.equal(s.taskId,"b");near(tr.turnLeftMs(s),45*MIN);
 const r=tr.advanceTracking(s,T+105*MIN);near(r.state.rotation.totals.b,2.25*H);assert.ok(ordered(r.state));assert.equal(r.events[0].title,"Caught up");
});
check("arbitrary integer and fractional histories converge without erasing time",()=>{
 for(let seed=0;seed<150;seed++){
  const values=Array.from({length:2+seed%7},(_,i)=>((seed*17+i*13)%12)/4);
  const list=values.map((_,i)=>task("t"+i,i));
  let s=start(totals(fresh(list),values)), initial=structuredClone(s.rotation.totals);
  for(let i=0;i<100&&!ordered(s);i++)s=tr.advanceTracking(s,s.cursor+tr.turnLeftMs(s)).state;
  assert.ok(ordered(s),"seed "+seed);
  for(const [id,ms]of Object.entries(initial))assert.ok(s.rotation.totals[id]>=ms);
  for(let i=0;i<40;i++){s=tr.advanceTracking(s,s.cursor+15*MIN).state;assert.ok(ordered(s));}
 }
});
check("date distance and retired priority/settings never change a turn's duration",()=>{
 const list=[task("a",-100),{...task("b",3650),priority:"high"}];
 let s=tr.createTracking(list,"08:01","UTC",T,{startTime:"23:00",workParts:20,idleParts:1},true,true,1440);
 s=tr.advanceTracking(start(s),T+10*H).state;near(s.rotation.totals.a,5*H);near(s.rotation.totals.b,5*H);assert.equal(s.mode,"work");
 assert.equal(tr.trackingConfigKey(list,"08:01",PLAN),tr.trackingConfigKey(list.map(t=>({...t,priority:"medium"})),"01:00",{...PLAN,workParts:15},false,false,0));
});
check("picker order exactly matches displayed due-date/creation/stable tie order",()=>{
 const a=task("z"),b={...task("a"),createdAt:new Date(T+1000).toISOString()},c={...a,id:"stable-second"};
 const s=fresh([a,c,b]);assert.deepEqual(tr.rotationQueue(s).map(t=>t.id),["z","stable-second","a"]);
 assert.equal(start(s).taskId,"z");
});
check("paused time never becomes work, idle debt or a recommendation",()=>{
 const s=fresh(),r=tr.advanceTracking(s,T+14*86_400_000);
 assert.equal(r.state.workMs,0);assert.deepEqual(r.state.rotation.totals,{});assert.equal(r.state.mode,"idle");assert.deepEqual(r.events,[]);
 assert.deepEqual(tr.upcomingTrackingEvents(s,T),[]);assert.equal(tr.idleLeftMs(r.state),0);
 const f=describeFocus(r.state,tr.taskProgress(r.state),true);assert.equal(f.done,false);assert.equal(f.clock,H);assert.equal(f.workLeft,undefined);
});
check("pause, reload and resume keep a partial hour without counting the pause",()=>{
 let s=tr.actOnTracking(start(fresh()),{type:"pause"},"phone",T+10*MIN);
 s=tr.parseTracking(JSON.parse(JSON.stringify(s)));s=tr.advanceTracking(s,T+3*H).state;
 near(s.workMs,10*MIN);near(tr.turnLeftMs(s),50*MIN);assert.equal(tr.suggestedTask(s).id,"a");
 s=start(s);s=tr.advanceTracking(s,s.cursor+55*MIN).state;
 near(s.rotation.totals.a,H);near(s.rotation.totals.b,5*MIN);near(s.workMs,65*MIN);assert.equal(s.mode,"work");
});
check("old manual task/continue commands cannot bypass the ordered picker",()=>{
 let s=tr.actOnTracking(fresh(),{type:"start",taskId:"c"},"phone",T);assert.equal(s.taskId,"a");
 s=tr.actOnTracking(s,{type:"continue"},"phone",T+H);assert.equal(s.taskId,"b");
});
check("an inserted task starts at zero and is selected immediately on reconfiguration",()=>{
 const list=[task("a"),task("c",2)];
 let s=totals(fresh(list),[2,2]);s=tr.configureTracking(s,[...list,task("new",1)],"21:30",T);
 near(tr.taskProgress(s).find(p=>p.task.id==="new").trackedMs,0);assert.equal(start(s).taskId,"new");
 let active=start(totals(fresh(list),[2,2]));
 active=tr.configureTracking(active,[...list,task("new",1)],"21:30",T+10*MIN);
 near(active.rotation.totals.a,2*H+10*MIN);assert.equal(active.taskId,"new");
});
check("metadata edits do not restart a partial turn or change alert ownership",()=>{
 const s=start(fresh()),r=tr.configureTracking(s,tasks.map(t=>({...t,title:t.title+"!",description:"edited",priority:"high"})),"01:00",T+17*MIN);
 near(r.rotation.turn.elapsedMs,17*MIN);near(tr.turnLeftMs(r),43*MIN);assert.equal(r.controllerId,"desktop");
});
check("inserting or completing an unrelated later task does not cut the current hour short",()=>{
 for(const changed of [[...tasks,task("later",365)],tasks.map(t=>t.id==="c"?{...t,completed:true}:t)]){
  const s=tr.configureTracking(start(fresh()),changed,"21:30",T+17*MIN);
  assert.equal(s.taskId,"a");near(s.rotation.turn.elapsedMs,17*MIN);near(tr.turnLeftMs(s),43*MIN);
 }
});
check("due-date reordering repairs the new displayed order using real totals",()=>{
 let s=totals(fresh(),[3,2,1]);
 s=tr.configureTracking(s,[{...tasks[0],dueDate:task("x",100).dueDate},tasks[1],tasks[2]],"21:30",T);
 assert.deepEqual(tr.rotationQueue(s).map(t=>t.id),["b","c","a"]);
 assert.equal(start(s).taskId,"c");
 assert.deepEqual(s.rotation.totals,{a:3*H,b:2*H,c:H});
});
check("completion/deletion advances only an active timer and preserves earned work",()=>{
 for(const remove of [false,true]){
  const list=remove?tasks.slice(1):tasks.map(t=>t.id==="a"?{...t,completed:true}:t);
  const s=tr.configureTracking(start(fresh()),list,"21:30",T+8*MIN);
  near(s.workMs,8*MIN);near(s.rotation.totals.a,8*MIN);assert.equal(s.taskId,"b");assert.equal(s.mode,"work");assert.equal(s.controllerId,"desktop");
  const paused=tr.configureTracking(fresh(),list,"21:30",T);assert.equal(paused.mode,"idle");assert.equal(paused.taskId,null);
 }
});
check("all tasks completed pauses and reopening never restarts work",()=>{
 const s=tr.configureTracking(start(fresh()),tasks.map(t=>({...t,completed:true})),"21:30",T+MIN);
 assert.equal(s.mode,"idle");assert.equal(s.taskId,null);near(s.rotation.totals.a,MIN);assert.equal(tr.canTrackWork(s),false);
 const reopened=tr.configureTracking(s,tasks,"21:30",T+2*MIN);assert.equal(reopened.mode,"idle");
});
check("legacy reset clears only daily counters, never accumulated hours",()=>{
 const s=tr.advanceTracking(start(fresh()),T+70*MIN).state;
 const r=tr.actOnTracking(s,{type:"reset"},"phone",T+80*MIN);
 near(r.workMs,0);assert.deepEqual(r.taskMs,{});assert.deepEqual(r.rotation.totals,{a:H,b:20*MIN});assert.equal(r.mode,"idle");near(tr.turnLeftMs(r),40*MIN);
});
check("midnight keeps tracking and turn history, resetting only today's statistic",()=>{
 const now=Date.parse("2026-10-07T03:50:00Z");
 const s=start(tr.createTracking(tasks,"21:30","America/Toronto",now,PLAN));
 const r=tr.advanceTracking(s,now+20*MIN);assert.equal(r.state.dayKey,"2026-10-07");near(r.state.workMs,10*MIN);
 near(r.state.rotation.totals.a,20*MIN);near(tr.turnLeftMs(r.state),40*MIN);assert.equal(r.state.mode,"work");assert.deepEqual(r.events,[]);
});
check("DST days preserve exact elapsed time and cumulative history",()=>{
 for(const [date,hours]of [["2026-03-08T05:00:00Z",23],["2026-11-01T04:00:00Z",25]]){
  const now=Date.parse(date),s=start(tr.createTracking(tasks,"21:30","America/Toronto",now,PLAN));
  const r=tr.advanceTracking(s,now+hours*H-1000).state;
  near(r.workMs,hours*H-1000);near(Object.values(r.rotation.totals).reduce((a,b)=>a+b,0),r.workMs);
  assert.ok(tr.parseTracking(JSON.parse(JSON.stringify(r))));
  const midnight=tr.advanceTracking(r,now+hours*H).state;near(midnight.workMs,0);assert.equal(midnight.mode,"work");
 }
});
check("one-second ticks and a long projection give the same state and events",()=>{
 const initial=start(fresh());let s=initial,events=[];
 for(let i=1;i<=15000;i++){const r=tr.advanceTracking(s,T+i*1000);s=r.state;events.push(...r.events);}
 const direct=tr.advanceTracking(initial,T+15000*1000);assert.deepEqual(s,direct.state);assert.deepEqual(events,direct.events);
});
check("future alerts describe automatic transitions and survive pause/resume",()=>{
 const s=start(fresh()),events=tr.upcomingTrackingEvents(s,T);
 assert.equal(events.length,24);assert.equal(events[0].at,T+H);assert.match(events[0].body,/Now tracking b/);
 assert.deepEqual(events,tr.advanceTracking(s,T+24*H).events);
 const paused=tr.actOnTracking(s,{type:"pause"},"desktop",T+10*MIN);assert.deepEqual(tr.upcomingTrackingEvents(paused,T+11*MIN),[]);
 const resumed=tr.actOnTracking(paused,{type:"start"},"desktop",T+H);
 const later=tr.upcomingTrackingEvents(resumed,T+H);assert.equal(later[0].at,T+110*MIN);assert.notEqual(later[0].id,events[0].id);
});
check("an expired day setting never blocks tracking and no daily cap exists",()=>{
 const s=start(fresh([task("x",10000)],T+15*H)),r=tr.advanceTracking(s,s.cursor+30*H).state;
 near(r.rotation.totals.x,30*H);assert.equal(r.mode,"work");
});
check("clock reversal and non-finite clock values cannot mutate or erase work",()=>{
 const s=tr.advanceTracking(start(fresh()),T+10*MIN).state;
 for(const now of[T,NaN,Infinity])assert.deepEqual(tr.advanceTracking(s,now),{state:s,events:[]});
});
check("empty/completed lists cannot start",()=>{
 for(const list of[[],[{...task("a"),completed:true}]])assert.throws(()=>start(fresh(list)),/No unfinished/);
});
check("special object keys are safe task IDs",()=>{
 for(const id of["__proto__","constructor","toString"]){
  const s=tr.advanceTracking(start(fresh([task(id)])),T+MIN).state;
  near(s.taskMs[id],MIN);near(s.rotation.totals[id],MIN);assert.equal(Object.getPrototypeOf(s.rotation.totals),Object.prototype);
  assert.ok(tr.parseTracking(JSON.parse(JSON.stringify(s))));
 }
});
check("parser rejects malformed rotation state",()=>{
 const s=start(fresh());
 for(const patch of[{version:2},{commandSeq:-1},{totals:[]},{totals:{a:NaN}},{totals:{a:-1}},{turn:null},{turn:{taskId:"b",elapsedMs:0,durationMs:H}},{turn:{taskId:"a",elapsedMs:H+1,durationMs:H}},{turn:{taskId:"a",elapsedMs:0,durationMs:0}},{turn:{taskId:"a",elapsedMs:0,durationMs:2*H}}])
  assert.equal(tr.parseTracking({...s,rotation:{...s.rotation,...patch}}),null);
 assert.deepEqual(tr.parseTracking(JSON.parse(JSON.stringify(s))),s);
});
check("500 migrations checkpoint old actual time exactly, never old weighted scores",()=>{
 for(let seed=0;seed<500;seed++){
  const source=seed%2?paced:old;
  let s=source.actOnTracking(source.createTracking(tasks,"21:30","UTC",T,PLAN),{type:"start"},"owner",T);
  s=source.advanceTracking(s,T+(seed%20)*MIN).state;
  if(seed%3===0)s=source.actOnTracking(s,{type:"pause"},"owner",s.cursor);
  if(source===old&&seed%5===0){delete s.workLimitVersion;delete s.idlePolicyVersion;s.carryMs=MIN;}
  if(source===old&&seed%7===0){s.coverageVersion=1;s.coverageGoalMs=240*MIN;s.coverageDays=3;}
  if(source===old&&seed%11===0){delete s.coverageVersion;s.workOnlyVersion=1;}
  const now=T+(60+seed%400)*MIN,copy=structuredClone(s),expected=source.advanceTracking(s,now).state;
  const r=tr.advanceTracking(s,now);
  for(const key of["workMs","taskMs","controllerId","dayKey","cursor","revision"])assert.deepEqual(r.state[key],expected[key],"seed "+seed+" "+key);
  assert.deepEqual(r.state.rotation.totals,expected.taskMs);assert.equal(r.state.rotation.version,1);assert.equal(r.state.pacing,undefined);
  assert.deepEqual(r.events,[]);assert.deepEqual(s,copy);assert.deepEqual(tr.advanceTracking(r.state,now).state,r.state);
 }
});
check("migration across midnight retains saved actual history rather than virtual service",()=>{
 let s=paced.createTracking(tasks,"21:30","UTC",T,PLAN);s.workMs=95*MIN;s.taskMs={a:95*MIN};s.pacing.service={a:99999*H};
 const r=tr.advanceTracking(s,T+2*86_400_000).state;near(r.workMs,0);near(r.rotation.totals.a,95*MIN);
});

console.log("== account synchronization (in-process Postgres) ==");
const pg=new PGlite();
setSql({query:async(text,params=[])=>(await pg.query(text,params)).rows,transaction:async statements=>pg.transaction(async tx=>{for(const s of statements)await tx.query(s.text,s.params??[]);})});
await ensureSchema();
for(const id of["alice","bob","migration"])await pg.query("INSERT INTO users(id,username,username_lower,password_hash,created_at) VALUES($1,$1,$1,'test',$2)",[id,new Date(T).toISOString()]);
const prefs={tasks,recommendation:null,schedule:null,endTime:"21:30",plan:PLAN};
await saveState("alice",prefs);
let shared=await db.commandTracking("alice",0,{type:"start"},"web","UTC",tasks,"21:30",PLAN,T);
assert.equal(shared.revision,1);assert.equal(shared.taskId,"a");count++;
const race=await Promise.allSettled([
 db.commandTracking("alice",1,{type:"pause"},"phone","UTC",tasks,"21:30",PLAN,T+10*MIN),
 db.commandTracking("alice",1,{type:"start"},"desktop","UTC",tasks,"21:30",PLAN,T+10*MIN)]);
assert.equal(race.filter(r=>r.status==="fulfilled").length,1);assert.ok(race.find(r=>r.status==="rejected").reason instanceof db.TrackingConflict);count++;
shared=await db.loadTracking("alice");near(shared.workMs,10*MIN);assert.equal(shared.revision,2);
const savedPrefs=await loadState("alice");
const reset=await db.commandTracking("alice",2,{type:"reset"},"desktop","UTC",tasks,"21:30",PLAN,T+12*MIN);
assert.equal(reset.mode,"idle");assert.deepEqual(await loadState("alice"),savedPrefs);assert.equal(await db.loadTracking("bob"),null);count++;
for(const type of["start","continue","pause","reset"])await assert.rejects(db.commandTracking("alice",1,{type},"stale","UTC",tasks,"21:30",PLAN,T+13*MIN),db.TrackingConflict);
await db.importAccountTracking("alice",fresh(),tasks,"21:30",PLAN,T+20*MIN);assert.deepEqual(await db.loadTracking("alice"),reset);count++;
let oldState=paced.actOnTracking(paced.createTracking(tasks,"21:30","UTC",T,PLAN),{type:"start"},"owner",T);
await saveState("migration",prefs);
await pg.query("INSERT INTO tracking(user_id,state) VALUES($1,$2)",["migration",JSON.stringify(oldState)]);
const expected=paced.advanceTracking(oldState,T+70*MIN).state;
const migrated=await db.readAccountTracking("migration",T+70*MIN);
near(migrated.workMs,expected.workMs);assert.deepEqual(migrated.rotation.totals,expected.taskMs);assert.equal(migrated.controllerId,"owner");assert.equal(migrated.revision,1);count++;
assert.deepEqual(await db.readAccountTracking("migration",T+71*MIN),migrated);
await assert.rejects(db.commandTracking("migration",0,{type:"pause"},"stale","UTC",tasks,"21:30",PLAN,T+72*MIN),db.TrackingConflict);count++;
const active=await db.commandTracking("migration",1,{type:"start"},"owner","UTC",tasks,"21:30",PLAN,T+72*MIN);
const checkpoint=await db.readAccountTracking("migration",T+24*H);
assert.equal(checkpoint.mode,"work");assert.equal(checkpoint.rotation.version,1);assert.ok(Object.values(checkpoint.rotation.totals).reduce((a,b)=>a+b,0)>12*H);
assert.deepEqual(await db.readAccountTracking("migration",T+24*H+MIN),checkpoint);count++;
const remaining=tasks.filter(t=>t.id!==checkpoint.taskId);
await db.configureAccountTracking("migration",remaining,"21:30",PLAN,T+24*H+2*MIN);
const edited=await db.loadTracking("migration");assert.equal(edited.mode,"work");assert.notEqual(edited.taskId,checkpoint.taskId);assert.equal(edited.controllerId,"owner");count++;
await pg.query("DELETE FROM users WHERE id=$1",["migration"]);assert.equal(await db.loadTracking("migration"),null);count++;
await pg.close();setSql(null);
console.log(count+" rotation and database scenarios passed (including 150 generated histories and 500 migrations)");
