# YanTasks — mobile

The phone client for [tasks.ethanyanxu.com](https://tasks.ethanyanxu.com). Same
account, same database, same one-hour rotation: this app imports `../lib` directly rather
than reimplementing any of it, so the rotation and timestamp-based work timer
exist in exactly one place.

## Run it on your iPhone

No Mac required. The project is pinned to **Expo SDK 54** to match the Expo Go
build the App Store ships — that is a lower number than npm's `latest`, and the
phone's "Supported SDK" (Expo Go → Settings → App Info) is what decides it, not
the newest SDK published. Check there before bumping `expo` in package.json.

1. Install **Expo Go** from the App Store.
2. From the repo root:

```bash
npm --prefix mobile start
```

3. Scan the QR code in the terminal with the iPhone camera. The phone and this
   machine have to be on the same Wi-Fi; add `--tunnel` if they are not.

## Run it in a browser

Useful for quick UI checks — it renders through `react-native-web`:

```bash
npm --prefix mobile run web
```

One caveat: a browser enforces CORS and the API sends no `Access-Control-Allow-Origin`
header, so sign-in and sync do not work in this mode and the app falls back to
guest storage. Native builds are not subject to CORS, so the phone syncs fine.

## Pointing it somewhere else

`EXPO_PUBLIC_API_BASE` overrides the server (defaults to the production URL):

```bash
EXPO_PUBLIC_API_BASE=http://192.168.1.20:3000 npm --prefix mobile start
```

Use your machine's LAN IP, not `localhost` — on the phone, `localhost` is the
phone.

## How it fits together

| Concern | Where |
| --- | --- |
| Ordered rotation, tracking, date parsing, state coercion | `../lib` (shared with the web app) |
| API client | `../lib/remote.ts`, pointed at an absolute base by `src/config.ts` |
| Guest storage | `src/store.ts` — AsyncStorage, matching the web app's persisted fields |
| Screen, sync loop, account flows | `App.tsx` — mirrors `app/page.tsx` |

Metro is configured (`metro.config.js`) to watch the repo root so `../lib`
resolves, and to ignore the root `node_modules` so the app cannot end up with a
second copy of React.

## Native builds

Expo Go covers development. For a standalone signed `.ipa`, use the
[Mac build server](MAC_BUILDER.md). It compiles with Xcode on the MacBook Pro and
can upload directly to Apple without Expo's cloud build/submission services.
The existing EAS configuration is retained as a manual fallback.

## Timer alerts

Start picks a task automatically and moves through one-hour turns until Pause.
Tracked totals carry across days. New tasks begin at zero and catch up in
one-hour turns before the normal ordered rounds resume; totals of 2h, 0h, 2h
give the middle task two one-hour turns. A fractional catch-up gap gets a shorter
turn so it cannot exceed the preceding task's total. Pause saves an unfinished
turn. Tracking continues across midnight; only the daily counter resets.

Enable alerts directly below the tracker. `expo-notifications` schedules
upcoming turn changes for the next 24 hours (at most 48 alerts) with iOS. Open the
app after changing tracking on
another device so iOS can replace any old scheduled alerts. Time itself is
computed by the shared tracker from timestamps and does not rely on notifications.
The interface follows the system appearance. Legacy preferences and task
priorities remain stored for compatibility but have no controls in the app.

The local-notifications entitlement mod runs after `expo-notifications` to omit
the unused APNs entitlement. Local timer alerts do not register push tokens or
require the Push Notifications capability in the App Store signing profile.
The cleanup plugin is listed first because Expo nests entitlement mods.
