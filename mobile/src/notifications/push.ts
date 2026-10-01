import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { devicesApi } from "@/api/endpoints";

/**
 * New-order push notifications (Expo Push Service).
 *
 * The phone's token is registered against the CURRENT session only; the server
 * moves it if the phone signs into another store and deletes it on sign-out,
 * so this device can never receive a store's alerts after leaving it.
 * Remote push needs a development or production build (not Expo Go on Android)
 * and an EAS project id — see mobile/README.md.
 */

export const ORDERS_CHANNEL = "orders";
/** DMs and product drops (community). */
export const MESSAGES_CHANNEL = "messages";
const TOKEN_KEY = "pepweb.pushToken.v1";
const ASKED_KEY = "pepweb.pushAsked.v1";

// Foreground: the app shows its own new-order toast (LiveOrders.tsx), so the
// OS banner is skipped for orders — but the sound still plays and it stays in
// the list. DMs and drops have no in-app toast, so they keep the banner.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const type = (n.request.content.data as { type?: unknown } | undefined)?.type;
    return {
      shouldShowBanner: type === "dm" || type === "drop",
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    };
  },
});

export type PushSetup =
  | { ok: true }
  | { ok: false; reason: "denied" | "unsupported" | "not-configured" | "error"; message: string };

export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ORDERS_CHANNEL, {
    name: "New orders",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync(MESSAGES_CHANNEL, {
    name: "Messages and drops",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 150, 100, 150],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
}

export async function permissionStatus(): Promise<"granted" | "denied" | "undetermined"> {
  const p = await Notifications.getPermissionsAsync();
  return p.granted ? "granted" : p.canAskAgain ? "undetermined" : "denied";
}

function projectId(): string | null {
  const id =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  return id && id.trim() ? id : null;
}

export type PushOptions = {
  /** New-order alerts — store admins only; customers register for messages alone. */
  newOrders?: boolean;
  /** For the "turned off" message: this binary is shared by every store and by customers. */
  storeName?: string;
};

/** Ask (if needed), get this phone's Expo token and bind it to the session. */
export async function enablePush({ newOrders = true, storeName }: PushOptions = {}): Promise<PushSetup> {
  if (!Device.isDevice) {
    return { ok: false, reason: "unsupported", message: "Notifications need a real phone, not a simulator." };
  }
  const id = projectId();
  if (!id) {
    return { ok: false, reason: "not-configured", message: "This build isn't set up for notifications yet." };
  }
  try {
    await ensureAndroidChannel();
    let status = await permissionStatus();
    if (status === "undetermined") {
      const res = await Notifications.requestPermissionsAsync();
      status = res.granted ? "granted" : "denied";
    }
    await AsyncStorage.setItem(ASKED_KEY, "1");
    if (status !== "granted") {
      return { ok: false, reason: "denied", message: storeName
          ? `Notifications are turned off for this app in your phone's settings, so ${storeName} can't reach you. Turn them on there.`
          : "Notifications are turned off for this app in your phone's settings." };
    }
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    await devicesApi.register({ expoPushToken: token, platform: Platform.OS === "ios" ? "ios" : "android", newOrders });
    await AsyncStorage.setItem(TOKEN_KEY, token);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: "error", message: e instanceof Error ? e.message : "Couldn't turn on notifications." };
  }
}

/** Stop new-order alerts on this phone (keeps the OS permission untouched). */
export async function disablePush(): Promise<void> {
  const token = await AsyncStorage.getItem(TOKEN_KEY);
  if (token) await devicesApi.unregister(token).catch(() => undefined);
  await AsyncStorage.removeItem(TOKEN_KEY);
}

export async function isPushEnabledHere(): Promise<boolean> {
  return (await AsyncStorage.getItem(TOKEN_KEY)) !== null && (await permissionStatus()) === "granted";
}

/** Re-bind silently after sign-in when permission was already granted earlier. */
export async function rebindIfGranted(options: PushOptions = {}): Promise<void> {
  if (!Device.isDevice || !projectId()) return;
  if ((await permissionStatus()) === "granted") await enablePush(options);
}

/** Showing the explainer counts as asking — "Not now" must not re-prompt every launch. */
export async function markAsked(): Promise<void> {
  await AsyncStorage.setItem(ASKED_KEY, "1").catch(() => undefined);
}

export async function hasBeenAsked(): Promise<boolean> {
  return (await AsyncStorage.getItem(ASKED_KEY)) === "1";
}

/** Local cleanup on sign-out (the server already dropped the registration). */
export async function forgetPushToken(): Promise<void> {
  await AsyncStorage.removeItem(TOKEN_KEY).catch(() => undefined);
}
