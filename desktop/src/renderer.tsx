import { createRoot } from "react-dom/client";
import { useState } from "react";
import Page from "../../app/page";
import { ApiError, setApiTransport } from "../../lib/remote";
import { formatDuration, remainingWorkTime, type TrackingAction } from "../../lib/tracking";
import { resolveColorScheme, sanitizeThemePreference, THEME_KEY } from "../../lib/theme";
import { statusModel } from "./model";
import { useDesktopState } from "./useTracking";
import "../../app/globals.css";
import "./styles.css";

setApiTransport(async (path, init) => {
  try { return await window.desktop.api({ path, method: init?.method ?? "GET", ...(typeof init?.body === "string" ? { body: init.body } : {}) }); }
  catch { throw new ApiError("Could not connect to the desktop service.", 0); }
}, 30_000);
const compact = new URLSearchParams(location.search).has("mini");
document.documentElement.dataset.theme = resolveColorScheme(sanitizeThemePreference(localStorage.getItem(THEME_KEY)), matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
if (compact) document.body.classList.add("compact");

function Mini() {
  const view = useDesktopState();
  const m = statusModel(view);
  const [error, setError] = useState("");
  const command = async (action: TrackingAction = { type: view.state.mode === "idle" ? "start" : "pause" }) => {
    setError("");
    try { await window.desktop.command(action); }
    catch (e) { setError(e instanceof Error ? e.message : "Cannot update timer."); }
  };
  return <main className={`mini mode-${view.state.mode}`}>
    <header className="mini-drag"><span>YANTASKS <span className="mini-pin">ALWAYS ON TOP</span></span><button className="mini-close" aria-label="Hide mini tracker" onClick={() => void window.desktop.window("hide-mini")}>×</button></header>
    <div className="mini-state"><i className="status-dot" />{m.label}<span>{!view.connected ? "OFFLINE" : view.accountId ? "SYNCED" : "THIS PC"}</span></div>
    <h1 title={m.title}>{m.title}</h1>
    <div className="mini-clock">{formatDuration(view.state.mode === "rest" ? m.remaining : m.elapsed, true)}</div>
    <p className="mini-sub">{view.state.mode === "rest" ? "Rest remaining · work resumes automatically" : view.state.mode === "work" ? `${formatDuration(m.remaining)} left on task${m.restIn === null ? "" : ` · break in ${formatDuration(m.restIn)}`}` : "Choose a task or resume your daily targets."}</p>
    <div className="mini-progress" role="progressbar" aria-label="Current target progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, m.progress) * 100)}><span style={{ width: `${Math.max(0, m.progress) * 100}%` }} /></div>
    <div className="mini-stats"><div><span>WORKED</span><strong>{formatDuration(view.state.workMs)}</strong></div><div><span>RESTED</span><strong>{formatDuration(view.state.restMs)}</strong></div><div><span>WORK LEFT</span><strong>{formatDuration(remainingWorkTime(view.state))}</strong></div></div>
    <div className="mini-actions"><button className="btn btn-primary" disabled={!view.ready || view.busy || view.state.mode === "idle" && !m.canStart} onClick={() => void command()}>{view.busy ? "Syncing…" : view.state.mode === "idle" ? "Start / resume" : "Pause tracking"}</button>{m.canSkipRest
      // The mini window has room for two buttons; during a break, skipping matters more than opening the list.
      ? <button className="btn btn-ghost" disabled={!view.ready || view.busy} onClick={() => void command({ type: "skip-rest" })}>Skip break</button>
      : <button className="btn btn-ghost" onClick={() => void window.desktop.window("main")}>Open tasks ↗</button>}</div>
    {(error || view.error || view.message) && <p role="status" className="mini-message" title={error || view.error || view.message || ""}>{error || view.error || view.message}</p>}
  </main>;
}

function Desktop() {
  const view = useDesktopState();
  const m = statusModel(view);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const setting = async (key: "alerts" | "sound" | "launchAtLogin", value: boolean) => {
    try { await window.desktop.settings({ [key]: value }); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save settings."); }
  };
  return <><div className={`desktop-bar mode-${view.state.mode}`}>
    <div className="desktop-status"><i className="status-dot" /><strong>{m.label}</strong><span>{view.state.mode !== "idle" ? m.title : "Closing the window keeps alerts running in the tray."}</span></div>
    <div className="desktop-buttons"><button className="btn btn-ghost" onClick={() => void window.desktop.window("mini")}>Mini tracker</button><button className="btn btn-ghost" aria-expanded={open} onClick={() => setOpen(!open)}>Windows settings</button></div>
  </div>{open && <section className="desktop-settings" aria-label="Windows settings">
    <div><h2>Here even when the window isn’t.</h2><p>YanTasks keeps checking your timer from the tray. Right-click its icon for quick controls. To stop desktop alerts, choose Quit in the tray menu.</p></div>
    <label><input type="checkbox" checked={view.settings.alerts} onChange={e => void setting("alerts", e.target.checked)} /> Native Windows alerts</label>
    <label><input type="checkbox" checked={view.settings.sound} onChange={e => void setting("sound", e.target.checked)} /> Notification sound</label>
    <label><input type="checkbox" checked={view.settings.launchAtLogin} onChange={e => void setting("launchAtLogin", e.target.checked)} /> Launch quietly at Windows sign-in</label>
    <button className="btn btn-ghost" onClick={() => void window.desktop.window("test-alert")}>Send a test alert</button>
    <p className="hint">Battery-aware: hidden windows stop updating, background sync slows while idle or on battery, and alert wakeups follow task/rest boundaries. YanTasks never keeps your PC awake. Alerts require a running app and an awake PC; Windows Do Not Disturb may silence them.</p>
    {error && <p className="danger" role="alert">{error}</p>}
  </section>}<Page /></>;
}
createRoot(document.getElementById("root")!).render(compact ? <Mini /> : <Desktop />);
