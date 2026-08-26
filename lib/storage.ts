import { sanitizeEndTime, sanitizeRestMode } from "./app-state";
import { AppState, Recommendation, Schedule, Task } from "./types";

// Unchanged key names: data written before accounts existed still loads, which
// is exactly the data a migration offers to move.
const KEYS = {
  tasks: "yantasks.tasks.v1",
  recommendation: "yantasks.recommendation.v1",
  schedule: "yantasks.schedule.v1",
  endTime: "yantasks.endTime.v1",
  restMode: "yantasks.restMode.v1",
} as const;

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
    return {
      tasks: read<Task[]>(KEYS.tasks, []),
      recommendation: read<Recommendation | null>(KEYS.recommendation, null),
      schedule: read<Schedule | null>(KEYS.schedule, null),
      endTime: sanitizeEndTime(read<string>(KEYS.endTime, "23:00")),
      restMode: sanitizeRestMode(read<unknown>(KEYS.restMode, null)),
    };
  },

  save(state: AppState): void {
    write(KEYS.tasks, state.tasks);
    write(KEYS.recommendation, state.recommendation);
    write(KEYS.schedule, state.schedule);
    write(KEYS.endTime, state.endTime);
    write(KEYS.restMode, state.restMode);
  },

  /** Called after a successful migration — the data now lives in the account. */
  clear(): void {
    if (typeof window === "undefined") return;
    for (const key of Object.values(KEYS)) {
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
