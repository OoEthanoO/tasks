// Logic tests for the parser, weight math, and scheduler.
// Run with `npm test` — that compiles lib/ to .test-build/ first.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseTrailingDate } = require("../.test-build/parse-date.js");
const { taskWeight, buildWeightTable, REST_WEIGHT } = require("../.test-build/weights.js");
const { toKey, addDays, todayKey } = require("../.test-build/dates.js");
const {
  buildBlockTimes,
  generateSchedule,
  scheduleStaleReason,
  staleMessage,
  endOfWorkDay,
  indexTasks,
  resolveBlock,
  needsRegenerateConfirmation,
  applyRestMode,
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

// Strictly decreasing as the due date moves further out.
let prev = Infinity;
let monotonic = true;
for (let n = -5; n <= 10; n++) {
  const w = taskWeight(mk(n), today);
  if (w >= prev) monotonic = false;
  prev = w;
}
eq(monotonic, true, "weight strictly decreases from overdue through future");

console.log("== probability with hidden Rest ==");
eq(REST_WEIGHT, 1, "rest weighs the same as a task due tomorrow");
eq(REST_WEIGHT, taskWeight(mk(1), today), "rest is pinned to the curve, not a literal");

const one = buildWeightTable([mk(0)], today);
eq(one.total, 3, "one task due today: total = 3");
eq(one.entries[0].probability.toFixed(4), (2 / 3).toFixed(4), "task = 2/3 = 66.7%");
eq(one.restProbability.toFixed(4), (1 / 3).toFixed(4), "rest = 1/3 = 33.3%");

const mixed = buildWeightTable([mk(0), mk(1), mk(-1)], today);
eq(mixed.taskTotal, 2 + 1 + 3, "weights sum");
eq(mixed.total, 7, "total includes rest");

// Rest is constant, so its share must fall as work piles up and recover as
// tasks get completed. That trade-off is the whole point of a fixed weight.
const shares = [[1], [0], [0, 0], [0, 0, 0]].map(
  (ds) => buildWeightTable(ds.map((d, i) => ({ ...mk(d), id: `s${i}` })), today).restProbability,
);
eq(shares.map((s) => (s * 100).toFixed(1)), ["50.0", "33.3", "20.0", "14.3"], "rest share shrinks as the plate fills");
eq(
  shares.every((s, i) => i === 0 || s < shares[i - 1]),
  true,
  "strictly monotonic decline",
);

const busy = [mk(0), mk(0), mk(0)].map((t, i) => ({ ...t, id: `b${i}` }));
const beforeDone = buildWeightTable(busy, today).restProbability;
const afterDone = buildWeightTable(
  busy.map((t, i) => (i === 0 ? { ...t, completed: true } : t)),
  today,
).restProbability;
eq(afterDone > beforeDone, true, "completing a task wins rest share back");

const empty = buildWeightTable([], today);
eq(empty.total, REST_WEIGHT, "no tasks -> only rest");

console.log("== draw distribution (10k rolls, 1 task due today) ==");
let rest = 0;
for (let i = 0; i < 10000; i++) if (buildWeightTable([mk(0)], today) && !pickWeightedOnce(one)) rest++;
function pickWeightedOnce(table) {
  let roll = Math.random() * table.total;
  for (const e of table.entries) {
    if (e.weight <= 0) continue;
    roll -= e.weight;
    if (roll < 0) return e.task;
  }
  return null;
}
const restPct = rest / 10000;
eq(
  Math.abs(restPct - 1 / 3) < 0.02,
  true,
  `rest drawn ${(restPct * 100).toFixed(1)}% (expect ~33.3%)`,
);

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

  // The comment on formatWeight claims "1/n" is exact for everything the curve
  // produces, rather than a rounded approximation. Walk the curve and check.
  let exact = true;
  const seen = new Set();
  for (let n = -30; n <= 400; n++) {
    const w = weightForDaysOut(n);
    const text = formatWeight(w);
    seen.add(text);
    const parsed = text.includes("/")
      ? 1 / Number(text.split("/")[1])
      : Number(text);
    if (Math.abs(parsed - w) > 1e-9) exact = false;
  }
  eq(exact, true, "every weight the curve produces round-trips exactly");
  eq(seen.size, 431, "and each one reads differently");
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

console.log("== completed tasks are never drawn ==");
const doneOnly = buildWeightTable([mk(0, true), mk(-3, true)], today);
eq(doneOnly.taskTotal, 0, "all completed -> zero task weight");
let alwaysRest = true;
for (let i = 0; i < 500; i++) if (pickWeightedOnce(doneOnly) !== null) alwaysRest = false;
eq(alwaysRest, true, "500 draws all return Rest");

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

console.log("== advanced rest ==");
const {
  pickRestLabel,
  activeRestTypes,
  defaultRestMode,
  REST_LABEL,
} = require("../.test-build/weights.js");

const CODE_GAME = { advanced: true, types: ["Code", "Game"] };

eq(defaultRestMode(), { advanced: false, types: ["Code", "Game"] }, "off by default");
eq(activeRestTypes(defaultRestMode()), [], "kinds are kept but inert while off");
eq(activeRestTypes(CODE_GAME), ["Code", "Game"], "kinds are live once switched on");

// Off, or on with nothing configured, both have to read as plain Rest.
eq(pickRestLabel({ advanced: false, types: ["Code"] }, 0), REST_LABEL, "off -> Rest");
eq(pickRestLabel({ advanced: true, types: [] }, 0), REST_LABEL, "no kinds -> Rest");

// The roll is injectable, so the split can be walked exactly rather than
// sampled. Two kinds means the halfway point is the boundary.
eq(pickRestLabel(CODE_GAME, 0), "Code", "a roll at 0 takes the first kind");
eq(pickRestLabel(CODE_GAME, 0.4999), "Code", "just under half is still the first");
eq(pickRestLabel(CODE_GAME, 0.5), "Game", "half exactly crosses to the second");
eq(pickRestLabel(CODE_GAME, 0.9999), "Game", "just under one is the second");
// Math.random() never returns 1, but a clamp beats an out-of-range read.
eq(pickRestLabel(CODE_GAME, 1), "Game", "a roll of one clamps rather than wrapping");

const THREE = { advanced: true, types: ["Code", "Game", "Walk"] };
eq(
  [0, 0.34, 0.67, 0.999].map((r) => pickRestLabel(THREE, r)),
  ["Code", "Game", "Walk", "Walk"],
  "three kinds split into thirds",
);

// The headline claim: an even split over many draws, and — the part that
// matters most — rest itself comes up exactly as often as it did before.
{
  const restTasks = [mk(0), mk(1), mk(5)];
  const restTable = buildWeightTable(restTasks, today);
  let code = 0,
    game = 0;
  for (let i = 0; i < 20000; i++) {
    const label = pickRestLabel(CODE_GAME);
    if (label === "Code") code++;
    else if (label === "Game") game++;
    else throw new Error(`unexpected rest label ${label}`);
  }
  const codeShare = code / (code + game);
  eq(
    codeShare > 0.47 && codeShare < 0.53,
    true,
    `20k draws split about evenly (code ${(codeShare * 100).toFixed(1)}%)`,
  );

  // Generate with and without advanced rest and count rest blocks both ways.
  // The kinds rename the slice; they must not resize it.
  const countRest = (restMode) => {
    let rest = 0,
      blocks = 0;
    for (let i = 0; i < 400; i++) {
      const sched = generateSchedule(restTasks, restTable, "23:00", NOW, restMode);
      blocks += sched.blocks.length;
      rest += sched.blocks.filter((b) => b.taskId === null).length;
    }
    return rest / blocks;
  };
  const plainShare = countRest(defaultRestMode());
  const advancedShare = countRest(CODE_GAME);
  eq(
    Math.abs(plainShare - advancedShare) < 0.03,
    true,
    `rest is as frequent either way (${(plainShare * 100).toFixed(1)}% vs ${(advancedShare * 100).toFixed(1)}%)`,
  );

  // A rest block carries its kind, and a task block is untouched.
  const advSched = generateSchedule(restTasks, restTable, "23:00", NOW, CODE_GAME);
  const restTitles = new Set(
    advSched.blocks.filter((b) => b.taskId === null).map((b) => b.title),
  );
  eq(
    [...restTitles].every((title) => title === "Code" || title === "Game"),
    true,
    "every rest block is stored as one of the kinds",
  );

  // Resolution reads the live mode, so switching off restores plain Rest with
  // no regenerate — the block still holds "Code" underneath.
  const restBlock = advSched.blocks.find((b) => b.taskId === null);
  const emptyIndex = indexTasks(restTasks);
  eq(
    resolveBlock(restBlock, emptyIndex, CODE_GAME).title,
    restBlock.title,
    "advanced on -> the stored kind shows",
  );
  eq(
    resolveBlock(restBlock, emptyIndex, { advanced: false, types: ["Code"] }).title,
    REST_LABEL,
    "advanced off -> plain Rest again, without regenerating",
  );
  eq(resolveBlock(restBlock, emptyIndex, CODE_GAME).isRest, true, "still styled as rest");
  // A schedule written before the feature existed has "Rest" in the title.
  eq(
    resolveBlock({ ...restBlock, title: "Rest" }, emptyIndex, CODE_GAME).title,
    REST_LABEL,
    "an older schedule keeps reading Rest",
  );
}

console.log("== switching rest modes re-labels the schedule in place ==");
{
  const relTasks = [mk(0), mk(1), mk(4)];
  const relTable = buildWeightTable(relTasks, today);
  const plain = generateSchedule(relTasks, relTable, "23:00", NOW);
  const restCount = plain.blocks.filter((b) => b.taskId === null).length;
  eq(restCount > 0, true, "the fixture has rest blocks to re-label");
  eq(
    plain.blocks.filter((b) => b.taskId === null).every((b) => b.title === REST_LABEL),
    true,
    "they all start as plain Rest",
  );

  // Switching on: every rest block picks a kind, nothing else moves.
  const switched = applyRestMode(plain, CODE_GAME);
  eq(
    switched.blocks.filter((b) => b.taskId === null).every((b) => b.title === "Code" || b.title === "Game"),
    true,
    "every rest block now carries a kind",
  );
  eq(
    switched.blocks.map((b) => b.taskId),
    plain.blocks.map((b) => b.taskId),
    "the task picks are identical — nothing was re-drawn",
  );
  eq(
    switched.blocks.map((b) => [b.start, b.end]),
    plain.blocks.map((b) => [b.start, b.end]),
    "the block times are identical",
  );
  eq(
    switched.blocks.filter((b) => b.taskId !== null).map((b) => b.title),
    plain.blocks.filter((b) => b.taskId !== null).map((b) => b.title),
    "task block titles are untouched",
  );
  // The schedule must not become stale, or the user is asked to regenerate
  // anyway and the whole point is lost.
  eq(switched.generatedAt, plain.generatedAt, "the generated time is preserved");
  eq(switched.signature, plain.signature, "the signature is preserved");
  eq(switched.endTime, plain.endTime, "the end time is preserved");
  eq(
    scheduleStaleReason(switched, relTasks, "23:00", NOW),
    null,
    "re-labelling does not make the schedule stale",
  );

  // Idempotent: labels that are still valid are left exactly where they are.
  const again = applyRestMode(switched, CODE_GAME);
  eq(again, switched, "a second pass changes nothing at all");
  eq(
    applyRestMode(switched, { advanced: false, types: ["Code", "Game"] }),
    switched,
    "switching off keeps the stored kinds for next time",
  );
  eq(
    applyRestMode(applyRestMode(switched, { advanced: false, types: ["Code", "Game"] }), CODE_GAME),
    switched,
    "off and back on does not reshuffle",
  );

  // Adding a kind leaves existing labels alone; they are still on offer.
  eq(
    applyRestMode(switched, { advanced: true, types: ["Code", "Game", "Walk"] }),
    switched,
    "adding a kind does not disturb valid labels",
  );

  // Removing one redraws only the blocks that were using it.
  const onlyGame = applyRestMode(switched, { advanced: true, types: ["Game"] });
  eq(
    onlyGame.blocks.filter((b) => b.taskId === null).every((b) => b.title === "Game"),
    true,
    "a removed kind is redrawn to one still on offer",
  );
  eq(
    onlyGame.blocks.map((b) => b.taskId),
    plain.blocks.map((b) => b.taskId),
    "and even then the task picks do not move",
  );

  eq(applyRestMode(null, CODE_GAME), null, "no schedule stays no schedule");

  // An injected roll makes the split exact rather than sampled.
  const rolls = [0, 0.9, 0, 0.9, 0, 0.9];
  let i = 0;
  const alternating = applyRestMode(plain, CODE_GAME, () => rolls[i++ % rolls.length]);
  eq(
    alternating.blocks.filter((b) => b.taskId === null).map((b) => b.title).slice(0, 2),
    ["Code", "Game"],
    "the roll drives which kind each block gets",
  );

  // What the panel actually renders, before and after.
  const relIndex = indexTasks(relTasks);
  const aRest = switched.blocks.find((b) => b.taskId === null);
  eq(resolveBlock(aRest, relIndex, CODE_GAME).title, aRest.title, "the kind renders");
  eq(
    resolveBlock(aRest, relIndex, { advanced: false, types: ["Code", "Game"] }).title,
    REST_LABEL,
    "switched off it renders as Rest again",
  );
  // A kind deleted without a re-label must not linger on screen.
  eq(
    resolveBlock({ ...aRest, title: "Gone" }, relIndex, CODE_GAME).title,
    REST_LABEL,
    "a kind no longer on offer falls back to Rest",
  );
}

console.log("== rest kinds are coerced like everything else ==");
{
const {
  sanitizeRestMode,
  sanitizeState,
  isEmptyState,
  emptyState,
} = require("../.test-build/app-state.js");
eq(sanitizeRestMode(null), defaultRestMode(), "nothing stored -> the default");
eq(sanitizeRestMode(undefined), defaultRestMode(), "missing -> the default");
eq(sanitizeRestMode({ advanced: "yes", types: [] }).advanced, false, "only true is on");
eq(
  sanitizeRestMode({ advanced: true, types: ["  Code  "] }).types,
  ["Code"],
  "labels are trimmed",
);
eq(
  sanitizeRestMode({ advanced: true, types: ["Code", "", "   ", "Game"] }).types,
  ["Code", "Game"],
  "blank labels are dropped",
);
// A duplicate is not cosmetic: it would quietly skew the even split.
eq(
  sanitizeRestMode({ advanced: true, types: ["Code", "code", "CODE", "Game"] }).types,
  ["Code", "Game"],
  "duplicates are dropped case-insensitively, first spelling wins",
);
eq(
  sanitizeRestMode({ advanced: true, types: ["a".repeat(200)] }).types[0].length,
  40,
  "an overlong label is capped",
);
eq(
  sanitizeRestMode({ advanced: true, types: Array.from({ length: 50 }, (_, i) => `k${i}`) })
    .types.length,
  20,
  "the list is capped",
);
eq(
  sanitizeRestMode({ advanced: true, types: "not an array" }).types,
  [],
  "a non-array list is dropped",
);
eq(
  sanitizeRestMode({ advanced: true, types: [1, null, {}, "Ok"] }).types,
  ["Ok"],
  "non-string entries are dropped",
);
// State stored before advanced rest existed has no restMode key at all.
eq(
  sanitizeState({ tasks: [] }).restMode,
  defaultRestMode(),
  "older state gains the default",
);
eq(
  sanitizeState({ tasks: [], restMode: { advanced: true, types: ["Walk"] } }).restMode,
  { advanced: true, types: ["Walk"] },
  "a stored rest mode survives sanitizing",
);
// It is a preference, like the end time — not something a migration counts.
eq(
  isEmptyState({ ...emptyState(), restMode: { advanced: true, types: ["Walk"] } }),
  true,
  "rest kinds alone do not make an account non-empty",
);
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
} = require("../.test-build/app-state.js");

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
  completed: false,
  createdAt: "2026-08-12T00:00:00.000Z",
  completedAt: null,
};
eq(sanitizeState({ tasks: [goodTask] }).tasks, [goodTask], "a well-formed task survives intact");
eq(sanitizeState({ tasks: [{ title: "no id" }] }).tasks, [], "a task without an id is dropped");
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
// guestState has no restMode at all — an older client, or a payload written
// before the column existed. It has to land on the default rather than null.
eq(restored.restMode, defaultRestMode(), "a payload with no rest mode gets the default");

// And a configured one survives the trip through the new prefs column.
await db.saveState(alice.id, {
  ...guestState,
  restMode: { advanced: true, types: ["Code", "Game", "Walk"] },
});
eq(
  (await db.loadState(alice.id)).restMode,
  { advanced: true, types: ["Code", "Game", "Walk"] },
  "advanced rest round-trips through postgres",
);
// Turning it off keeps the kinds, so switching back on does not lose them.
await db.saveState(alice.id, {
  ...guestState,
  restMode: { advanced: false, types: ["Code", "Game", "Walk"] },
});
eq(
  (await db.loadState(alice.id)).restMode,
  { advanced: false, types: ["Code", "Game", "Walk"] },
  "switching off keeps the kinds",
);

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
