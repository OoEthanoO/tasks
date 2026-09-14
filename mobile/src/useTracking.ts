import * as React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Notifications from "expo-notifications";
import { AppState, Platform } from "react-native";
import { createTrackingHook, TRACKING_KEY } from "../../lib/use-tracking";
import { TrackingEvent } from "../../lib/tracking";
import { newId } from "./store";

Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }) });
let scheduledFingerprint = "";
let notificationQueue: Promise<void> = Promise.resolve();
function permissionLabel(permission: Notifications.NotificationPermissionsStatus): string {
  if (permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL) return "Quiet alerts enabled";
  if (permission.granted) return "Alerts enabled";
  return permission.canAskAgain ? "Enable alerts" : "Alerts blocked — enable in device settings";
}
function schedule(events: TrackingEvent[]): Promise<void> {
  // Serialize cancellation/replacement, including when a request finishes after
  // sign-out. Only this feature's notification IDs are touched.
  notificationQueue = notificationQueue.catch(() => {}).then(async () => {
    if (Platform.OS === "web") return;
    const fingerprint = JSON.stringify(events);
    const permission = await Notifications.getPermissionsAsync();
    const allowed = permission.granted || permission.ios?.status === Notifications.IosAuthorizationStatus.PROVISIONAL;
    if (allowed && fingerprint === scheduledFingerprint) return;
    const existing = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(existing.filter(n => n.identifier.startsWith("yantasks:")).map(n => Notifications.cancelScheduledNotificationAsync(n.identifier)));
    if (!allowed) { scheduledFingerprint = ""; return; }
    for (const event of events.filter(e => e.at > Date.now() + 250)) {
      await Notifications.scheduleNotificationAsync({
        identifier: `yantasks:${event.id}`,
        content: { title: event.title, body: event.body, sound: "default" },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(event.at), channelId: "work-timer" },
      });
    }
    scheduledFingerprint = fingerprint;
  });
  return notificationQueue;
}
export const useTracking = createTrackingHook(React, {
  read: () => AsyncStorage.getItem(TRACKING_KEY),
  write: value => AsyncStorage.setItem(TRACKING_KEY, value),
  controllerId: async () => {
    const key = "yantasks.timer-device";
    const id = await AsyncStorage.getItem(key) ?? newId();
    await AsyncStorage.setItem(key, id); return id;
  },
  notificationPermission: async () => Platform.OS === "web" ? "Use the native app for phone alerts" : permissionLabel(await Notifications.getPermissionsAsync()),
  onForeground: listener => {
    const subscription = AppState.addEventListener("change", state => { if (state === "active") listener(); });
    return () => subscription.remove();
  },
  enableNotifications: async () => {
    if (Platform.OS === "web") return "Use the native app for phone alerts";
    if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("work-timer", { name: "Task and rest timer", importance: Notifications.AndroidImportance.HIGH, sound: "default" });
    const permission = await Notifications.requestPermissionsAsync();
    scheduledFingerprint = "";
    return permissionLabel(permission);
  },
  scheduleNotifications: schedule,
  notify: () => {}, // Already scheduled with the OS; do not alert twice in the foreground.
});
export type Tracker = ReturnType<typeof useTracking>;
