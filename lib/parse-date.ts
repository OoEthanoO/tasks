import { DateKey, addDays, toKey } from "./dates";

export type ParsedTitle = {
  /** The title with the trailing date phrase removed. */
  title: string;
  /** The resolved due date, if a trailing phrase was found. */
  dueDate: DateKey | null;
  /** The exact text that was consumed, for showing the user what happened. */
  matched: string | null;
};

const DAY_WORDS: Record<string, number> = {
  today: 0,
  tdy: 0,
  tod: 0,
  tonight: 0,
  tomorrow: 1,
  tmr: 1,
  tmrw: 1,
  tmw: 1,
  tom: 1,
  tmo: 1,
  "2mr": 1,
  yesterday: -1,
  yday: -1,
  ytd: -1,
  yest: -1,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0,
  sun: 0,
  monday: 1,
  mon: 1,
  tuesday: 2,
  tue: 2,
  tues: 2,
  wednesday: 3,
  wed: 3,
  weds: 3,
  thursday: 4,
  thu: 4,
  thur: 4,
  thurs: 4,
  friday: 5,
  fri: 5,
  saturday: 6,
  sat: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

/** Words that introduce a date and should be swallowed along with it. */
const CONNECTORS = new Set(["on", "by", "due", "at", "for", "@", "this", "next"]);

const MAX_PHRASE_WORDS = 4;

function normalize(token: string): string {
  return token
    .toLowerCase()
    .replace(/^[([{"'`,.!?:;-]+/, "")
    .replace(/[)\]}"'`,.!?:;]+$/, "");
}

function stripOrdinal(token: string): string {
  return token.replace(/^(\d{1,2})(st|nd|rd|th)$/, "$1");
}

/**
 * Pick the year for a month/day with no year attached. A date that already
 * passed this year stays in this year when it is recent — overdue tasks are a
 * first-class citizen here — but rolls forward once it is more than 90 days
 * stale, since that is far more likely to mean "next year".
 */
function resolveYearless(month: number, day: number, today: Date): Date | null {
  const candidates = [
    new Date(today.getFullYear(), month, day),
    new Date(today.getFullYear() + 1, month, day),
  ];
  // Reject impossible dates like Feb 30, which JS silently rolls over.
  const valid = candidates.filter(
    (d) => d.getMonth() === month && d.getDate() === day,
  );
  if (valid.length === 0) return null;

  const thisYear = valid[0];
  const daysAgo = Math.round(
    (today.getTime() - thisYear.getTime()) / 86_400_000,
  );
  if (daysAgo > 90 && valid.length > 1) return valid[1];
  return thisYear;
}

/** Next occurrence of a weekday, always strictly in the future. */
function nextWeekday(target: number, today: Date): Date {
  const delta = (target - today.getDay() + 7) % 7;
  return addDays(today, delta === 0 ? 7 : delta);
}

/** Try to read a whole phrase (already normalized, lowercase) as a date. */
function matchPhrase(words: string[], today: Date): Date | null {
  const t = words.join(" ");

  if (words.length === 1) {
    const w = words[0];
    if (w in DAY_WORDS) return addDays(today, DAY_WORDS[w]);
    if (w in WEEKDAYS) return nextWeekday(WEEKDAYS[w], today);

    // 8/28, 8-28, 8/28/2026, 2026-08-28
    const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(w);
    if (iso) {
      const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
      if (d.getMonth() === Number(iso[2]) - 1 && d.getDate() === Number(iso[3])) {
        return d;
      }
      return null;
    }
    const numeric = /^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?$/.exec(w);
    if (numeric) {
      const month = Number(numeric[1]) - 1;
      const day = Number(numeric[2]);
      if (month < 0 || month > 11 || day < 1 || day > 31) return null;
      if (numeric[3]) {
        let year = Number(numeric[3]);
        if (year < 100) year += 2000;
        const d = new Date(year, month, day);
        return d.getMonth() === month && d.getDate() === day ? d : null;
      }
      return resolveYearless(month, day, today);
    }
    return null;
  }

  if (words.length === 2) {
    const [a, b] = words;

    if (t === "next week") return addDays(today, 7);
    if (t === "this week") return addDays(today, 7);
    if (t === "next month") return addDays(today, 30);

    // "aug 28" / "august 28th"
    if (a in MONTHS) {
      const day = Number(stripOrdinal(b));
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        return resolveYearless(MONTHS[a], day, today);
      }
    }
    // "28 aug"
    if (b in MONTHS) {
      const day = Number(stripOrdinal(a));
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        return resolveYearless(MONTHS[b], day, today);
      }
    }
    return null;
  }

  if (words.length === 3) {
    const [a, b, c] = words;

    if (t === "day after tomorrow") return addDays(today, 2);
    if (t === "day before yesterday") return addDays(today, -2);

    // "in 3 days" / "in 2 weeks"
    if (a === "in" && /^\d{1,3}$/.test(b)) {
      const n = Number(b);
      if (/^days?$/.test(c)) return addDays(today, n);
      if (/^weeks?$/.test(c)) return addDays(today, n * 7);
    }
    // "3 days ago"
    if (/^\d{1,3}$/.test(a) && /^days?$/.test(b) && c === "ago") {
      return addDays(today, -Number(a));
    }
    // "aug 28 2026"
    if (a in MONTHS && /^\d{4}$/.test(c)) {
      const day = Number(stripOrdinal(b));
      if (Number.isInteger(day) && day >= 1 && day <= 31) {
        const d = new Date(Number(c), MONTHS[a], day);
        if (d.getMonth() === MONTHS[a] && d.getDate() === day) return d;
      }
    }
    return null;
  }

  if (words.length === 4) {
    if (t === "the day after tomorrow") return addDays(today, 2);
  }

  return null;
}

/**
 * Read a trailing date phrase off the end of a task title. Returns the cleaned
 * title plus the resolved date; if nothing matches the title comes back
 * untouched with a null date.
 */
export function parseTrailingDate(raw: string, now: Date = new Date()): ParsedTitle {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const trimmed = raw.trim();
  if (!trimmed) return { title: trimmed, dueDate: null, matched: null };

  const tokens = trimmed.split(/\s+/);
  const maxWords = Math.min(MAX_PHRASE_WORDS, tokens.length);

  // Longest match wins, so "next wednesday" beats a bare "wednesday".
  for (let k = maxWords; k >= 1; k--) {
    const slice = tokens.slice(tokens.length - k);
    const words = slice.map((w) => normalize(w));
    if (words.some((w) => w === "")) continue;

    const date = matchPhrase(words, today);
    if (!date) continue;

    let cut = tokens.length - k;
    // Swallow a preceding connector ("finish report by tomorrow").
    if (cut > 0 && CONNECTORS.has(normalize(tokens[cut - 1]))) {
      cut -= 1;
    }

    const title = tokens.slice(0, cut).join(" ").replace(/[,\-–:]+$/, "").trim();
    // A phrase with nothing in front of it is the task name, not a date.
    if (!title) continue;

    return {
      title,
      dueDate: toKey(date),
      matched: tokens.slice(cut).join(" "),
    };
  }

  return { title: trimmed, dueDate: null, matched: null };
}
