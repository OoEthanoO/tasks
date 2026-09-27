import { spawn } from "node:child_process";
import electron from "electron";
import path from "node:path";
import fs from "node:fs/promises";
import os from "node:os";
import assert from "node:assert/strict";
import { NtExecutable, NtExecutableResource, Resource } from "resedit";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes("--packaged");
const args = process.argv.slice(2).filter(arg => arg !== "--packaged");
let executable = packaged ? path.resolve("release/win-unpacked/YanTasks.exe") : electron;
let fixture;
let shortcut;
const programs = path.join(process.env.APPDATA, "Microsoft/Windows/Start Menu/Programs");
const installedShortcut = path.join(programs, "YanTasks.lnk");
const originalShortcut = await fs.readFile(installedShortcut).catch(e => { if (e.code !== "ENOENT") throw e; return null; });
try {
  if (args.includes("--alert-check")) {
    // Electron 44 registers a shortcut using PE ProductName (not app.getName)
    // and rewrites its target. Never run notification tests from a binary named
    // YanTasks/Electron: that can hijack the user's installed Start-menu entry.
    fixture = await fs.mkdtemp(path.join(os.tmpdir(), "yantasks-alert-smoke-"));
    const productName = path.basename(fixture);
    const candidateShortcut = path.join(programs, `${productName}.lnk`);
    await assert.rejects(fs.access(candidateShortcut), { code: "ENOENT" });
    shortcut = candidateShortcut;
    await fs.cp(path.dirname(executable), fixture, { recursive: true });
    executable = path.join(fixture, path.basename(executable));
    const exe = NtExecutable.from(await fs.readFile(executable));
    const resources = NtExecutableResource.from(exe);
    const versions = Resource.VersionInfo.fromEntries(resources.entries);
    assert.ok(versions.length, "fixture has Windows product metadata");
    for (const version of versions) {
      for (const language of version.getAllLanguagesForStringValues()) {
        version.setStringValues(language, { ProductName: productName, FileDescription: productName });
      }
      version.outputToResourceEntries(resources.entries);
    }
    resources.outputResource(exe);
    await fs.writeFile(executable, Buffer.from(exe.generate()));
    env.YANTASKS_ALERT_FIXTURE = executable;
  }
  const child = spawn(executable, [...(packaged ? [] : [process.cwd()]), "--smoke-test", ...args], { env, stdio: "inherit", windowsHide: true });
  // A power check samples several scenarios, so it needs longer than a smoke run.
  const timeout = setTimeout(() => { child.kill(); }, args.includes("--power-check") ? 600_000 : 45_000);
  try {
    process.exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", code => resolve(code ?? 1));
    });
  } finally { clearTimeout(timeout); }
} finally {
  // Only remove paths owned by this run, after the child has exited.
  if (shortcut) await fs.rm(shortcut, { force: true });
  if (fixture) {
    assert.equal(path.dirname(fixture), os.tmpdir());
    assert.ok(path.basename(fixture).startsWith("yantasks-alert-smoke-"));
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
  }
  const afterShortcut = await fs.readFile(installedShortcut).catch(e => { if (e.code !== "ENOENT") throw e; return null; });
  assert.deepEqual(afterShortcut, originalShortcut, "smoke must not modify the installed Start-menu shortcut");
  console.log("SHELL IDENTITY CHECK PASS: installed YanTasks shortcut unchanged.");
}
