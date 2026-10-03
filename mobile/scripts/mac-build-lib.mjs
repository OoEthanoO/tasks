import fs from 'node:fs';
import path from 'node:path';
import { createHash, createPrivateKey, sign } from 'node:crypto';

export const modes = ['unsigned', 'archive', 'testflight'];
export function allowedSource(file) {
  if (!/^(mobile\/|lib\/|test\/|package(?:-lock)?\.json$|tsconfig\.test\.json$)/.test(file)) return false;
  if (file.includes('\\') || file.split('/').some(p => !p || p === '.' || p === '..')) return false;
  if (/[\r\n\x00]/.test(file)) return false;
  if (/(^|\/)(node_modules|ios|android|build|dist|credentials|secrets|private_keys|\.private_keys|\.ssh|\.appstoreconnect|\.expo|\.git|\.test-build)(\/|$)/.test(file)) return false;
  if (/(^|\/)(\.env[^/]*|credentials[^/]*|AuthKey[^/]*|apple\.json|fastlane-api\.json)$|\.(p8|p12|pfx|key|pem|mobileprovision|ipa|log)$/i.test(file)) return false;
  return true;
}
export function jobId(value) {
  if (!/^\d{8}T\d{6}Z-[a-f0-9]{8}$/.test(value ?? '')) throw new Error('Invalid build job ID.');
  return value;
}
export function sha256(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
export function writeJson(file, data) {
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  fs.renameSync(`${file}.tmp`, file);
}
export function appleConfig(root) {
  const dir = path.join(root, 'config');
  const config = JSON.parse(fs.readFileSync(path.join(dir, 'apple.json'), 'utf8'));
  if (config.bundleId !== 'com.ethanyanxu.yantasks' || config.appId !== '6802105816' ||
      !/^[A-Z0-9]{10}$/.test(config.teamId) || !/^[A-Z0-9]{10}$/.test(config.keyId) ||
      !/^[a-f0-9-]{36}$/i.test(config.issuerId) || path.basename(config.keyFile) !== config.keyFile) {
    throw new Error('Invalid YanTasks signing configuration.');
  }
  return { ...config, dir, keyPath: path.join(dir, config.keyFile) };
}
export async function appleRequest(config, route) {
  const url = new URL(route, 'https://api.appstoreconnect.apple.com');
  if (url.origin !== 'https://api.appstoreconnect.apple.com') throw new Error('Invalid Apple API URL.');
  const now = Math.floor(Date.now() / 1000);
  const encode = v => Buffer.from(JSON.stringify(v)).toString('base64url');
  const unsigned = `${encode({ alg: 'ES256', kid: config.keyId, typ: 'JWT' })}.${encode({ iss: config.issuerId, iat: now, exp: now + 1200, aud: 'appstoreconnect-v1' })}`;
  const signature = sign('sha256', Buffer.from(unsigned), { key: createPrivateKey(fs.readFileSync(config.keyPath)), dsaEncoding: 'ieee-p1363' }).toString('base64url');
  const response = await fetch(url, { headers: { Authorization: `Bearer ${unsigned}.${signature}` }, signal: AbortSignal.timeout(30000), redirect: 'error' });
  if (!response.ok) throw new Error(`Apple API returned HTTP ${response.status}. Check key access; private details were not logged.`);
  return response.json();
}
export async function nextBuildNumber(config, root) {
  const app = await appleRequest(config, `/v1/apps/${config.appId}`);
  if (app.data?.attributes?.bundleId !== config.bundleId) throw new Error('Apple app identity mismatch.');
  let route = `/v1/builds?filter[app]=${config.appId}&limit=200&fields[builds]=version`;
  let maximum = 0;
  while (route) {
    const page = await appleRequest(config, route);
    for (const build of page.data) {
      const number = build.attributes.version;
      if (!/^\d+$/.test(number)) throw new Error('A non-integer Apple build number needs manual migration.');
      maximum = Math.max(maximum, Number(number));
    }
    route = page.links?.next;
  }
  const file = path.join(root, 'next-build-number.json');
  if (fs.existsSync(file)) maximum = Math.max(maximum, JSON.parse(fs.readFileSync(file, 'utf8')).lastReserved);
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum >= 9999) throw new Error('Invalid or exhausted build-number range.');
  writeJson(file, { lastReserved: maximum + 1, at: new Date().toISOString() });
  return maximum + 1;
}
