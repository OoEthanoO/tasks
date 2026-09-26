import type { Task } from "../../lib/types";
import type { RestSettings } from "../../lib/rest";
import type { TrackingAction, TrackingState } from "../../lib/tracking";

export type Settings = { alerts: boolean; sound: boolean; mini: boolean; launchAtLogin: boolean };
export const defaults: Settings = { alerts: true, sound: true, mini: false, launchAtLogin: false };
export type DesktopState = {
  state: TrackingState; accountId: string | null; ready: boolean; busy: boolean;
  error: string | null; message: string | null; connected: boolean; settings: Settings;
};
export type ApiRequest = { path: string; method: string; body?: string };
export type ApiReply = { status: number; body: unknown };
export type GuestConfig = { tasks: Task[]; endTime: string; rest: RestSettings; accountId: string | null };
export interface DesktopBridge {
  api(request: ApiRequest): Promise<ApiReply>;
  snapshot(): Promise<DesktopState>;
  configure(config: GuestConfig): Promise<void>;
  command(action: TrackingAction): Promise<void>;
  refresh(): Promise<void>;
  settings(value: Partial<Settings>): Promise<void>;
  window(action: "main" | "mini" | "hide-mini" | "test-alert" | "dismiss"): Promise<void>;
  subscribe(listener: (state: DesktopState) => void): () => void;
}
declare global { interface Window { desktop: DesktopBridge } }
