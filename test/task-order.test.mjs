import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { compareListOrder, compareLegacyListOrder, groupTasks, moveTaskWithinDueDate: move } = require("../.test-build/grouping.js");
const { emptyState, sanitizeState } = require("../.test-build/app-state.js");
const { localStore } = require("../.test-build/storage.js");
const task = (id, dueDate = "2099-01-01", extra = {}) => ({ id, title: id, description: "Keep this", dueDate, priority: "low", completed: false, completedAt: null, createdAt: "2026-10-01T00:00:00.000Z", ...extra });
const ids = tasks => tasks.map(t => t.id);
const open = tasks => tasks.filter(t => !t.completed).sort(compareListOrder);
let count = 0;
const check = (name, fn) => { fn(); count++; console.log("✓ " + name); };

check("same-date moves swap only adjacent unfinished peers, even in interleaved storage", () => {
  const a = task("a"), b = task("b"), c = task("c");
  const earlier = task("earlier", "2098-01-01"), later = task("later", "2100-01-01");
  const done = task("done", a.dueDate, { completed: true, completedAt: "2099-01-01T12:00:00.000Z" });
  const list = [a, earlier, done, b, later, c], before = structuredClone(list);
  const moved = move(list, "b", "up");
  assert.deepEqual(ids(moved), ["b", "earlier", "done", "a", "later", "c"]);
  assert.deepEqual(ids(open(moved)), ["earlier", "b", "a", "c", "later"]);
  assert.deepEqual(move(moved, "b", "down"), list);
  assert.deepEqual(list, before);
  for (const t of moved) assert.equal(t, list.find(original => original.id === t.id), "no task fields changed");
});
check("boundaries, singletons, completed tasks, missing IDs and invalid moves are no-ops", () => {
  const list = [task("first"), task("last"), task("only", "2099-02-02"), task("done", "2099-02-02", { completed: true })];
  for (const [id, direction] of [["first", "up"], ["last", "down"], ["only", "up"], ["only", "down"], ["done", "up"], ["missing", "down"], ["first", "sideways"]]) {
    assert.equal(move(list, id, direction), list, `${id} ${direction}`);
  }
  const empty = []; assert.equal(move(empty, "missing", "up"), empty);
});
check("manual order overrides creation timestamps but frozen legacy ordering does not", () => {
  const old = task("old"), newer = task("new", old.dueDate, { createdAt: "2026-10-02T00:00:00.000Z" });
  const list = move([old, newer], "new", "up");
  assert.deepEqual(ids(open(list)), ["new", "old"]);
  assert.deepEqual(ids([...list].sort(compareLegacyListOrder)), ["old", "new"]);
  assert.deepEqual(groupTasks(list.map(task => ({ task, weight: 1, probability: 0.5 })), "2099-01-01")[0].items.map(e => e.task.id), ["new", "old"]);
});
check("adding, editing, completing and reopening keep the saved peer order", () => {
  const list = move([task("a"), task("b")], "b", "up");
  assert.deepEqual(ids(open([...list, task("new")])), ["b", "a", "new"]);
  assert.deepEqual(ids(open(list.map(t => ({ ...t, title: "Renamed" })))), ["b", "a"]);
  const completed = list.map(t => t.id === "b" ? { ...t, completed: true } : t);
  assert.deepEqual(ids(open(completed)), ["a"]);
  assert.deepEqual(ids(open(completed.map(t => ({ ...t, completed: false })))), ["b", "a"]);
});
check("guest persistence and sanitization round-trip order without changing timer state", () => {
  const savedWindow = globalThis.window, values = new Map([["yantasks.tracking.v1", "untouched"]]);
  globalThis.window = { localStorage: { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) } };
  try {
    const state = { ...emptyState(), tasks: move([task("a"), task("b")], "a", "down") };
    assert.deepEqual(sanitizeState(JSON.parse(JSON.stringify(state))).tasks, state.tasks);
    localStore.save(state);
    assert.deepEqual(localStore.load().tasks, state.tasks);
    assert.equal(values.get("yantasks.tracking.v1"), "untouched");
  } finally { if (savedWindow === undefined) delete globalThis.window; else globalThis.window = savedWindow; }
});
check("repeated moves preserve every task and never cross a date boundary", () => {
  let list = Array.from({ length: 30 }, (_, i) => task(`t${i}`, `2099-01-0${1 + i % 4}`, { completed: i % 7 === 0 }));
  const originals = new Map(list.map(t => [t.id, t]));
  for (let i = 0; i < 200; i++) {
    const id = `t${(i * 13) % list.length}`, direction = i % 3 ? "up" : "down";
    const before = open(list), taskIndex = before.findIndex(t => t.id === id), peerIndex = taskIndex + (direction === "up" ? -1 : 1);
    const expected = [...before];
    if (taskIndex >= 0 && expected[peerIndex]?.dueDate === expected[taskIndex].dueDate) {
      [expected[taskIndex], expected[peerIndex]] = [expected[peerIndex], expected[taskIndex]];
    }
    list = move(list, id, direction);
    assert.deepEqual(open(list), expected);
    assert.equal(new Set(ids(list)).size, originals.size);
    for (const t of list) assert.equal(t, originals.get(t.id));
  }
});
console.log(`${count} task-order scenarios passed`);
