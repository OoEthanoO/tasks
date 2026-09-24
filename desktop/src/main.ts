import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, powerMonitor, protocol, screen, session, Tray } from "electron";
import type { IpcMainInvokeEvent, NativeImage } from "electron";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TrackerEngine } from "./engine";
import { defaults, type ApiReply, type DesktopState, type Settings } from "./contract";
import { trustedPage, validateAction, validateApi } from "./security";
import { statusModel } from "./model";
import { formatDuration, upcomingTrackingEvents, type TrackingEvent } from "../../lib/tracking";
import { syncDelay, wakeDelay } from "./power";

const APP_ID = "com.ethanyanxu.yantasks";
const API = "https://tasks.ethanyanxu.com";
const smoke = process.argv.includes("--smoke-test");
const powerCheck = smoke && process.argv.includes("--power-check");
// Smoke tests use a fresh, isolated profile and cannot reach production APIs.
if (smoke) app.setPath("userData", path.join(app.getPath("temp"), `yantasks-smoke-${process.pid}`));
app.setAppUserModelId(APP_ID);
protocol.registerSchemesAsPrivileged([{ scheme: "yantasks", privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
if (!app.requestSingleInstanceLock()) app.quit();
else void app.whenReady().then(start).catch(e => { console.error(e); app.exit(1); });

let main: BrowserWindow;
let mini: BrowserWindow | undefined;
let createMini: () => BrowserWindow;
let tray: Tray;
let engine: TrackerEngine;
let quitting = false;
let lastTrayMode = "";
let lastButtons = "";
let lastView: DesktopState | null = null;
let wakeTimer: ReturnType<typeof setTimeout> | undefined;
let syncTimer: ReturnType<typeof setTimeout> | undefined;
let nextSyncAt = 0;
let scheduleKey = "";
let eventTimes: number[] = [];
let lastShellUpdate = "";
let suspended = false;
let onBattery = false;
const notifications = new Set<Notification>();
let icons: Record<string, NativeImage>;
let settings: Settings = { ...defaults };
let controllerId = "";
let guest: unknown;
let miniPosition: { x: number; y: number } | undefined;
const file = () => path.join(app.getPath("userData"), "desktop-v1.json");

function save() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  const target = file();
  fs.writeFileSync(`${target}.tmp`, JSON.stringify({ settings, controllerId, guest, miniPosition }), { mode: 0o600 });
  fs.renameSync(`${target}.tmp`, target);
}

async function request(endpoint: string, method = "GET", body?: unknown): Promise<ApiReply> {
  if (smoke) {
    if (endpoint === "/api/auth/me") return { status: 200, body: { user: null } };
    return { status: 503, body: { error: "Network is disabled in smoke tests." } };
  }
  try {
    const res = await session.fromPartition("persist:yantasks-account").fetch(`${API}${endpoint}`, {
      method, credentials: "include", redirect: "error", cache: "no-store",
      headers: { "Content-Type": "application/json", Origin: API },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000),
    });
    return { status: res.status, body: await res.json() };
  } catch { return { status: 0, body: { error: "Cannot reach YanTasks. Check your connection and try again." } }; }
}

function showMain() { main.show(); if (main.isMinimized()) main.restore(); main.focus(); }
function showMini() {
  if (!mini || mini.isDestroyed()) {
    mini = createMini();
    mini.once("ready-to-show", () => { if (settings.mini) mini?.showInactive(); });
  } else mini.showInactive();
}
function isVisible(w: BrowserWindow | undefined): w is BrowserWindow { return !!w && !w.isDestroyed() && w.isVisible() && !w.isMinimized(); }

function schedule(view: DesktopState) {
  if (smoke && !powerCheck || suspended || quitting || !main) return;
  const visible = isVisible(main) || isVisible(mini);
  const s = view.state;
  const key = `${view.accountId}/${s.revision}/${s.dayKey}/${s.mode}/${s.taskId}/${s.endTime}`;
  if (scheduleKey !== key) {
    scheduleKey = key;
    eventTimes = upcomingTrackingEvents(s, s.cursor).map(e => e.at);
  }
  const next = eventTimes.find(t => t > s.cursor);
  clearTimeout(wakeTimer);
  wakeTimer = setTimeout(() => engine.tick(), wakeDelay(visible && s.mode !== "idle", next === undefined ? null : next - s.cursor));
  // A nearer foreground deadline can shorten an existing background wait;
  // ordinary repainting must never postpone a scheduled server refresh.
  const due = Date.now() + syncDelay(s.mode !== "idle", visible, onBattery);
  if (!view.accountId) { clearTimeout(syncTimer); syncTimer = undefined; nextSyncAt = 0; }
  else if (!syncTimer || due < nextSyncAt) {
    clearTimeout(syncTimer); nextSyncAt = due;
    syncTimer = setTimeout(async () => {
      syncTimer = undefined; nextSyncAt = 0;
      await engine.refresh();
      engine.tick();
    }, Math.max(0, due - Date.now()));
  }
}
function nativeAlert(event: Pick<TrackingEvent, "title" | "body">) {
  if (!Notification.isSupported()) { engine.report("Windows notifications are unavailable. Use the mini tracker."); return; }
  const n = new Notification({ title: event.title, body: event.body, icon: icons.app, silent: !settings.sound, timeoutType: "never" });
  notifications.add(n);
  n.on("click", () => { showMain(); notifications.delete(n); });
  n.on("close", () => notifications.delete(n));
  n.on("failed", () => { notifications.delete(n); engine.report("Windows could not show an alert. Install YanTasks and check Windows notification settings."); });
  n.show();
  if (!main.isFocused()) main.flashFrame(true);
}

function publish(view: DesktopState) {
  lastView = view;
  if (!main || !tray) return;
  const m = statusModel(view);
  // Shell IPC is batched to five-second buckets (thirty seconds when hidden).
  // State transitions and task switches still update immediately.
  const shellKey = `${view.state.mode}/${view.state.taskId}/${Math.floor(view.state.cursor / (isVisible(main) || isVisible(mini) ? 5000 : 30_000))}`;
  if (shellKey !== lastShellUpdate) {
    lastShellUpdate = shellKey;
    main.setTitle(m.windowTitle);
    main.setProgressBar(m.progress, { mode: view.state.mode === "idle" ? "paused" : "normal" });
    tray.setToolTip(m.tooltip);
  }
  if (view.state.mode !== lastTrayMode) {
    lastTrayMode = view.state.mode;
    tray.setImage(icons[lastTrayMode]);
    main.setOverlayIcon(icons[lastTrayMode], m.label);
  }
  const buttonKey = `${view.ready}/${view.busy}/${view.state.mode}/${m.canStart}`;
  if (buttonKey !== lastButtons) {
    lastButtons = buttonKey;
    main.setThumbarButtons([
      { tooltip: view.state.mode === "idle" ? "Start / resume" : "Pause tracking", icon: icons[view.state.mode === "idle" ? "work" : "idle"], flags: !view.ready || view.busy || view.state.mode === "idle" && !m.canStart ? ["disabled"] : [], click: () => void toggle() },
      { tooltip: "Show mini tracker", icon: icons.open, click: () => changeSettings({ mini: true }) },
      { tooltip: "Open tasks", icon: icons.app, click: showMain },
    ]);
  }
  for (const w of [main, mini]) if (isVisible(w)) w.webContents.send("state", view);
  schedule(view);
}

async function toggle() {
  const view = engine.view();
  await engine.command({ type: view.state.mode === "idle" ? "start" : "pause" }).catch(() => {});
}

function changeSettings(input: Partial<Settings>) {
  for (const key of Object.keys(input)) {
    if (!Object.hasOwn(defaults, key) || typeof input[key as keyof Settings] !== "boolean") throw new Error("Invalid setting.");
  }
  if (input.launchAtLogin !== undefined) {
    if (!app.isPackaged && input.launchAtLogin) throw new Error("Install YanTasks before enabling launch at sign-in.");
    app.setLoginItemSettings({ openAtLogin: input.launchAtLogin, path: process.execPath, args: ["--background"] });
  }
  settings = { ...settings, ...input };
  engine.settings = settings;
  if (settings.mini) showMini(); else { mini?.destroy(); mini = undefined; }
  save(); engine.publish();
}

function trayMenu() {
  const v = engine.view();
  const m = statusModel(v);
  const menu = Menu.buildFromTemplate([
    { label: `${m.label}: ${m.title.slice(0, 65)}`, enabled: false },
    { label: `Worked ${formatDuration(v.state.workMs)} · Rested ${formatDuration(v.state.restMs)}`, enabled: false },
    { label: v.connected ? `Break in ${formatDuration(m.restIn)} tracked work` : "Offline — reconnect to sync", enabled: false },
    { type: "separator" },
    { label: v.state.mode === "idle" ? "Start / resume tracking" : "Pause tracking", enabled: v.ready && !v.busy && (v.state.mode !== "idle" || m.canStart), click: () => void toggle() },
    ...(m.canSkipRest ? [{ label: "Skip break and keep working", enabled: v.ready && !v.busy, click: () => void engine.command({ type: "skip-rest" }).catch(() => {}) }] : []),
    { label: "Track a task", enabled: v.ready && !v.busy, submenu: m.entries.filter(p => p.weight > 0 && !p.doneToday).slice(0, 50).map(p => ({ label: `${p.task.title.slice(0, 60)} · ${formatDuration(p.remainingMs)} left`, type: "radio" as const, checked: p.task.id === v.state.taskId, click: () => void engine.command({ type: "start", taskId: p.task.id }).catch(() => {}) })) },
    { label: "Show tasks", click: showMain },
    { label: "Always-on-top mini tracker", type: "checkbox", checked: settings.mini, click: item => changeSettings({ mini: item.checked }) },
    { type: "separator" },
    { label: "Native alerts", type: "checkbox", checked: settings.alerts, click: item => changeSettings({ alerts: item.checked }) },
    { label: "Launch at Windows sign-in", type: "checkbox", checked: settings.launchAtLogin, click: item => changeSettings({ launchAtLogin: item.checked }) },
    { label: "Quit YanTasks…", click: () => void quit() },
  ]);
  tray.popUpContextMenu(menu);
}

async function quit() {
  const result = await dialog.showMessageBox({ type: "question", title: "Quit YanTasks?", message: "Desktop alerts stop when you quit.", detail: "Closing the task window keeps YanTasks in the tray. Quitting does not pause your synced timer; pause first if you have finished working.", buttons: ["Keep running", "Quit"], defaultId: 0, cancelId: 0 });
  if (result.response === 1) { quitting = true; app.quit(); }
}

function allowed(event: IpcMainInvokeEvent, mainOnly = false) {
  const w = BrowserWindow.fromWebContents(event.sender);
  if (!w || w !== main && w !== mini || mainOnly && w !== main || event.senderFrame !== event.sender.mainFrame || !trustedPage(event.senderFrame.url)) throw new Error("Untrusted desktop request.");
}

async function start() {
  try {
    const data = JSON.parse(fs.readFileSync(file(), "utf8"));
    if (typeof data.controllerId === "string" && /^[a-zA-Z0-9_-]{8,100}$/.test(data.controllerId)) controllerId = data.controllerId;
    for (const key of Object.keys(defaults) as (keyof Settings)[]) if (typeof data.settings?.[key] === "boolean") settings[key] = data.settings[key];
    guest = data.guest;
    if (Number.isFinite(data.miniPosition?.x) && Number.isFinite(data.miniPosition?.y)) miniPosition = data.miniPosition;
  } catch { /* First launch or corrupt preferences: keep safe defaults. */ }
  controllerId ||= `windows_${randomUUID()}`;
  save();
  icons = Object.fromEntries(["app", "work", "rest", "idle", "open"].map(name => [name, nativeImage.createFromPath(path.join(__dirname, "../resources", name === "app" ? "icon.png" : `${name}.png`)).resize({ width: 32, height: 32 })]));
  engine = new TrackerEngine({ now: Date.now, request, publish, notify: nativeAlert, saveGuest: state => { guest = state; try { save(); } catch { engine.report("Cannot save progress on this PC. Check available disk space."); } } }, controllerId, guest);
  engine.settings = settings;

  const ui = session.fromPartition("persist:yantasks-ui");
  ui.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ui.setPermissionCheckHandler(() => false);
  ui.on("will-download", event => event.preventDefault());
  ui.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith("yantasks://app/") }));
  ui.protocol.handle("yantasks", async request => {
    const url = new URL(request.url);
    const files: Record<string, [string, string]> = { "/index.html": ["index.html", "text/html"], "/renderer.js": ["renderer.js", "text/javascript"], "/renderer.css": ["renderer.css", "text/css"] };
    const selected = url.host === "app" && request.method === "GET" ? files[url.pathname] : undefined;
    if (!selected) return new Response("Not found", { status: 404 });
    return new Response(await fs.promises.readFile(path.join(__dirname, selected[0])), { headers: { "Content-Type": selected[1], "X-Content-Type-Options": "nosniff" } });
  });
  const create = (compact: boolean) => {
    const w = new BrowserWindow({ width: compact ? 390 : 1180, height: compact ? 350 : 850, minWidth: compact ? 350 : 740, minHeight: compact ? 310 : 550,
      show: false, frame: !compact, alwaysOnTop: compact, skipTaskbar: compact, resizable: !compact,
      backgroundColor: "#0a0b0e", icon: path.join(__dirname, "../resources/icon.ico"), title: "YanTasks", autoHideMenuBar: true,
      webPreferences: { preload: path.join(__dirname, "preload.cjs"), session: ui, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, backgroundThrottling: true, spellcheck: false },
    });
    w.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    w.webContents.on("will-navigate", event => event.preventDefault());
    w.webContents.on("will-attach-webview", event => event.preventDefault());
    w.webContents.on("render-process-gone", () => { if (!quitting) void w.loadURL(`yantasks://app/index.html${compact ? "?mini=1" : ""}`); });
    w.webContents.on("did-fail-load", (_event, code, description) => console.error("Desktop page failed", code, description));
    w.on("show", () => engine.tick());
    w.on("hide", () => engine.tick());
    w.on("minimize", () => engine.tick());
    w.on("restore", () => engine.tick());
    void w.loadURL(`yantasks://app/index.html${compact ? "?mini=1" : ""}`);
    return w;
  };
  main = create(false);
  Menu.setApplicationMenu(null);
  createMini = () => {
    const w = create(true);
    const area = screen.getPrimaryDisplay().workArea;
    const pos = miniPosition && screen.getAllDisplays().some(d => miniPosition!.x >= d.workArea.x && miniPosition!.x + 390 <= d.workArea.x + d.workArea.width && miniPosition!.y >= d.workArea.y && miniPosition!.y + 350 <= d.workArea.y + d.workArea.height) ? miniPosition : { x: area.x + area.width - 410, y: area.y + area.height - 370 };
    w.setPosition(Math.round(pos.x), Math.round(pos.y));
    w.on("moved", () => { const [x, y] = w.getPosition(); miniPosition = { x, y }; save(); });
    w.on("close", event => { if (!quitting) { event.preventDefault(); changeSettings({ mini: false }); } });
    return w;
  };
  main.on("close", event => { if (!quitting) { event.preventDefault(); main.hide(); if (engine.view().state.mode !== "idle") changeSettings({ mini: true }); } });
  main.on("focus", () => { main.flashFrame(false); void engine.refresh(); });
  main.once("ready-to-show", () => { if (!process.argv.includes("--background") && !smoke) main.show(); });
  tray = new Tray(icons.idle);
  tray.on("double-click", showMain);
  tray.on("click", () => changeSettings({ mini: !settings.mini }));
  tray.on("right-click", trayMenu);
  app.on("second-instance", showMain);
  app.on("activate", showMain);
  app.on("before-quit", () => { quitting = true; engine.tick(); save(); });
  onBattery = powerMonitor.isOnBatteryPower();
  powerMonitor.on("on-battery", () => { onBattery = true; clearTimeout(syncTimer); syncTimer = undefined; engine.publish(); });
  powerMonitor.on("on-ac", () => { onBattery = false; engine.publish(); });
  powerMonitor.on("suspend", () => { suspended = true; clearTimeout(wakeTimer); clearTimeout(syncTimer); syncTimer = undefined; });
  powerMonitor.on("resume", () => { suspended = false; void engine.resume(); });
  powerMonitor.on("unlock-screen", () => void engine.resume());

  ipcMain.handle("api", async (event, raw) => {
    allowed(event, true);
    const r = validateApi(raw);
    const result = await request(r.path, r.method, r.body ? JSON.parse(r.body) : undefined);
    const body = result.body as { user?: { id?: string } } | null;
    if (r.path === "/api/auth/logout") {
      // A failed logout must not silently keep this PC authenticated.
      await session.fromPartition("persist:yantasks-account").cookies.remove(API, "yantasks_session");
      await engine.identity(null);
    } else if (r.path.startsWith("/api/auth/") && result.status >= 200 && result.status < 300) {
      await engine.identity(r.method === "DELETE" ? null : typeof body?.user?.id === "string" ? body.user.id : null);
    } else if (result.status === 401 && r.path === "/api/state") await engine.identity(null);
    if (r.path === "/api/state" && r.method === "PUT" && result.status === 200) await engine.refresh();
    return result;
  });
  ipcMain.handle("snapshot", event => { allowed(event); return engine.view(); });
  ipcMain.handle("configure", (event, config) => { allowed(event, true); if (!config || typeof config !== "object") throw new Error("Invalid configuration."); engine.configure(config); });
  ipcMain.handle("command", (event, action) => { allowed(event); return engine.command(validateAction(action)); });
  ipcMain.handle("refresh", event => { allowed(event); return engine.refresh(); });
  ipcMain.handle("settings", (event, value) => { allowed(event); if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid settings."); changeSettings(value); });
  ipcMain.handle("window", (event, action) => {
    allowed(event);
    if (action === "main") showMain();
    else if (action === "mini") changeSettings({ mini: true });
    else if (action === "hide-mini") changeSettings({ mini: false });
    else if (action === "test-alert") nativeAlert({ title: "YanTasks alerts are ready", body: "Task completion, upcoming breaks, and rest completion will appear here while YanTasks is running." });
    else if (action === "dismiss") engine.dismiss();
    else throw new Error("Unknown window action.");
  });
  engine.publish();
  if (settings.mini && !smoke) showMini();
  if (smoke) {
    const { runSmoke } = await import("./smoke");
    mini = createMini();
    await runSmoke({ main, mini, engine, icons, request, tray });
    if (powerCheck) {
      mini.destroy(); mini = undefined; main.hide(); engine.tick();
      app.getAppMetrics();
      await new Promise(resolve => setTimeout(resolve, 20_000));
      console.log("HIDDEN_IDLE_SAMPLE " + JSON.stringify(app.getAppMetrics().map(m => ({ type: m.type, cpuPercent: m.cpu.percentCPUUsage, workingSetKB: m.memory.workingSetSize }))));
    }
    quitting = true;
    app.exit(0);
  }
}
