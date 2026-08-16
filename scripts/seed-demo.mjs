#!/usr/bin/env node
/**
 * Seed (or reset) the demo account App Review signs in with.
 *
 * Talks to the running app over its own HTTP API rather than to the database,
 * so it works against production without a connection string and exercises the
 * same endpoints a real client does.
 *
 * Re-running it is the point: a reviewer will tick tasks off and delete some,
 * and this puts the account back to a known state. Due dates are computed at
 * run time, so the data never looks stale no matter how long ago it was seeded.
 *
 *   DEMO_PASSWORD='...' node scripts/seed-demo.mjs
 *   DEMO_PASSWORD='...' API_BASE=http://localhost:3000 node scripts/seed-demo.mjs
 */

const API_BASE = (process.env.API_BASE ?? "https://tasks.ethanyanxu.com").replace(/\/+$/, "");
const USERNAME = process.env.DEMO_USERNAME ?? "appreview";
const PASSWORD = process.env.DEMO_PASSWORD;

/* ---------- the demo data ---------- */

const pad = (n) => String(n).padStart(2, "0");
const dayKey = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const iso = (daysAgo) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();

// Spread across every bucket the list can show — overdue, today, upcoming and
// completed — so a reviewer sees the weighting do something on first launch.
const TASKS = [
  ["Renew library books", "Two are already overdue at the branch on Elm.", -2],
  ["Reply to the landlord", "Confirm the inspection window.", -1],
  ["Submit expense report", "Receipts are in the shared folder.", 0],
  ["Call the dentist", "Ask about the Thursday slot.", 0],
  ["Draft quarterly update", "One page, numbers first, then the narrative.", 1],
  ["Review pull request #218", "The migration one — check the rollback path.", 2],
  ["Book flights for the conference", "Tuesday out, Friday back.", 4],
  ["Replace the bike chain", "", 6],
  ["Write the offsite agenda", "Half a day of talks, half unstructured.", 9],
  ["Renew passport", "Photos first, the form needs them attached.", 21],
];

const DONE = [
  ["Pay the electricity bill", 1],
  ["Send the signed contract", 3],
];

/** Exported so the shape can be checked without touching a live server. */
export const buildDemoState = () => ({
  tasks: [
    ...TASKS.map(([title, description, due], i) => ({
      id: `demo-${i + 1}`,
      title,
      description,
      dueDate: dayKey(due),
      completed: false,
      createdAt: iso(7),
      completedAt: null,
    })),
    ...DONE.map(([title, daysAgo], i) => ({
      id: `demo-done-${i + 1}`,
      title,
      description: "",
      dueDate: dayKey(-daysAgo),
      completed: true,
      createdAt: iso(10),
      completedAt: iso(daysAgo),
    })),
  ],
  // Left empty on purpose: a stored schedule is tied to the day it was built
  // for and would show up as stale. The reviewer generates a fresh one, which
  // is a better demonstration anyway.
  recommendation: null,
  schedule: null,
  endTime: "23:00",
});

/* ---------- talking to the app ---------- */

let cookie = "";

async function call(path, method, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const setCookie = res.headers.get("set-cookie");
  if (setCookie) cookie = setCookie.split(";")[0];

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    // Some endpoints answer with an empty body.
  }
  return { status: res.status, payload };
}

async function main() {
  if (!PASSWORD) {
    throw new Error(
      'DEMO_PASSWORD is not set. Choose one — it goes in the App Review notes, so it\n' +
        '  should not be a password you use anywhere else:\n\n' +
        '  DEMO_PASSWORD="$(openssl rand -base64 12)" node scripts/seed-demo.mjs',
    );
  }

  const state = buildDemoState();
  console.log(`→ ${API_BASE} as "${USERNAME}"`);

  const signup = await call("/api/auth/signup", "POST", {
    username: USERNAME,
    password: PASSWORD,
    importState: null,
  });

  if (signup.status === 200) {
    console.log("✓ account created");
  } else if (signup.status === 409) {
    console.log("· account already exists — signing in to reset it");
    const login = await call("/api/auth/login", "POST", {
      username: USERNAME,
      password: PASSWORD,
    });
    if (login.status !== 200) {
      throw new Error(
        `sign-in failed (${login.status}): ${login.payload?.error ?? "no message"}. ` +
          "If the account exists with a different password, delete it from the app first.",
      );
    }
    console.log("✓ signed in");
  } else {
    throw new Error(
      `sign-up failed (${signup.status}): ${signup.payload?.error ?? "no message"}`,
    );
  }

  // A full replace: whatever the reviewer left behind is overwritten.
  const save = await call("/api/state", "PUT", { state });
  if (save.status !== 200) {
    throw new Error(`save failed (${save.status}): ${save.payload?.error ?? "no message"}`);
  }

  const check = await call("/api/state", "GET");
  const stored = check.payload?.state?.tasks ?? [];
  const open = stored.filter((t) => !t.completed).length;
  console.log(`✓ seeded ${stored.length} tasks (${open} open, ${stored.length - open} completed)`);
  console.log("\nApp Review notes:\n" + `  Username: ${USERNAME}\n  Password: (the DEMO_PASSWORD you passed)`);
}

// Only when run directly, so the data above can be imported and checked.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(`✗ ${error.message}`);
    process.exit(1);
  });
}
