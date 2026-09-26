import { app, type BrowserWindow } from "electron";
import { addDays, toKey } from "../../lib/dates";
import type { TrackerEngine } from "./engine";

/** How often the shell did work, so a CPU figure can be read against its cause. */
export type PowerStats = { publishes: number; sends: number };

type Options = {
  main: BrowserWindow;
  engine: TrackerEngine;
  mini: () => BrowserWindow | undefined;
  setMini: (on: boolean) => void;
  stats: PowerStats;
  seconds: number;
};

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function mounted(w: BrowserWindow) {
  for (let i = 0; i < 100; i++) {
    if (!w.webContents.isLoading() && await w.webContents.executeJavaScript("!!document.querySelector('#root')?.textContent?.length").catch(() => false)) return;
    await sleep(100);
  }
  throw new Error("Renderer did not mount.");
}

/**
 * A visible window has to be really shown for Chromium to render it, but this
 * runs on someone's desktop. Measurement windows are shown fully transparent
 * and click-through, so they neither cover nor intercept anything.
 */
function ghost(w: BrowserWindow) {
  w.setOpacity(0);
  w.setIgnoreMouseEvents(true);
  w.showInactive();
}

/**
 * CPU use of the whole app in each state someone actually leaves it in, on a
 * realistic day: thirty tasks, tracking under way. Guest mode, so no network.
 */
export async function runPowerCheck(o: Options) {
  const tasks = Array.from({ length: 30 }, (_, i) => ({
    id: `power-${i}`, title: `Task ${i + 1}`, description: i % 3 ? "" : "Notes long enough to make the payload realistic.",
    dueDate: toKey(addDays(new Date(), i % 10)), priority: "low", completed: false,
    createdAt: new Date(Date.now() - i * 3_600_000).toISOString(), completedAt: null,
  }));
  await o.main.webContents.executeJavaScript(`localStorage.setItem("yantasks.tasks.v1", ${JSON.stringify(JSON.stringify(tasks))}); localStorage.setItem("yantasks.endTime.v1", '"23:59"'); location.reload();`);
  await mounted(o.main);
  await sleep(500);
  await o.main.webContents.executeJavaScript("window.desktop.command({type:'start'})");
  // Let startup work (page reload, JIT, Chromium's post-startup tasks) finish
  // before measuring; the last scenario repeats the first to expose any drift.
  o.main.hide();
  await sleep(30_000);

  const scenarios: [string, () => Promise<void>][] = [
    ["hidden, working", async () => { o.setMini(false); o.main.hide(); }],
    ["mini tracker, working", async () => { o.main.hide(); o.setMini(true); const m = o.mini()!; await mounted(m); ghost(m); }],
    ["task window, working", async () => { o.setMini(false); ghost(o.main); }],
    ["task window, paused", async () => { await o.main.webContents.executeJavaScript("window.desktop.command({type:'pause'})"); }],
    ["hidden, paused", async () => { o.main.hide(); }],
    ["hidden, working (again)", async () => { await o.main.webContents.executeJavaScript("window.desktop.command({type:'start'})"); }],
  ];
  const results: Record<string, unknown>[] = [];
  for (const [name, setup] of scenarios) {
    await setup();
    o.engine.tick();
    await sleep(3000);
    const miniPid = o.mini()?.webContents.getOSProcessId();
    // Cumulative CPU seconds per process, so the result reads as CPU time
    // spent per minute rather than a percentage of an unstated whole.
    const used = () => new Map(app.getAppMetrics().map(m => [m.pid, { type: m.type === "Tab" ? (m.pid === miniPid ? "mini" : "window") : m.type === "Browser" ? "main" : m.type.toLowerCase(), seconds: m.cpu.cumulativeCPUUsage ?? 0 }]));
    const start = used();
    const before = { ...o.stats };
    await sleep(o.seconds * 1000);
    const perMinute = (n: number) => Math.round(n * 60 / o.seconds);
    const cpu: Record<string, number> = {};
    for (const [pid, now] of used()) cpu[now.type] = (cpu[now.type] ?? 0) + (now.seconds - (start.get(pid)?.seconds ?? 0)) * 1000;
    const total = Object.values(cpu).reduce((a, b) => a + b, 0);
    results.push({ scenario: name, cpuMsPerMin: perMinute(total), ...Object.fromEntries(Object.entries(cpu).map(([k, v]) => [k, perMinute(v)])),
      publishesPerMin: perMinute(o.stats.publishes - before.publishes), ipcSendsPerMin: perMinute(o.stats.sends - before.sends) });
  }
  console.log("POWER_CHECK " + JSON.stringify(results));
}
