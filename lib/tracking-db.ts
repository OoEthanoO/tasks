import { ensureSchema, getSql } from "./sql";
import { actOnTracking, advanceTracking, configureTracking, createTracking, parseTracking, restSettings, trackingConfigKey, trackingDay, TrackingAction, TrackingState } from "./tracking";
import { Task } from "./types";
import type { RestSettings } from "./rest";

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
export async function commandTracking(userId: string, revision: number, action: TrackingAction, controllerId: string, timeZone: string, tasks: Task[], endTime: string, rest: RestSettings, now = Date.now()): Promise<TrackingState> {
  await ensureSchema();
  const initial = createTracking(tasks, endTime, timeZone, now, rest);
  await getSql().query("INSERT INTO tracking (user_id, state) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, JSON.stringify(initial)]);
  const previous = (await loadTracking(userId))!;
  if (revision !== previous.revision) throw new TrackingConflict();
  const configured = configureTracking(previous, tasks, endTime, now, rest);
  return replace(userId, previous, actOnTracking(configured, action, controllerId, now));
}
/** Task edits checkpoint the old policy first; never reallocate already earned time. */
export async function configureAccountTracking(userId: string, tasks: Task[], endTime: string, rest: RestSettings, now = Date.now()): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await loadTracking(userId);
    if (!previous || trackingConfigKey(previous.tasks, previous.endTime, restSettings(previous)) === trackingConfigKey(tasks, endTime, rest)) return;
    try {
      await replace(userId, previous, configureTracking(previous, tasks, endTime, now, rest));
      return;
    } catch (error) { if (!(error instanceof TrackingConflict)) throw error; }
  }
  throw new TrackingConflict();
}

/** Persist day rollover and the one-time allocation upgrade for every client. */
export async function readAccountTracking(userId: string, now = Date.now()): Promise<TrackingState | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    const previous = await loadTracking(userId);
    if (!previous || (previous.dayKey === trackingDay(now, previous.timeZone) && previous.allocationVersion === 2)) return previous;
    try { return await replace(userId, previous, advanceTracking(previous, now).state); }
    catch (error) { if (!(error instanceof TrackingConflict)) throw error; }
  }
  throw new TrackingConflict();
}

/** Migration may seed an empty account, never replace its existing timer. */
export async function importAccountTracking(userId: string, incoming: TrackingState, tasks: Task[], endTime: string, rest: RestSettings, now = Date.now()): Promise<void> {
  await ensureSchema();
  const state = configureTracking(incoming, tasks, endTime, now, rest);
  state.mode = "idle"; state.taskId = null; state.controllerId = null; state.revision = 0;
  await getSql().query("INSERT INTO tracking (user_id, state) VALUES ($1, $2) ON CONFLICT (user_id) DO NOTHING", [userId, JSON.stringify(state)]);
}
