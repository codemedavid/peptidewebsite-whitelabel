import { useEffect } from "react";
import { Platform } from "react-native";
import { router } from "expo-router";
import * as Notifications from "expo-notifications";
import { useSignedIn } from "@/auth/SessionProvider";
import { communityAccess } from "@/features/community/lib/access";
import { pushTarget, resolvePushRoute, type PushRoute } from "@/features/community/lib/pushTarget";

/**
 * Tapping a notification opens what it points at: a new order, a DM, or the
 * topic a product drop was announced in — whether the app was running,
 * backgrounded or killed (useLastNotificationResponse covers all
 * three). Mounted inside the SIGNED-IN layout, so a tap while signed out waits
 * until sign-in.
 *
 * The payload is only a pointer: every screen loads through the
 * authenticated API, which re-checks the session, the store and the Orders
 * permission. An order from another store simply shows "not available".
 */

const handled = new Set<string>();

// expo-notifications has no web module (the call throws), and a browser gets no taps.
const useLastResponse: typeof Notifications.useLastNotificationResponse =
  Platform.OS === "web" ? () => null : Notifications.useLastNotificationResponse;

function go(route: PushRoute): void {
  switch (route.pathname) {
    case "/order/[id]":
    case "/my-order/[number]":
      router.push({ pathname: route.pathname, params: route.params } as Parameters<typeof router.push>[0]);
      return;
    case "/community/dm/[id]":
    case "/community/topic/[id]":
      // navigate, not push: a tap for the thread already open doesn't stack a copy.
      router.navigate({ pathname: route.pathname, params: route.params });
      return;
    default:
      router.navigate(route.pathname);
  }
}

/**
 * Mounted inside the signed-in layout. Each tap is checked against THIS
 * account (mode, orders permission, community access) — a target it can't
 * open lands on the mode's home tab instead.
 */
export function useNotificationRouting(enabled: boolean): void {
  const response = useLastResponse();
  const { me } = useSignedIn();
  const mode = me.mode;
  const canOrders = me.can.orders;
  const inCommunity = communityAccess(me).inCommunity;

  useEffect(() => {
    if (!enabled || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = response.notification.request.identifier;
    if (handled.has(key)) return;

    const route = resolvePushRoute(pushTarget(response.notification.request.content.data), { mode, canOrders, inCommunity });
    if (!route) {
      handled.add(key);
      return;
    }
    try {
      go(route);
      handled.add(key); // only once we actually got there
    } catch {
      // Navigator not ready yet — the next render of this effect tries again.
    }
  }, [enabled, response, mode, canOrders, inCommunity]);
}
