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
  "1 task, a saved schedule and your last recommendation",
  "three things use a serial list",
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
eq(shouldOfferMigration(emptyState(), withRec), true, "a lone recommendation is too");
eq(shouldOfferMigration(emptyState(), emptyState()), false, "nothing on either side asks nothing");
eq(shouldOfferMigration(withTask, withTask), false, "an account with tasks is never overwritten");
eq(shouldOfferMigration(withTask, emptyState()), false, "a full account and an empty device asks nothing");
eq(shouldOfferMigration(withSchedule, withTask), false, "a schedule alone still counts as a used account");
eq(shouldOfferMigration(withRec, withTask), false, "so does a recommendation alone");

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
