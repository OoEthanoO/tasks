// Run only after install.ps1 has restricted the destination directory's ACL.
// No secret is printed, included in command-line arguments, or stored in Git.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const [source, root = 'C:/ProgramData/YanTasks'] = process.argv.slice(2);
try {
  if (!source) throw new Error('source required');
  const { DATABASE_URL } = parseEnv(fs.readFileSync(source, 'utf8'));
  const url = new URL(DATABASE_URL);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname.endsWith('.neon.tech') || !url.password) throw new Error('invalid URL');
  const destination = path.join(root, 'secrets/production.json');
  if (fs.existsSync(destination)) throw new Error('configuration exists');
  fs.writeFileSync(destination, JSON.stringify({ DATABASE_URL }) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('Existing Neon connection imported into protected runtime configuration.');
} catch {
  console.error('Import failed: check source format, destination permissions, and whether configuration already exists. No credential was logged.');
  process.exitCode = 1;
}
