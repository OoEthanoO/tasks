# YanTasks on finprint-host

The website/API runs on native Windows behind the shared Caddy instance. Neon
remains the database. The hostname stays `tasks.ethanyanxu.com`, so browser
cookies, desktop/iOS API URLs, accounts, tracking revisions and device ownership
do not change. No database export/import or timer reset is part of deployment.

## Layout and secrets

`C:\ProgramData\YanTasks` is restricted to Administrators and SYSTEM:

- `repo`: clean, dedicated deployment checkout; never a developer's checkout.
- `secrets\production.json`: `{"DATABASE_URL":"<existing Neon URL>"}`. Keep this
  outside Git, build artifacts, chat, and logs. Vercel sensitive variables cannot
  be exported; obtain the existing connection string from Neon without rotating it.
- `releases`: independent standalone Node builds with matching `release.json`.
- `active.json`, `prepared.json`, `previous.json`: deployment/rollback metadata.
- `static`: retained immutable Next.js assets for tabs open during upgrades.
- `ops`, `logs`, `Caddyfile`, `server.json`: operational scripts/configuration.

The app only listens on `127.0.0.1:3200` or `:3201`. Do not expose those ports or
Neon credentials to the LAN/internet. Caddy terminates HTTPS and replaces incoming
`X-Forwarded-For` with the peer address before the app applies login throttling.
This assumes direct internet-to-Caddy traffic, not a Cloudflare HTTP proxy.

## Initial install and cutover

Run the scripts using Windows PowerShell 5.1 as the server administrator:

```powershell
& .\deploy\windows\install.ps1 `
  -CaddyExe 'C:\Users\ethan\AppData\Local\Microsoft\WinGet\Links\caddy.exe' `
  -MainCaddyfile 'C:\Users\ethan\finprint\scripts\selfhost\Caddyfile'
# Securely import the existing database URL into secrets\production.json.
& C:\ProgramData\YanTasks\ops\deploy.ps1 -PrepareOnly
& C:\ProgramData\YanTasks\ops\activate.ps1
```

Prepare builds/tests a clean Git revision, starts a separate scheduled task, and
checks database-backed `/api/health` without changing public traffic. Activate
adds only the YanTasks site import to Caddy and validates/reloads the full config.
It never restarts Caddy or edits the other applications' site blocks.

Only after preparation succeeds, update the authoritative DNS record for `tasks`
to a CNAME of `ai.ethanyanxu.com` (the existing dynamically updated home address),
TTL 60. Check authoritative nameservers first; do not change zone delegation.
Retain the Vercel deployment/domain as a rollback path. Wait for Caddy's public
certificate and test HTTPS, assets, `/api/auth/me`, and `/api/health` externally.
The latter must return the expected commit and `hosting: finprint-host`.

Enable `install.ps1 -EnableAutoDeploy` only after the first public cutover works.
It polls `main` every two minutes and on boot; a failed build/readiness check leaves
the current process serving. Web tasks start on boot and restart on failure. The
build and runtime both receive the same immutable commit identifier.

## Operations and rollback

```powershell
& C:\ProgramData\YanTasks\ops\status.ps1
Start-ScheduledTask yantasks-deploy
# For a deliberate rollback, first stop automatic deployment from reapplying main:
Disable-ScheduledTask yantasks-deploy
& C:\ProgramData\YanTasks\ops\activate.ps1 -Rollback
```

The two ports alternate. After switching Caddy, the previous task drains for 20
seconds, then only that release's task/process is stopped. Release files and old
assets are retained; inspect space periodically before manually pruning older
releases. Never remove the active/previous releases or the entire runtime root.
Deployment logs and process output remain in the protected runtime directory.

To return to Vercel, remove only the manually added `tasks` CNAME (restore any
saved prior record), check Vercel's domain routing, and verify public HTTPS before
stopping the home-server app. The shared Neon database must remain unchanged.

## Verification

`npm test`, `npm run build`, and `powershell -NoProfile -File
deploy\windows\test.ps1` cover app logic, read-only readiness, compilation, native
PowerShell syntax and path guards. Production readiness performs a read-only query
against the existing `users` table; it never reports database credentials/errors,
creates a session, or changes tracking time. A healthy port alone is not proof of
cutover: check public DNS, TLS, the served commit, and client loading separately.
