import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge, DesktopState } from "./contract";
const bridge: DesktopBridge = {
  api: request => ipcRenderer.invoke("api", request),
  snapshot: () => ipcRenderer.invoke("snapshot"),
  configure: config => ipcRenderer.invoke("configure", config),
  command: action => ipcRenderer.invoke("command", action),
  refresh: () => ipcRenderer.invoke("refresh"),
  settings: value => ipcRenderer.invoke("settings", value),
  window: action => ipcRenderer.invoke("window", action),
  subscribe: listener => {
    const handler = (_event: Electron.IpcRendererEvent, state: DesktopState) => listener(state);
    ipcRenderer.on("state", handler);
    return () => ipcRenderer.removeListener("state", handler);
  },
};
contextBridge.exposeInMainWorld("desktop", bridge);
