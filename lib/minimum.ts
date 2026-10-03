import { clampWhole } from "./plan";

export const DEFAULT_MINIMUM_MINUTES = 30;
/** Whole minutes, up to a full day. Turning the minimum off is a separate setting. */
export const MINIMUM_MINUTES = Object.freeze({ min: 1, max: 1440 });

export function sanitizeMinimumMinutes(value: unknown): number {
  return clampWhole(value, MINIMUM_MINUTES, DEFAULT_MINIMUM_MINUTES);
}
