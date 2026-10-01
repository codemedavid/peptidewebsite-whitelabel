import { memo } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OrderSummary } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Pill } from "@/ui/primitives";
import { STATUS_META, formatWhen } from "./status";

const PAYMENT_ICON = { info: "document-attach-outline", success: "wallet-outline", warning: "time-outline" } as const;

/**
 * One order in the queue, readable in a glance: who, what, how much, and where
 * it stands. The coloured rail repeats the status pill's tone — the pill's icon
 * and words carry the meaning, the rail just speeds up scanning.
 */
export const OrderCard = memo(function OrderCard({ order, onPress }: { order: OrderSummary; onPress: () => void }) {
  const t = useTheme();
  const status = STATUS_META[order.status];
  const rail = t.tone(status.tone).fg;
  const payIcon = PAYMENT_ICON[order.payment.tone as keyof typeof PAYMENT_ICON] ?? "wallet-outline";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${order.orderNumber}, ${order.customerName}, ${order.totalLabel}, ${status.label}, ${order.payment.label}`}
      accessibilityHint="Opens the order"
      onPress={onPress}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border },
      ]}
    >
      <View style={[styles.rail, { backgroundColor: rail }]} />
      <View style={styles.body}>
        <View style={styles.topRow}>
          <AppText variant="bodyStrong" style={styles.number}>
            {order.orderNumber}
          </AppText>
          <AppText variant="caption" color="faint">
            {formatWhen(order.placedAt)}
          </AppText>
        </View>

        <View style={styles.midRow}>
          <View style={{ flex: 1 }}>
            <AppText variant="body" numberOfLines={1}>
              {order.customerName}
            </AppText>
            <AppText variant="caption" color="muted" numberOfLines={1}>
              {order.itemsPreview || `${order.itemCount} items`}
            </AppText>
          </View>
          <AppText variant="heading" style={styles.total}>
            {order.totalLabel}
          </AppText>
        </View>

        <View style={styles.pills}>
          <Pill tone={status.tone} icon={status.icon} label={status.label} size="sm" />
          <Pill tone={order.payment.tone} icon={payIcon} label={order.payment.label} size="sm" />
          {order.hasCustomerNote ? (
            <View style={styles.flag} accessible accessibilityLabel="Customer left a note">
              <Ionicons name="chatbubble-ellipses-outline" size={15} color={t.colors.textMuted} />
            </View>
          ) : null}
          {order.orderType === "reseller" ? <Pill tone="neutral" icon="briefcase-outline" label="Reseller" size="sm" /> : null}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  card: { flexDirection: "row", borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  rail: { width: 4 },
  body: { flex: 1, padding: SPACE.lg, gap: SPACE.sm },
  topRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  number: { fontVariant: ["tabular-nums"] },
  midRow: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  total: { fontVariant: ["tabular-nums"] },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: 6, alignItems: "center" },
  flag: { paddingHorizontal: 4 },
});
