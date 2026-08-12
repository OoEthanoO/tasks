import { Recommendation, Schedule, Task } from "./types";

const KEYS = {
  tasks: "yantasks.tasks.v1",
  recommendation: "yantasks.recommendation.v1",
  schedule: "yantasks.schedule.v1",
  endTime: "yantasks.endTime.v1",
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

export const storage = {
  loadTasks: () => read<Task[]>(KEYS.tasks, []),
  saveTasks: (tasks: Task[]) => write(KEYS.tasks, tasks),

  loadRecommendation: () => read<Recommendation | null>(KEYS.recommendation, null),
  saveRecommendation: (rec: Recommendation | null) => write(KEYS.recommendation, rec),

  loadSchedule: () => read<Schedule | null>(KEYS.schedule, null),
  saveSchedule: (schedule: Schedule | null) => write(KEYS.schedule, schedule),

  loadEndTime: () => read<string>(KEYS.endTime, "23:00"),
  saveEndTime: (endTime: string) => write(KEYS.endTime, endTime),
};

export function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
