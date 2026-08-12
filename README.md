# YanTasks

A task manager that decides what you should work on next. Tasks are weighted by
how urgent they are, and the recommender draws one at random in proportion to
those weights.

```bash
npm install
npm run dev
```

Everything lives in `localStorage` — tasks, the last recommendation, and the
schedule all survive a reload. No backend.

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

| Situation | Weight |
| --- | --- |
| Due today | `1` |
| Due tomorrow | `1/2` |
| Due `n` days out | `1 / (n + 1)` |
| Due yesterday | `2` |
| Due `n` days ago | `n + 1` |
| Completed | `0` |

There is a hidden task called **Rest** permanently in the pool at a weight of
`1/7`. It is never listed and cannot be completed, but it competes for every
draw — one task due today gives a total weight of `8/7`, so that task has a
`7/8` = 87.5% chance and Rest takes the remaining 12.5%.

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

80 assertions covering date parsing, the weight formulas, probability with the
hidden Rest task, block boundaries, and schedule staleness.
