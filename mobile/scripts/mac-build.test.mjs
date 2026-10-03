import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { allowedSource, appleConfig, appleRequest, jobId, sha256, writeJson } from './mac-build-lib.mjs';

test('source snapshot includes shared code, lockfiles, tests and builder scripts', () => {
  for (const file of ['mobile/App.tsx', 'mobile/package-lock.json', 'mobile/scripts/mac-build-worker.mjs', 'lib/tracking.ts', 'test/tracking.test.mjs', 'package.json', 'tsconfig.test.json']) assert.ok(allowedSource(file), file);
});
test('source snapshot excludes credentials, unrelated apps, artifacts and traversal', () => {
  for (const file of ['mobile/.env', 'mobile/.env.production', 'mobile/credentials.json', 'mobile/credentials/ios/key.p12', 'mobile/credentials/ios/config.json', 'mobile/secrets/signing.json', 'mobile/AuthKey_ABC.p8', 'mobile/apple.json', 'mobile/fastlane-api.json', 'mobile/ios/project', 'mobile/build/app.ipa', 'mobile/node_modules/example.js', 'desktop/src/main.ts', '.git/config', 'lib/../secret.ts', 'mobile\\App.tsx', 'mobile/a\nb.ts']) assert.equal(allowedSource(file), false, file);
});
test('remote job names reject shell expressions, paths and options', () => {
  assert.equal(jobId('20260927T123456Z-1234abcd'), '20260927T123456Z-1234abcd');
  for (const id of [undefined, '', '../x', 'x;whoami', '-r', '20260927T123456Z-1234abcd/../../']) assert.throws(() => jobId(id));
});
test('atomic status writes and checksums detect changed contents', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantasks-builder-test-'));
  try {
    const file = path.join(dir, 'status.json');
    writeJson(file, { phase: 'one' }); const first = sha256(file);
    writeJson(file, { phase: 'two' }); assert.notEqual(sha256(file), first);
    assert.deepEqual(JSON.parse(fs.readFileSync(file)), { phase: 'two' });
    assert.equal(fs.existsSync(`${file}.tmp`), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('signing configuration rejects another app and escaped key paths', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yantasks-signing-test-'));
  try {
    fs.mkdirSync(path.join(dir, 'config'));
    const file = path.join(dir, 'config/apple.json');
    const good = { appId: '6802105816', bundleId: 'com.ethanyanxu.yantasks', teamId: 'ABCDEFGHIJ', keyId: '1234567890', issuerId: '00000000-0000-0000-0000-000000000000', keyFile: 'AuthKey.p8' };
    writeJson(file, good); assert.equal(appleConfig(dir).teamId, good.teamId);
    writeJson(file, { ...good, keyFile: '../AuthKey.p8' }); assert.throws(() => appleConfig(dir));
    writeJson(file, { ...good, bundleId: 'another.app' }); assert.throws(() => appleConfig(dir));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test('Apple API credentials cannot be sent to another origin', async () => {
  await assert.rejects(appleRequest({}, 'https://example.com/'), /Invalid Apple API URL/);
});
