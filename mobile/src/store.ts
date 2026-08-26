import AsyncStorage from "@react-native-async-storage/async-storage";
import { sanitizeState } from "../../lib/app-state";
import { AppState } from "../../lib/types";

// The signed-out store. The web app keeps the same four keys in localStorage;
// these are this device's copy and never leave it until a migration moves them.
const KEYS = {
  tasks: "yantasks.tasks.v1",
  recommendation: "yantasks.recommendation.v1",
  schedule: "yantasks.schedule.v1",
  endTime: "yantasks.endTime.v1",
  restMode: "yantasks.restMode.v1",
} as const;

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
    const [tasks, recommendation, schedule, endTime, restMode] = await Promise.all([
      read(KEYS.tasks),
      read(KEYS.recommendation),
      read(KEYS.schedule),
      read(KEYS.endTime),
      read(KEYS.restMode),
    ]);
    // Everything read back off the device goes through the same coercion the
    // server applies, so a half-written key cannot take the app down.
    return sanitizeState({ tasks, recommendation, schedule, endTime, restMode });
  },

  async save(state: AppState): Promise<void> {
    try {
      await AsyncStorage.multiSet([
        [KEYS.tasks, JSON.stringify(state.tasks)],
        [KEYS.recommendation, JSON.stringify(state.recommendation)],
        [KEYS.schedule, JSON.stringify(state.schedule)],
        [KEYS.endTime, JSON.stringify(state.endTime)],
        [KEYS.restMode, JSON.stringify(state.restMode)],
      ]);
    } catch {
      // Out of space or storage unavailable — the session still works.
    }
  },

  /** Called after a successful migration: the account copy is authoritative. */
  async clear(): Promise<void> {
    try {
      await AsyncStorage.multiRemove(Object.values(KEYS));
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
