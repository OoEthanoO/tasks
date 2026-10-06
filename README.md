# YanTasks

A deadline-paced work tracker. Add tasks and due dates, then start when you can
work and pause when you cannot. A daily recommendation scales with deadline
pressure, while a persistent fair rotation gives even distant tasks a turn.
There are no school-day categories, look-ahead cutoffs, or idle allowances.

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

Signed out, everything lives in `localStorage` — tasks, the last
recommendation, and the schedule all survive a reload. Sign in and the same data
lives in your account instead, so it follows you between browsers.

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

- **Move it into my account** — tasks, schedule, last recommendation and end
  time are written to the account, and the device copy is cleared. The local
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

Two things deliberately do not count as data. A customized end time is a
preference rather than something you would lose. A stored recommendation is a
leftover: nothing creates or clears one now that the Up next card is gone, so
counting it would leave anyone who drew one before then with an account that
never reads as empty, and no offer to move the tasks still on their device.
Both still round-trip through storage untouched.

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

## Daily recommendation

For each unfinished task, let `d = max(0, calendar days until due)`. Its contribution
is `60 / (d + 1)` minutes. Add the contributions, round **up** to the nearest
30 minutes, and cap at **3 hours every day**. No tasks means no recommended work.

For example, tasks due today, tomorrow and in 5 days contribute 60 + 30 + 10 =
100 minutes, rounded to 2 hours. All open tasks count, even those far in the
future. Completed tasks do not. The 3-hour ceiling protects time away from work;
this recommendation is a pacing heuristic, **not an estimate or guarantee of
finishing every task**. The UI warns when uncapped pressure exceeds the ceiling.

Waiting never consumes a work/idle quota or shrinks the recommendation. It
recalculates when tasks are added, removed, completed or rescheduled, and on the
next account-local calendar day. Changes never erase earned work. Existing
priorities, start times, ratios, minimum settings and schedule data remain
readable for compatibility, but do not affect pacing and have no current controls.

## Fair 30-minute turns

Each open task has a rotation weight of `1 + 1 / (d + 1)`, between 1× and 2×.
Near deadlines get a bounded boost rather than exclusive access. Actual tracked
time divided by the weight at the time it was worked accumulates as virtual
service. The task with the least service is suggested next; exact ties use due
date then creation order. New tasks join at the current service frontier, with
no debt for time before they existed. Rotation history carries across days, so
a small daily recommendation cannot repeatedly starve the same later tasks.

Start resumes a partial turn or begins the suggested task. You can choose any
open task instead. Tracking pauses at 30 minutes and alerts you; choose the next
task or **Continue** the same one. It never silently starts logging a different
task. Completing or deleting the active task pauses, preserving all earned time.
Only the task checkbox means the task itself is finished.

The daily recommendation also pauses the timer when reached. You may explicitly
track extra work, including after bedtime. Daily counters reset at account-local
midnight and tracking pauses, but rotation and an unfinished turn are retained.
Nothing untracked becomes work or debt.

**Reset today’s progress** clears daily work and pauses after confirmation. It
does not erase task metadata or the long-term rotation. The daily reset cannot
be undone.

## Optional outings

**Can I go out now?** reserves the remaining recommendation, round-trip travel,
and any other time you want to keep free (meals, commitments, buffer) before
bedtime. The rest is the suggested maximum time at the outing. It assumes leaving
now, equal travel each way, and availability to work afterward. Pause tracking
before going. This checks whether the recommendation fits, not whether real task
completion is guaranteed. Bedtime affects this advice only.

## Synchronization and alerts

Signed-in users share one timestamp-based timer and rotation in Postgres.
Revision-checked commands prevent simultaneous devices overwriting one another.
Web/iOS poll while open and project the same timestamps; Windows uses its
battery-aware main-process engine. Only one explicitly chosen task is credited,
even while an app is closed. Offline elapsed work stops at the same turn/goal
boundary; changing an account timer requires a server connection.

Existing timers migrate once: elapsed time is checkpointed under the frozen
previous calculation before pacing begins, preserving today's total/per-task
work, current tracking state, and notification owner. Old whole-state preference
saves cannot overwrite the timer. Guest timers import only into accounts without
a timer and always import paused. Refresh clients and rebuild native clients
together when deploying a calculation change.

Alerts cover the end of a turn, reaching the recommendation, and an actively
tracked turn crossing midnight. Alerts follow the last controlling device.
Browser alerts require the page open; iOS schedules with the OS; Windows needs
an awake PC with the app running. OS notification settings may silence delivery.
Open iOS after changing tracking elsewhere to replace stale scheduled alerts;
this is not a cross-device background push service. Permission state is read
on launch and on foreground, without re-prompting on refresh.

## Appearance

Light and dark, on both the web app and the phone. The control offers three
states — **System**, **Light**, **Dark** — and the choice is remembered per
device (`localStorage` on the web, `AsyncStorage` on the phone). System is the
default and follows the OS setting live; if the OS will not say which it wants,
the app stays dark, which is what it has always been.

The two apps share `lib/theme.ts` — the preference type, the storage key, and
the rule that turns a preference plus an OS setting into a scheme — so a
preference means the same thing on both. Only the palettes are per-platform:
CSS custom properties in `app/globals.css`, a plain object in
`mobile/src/theme.tsx`. The values are kept in step by hand.

Two things worth knowing if you touch this:

- On the web a small inline script in `app/layout.tsx` resolves the theme and
  stamps `data-theme` on `<html>` before the first paint, so there is no flash
  of the wrong colours. That is also why `<html>` carries
  `suppressHydrationWarning` — the server cannot know the stored choice.
- On the phone `StyleSheet.create` runs at import time, far too early to know
  the scheme, so themed styles are declared with `themed((c) => ({ … }))` and
  read with `useStyles(…)`. Both sheets are built once; the hook picks. A new
  component that hardcodes a colour will simply not follow the theme.

Elevation runs the other way in light: a card is white and the page behind it
is grey, where in dark the card is the lighter of the two. The accent and the
three status hues are darkened for light so they still carry 4.5:1 on white.

Note that `mobile/app.json` sets `userInterfaceStyle` to `automatic`. It was
`dark`, which pins `useColorScheme()` and would keep System from ever reporting
light — changing it needs a native rebuild, not just a reload.

## Tests

```bash
npm test
```

Current pacing tests cover uniform daily rules, distant-task fairness across days,
explicit turns, outing arithmetic, goal changes, clock/DST boundaries, revision
races and 500 legacy migration samples. A frozen legacy suite guards the exact
calculation used for existing elapsed time. Additional assertions cover date
parsing, the old weight formulas, the absolute Rest
share, proportional and evenly spread block allocation, block boundaries,
when a schedule goes stale, when regenerating is worth asking about,
loading older named breaks as plain Rest without changing their allocation,
work days that end after midnight, how blocks
resolve against a changed task list, how tasks sort into the four buckets,
rejecting
due dates that are only digit-shaped, credential rules,
password hashing, sanitizing untrusted state, login throttling, when a
migration is worth offering, how a stored theme preference resolves against the
OS setting, and an account/session/migration round-trip. The database tests run against PGlite —
real Postgres, in-process — so the SQL that ships to Neon is the SQL under test.
They need no `DATABASE_URL` and reach no network.
