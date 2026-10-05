# YanTasks for Windows

A local Windows desktop client using the same task interface, account API and
tracking calculations as the website and iPhone app. Sign in with your existing
YanTasks account to sync tasks, the work day, tracked work, resets and the current timer.
Guest data stays on this PC; it does not silently replace account data.

## Use

Install `release/YanTasks-Setup-1.0.0-x64.exe` (Windows x64). This initial build
is unsigned; Windows may show an unknown-publisher/SmartScreen warning. A public
release should be signed with the project's own code-signing certificate.

- Closing the main window keeps the timer and native alerts running in the tray.
- Click the tray icon to toggle the draggable, always-on-top mini tracker.
- Right-click it to pause/resume, switch tasks, open the task list or quit.
- The taskbar icon shows a working/idle overlay and progress. Hover it
  for thumbnail controls. Windows does not provide an app-defined text panel
  inside the standard taskbar; the mini tracker and tray tooltip show the stats.
- Windows settings in the app include alert sound, a test alert, and optional
  launch at sign-in (off by default). Installing creates the Start Menu shortcut
  needed for Windows notification identity.
- Alerts follow the device that last started, paused or reset tracking, avoiding a
  second set of PC alerts for a timer controlled from the phone or website.
  Until any device has, idle reminders alert everywhere.
- Once today's idle time runs out, the clock drains tomorrow's idle time, then
  later days'. Borrowed time carries across midnight and syncs across clients.
  Tracking never starts on its own, and Pause is always available while working.
- Quitting does **not** pause an account timer. Pause tracking first if finished.

### Battery and notification boundaries

Hidden renderers are background-throttled and receive no live state broadcasts.
The mini window is created only when opened and freed when hidden. Visible active
work and idle countdowns update once per second with no continuous animation;
completed/out-of-day displays do not need a one-second loop. Background
timer wakeups are scheduled for task and idle-time transitions or a one-minute heartbeat,
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

### Local alert diagnostics

`%APPDATA%\YanTasks\alert-diagnostics.jsonl` records alert requests, suppression
reasons, native notification show/failure callbacks, and changes in timer/alert
ownership or sync health. It distinguishes an alert requested by the engine from
one reported shown by Windows; neither proves that the user noticed the banner.
Task edits that reallocate time are reconciled against the updated task list before
elapsed alerts are delivered, including when a previously finished target reopens.

Diagnostics add no polling, timer, or network traffic. Only events/status changes
write to disk, not routine ticks. The current and previous logs are capped at
128 KiB each. Identifiers are hashed; task titles/descriptions, account/controller
IDs, cookies and credentials are not written. The files remain on this PC and
are never uploaded automatically. A disk/logging failure cannot stop tracking.

## Develop and verify

From the repository root, run `npm ci` once for the shared source dependencies.
Then in `desktop`:

```powershell
npm ci
npm run typecheck
npm test
npm run build
npm run smoke
npm run smoke -- --countdown-check
npm start
npm run dist
npm run smoke -- --packaged
```

`dist` builds an NSIS per-user installer without publishing. `smoke` runs an
isolated guest profile with production requests disabled; it verifies both
sandboxed renderers, bridge restrictions, native icons and hidden-window timer
controls. The engine tests simulate cross-device changes, conflicts, outages,
sleep, idle-time transitions and battery scheduling. Run root `npm test` and
`npm run build` when changing shared files.

`npm run smoke -- --power-check` adds a short hidden-idle CPU sample (not a
battery-life benchmark). `--packaged` checks the built executable rather than
the development Electron runtime.
`--countdown-check` verifies that the real main and mini idle countdowns advance
without manual ticks, then checks that hidden windows stop frequent wakeups and
receive no countdown updates. Its visible test windows are transparent and click-through.
Development runs use a separate `YanTasks Development` profile and Windows app
ID. Smoke runs use `YanTasks Test`; neither shares the installed app's shell
identity, so an Electron development shortcut cannot replace its taskbar/search
branding. Notification smoke checks run a temporary executable copy with unique
Windows product metadata, then remove its shortcut and copy. Electron derives
shortcut names from that metadata, not `app.setName`. The runner verifies the
installed YanTasks shortcut stays byte-for-byte unchanged.
`npm run smoke -- --packaged --alert-check` also sends one labelled test
notification and checks that Windows reports it shown in the isolated profile's
diagnostic log. It does not start, pause, or edit a real account timer.

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
