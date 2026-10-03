import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({ entryPoints: ["test/desktop.test.ts", "test/remote.test.ts", "test/diagnostics.test.ts"], outdir: ".test-build", outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs", logLevel: "warning" });
// Work days start and end at local clock times; fixtures are written in UTC.
const result = spawnSync(process.execPath, ["--test", ".test-build/desktop.test.cjs", ".test-build/remote.test.cjs", ".test-build/diagnostics.test.cjs"], { stdio: "inherit", env: { ...process.env, TZ: "UTC" } });
process.exitCode = result.status ?? 1;
