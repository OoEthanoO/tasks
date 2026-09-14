import { sanitizeEndTime, sanitizeSchedule } from "./app-state";
import { AppState, Recommendation, Task } from "./types";
import { parseTracking } from "./tracking";

// Unchanged key names: data written before accounts existed still loads, which
// is exactly the data a migration offers to move.
const KEYS = {
  tasks: "yantasks.tasks.v1",
  recommendation: "yantasks.recommendation.v1",
  schedule: "yantasks.schedule.v1",
  endTime: "yantasks.endTime.v1",
} as const;

// Retain the retired key only for clearing guest data after migration.
const LEGACY_REST_MODE_KEY = "yantasks.restMode.v1";

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or blocked — the app still works for this session.
  }
}

/** The signed-out store: everything this browser is holding on its own. */
export const localStore = {
  load(): AppState {
    const tracking = parseTracking(read<unknown>("yantasks.tracking.v1", null));
    return {
      ...(tracking ? { tracking } : {}),
      tasks: read<Task[]>(KEYS.tasks, []),
      recommendation: read<Recommendation | null>(KEYS.recommendation, null),
      schedule: sanitizeSchedule(read<unknown>(KEYS.schedule, null)),
      endTime: sanitizeEndTime(read<string>(KEYS.endTime, "23:00")),
    };
  },

  save(state: AppState): void {
    write(KEYS.tasks, state.tasks);
    write(KEYS.recommendation, state.recommendation);
    write(KEYS.schedule, state.schedule);
    write(KEYS.endTime, state.endTime);
  },

  /** Called after a successful migration — the data now lives in the account. */
  clear(): void {
    if (typeof window === "undefined") return;
    for (const key of [...Object.values(KEYS), LEGACY_REST_MODE_KEY, "yantasks.tracking.v1"]) {
      try {
        window.localStorage.removeItem(key);
      } catch {
        // Nothing to do; the account copy is already authoritative.
      }
    }
  },
};

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
