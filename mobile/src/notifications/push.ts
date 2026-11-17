import { Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import Constants from "expo-constants";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import type { PUSH_SOUND_CHANNELS as CONTRACT_SOUND_CHANNELS } from "@contract";
import { devicesApi } from "@/api/endpoints";

/**
 * Push notifications (Expo Push Service): new orders (a chime) and community
 * chats (a soft pop) — see PUSH_SOUND_CHANNELS.
 *
 * The phone's token is registered against the CURRENT session only; the server
 * moves it if the phone signs into another store and deletes it on sign-out,
 * so this device can never receive a store's alerts after leaving it.
 * Remote push needs a development or production build (not Expo Go on Android)
 * and an EAS project id — see mobile/README.md.
 */

/**
 * The app's copy of the contract's PUSH_SOUND_CHANNELS. Metro can't bundle a
 * runtime value from the server contract (only types cross over), so the app
 * keeps its own — typed as the contract's, so any drift fails the typecheck.
 */
const PUSH_SOUND_CHANNELS: typeof CONTRACT_SOUND_CHANNELS = {
  orders: { androidChannelId: "orders_chime", name: "New orders", sound: "order_chime.wav" },
  messages: { androidChannelId: "chat_pop", name: "Chats and drops", sound: "chat_pop.wav" },
  promos: { androidChannelId: "promos", name: "Promos & events", sound: "chat_pop.wav" },
};

const ORDERS = PUSH_SOUND_CHANNELS.orders;
const MESSAGES = PUSH_SOUND_CHANNELS.messages;
const PROMOS = PUSH_SOUND_CHANNELS.promos;
/** Channels from builds before the custom sounds (a channel's sound can't change, so they're replaced). */
const LEGACY_CHANNELS = ["orders", "messages"];
const TOKEN_KEY = "pepweb.pushToken.v1";
const ASKED_KEY = "pepweb.pushAsked.v1";

/** Pushes that point at a chat thread (DM, channel topic, drop, group buy, order update). */
const CHAT_TYPES = new Set(["dm", "topic", "drop", "group_buy", "order_update", "gb_join_update"]);

/**
 * The chat thread on screen right now (set by ThreadScreen while focused). A
 * push for it stays silent — the message is already appearing in front of you.
 */
let activeThreadId: string | null = null;
export function setActiveThread(id: string | null): void {
  activeThreadId = id;
}

// Foreground: the app shows its own new-order toast (LiveOrders.tsx), so the
// OS banner is skipped for orders — but the chime still plays and it stays in
// the list. Chats have no in-app toast, so they keep the banner and the pop —
// unless that very chat is open.
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const data = n.request.content.data as { type?: unknown; threadId?: unknown } | undefined;
    const type = typeof data?.type === "string" ? data.type : "";
    const viewing = CHAT_TYPES.has(type) && activeThreadId !== null && data?.threadId === activeThreadId;
    // Tracker reminders are local (features/tracker/reminders.ts) and have no in-app toast: always a banner.
    const isTrackerReminder = type === "tracker";
    return {
      shouldShowBanner: isTrackerReminder || (CHAT_TYPES.has(type) && !viewing),
      shouldShowList: !viewing,
      shouldPlaySound: !viewing,
      shouldSetBadge: true,
    };
  },
});

export type PushSetup =
  | { ok: true }
  | { ok: false; reason: "denied" | "unsupported" | "not-configured" | "error"; message: string };

/**
 * Android takes a notification's sound from its channel, fixed at creation —
 * so the chime and the pop each get their own channel, and the pre-sound
 * channels are removed (otherwise they'd linger in the phone's settings).
 * Each channel still shows up in Android settings, where people can change
 * or silence it themselves.
 */
export async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync(ORDERS.androidChannelId, {
    name: ORDERS.name,
    importance: Notifications.AndroidImportance.HIGH,
    sound: ORDERS.sound,
    vibrationPattern: [0, 200, 120, 200],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  await Notifications.setNotificationChannelAsync(MESSAGES.androidChannelId, {
    name: MESSAGES.name,
    importance: Notifications.AndroidImportance.HIGH,
    sound: MESSAGES.sound,
    vibrationPattern: [0, 150, 100, 150],
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
  });
  // Promos are opt-in and never urgent: default importance (sound, no heads-up), mutable on their own.
  await Notifications.setNotificationChannelAsync(PROMOS.androidChannelId, {
    name: PROMOS.name,
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: PROMOS.sound,
    lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  });
  await Promise.all(LEGACY_CHANNELS.map((id) => Notifications.deleteNotificationChannelAsync(id).catch(() => undefined)));
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
