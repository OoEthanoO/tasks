// A DateKey is a local calendar day, "YYYY-MM-DD". All due dates are stored this
// way so that "days between" math never trips over timezones or DST.
export type DateKey = string;

const MS_PER_DAY = 86_400_000;

export function toKey(d: Date): DateKey {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Local midnight for the given key. */
export function fromKey(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function todayKey(): DateKey {
  return toKey(new Date());
}

/** Whole calendar days from `b` to `a` (positive when `a` is later). */
export function diffDays(a: DateKey, b: DateKey): number {
  return Math.round((fromKey(a).getTime() - fromKey(b).getTime()) / MS_PER_DAY);
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() + n);
  return copy;
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Today", "Tomorrow", "Wed, Aug 28" — short, human labels for a due date. */
export function formatDueDate(key: DateKey, today: DateKey = todayKey()): string {
  const delta = diffDays(key, today);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";

  const d = fromKey(key);
  const base = `${WEEKDAYS[d.getDay()].slice(0, 3)}, ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const thisYear = fromKey(today).getFullYear();
  return d.getFullYear() === thisYear ? base : `${base} ${d.getFullYear()}`;
}

/** "3 days overdue", "due in 4 days" — the phrasing behind a task's weight. */
export function describeDelta(key: DateKey, today: DateKey = todayKey()): string {
  const delta = diffDays(key, today);
  if (delta === 0) return "due today";
  if (delta === 1) return "due tomorrow";
  if (delta > 1) return `due in ${delta} days`;
  if (delta === -1) return "1 day overdue";
  return `${-delta} days overdue`;
}

export function formatTime(d: Date): string {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, "0");
  const suffix = h >= 12 ? "PM" : "AM";
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${m} ${suffix}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${formatDueDate(toKey(d))} at ${formatTime(d)}`;
}
