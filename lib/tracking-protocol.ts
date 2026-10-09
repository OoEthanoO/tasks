/** A calculation change needs matching clients, not silently reinterpreted timers. */
export const TRACKING_PROTOCOL_HEADER = "X-YanTasks-Tracking-Protocol";
export const TRACKING_PROTOCOL = "rotation-v3";
export const TRACKING_UPDATE_REQUIRED = "Update YanTasks to reset tracked time every night. On the website, refresh this page; on a phone or PC, install the latest app.";
export function supportsTrackingProtocol(headers: Pick<Headers, "get">): boolean {
  return headers.get(TRACKING_PROTOCOL_HEADER) === TRACKING_PROTOCOL;
}
