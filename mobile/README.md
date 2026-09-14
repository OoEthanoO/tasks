# YanTasks — mobile

The phone client for [tasks.ethanyanxu.com](https://tasks.ethanyanxu.com). Same
account, same database, same weights: this app imports `../lib` directly rather
than reimplementing any of it, so the weighting and timestamp-based work timer
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
| Weights, tracking, date parsing, state coercion | `../lib` (shared with the web app) |
| API client | `../lib/remote.ts`, pointed at an absolute base by `src/config.ts` |
| Guest storage | `src/store.ts` — AsyncStorage, same four keys the web app uses in `localStorage` |
| Screen, sync loop, account flows | `App.tsx` — mirrors `app/page.tsx` |

Metro is configured (`metro.config.js`) to watch the repo root so `../lib`
resolves, and to ignore the root `node_modules` so the app cannot end up with a
second copy of React.

## Native builds

Expo Go covers development. A standalone `.ipa` for TestFlight or the App Store
needs either a Mac with Xcode or an EAS build (`npx eas build -p ios`), which is
a paid Expo service for private projects.

## Timer alerts

Enable alerts in the focus card. `expo-notifications` schedules task-complete,
rest-warning, rest-start and rest-complete alerts with iOS. A new native build is
required after this dependency change. Open the app after changing tracking on
another device so iOS can replace any old scheduled alerts. Time itself is
computed from the shared server timestamps and does not rely on notifications.

The local-notifications entitlement mod runs after `expo-notifications` to omit
the unused APNs entitlement. Local timer alerts do not register push tokens or
require the Push Notifications capability in the App Store signing profile.
The cleanup plugin is listed first because Expo nests entitlement mods.
