import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AlertLog, DIAGNOSTIC_FILE, DIAGNOSTIC_PREVIOUS } from "../src/diagnostics";

function fixture() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "yantasks-alert-log-"));
  // Only this newly created disposable directory is removed.
  return { directory, close: () => fs.rmSync(directory, { recursive: true, force: true }) };
}

test("diagnostics redact task/account text and hash event/task identifiers", () => {
  const f = fixture();
  try {
    const log = new AlertLog(f.directory, () => 0);
    const event = { kind: "alert-requested" as const, eventType: "task-complete" as const, eventId: "private-task-event", taskId: "private-task-id",
      title: "Private task title", body: "Private description", accountId: "private-account", controllerId: "private-controller", cookie: "private-cookie" };
    log.record(event);
    const raw = fs.readFileSync(path.join(f.directory, DIAGNOSTIC_FILE), "utf8");
    assert.doesNotMatch(raw, /private|Private/);
    const record = JSON.parse(raw);
    assert.match(record.eventKey, /^[a-f0-9]{16}$/); assert.match(record.taskKey, /^[a-f0-9]{16}$/);
    assert.equal(record.at, "1970-01-01T00:00:00.000Z");
  } finally { f.close(); }
});

test("rotation keeps two bounded local logs and survives restart", () => {
  const f = fixture();
  try {
    let log = new AlertLog(f.directory, () => 0, 512);
    for (let i = 0; i < 80; i++) {
      if (i === 40) log = new AlertLog(f.directory, () => 0, 512);
      log.record({ kind: "native-shown", eventType: "rest-soon", eventId: String(i) });
    }
    assert.deepEqual(fs.readdirSync(f.directory).sort(), [DIAGNOSTIC_FILE, DIAGNOSTIC_PREVIOUS].sort());
    for (const file of fs.readdirSync(f.directory)) {
      assert.ok(fs.statSync(path.join(f.directory, file)).size <= 512);
      for (const line of fs.readFileSync(path.join(f.directory, file), "utf8").trim().split("\n")) assert.equal(JSON.parse(line).kind, "native-shown");
    }
  } finally { f.close(); }
});

test("an unavailable diagnostics directory never throws into the app", () => {
  const f = fixture();
  try {
    const file = path.join(f.directory, "not-a-directory"); fs.writeFileSync(file, "test fixture");
    const log = new AlertLog(file);
    assert.doesNotThrow(() => log.record({ kind: "native-requested" }));
  } finally { f.close(); }
});
