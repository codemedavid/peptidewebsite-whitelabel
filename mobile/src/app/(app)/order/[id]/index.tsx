import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { OrderDetail } from "@contract";
import { ApiError } from "@/api/client";
import { useOrder, useTrashOrder } from "@/features/orders/hooks";
import {
  CustomerSection,
  ItemsSection,
  NotesSection,
  PaymentSection,
  TimelineSection,
} from "@/features/orders/OrderSections";
import { STATUS_META, formatFull } from "@/features/orders/status";
import { useStatusChange } from "@/features/orders/useStatusChange";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { AppText, Button, Pill } from "@/ui/primitives";

function Summary({ order }: { order: OrderDetail }) {
  const meta = STATUS_META[order.status];
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="title" brandFont accessibilityRole="header">
        {order.orderNumber}
      </AppText>
      <AppText variant="caption" color="muted">{`Placed ${formatFull(order.placedAt)}`}</AppText>
      <View style={styles.pills}>
        <Pill tone={meta.tone} icon={meta.icon} label={meta.label} />
        {order.orderType === "reseller" ? <Pill tone="neutral" icon="briefcase-outline" label="Reseller" /> : null}
        {order.groupBuyName ? <Pill tone="neutral" icon="people-outline" label={order.groupBuyName} /> : null}
      </View>
      <AppText variant="body" color="muted">{meta.help}</AppText>
      <AppText variant="display" style={styles.total}>{order.totalLabel}</AppText>
    </View>
  );
}

function ActionBar({ order }: { order: OrderDetail }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { request, isPending, online } = useStatusChange(order);
  const next = order.nextAction;
  const openStatusSheet = () => router.push({ pathname: "/order/[id]/status", params: { id: order.id } });

  return (
    <View
      style={[
        styles.bar,
        { paddingBottom: Math.max(insets.bottom, SPACE.md), backgroundColor: t.colors.surface, borderTopColor: t.colors.border },
      ]}
    >
      {!online ? (
        <AppText variant="caption" color="muted" style={{ textAlign: "center" }}>
          Reconnect to update this order.
        </AppText>
      ) : null}
      {next ? (
        <Button
          label={next.label}
          icon={next.needsTracking ? "paper-plane" : "checkmark"}
          loading={isPending}
          disabled={!online}
          onPress={() => void request(next.to)}
          accessibilityHint={next.needsTracking ? "Asks for the courier and tracking number" : undefined}
        />
      ) : null}
      <Button label="Change status" variant={next ? "ghost" : "secondary"} icon="swap-vertical" disabled={!online || isPending} onPress={openStatusSheet} />
    </View>
  );
}

export default function OrderScreen() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useOrder(id ?? "");
  const { trash, restore } = useTrashOrder(id ?? "");

  if (q.isPending) return <SkeletonList rows={4} />;
  if (q.isError) {
    const gone = q.error instanceof ApiError && q.error.code === "not_found";
    return gone ? (
      <EmptyState
        icon="eye-off-outline"
        title="This order isn't available"
        body="It may have been deleted, or it belongs to a different store or account."
        action={{ label: "Back to orders", onPress: () => router.back() }}
      />
    ) : (
      <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
    );
  }
  const order = q.data;

  function confirmTrash() {
    Alert.alert(`Move ${order.orderNumber} to trash?`, "It disappears from your lists and reports. Stock isn't changed, and you can undo this.", [
      { text: "Keep order", style: "cancel" },
      {
        text: "Move to trash",
        style: "destructive",
        onPress: () =>
          trash.mutate(undefined, {
            onSuccess: () => {
              router.back();
              Alert.alert("Moved to trash", `${order.orderNumber} was moved to the trash.`, [
                { text: "Undo", onPress: () => restore.mutate() },
                { text: "OK", style: "cancel" },
              ]);
            },
            onError: (e) => Alert.alert("Couldn't delete the order", e.message),
          }),
      },
    ]);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Stack.Screen options={{ title: order.orderNumber }} />
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
      >
        <Summary order={order} />
        <CustomerSection order={order} />
        <ItemsSection order={order} />
        <PaymentSection order={order} />
        <NotesSection order={order} onEdit={() => router.push({ pathname: "/order/[id]/tracking", params: { id: order.id } })} />
        <TimelineSection order={order} />
        <Button label="Move to trash" variant="ghost" icon="trash-outline" loading={trash.isPending} onPress={confirmTrash} style={{ marginTop: SPACE.xl }} />
      </ScrollView>
      <ActionBar order={order} />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, gap: SPACE.sm },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  total: { marginTop: SPACE.sm, fontVariant: ["tabular-nums"] },
  bar: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: SPACE.xs, borderTopWidth: StyleSheet.hairlineWidth },
});
