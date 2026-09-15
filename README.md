# YanTasks

A task manager that decides what you should work on next. Tasks are weighted by
how urgent they are. Start a shared work timer, meet proportional daily targets,
and take a 30-minute rest after every 90 minutes of tracked work.

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

Open tasks aim for proportional **work time** by weight. Rest is separate.
The app first reserves all 90/30 breaks that fall before the cutoff, including
any unfinished break. It then balances final task totals by weight while treating
logged time as a lower bound. Tasks already above that balance receive no extra
time; all unfinished targets together fit the available work time.

Specifically, weighted water filling finds a level `L` such that
`sum(max(0, weight * L - tracked)) = remaining available work` over open tasks.
Each final target is `max(tracked, weight * L)`. This keeps overruns fixed instead
of asking other tasks to make up more time than the day contains. Completed or
deleted tasks keep their historical work but receive no new allocation.
The **Work left** display excludes reserved rest. A task whose tracked time meets
its current target is **Done for today**, not permanently completed. Changing
tasks or the cutoff recalculates future targets while preserving earned time.

## Work and rest tracking

Start chooses the highest-weight unfinished daily target in list order. Each
task also has a Track button. Reaching a target alerts you and moves to the next
eligible task. Ninety accumulated work minutes automatically start a 30-minute
rest, after which work resumes. Pausing either mode stops its counter and does
not bypass an unfinished break. Complete cycles are 75% work and 25% rest;
a shortened final cycle can differ.

The timer stops at the selected same-day cutoff (default 23:00). All daily
counters reset at midnight; tracking stays paused until you start the new day.
The first device starting an account timer establishes its time zone, which
all clients then share. There is no overnight carry-over.

Use **Reset today’s progress** to start fresh without waiting for midnight.
After confirmation, it clears all daily task, work, rest, and break-cycle counters
and pauses the shared timer. Tasks, permanent completion, and the end time stay
unchanged. Targets are recalculated from the time still left today; resetting
does not extend the day. The reset cannot be undone.

Signed-in users share one timestamp-based session in a separate Postgres row.
Revision-checked commands prevent two devices from overwriting the same timer.
Clients refresh it every three seconds, and compute elapsed time locally from
the same timestamps. An active timer continues when the app is closed or the
network drops; changing a signed-in timer requires the server. Legacy
whole-state saves cannot overwrite tracked time.
Existing timers are upgraded at a shared checkpoint: elapsed time under the old
allocation is preserved before the corrected calculation starts. Refresh web
clients and install the latest mobile build to use the same calculation everywhere.

Enable alerts to receive task completion, a five-minute rest warning, rest-start
and rest-complete notifications. The button reads the device's current permission
on launch and on returning to the app, so its status survives refreshes and
reflects permission changes in settings. iOS schedules these with the operating system;
web notifications require the page to remain open. Alerts belong to the device
that last started or switched tracking. If the timer is changed elsewhere while
the phone is suspended, open the phone app to refresh its scheduled alerts;
otherwise a previously scheduled alert can be stale. This is a local-notification
implementation, not a background cross-device push service.

Old schedule data remains readable for compatibility, but no schedule is
generated or displayed. It is never converted into worked time. Guest timer
data migrates only into an account that has no timer, and imports paused.

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
