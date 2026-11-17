import { useEffect } from "react";
import { Platform } from "react-native";
import { router, type Href } from "expo-router";
import * as Notifications from "expo-notifications";
import { useSignedIn } from "@/auth/SessionProvider";
import { communityAccess } from "@/features/community/lib/access";
import { pushTarget, resolvePushRoute, type PushRoute } from "@/features/community/lib/pushTarget";
import { trackerAccess } from "@/features/tracker/access";
import { trackerHomePath } from "@/features/tracker/components/routes";
import { ACTION_SNOOZE, ACTION_TAKEN, handleTrackerResponse } from "@/features/tracker/reminders";
import { useTrackerRuntime } from "@/features/tracker/runtime";

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
    case "/tracker": {
      // Tracker routes are built from a target (features/tracker/lib/target.ts), so typed routes can't see them.
      // "Home" is the customer's tab or the team's own page (trackerHomePath).
      const href = (route.href === "/tracker" ? trackerHomePath() : route.href) as Href;
      if (route.method === "push") router.push(href);
      else router.navigate(href);
      return;
    }
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
  const { me, scope } = useSignedIn();
  const mode = me.mode;
  const canOrders = me.can.orders;
  const inCommunity = communityAccess(me).inCommunity;
  // `active` = the tab minus app guests: a guest gets the sign-up lock only — no
  // store, no sync, no reminders (the server refuses guests: TRACKER_GUEST_REFUSED).
  const tracker = trackerAccess(me).active;
  // Binds the tracker store, sync and local reminders to this account (sign-out unbinds).
  useTrackerRuntime(scope, tracker);

  // A reminder's Taken / Snooze button: the tracker logs (or snoozes) for the bound account.
  useEffect(() => {
    if (!enabled || !response || !tracker) return;
    const action = response.actionIdentifier;
    if (action !== ACTION_TAKEN && action !== ACTION_SNOOZE) return;
    const key = `${response.notification.request.identifier}:${action}`;
    if (handled.has(key)) return;
    handled.add(key);
    void handleTrackerResponse(response).then((outcome) => {
      if (outcome?.kind !== "logged" && outcome?.kind !== "open") return;
      try {
        router.navigate(trackerHomePath() as Href);
      } catch {
        // Navigator not ready: the dose is logged either way.
      }
    });
  }, [enabled, response, tracker]);

  useEffect(() => {
    if (!enabled || !response) return;
    if (response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
    const key = response.notification.request.identifier;
    if (handled.has(key)) return;

    const target = pushTarget(response.notification.request.content.data);
    // "You're in" can arrive before this phone's /me catches up (it reloads on
    // foreground): wait for the approval to land instead of filing the tap.
    if (target?.screen === "member_approved" && mode === "customer" && !inCommunity) return;
    const route = resolvePushRoute(target, { mode, canOrders, inCommunity, tracker });
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
  }, [enabled, response, mode, canOrders, inCommunity, tracker]);
}
