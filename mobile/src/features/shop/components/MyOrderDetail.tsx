import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopOrder } from "@shop-contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, SkeletonList } from "@/ui/feedback";
import { AppText, Pill, type IconName } from "@/ui/primitives";
import { useMyOrders } from "../hooks";
import { orderLabel, orderMoment, orderSubtotal, orderTimeline, SHOP_STATUS, type TimelineStep } from "../lib/orders";
import { OrderSummary } from "./OrderSummary";
import { FormSection } from "./ShopUI";

/** One of the customer's orders: status timeline, delivery + tracking, items and totals. */
export function MyOrderDetail({ number }: { number: string }) {
  const t = useTheme();
  const { me } = useSignedIn();
  const q = useMyOrders();
  const order = q.data?.orders.find((o) => o.orderNumber === number);
  const title = <Stack.Screen options={{ title: orderLabel(number) }} />;

  if (q.isPending) return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{title}<SkeletonList rows={4} /></View>;
  if (q.isError) return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{title}<ErrorState message={q.error.message} onRetry={() => void q.refetch()} /></View>;
  if (!order) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {title}
        <EmptyState icon="receipt-outline" title="Order not found" body="It may have been removed by the store." action={{ label: "Back", onPress: () => router.back() }} />
      </View>
    );
  }
  const s = SHOP_STATUS[order.status];
  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {title}
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
      >
        <View style={{ gap: SPACE.sm }}>
          <Pill tone={s.tone} icon={s.icon as IconName} label={s.label} />
          <AppText variant="body" color="muted">{s.help}</AppText>
          <AppText variant="caption" color="faint">{`Placed ${orderMoment(order.placedAt)} · Payment ${order.paymentStatus === "paid" ? "received" : "pending"}`}</AppText>
        </View>
        <FormSection title="Progress">
          <Timeline steps={orderTimeline(order)} />
        </FormSection>
        <DeliveryCard order={order} />
        <FormSection title="Items">
          <OrderSummary
            totals={{ ...order, subtotal: orderSubtotal(order), courier: order.courier }}
            currency={me.store.currency}
          />
        </FormSection>
      </ScrollView>
    </View>
  );
}

function Timeline({ steps }: { steps: TimelineStep[] }) {
  const t = useTheme();
  return (
    <View accessibilityRole="list">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        const cancelled = step.status === "cancelled";
        const color = step.state === "upcoming" ? t.colors.border : cancelled ? t.tone("danger").fg : t.brand.link;
        const label = `${step.label}${step.state === "current" ? ", current" : step.state === "upcoming" ? ", not yet" : ", done"}${step.at ? `, ${orderMoment(step.at)}` : ""}`;
        return (
          <View key={step.status} style={styles.step} accessible accessibilityLabel={label}>
            <View style={styles.rail}>
              <View style={[styles.dot, { borderColor: color, backgroundColor: step.state === "upcoming" ? "transparent" : color }]}>
                {step.state === "done" ? <Ionicons name="checkmark" size={11} color={t.brand.onPrimary} /> : null}
              </View>
              {!last ? <View style={[styles.line, { backgroundColor: steps[i + 1].state === "upcoming" ? t.colors.border : color }]} /> : null}
            </View>
            <View style={[styles.stepText, last ? null : { paddingBottom: SPACE.lg }]}>
              <AppText variant={step.state === "current" ? "bodyStrong" : "body"} color={step.state === "upcoming" ? "faint" : "text"}>
                {step.label}
              </AppText>
              {step.at ? <AppText variant="caption" color="muted">{orderMoment(step.at)}</AppText> : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

function DeliveryCard({ order }: { order: ShopOrder }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  if (!order.courier && !order.trackingNumber && !order.shippingNote) return null;

  async function copy() {
    await Clipboard.setStringAsync(order.trackingNumber);
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <FormSection title="Delivery">
      {order.courier ? (
        <View style={styles.kv}>
          <AppText variant="body" color="muted">Courier</AppText>
          <AppText variant="bodyStrong">{order.courier}</AppText>
        </View>
      ) : null}
      {order.trackingNumber ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Tracking number ${order.trackingNumber}. Copy`}
          onPress={() => void copy()}
          style={({ pressed }) => [styles.tracking, { backgroundColor: t.colors.surfaceAlt, opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1 }}>
            <AppText variant="caption" color="muted">Tracking number</AppText>
            <AppText variant="bodyStrong" selectable>{order.trackingNumber}</AppText>
          </View>
          <Ionicons name={copied ? "checkmark" : "copy-outline"} size={18} color={t.brand.link} />
          <AppText variant="label" color="link">{copied ? "Copied" : "Copy"}</AppText>
        </Pressable>
      ) : (
        <AppText variant="caption" color="muted">A tracking number shows here once the store ships your order.</AppText>
      )}
      {order.shippingNote ? (
        <View style={{ gap: 2 }}>
          <AppText variant="caption" color="muted">Note from the store</AppText>
          <AppText variant="body" selectable>{order.shippingNote}</AppText>
        </View>
      ) : null}
    </FormSection>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  step: { flexDirection: "row", gap: SPACE.md },
  rail: { alignItems: "center", width: 20 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, alignItems: "center", justifyContent: "center", marginTop: 3 },
  line: { width: 2, flex: 1, marginVertical: 2 },
  stepText: { flex: 1 },
  kv: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: SPACE.md },
  tracking: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: TOUCH + 8, paddingHorizontal: SPACE.md, borderRadius: RADIUS.md },
});
