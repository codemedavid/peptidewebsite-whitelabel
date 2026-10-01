import { useRef } from "react";
import { Alert } from "react-native";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import type { OrderDetail, OrderStatus } from "@contract";
import { useOnline } from "@/ui/feedback";
import { OrderConflict, useUpdateOrder } from "./hooks";
import { STATUS_META, stockEffectCopy } from "./status";

/**
 * The single way a screen moves an order to another status:
 *   - shipping first collects courier + tracking (the tracking sheet);
 *   - anything that moves stock, and any cancellation, asks for confirmation
 *     and says in plain words what will happen;
 *   - offline, nothing is sent (no silent queueing of stock changes);
 *   - a second tap while one is in flight is ignored;
 *   - a conflict explains that the latest version is now on screen.
 */
export function useStatusChange(order: OrderDetail | undefined) {
  const online = useOnline();
  const mutation = useUpdateOrder(order?.id ?? "");
  // Render-time isPending can't stop two taps in one frame, or two stacked
  // confirmation alerts; this ref covers the whole prompt → save window.
  const inFlight = useRef(false);

  function reportError(e: unknown) {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error).catch(() => undefined);
    if (e instanceof OrderConflict) {
      Alert.alert("This order just changed", "Someone else updated it. We've loaded the latest version — check it before trying again.");
    } else {
      Alert.alert("Couldn't update the order", e instanceof Error ? e.message : "Please try again.");
    }
  }

  async function commit(to: OrderStatus): Promise<boolean> {
    try {
      await mutation.mutateAsync({ status: to });
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      return true;
    } catch (e) {
      reportError(e);
      return false;
    }
  }

  /** Resolves true when the change was saved. */
  function request(to: OrderStatus): Promise<boolean> {
    if (!order || inFlight.current || mutation.isPending) return Promise.resolve(false);
    if (!online) {
      Alert.alert("You're offline", "Reconnect to update this order. Nothing was changed.");
      return Promise.resolve(false);
    }
    if (to === "shipped") {
      router.push({ pathname: "/order/[id]/tracking", params: { id: order.id, ship: "1" } });
      return Promise.resolve(false);
    }
    inFlight.current = true;
    const done = (ok: boolean) => {
      inFlight.current = false;
      return ok;
    };
    const effect = stockEffectCopy(order.stockEffects[to] ?? null);
    if (!effect && to !== "cancelled") return commit(to).then(done);

    const label = STATUS_META[to].label;
    return new Promise((resolve) =>
      Alert.alert(
        to === "cancelled" ? `Cancel order ${order.orderNumber}?` : `Mark as ${label.toLowerCase()}?`,
        [effect, "The customer is notified if your store sends status emails."].filter(Boolean).join("\n\n"),
        [
          { text: "Not now", style: "cancel", onPress: () => resolve(done(false)) },
          {
            text: to === "cancelled" ? "Cancel order" : `Yes, ${label.toLowerCase()}`,
            style: to === "cancelled" ? "destructive" : "default",
            onPress: () => void commit(to).then((ok) => resolve(done(ok))),
          },
        ],
        // Android back / outside tap must still settle the prompt.
        { cancelable: true, onDismiss: () => resolve(done(false)) },
      ),
    );
  }

  return { request, isPending: mutation.isPending, online, mutation };
}
