import { memo } from "react";
import { FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopOrder } from "@shop-contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { AppText, Pill, type IconName } from "@/ui/primitives";
import { useMyOrders } from "../hooks";
import { itemsLabel, orderDate, orderItemCount, orderLabel, SHOP_STATUS } from "../lib/orders";
import { money } from "../lib/money";

/** The customer's order history, newest first. */
export function MyOrders() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const q = useMyOrders();
  const open = (n: string) => router.push({ pathname: "/my-order/[number]", params: { number: n } });

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <View style={[styles.bar, { paddingTop: insets.top + SPACE.sm, backgroundColor: t.brand.headerBackground }]}>
        <AppText variant="title" brandFont color={t.brand.headerText} accessibilityRole="header">
          My orders
        </AppText>
      </View>
      <OfflineBanner />
      {q.isPending ? (
        <SkeletonList rows={4} />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={q.data.orders}
          keyExtractor={(o) => o.orderNumber}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
          renderItem={({ item }) => <OrderRow order={item} currency={me.store.currency} onPress={open} />}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="No orders yet"
              body="When you place an order in the app, you can follow it here."
              action={{ label: "Start shopping", onPress: () => router.navigate("/shop") }}
            />
          }
        />
      )}
    </View>
  );
}

const OrderRow = memo(function OrderRow({ order, currency, onPress }: { order: ShopOrder; currency: string; onPress: (n: string) => void }) {
  const t = useTheme();
  const s = SHOP_STATUS[order.status];
  const count = orderItemCount(order);
  const first = order.items[0]?.name ?? "";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${orderLabel(order.orderNumber)}, ${s.label}, ${orderDate(order.placedAt)}, ${itemsLabel(count)}, ${money(order.total, currency)}`}
      onPress={() => onPress(order.orderNumber)}
      style={({ pressed }) => [styles.card, { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border }]}
    >
      <View style={styles.top}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{orderLabel(order.orderNumber)}</AppText>
          <AppText variant="caption" color="muted">{orderDate(order.placedAt)}</AppText>
        </View>
        <Pill tone={s.tone} icon={s.icon as IconName} label={s.label} size="sm" />
      </View>
      <AppText variant="body" color="muted" numberOfLines={1}>
        {count > 1 && first ? `${first} + ${count - 1} more` : first}
      </AppText>
      <View style={styles.top}>
        <AppText variant="caption" color="faint" style={{ flex: 1 }}>{itemsLabel(count)}</AppText>
        <AppText variant="bodyStrong">{money(order.total, currency)}</AppText>
        <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  bar: { paddingHorizontal: SPACE.lg, paddingBottom: SPACE.md },
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  card: { padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, gap: SPACE.sm },
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
});
