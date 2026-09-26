import { spawn } from "node:child_process";
import electron from "electron";
import path from "node:path";
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const packaged = process.argv.includes("--packaged");
const args = process.argv.slice(2).filter(arg => arg !== "--packaged");
const child = spawn(packaged ? path.resolve("release/win-unpacked/YanTasks.exe") : electron, [...(packaged ? [] : ["."]), "--smoke-test", ...args], { env, stdio: "inherit", windowsHide: true });
// A power check samples several scenarios, so it needs longer than a smoke run.
const timeout = setTimeout(() => { child.kill(); process.exitCode = 1; }, args.includes("--power-check") ? 600_000 : 45_000);
child.on("exit", code => { clearTimeout(timeout); process.exitCode = code ?? 1; });
