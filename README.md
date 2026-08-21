# YanTasks

A task manager that decides what you should work on next. Tasks are weighted by
how urgent they are, and the scheduler draws from them at random in proportion
to those weights — once per 30-minute block, to lay out the rest of your day.

```bash
npm install
npm run dev
```

Accounts need a Postgres connection string. Create a free database at
[neon.tech](https://neon.tech) and put its URL in `.env.local`:

```bash
DATABASE_URL="postgresql://user:password@host.neon.tech/dbname?sslmode=require"
```

Without it the app still runs — you just stay in "On this device" mode, and the
account buttons report that the server is unreachable. The tables are created on
first use, so there is no migration step.

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
- `in 3 days`, `in 2 weeks`, `5 days ago`, `next week`, `day after tomorrow`

A leading connector is swallowed too, so `essay due tomorrow` is named "essay".
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

There is a hidden task called **Rest** permanently in the pool at a weight of
`1` — the same pull as one task due tomorrow, in effect an extra tomorrow-task
that never gets crossed off. It is never listed and cannot be completed, but it
competes for every draw: one task due today gives a total weight of `2 + 1 = 3`,
so that task has a `2/3` = 66.7% chance and Rest takes the remaining 33.3%.

Because Rest is a constant while the task pile is not, its share shrinks as work
accumulates and grows back as you finish things:

| Your plate | Rest's share |
| --- | --- |
| 1 task due tomorrow | 50% |
| 1 task due today | 33% |
| 2 due today | 20% |
| 3 due today | 14% |
| a dozen mixed tasks | ~9% |
| 4 overdue plus a full list | ~4% |

Each task row shows its own percentage, which is its weight over the total
including Rest. Completing a task zeroes its weight, so it can never be drawn
again, and every other percentage rises to fill the gap.

## Schedule

`G` blocks out the rest of the working day in 30-minute slots, running the
recommender independently for each one. The first block is a stub from right now
to the next :00 or :30, so at 8:32 AM you get 8:32–9:00, then 9:00–9:30, and so
on until the end of the work day (configurable, default 11:00 PM). The block
covering the current time is highlighted.

An end time in the small hours means the night that is starting, not one that
has already gone: set the day to end at 12:00 AM at nine in the morning and you
get a schedule running until tonight's midnight. Once it is actually the small
hours that stops applying — at 2 AM a 1 AM end really has passed, and the day
really is over.

A schedule stays valid for as long as the span it covers, rather than for a
calendar day, so one generated at 11:50 PM to run until 1 AM is still the
current plan at half past midnight. It is flagged as outdated when it has run
past its last block, when the work day is set to end at a different time, or
when any task is added, deleted, completed, or has its due date moved. Renaming
a task does not invalidate it, since the weights are unchanged — the block
simply picks up the new name.

## Tests

```bash
npm test
```

257 assertions covering date parsing, the weight formulas, probability with the
hidden Rest task and how its share moves as work piles up, block boundaries,
when a schedule goes stale, work days that end after midnight, how blocks
resolve against a changed task list, rejecting
due dates that are only digit-shaped, credential rules,
password hashing, sanitizing untrusted state, login throttling, when a
migration is worth offering, and an account/session/migration round-trip. The database tests run against PGlite —
real Postgres, in-process — so the SQL that ships to Neon is the SQL under test.
They need no `DATABASE_URL` and reach no network.
