/**
 * How the timer alternates work and rest: a break of `restMinutes` after every
 * `workMinutes` of tracked work, or no breaks at all. A preference like the
 * work day end time: stored with the account (or on the device for guests)
 * and copied into the shared timer so every device counts cycles alike.
 */
export type RestSettings = { enabled: boolean; workMinutes: number; restMinutes: number };

export const DEFAULT_REST: Readonly<RestSettings> = Object.freeze({ enabled: true, workMinutes: 90, restMinutes: 30 });
/** Whole minutes. A stretch shorter than ten leaves no room for the five-minute warning to mean much. */
export const WORK_MINUTES = Object.freeze({ min: 10, max: 480 });
export const REST_MINUTES = Object.freeze({ min: 1, max: 120 });

/** Clamp to whole minutes in range; a value that is not a number at all falls back. */
export function clampMinutes(value: unknown, range: { min: number; max: number }, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/**
 * Coerce untrusted input (storage, the wire, a half-typed field) into valid
 * settings. Never throws: out-of-range lengths are clamped rather than
 * rejected, and anything unrecognizable becomes the default.
 */
export function sanitizeRestSettings(value: unknown): RestSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_REST };
  const v = value as Record<string, unknown>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULT_REST.enabled,
    workMinutes: clampMinutes(v.workMinutes, WORK_MINUTES, DEFAULT_REST.workMinutes),
    restMinutes: clampMinutes(v.restMinutes, REST_MINUTES, DEFAULT_REST.restMinutes),
  };
}

export function sameRest(a: RestSettings, b: RestSettings): boolean {
  return a.enabled === b.enabled && a.workMinutes === b.workMinutes && a.restMinutes === b.restMinutes;
}
