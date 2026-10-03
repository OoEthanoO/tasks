import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { allowedSource, jobId, modes, sha256, writeJson } from './mac-build-lib.mjs';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const host = process.env.YANTASKS_MAC_HOST ?? 'yantasks-mac';
const root = process.env.YANTASKS_MAC_ROOT ?? '/Users/yanxu/yantasks-build-server';
if (!/^[a-zA-Z0-9_.@-]+$/.test(host) || host.startsWith('-') || !/^\/Users\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+$/.test(root)) throw new Error('Invalid Mac host/root.');
const ssh = ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', host];
function run(exe, args, capture = false) {
  const result = spawnSync(exe, args, { cwd: repo, encoding: 'utf8', stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit', windowsHide: true, maxBuffer: 16 * 1024 ** 2 });
  if (result.error || result.status !== 0) throw new Error(`${exe} failed${capture ? ': ' + (result.stderr ?? '').trim() : ''}`);
  return result.stdout?.trim();
}
const [command = 'check', requestedId] = process.argv.slice(2);
if (command === 'check') {
  run('ssh', [...ssh, 'export PATH=/opt/homebrew/bin:/opt/homebrew/sbin:$PATH; export LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8; sw_vers; xcodebuild -version; xcrun --sdk iphoneos --show-sdk-path; pod --version; pmset -g batt; df -h /']);
} else if (['status', 'logs', 'download'].includes(command)) {
  const id = jobId(requestedId), remote = `${root}/jobs/${id}`;
  if (command === 'status') run('ssh', [...ssh, `cat '${remote}/status.json'`]);
  else if (command === 'logs') run('ssh', [...ssh, `tail -n 80 '${remote}/build.log'`]);
  else {
    const receipt = JSON.parse(run('ssh', [...ssh, `cat '${remote}/artifacts/receipt.json'`], true));
    if (!receipt.ipa?.startsWith(`${remote}/artifacts/export/`) || !/^[a-zA-Z0-9_./-]+\.ipa$/.test(receipt.ipa)) throw new Error('Invalid artifact path.');
    const destination = path.join(repo, 'mobile/build', id); fs.mkdirSync(destination, { recursive: true });
    const file = path.join(destination, 'YanTasks.ipa');
    run('scp', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', `${host}:${receipt.ipa}`, file]);
    if (sha256(file) !== receipt.sha256) throw new Error('Downloaded IPA checksum mismatch.');
    writeJson(path.join(destination, 'receipt.json'), receipt); console.log(`Verified IPA: ${file}`);
  }
} else if (modes.includes(command)) {
  const id = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z') + '-' + randomUUID().slice(0, 8);
  jobId(id);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yantasks-mac-build-'));
  try {
    const candidates = run('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], true).split('\0');
    const files = [...new Set(candidates)].filter(allowedSource).filter(file => fs.existsSync(path.join(repo, file))).sort();
    if (!files.includes('mobile/scripts/mac-build-worker.mjs') || !files.includes('mobile/package-lock.json')) throw new Error('Required build files are missing.');
    const staging = path.join(temp, 'source'); fs.mkdirSync(staging);
    const entries = files.map(file => {
      const input = path.join(repo, file);
      if (!fs.lstatSync(input).isFile()) throw new Error(`Source must be a regular file: ${file}`);
      const output = path.join(staging, file); fs.mkdirSync(path.dirname(output), { recursive: true });
      fs.copyFileSync(input, output);
      // Windows checkouts may contain CRLF; Bash entrypoints require LF.
      if (file.endsWith('.sh')) fs.writeFileSync(output, fs.readFileSync(output, 'utf8').replaceAll('\r\n', '\n'));
      return { path: file, sha256: sha256(output) };
    });
    writeJson(path.join(staging, 'source-manifest.json'), { commit: run('git', ['rev-parse', 'HEAD'], true), dirty: !!run('git', ['status', '--porcelain'], true), createdAt: new Date().toISOString(), files: entries });
    const archive = path.join(temp, 'source.tar'); run('tar', ['-cf', archive, '-C', staging, '.']);
    const remote = `${root}/jobs/${id}`;
    run('ssh', [...ssh, `umask 077; mkdir -p '${root}/jobs'; mkdir '${remote}'`]);
    run('scp', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', archive, `${host}:${remote}/source.tar`]);
    const remoteHash = run('ssh', [...ssh, `shasum -a 256 '${remote}/source.tar'`], true).split(/\s+/)[0];
    if (remoteHash !== sha256(archive)) throw new Error('Remote source checksum mismatch.');
    run('ssh', [...ssh, `cd '${remote}' && tar -xf source.tar && (nohup /bin/bash mobile/scripts/mac-build-start.sh ${command} > build.log 2>&1 < /dev/null &)`]);
    console.log(`Started ${command} job: ${id}\nStatus: node mobile/scripts/mac-build.mjs status ${id}\nLogs: node mobile/scripts/mac-build.mjs logs ${id}`);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); } // only this invocation's mkdtemp directory
} else throw new Error('Use check, unsigned, archive, testflight, status JOB, logs JOB, or download JOB.');
