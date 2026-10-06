/** Retired start/ratio settings. Retained only for old storage and elapsed-work migration. */
export type DayPlan = { startTime: string; workParts: number; idleParts: number };

export const DEFAULT_PLAN: Readonly<DayPlan> = Object.freeze({ startTime: "09:00", workParts: 1, idleParts: 1 });
/** Whole parts on each side of the ratio. */
export const SPLIT_PARTS = Object.freeze({ min: 1, max: 20 });

/** Clamp to a whole number in range; a value that is not a number at all falls back. */
export function clampWhole(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** A same-day "HH:MM" wall time, normalized to two-digit hours. */
export function sanitizeClockTime(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !/^\d{1,2}:\d{2}$/.test(value)) return fallback;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Coerce untrusted input (storage, the wire, a half-typed field) into a valid
 * plan. Never throws: out-of-range parts are clamped, and anything
 * unrecognizable becomes the default.
 */
export function sanitizePlan(value: unknown): DayPlan {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_PLAN };
  const v = value as Record<string, unknown>;
  return {
    startTime: sanitizeClockTime(v.startTime, DEFAULT_PLAN.startTime),
    workParts: clampWhole(v.workParts, SPLIT_PARTS, DEFAULT_PLAN.workParts),
    idleParts: clampWhole(v.idleParts, SPLIT_PARTS, DEFAULT_PLAN.idleParts),
  };
}

export function samePlan(a: DayPlan, b: DayPlan): boolean {
  return a.startTime === b.startTime && a.workParts === b.workParts && a.idleParts === b.idleParts;
}
