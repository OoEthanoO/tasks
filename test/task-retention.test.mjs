import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { PGlite } from "@electric-sql/pglite";
const require = createRequire(import.meta.url);
const { completedTaskExpiresAt, isExpiredCompletedTask, pruneCompletedTasks, scheduleCompletedTaskCleanup } = require("../.test-build/task-retention.js");
const { compareCompletedOrder, compareListOrder, groupTasks } = require("../.test-build/grouping.js");
const { createTaskRetentionHook } = require("../.test-build/use-task-retention.js");
const { emptyState } = require("../.test-build/app-state.js");
const { localStore } = require("../.test-build/storage.js");
const { setSql } = require("../.test-build/sql.js");
const db = require("../.test-build/db.js");
const trackingDb = require("../.test-build/tracking-db.js");
const tr = require("../.test-build/tracking.js");
const NOW = Date.parse("2026-10-06T12:00:00.000Z");
const task = (id, completedAt = null) => ({ id, title: id, description: "", dueDate: "2026-10-06", priority: "low", completed: completedAt !== null, completedAt, createdAt: "2026-01-01T00:00:00.000Z" });
let count = 0;
const check = (name, fn) => { fn(); count++; console.log("✓ " + name); };

check("calendar-month retention clamps short months, leap years, and year rollover", () => {
  for (const [from, to] of [
    ["2026-09-06T12:00:00.000Z", "2026-10-06T12:00:00.000Z"],
    ["2026-01-31T12:34:56.789Z", "2026-02-28T12:34:56.789Z"],
    ["2028-01-31T12:34:56.789Z", "2028-02-29T12:34:56.789Z"],
    ["2028-02-29T12:00:00.000Z", "2028-03-29T12:00:00.000Z"],
    ["2026-08-31T12:00:00.000Z", "2026-09-30T12:00:00.000Z"],
    ["2026-12-31T23:59:59.999Z", "2027-01-31T23:59:59.999Z"],
    ["2026-09-06T08:00:00-04:00", "2026-10-06T12:00:00.000Z"],
  ]) assert.equal(new Date(completedTaskExpiresAt(task("x", from))).toISOString(), to);
});
check("expiration is inclusive at the anniversary, not one millisecond earlier", () => {
  const done = task("done", "2026-09-06T12:00:00.000Z");
  assert.equal(isExpiredCompletedTask(done, NOW - 1), false);
  assert.equal(isExpiredCompletedTask(done, NOW), true);
  assert.equal(isExpiredCompletedTask(done, NOW + 1), true);
});
check("open/reopened tasks, invalid dates and future completions are never prematurely deleted", () => {
  for (const t of [task("open"), { ...task("old", "2020-01-01"), completed: false }, task("bad", "junk"), { ...task("undated"), completed: true }, task("future", "2027-01-01")]) {
    assert.equal(isExpiredCompletedTask(t, NOW), false);
  }
  assert.equal(isExpiredCompletedTask(task("recompleted", "2026-10-06T11:00:00Z"), NOW), false);
});
check("pruning preserves list order, objects, input and unchanged array identity", () => {
  const open = task("open"), recent = task("recent", "2026-10-06"), old = task("old", "2020-01-01");
  const all = [open, old, recent], copy = structuredClone(all);
  const kept = pruneCompletedTasks(all, NOW);
  assert.deepEqual(kept, [open, recent]); assert.equal(kept[0], open);
  assert.deepEqual(all, copy); assert.equal(pruneCompletedTasks(kept, NOW), kept);
});
check("completed order uses real completion instants, independent of due date", () => {
  const older = { ...task("older", "2026-10-06T08:00:00Z"), dueDate: "2026-01-01" };
  const newer = { ...task("newer", "2026-10-06T07:00:00-04:00"), dueDate: "2027-01-01" };
  const missing = { ...task("missing"), completed: true }, bad = task("bad", "junk");
  assert.deepEqual([older, missing, newer, bad].sort(compareCompletedOrder).map(t => t.id), ["newer", "older", "missing", "bad"]);
  assert.equal(compareCompletedOrder(newer, { ...newer, id: "tie" }), 0);
  assert.deepEqual(groupTasks([older, newer].map(task => ({ task, weight: 0, share: 0 })), "2026-10-06")[0].items.map(e => e.task.id), ["newer", "older"]);
  assert.ok(compareListOrder(older, newer) < 0, "open-task picker order stays unchanged");
});

const realNow = Date.now;
Date.now = () => NOW;
try {
  check("guest load and save remove expired records from storage, not just the UI", () => {
    const originalWindow = globalThis.window;
    const saved = new Map([["yantasks.tasks.v1", JSON.stringify([task("old", "2020-01-01"), task("open"), task("recent", "2026-10-05")])], ["yantasks.tracking.v1", "unchanged"]]);
    globalThis.window = { localStorage: { getItem: k => saved.get(k) ?? null, setItem: (k,v) => saved.set(k,v), removeItem: k => saved.delete(k) } };
    try {
      assert.deepEqual(localStore.load().tasks.map(t => t.id), ["open", "recent"]);
      assert.deepEqual(JSON.parse(saved.get("yantasks.tasks.v1")).map(t => t.id), ["open", "recent"]);
      localStore.save({ ...emptyState(), tasks: [task("old", "2020-01-01"), task("new")] });
      assert.deepEqual(JSON.parse(saved.get("yantasks.tasks.v1")).map(t => t.id), ["new"]);
      assert.equal(saved.get("yantasks.tracking.v1"), "unchanged");
    } finally { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; }
  });
  check("guest timer sleeps until expiry, handles long delays/clock changes and cancels", () => {
    const originalSet = globalThis.setTimeout, originalClear = globalThis.clearTimeout;
    let pending = null, expired = 0, clock = NOW;
    Date.now = () => clock;
    globalThis.setTimeout = (fn, delay) => { pending = { fn, delay }; return 1; };
    globalThis.clearTimeout = () => { pending = null; };
    try {
      scheduleCompletedTaskCleanup([task("open")], () => expired++);
      assert.equal(pending, null);
      const cancel = scheduleCompletedTaskCleanup([task("recent", "2026-10-06T12:00:00Z")], () => expired++);
      assert.equal(pending.delay, 86_400_000);
      clock -= 1_000; pending.fn(); assert.equal(expired, 0); assert.equal(pending.delay, 86_400_000);
      clock = Date.parse("2026-11-06T12:00:00Z"); pending.fn(); assert.equal(expired, 1);
      cancel(); assert.equal(pending, null);
    } finally { globalThis.setTimeout = originalSet; globalThis.clearTimeout = originalClear; Date.now = () => NOW; }
  });
  check("guest hook cleans on mount; account hook never queues a whole-state save", () => {
    let tasks = [task("expired", "2020-01-01"), task("open")], cleanup;
    const useRetention = createTaskRetentionHook({ useEffect: fn => { cleanup = fn(); } });
    useRetention(tasks, value => { tasks = typeof value === "function" ? value(tasks) : value; }, true);
    assert.deepEqual(tasks.map(t => t.id), ["open"]); cleanup?.();
    useRetention([task("expired", "2020-01-01")], () => assert.fail("account mutated locally"), false);
    cleanup?.();
  });

  const pg = await PGlite.create();
  let beforeDelete = null;
  setSql({
    query: async (text, params = []) => {
      if (text.startsWith("DELETE FROM tasks AS t") && beforeDelete) { const run = beforeDelete; beforeDelete = null; await run(); }
      return (await pg.query(text, params)).rows;
    },
    transaction: async statements => {
      await pg.transaction(async tx => { for (const s of statements) await tx.query(s.text, s.params ?? []); });
    },
  });
  try {
    await db.createUser({ id: "u", username: "u", usernameLower: "u", passwordHash: "test" });
    await db.createUser({ id: "other", username: "other", usernameLower: "other", passwordHash: "test" });
    const insert = async (t, user = "u") => pg.query("INSERT INTO tasks (user_id,id,title,due_date,created_at,completed,completed_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [user,t.id,t.title,t.dueDate,t.createdAt,t.completed,t.completedAt]);
    await insert(task("old", "2020-01-01")); await insert(task("open")); await insert(task("recent", "2026-10-05"));
    await insert(task("old", "2020-01-01"), "other");
    assert.deepEqual((await db.loadState("u", NOW)).tasks.map(t => t.id).sort(), ["open", "recent"]);
    assert.equal((await pg.query("SELECT id FROM tasks WHERE user_id='u' AND id='old'")).rows.length, 0);
    assert.equal((await pg.query("SELECT id FROM tasks WHERE user_id='other'")).rows.length, 1);
    count++; console.log("✓ account reads physically delete only expired completions for that account");

    await insert(task("reopened", "2020-01-01"));
    beforeDelete = () => pg.query("UPDATE tasks SET completed=FALSE, completed_at=NULL WHERE id='reopened'");
    assert.ok((await db.loadState("u", NOW)).tasks.some(t => t.id === "reopened" && !t.completed));
    await insert(task("recompleted", "2020-01-01"));
    beforeDelete = () => pg.query("UPDATE tasks SET completed_at='2026-10-06T11:00:00Z' WHERE id='recompleted'");
    assert.ok((await db.loadState("u", NOW)).tasks.some(t => t.id === "recompleted"));
    count++; console.log("✓ concurrent reopening and recompletion survive account cleanup");

    await db.saveState("u", { ...emptyState(), tasks: [task("old", "2020-01-01"), task("open")] });
    assert.deepEqual((await db.loadState("u", NOW)).tasks.map(t => t.id), ["open"]);
    count++; console.log("✓ a stale save cannot resurrect expired completed records");

    let state = tr.createTracking([task("open"), task("old", "2020-01-01")], "23:00", "UTC", NOW);
    state = tr.actOnTracking(state, { type: "start" }, "desktop-owner", NOW);
    state.workMs = 42_000; state.taskMs = { open: 12_000, old: 30_000 }; state.rotation.totals.old = 30_000;
    const copy = structuredClone(state);
    await pg.query("INSERT INTO tracking (user_id,state) VALUES ($1,$2)", ["u", JSON.stringify(state)]);
    const cleaned = await trackingDb.readAccountTracking("u", NOW);
    assert.deepEqual(cleaned.tasks.map(t => t.id), ["open"]);
    assert.deepEqual({ ...cleaned, tasks: copy.tasks, revision: copy.revision }, copy);
    const again = await trackingDb.readAccountTracking("u", NOW);
    assert.equal(again.revision, cleaned.revision, "cleanup does not write on every poll");
    count++; console.log("✓ tracking snapshot cleanup preserves every timer/time/ownership field and is idempotent");
  } finally { setSql(null); await pg.close(); }
} finally { Date.now = realNow; }
console.log(`${count} task-retention scenarios passed`);
