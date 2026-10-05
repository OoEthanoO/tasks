# YanTasks

A task manager that decides what you should work on next. Tasks are weighted by
how urgent they are and the priority you give them. The daily work goal is the
smallest whole-minute budget that gives every open task due within seven days
at least 30 minutes. Track the work whenever it suits you; pausing freezes it.

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

## Weights

With `n` = days until due (negative once overdue):

| Situation | Weight |
| --- | --- |
| Due tomorrow | `1` |
| Due the day after tomorrow | `1/2` |
| Due in `n` days | `1 / n` |
| Due today | `2` |
| Due yesterday | `3` |
| Due `d` days ago | `d + 2` |
| Completed | `0` |

In one line: `n >= 1 → 1/n`, otherwise `2 - n`.

Each task also has a **priority** that multiplies that curve:

| Priority | Multiplier |
| --- | --- |
| Low (default) | `×1` |
| Medium | `×2` |
| High | `×4` |

So a high-priority task due in four days (`4 × 1/4 = 1`) pulls exactly as hard
as a low-priority task due tomorrow. Tasks created before priorities existed
read as low. Weights display as exact fractions (`2/3`, `4/5`), never rounded.

Included tasks aim for proportional **work time** by weight. The day's work time
comes from the seven-day coverage goal below. The app balances final task totals
by weight while treating logged time as a lower bound. Tasks already above that
balance receive no extra time; all unfinished targets together fit the remaining
work goal.

Specifically, weighted water filling finds a level `L` such that
`sum(max(0, weight * L - tracked)) = remaining available work` over included tasks.
Each final target is `max(tracked, weight * L)`. This keeps overruns fixed instead
of erasing work already logged. Completed, deleted or out-of-window tasks keep
their historical work but receive no new allocation.
The **Work left** display is the day's work time not yet tracked. A task whose
tracked time meets its current target is **Done for today**, not permanently
completed. Changing included tasks' due dates, priorities or completion
recalculates future targets while preserving earned time. Later tasks show a 0%
share and cannot be tracked until they enter the seven-day window.

## Seven-day work targets

Only open tasks due on or before **today plus seven calendar days** are included.
Overdue tasks are included; later and permanently completed tasks receive no
allocation. On 2026-10-05, the inclusive cutoff is 2026-10-12.

The daily goal is the **smallest whole-minute budget** that gives every included
task at least **30 minutes**, with targets proportional to due-date and priority
weights. With no logged work, the least-weighted included task gets 30 minutes
and every other task gets `30 × its weight / the smallest weight` minutes; round
the summed goal up to a whole minute. For example, tasks due today (weight 2)
and in seven days (weight 1/7) need 420 and 30 minutes: a 450-minute goal.

There are no start/end hours, work:idle ratio, unweighted mode or adjustable
minimum. A goal is not capped by the time left today and may exceed the remaining
calendar day. Pausing freezes remaining work and never logs time, starts work
automatically, borrows from tomorrow or emits idle warnings.

Start takes the first unfinished included task in list order. Track on another
task holds that choice until its target is met, then the list resumes. Completion
alerts explain the next task. Finishing the goal stops tracking. Rename/reorder
and edits to excluded tasks do not change the goal; changes to included tasks,
due dates, priorities or completion recalculate it, preserving every logged
total and per-task counter. Existing work is a lower bound, so overruns do not
erase history or prevent uncovered tasks from receiving 30 minutes.

The goal is saved with the shared timer, not recomputed each tick. Otherwise
tracking the smaller share first could prematurely shrink the goal when all
tasks have merely reached 30 minutes. Daily counters reset at midnight in the
shared time zone, the horizon and weights advance, and tracking starts paused.
No work automatically continues into a new day. Reset today's progress clears
only today's counters after confirmation, leaving tasks unchanged.

Signed-in clients share one timestamp-based Postgres timer. Revision-checked
commands prevent devices from overwriting each other. Closing an app does not
pause active tracking; changes require a fresh server connection. On upgrade,
`lib/legacy-tracking.ts` checkpoints elapsed work under the prior policy once,
then saves the new goal. Retired settings and schedule fields remain readable
for compatibility but do not control new budgets. Whole-state saves cannot
overwrite timer counters; guest imports seed only empty accounts and start paused.

Enable alerts for individual task completion and reaching the daily goal.
Browser alerts need a running page; iOS schedules OS notifications; Windows
uses its native background engine. Alerts belong to the device that last
started, paused or reset tracking. Reopen the phone app after changes elsewhere
to replace its scheduled alerts. This is not a background cross-device push
service. Alert permissions are checked on launch and foreground without
prompting again.

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

Assertions covering date parsing, the weight formulas, the absolute Rest
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
