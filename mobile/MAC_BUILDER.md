# Mac build server

YanTasks builds can run on the M2 Pro Mac and upload directly to Apple, without
EAS Build, EAS Submit, Expo authentication, or an Expo-hosted build number.
The app remains on Expo SDK 54; the Expo CLI only generates its native project.

## From Windows

Run from the repository root:

```powershell
node mobile/scripts/mac-build.mjs check
node mobile/scripts/mac-build.mjs archive
```

The second command sends the **current working tree**, including uncommitted
mobile/shared changes, as an allowlisted, checksummed source snapshot. It prints
a job ID. The job continues on the Mac if the SSH connection closes.

```powershell
node mobile/scripts/mac-build.mjs status JOB_ID
node mobile/scripts/mac-build.mjs logs JOB_ID
node mobile/scripts/mac-build.mjs download JOB_ID
```

`archive-ready` means the signed IPA passed export and is available for download;
it does **not** mean an upload occurred. Downloads are checksum-verified and saved
under ignored `mobile/build/JOB_ID/`, with a receipt naming the commit/build.

When an upload is explicitly requested:

```powershell
node mobile/scripts/mac-build.mjs testflight
```

This starts a fresh build and uploads it using Fastlane's direct Apple integration.
It does not add testers, change test groups, or submit an App Store release.
`testflight-ready` means Apple's API reports processing `VALID`.
`uploaded-awaiting-apple` means the upload completed but the 45-minute processing
check expired; inspect App Store Connect before retrying. Never re-upload merely
because processing is slow. `unsigned` is available for compiler-only diagnostics
and must never be represented as a TestFlight-capable build.

## Host and prerequisites

- SSH alias: `yantasks-mac`, currently `yanxu@192.168.18.18` on the local network.
- Dedicated SSH key on Windows; host-key checking stays enabled. No agent
  forwarding, port forwarding, public listener, or router changes are required.
- Build root: `/Users/yanxu/yantasks-build-server`. The user's existing
  `/Users/yanxu/tasks` checkout is not modified.
- Xcode is selected with its licence and first-launch setup completed. iOS SDK
  availability is checked for every job. Node 22 is selected through the existing
  nvm installation; CocoaPods/Fastlane come from `/opt/homebrew/bin`.
- The Mac must be awake and plugged in. Its AC-only sleep setting is `sleep 0`;
  battery sleep and display sleep are unchanged. Keep the lid open unless using
  a supported closed-display setup. FileVault remains enabled if already enabled;
  a reboot may require a local login before remote access/keychains work.
- At least 40 GiB free space is required. Builds use four Xcode compiler jobs and
  an AC-only, build-scoped `caffeinate` assertion. There is no idle CI polling or
  always-running build worker. Unplugging during a job is not a supported workflow.

The client accepts `YANTASKS_MAC_HOST` and `YANTASKS_MAC_ROOT` overrides for a
replacement configured SSH host and a root of the form `/Users/USER/DIRECTORY`.
It does not provision or authenticate a new Mac automatically.

## Signing and privacy

Existing YanTasks distribution credentials were migrated once; certificates and
API keys were not revoked/replaced. Normal builds never contact Expo services.
The private `config/` directory holds `apple.json`, `AuthKey.p8`,
`fastlane-api.json`, and a dedicated `signing.keychain-db`. These are not source
files and must never be copied into the repository, artifacts, or logs.
The login keychain is not unlocked or reconfigured by build jobs. The dedicated
keychain is unlocked only for a signed build, then locked on exit.

The current distribution profile expires June 28, 2027. Renew signing credentials
before expiry. Provisioning is manual and does not silently create/revoke Apple
certificates. Apple API reads validate the app identity and select a build number
higher than both Apple's existing builds and this Mac's last reservation. Failed
builds may leave harmless number gaps. An EAS fallback must synchronize its remote
build number before use, or it may attempt a duplicate number.

Only trusted YanTasks source may run here: build scripts and npm lifecycle hooks
execute with the build user's privileges. Do not connect public/unreviewed pull
requests to this credential-bearing host.

## Operations and recovery

Jobs live in `jobs/JOB_ID/` with `source-manifest.json`, `source.tar`, `build.log`,
`status.json`, native intermediates and `artifacts/`. The manifest records source
hashes and the starting Git commit; build-time version/signing edits affect only
the disposable job copy. Root tests and mobile typechecking precede native builds.

Only one build may hold `build.lock`. A second job fails safely. After a crash or
reboot, inspect the lock's job/PID and verify no build process remains before
removing that **single file**. Do not remove a live lock. To cancel, send SIGTERM
to the worker PID from that job's status; its active subprocess group is stopped.

Old jobs are retained for diagnosis and are not automatically deleted. Check disk
usage periodically and remove only explicitly selected completed job folders,
preserving any IPA/archive you need. Never recursively delete the build root or
`config/`. A reserved build number is not proof of a successful build or upload.

Local checks for the transport/helper code:

```powershell
node --test mobile/scripts/mac-build.test.mjs
```

The pre-existing `scripts/build-ios.sh` is a legacy EAS-local helper, not this
workflow. `eas.json` remains unchanged as a manual fallback.
