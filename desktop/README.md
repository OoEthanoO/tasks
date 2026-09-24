# YanTasks for Windows

A local Windows desktop client using the same task interface, account API and
tracking calculations as the website and iPhone app. Sign in with your existing
YanTasks account to sync tasks, work/rest time, resets and the current timer.
Guest data stays on this PC; it does not silently replace account data.

## Use

Install `release/YanTasks-Setup-1.0.0-x64.exe` (Windows x64). This initial build
is unsigned; Windows may show an unknown-publisher/SmartScreen warning. A public
release should be signed with the project's own code-signing certificate.

- Closing the main window keeps the timer and native alerts running in the tray.
- Click the tray icon to toggle the draggable, always-on-top mini tracker.
- Right-click it to pause/resume, switch tasks, open the task list or quit.
- The taskbar icon shows a working/resting/paused overlay and progress. Hover it
  for thumbnail controls. Windows does not provide an app-defined text panel
  inside the standard taskbar; the mini tracker and tray tooltip show the stats.
- Windows settings in the app include alert sound, a test alert, and optional
  launch at sign-in (off by default). Installing creates the Start Menu shortcut
  needed for Windows notification identity.
- Alerts follow the device that last starts or switches tracking, avoiding a
  second set of PC alerts for a timer controlled from the phone or website.
- Quitting does **not** pause an account timer. Pause tracking first if finished.

### Battery and notification boundaries

Hidden renderers are background-throttled and receive no live state broadcasts.
The mini window is created only when opened and freed when hidden. Visible active
clocks update once per second with no continuous animation; paused windows do not
need a one-second loop. Background
timer wakeups are scheduled for task/rest transitions or a one-minute heartbeat,
not a one-second loop. Account polling is 5 seconds when visible/active on AC,
15 seconds active in the background on AC, 30 seconds active on battery, and
60 seconds paused in the background. Task-list metadata refreshes every 30 seconds
while visible (and on focus); hidden task lists do not poll. The shell is updated
in 5/30-second buckets. Guest progress checkpoints once per active minute or at
a transition, with no recurring disk writes while paused.
No wake lock, high-resolution timer, background update downloader or automatic
startup registration is used. Guest mode makes no periodic server requests.

The PC must be awake and YanTasks running for desktop alerts. Windows Do Not
Disturb/notification settings can suppress them. Resume catches up the shared
timer without replaying a flood of old notifications. Network outages longer
than 90 seconds suppress account alerts until state is fresh again; failed
commands never create an independent offline account timer. Cross-device
changes can take up to one polling interval to arrive, especially on battery.

## Develop and verify

From the repository root, run `npm ci` once for the shared source dependencies.
Then in `desktop`:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run smoke
npm start
npm run dist
npm run smoke -- --packaged
```

`dist` builds an NSIS per-user installer without publishing. `smoke` runs an
isolated guest profile with production requests disabled; it verifies both
sandboxed renderers, bridge restrictions, native icons and hidden-window timer
controls. The engine tests simulate cross-device changes, conflicts, outages,
sleep, rest transitions and battery scheduling. Run root `npm test` and
`npm run build` when changing shared files.

`npm run smoke -- --power-check` adds a short hidden-idle CPU sample (not a
battery-life benchmark). `--packaged` checks the built executable rather than
the development Electron runtime.

Architecture: `src/engine.ts` owns tracking in Electron's main process;
`src/main.ts` owns native notifications, tray, taskbar, windows and power policy;
`src/preload.ts` exposes narrow validated IPC. Renderers use a restricted custom
origin with CSP, no Node access, no direct network access and no remote code.
Account cookies remain httpOnly in Electron's persistent account session.
Only fixed API endpoints at `https://tasks.ethanyanxu.com` are reachable through
the bridge. No user passwords or session tokens are copied into app settings.

Local preferences and guest progress live in Electron's per-user app-data
directory. Uninstalling preserves that data. Installation and tests do not
enable startup or change Windows notification/security settings.
