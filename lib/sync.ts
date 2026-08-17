/**
 * When a client may take the server's copy of the state.
 *
 * The save path replaces a user's whole state, so two devices editing at once
 * will always be last-write-wins. What this decides is narrower and safer:
 * whether the copy this device is holding can be *replaced* by the account's
 * copy without losing anything the person typed here.
 */
export type AdoptInput = {
  /** An edit is debounced or queued for retry — it has not reached the server. */
  hasPendingWrite: boolean;
  /** A save is on the wire; the fetched copy may already be out of date. */
  saveInFlight: boolean;
  /** What this device is showing, serialized. */
  local: string;
  /** What the server just returned, serialized. */
  remote: string;
};

export function shouldAdoptRemote({
  hasPendingWrite,
  saveInFlight,
  local,
  remote,
}: AdoptInput): boolean {
  // Unsent edits outrank anything the server has: adopting here would silently
  // discard what someone typed on this device seconds ago.
  if (hasPendingWrite || saveInFlight) return false;
  // Identical copies are the common case — say no so nothing re-renders.
  return remote !== local;
}
