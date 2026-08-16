# YanTasks — mobile

The phone client for [tasks.ethanyanxu.com](https://tasks.ethanyanxu.com). Same
account, same database, same weights: this app imports `../lib` directly rather
than reimplementing any of it, so the roulette math and the schedule builder
exist in exactly one place.

## Run it on your iPhone

No Mac required.

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
| Weights, schedule, date parsing, state coercion | `../lib` (shared with the web app) |
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
