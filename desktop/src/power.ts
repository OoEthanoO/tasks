import { type TrackingState } from "../../lib/tracking";

/** Polling is independent of display refresh. No one-second background loop. */
export function syncDelay(active: boolean, visible: boolean, battery: boolean): number {
  if (active) return battery ? 30_000 : visible ? 5_000 : 15_000;
  return visible ? battery ? 30_000 : 15_000 : 60_000;
}

export function wakeDelay(visible: boolean, nextEventIn: number | null): number {
  const display = visible ? 1000 : 60_000;
  return Math.max(100, Math.min(display, nextEventIn === null ? Infinity : nextEventIn + 25));
}
/** A paused turn is static: only running work needs a live clock. */
export function hasLiveCountdown(state: TrackingState): boolean {
  return state.mode === "work";
}

/** Stable during a turn, including polls; changes even when the same task gets
 * consecutive turns. That keeps boundary wakeups exact after a catch-up turn. */
export function eventScheduleKey(state: TrackingState): string {
  const turn = state.rotation?.turn;
  const boundary = state.mode === "work" && turn ? Math.round(state.cursor + turn.durationMs - turn.elapsedMs) : null;
  return JSON.stringify([state.revision, state.dayKey, state.timeZone, state.mode, state.taskId,
    state.rotation?.version, state.rotation?.commandSeq, turn?.durationMs, boundary]);
}
