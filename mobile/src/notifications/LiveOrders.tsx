import { useCallback, useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Animated, Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import * as Notifications from "expo-notifications";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderSummary } from "@contract";
import { dashboardApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * Real-time new orders while the app is open — the Shopify "cha-ching" moment.
 *
 * Two sources, one toast:
 *   1. a push that arrives in the foreground (instant, when push is set up);
 *   2. a live poll of the dashboard every 20s (works even without push, and
 *      catches anything a push missed). The first load only seeds what's
 *      "already seen", so opening the app never replays old orders.
 * Either way every order screen is refreshed, and the app-icon badge tracks
 * the number of new orders.
 */

export const LIVE_POLL_MS = 20_000;
const TOAST_MS = 6_000;
const ORDER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type Toast = { orderId: string; title: string; body: string; more: number };

function toastFor(o: OrderSummary, more: number): Toast {
  const items = `${o.itemCount} ${o.itemCount === 1 ? "item" : "items"}`;
  return { orderId: o.id, title: `New order ${o.orderNumber}`, body: `${o.totalLabel} · ${o.customerName} · ${items}`, more };
}

export function LiveOrders() {
  const { me, scope } = useSignedIn();
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<Toast | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const q = useQuery({
    queryKey: qk.dashboard(scope),
    queryFn: dashboardApi.get,
    enabled: me.can.orders,
    refetchInterval: LIVE_POLL_MS,
  });

  const refreshEverything = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: qk.ordersAll(scope) });
    void queryClient.invalidateQueries({ queryKey: qk.insightsAll(scope) });
    void queryClient.invalidateQueries({ queryKey: qk.customersAll(scope) });
  }, [queryClient, scope]);

  const announce = useCallback((next: Toast) => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    AccessibilityInfo.announceForAccessibility(`${next.title}. ${next.body}`);
    setToast(next);
  }, []);

  // Source 2: the live poll — diff the latest orders against what we've shown.
  useEffect(() => {
    const recent = q.data?.recent;
    if (!recent) return;
    if (!seen.current) {
      seen.current = new Set(recent.map((o) => o.id));
      return;
    }
    const known = seen.current;
    const fresh = recent.filter((o) => !known.has(o.id));
    fresh.forEach((o) => known.add(o.id));
    if (fresh.length === 0) return;
    announce(toastFor(fresh[0], fresh.length - 1));
    refreshEverything();
  }, [q.data, announce, refreshEverything]);

  // The app-icon badge = orders waiting on the owner.
  useEffect(() => {
    if (q.data) void Notifications.setBadgeCountAsync(q.data.queue.newOrders).catch(() => undefined);
  }, [q.data]);

  // Source 1: a push while the app is open (the OS banner is suppressed then).
  useEffect(() => {
    if (!me.can.orders) return;
    const sub = Notifications.addNotificationReceivedListener((n) => {
      const data = n.request.content.data as { type?: unknown; orderId?: unknown } | undefined;
      if (data?.type !== "order" || typeof data.orderId !== "string" || !ORDER_ID_RE.test(data.orderId)) return;
      if (seen.current?.has(data.orderId)) return;
      seen.current?.add(data.orderId);
      announce({
        orderId: data.orderId,
        title: n.request.content.title ?? "New order",
        body: n.request.content.body ?? "Tap to review.",
        more: 0,
      });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard(scope) });
      refreshEverything();
    });
    return () => sub.remove();
  }, [me.can.orders, announce, refreshEverything, queryClient, scope]);

  return toast ? <OrderToast key={toast.orderId} toast={toast} onDone={() => setToast(null)} /> : null;
}

function OrderToast({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [y] = useState(() => new Animated.Value(-160));

  const hide = useCallback(() => {
    Animated.timing(y, { toValue: -160, duration: 220, useNativeDriver: true }).start(() => onDone());
  }, [y, onDone]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) y.setValue(0);
      else Animated.spring(y, { toValue: 0, useNativeDriver: true, damping: 18, stiffness: 180 }).start();
      timer = setTimeout(hide, TOAST_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [y, hide]);

  const open = () => {
    hide();
    router.push({ pathname: "/order/[id]", params: { id: toast.orderId } });
  };

  return (
    <Animated.View
      accessibilityLiveRegion="assertive"
      style={[styles.wrap, { top: insets.top + SPACE.sm, transform: [{ translateY: y }] }]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${toast.title}. ${toast.body}`}
        accessibilityHint="Opens the order"
        onPress={open}
        style={({ pressed }) => [styles.toast, { backgroundColor: t.colors.band, opacity: pressed ? 0.92 : 1 }]}
      >
        <View style={[styles.icon, { backgroundColor: t.colors.chartOnBand }]}>
          <Ionicons name="bag-check" size={20} color={t.colors.band} />
        </View>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong" color={t.colors.bandText} numberOfLines={1}>
            {toast.title}
          </AppText>
          <AppText variant="caption" color={t.colors.bandMuted} numberOfLines={2}>
            {toast.more > 0 ? `${toast.body} · +${toast.more} more` : toast.body}
          </AppText>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" hitSlop={12} onPress={hide}>
          <Ionicons name="close" size={18} color={t.colors.bandMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: "absolute", left: SPACE.md, right: SPACE.md, zIndex: 100, elevation: 12 },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    padding: SPACE.md,
    paddingRight: SPACE.lg,
    borderRadius: RADIUS.lg,
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  icon: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});
