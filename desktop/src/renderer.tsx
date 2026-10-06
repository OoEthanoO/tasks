import { createRoot } from "react-dom/client";
import { useState } from "react";
import Page from "../../app/page";
import { ApiError, setApiTransport } from "../../lib/remote";
import { formatDuration, type TrackingAction } from "../../lib/tracking";
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
    <div className="mini-clock" aria-label={m.clockLabel}>{formatDuration(m.remaining, true)}</div>
    <p className="mini-sub">{m.hint}</p>
    <div className="mini-progress" role="progressbar" aria-label="Current turn progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, m.progress) * 100)}><span style={{ width: `${Math.max(0, m.progress) * 100}%` }} /></div>
    <div className="mini-actions"><button className="btn btn-primary" disabled={!view.ready || view.busy || (m.paused ? !m.canStart : !m.canPause)} onClick={() => void command()}>{view.busy ? "Syncing…" : m.paused ? "Start" : "Pause"}</button><button className="btn btn-ghost" onClick={() => void window.desktop.window("main")}>Open tasks ↗</button></div>
    {(error || view.error || view.message) && <p role="status" className="mini-message" title={error || view.error || view.message || ""}>{error || view.error || view.message}</p>}
  </main>;
}

function Desktop() {
  const view = useDesktopState();
  const m = statusModel(view);
  return <><div className={`desktop-bar mode-${view.state.mode}`}>
    <div className="desktop-status"><i className="status-dot" /><strong>{m.label}</strong><span>{m.title}</span></div>
    <div className="desktop-buttons"><button className="btn btn-ghost" onClick={() => void window.desktop.window("mini")}>Mini tracker</button></div>
  </div><Page /></>;
}
createRoot(document.getElementById("root")!).render(compact ? <Mini /> : <Desktop />);
