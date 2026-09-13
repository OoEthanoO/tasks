# YanTasks

A task manager that decides what you should work on next. Tasks are weighted by
how urgent they are, and the scheduler turns those weights into a balanced set
of 30-minute blocks for the rest of your day.

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
| `G` | Generate today's schedule |
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

**Rest has an absolute 1/4 share.** It is not another relative weight in the
task pile. Open tasks divide the remaining 3/4 in proportion to their due-date
weights, regardless of how many tasks there are or how urgent they are. With
one open task, that task gets 3/4 of the schedule; with two equal tasks, each
gets 3/8. If one task has twice another task's weight, it gets twice that
task's share of the working 3/4.

Each task row shows its target share of a generated schedule. Completing a
task zeroes its weight, so it receives no blocks, and the other open tasks
divide the working share between them. If there are no open tasks, every block
is Rest. All breaks are labelled **Rest**, including named breaks in older saved
schedules.

## Schedule

`G` blocks out the rest of the working day in 30-minute slots. It first assigns
each task and Rest the closest possible whole-block count for their target
shares, then uses smooth weighted round-robin to spread those blocks through
the day. Equal-weight tasks differ by at most one block, a task with twice the
weight gets approximately twice the runtime, and about one quarter of the blocks
are Rest. If equal tasks compete for an indivisible extra block, its owner is
chosen fairly at random instead of always favouring the first task. Very small
task shares can round down to zero blocks in a short day.

The first block is a stub from right now to the next :00 or :30, so at 8:32 AM
you get 8:32–9:00, then 9:00–9:30, and so on until the end of the work day
(configurable, default 11:00 PM). The block covering the current time is
highlighted.

An end time in the small hours means the night that is starting, not one that
has already gone: set the day to end at 12:00 AM at nine in the morning and you
get a schedule running until tonight's midnight. Once it is actually the small
hours that stops applying — at 2 AM a 1 AM end really has passed, and the day
really is over.

A schedule has to reflect the weights of the current task list at all times.
Anything that moves a weight invalidates it, because the alternative is worse:
if adding a task did not force a regenerate, that task would receive no share
of the schedule.

So it is flagged as outdated when it has run past its last block, when the date
changes, when the work day is set to end at a different time, or when any task
is added, deleted, completed, or has its due date moved. The date counts even
though nothing was edited — weights are measured against today, so at midnight
every one of them moves and a schedule that ran past midnight uses yesterday's
shares. Renaming a task does not invalidate it, since the weights
are unchanged — the block simply picks up the new name.

Regenerating when the schedule is *not* outdated asks first. `G` is a single
unmodified keystroke sitting next to nothing in particular, and a regenerate
rebuilds every block from the current time, so hitting it by accident would
quietly replace a schedule that was still describing your day correctly. A
schedule that is outdated regenerates straight away — it needs to, and a question there would
only be in the way — and so does one that does not exist yet, or one with no
blocks in it, since neither holds any picks worth keeping. The rule and the
wording both live in `lib/schedule.ts` so the two apps cannot drift.

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
