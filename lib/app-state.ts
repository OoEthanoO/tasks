import { todayKey } from "./dates";
import {
  AppState,
  Recommendation,
  Schedule,
  ScheduleBlock,
  Task,
} from "./types";

export const DEFAULT_END_TIME = "23:00";

/** Guard rails on anything crossing the wire or coming out of localStorage. */
const MAX_TASKS = 2000;
const MAX_BLOCKS = 200;
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 5000;

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;

export function emptyState(): AppState {
  return {
    tasks: [],
    recommendation: null,
    schedule: null,
    endTime: DEFAULT_END_TIME,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown, max: number, fallback = ""): string {
  return typeof value === "string" ? value.slice(0, max) : fallback;
}

function dateKey(value: unknown, fallback: string): string {
  return typeof value === "string" && DATE_KEY.test(value) ? value : fallback;
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return Number.isNaN(Date.parse(value)) ? null : value;
}

function iso(value: unknown, fallback: string): string {
  return isoOrNull(value) ?? fallback;
}

export function sanitizeEndTime(value: unknown): string {
  if (typeof value !== "string" || !TIME.test(value)) return DEFAULT_END_TIME;
  const [h, m] = value.split(":").map(Number);
  if (h > 23 || m > 59) return DEFAULT_END_TIME;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function sanitizeTask(raw: unknown, today: string, now: string): Task | null {
  if (!isRecord(raw)) return null;
  const id = str(raw.id, 100);
  const title = str(raw.title, MAX_TITLE).trim();
  if (!id || !title) return null;

  const completed = raw.completed === true;
  return {
    id,
    title,
    description: str(raw.description, MAX_DESCRIPTION),
    dueDate: dateKey(raw.dueDate, today),
    completed,
    createdAt: iso(raw.createdAt, now),
    completedAt: completed ? (isoOrNull(raw.completedAt) ?? now) : null,
  };
}

function sanitizeRecommendation(raw: unknown, now: string): Recommendation | null {
  if (!isRecord(raw)) return null;
  const title = str(raw.title, MAX_TITLE);
  if (!title) return null;
  return {
    taskId: typeof raw.taskId === "string" ? raw.taskId.slice(0, 100) : null,
    title,
    generatedAt: iso(raw.generatedAt, now),
  };
}

function sanitizeBlock(raw: unknown): ScheduleBlock | null {
  if (!isRecord(raw)) return null;
  const start = isoOrNull(raw.start);
  const end = isoOrNull(raw.end);
  if (!start || !end) return null;
  return {
    start,
    end,
    taskId: typeof raw.taskId === "string" ? raw.taskId.slice(0, 100) : null,
    title: str(raw.title, MAX_TITLE, "Rest"),
  };
}

function sanitizeSchedule(raw: unknown, today: string, now: string): Schedule | null {
  if (!isRecord(raw)) return null;
  if (!Array.isArray(raw.blocks)) return null;

  const blocks = raw.blocks
    .slice(0, MAX_BLOCKS)
    .map(sanitizeBlock)
    .filter((b): b is ScheduleBlock => b !== null);

  return {
    blocks,
    generatedAt: iso(raw.generatedAt, now),
    dayKey: dateKey(raw.dayKey, today),
    // A signature that does not match the task list simply reads as stale,
    // which is the safe direction to fail in.
    signature: str(raw.signature, 100_000),
    endTime: sanitizeEndTime(raw.endTime),
  };
}

/**
 * Coerce untrusted input into a well-formed AppState. Never throws — anything
 * unrecognizable is dropped rather than rejected, so a half-corrupt payload
 * still restores whatever was salvageable.
 */
export function sanitizeState(raw: unknown, now: Date = new Date()): AppState {
  if (!isRecord(raw)) return emptyState();

  const today = todayKey();
  const nowIso = now.toISOString();

  const seen = new Set<string>();
  const tasks: Task[] = [];
  if (Array.isArray(raw.tasks)) {
    for (const entry of raw.tasks) {
      if (tasks.length >= MAX_TASKS) break;
      const task = sanitizeTask(entry, today, nowIso);
      // Task ids are the primary key server-side, so duplicates cannot survive.
      if (!task || seen.has(task.id)) continue;
      seen.add(task.id);
      tasks.push(task);
    }
  }

  return {
    tasks,
    recommendation: sanitizeRecommendation(raw.recommendation, nowIso),
    schedule: sanitizeSchedule(raw.schedule, today, nowIso),
    endTime: sanitizeEndTime(raw.endTime),
  };
}

export function isEmptyState(state: AppState): boolean {
  return (
    state.tasks.length === 0 &&
    state.recommendation === null &&
    state.schedule === null
  );
}

/** "5 tasks", "1 task and a saved schedule" — what a migration would move. */
export function summarizeState(state: AppState): string {
  const parts: string[] = [];
  if (state.tasks.length > 0) {
    parts.push(`${state.tasks.length} task${state.tasks.length === 1 ? "" : "s"}`);
  }
  if (state.schedule) parts.push("a saved schedule");
  if (state.recommendation) parts.push("your last recommendation");

  if (parts.length === 0) return "nothing";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
