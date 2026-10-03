import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { appleConfig, appleRequest, jobId, modes, nextBuildNumber, sha256, writeJson } from './mac-build-lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const root = path.dirname(path.dirname(repo));
const id = jobId(path.basename(repo));
const mode = process.argv[2];
if (process.platform !== 'darwin' || path.basename(path.dirname(repo)) !== 'jobs' || !modes.includes(mode)) throw new Error('Run this worker only in an isolated Mac build job.');
const mobile = path.join(repo, 'mobile'), artifacts = path.join(repo, 'artifacts');
const statusFile = path.join(repo, 'status.json'), lock = path.join(root, 'build.lock');
let phase = 'starting', child, caffeinate, locked = false, config, buildNumber, stopping = false;
const startedAt = new Date().toISOString();
function status(value, extra = {}) {
  phase = value;
  writeJson(statusFile, { jobId: id, mode, phase, pid: process.pid, buildNumber, startedAt, updatedAt: new Date().toISOString(), ...extra });
  console.log(`[${new Date().toISOString()}] ${phase}`);
}
function run(program, args, cwd = repo) {
  return new Promise((resolve, reject) => {
    child = spawn(program, args, { cwd, stdio: 'inherit', env: process.env, detached: true });
    child.once('error', reject);
    child.once('exit', code => { child = undefined; code === 0 ? resolve() : reject(new Error(`${path.basename(program)} failed (${code}). See build.log.`)); });
  });
}
function capture(program, args) {
  const result = spawnSync(program, args, { encoding: 'utf8', cwd: repo });
  if (result.error || result.status !== 0) throw new Error(`${path.basename(program)} preflight failed.`);
  return result.stdout.trim();
}
function finish() {
  caffeinate?.kill();
  if (locked) {
    if (config?.keychainPath) spawnSync('security', ['lock-keychain', config.keychainPath], { stdio: 'ignore' });
    fs.unlinkSync(lock);
    locked = false;
  }
}
process.on('exit', finish);
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
  stopping = true;
  if (child) { try { process.kill(-child.pid, signal); } catch {} }
  else { status('interrupted', { error: 'Build interrupted; artifacts retained.' }); process.exit(1); }
});

try {
  fs.mkdirSync(artifacts, { recursive: true, mode: 0o700 });
  const fd = fs.openSync(lock, 'wx', 0o600);
  fs.writeFileSync(fd, JSON.stringify({ jobId: id, pid: process.pid, startedAt })); fs.closeSync(fd); locked = true;
  if (!capture('pmset', ['-g', 'batt']).includes("'AC Power'")) throw new Error('Connect the Mac to power before starting a build.');
  const disk = fs.statfsSync(root);
  if (disk.bavail * disk.bsize < 40 * 1024 ** 3) throw new Error('At least 40 GiB free is required for a build. No automatic deletion was performed.');
  if (Number(process.versions.node.split('.')[0]) !== 22) throw new Error('Use the configured Node 22 runtime.');
  capture('xcrun', ['--sdk', 'iphoneos', '--show-sdk-path']);
  const manifest = JSON.parse(fs.readFileSync(path.join(repo, 'source-manifest.json'), 'utf8'));
  for (const entry of manifest.files) if (sha256(path.join(repo, entry.path)) !== entry.sha256) throw new Error('Source snapshot checksum mismatch.');
  process.env.CI = '1'; process.env.EXPO_NO_TELEMETRY = '1';
  process.env.LANG = process.env.LC_ALL = 'en_US.UTF-8';
  process.env.FASTLANE_SKIP_UPDATE_CHECK = '1'; process.env.FASTLANE_OPT_OUT_USAGE = '1';
  caffeinate = spawn('/usr/bin/caffeinate', ['-s', '-w', String(process.pid)], { stdio: 'ignore' });
  if (mode !== 'unsigned') {
    config = appleConfig(root);
    if (!config.keychainPath || !config.keychainPassword || !config.profileId || !config.certificateHash) throw new Error('Signing setup is incomplete.');
    const unlock = spawnSync('security', ['unlock-keychain', '-p', config.keychainPassword, config.keychainPath], { stdio: 'ignore' });
    if (unlock.status !== 0) throw new Error('Cannot unlock the dedicated build keychain.');
    buildNumber = await nextBuildNumber(config, root);
  } else buildNumber = 1;
  status('installing-dependencies');
  await run('npm', ['ci', '--no-audit', '--no-fund']);
  await run('npm', ['ci', '--no-audit', '--no-fund'], mobile);
  status('testing');
  await run('npm', ['test']);
  await run(path.join(mobile, 'node_modules/.bin/tsc'), ['--noEmit'], mobile);
  const appFile = path.join(mobile, 'app.json');
  const app = JSON.parse(fs.readFileSync(appFile, 'utf8'));
  if (app.expo.ios.bundleIdentifier !== 'com.ethanyanxu.yantasks') throw new Error('Unexpected app bundle ID.');
  app.expo.ios.buildNumber = String(buildNumber);
  fs.writeFileSync(appFile, JSON.stringify(app, null, 2) + '\n'); // disposable job copy only
  status('generating-xcode-project');
  await run(path.join(mobile, 'node_modules/.bin/expo'), ['prebuild', '--platform', 'ios', '--no-install'], mobile);
  await run('pod', ['install'], path.join(mobile, 'ios'));
  const projectFile = path.join(mobile, 'ios/YanTasks.xcodeproj/project.pbxproj');
  if (config) {
    // Apply the profile to the app target only, never to CocoaPods targets.
    const require = createRequire(path.join(mobile, 'package.json'));
    const project = require('xcode').project(projectFile); project.parseSync();
    let changed = 0;
    for (const item of Object.values(project.pbxXCBuildConfigurationSection())) {
      const settings = item?.buildSettings;
      if (String(settings?.PRODUCT_BUNDLE_IDENTIFIER).replaceAll('"', '') !== config.bundleId) continue;
      Object.assign(settings, { CODE_SIGN_STYLE: 'Manual', DEVELOPMENT_TEAM: config.teamId,
        CODE_SIGN_IDENTITY: '"Apple Distribution"', PROVISIONING_PROFILE_SPECIFIER: `"${config.profileId}"` });
      changed++;
    }
    if (!changed) throw new Error('Could not configure signing on the app target.');
    fs.writeFileSync(projectFile, project.writeSync());
  }
  const archive = path.join(artifacts, 'YanTasks.xcarchive');
  status('archiving');
  await run('xcodebuild', ['-workspace', path.join(mobile, 'ios/YanTasks.xcworkspace'), '-scheme', 'YanTasks', '-configuration', 'Release',
    '-destination', 'generic/platform=iOS', '-archivePath', archive, '-derivedDataPath', path.join(repo, 'DerivedData'), '-jobs', '4',
    // SDK 54 already requires iOS 15.1. Older dependency resource bundles still
    // declare iOS 13.4, which Xcode 27 rejects; use the app's supported floor.
    'IPHONEOS_DEPLOYMENT_TARGET=15.1',
    ...(config ? [`OTHER_CODE_SIGN_FLAGS=--keychain ${config.keychainPath}`] : ['CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO']), 'archive']);
  const archivedApp = path.join(archive, 'Products/Applications/YanTasks.app');
  const bundleId = capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(archivedApp, 'Info.plist')]);
  const archivedBuild = capture('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleVersion', path.join(archivedApp, 'Info.plist')]);
  if (bundleId !== app.expo.ios.bundleIdentifier || archivedBuild !== String(buildNumber)) throw new Error('Archived app identity/build number mismatch.');
  if (!config) {
    status('unsigned-verified', { archive, signed: false, uploaded: false });
  } else {
    capture('codesign', ['--verify', '--deep', '--strict', archivedApp]);
    const exportOptions = path.join(artifacts, 'ExportOptions.plist');
    // All interpolated values originate in verified signing metadata, not task/source text.
    const xml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    fs.writeFileSync(exportOptions, `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>method</key><string>app-store-connect</string><key>destination</key><string>export</string><key>teamID</key><string>${xml(config.teamId)}</string><key>signingStyle</key><string>manual</string><key>signingCertificate</key><string>${xml(config.certificateHash)}</string><key>provisioningProfiles</key><dict><key>${xml(config.bundleId)}</key><string>${xml(config.profileId)}</string></dict><key>manageAppVersionAndBuildNumber</key><false/><key>uploadSymbols</key><true/></dict></plist>`);
    status('exporting');
    const exportDir = path.join(artifacts, 'export');
    await run('xcodebuild', ['-exportArchive', '-archivePath', archive, '-exportPath', exportDir, '-exportOptionsPlist', exportOptions]);
    const ipaNames = fs.readdirSync(exportDir).filter(name => name.endsWith('.ipa'));
    if (ipaNames.length !== 1) throw new Error('Expected exactly one exported IPA.');
    const ipa = path.join(exportDir, ipaNames[0]);
    const receipt = { appId: config.appId, bundleId, version: app.expo.version, buildNumber, ipa, sha256: sha256(ipa), sourceCommit: manifest.commit, signed: true };
    writeJson(path.join(artifacts, 'receipt.json'), receipt);
    if (mode === 'testflight') {
      status('uploading');
      await run('fastlane', ['pilot', 'upload', '--api_key_path', path.join(config.dir, 'fastlane-api.json'), '--ipa', ipa, '--app_identifier', config.bundleId, '--skip_submission', '--skip_waiting_for_build_processing', 'true'], mobile);
      status('apple-processing', { ...receipt, uploaded: true });
      const deadline = Date.now() + 45 * 60_000;
      let ready = false;
      while (Date.now() < deadline) {
        const page = await appleRequest(config, `/v1/builds?filter[app]=${config.appId}&filter[version]=${buildNumber}&limit=10`);
        const build = page.data?.[0];
        if (['FAILED', 'INVALID'].includes(build?.attributes?.processingState)) throw new Error('Apple rejected the build during processing.');
        if (build?.attributes?.processingState === 'VALID') { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      status(ready ? 'testflight-ready' : 'uploaded-awaiting-apple', { ...receipt, uploaded: true });
    } else status('archive-ready', { ...receipt, uploaded: false });
  }
} catch (error) {
  status(stopping ? 'interrupted' : 'failed', { failedPhase: phase, error: error.code === 'EEXIST' ? 'Another build owns build.lock. Inspect it before removing a stale lock.' : error.message });
  process.exitCode = 1;
}
