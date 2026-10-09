# YanTasks

A minimal task tracker with an ordered, one-hour rotation. Add a title,
description, and due date, then press Start. Turns advance automatically;
Pause stops tracking. Task times and partial turns reset at local midnight.

Tasks run in due-date order. Use the up/down arrows to reorder unfinished tasks
with the same due date; other dates and the completed list stay in place.
The saved order syncs across clients and guides the picker without changing
tracked time. New tasks join the end of their due-date group.

The [Windows desktop app](desktop/README.md) adds native background alerts,
taskbar/tray controls and an always-on-top mini tracker, with battery-aware sync.
Its installer is built independently from `desktop/`; web and iOS keep sharing
the same tracking calculations and account data.

See [self-hosting](SELF_HOSTING.md) for the finprint-host deployment, keeping the
existing Neon database and client URLs with staged releases and rollback.

```bash
npm install
npm run dev
```

Accounts need a Postgres connection string. Create a free database at
[neon.tech](https://neon.tech) and put its URL in `.env.local`:

```bash
DATABASE_URL="postgresql://user:password@host.neon.tech/dbname?sslmode=require"
```

Without it the app still runs — you stay in "On this device" mode, and the
account buttons say accounts are not set up on this server rather than blaming
the network. The tables are created on first use, so there is no migration step.

Signed out, tasks and the timer live in `localStorage` and survive a reload.
Sign in to sync tasks, today's tracked time, and the active timer across
devices. Older stored preferences remain readable for compatibility.

## Accounts

Accounts are backed by Neon Postgres over its HTTP driver, which is what makes
them work on Vercel: every query is a stateless `fetch`, so there is no
connection pool to exhaust across serverless instances and nothing is written to
the function filesystem — which is read-only, and thrown away between requests
anyway. Set `DATABASE_URL` (the Neon integration in the Vercel dashboard does
this for you under Storage → Neon); `POSTGRES_URL` is accepted too.

- Passwords are hashed with scrypt and a per-user salt. The parameters are
  stored alongside the hash, so they can be raised later without a migration.
- Sessions are an httpOnly, SameSite=Lax cookie holding a 256-bit random token.
  Only the token's SHA-256 digest is stored, so a stolen copy of the database
  cannot be replayed as a live login. Sessions last 30 days.
- Sign-in failures are one message for both a wrong name and a wrong password,
  so the endpoint cannot be used to discover who has an account.
- The password endpoints are throttled per IP. The counters live in Postgres,
  not in process memory, because each serverless instance would otherwise hand
  out its own separate allowance.
- Usernames are unique by database index, not just by the check before the
  insert, so two signups racing on the same name resolve to one winner and a
  clean "already taken" for the other.
- Deleting a user cascades to their sessions, tasks and preferences.

Using it without an account is still a first-class path — the "On this device"
chip means the browser is the only place your tasks exist.

### Migrating local data into an account

If you have been using YanTasks signed out, it never strands the data on the
device. Two moments raise the question, and both offer the same two answers:

- **Move it into my account** — tasks, tracked time, and stored preferences
  are written to the account, and the device copy is cleared. The local
  copy is only cleared once the server confirms it stored them, so a failure
  along the way (a taken username, say) leaves your data exactly where it was.
- **Leave it on this device** — the account stays empty and the device keeps
  its copy. Sign out and it is there again.

**Creating an account** asks before the account exists, so the data is part of
the signup itself.

**Signing in** asks only when the account is completely empty — no tasks and no
schedule — and this device has something. An account holding anything at all is
left alone: both copies matter at that point, and silently overwriting either
one is not a call to make on your behalf.

Retired end-time preferences and recommendations do not by themselves count as
account data for this prompt. They still round-trip through storage untouched.

Because you are already signed in by the time this question comes up, dismissing
it is a real answer — the same as leaving the copy on the device.

Whichever store is active, the app writes to one and only one of them: switching
accounts never bleeds one user's tasks into another's, or into the guest space.
Signed-in edits are debounced and flushed on tab hide, and the chip beside your
username shows a live sync state — including a retry if a save fails.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Q` | New task |
| `G` | Start or pause tracking |
| `↵` | Create the task |
| `Esc` | Close anything |
| `?` | Shortcut reference |

## Quick add with inline dates

Press `Q`, type the name, and end it with a date. The date is parsed out of the
title and the phrase is stripped from the name, so `Finish the lab report tmr`
becomes a task named "Finish the lab report" due tomorrow. A live preview shows
what will be created before you hit enter.

Recognized trailing phrases:

- `today`, `tdy`, `tonight`
- `tomorrow`, `tmr`, `tmrw`, `tmw`
- `yesterday`, `yday`, `ytd`
- any weekday — `wednesday`, `wed`, `next fri`. Always the **next** occurrence,
  so `wednesday` typed on a Wednesday lands on the following Wednesday.
- `aug 28`, `august 28th`, `28 aug`, `aug 28 2027`
- `8/28`, `8/28/2027`, `2026-09-01`
- `in 3 days`, `in a week`, `in 2 weeks`, `5 days ago`, `next week`, `next month`
- `this weekend` / `next weekend` — the coming Saturday
- `the 25th` — that day this month, or the next month that has it

The words introducing the date are swallowed too, all of them, so `essay draft
by next thursday` is named "essay draft" and not "essay draft by". `on`, `by`,
`due`, `at`, `for`, `before`, `until`, `this`, `next` and `the` all count. `in`
deliberately does not: `turn in tomorrow` keeps its particle and stays "turn
in".
Month/day without a year stays in the current year when it is at most 90 days
past (an overdue task) and rolls to next year beyond that. Anything unrecognized
is left alone as part of the name, and the date defaults to today. You can
always override the date by hand in the details section or by editing the task.

## Ordered one-hour rotation

Tasks are displayed by due date, then creation time. The shared picker decides
which open task to track; the only timer controls are **Start** and **Pause**.
A normal turn ends at the next hour mark of today's tracked time, then the next eligible
task starts automatically. Earlier partial work counts: 50 minutes tracked
means 10 minutes remain until the first hour, not another full hour. Start
resumes a partially tracked turn. Only a task's checkbox marks it complete.

Each day starts at zero. At midnight in the timer's saved time zone, tracked
task times and partial turns reset and tracking pauses. Press Start to begin
again at the top; the task list and completion checkboxes are unchanged. This
also happens on reopening after the app was closed or the device was asleep.
New tasks start at zero and catch up to
the preceding task before the next round. For example, totals of **2h, 0h, 2h**
give the middle task two consecutive one-hour turns. When earlier tracked time
leaves a fractional gap, a later task is eligible only if its next hour mark
fits beneath the preceding task's total. Thus 1h 6m, 1h, 0h gives the third
task a turn, rather than adding six more minutes to the second task. A
shorter catch-up is allowed when repairing an actual rise in historical or
reordered totals, so it never overtakes the preceding task. The progress bar
credits work already tracked toward the current hour.

The web UI shows the current task, remaining turn time, a subtle preview of the
next task, and each task's tracked time today. Edit changes the title,
description, or due date and also offers deletion. Completed tasks can be
reopened from the Completed section, which shows the most recently completed
tasks first. Completed tasks expire one calendar month after completion (UTC,
clamped to the last day of shorter months). Cleanup runs automatically on
account load/sync and save, and locally for guests, including while the app is
open. Reopening a task cancels expiry; completing it again starts a new month.
Deleting a task does not subtract its already-tracked time.

There are no priorities, weights, daily recommendations, work windows, rest
budgets, outing advice, or settings controls. Legacy fields still round-trip
through persistence for migration; new tasks store an inert `priority: "low"`.

## Synchronization and notifications

Signed-in users share one timestamp-based timer and rotation in Postgres.
Revision-checked commands prevent simultaneous devices from overwriting one
another. Open clients project the same turn boundaries, daily reset and totals.
Changing a synced timer requires a server connection. Pending task edits keep
the existing sync status, error message, and Retry action.

Existing timers checkpoint under their previous calculation before migrating,
preserving work already tracked today and discarding only prior-day rotation
progress. Whole-state preference saves cannot overwrite the
account timer. Guest timers import only into accounts without a timer and
import paused. Rebuild clients together when deploying a calculation change.
Tracking requests require the `rotation-v3` protocol; old clients receive an
update-required response instead of interpreting the new timer with old rules.
Previously installed phone builds need a separate native update.

Use **Enable notifications** beneath the timer to request browser permission
for turn alerts. Browser notifications require the page open and follow the
last device to control tracking. Permission is read on launch and foreground;
refreshing never requests permission by itself.

## Appearance and accessibility

The web app follows the system's light or dark appearance through CSS, including
changes while it is open. Stored legacy theme preferences are left untouched.
Quick add and shortcut help use native dialogs with keyboard focus containment,
Escape dismissal, and focus restoration. Task fields are labelled, focus
indicators remain visible, and the countdown does not announce every second.

## Tests

```bash
npm test
```

The suite covers shared tracking behavior, date parsing, persistence,
authentication, sync, and legacy migration. Database tests use PGlite and need
no `DATABASE_URL`.

Validate the web app separately with:

```bash
npx tsc --noEmit --incremental false
npm run build
```
