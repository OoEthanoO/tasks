import AsyncStorage from "@react-native-async-storage/async-storage";
import { sanitizeState } from "../../lib/app-state";
import { AppState } from "../../lib/types";
import { pruneCompletedTasks } from "../../lib/task-retention";

// The signed-out store. The web app keeps the same four keys in localStorage;
// these are this device's copy and never leave it until a migration moves them.
const KEYS = {
  tasks: "yantasks.tasks.v1",
  recommendation: "yantasks.recommendation.v1",
  schedule: "yantasks.schedule.v1",
  endTime: "yantasks.endTime.v1",
  plan: "yantasks.plan.v1",
  unweighted: "yantasks.unweighted.v1",
  minimumEnabled: "yantasks.minimumEnabled.v1",
  minimumMinutes: "yantasks.minimumMinutes.v1",
} as const;

// Retain the retired key only for clearing guest data after migration.
const LEGACY_REST_MODE_KEY = "yantasks.restMode.v1";
// The break settings the day plan replaced; cleared with the rest of guest data.
const LEGACY_REST_KEY = "yantasks.rest.v1";

async function read(key: string): Promise<unknown> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export const guestStore = {
  async load(): Promise<AppState> {
    const [tasks, recommendation, schedule, endTime, plan, unweighted, minimumEnabled, minimumMinutes, tracking] = await Promise.all([
      read(KEYS.tasks),
      read(KEYS.recommendation),
      read(KEYS.schedule),
      read(KEYS.endTime),
      read(KEYS.plan),
      read(KEYS.unweighted),
      read(KEYS.minimumEnabled),
      read(KEYS.minimumMinutes),
      read("yantasks.tracking.v1"),
    ]);
    // Everything read back off the device goes through the same coercion the
    // server applies, so a half-written key cannot take the app down.
    const state = sanitizeState({ tasks, recommendation, schedule, endTime, plan, unweighted, minimumEnabled, minimumMinutes, tracking });
    state.tasks = pruneCompletedTasks(state.tasks);
    if (JSON.stringify(tasks) !== JSON.stringify(state.tasks)) {
      try { await AsyncStorage.setItem(KEYS.tasks, JSON.stringify(state.tasks)); }
      catch { /* Storage unavailable; the in-memory list is still cleaned. */ }
    }
    return state;
  },

  async save(state: AppState): Promise<void> {
    try {
      await AsyncStorage.multiSet([
        [KEYS.tasks, JSON.stringify(pruneCompletedTasks(state.tasks))],
        [KEYS.recommendation, JSON.stringify(state.recommendation)],
        [KEYS.schedule, JSON.stringify(state.schedule)],
        [KEYS.endTime, JSON.stringify(state.endTime)],
        [KEYS.plan, JSON.stringify(state.plan)],
        [KEYS.unweighted, JSON.stringify(state.unweighted)],
        [KEYS.minimumEnabled, JSON.stringify(state.minimumEnabled)],
        [KEYS.minimumMinutes, JSON.stringify(state.minimumMinutes)],
      ]);
    } catch {
      // Out of space or storage unavailable — the session still works.
    }
  },

  /** Called after a successful migration: the account copy is authoritative. */
  async clear(): Promise<void> {
    try {
      await AsyncStorage.multiRemove([...Object.values(KEYS), LEGACY_REST_MODE_KEY, LEGACY_REST_KEY, "yantasks.tracking.v1"]);
    } catch {
      // Nothing to do.
    }
  },
};

export function newId(): string {
  // No crypto.randomUUID in the Hermes runtime.
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}
