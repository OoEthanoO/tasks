// Logic tests for the parser, weight math, and scheduler.
// Run with `npm test` — that compiles lib/ to .test-build/ first.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseTrailingDate } = require("../.test-build/parse-date.js");
const { taskWeight, buildWeightTable, REST_SHARE } = require("../.test-build/weights.js");
const { toKey, addDays, todayKey } = require("../.test-build/dates.js");
const {
  buildBlockTimes,
  allocateScheduleBlocks,
  generateSchedule,
  scheduleStaleReason,
  staleMessage,
  endOfWorkDay,
  indexTasks,
  resolveBlock,
  needsRegenerateConfirmation,
  nextTickDelay,
  REGENERATE_CONFIRM,
} = require("../.test-build/schedule.js");

let pass = 0,
  fail = 0;
function eq(actual, expected, label) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) pass++;
  else {
    fail++;
    console.log(`  FAIL ${label}\n    expected ${JSON.stringify(expected)}\n    got      ${JSON.stringify(actual)}`);
  }
}

// Wednesday, Aug 12 2026 at 08:32 local.
const NOW = new Date(2026, 7, 12, 8, 32, 0);
const T = (n) => toKey(addDays(NOW, n));

console.log("== date parsing ==");
const cases = [
  ["Buy milk today", "Buy milk", T(0)],
  ["Buy milk tdy", "Buy milk", T(0)],
  ["email prof tomorrow", "email prof", T(1)],
  ["email prof tmr", "email prof", T(1)],
  ["email prof TMR", "email prof", T(1)],
  ["submit form tmrw", "submit form", T(1)],
  ["pay rent yesterday", "pay rent", T(-1)],
  ["pay rent yday", "pay rent", T(-1)],
  // Today IS Wednesday -> next Wednesday, +7.
  ["gym wednesday", "gym", T(7)],
  ["gym wed", "gym", T(7)],
  ["gym thursday", "gym", T(1)],
  ["gym tuesday", "gym", T(6)],
  ["gym next friday", "gym", T(2)],
  ["gym on friday", "gym", T(2)],
  ["standup this monday", "standup", T(5)],
  ["essay aug 28", "essay", "2026-08-28"],
  ["essay august 28", "essay", "2026-08-28"],
  ["essay Aug 28th", "essay", "2026-08-28"],
  ["essay 28 aug", "essay", "2026-08-28"],
  ["essay aug 28 2027", "essay", "2027-08-28"],
  ["essay 8/28", "essay", "2026-08-28"],
  ["essay 8/28/2027", "essay", "2027-08-28"],
  ["essay 2026-09-01", "essay", "2026-09-01"],
  // Every introducing word goes, not just the last one.
  ["taxes due by tomorrow", "taxes", T(1)],
  ["Essay draft by next thursday", "Essay draft", T(1)],
  ["Review notes before friday", "Review notes", T(2)],
  ["hand it in until monday", "hand it in", T(5)],
  ["call mom the day before yesterday", "call mom", T(-2)],
  ["essay due tomorrow", "essay", T(1)],
  ["essay due aug 28", "essay", "2026-08-28"],
  ["finish report in 3 days", "finish report", T(3)],
  ["finish report in 2 weeks", "finish report", T(14)],
  ["rent 5 days ago", "rent", T(-5)],
  ["ship it next week", "ship it", T(7)],
  // "in" is deliberately not a connector: it is a verb particle at least as
  // often as it introduces a date.
  ["Turn in tomorrow", "Turn in", T(1)],
  ["Drop off the form tomorrow", "Drop off the form", T(1)],
  // Phrases people actually type that used to fall through entirely.
  ["Lab due in a week", "Lab", T(7)],
  ["Read it in an hour", "Read it in an hour", null],
  ["Study for SAT this weekend", "Study for SAT", T(3)],
  ["Chores next weekend", "Chores", T(3)],
  ["Dentist appt on the 25th", "Dentist appt", "2026-08-25"],
  ["Rent the 1st", "Rent", "2026-09-01"],
  ["call mom day after tomorrow", "call mom", T(2)],
  ["clean room, tomorrow", "clean room", T(1)],
  ["clean room tomorrow.", "clean room", T(1)],
  // Aug 5 is recent past -> stays this year (overdue task).
  ["late thing aug 5", "late thing", "2026-08-05"],
  // Jan 5 is >90 days back -> rolls to next year.
  ["far thing jan 5", "far thing", "2027-01-05"],
];
for (const [input, title, date] of cases) {
  const r = parseTrailingDate(input, NOW);
  eq([r.title, r.dueDate], [title, date], `"${input}"`);
}

console.log("== non-dates left alone ==");
for (const input of [
  "Read the news",
  "today",           // phrase alone is the name
  "tomorrow",
  "Refactor the parser",
  "Buy 3 apples",
  "Review PR 42",
]) {
  const r = parseTrailingDate(input, NOW);
  eq([r.title, r.dueDate], [input, null], `"${input}"`);
}

console.log("== weights ==");
const today = toKey(NOW);
const mk = (offset, completed = false) => ({
  id: `t${offset}${completed}`,
  title: `t${offset}`,
  description: "",
  dueDate: toKey(addDays(NOW, offset)),
  completed,
  createdAt: "",
  completedAt: null,
});
eq(taskWeight(mk(0), today), 2, "due today -> 2");
eq(taskWeight(mk(1), today), 1, "tomorrow -> 1");
eq(taskWeight(mk(2), today), 1 / 2, "day after -> 1/2");
eq(taskWeight(mk(3), today), 1 / 3, "in 3 days -> 1/3");
eq(taskWeight(mk(7), today), 1 / 7, "7 days out -> 1/7");
eq(taskWeight(mk(-1), today), 3, "yesterday -> 3");
eq(taskWeight(mk(-2), today), 4, "day before yesterday -> 4");
eq(taskWeight(mk(-5), today), 7, "5 days overdue -> 7");
eq(taskWeight(mk(0, true), today), 0, "completed -> 0");

// Priority multiplies the curve: low (the default) ×1, medium ×2, high ×4.
const withPriority = (offset, priority) => ({ ...mk(offset), priority });
eq(taskWeight(withPriority(0, "low"), today), 2, "low leaves the curve alone");
eq(taskWeight(withPriority(0, "medium"), today), 4, "medium doubles: due today 2 -> 4");
eq(taskWeight(withPriority(0, "high"), today), 8, "high quadruples: due today 2 -> 8");
eq(taskWeight(withPriority(3, "medium"), today), 2 / 3, "medium in 3 days -> 2/3");
eq(taskWeight(withPriority(-1, "high"), today), 12, "high and a day overdue -> 12");
eq(
  taskWeight(withPriority(4, "high"), today),
  taskWeight(withPriority(1, "low"), today),
  "high due in 4 days pulls exactly like low due tomorrow",
);
eq(taskWeight({ ...withPriority(0, "high"), completed: true }, today), 0, "completed weighs 0 at any priority");
eq(taskWeight(mk(0), today), 2, "a task saved before priorities existed weighs as low");
eq(taskWeight(withPriority(0, "urgent"), today), 2, "an unknown priority weighs as low");
eq(taskWeight(withPriority(0, "constructor"), today), 2, "a prototype key is not a multiplier");

// Strictly decreasing as the due date moves further out.
let prev = Infinity;
let monotonic = true;
for (let n = -5; n <= 10; n++) {
  const w = taskWeight(mk(n), today);
  if (w >= prev) monotonic = false;
  prev = w;
}
eq(monotonic, true, "weight strictly decreases from overdue through future");

console.log("== absolute Rest share ==");
eq(REST_SHARE, 1 / 4, "rest owns one quarter of a non-empty task pool");

const one = buildWeightTable([mk(0)], today);
eq(one.entries[0].probability.toFixed(4), (3 / 4).toFixed(4), "task = 3/4 = 75%");
eq(one.restProbability.toFixed(4), (1 / 4).toFixed(4), "rest = 1/4 = 25%");

const mixed = buildWeightTable([mk(0), mk(1), mk(-1)], today);
eq(mixed.taskTotal, 2 + 1 + 3, "weights sum");
eq(
  mixed.entries.map((entry) => entry.probability.toFixed(4)),
  [1 / 4, 1 / 8, 3 / 8].map((p) => p.toFixed(4)),
  "tasks split the other three quarters by relative weight",
);

// Rest is an absolute share, so the task pile cannot shrink or expand it.
const shares = [[1], [0], [0, 0], [0, 0, 0]].map(
  (ds) => buildWeightTable(ds.map((d, i) => ({ ...mk(d), id: `s${i}` })), today).restProbability,
);
eq(shares, [1 / 4, 1 / 4, 1 / 4, 1 / 4], "rest stays at one quarter for every task load");

const busy = [mk(0), mk(0), mk(0)].map((t, i) => ({ ...t, id: `b${i}` }));
const beforeDone = buildWeightTable(busy, today).restProbability;
const afterDone = buildWeightTable(
  busy.map((t, i) => (i === 0 ? { ...t, completed: true } : t)),
  today,
).restProbability;
eq(afterDone, beforeDone, "completing one task does not change the rest share");

const empty = buildWeightTable([], today);
eq(empty.restProbability, 1, "no tasks -> only rest");

console.log("== schedule blocks ==");
const blocks = buildBlockTimes(NOW, "23:00");
eq(blocks.length, 1 + 28, "8:32->9:00 stub plus 28 half hours to 23:00");
eq(
  [blocks[0][0].getHours(), blocks[0][0].getMinutes()],
  [8, 32],
  "first block starts now",
);
eq([blocks[0][1].getHours(), blocks[0][1].getMinutes()], [9, 0], "first block ends 9:00");
eq([blocks[1][0].getHours(), blocks[1][0].getMinutes()], [9, 0], "second starts 9:00");
eq([blocks[1][1].getHours(), blocks[1][1].getMinutes()], [9, 30], "second ends 9:30");
const last = blocks[blocks.length - 1];
eq([last[0].getHours(), last[0].getMinutes()], [22, 30], "last starts 22:30");
eq([last[1].getHours(), last[1].getMinutes()], [23, 0], "last ends 23:00");

eq(buildBlockTimes(new Date(2026, 7, 12, 23, 30), "23:00").length, 0, "past end -> no blocks");
eq(buildBlockTimes(new Date(2026, 7, 12, 22, 45), "23:00").length, 1, "22:45 -> single stub");
eq(buildBlockTimes(new Date(2026, 7, 12, 9, 0), "10:00").length, 2, "on boundary -> no sliver");

console.log("== a work day that ends after midnight ==");
// An end time in the small hours means the night starting now, not the one
// that already passed. Read as this morning it put the end before the start,
// so the schedule came back empty and told you to pick a later time — which is
// not a thing you can do when the time you want is midnight.
{
  const at = (h, m) => new Date(2026, 7, 12, h, m);
  const when = (d) => [d.getDate(), d.getHours(), d.getMinutes()];

  eq(when(endOfWorkDay(at(9, 8), "23:00")), [12, 23, 0], "an evening end stays today");
  eq(when(endOfWorkDay(at(9, 8), "00:00")), [13, 0, 0], "midnight means tonight");
  eq(when(endOfWorkDay(at(9, 8), "01:00")), [13, 1, 0], "1 AM means tonight");
  eq(when(endOfWorkDay(at(23, 10), "00:00")), [13, 0, 0], "still tonight late in the evening");

  // Once it is actually the small hours, a small-hours end has really gone by.
  eq(when(endOfWorkDay(at(2, 0), "01:00")), [12, 1, 0], "at 2 AM, a 1 AM end is over");
  eq(when(endOfWorkDay(at(2, 0), "03:00")), [12, 3, 0], "at 2 AM, a 3 AM end is an hour away");

  // A morning end that has passed is a finished day, not a 23-hour one.
  eq(when(endOfWorkDay(at(9, 8), "08:00")), [12, 8, 0], "a passed morning end stays passed");
  eq(when(endOfWorkDay(at(9, 8), "05:00")), [12, 5, 0], "5 AM is a morning, not a small hour");

  // The behaviour that matters: these produce a usable schedule now.
  eq(buildBlockTimes(at(9, 8), "00:00").length, 30, "9:08 AM to midnight -> 30 blocks");
  eq(buildBlockTimes(at(23, 10), "01:00").length, 4, "11:10 PM to 1 AM -> 4 blocks");
  eq(buildBlockTimes(at(2, 0), "01:00").length, 0, "at 2 AM a 1 AM end is still over");
  eq(buildBlockTimes(at(9, 8), "08:00").length, 0, "a finished morning is still finished");

  const overnight = buildBlockTimes(at(23, 10), "01:00");
  eq(when(overnight[overnight.length - 1][1]), [13, 1, 0], "last block lands on tomorrow 1 AM");

  // A schedule running past midnight is still the current plan at 00:30.
  const table = buildWeightTable([mk(0)], today);
  const night = generateSchedule([mk(0)], table, "01:00", at(23, 10));
  eq(
    scheduleStaleReason(night, [mk(0)], "01:00", at(23, 40)),
    null,
    "before midnight -> fresh",
  );
  // It may run past midnight, but it cannot stay valid there: every weight it
  // was drawn from belongs to the previous day.
  eq(
    scheduleStaleReason(night, [mk(0)], "01:00", new Date(2026, 7, 13, 0, 30)),
    "day",
    "half past midnight -> stale, the weights have all moved",
  );
  eq(
    scheduleStaleReason(night, [mk(0)], "01:00", new Date(2026, 7, 13, 1, 0)),
    "elapsed",
    "1 AM -> the plan has also run out",
  );
}

const sched = generateSchedule([mk(0)], one, "23:00", NOW);
eq(sched.blocks.length, 29, "schedule fills the day");
eq(sched.dayKey, today, "schedule stamped with its day");
eq(
  sched.blocks.every((b) => b.taskId === null || b.taskId === mk(0).id),
  true,
  "every block is a real task or rest",
);
eq(
  [sched.blocks.filter((b) => b.taskId === mk(0).id).length, sched.blocks.filter((b) => b.taskId === null).length],
  [22, 7],
  "generation uses the balanced 3/4 work and 1/4 rest allocation",
);

console.log("== balanced schedule allocation ==");
{
  const count = (picks, id) => picks.filter((task) => (task ? task.id : null) === id).length;

  // Rest is fixed at a quarter regardless of how crowded or urgent the list is.
  for (const offsets of [[0], [0, 0], [-5, -1, 0, 1, 20]]) {
    const tasks = offsets.map((offset, i) => ({ ...mk(offset), id: `fixed-${i}` }));
    const picks = allocateScheduleBlocks(buildWeightTable(tasks, today), 30);
    eq(count(picks, null), 8, `${offsets.length} task(s) -> exactly 8 of 30 rests`);
  }

  // Equal weights get equal runtime to within the one indivisible block.
  const equals = [
    { ...mk(0), id: "equal-a" },
    { ...mk(0), id: "equal-b" },
  ];
const equalPicks = allocateScheduleBlocks(buildWeightTable(equals, today), 29);
  const equalCounts = [count(equalPicks, "equal-a"), count(equalPicks, "equal-b")];
  eq(Math.abs(equalCounts[0] - equalCounts[1]) <= 1, true, "equal tasks differ by at most one block");
  eq(count(equalPicks, null), 7, "29 blocks rounds one-quarter rest to 7 blocks");

  const firstGetsExtra = allocateScheduleBlocks(buildWeightTable(equals, today), 7, () => 0.5);
  const secondGetsExtra = allocateScheduleBlocks(buildWeightTable(equals, today), 7, () => 0.4999);
  eq(
    [count(firstGetsExtra, "equal-a"), count(firstGetsExtra, "equal-b"), count(firstGetsExtra, null)],
    [3, 2, 2],
    "the upper half of the tie roll gives the first equal task the extra work block",
  );
  eq(
    [count(secondGetsExtra, "equal-a"), count(secondGetsExtra, "equal-b"), count(secondGetsExtra, null)],
    [2, 3, 2],
    "the lower half gives the second equal task the extra work block",
  );

  // Fisher-Yates has six equally likely branches for three tied tasks. Across
  // those branches every task owns the one-extra outcome twice, and every task
  // is omitted from the two-extra outcome twice.
  const equalThree = [
    { ...mk(0), id: "three-a" },
    { ...mk(0), id: "three-b" },
    { ...mk(0), id: "three-c" },
  ];
  const equalThreeTable = buildWeightTable(equalThree, today);
  const shuffleBranches = [
    [0.9, 0.9], [0.9, 0.1],
    [0.5, 0.9], [0.5, 0.1],
    [0.1, 0.9], [0.1, 0.1],
  ];
  const singleWinners = { "three-a": 0, "three-b": 0, "three-c": 0 };
  const pairOmissions = { "three-a": 0, "three-b": 0, "three-c": 0 };
  for (const branch of shuffleBranches) {
    let rollIndex = 0;
    const oneExtra = allocateScheduleBlocks(equalThreeTable, 6, () => branch[rollIndex++]);
    const winner = equalThree.find((task) => count(oneExtra, task.id) === 2);
    singleWinners[winner.id]++;

    rollIndex = 0;
    const twoExtras = allocateScheduleBlocks(equalThreeTable, 7, () => branch[rollIndex++]);
    const omitted = equalThree.find((task) => count(twoExtras, task.id) === 1);
    pairOmissions[omitted.id]++;
  }
  eq(Object.values(singleWinners), [2, 2, 2], "3n + 1 gives every tied task the same chance at the extra");
  eq(Object.values(pairOmissions), [2, 2, 2], "3n + 2 chooses every pair with the same probability");

  // A 2:1 task-weight ratio is exact when the block count can represent it.
  const doubled = [
    { ...mk(0), id: "double" },
    { ...mk(1), id: "single" },
  ];
  const doubledPicks = allocateScheduleBlocks(buildWeightTable(doubled, today), 27);
  eq(
    [count(doubledPicks, "double"), count(doubledPicks, "single"), count(doubledPicks, null)],
    [13, 7, 7],
    "2:1 task weights become 13:7 blocks while rest keeps its quarter",
  );

  // Smooth round-robin keeps every prefix close to its final target instead of
  // collecting a task's whole quota into one part of the day.
  let seenDouble = 0;
  let seenSingle = 0;
  let seenRest = 0;
  let homogeneous = true;
  for (let i = 0; i < doubledPicks.length; i++) {
    const id = doubledPicks[i]?.id ?? null;
    if (id === "double") seenDouble++;
    else if (id === "single") seenSingle++;
    else seenRest++;
    const elapsed = i + 1;
    if (
      Math.abs(seenDouble - elapsed / 2) > 1 ||
      Math.abs(seenSingle - elapsed / 4) > 1 ||
      Math.abs(seenRest - elapsed / 4) > 1
    ) homogeneous = false;
  }
  eq(homogeneous, true, "every prefix stays within one block of each target share");

  // Rounding is allowed to leave a tiny weight out of a short schedule.
  const tiny = [
    { ...mk(0), id: "large" },
    { ...mk(100), id: "tiny" },
  ];
  const shortPicks = allocateScheduleBlocks(buildWeightTable(tiny, today), 6);
  eq(count(shortPicks, "tiny"), 0, "a tiny share can round down to no blocks");

  const noTasks = allocateScheduleBlocks(buildWeightTable([], today), 8);
  eq(noTasks.every((task) => task === null), true, "without open tasks every block is Rest");
}

console.log("== the clock lands on block boundaries ==");
// The "Now" highlight is only as punctual as the timer behind it. A fixed
// heartbeat started whenever the app opened sits at an arbitrary offset from
// the half hour, so at 9:00 the block that had just begun could still be drawn
// as upcoming for most of an interval. Each wait is measured to the next edge.
{
  // Where a wait started at `at` puts the clock, as [hour, minute, second].
  const lands = (at, schedule) => {
    const t = new Date(at.getTime() + nextTickDelay(at, schedule));
    return [t.getHours(), t.getMinutes(), t.getSeconds()];
  };
  const at = (h, m, s = 0) => new Date(2026, 7, 12, h, m, s);

  // `sched` runs 8:32->9:00, then half hours through to 23:00.
  eq(lands(at(8, 59, 50), sched), [9, 0, 0], "ten seconds out -> wakes at 9:00 exactly");
  eq(lands(at(8, 59, 59), sched), [9, 0, 0], "one second out -> still 9:00, not 20s late");
  eq(lands(at(22, 59, 50), sched), [23, 0, 0], "the last block's end is an edge too");

  // Nothing due soon falls back to the heartbeat that keeps weights honest.
  eq(lands(at(8, 32, 10), sched), [8, 32, 30], "far from an edge -> the 20s cap");
  eq(lands(at(9, 0, 0), sched), [9, 0, 20], "sitting on an edge -> the next one is 30m off");
  eq(lands(at(12, 0, 0), null), [12, 0, 20], "no schedule -> the cap");

  // Midnight moves every weight and makes the schedule stale, so it is an edge
  // in its own right even on a day with no blocks left.
  eq(lands(at(23, 59, 55), null), [0, 0, 0], "the day rolling over is an edge");

  // The property that matters: from anywhere inside the final interval, the
  // wait ends on the boundary — never before it, and never a tick past it.
  const boundary = at(9, 0).getTime();
  let early = 0;
  let late = 0;
  for (let s = 40; s < 60; s++) {
    const from = at(8, 59, s);
    const land = from.getTime() + nextTickDelay(from, sched);
    if (land < boundary) early++;
    if (land >= boundary + 1000) late++;
  }
  eq([early, late], [0, 0], "no wait in the last 20s lands early or overshoots 9:00");
}

console.log("== schedule staleness ==");
const baseTasks = [mk(0), mk(1)];
const baseTable = buildWeightTable(baseTasks, today);
const s = generateSchedule(baseTasks, baseTable, "23:00", NOW);

const staleFor = (schedule, tasks, endTime = "23:00", when = NOW) =>
  scheduleStaleReason(schedule, tasks, endTime, when);

eq(staleFor(s, baseTasks), null, "unchanged -> fresh");
eq(staleFor(null, baseTasks), null, "no schedule -> no warning");
eq(staleFor(s, [...baseTasks, mk(3)]), "tasks", "task added -> stale");
eq(staleFor(s, [baseTasks[0]]), "tasks", "task deleted -> stale");
eq(
  staleFor(s, [baseTasks[0], { ...baseTasks[1], dueDate: T(4) }]),
  "tasks",
  "due date moved -> stale",
);
eq(
  staleFor(s, [baseTasks[0], { ...baseTasks[1], completed: true }]),
  "tasks",
  "task completed -> stale",
);
eq(
  staleFor(s, [baseTasks[0], { ...baseTasks[1], title: "renamed" }]),
  null,
  "rename only -> still fresh (weights unchanged)",
);
eq(staleFor(s, [baseTasks[1], baseTasks[0]]), null, "reordering -> still fresh");
eq(
  staleFor({ ...s, signature: s.signature.replace("balanced-v3|", "balanced-v2|") }, baseTasks),
  "tasks",
  "a schedule from the old one-third allocator is stale after upgrade",
);

// Validity follows the span the schedule covers, not the date it was built on.
eq(staleFor(s, baseTasks, "23:00", new Date(2026, 7, 12, 22, 59)), null, "before the end -> fresh");
eq(
  staleFor(s, baseTasks, "23:00", new Date(2026, 7, 12, 23, 0)),
  "elapsed",
  "the moment the last block ends -> stale",
);
eq(
  staleFor(s, baseTasks, "23:00", addDays(NOW, 1)),
  "elapsed",
  "next day -> stale",
);

// Nothing edited, but the date moved: every weight is measured against today,
// so a schedule drawn yesterday no longer matches what the list is showing.
{
  const openEnded = generateSchedule(baseTasks, baseTable, "23:59", new Date(2026, 7, 12, 23, 50));
  eq(openEnded.blocks.length, 1, "a late schedule still has one block");
  eq(
    scheduleStaleReason(openEnded, baseTasks, "23:59", new Date(2026, 7, 12, 23, 55)),
    null,
    "same evening -> fresh",
  );
  eq(
    scheduleStaleReason(openEnded, baseTasks, "23:59", new Date(2026, 7, 13, 0, 1)),
    "elapsed",
    "running out takes precedence over the date change",
  );
}

// Every weight-bearing edit invalidates, so a task added after generation is
// never left with a zero chance of being scheduled.
eq(staleFor(s, [...baseTasks, mk(5)]), "tasks", "an added task always forces a regenerate");

// The stored end time was previously written and never read.
eq(staleFor(s, baseTasks, "21:00"), "hours", "work day shortened -> stale");
eq(staleFor(s, baseTasks, "23:30"), "hours", "work day extended -> stale");
eq(
  staleFor(s, [...baseTasks, mk(3)], "21:00"),
  "hours",
  "a changed end time outranks a changed task list",
);

// A schedule with no blocks has nothing to run out, so it falls back to the day.
{
  const emptySched = generateSchedule(baseTasks, baseTable, "23:00", new Date(2026, 7, 12, 23, 30));
  eq(emptySched.blocks.length, 0, "generated after the end -> no blocks");
  eq(staleFor(emptySched, baseTasks, "23:00", new Date(2026, 7, 12, 23, 40)), null, "same day -> not yet stale");
  eq(
    staleFor(emptySched, baseTasks, "23:00", addDays(NOW, 1)),
    "day",
    "with no blocks to run out, the date change is what catches it",
  );
  eq(
    staleFor(emptySched, baseTasks, "23:59", new Date(2026, 7, 12, 23, 40)),
    "hours",
    "pushing the end time later prompts a regenerate",
  );
}

// The "hours" reason compares a stored end time against a live one. Both go
// through sanitizeEndTime, which pads "9:00" to "09:00" — if only one side were
// normalized, every loaded schedule would read as stale forever.
{
  const { sanitizeState, sanitizeEndTime } = require("../.test-build/app-state.js");
  const roundTripped = (endTime) => {
    const clean = sanitizeEndTime(endTime);
    const sched = generateSchedule(baseTasks, baseTable, clean, NOW);
    const state = sanitizeState(
      JSON.parse(JSON.stringify({ tasks: baseTasks, schedule: sched, endTime, recommendation: null })),
    );
    return scheduleStaleReason(state.schedule, state.tasks, state.endTime, NOW);
  };
  eq(roundTripped("23:00"), null, "a saved schedule reloads as fresh");
  eq(roundTripped("9:00"), null, "an unpadded end time normalizes on both sides");
  eq(roundTripped("00:00"), null, "a midnight end time reloads as fresh");
}

console.log("== when regenerating is worth asking about ==");
// `s` is the fresh schedule built above from baseTasks at 23:00.
eq(
  needsRegenerateConfirmation(s, staleFor(s, baseTasks)),
  true,
  "a live, accurate schedule is worth stopping for",
);
eq(
  needsRegenerateConfirmation(null, staleFor(null, baseTasks)),
  false,
  "no schedule -> nothing to lose, no question",
);
// Every reason to be stale is a reason to regenerate without being asked.
for (const [label, reason] of [
  ["tasks", staleFor(s, [...baseTasks, mk(3)])],
  ["day", staleFor(s, baseTasks, "23:00", new Date(2026, 7, 13, 8, 0))],
  ["hours", staleFor(s, baseTasks, "21:00")],
]) {
  eq(reason !== null, true, `the ${label} case really is stale`);
  eq(
    needsRegenerateConfirmation(s, reason),
    false,
    `a schedule stale for ${label} regenerates without asking`,
  );
}

// The work-day-already-over case: the panel is already telling you to push the
// end time out and generate again, so it must not argue when you do.
const overTasks = [mk(0)];
const overTable = buildWeightTable(overTasks, today);
const emptySchedule = generateSchedule(
  overTasks,
  overTable,
  "08:00",
  new Date(2026, 7, 12, 9, 0),
);
eq(emptySchedule.blocks.length, 0, "a work day already over yields no blocks");
eq(
  needsRegenerateConfirmation(emptySchedule, null),
  false,
  "an empty schedule holds no picks, so there is nothing to protect",
);

eq(
  [REGENERATE_CONFIRM.confirm, REGENERATE_CONFIRM.cancel],
  ["Regenerate", "Keep it"],
  "both apps offer the same two answers",
);
eq(
  REGENERATE_CONFIRM.title.length > 0 && REGENERATE_CONFIRM.body.length > 0,
  true,
  "the question and its explanation are both worded once",
);

console.log("== one wording for staleness, shared by both apps ==");
for (const reason of ["elapsed", "day", "hours", "tasks"]) {
  const msg = staleMessage(reason);
  eq(typeof msg === "string" && msg.length > 0, true, `${reason} has a message`);
}
eq(
  new Set(["elapsed", "day", "hours", "tasks"].map(staleMessage)).size,
  4,
  "each reason reads differently",
);

console.log("== telling an unconfigured server from a broken one ==");
// Without a database the first query throws a clear "DATABASE_URL is not set"
// into the log, but the browser got a bare 500 rendered as "try again in a
// moment" — advice that never comes true. The routes answer this case
// separately, and they ask here which variables count so the list is not
// written out twice.
{
  const { configuredDatabaseUrl, setSql } = require("../.test-build/sql.js");
  const saved = {
    DATABASE_URL: process.env.DATABASE_URL,
    POSTGRES_URL: process.env.POSTGRES_URL,
  };
  const withEnv = (env) => {
    delete process.env.DATABASE_URL;
    delete process.env.POSTGRES_URL;
    Object.assign(process.env, env);
    return configuredDatabaseUrl();
  };

  eq(withEnv({}), undefined, "no variables -> not configured");
  eq(withEnv({ DATABASE_URL: "postgres://a" }), "postgres://a", "DATABASE_URL counts");
  eq(withEnv({ POSTGRES_URL: "postgres://b" }), "postgres://b", "POSTGRES_URL counts too");
  eq(
    withEnv({ DATABASE_URL: "postgres://a", POSTGRES_URL: "postgres://b" }),
    "postgres://a",
    "DATABASE_URL wins when both are set",
  );

  // An injected driver is a configured database: without this the suite's own
  // PGlite runs would report the server as having no database at all.
  withEnv({});
  setSql({ query: async () => [], transaction: async () => {} });
  eq(configuredDatabaseUrl() !== undefined, true, "an injected driver counts as configured");
  setSql(null);
  eq(configuredDatabaseUrl(), undefined, "and clearing it goes back to the environment");

  delete process.env.DATABASE_URL;
  delete process.env.POSTGRES_URL;
  Object.assign(process.env, JSON.parse(JSON.stringify(saved)));
}

console.log("== how a weight reads ==");
{
  const { formatWeight, weightForDaysOut } = require("../.test-build/weights.js");
  eq(formatWeight(0), "0", "completed reads as 0");
  eq(formatWeight(2), "2", "due today");
  eq(formatWeight(1), "1", "due tomorrow");
  eq(formatWeight(1 / 2), "1/2", "unit fraction");
  eq(formatWeight(1 / 17), "1/17", "small unit fraction");
  eq(formatWeight(2 / 3), "2/3", "medium, due in 3 days");
  eq(formatWeight(4 / 5), "4/5", "high, due in 5 days");
  eq(formatWeight(4 / 3), "4/3", "high, due in 3 days: above 1 but still a fraction");
  eq(formatWeight(2 / 4), "1/2", "reduced to lowest terms");
  eq(formatWeight(12), "12", "high and a day overdue");

  // The comment on formatWeight claims the fraction is exact for everything
  // the curve produces at every priority, rather than a rounded approximation.
  // Walk the curve at each multiplier and check.
  let exact = true;
  const seen = new Set();
  for (const multiplier of [1, 2, 4]) {
    for (let n = -30; n <= 400; n++) {
      const w = multiplier * weightForDaysOut(n);
      const text = formatWeight(w);
      if (multiplier === 1) seen.add(text);
      const [numerator, denominator = "1"] = text.split("/");
      if (Math.abs(Number(numerator) / Number(denominator) - w) > 1e-9) exact = false;
    }
  }
  eq(exact, true, "every weight the curve produces round-trips exactly, at every priority");
  eq(seen.size, 431, "and each low-priority one reads differently");
}

console.log("== the four task buckets, shared by both apps ==");
// This was written out twice, once per app, and covered by nothing. Both lists
// have to agree on what counts as overdue and on the order inside a bucket.
{
  const { groupTasks } = require("../.test-build/grouping.js");
  const task = (id, offset, extra = {}) => ({
    task: {
      id,
      title: id,
      description: "",
      dueDate: T(offset),
      completed: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      completedAt: null,
      ...extra,
    },
    weight: 1,
    probability: 0.1,
  });
  const shape = (gs) => gs.map((g) => [g.key, g.items.map((i) => i.task.id)]);

  const { dueBucket } = require("../.test-build/grouping.js");
  const bare = (offset, extra = {}) => task("x", offset, extra).task;
  eq(dueBucket(bare(-1), today), "overdue", "yesterday -> overdue");
  eq(dueBucket(bare(0), today), "today", "today -> today");
  eq(dueBucket(bare(1), today), "upcoming", "tomorrow -> upcoming");
  eq(dueBucket(bare(-3, { completed: true }), today), "done", "completed wins over overdue");

  // The bucket a task is filed under and the colour beside its date come from
  // this one call, so a task can never be listed under one and coloured another.
  for (const offset of [-5, -1, 0, 1, 9]) {
    const entry = task(`k${offset}`, offset);
    const groups = groupTasks([entry], today);
    eq(
      groups[0].key,
      dueBucket(entry.task, today),
      `group key matches dueBucket at ${offset}`,
    );
  }

  eq(groupTasks([], today), [], "no tasks -> no groups");

  eq(
    shape(groupTasks([task("future", 3), task("late", -2), task("now", 0)], today)),
    [["overdue", ["late"]], ["today", ["now"]], ["upcoming", ["future"]]],
    "buckets by due date, in display order",
  );

  eq(
    groupTasks([task("late", -2)], today)[0].tone,
    "overdue",
    "only the overdue bucket is toned",
  );
  eq(
    groupTasks([task("now", 0)], today)[0].tone,
    undefined,
    "today carries no tone",
  );

  // A finished task is done wherever its due date falls.
  eq(
    shape(groupTasks([task("d", -5, { completed: true, completedAt: "2026-08-12T09:00:00.000Z" })], today)),
    [["done", ["d"]]],
    "a completed overdue task files as done, not overdue",
  );

  // Nearest first, ties broken by creation order so the list never reshuffles.
  eq(
    shape(groupTasks([task("c", 5), task("a", 1), task("b", 3)], today))[0][1],
    ["a", "b", "c"],
    "upcoming runs nearest-first",
  );
  eq(
    shape(
      groupTasks(
        [
          task("second", 2, { createdAt: "2026-02-01T00:00:00.000Z" }),
          task("first", 2, { createdAt: "2026-01-01T00:00:00.000Z" }),
        ],
        today,
      ),
    )[0][1],
    ["first", "second"],
    "same due date -> oldest first",
  );
  eq(
    shape(groupTasks([task("older", -1), task("oldest", -9)], today))[0][1],
    ["oldest", "older"],
    "overdue runs most-overdue first",
  );

  // Completed asks the opposite question: what did I just finish?
  const done = (id, at) =>
    task(id, -1, { completed: true, completedAt: at });
  eq(
    shape(groupTasks([done("early", "2026-08-12T08:00:00.000Z"), done("late", "2026-08-12T20:00:00.000Z")], today))[0][1],
    ["late", "early"],
    "completed runs most-recently-finished first",
  );
  eq(
    shape(groupTasks([done("dated", "2026-08-12T08:00:00.000Z"), done("undated", null)], today))[0][1],
    ["dated", "undated"],
    "a missing completedAt sorts last rather than throwing",
  );

  // Empty buckets never render as bare headings.
  eq(
    groupTasks([task("only", 4)], today).map((g) => g.key),
    ["upcoming"],
    "empty buckets are dropped",
  );
}

console.log("== blocks resolve against the live task list ==");
// Titles are snapshotted when a schedule is generated. A rename does not make
// the schedule stale (the weights are identical), so the block has to read the
// current title or it would show the old name for the rest of the day.
{
  const task = { ...mk(0), id: "keep", title: "Chem HW" };
  const block = { start: "", end: "", taskId: "keep", title: "Chem HW" };

  eq(
    resolveBlock(block, indexTasks([task])).title,
    "Chem HW",
    "unchanged task -> snapshot title",
  );
  eq(
    resolveBlock(block, indexTasks([{ ...task, title: "Chemistry problem set 4" }])).title,
    "Chemistry problem set 4",
    "renamed task -> live title, not the snapshot",
  );
  eq(
    resolveBlock(block, indexTasks([task])).isMissing,
    false,
    "task still present -> not missing",
  );

  // Deleted is the one case the snapshot is still the best answer.
  const orphan = resolveBlock(block, indexTasks([]));
  eq(orphan.title, "Chem HW", "deleted task -> falls back to the snapshot");
  eq(orphan.isMissing, true, "deleted task -> flagged missing");

  const restBlock = { start: "", end: "", taskId: null, title: "Rest" };
  const rest = resolveBlock(restBlock, indexTasks([task]));
  eq([rest.title, rest.isRest, rest.isMissing], ["Rest", true, false], "rest block");

  // A title that collides with a real task id must not confuse the lookup.
  eq(
    resolveBlock({ ...block, taskId: "gone" }, indexTasks([task])).isMissing,
    true,
    "unknown id -> missing even when other tasks exist",
  );
}

console.log("== completed tasks are never scheduled ==");
const doneOnly = buildWeightTable([mk(0, true), mk(-3, true)], today);
eq(doneOnly.taskTotal, 0, "all completed -> zero task weight");
eq(
  allocateScheduleBlocks(doneOnly, 500).every((task) => task === null),
  true,
  "500 scheduled blocks all become Rest",
);

console.log("== theme preference, shared by both apps ==");
const {
  THEME_PREFERENCES,
  sanitizeThemePreference,
  resolveColorScheme,
  nextThemePreference,
  themePreferenceLabel,
} = require("../.test-build/theme.js");

eq(sanitizeThemePreference("light"), "light", "an explicit light choice survives");
eq(sanitizeThemePreference("dark"), "dark", "an explicit dark choice survives");
eq(sanitizeThemePreference("system"), "system", "following the system survives");
// Storage that is empty, blocked, or written by an older build.
eq(sanitizeThemePreference(null), "system", "nothing stored -> follow the system");
eq(sanitizeThemePreference(""), "system", "an empty value -> follow the system");
eq(sanitizeThemePreference("Dark"), "system", "the wrong case is not a choice");
eq(sanitizeThemePreference("sepia"), "system", "an unknown scheme -> follow the system");
eq(sanitizeThemePreference(7), "system", "a non-string -> follow the system");

// A pinned choice ignores the system entirely, in both directions.
eq(resolveColorScheme("light", "dark"), "light", "light pinned over a dark system");
eq(resolveColorScheme("dark", "light"), "dark", "dark pinned over a light system");
eq(resolveColorScheme("light", null), "light", "a pinned choice needs no system");
eq(resolveColorScheme("system", "light"), "light", "following a light system");
eq(resolveColorScheme("system", "dark"), "dark", "following a dark system");
// The app was dark long before it was anything else: an unreadable system
// setting stays dark rather than flashing light at someone who never asked.
eq(resolveColorScheme("system", null), "dark", "an unknown system stays dark");

// The phone's control cycles in place, so the order has to close the loop.
eq(THEME_PREFERENCES, ["system", "light", "dark"], "three states, in control order");
eq(nextThemePreference("system"), "light", "system steps to light");
eq(nextThemePreference("light"), "dark", "light steps to dark");
eq(nextThemePreference("dark"), "system", "dark wraps back to system");
let cycled = "system";
for (let i = 0; i < THEME_PREFERENCES.length; i++) cycled = nextThemePreference(cycled);
eq(cycled, "system", "a full cycle returns to where it started");

eq(
  THEME_PREFERENCES.map(themePreferenceLabel),
  ["System", "Light", "Dark"],
  "every state has a label",
);

console.log("== plain Rest and legacy schedules ==");
{
  const { REST_LABEL } = require("../.test-build/weights.js");
  const { sanitizeState, sanitizeSchedule } = require("../.test-build/app-state.js");
  const tasks = [{ ...mk(0), title: "Code" }];
  const generated = generateSchedule(tasks, buildWeightTable(tasks, today), "23:00", NOW);
  const rests = generated.blocks.filter((block) => block.taskId === null);
  eq(rests.length, 7, "plain Rest keeps the current one-quarter allocation");
  eq(rests.every((block) => block.title === REST_LABEL), true, "all generated breaks are plain Rest");

  const legacySchedule = {
    ...generated,
    blocks: generated.blocks.map((block, i) =>
      block.taskId === null ? { ...block, title: i % 2 ? "Code" : "Game" } : block),
  };
  const legacyState = {
    tasks,
    recommendation: null,
    schedule: legacySchedule,
    endTime: "23:00",
    restMode: { advanced: true, types: ["Code", "Game"] },
  };
  const migrated = sanitizeState(legacyState, NOW);
  eq(migrated.schedule, generated, "loading old named breaks preserves the plan and normalizes labels");
  eq("restMode" in migrated, false, "retired preferences are ignored in older payloads");
  eq(sanitizeSchedule(migrated.schedule), migrated.schedule, "normalizing again is idempotent");
  eq(scheduleStaleReason(migrated.schedule, tasks, "23:00", NOW), null, "removing kinds does not invalidate an otherwise current plan");
  const byId = indexTasks(tasks);
  eq(
    legacySchedule.blocks.filter((block) => block.taskId === null)
      .every((block) => resolveBlock(block, byId).title === REST_LABEL),
    true,
    "legacy blocks also render as Rest before normalization",
  );
  const taskBlock = legacySchedule.blocks.find((block) => block.taskId !== null);
  eq(resolveBlock(taskBlock, byId).title, "Code", "a real task named Code keeps its title");

  // The web guest store bypasses sanitizeState, so exercise that load path too.
  const { localStore } = require("../.test-build/storage.js");
  const savedWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const values = new Map([
    ["yantasks.tasks.v1", JSON.stringify(tasks)],
    ["yantasks.schedule.v1", JSON.stringify(legacySchedule)],
    ["yantasks.endTime.v1", JSON.stringify("23:00")],
    ["yantasks.restMode.v1", JSON.stringify(legacyState.restMode)],
  ]);
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
  } });
  try {
    const loaded = localStore.load();
    eq(loaded.schedule, generated, "the web guest store loads old schedules as plain Rest");
    eq("restMode" in loaded, false, "the web guest store ignores the retired preference key");
    localStore.save(loaded);
    eq(JSON.parse(values.get("yantasks.schedule.v1")), generated, "saving preserves the normalized schedule");
    localStore.clear();
    eq(values.size, 0, "migration cleanup still clears the legacy guest preference");
  } finally {
    if (savedWindow) Object.defineProperty(globalThis, "window", savedWindow);
    else delete globalThis.window;
  }
}

console.log("== credential rules ==");
const { validateUsername, validatePassword, normalizeUsername } = require("../.test-build/auth-rules.js");

eq(validateUsername("yan"), null, "3 chars is allowed");
eq(validateUsername("yan.xu_1-a"), null, "dot, underscore and dash are allowed");
eq(typeof validateUsername("ab"), "string", "2 chars is rejected");
eq(typeof validateUsername("x".repeat(33)), "string", "33 chars is rejected");
eq(typeof validateUsername("yan xu"), "string", "spaces are rejected");
eq(typeof validateUsername("yan@example.com"), "string", "@ is rejected");
eq(validateUsername("  yan  "), null, "surrounding space is trimmed before checking");
eq(validatePassword("12345678"), null, "8 chars is allowed");
eq(typeof validatePassword("1234567"), "string", "7 chars is rejected");
eq(normalizeUsername("  YanXu "), "yanxu", "lookup name is trimmed and lowercased");

console.log("== password hashing ==");
const { hashPassword, verifyPassword, hashToken, newToken } = require("../.test-build/auth.js");

const stored = hashPassword("correct horse battery");
eq(stored.startsWith("scrypt$16384$8$1$"), true, "hash records its own parameters");
eq(stored.includes("correct horse battery"), false, "hash does not contain the password");
eq(verifyPassword("correct horse battery", stored), true, "right password verifies");
eq(verifyPassword("correct horse batter", stored), false, "wrong password fails");
eq(verifyPassword("", stored), false, "empty password fails");
eq(hashPassword("same") === hashPassword("same"), false, "salted: same password, different hash");
eq(verifyPassword("x", "not-a-hash"), false, "malformed record fails instead of throwing");
eq(verifyPassword("x", "scrypt$a$b$c$d$e"), false, "non-numeric parameters fail");
eq(hashToken("abc") === hashToken("abc"), true, "token digest is stable");
eq(hashToken("abc") === hashToken("abd"), false, "token digest is sensitive");
eq(newToken() === newToken(), false, "tokens are unique");

console.log("== untrusted state is sanitized ==");
const {
  sanitizeState,
  sanitizeEndTime,
  isEmptyState,
  shouldOfferMigration,
  summarizeState,
  emptyState,
  tasksWithoutPriority,
  hasRestSettings,
} = require("../.test-build/app-state.js");
const { sanitizeRestSettings, DEFAULT_REST } = require("../.test-build/rest.js");

eq(sanitizeRestSettings(null), DEFAULT_REST, "missing rest settings are the 90/30 default");
eq(sanitizeRestSettings({ enabled: false, workMinutes: 25, restMinutes: 5 }), { enabled: false, workMinutes: 25, restMinutes: 5 }, "valid settings survive, breaks off included");
eq(sanitizeRestSettings({ enabled: true, workMinutes: 3, restMinutes: 500 }), { enabled: true, workMinutes: 10, restMinutes: 120 }, "lengths are clamped to range");
eq(sanitizeRestSettings({ enabled: "yes", workMinutes: 52.6, restMinutes: "17" }), { enabled: true, workMinutes: 53, restMinutes: 30 }, "whole minutes; a non-number falls back");
eq(sanitizeState({ tasks: [] }).rest, DEFAULT_REST, "a state without rest settings gets the default");
eq([hasRestSettings({ rest: {} }), hasRestSettings({ tasks: [] }), hasRestSettings(null)], [true, false, false], "only a payload with a rest field marks a current client");

eq(sanitizeState(null), emptyState(), "null becomes an empty state");
eq(sanitizeState("nope"), emptyState(), "a string becomes an empty state");
eq(sanitizeState({ tasks: "not an array" }).tasks, [], "a non-array task list is dropped");

// A due date that is only digit-shaped is more dangerous than one that is
// obviously junk: an overdue task's weight grows with the day count, so a date
// JS silently rolls over produces a weight that swamps every real task.
{
  const withDue = (dueDate) =>
    sanitizeState({
      tasks: [{ id: "t", title: "task", dueDate }],
    }).tasks[0].dueDate;

  const todayIs = todayKey();
  eq(withDue("0000-01-01"), todayIs, "year 0 (JS reads it as 1900) is rejected");
  eq(withDue("0050-06-01"), todayIs, "a two-digit year is rejected");
  eq(withDue("2026-02-30"), todayIs, "Feb 30 does not roll into March");
  eq(withDue("2026-13-01"), todayIs, "month 13 is rejected");
  eq(withDue("2026-00-10"), todayIs, "month 0 is rejected");
  eq(withDue("2026-00-00"), todayIs, "all-zero month and day is rejected");
  eq(withDue("2026-04-31"), todayIs, "April 31 is rejected");
  eq(withDue("2027-02-29"), todayIs, "Feb 29 in a common year is rejected");
  eq(withDue("not-a-date"), todayIs, "unshaped junk still falls back");

  // Real dates, including the awkward ones, must survive untouched.
  eq(withDue("2028-02-29"), "2028-02-29", "Feb 29 in a leap year is kept");
  eq(withDue("2026-12-31"), "2026-12-31", "end of year is kept");
  eq(withDue("1970-01-01"), "1970-01-01", "a genuinely ancient overdue date is kept");
  eq(withDue(T(3)), T(3), "an ordinary date is kept");

  // The point of the guard: no single task can hijack every draw.
  const hijacked = buildWeightTable(
    sanitizeState({
      tasks: [
        { id: "bad", title: "bad", dueDate: "0000-01-01" },
        { id: "real", title: "real", dueDate: todayIs },
      ],
    }).tasks,
    todayIs,
  );
  eq(
    hijacked.entries.every((e) => e.probability < 0.9),
    true,
    "a malformed due date can no longer take ~100% of the draw",
  );
}

const goodTask = {
  id: "t1",
  title: "Write it up",
  description: "notes",
  dueDate: T(1),
  priority: "low",
  completed: false,
  createdAt: "2026-08-12T00:00:00.000Z",
  completedAt: null,
};
eq(sanitizeState({ tasks: [goodTask] }).tasks, [goodTask], "a well-formed task survives intact");
eq(sanitizeState({ tasks: [{ title: "no id" }] }).tasks, [], "a task without an id is dropped");
eq(
  sanitizeState({ tasks: [{ id: "t", title: "x" }] }).tasks[0].priority,
  "low",
  "a task saved before priorities existed defaults to low",
);
eq(
  sanitizeState({ tasks: [{ id: "t", title: "x", priority: "urgent" }] }).tasks[0].priority,
  "low",
  "an unknown priority falls back to low",
);
eq(
  sanitizeState({ tasks: [{ ...goodTask, priority: "high" }] }).tasks[0].priority,
  "high",
  "a chosen priority survives",
);
eq(
  [...tasksWithoutPriority({ tasks: [{ id: "old" }, { id: "new", priority: "low" }, "junk", { id: 5 }] })],
  ["old"],
  "only a task with no priority field at all marks an older client",
);
eq([...tasksWithoutPriority(null)], [], "a malformed payload marks nothing");
eq(sanitizeState({ tasks: [{ id: "t", title: "   " }] }).tasks, [], "a blank title is dropped");
eq(
  sanitizeState({ tasks: [goodTask, { ...goodTask, title: "dupe" }] }).tasks.length,
  1,
  "duplicate ids are collapsed (they are the primary key)",
);
eq(
  sanitizeState({ tasks: [{ id: "t", title: "x", dueDate: "not-a-date" }] }).tasks[0].dueDate,
  toKey(new Date()),
  "an unparseable due date falls back to today",
);
eq(
  sanitizeState({ tasks: [{ id: "t", title: "x", completed: "yes" }] }).tasks[0].completed,
  false,
  "only a real boolean marks a task complete",
);
eq(
  sanitizeState({ tasks: [{ id: "t", title: "x", completed: true, completedAt: "junk" }] })
    .tasks[0].completedAt !== null,
  true,
  "a completed task always gets a completion timestamp",
);
eq(
  sanitizeState({ tasks: [{ id: "t", title: "x", completed: false, completedAt: "2026-01-01T00:00:00.000Z" }] })
    .tasks[0].completedAt,
  null,
  "an open task never keeps a completion timestamp",
);
eq(
  sanitizeState({ tasks: [{ id: "t", title: "y".repeat(900) }] }).tasks[0].title.length,
  500,
  "an oversized title is clipped",
);
eq(
  sanitizeState({ tasks: Array.from({ length: 2500 }, (_, i) => ({ id: `t${i}`, title: "x" })) })
    .tasks.length,
  2000,
  "the task list is capped",
);

// A NUL byte rides in on pasted text and a Postgres TEXT column refuses it, so
// one of these anywhere in the state used to fail the entire save.
const scrubbed = sanitizeState({
  tasks: [{ id: "t\u00001", title: "Tutor\u0000ing", description: "pas\u0000ted" }],
}).tasks[0];
eq(scrubbed.id, "t1", "a NUL is stripped from an id");
eq(scrubbed.title, "Tutoring", "and from a title");
eq(scrubbed.description, "pasted", "and from a description");
eq(
  sanitizeState({ tasks: [{ id: "t", title: "\u0000" }] }).tasks,
  [],
  "a title that was only a NUL is left blank, and a blank title drops the task",
);

// Clipping counts UTF-16 units, so the cut can land between the two halves of
// an emoji. The leftover half is not encodable as UTF-8 at all.
const clipped = sanitizeState({
  tasks: [{ id: "t", title: `${"y".repeat(499)}🎯` }],
}).tasks[0].title;
eq(clipped.length, 499, "clipping never leaves half an emoji behind");
eq(/\p{Cs}/u.test(clipped), false, "nothing unpaired survives");
eq(
  sanitizeState({ tasks: [{ id: "t", title: "keep 🎯 whole" }] }).tasks[0].title,
  "keep 🎯 whole",
  "an emoji that fits is left alone",
);

eq(sanitizeEndTime("9:05"), "09:05", "a short time is zero-padded");
eq(sanitizeEndTime("23:00"), "23:00", "a valid time is kept");
eq(sanitizeEndTime("24:00"), "23:00", "an out-of-range hour falls back");
eq(sanitizeEndTime("23:71"), "23:00", "an out-of-range minute falls back");
eq(sanitizeEndTime(17), "23:00", "a non-string falls back");

eq(sanitizeState({ recommendation: { taskId: "t", title: "" } }).recommendation, null, "a titleless recommendation is dropped");
eq(sanitizeState({ schedule: { blocks: "nope" } }).schedule, null, "a schedule without blocks is dropped");
eq(
  sanitizeState({ schedule: { blocks: [{ start: "bad", end: "bad" }] } }).schedule.blocks,
  [],
  "unparseable blocks are dropped, the schedule survives",
);

console.log("== taking the server's copy ==");
const { shouldAdoptRemote } = require("../.test-build/sync.js");
const base = { hasPendingWrite: false, saveInFlight: false, local: "A", remote: "B" };

eq(shouldAdoptRemote(base), true, "a differing server copy is adopted");
eq(
  shouldAdoptRemote({ ...base, remote: "A" }),
  false,
  "an identical copy is not, so nothing re-renders",
);
// The whole point of the guard: an edit that has not reached the server yet is
// newer than anything the server can return, and must not be overwritten.
eq(
  shouldAdoptRemote({ ...base, hasPendingWrite: true }),
  false,
  "a queued local edit blocks adoption",
);
eq(
  shouldAdoptRemote({ ...base, saveInFlight: true }),
  false,
  "so does a save already on the wire",
);
eq(
  shouldAdoptRemote({ ...base, hasPendingWrite: true, remote: "A" }),
  false,
  "and a pending write still blocks it when the copies match",
);

console.log("== describing what a migration would move ==");
eq(isEmptyState(emptyState()), true, "a fresh state is empty");
eq(isEmptyState({ ...emptyState(), tasks: [goodTask] }), false, "one task is not empty");
eq(
  isEmptyState({ ...emptyState(), endTime: "18:00" }),
  true,
  "an end time alone is not worth migrating",
);
eq(summarizeState(emptyState()), "nothing", "nothing to move");
eq(summarizeState({ ...emptyState(), tasks: [goodTask] }), "1 task", "singular");
eq(summarizeState({ ...emptyState(), tasks: [goodTask, goodTask] }), "2 tasks", "plural");
eq(
  summarizeState({ ...emptyState(), tasks: [goodTask], schedule: { blocks: [] } }),
  "1 task and a saved schedule",
  "two things are joined with 'and'",
);
eq(
  summarizeState({
    ...emptyState(),
    tasks: [goodTask],
    schedule: { blocks: [] },
    recommendation: { taskId: null, title: "Rest" },
  }),
  "1 task and a saved schedule",
  "a stored recommendation is not something a person would miss",
);
eq(
  isEmptyState({
    ...emptyState(),
    recommendation: { taskId: "t1", title: "Write it up" },
  }),
  true,
  "a lone recommendation does not make a state non-empty",
);

console.log("== when to offer a migration ==");
const withTask = { ...emptyState(), tasks: [goodTask] };
const withSchedule = {
  ...emptyState(),
  schedule: { blocks: [], generatedAt: "2026-08-12T08:00:00.000Z", dayKey: T(0), signature: "s", endTime: "23:00" },
};
const withRec = {
  ...emptyState(),
  recommendation: { taskId: "t1", title: "Write it up", generatedAt: "2026-08-12T08:00:00.000Z" },
};

eq(shouldOfferMigration(emptyState(), withTask), true, "empty account + local tasks asks");
eq(shouldOfferMigration(emptyState(), withSchedule), true, "a lone saved schedule is worth asking about");
// Nothing can create or clear a recommendation since the Up next card was
// removed, so treating one as data left anybody who drew one before then with
// an account that never read as empty — and no offer to move their real tasks.
eq(
  shouldOfferMigration(emptyState(), withRec),
  false,
  "a lone recommendation is not worth a prompt",
);
eq(
  shouldOfferMigration(withRec, withTask),
  true,
  "an account holding only a leftover recommendation still counts as empty",
);
eq(
  shouldOfferMigration(withRec, withSchedule),
  true,
  "...and a device schedule is still offered against it",
);
eq(shouldOfferMigration(emptyState(), emptyState()), false, "nothing on either side asks nothing");
eq(shouldOfferMigration(withTask, withTask), false, "an account with tasks is never overwritten");
eq(shouldOfferMigration(withTask, emptyState()), false, "a full account and an empty device asks nothing");
eq(shouldOfferMigration(withSchedule, withTask), false, "a schedule alone still counts as a used account");

// End time is a preference, not data: an account that only differs there is
// still untouched, and a device that only differs there has nothing to move.
eq(
  shouldOfferMigration({ ...emptyState(), endTime: "22:00" }, withTask),
  true,
  "a customized end time does not make an account non-empty",
);
eq(
  shouldOfferMigration(emptyState(), { ...emptyState(), endTime: "22:00" }),
  false,
  "and does not make a device copy worth migrating",
);

console.log("== accounts and migration round-trip (in-process postgres) ==");
// The data layer is pointed at PGlite — real Postgres, in this process — so the
// SQL that ships to Neon is the SQL under test here.
const { PGlite } = await import("@electric-sql/pglite");
const pg = await PGlite.create();

const { setSql } = require("../.test-build/sql.js");
setSql({
  query: async (text, params = []) => (await pg.query(text, params)).rows,
  transaction: async (statements) => {
    await pg.exec("BEGIN");
    try {
      for (const s of statements) await pg.query(s.text, s.params ?? []);
      await pg.exec("COMMIT");
    } catch (error) {
      await pg.exec("ROLLBACK");
      throw error;
    }
  },
});

const db = require("../.test-build/db.js");

const alice = await db.createUser({
  id: "u-alice",
  username: "Alice",
  usernameLower: "alice",
  passwordHash: hashPassword("hunter2hunter2"),
});
eq(alice.username, "Alice", "typed casing is preserved");
eq(await db.usernameTaken("alice"), true, "the name is taken");
eq(await db.usernameTaken("ALICE".toLowerCase()), true, "lookup is case-insensitive");
eq(await db.usernameTaken("bob"), false, "an unrelated name is free");
eq((await db.loadState(alice.id)).tasks, [], "a new account starts empty");
eq((await db.loadState(alice.id)).endTime, "23:00", "a new account gets the default end time");

const found = await db.findUserByUsername("alice");
eq(found.id, alice.id, "the user is found by lowercase name");
eq(verifyPassword("hunter2hunter2", found.passwordHash), true, "the stored hash verifies");
eq(await db.findUserByUsername("nobody"), null, "an unknown name returns null");

// The unique index, not the pre-check, is what settles a concurrent signup.
let duplicate = null;
try {
  await db.createUser({
    id: "u-other",
    username: "ALICE",
    usernameLower: "alice",
    passwordHash: hashPassword("whatever12345"),
  });
} catch (error) {
  duplicate = error;
}
eq(duplicate !== null, true, "a duplicate username is rejected by the database");
eq(db.isUniqueViolation(duplicate), true, "and is recognized as a unique violation");
eq(db.isUniqueViolation(new Error("boom")), false, "an unrelated error is not");
eq(await db.findUserByUsername("alice").then((u) => u.id), alice.id, "the original user survives the failed race");

// This is the migration itself: the guest payload written under a new account.
const guestState = {
  tasks: [goodTask, { ...goodTask, id: "t2", title: "Second", completed: true, completedAt: "2026-08-12T09:00:00.000Z" }],
  recommendation: { taskId: "t1", title: "Write it up", generatedAt: "2026-08-12T08:00:00.000Z" },
  schedule: {
    blocks: [{ start: "2026-08-12T08:32:00.000Z", end: "2026-08-12T09:00:00.000Z", taskId: "t1", title: "Write it up" }],
    generatedAt: "2026-08-12T08:32:00.000Z",
    dayKey: T(0),
    signature: "sig",
    endTime: "22:00",
  },
  endTime: "22:00",
};
await db.saveState(alice.id, guestState);
const restored = await db.loadState(alice.id);
eq(restored.tasks.map((t) => t.id), ["t1", "t2"], "task order is preserved");
eq(restored.tasks[0], goodTask, "a migrated task round-trips unchanged");
eq(restored.tasks[1].completed, true, "completion survives the round-trip");
eq(restored.recommendation, guestState.recommendation, "the recommendation round-trips");
eq(restored.schedule.blocks, guestState.schedule.blocks, "schedule blocks round-trip");
eq(restored.endTime, "22:00", "the end time round-trips");

// Priorities round-trip, and a client built before they existed cannot wipe
// them: its whole-state save carries no priority field at all.
{
  const carol = await db.createUser({
    id: "u-carol",
    username: "Carol",
    usernameLower: "carol",
    passwordHash: hashPassword("carolcarol12"),
  });
  const chosen = [
    { ...goodTask, id: "c1", priority: "high" },
    { ...goodTask, id: "c2", priority: "medium" },
  ];
  await db.saveState(carol.id, { ...emptyState(), tasks: chosen });
  eq((await db.loadState(carol.id)).tasks.map((t) => t.priority), ["high", "medium"], "priorities round-trip");

  const withoutPriority = ({ priority, ...rest }) => rest;
  const oldClient = [
    { ...withoutPriority(chosen[0]), title: "Renamed on an old phone" },
    withoutPriority(chosen[1]),
    withoutPriority({ ...goodTask, id: "c3", title: "Added on an old phone" }),
  ];
  await db.saveState(carol.id, { ...emptyState(), tasks: oldClient }, { priority: tasksWithoutPriority({ tasks: oldClient }) });
  const afterOld = (await db.loadState(carol.id)).tasks;
  eq(afterOld.map((t) => t.priority), ["high", "medium", "low"], "an old client's save keeps stored priorities; its new task is low");
  eq(afterOld[0].title, "Renamed on an old phone", "while its other edits still apply");

  const lowered = [{ ...chosen[0], priority: "low" }, withoutPriority(chosen[1])];
  await db.saveState(carol.id, { ...emptyState(), tasks: lowered }, { priority: tasksWithoutPriority({ tasks: lowered }) });
  eq(
    (await db.loadState(carol.id)).tasks.map((t) => t.priority),
    ["low", "medium"],
    "an explicit low still lowers a task; only a missing field is preserved",
  );
  await db.deleteUser(carol.id);
}

// Rest settings round-trip, and a client built before them cannot reset them.
{
  const dana = await db.createUser({
    id: "u-dana",
    username: "Dana",
    usernameLower: "dana",
    passwordHash: hashPassword("danadana1234"),
  });
  eq((await db.loadState(dana.id)).rest, DEFAULT_REST, "a new account starts with 90/30 breaks");
  const pomodoro = { enabled: true, workMinutes: 25, restMinutes: 5 };
  await db.saveState(dana.id, { ...emptyState(), rest: pomodoro });
  eq((await db.loadState(dana.id)).rest, pomodoro, "rest settings round-trip");
  const oldClient = { tasks: [goodTask], recommendation: null, schedule: null, endTime: "22:00" };
  await db.saveState(dana.id, sanitizeState(oldClient), { rest: !hasRestSettings(oldClient) });
  const afterOld = await db.loadState(dana.id);
  eq(afterOld.rest, pomodoro, "an old client's save keeps the stored rest settings");
  eq(afterOld.endTime, "22:00", "while its other edits still apply");
  await db.saveState(dana.id, { ...emptyState(), rest: { ...DEFAULT_REST, enabled: false } });
  eq((await db.loadState(dana.id)).rest.enabled, false, "a current client can turn breaks off");
  await db.deleteUser(dana.id);
}
// Simulate a prefs row written before the feature was removed. Existing
// schedules load with plain Rest; the retired column can stay in the database.
const legacyDbSchedule = {
  ...guestState.schedule,
  blocks: [
    ...guestState.schedule.blocks,
    { start: "2026-08-12T09:00:00.000Z", end: "2026-08-12T09:30:00.000Z", taskId: null, title: "Game" },
  ],
};
const normalizedDbSchedule = {
  ...legacyDbSchedule,
  blocks: legacyDbSchedule.blocks.map((block) =>
    block.taskId === null ? { ...block, title: "Rest" } : block),
};
const legacyDbMode = { advanced: true, types: ["Code", "Game"] };
await pg.query("UPDATE prefs SET schedule = $1, rest_mode = $2 WHERE user_id = $3", [
  JSON.stringify(legacyDbSchedule), JSON.stringify(legacyDbMode), alice.id,
]);
const legacyLoaded = await db.loadState(alice.id);
eq(legacyLoaded.schedule, normalizedDbSchedule, "legacy database breaks load as plain Rest");
eq("restMode" in legacyLoaded, false, "database responses omit the removed preference");
await db.saveState(alice.id, { ...guestState, schedule: legacyDbSchedule, restMode: legacyDbMode });
eq((await db.loadState(alice.id)).schedule, normalizedDbSchedule, "an old client's save normalizes named breaks");
const persistedSchedule = (await pg.query("SELECT schedule FROM prefs WHERE user_id = $1", [alice.id])).rows[0].schedule;
eq(JSON.parse(persistedSchedule), normalizedDbSchedule, "named breaks are normalized before storage");

const bob = await db.createUser({
  id: "u-bob",
  username: "bob",
  usernameLower: "bob",
  passwordHash: hashPassword("password123"),
});
eq((await db.loadState(bob.id)).tasks, [], "a second account does not see the first's tasks");
await db.saveState(bob.id, { ...emptyState(), tasks: [{ ...goodTask, title: "Bob's own" }] });
eq((await db.loadState(bob.id)).tasks[0].title, "Bob's own", "each account keeps its own copy");
eq((await db.loadState(alice.id)).tasks.length, 2, "writing one account leaves the other alone");

await db.saveState(alice.id, emptyState());
eq((await db.loadState(alice.id)).tasks, [], "a full replace clears removed tasks");
eq((await db.loadState(bob.id)).tasks.length, 1, "the replace was scoped to one account");

// Against a real Postgres: the write that used to come back as a 500.
await db.saveState(alice.id, {
  ...emptyState(),
  tasks: [{ ...goodTask, title: "Tutor\u0000ing", description: "pas\u0000ted" }],
});
eq(
  (await db.loadState(alice.id)).tasks[0].title,
  "Tutoring",
  "a task carrying a NUL is saved clean rather than failing the whole write",
);
await db.saveState(alice.id, emptyState());

console.log("== sessions ==");
const token = newToken();
const future = new Date(Date.now() + 60_000);
await db.createSession(alice.id, hashToken(token), future);
eq((await db.findSessionUser(hashToken(token))).id, alice.id, "a live token resolves to its user");
eq(await db.findSessionUser(hashToken(newToken())), null, "an unknown token resolves to null");

const stale = newToken();
await db.createSession(bob.id, hashToken(stale), new Date(Date.now() - 60_000));
eq(await db.findSessionUser(hashToken(stale)), null, "an expired token is refused");
eq(await db.findSessionUser(hashToken(stale)), null, "and stays refused after cleanup");

await db.deleteSession(hashToken(token));
eq(await db.findSessionUser(hashToken(token)), null, "signing out kills the token");

// Deleting an account takes its sessions, tasks and prefs with it.
const doomed = newToken();
await db.createSession(bob.id, hashToken(doomed), new Date(Date.now() + 60_000));
await pg.query("DELETE FROM users WHERE id = $1", [bob.id]);
eq(await db.findSessionUser(hashToken(doomed)), null, "sessions cascade when a user is removed");
eq((await pg.query("SELECT 1 FROM tasks WHERE user_id = $1", [bob.id])).rows.length, 0, "tasks cascade too");

console.log("== deleting an account ==");
// App Store guideline 5.1.1(v): the app must be able to erase the account, and
// it has to be a real deletion rather than a flag.
const carol = await db.createUser({
  id: "u-carol",
  username: "carol",
  usernameLower: "carol",
  passwordHash: hashPassword("password123"),
});
await db.saveState(carol.id, { ...emptyState(), tasks: [{ ...goodTask, id: "c1" }] });
const carolToken = newToken();
await db.createSession(carol.id, hashToken(carolToken), new Date(Date.now() + 60_000));

await db.saveState(alice.id, { ...emptyState(), tasks: [{ ...goodTask, id: "a1" }] });

await db.deleteUser(carol.id);
eq(await db.findUserByUsername("carol"), null, "the account is gone");
eq(await db.usernameTaken("carol"), false, "and the username is free again");
eq(await db.findSessionUser(hashToken(carolToken)), null, "its sessions no longer resolve");
eq(
  (await pg.query("SELECT 1 FROM tasks WHERE user_id = $1", [carol.id])).rows.length,
  0,
  "its tasks are gone",
);
eq(
  (await pg.query("SELECT 1 FROM prefs WHERE user_id = $1", [carol.id])).rows.length,
  0,
  "its preferences are gone",
);
eq((await db.loadState(alice.id)).tasks.length, 1, "another account is untouched");
// Deleting an account that is already gone is not an error — a second tap, or a
// retry after a dropped response, must not fail.
await db.deleteUser(carol.id);
eq(await db.findUserByUsername("carol"), null, "deleting twice is harmless");

console.log("== login throttling ==");
// A window of three, so the boundary is cheap to walk.
const KEY = "login:198.51.100.7";
eq(await db.countAttempt(KEY, 3, 60_000), true, "the first attempt is allowed");
eq(await db.countAttempt(KEY, 3, 60_000), true, "the second is allowed");
eq(await db.countAttempt(KEY, 3, 60_000), true, "the third reaches the cap");
eq(await db.countAttempt(KEY, 3, 60_000), false, "the fourth is refused");
eq(await db.countAttempt("login:203.0.113.9", 3, 60_000), true, "a different client is unaffected");

await db.clearAttempts(KEY);
eq(await db.countAttempt(KEY, 3, 60_000), true, "a successful sign-in resets the counter");

// An elapsed window starts the count over rather than staying locked out.
await db.countAttempt(KEY, 3, 60_000);
await db.countAttempt(KEY, 3, 60_000);
eq(await db.countAttempt(KEY, 3, 60_000), false, "still refused inside the window");
await pg.query("UPDATE rate_limits SET reset_at = $1 WHERE key = $2", [
  new Date(Date.now() - 1000).toISOString(),
  KEY,
]);
eq(await db.countAttempt(KEY, 3, 60_000), true, "the window rolling over clears the block");

console.log(`\n${pass} passed, ${fail} failed`);
await pg.close();
process.exit(fail ? 1 : 0);
