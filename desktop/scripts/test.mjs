import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({ entryPoints: ["test/desktop.test.ts", "test/remote.test.ts"], outdir: ".test-build", outExtension: { ".js": ".cjs" }, bundle: true, platform: "node", format: "cjs", logLevel: "warning" });
const result = spawnSync(process.execPath, ["--test", ".test-build/desktop.test.cjs", ".test-build/remote.test.cjs"], { stdio: "inherit" });
process.exitCode = result.status ?? 1;
