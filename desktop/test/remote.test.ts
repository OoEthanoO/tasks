import { test } from "node:test";
import assert from "node:assert/strict";
import { api, ApiError, getStateRefreshInterval, setApiTransport } from "../../lib/remote";

test("desktop API transport leaves the default web cadence intact and preserves errors", async () => {
  assert.equal(getStateRefreshInterval(), 5000);
  const calls: string[] = [];
  setApiTransport(async (path, options) => {
    calls.push(`${options?.method ?? "GET"} ${path}`);
    return path === "/api/auth/me" ? { status: 200, body: { user: null } } : { status: 401, body: { error: "Sign in first" } };
  }, 30_000);
  assert.equal(getStateRefreshInterval(), 30_000);
  assert.equal(await api.me(), null);
  await assert.rejects(api.loadState(), e => e instanceof ApiError && e.status === 401 && e.message === "Sign in first");
  assert.deepEqual(calls, ["GET /api/auth/me", "GET /api/state"]);
});
