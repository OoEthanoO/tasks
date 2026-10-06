import { DEFAULT_MINIMUM_MINUTES, sanitizeMinimumMinutes } from "./minimum";
import { sanitizeEndTime } from "./app-state";
import { sanitizePlan } from "./plan";
import { ensureSchema, getSql } from "./sql";
import { actOnTracking, advanceTracking, configureTracking, createTracking, dayPlan, parseTracking, trackingConfigKey, trackingDay, TrackingAction, TrackingState } from "./tracking";
import { Task } from "./types";
import type { DayPlan } from "./plan";

export class TrackingConflict extends Error {
  constructor() { super("The timer changed on another device. It has been refreshed; please try again."); }
}
export async function loadTracking(userId: string): Promise<TrackingState | null> {
  await ensureSchema();
  const [row] = await getSql().query<{state: string; revision: number}>("SELECT state, revision FROM tracking WHERE user_id = $1", [userId]);
  if (!row) return null;
  const state = parseTracking(JSON.parse(row.state));
  if (!state) throw new Error("Stored tracking state is invalid.");
  return { ...state, revision: row.revision };
}
async function replace(userId: string, previous: TrackingState, next: TrackingState): Promise<TrackingState> {
  next.revision = previous.revision + 1;
  const rows = await getSql().query<{revision: number}>(
    "UPDATE tracking SET state = $1, revision = revision + 1 WHERE user_id = $2 AND revision = $3 RETURNING revision",
    [JSON.stringify(next), userId, previous.revision],
  );
  if (!rows.length) throw new TrackingConflict();
  return next;
}
export async function commandTracking(userId: string, revision: number, action: TrackingAction, controllerId: string, timeZone: string, tasks: Task[], endTime: string, plan: DayPlan, now = Date.now(), unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): Promise<TrackingState> {
  await ensureSchema();
  const initial = createTracking(tasks, endTime, timeZone, now, plan, unweighted, minimumEnabled, minimumMinutes);
  await getSql().query("INSERT INTO tracking (user_id, state) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, JSON.stringify(initial)]);
  const previous = (await loadTracking(userId))!;
  if (revision !== previous.revision) throw new TrackingConflict();
  const configured = configureTracking(previous, tasks, endTime, now, plan, unweighted, minimumEnabled, minimumMinutes);
  return replace(userId, previous, actOnTracking(configured, action, controllerId, now));
}
/** Task edits checkpoint the old policy first; never reallocate already earned time. */
export async function configureAccountTracking(userId: string, tasks: Task[], endTime: string, plan: DayPlan, now = Date.now(), unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await loadTracking(userId);
    if (!previous || (previous.rotation?.version === 1 && trackingConfigKey(previous.tasks, previous.endTime, dayPlan(previous), previous.unweighted, previous.minimumEnabled, previous.minimumMinutes) === trackingConfigKey(tasks, endTime, plan, unweighted, minimumEnabled, minimumMinutes))) return;
    try {
      await replace(userId, previous, configureTracking(previous, tasks, endTime, now, plan, unweighted, minimumEnabled, minimumMinutes));
      return;
    } catch (error) { if (!(error instanceof TrackingConflict)) throw error; }
  }
  throw new TrackingConflict();
}

/** Persist day rollover and allocation-policy upgrades for every client. */
export async function readAccountTracking(userId: string, now = Date.now()): Promise<TrackingState | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await loadTracking(userId);
    if (!previous || (previous.rotation?.version === 1 && previous.dayKey === trackingDay(now, previous.timeZone))) return previous;
    let restored = previous;
    if (previous.coverageVersion === 1) {
      // The range-based release ignored these settings but left the account's
      // preferences intact. Restore them without editing tasks or history.
      const [prefs] = await getSql().query<{ end_time: string; day_plan: string | null; unweighted: boolean; minimum_enabled: boolean; minimum_minutes: number }>(
        "SELECT end_time, day_plan, unweighted, minimum_enabled, minimum_minutes FROM prefs WHERE user_id = $1", [userId],
      );
      if (prefs) restored = { ...previous, endTime: sanitizeEndTime(prefs.end_time), plan: sanitizePlan(prefs.day_plan ? JSON.parse(prefs.day_plan) : null), unweighted: prefs.unweighted === true, minimumEnabled: prefs.minimum_enabled !== false, minimumMinutes: sanitizeMinimumMinutes(prefs.minimum_minutes) };
    }
    if (previous.workOnlyVersion === 1) {
      // Its calculation ignored this preference. Restore the saved day plan,
      // without applying it to the elapsed work-only interval being checkpointed.
      const [prefs] = await getSql().query<{ day_plan: string | null }>("SELECT day_plan FROM prefs WHERE user_id = $1", [userId]);
      if (prefs) restored = { ...restored, plan: sanitizePlan(prefs.day_plan ? JSON.parse(prefs.day_plan) : null) };
    }
    try { return await replace(userId, previous, advanceTracking(restored, now).state); }
    catch (error) { if (!(error instanceof TrackingConflict)) throw error; }
  }
  throw new TrackingConflict();
}

/** Migration may seed an empty account, never replace its existing timer. */
export async function importAccountTracking(userId: string, incoming: TrackingState, tasks: Task[], endTime: string, plan: DayPlan, now = Date.now(), unweighted = false, minimumEnabled = true, minimumMinutes = DEFAULT_MINIMUM_MINUTES): Promise<void> {
  await ensureSchema();
  const state = configureTracking(incoming, tasks, endTime, now, plan, unweighted, minimumEnabled, minimumMinutes);
  state.mode = "idle"; state.taskId = null; state.controllerId = null; state.revision = 0;
  await getSql().query("INSERT INTO tracking (user_id, state) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, JSON.stringify(state)]);
}
