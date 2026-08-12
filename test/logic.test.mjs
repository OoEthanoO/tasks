// Logic tests for the parser, weight math, and scheduler.
// Run with `npm test` — that compiles lib/ to .test-build/ first.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { parseTrailingDate } = require("../.test-build/parse-date.js");
const { taskWeight, buildWeightTable, REST_WEIGHT } = require("../.test-build/weights.js");
const { toKey, addDays } = require("../.test-build/dates.js");
const {
  buildBlockTimes,
  generateSchedule,
  scheduleStaleReason,
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
  ["taxes due by tomorrow", "taxes due", T(1)],
  ["essay due tomorrow", "essay", T(1)],
  ["essay due aug 28", "essay", "2026-08-28"],
  ["finish report in 3 days", "finish report", T(3)],
  ["finish report in 2 weeks", "finish report", T(14)],
  ["rent 5 days ago", "rent", T(-5)],
  ["ship it next week", "ship it", T(7)],
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
eq(taskWeight(mk(0), today), 1, "due today -> 1");
eq(taskWeight(mk(1), today), 1 / 2, "tomorrow -> 1/2");
eq(taskWeight(mk(2), today), 1 / 3, "day after -> 1/3");
eq(taskWeight(mk(6), today), 1 / 7, "6 days out -> 1/7");
eq(taskWeight(mk(-1), today), 2, "yesterday -> 2");
eq(taskWeight(mk(-2), today), 3, "day before yesterday -> 3");
eq(taskWeight(mk(-5), today), 6, "5 days overdue -> 6");
eq(taskWeight(mk(0, true), today), 0, "completed -> 0");

console.log("== probability with hidden Rest ==");
const one = buildWeightTable([mk(0)], today);
eq(one.total, 1 + 1 / 7, "one task due today: total = 8/7");
eq(one.entries[0].probability.toFixed(4), (7 / 8).toFixed(4), "task = 7/8 = 87.5%");
eq(one.restProbability.toFixed(4), (1 / 8).toFixed(4), "rest = 1/8 = 12.5%");

const mixed = buildWeightTable([mk(0), mk(1), mk(-1)], today);
eq(mixed.taskTotal, 1 + 0.5 + 2, "weights sum");
eq(mixed.total.toFixed(6), (3.5 + 1 / 7).toFixed(6), "total includes rest");

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
eq(Math.abs(restPct - 0.125) < 0.015, true, `rest drawn ${(restPct * 100).toFixed(1)}% (expect ~12.5%)`);

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

eq(scheduleStaleReason(s, baseTasks, today), null, "unchanged -> fresh");
eq(scheduleStaleReason(null, baseTasks, today), null, "no schedule -> no warning");
eq(scheduleStaleReason(s, baseTasks, toKey(addDays(NOW, 1))), "day", "next day -> stale");
eq(
  scheduleStaleReason(s, [...baseTasks, mk(3)], today),
  "tasks",
  "task added -> stale",
);
eq(scheduleStaleReason(s, [baseTasks[0]], today), "tasks", "task deleted -> stale");
eq(
  scheduleStaleReason(s, [baseTasks[0], { ...baseTasks[1], dueDate: T(4) }], today),
  "tasks",
  "due date moved -> stale",
);
eq(
  scheduleStaleReason(s, [baseTasks[0], { ...baseTasks[1], completed: true }], today),
  "tasks",
  "task completed -> stale",
);
eq(
  scheduleStaleReason(s, [baseTasks[0], { ...baseTasks[1], title: "renamed" }], today),
  null,
  "rename only -> still fresh (weights unchanged)",
);
eq(
  scheduleStaleReason(s, [baseTasks[1], baseTasks[0]], today),
  null,
  "reordering -> still fresh",
);

console.log("== completed tasks are never drawn ==");
const doneOnly = buildWeightTable([mk(0, true), mk(-3, true)], today);
eq(doneOnly.taskTotal, 0, "all completed -> zero task weight");
let alwaysRest = true;
for (let i = 0; i < 500; i++) if (pickWeightedOnce(doneOnly) !== null) alwaysRest = false;
eq(alwaysRest, true, "500 draws all return Rest");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
