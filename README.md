# YanTasks

A task manager that decides what you should work on next. Tasks are weighted by
how urgent they are, and the recommender draws one at random in proportion to
those weights.

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

### Migrating local data into a new account

If you have been using YanTasks signed out and then create an account, it asks
what to do with the data already on the device before the account is created:

- **Move it into my account** — tasks, schedule, last recommendation and end
  time are written to the account, and the device copy is cleared. The local
  copy is only cleared once the server confirms it stored them, so a failed
  signup (a taken username, say) leaves your data exactly where it was.
- **Start fresh** — the account begins empty and the device keeps its copy. Sign
  out and it is there again.

Signing in to an *existing* account does not touch local data; it stays on the
device and reappears when you sign out.

Whichever store is active, the app writes to one and only one of them: switching
accounts never bleeds one user's tasks into another's, or into the guest space.
Signed-in edits are debounced and flushed on tab hide, and the chip beside your
username shows a live sync state — including a retry if a save fails.

## Keyboard shortcuts

| Key | Action |
| --- | --- |
| `Q` | New task |
| `R` | Draw a recommendation |
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
`1/7`. It is never listed and cannot be completed, but it competes for every
draw — one task due today gives a total weight of `2 + 1/7 = 15/7`, so that task
has a `14/15` = 93.3% chance and Rest takes the remaining 6.7%.

Each task row shows its own percentage, which is its weight over the total
including Rest. Completing a task zeroes its weight, so it can never be drawn
again, and every other percentage rises to fill the gap.

## Schedule

`G` blocks out the rest of the working day in 30-minute slots, running the
recommender independently for each one. The first block is a stub from right now
to the next :00 or :30, so at 8:32 AM you get 8:32–9:00, then 9:00–9:30, and so
on until the end of the work day (configurable, default 11:00 PM). The block
covering the current time is highlighted.

A schedule is only valid for the day and the task list it was built from. It is
flagged as outdated when the day rolls over, or when any task is added, deleted,
completed, or has its due date moved. Renaming a task does not invalidate it,
since the weights are unchanged.

## Tests

```bash
npm test
```

171 assertions covering date parsing, the weight formulas, probability with the
hidden Rest task, block boundaries, schedule staleness, credential rules,
password hashing, sanitizing untrusted state, login throttling, and an
account/session/migration round-trip. The database tests run against PGlite —
real Postgres, in-process — so the SQL that ships to Neon is the SQL under test.
They need no `DATABASE_URL` and reach no network.
