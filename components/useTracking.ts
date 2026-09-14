"use client";
import * as React from "react";
import { createTrackingHook, TRACKING_KEY } from "@/lib/use-tracking";
import { newId } from "@/lib/storage";

export const useTracking = createTrackingHook(React, {
  read: async () => window.localStorage.getItem(TRACKING_KEY),
  write: async value => window.localStorage.setItem(TRACKING_KEY, value),
  controllerId: async () => {
    const key = "yantasks.timer-tab";
    const id = window.sessionStorage.getItem(key) ?? newId();
    window.sessionStorage.setItem(key, id); return id;
  },
  enableNotifications: async () => {
    if (!("Notification" in window)) return "Browser alerts unsupported — use in-app alerts";
    const result = await Notification.requestPermission();
    return result === "granted" ? "Alerts enabled" : "Alerts blocked — enable in browser settings";
  },
  // Browser notifications require a running page. iOS uses scheduled OS alerts.
  scheduleNotifications: async () => {},
  notify: event => {
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification(event.title, { body: event.body, tag: event.id }); } catch { /* In-app banner remains available. */ }
    }
  },
});
export type Tracker = ReturnType<typeof useTracking>;
