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
const { moveTaskWithinDueDate } = require("../.test-build/grouping.js");
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
 assert.equal(protocol.supportsTrackingProtocol(new Headers({[protocol.TRACKING_PROTOCOL_HEADER]:"rotation-v1"})),false);
 assert.equal(protocol.supportsTrackingProtocol(new Headers({[protocol.TRACKING_PROTOCOL_HEADER]:"rotation-v2"})),false);
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
 let s=start(totals(fresh(),[2.25,0.5,2.25]));assert.equal(s.taskId,"b");near(tr.turnLeftMs(s),30*MIN);
 s=tr.advanceTracking(s,T+H).state;assert.equal(s.taskId,"b");near(tr.turnLeftMs(s),30*MIN);
 const r=tr.advanceTracking(s,T+105*MIN);near(r.state.rotation.totals.b,2.25*H);assert.ok(ordered(r.state));assert.equal(r.events.at(-1).title,"Caught up");
});
check("66 minutes on the first task and 50 on the second means 10 left, then the third task",()=>{
 let s=start(totals(fresh(),[66/60,50/60,0]));
 assert.equal(s.taskId,"b");near(tr.turnLeftMs(s),10*MIN);
 const progress=tr.taskProgress(s).find(p=>p.task.id==="b");
 near(progress.turnElapsedMs,50*MIN);near(progress.turnDurationMs,H);
 const forecast=tr.upcomingTrackingEvents(s,T);near(forecast[0].at,T+10*MIN);assert.match(forecast[0].body,/Now tracking c/);
 s=tr.advanceTracking(s,T+10*MIN).state;
 assert.equal(s.taskId,"c");near(s.rotation.totals.b,H);near(tr.turnLeftMs(s),H);
 s=tr.advanceTracking(s,T+70*MIN).state;
 assert.equal(s.taskId,"a");near(tr.turnLeftMs(s),54*MIN);
});
check("every round credits partial prior hours instead of scheduling another full hour",()=>{
 for(const round of [0,1,2,10]){
  const s=start(totals(fresh(),[round+1.1,round+50/60,round]));
  assert.equal(s.taskId,"b");near(tr.turnLeftMs(s),10*MIN);
  assert.equal(tr.advanceTracking(s,T+10*MIN).state.taskId,"c");
 }
 const s=start(totals(fresh([tasks[0]]),[50/60]));near(tr.turnLeftMs(s),10*MIN);
 near(tr.turnLeftMs(tr.advanceTracking(s,T+10*MIN).state),H);
});
check("ordinary fractional gaps do not steal a turn from an untouched later task",()=>{
 const s=start(totals(fresh(),[66/60,1,0]));assert.equal(s.taskId,"c");near(tr.turnLeftMs(s),H);
 const next=start(totals(fresh(),[45/60,30/60,0]));assert.equal(next.taskId,"a");near(tr.turnLeftMs(next),15*MIN);
});
const oldFractionalTurn=()=>{
 const s=totals(fresh(),[3991017/H,3050392/H,0]);
 s.rotation.version=1;s.rotation.turn={taskId:"b",elapsedMs:1979779,durationMs:2920404.000000001};
 s.taskMs={a:3991017,b:3050392};s.workMs=7041409;s.controllerId="owner";s.mode="idle";s.taskId=null;
 return s;
};
check("the reported paused snapshot migrates from 15m40s to 9m09s without altering recorded work",()=>{
 const s=oldFractionalTurn(),copy=structuredClone(s),r=tr.advanceTracking(s,T);
 assert.equal(tr.parseTracking(s).rotation.version,1);
 assert.deepEqual(r.state.rotation.totals,s.taskMs);assert.deepEqual(r.state.taskMs,s.taskMs);near(r.state.workMs,s.workMs);
 assert.equal(r.state.mode,"idle");assert.equal(r.state.taskId,null);assert.equal(r.state.controllerId,"owner");
 near(tr.turnLeftMs(r.state),549608);near(r.state.rotation.turn.elapsedMs,3050392);near(r.state.rotation.turn.durationMs,H);
 assert.deepEqual(r.events,[]);assert.deepEqual(s,copy);assert.equal(r.state.rotation.version,tr.ROTATION_VERSION);
 assert.deepEqual(tr.advanceTracking(r.state,T).state,r.state);
 const resumed=tr.actOnTracking(r.state,{type:"start"},"owner",T+H);
 assert.equal(tr.advanceTracking(resumed,T+H+549608).state.taskId,"c");
});
check("migration accounts for elapsed work under v1 before switching future hour boundaries",()=>{
 const s=oldFractionalTurn();s.mode="work";s.taskId="b";
 const r=tr.advanceTracking(s,T+20*MIN);
 near(r.state.rotation.totals.a,3991017);near(r.state.rotation.totals.b,3991017);
 near(r.state.rotation.totals.c,259375);near(r.state.workMs,s.workMs+20*MIN);
 assert.equal(r.state.taskId,"c");assert.equal(r.state.controllerId,"owner");assert.equal(r.state.rotation.commandSeq,s.rotation.commandSeq);
 near(tr.turnLeftMs(r.state),H-259375);assert.deepEqual(r.events,[]);
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
check("picker order exactly matches displayed due-date/saved tie order",()=>{
 const a=task("z"),b={...task("a"),createdAt:new Date(T+1000).toISOString()},c={...a,id:"stable-second"};
 const s=fresh([b,c,a]);assert.deepEqual(tr.rotationQueue(s).map(t=>t.id),["a","stable-second","z"]);
 assert.equal(start(s).taskId,"a");
});
check("manual moves reconfigure active and paused turns without losing time or starting paused work",()=>{
 const list=[task("a"),task("b"),task("c",1)], moved=moveTaskWithinDueDate(list,"b","up");
 assert.notEqual(tr.trackingConfigKey(list),tr.trackingConfigKey(moved));
 for(const paused of [false,true]){
  let s=tr.advanceTracking(start(fresh(list)),T+10*MIN).state;
  if(paused)s=tr.actOnTracking(s,{type:"pause"},"desktop",s.cursor);
  const before=structuredClone(s),r=tr.configureTracking(s,moved,"21:30",s.cursor);
  assert.equal(r.mode,paused?"idle":"work");assert.equal(r.taskId,paused?null:"b");
  assert.equal(tr.suggestedTask(r).id,"b");near(tr.turnLeftMs(r),H);
  assert.deepEqual(r.taskMs,before.taskMs);assert.deepEqual(r.rotation.totals,before.rotation.totals);
  assert.equal(r.workMs,before.workMs);assert.equal(r.controllerId,before.controllerId);assert.deepEqual(s,before);
  const nextDay=tr.advanceTracking(r,T+24*H).state;
  assert.deepEqual(tr.rotationQueue(nextDay).map(t=>t.id),["b","a","c"]);
  assert.equal(start(nextDay).taskId,"b");
 }
});
check("reordering unrelated future turns leaves the current hour intact",()=>{
 const list=[task("a"),task("b",1),task("c",1)];
 const s=tr.configureTracking(start(fresh(list)),moveTaskWithinDueDate(list,"c","up"),"21:30",T+17*MIN);
 assert.equal(s.taskId,"a");near(tr.turnLeftMs(s),43*MIN);
 assert.equal(tr.advanceTracking(s,T+H).state.taskId,"c");
});
check("v1/v2 checkpoints keep historical creation ordering before enabling saved-order turns",()=>{
 for(const version of [1,2]){
  const a=task("older"),b={...task("newer"),createdAt:new Date(T+1000).toISOString()};
  const s=fresh([b,a]);s.rotation.version=version;s.mode="work";s.taskId=a.id;s.controllerId="desktop";
  s.rotation.turn={taskId:a.id,elapsedMs:0,durationMs:H};
  assert.deepEqual(tr.rotationQueue(s).map(t=>t.id),["older","newer"]);
  const r=tr.advanceTracking(s,T+70*MIN).state;
  assert.deepEqual(r.taskMs,{older:H,newer:10*MIN});assert.deepEqual(r.rotation.totals,r.taskMs);
  near(r.workMs,70*MIN);assert.equal(r.controllerId,"desktop");
  assert.deepEqual(tr.rotationQueue(r).map(t=>t.id),["newer","older"]);assert.equal(r.taskId,"newer");
 }
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
check("manual reset clears the daily rotation without changing tasks",()=>{
 const s=tr.advanceTracking(start(fresh()),T+70*MIN).state;
 const r=tr.actOnTracking(s,{type:"reset"},"phone",T+80*MIN);
 near(r.workMs,0);assert.deepEqual(r.taskMs,{});assert.deepEqual(r.rotation.totals,{});assert.equal(r.mode,"idle");near(tr.turnLeftMs(r),H);
 assert.equal(r.rotation.turn,null);assert.deepEqual(r.tasks,s.tasks);assert.equal(tr.suggestedTask(r).id,"a");
});
check("local midnight clears times and partial turns, pauses and restarts at the top",()=>{
 const now=Date.parse("2026-10-07T03:50:00Z");
 const s=start(tr.createTracking(tasks,"21:30","America/Toronto",now,PLAN));
 const before=tr.advanceTracking(s,now+10*MIN-1).state;near(before.workMs,10*MIN-1);assert.equal(before.mode,"work");
 for(const elapsed of [10*MIN,20*MIN,7*24*H]){
  const r=tr.advanceTracking(s,now+elapsed);near(r.state.workMs,0);
  assert.deepEqual(r.state.taskMs,{});assert.deepEqual(r.state.rotation.totals,{});assert.equal(r.state.rotation.turn,null);
  near(tr.turnLeftMs(r.state),H);assert.equal(r.state.mode,"idle");assert.equal(r.state.taskId,null);assert.deepEqual(r.events,[]);
  assert.deepEqual(r.state.tasks,s.tasks);assert.equal(r.state.controllerId,s.controllerId);
  assert.equal(tr.suggestedTask(r.state).id,"a");assert.ok(tr.taskProgress(r.state).every(p=>p.trackedMs===0));
  assert.deepEqual(tr.advanceTracking(r.state,r.state.cursor).state,r.state);
 }
 const resumed=start(tr.advanceTracking(s,now+20*MIN).state);
 assert.equal(resumed.taskId,"a");near(tr.advanceTracking(resumed,resumed.cursor+5*MIN).state.workMs,5*MIN);
});
check("paused and closed apps reset on reopening without uncompleting tasks",()=>{
 const list=[{...tasks[0],completed:true,completedAt:new Date(T).toISOString()},tasks[1],tasks[2]];
 const paused=tr.actOnTracking(start(fresh(list)),{type:"pause"},"owner",T+17*MIN);
 const restored=tr.advanceTracking(tr.parseTracking(JSON.parse(JSON.stringify(paused))),T+3*24*H).state;
 assert.equal(restored.mode,"idle");assert.equal(restored.rotation.turn,null);assert.deepEqual(restored.rotation.totals,{});
 assert.deepEqual(restored.tasks,list);assert.equal(tr.suggestedTask(restored).id,"b");near(tr.turnLeftMs(restored),H);
});
check("DST days preserve exact elapsed work until the correct local midnight",()=>{
 for(const [date,hours]of [["2026-03-08T05:00:00Z",23],["2026-11-01T04:00:00Z",25]]){
  const now=Date.parse(date),s=start(tr.createTracking(tasks,"21:30","America/Toronto",now,PLAN));
  const r=tr.advanceTracking(s,now+hours*H-1000).state;
  near(r.workMs,hours*H-1000);near(Object.values(r.rotation.totals).reduce((a,b)=>a+b,0),r.workMs);
  assert.ok(tr.parseTracking(JSON.parse(JSON.stringify(r))));
  const midnight=tr.advanceTracking(r,now+hours*H).state;near(midnight.workMs,0);assert.equal(midnight.mode,"idle");
  assert.deepEqual(midnight.rotation.totals,{});assert.equal(midnight.rotation.turn,null);
 }
});
check("one-second ticks and a long projection give the same state and events",()=>{
 const initial=start(fresh());let s=initial,events=[];
 for(let i=1;i<=15000;i++){const r=tr.advanceTracking(s,T+i*1000);s=r.state;events.push(...r.events);}
 const direct=tr.advanceTracking(initial,T+15000*1000);assert.deepEqual(s,direct.state);assert.deepEqual(events,direct.events);
});
check("future alerts describe automatic transitions and survive pause/resume",()=>{
 const s=start(fresh()),events=tr.upcomingTrackingEvents(s,T);
 assert.equal(events.length,15);assert.equal(events[0].at,T+H);assert.match(events[0].body,/Now tracking b/);
 assert.deepEqual(events,tr.advanceTracking(s,T+16*H-1).events);
 assert.deepEqual(tr.advanceTracking(s,T+16*H).events,[]);
 const paused=tr.actOnTracking(s,{type:"pause"},"desktop",T+10*MIN);assert.deepEqual(tr.upcomingTrackingEvents(paused,T+11*MIN),[]);
 const resumed=tr.actOnTracking(paused,{type:"start"},"desktop",T+H);
 const later=tr.upcomingTrackingEvents(resumed,T+H);assert.equal(later[0].at,T+110*MIN);assert.notEqual(later[0].id,events[0].id);
});
check("retired work windows never block tracking but midnight ends the day",()=>{
 const s=start(fresh([task("x",10000)],T+15*H)),r=tr.advanceTracking(s,s.cursor+30*MIN).state;
 near(r.rotation.totals.x,30*MIN);assert.equal(r.mode,"work");
 const next=tr.advanceTracking(s,s.cursor+30*H).state;
 assert.deepEqual(next.rotation.totals,{});assert.equal(next.mode,"idle");assert.equal(start(next).taskId,"x");
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
 for(const patch of[{version:4},{commandSeq:-1},{totals:[]},{totals:{a:NaN}},{totals:{a:-1}},{turn:null},{turn:{taskId:"b",elapsedMs:0,durationMs:H}},{turn:{taskId:"a",elapsedMs:H+1,durationMs:H}},{turn:{taskId:"a",elapsedMs:0,durationMs:0}},{turn:{taskId:"a",elapsedMs:0,durationMs:2*H}}])
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
  assert.deepEqual(r.state.rotation.totals,expected.taskMs);assert.equal(r.state.rotation.version,tr.ROTATION_VERSION);assert.equal(r.state.pacing,undefined);
  assert.deepEqual(r.events,[]);assert.deepEqual(s,copy);assert.deepEqual(tr.advanceTracking(r.state,now).state,r.state);
 }
});
check("migration across midnight discards yesterday's progress rather than importing it",()=>{
 let s=paced.createTracking(tasks,"21:30","UTC",T,PLAN);s.workMs=95*MIN;s.taskMs={a:95*MIN};s.pacing.service={a:99999*H};
 const r=tr.advanceTracking(s,T+2*86_400_000).state;near(r.workMs,0);assert.deepEqual(r.rotation.totals,{});assert.equal(r.mode,"idle");
});
check("v2 migration keeps today's time but removes older rotation progress",()=>{
 for(const working of [false,true]){
  const s=oldFractionalTurn();s.rotation.version=2;s.taskMs={b:10*MIN};s.workMs=10*MIN;
  s.rotation.turn={taskId:"b",elapsedMs:s.rotation.totals.b,durationMs:H};
  s.mode=working?"work":"idle";s.taskId=working?"b":null;
  const original=structuredClone(s),r=tr.advanceTracking(s,T+5*MIN);
  assert.deepEqual(s,original);assert.equal(r.state.rotation.version,tr.ROTATION_VERSION);
  assert.deepEqual(r.state.taskMs,{b:(working?15:10)*MIN});assert.deepEqual(r.state.rotation.totals,r.state.taskMs);
  near(r.state.workMs,(working?15:10)*MIN);assert.equal(r.state.mode,s.mode);assert.equal(r.state.controllerId,s.controllerId);
  assert.equal(tr.suggestedTask(r.state).id,"a");assert.deepEqual(r.events,[]);
  assert.deepEqual(tr.advanceTracking(r.state,r.state.cursor).state,r.state);
 }
 const oldDay=oldFractionalTurn();oldDay.rotation.version=2;
 const next=tr.advanceTracking(oldDay,T+24*H).state;
 assert.deepEqual(next.rotation.totals,{});assert.deepEqual(next.taskMs,{});assert.equal(next.mode,"idle");near(tr.turnLeftMs(next),H);
});

console.log("== account synchronization (in-process Postgres) ==");
const pg=new PGlite();
setSql({query:async(text,params=[])=>(await pg.query(text,params)).rows,transaction:async statements=>pg.transaction(async tx=>{for(const s of statements)await tx.query(s.text,s.params??[]);})});
await ensureSchema();
for(const id of["alice","bob","migration","hour-boundary","reordering"])await pg.query("INSERT INTO users(id,username,username_lower,password_hash,created_at) VALUES($1,$1,$1,'test',$2)",[id,new Date(T).toISOString()]);
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
assert.equal(checkpoint.mode,"idle");assert.equal(checkpoint.rotation.version,tr.ROTATION_VERSION);assert.deepEqual(checkpoint.rotation.totals,{});
assert.equal(checkpoint.rotation.turn,null);assert.deepEqual(checkpoint.taskMs,{});assert.equal(checkpoint.workMs,0);
assert.deepEqual(await db.readAccountTracking("migration",T+24*H+MIN),checkpoint);count++;
await assert.rejects(db.commandTracking("migration",active.revision,{type:"start"},"stale","UTC",tasks,"21:30",PLAN,T+24*H+MIN),db.TrackingConflict);count++;
const restarted=await db.commandTracking("migration",checkpoint.revision,{type:"start"},"owner","UTC",tasks,"21:30",PLAN,T+24*H+MIN);
assert.equal(restarted.taskId,"a");count++;
const remaining=tasks.filter(t=>t.id!==restarted.taskId);
await db.configureAccountTracking("migration",remaining,"21:30",PLAN,T+24*H+2*MIN);
const edited=await db.loadTracking("migration");assert.equal(edited.mode,"work");assert.notEqual(edited.taskId,restarted.taskId);assert.equal(edited.controllerId,"owner");count++;
await pg.query("DELETE FROM users WHERE id=$1",["migration"]);assert.equal(await db.loadTracking("migration"),null);count++;
await pg.query("INSERT INTO tracking(user_id,state) VALUES($1,$2)",["hour-boundary",JSON.stringify(oldFractionalTurn())]);
const aligned=await db.readAccountTracking("hour-boundary",T);
assert.equal(aligned.revision,1);assert.equal(aligned.rotation.version,tr.ROTATION_VERSION);near(tr.turnLeftMs(aligned),549608);
assert.equal(aligned.mode,"idle");assert.deepEqual(aligned.rotation.totals,oldFractionalTurn().taskMs);
assert.deepEqual(await db.readAccountTracking("hour-boundary",T+MIN),aligned);count++;
const [webReset,desktopReset]=await Promise.all([
 db.readAccountTracking("hour-boundary",T+24*H),db.readAccountTracking("hour-boundary",T+24*H)
]);
assert.deepEqual(webReset,desktopReset);assert.equal(webReset.revision,aligned.revision+1);
assert.equal(webReset.mode,"idle");assert.equal(webReset.rotation.turn,null);assert.deepEqual(webReset.rotation.totals,{});
assert.deepEqual(webReset.tasks,aligned.tasks);assert.deepEqual(await db.readAccountTracking("hour-boundary",T+24*H+MIN),webReset);count++;
// Saving task array positions is the same account path used by all clients.
const realNow=Date.now;
Date.now=()=>T;
try{
 const sameDate=[task("first"),{...task("second"),createdAt:new Date(T+1000).toISOString()}];
 await saveState("reordering",{...prefs,tasks:sameDate});
 await db.commandTracking("reordering",0,{type:"start"},"desktop","UTC",sameDate,"21:30",PLAN,T);
 const paused=await db.commandTracking("reordering",1,{type:"pause"},"desktop","UTC",sameDate,"21:30",PLAN,T+10*MIN);
 const saved=await loadState("reordering"),moved=moveTaskWithinDueDate(saved.tasks,"second","up");
 Date.now=()=>T+10*MIN;
 await saveState("reordering",{...saved,tasks:moved});
 const fromWeb=await loadState("reordering"),fromPhone=await db.readAccountTracking("reordering");
 assert.deepEqual(fromWeb,{...saved,tasks:moved});assert.deepEqual(fromPhone.tasks,moved);
 assert.deepEqual(fromPhone.taskMs,paused.taskMs);assert.deepEqual(fromPhone.rotation.totals,paused.rotation.totals);
 assert.equal(fromPhone.workMs,paused.workMs);assert.equal(fromPhone.mode,"idle");assert.equal(fromPhone.controllerId,"desktop");
 assert.equal(fromPhone.revision,paused.revision+1);assert.equal(tr.suggestedTask(fromPhone).id,"second");
 const fromWindows=tr.parseTracking(JSON.parse(JSON.stringify(fromPhone)));
 assert.deepEqual(tr.rotationQueue(fromWindows).map(t=>t.id),["second","first"]);
 await assert.rejects(db.commandTracking("reordering",paused.revision,{type:"start"},"stale","UTC",sameDate,"21:30",PLAN,T+10*MIN),db.TrackingConflict);
 assert.equal(await db.loadTracking("bob"),null);count++;
}finally{Date.now=realNow;}
await pg.close();setSql(null);
console.log(count+" rotation and database scenarios passed (including 150 generated histories and 500 migrations)");
