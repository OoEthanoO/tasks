/** Polling is independent of display refresh. No one-second background loop. */
export function syncDelay(active: boolean, visible: boolean, battery: boolean): number {
  if (active) return battery ? 30_000 : visible ? 5_000 : 15_000;
  return visible ? battery ? 30_000 : 15_000 : 60_000;
}

export function wakeDelay(visible: boolean, nextEventIn: number | null): number {
  const display = visible ? 1000 : 60_000;
  return Math.max(100, Math.min(display, nextEventIn === null ? Infinity : nextEventIn + 25));
}
