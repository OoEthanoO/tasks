/**
 * Where the account lives. A native build has no origin of its own, so this
 * points at the deployed web app — the same server, the same database, the
 * same session cookie. Override it with EXPO_PUBLIC_API_BASE to point the app
 * at a local `next dev` (use your machine's LAN IP, not localhost: the phone
 * resolves localhost to itself).
 */
export const API_BASE =
  process.env.EXPO_PUBLIC_API_BASE ?? "https://tasks.ethanyanxu.com";
