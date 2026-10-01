import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { SkeletonList } from "@/ui/feedback";
import { AppText, Button, Card, Pill } from "@/ui/primitives";
import { useMyOrders } from "../hooks";
import { itemsLabel, orderItemCount, orderLabel, SHOP_STATUS } from "../lib/orders";
import { money } from "../lib/money";
import type { IconName } from "@/ui/primitives";

/** "Thank you" after placing an order: number, total, status, next steps. */
export function OrderPlaced({ number }: { number: string }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useSignedIn();
  const q = useMyOrders();
  const order = q.data?.orders.find((o) => o.orderNumber === number);
  const status = order ? SHOP_STATUS[order.status] : null;

  const toOrders = () => {
    router.dismissAll();
    router.navigate("/my-orders");
  };
  const toShop = () => {
    router.dismissAll();
    router.navigate("/shop");
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView contentContainerStyle={[styles.page, { paddingTop: insets.top + SPACE.xxl }]}>
        <View style={[styles.check, { backgroundColor: t.tone("success").bg }]}>
          <Ionicons name="checkmark" size={40} color={t.tone("success").fg} />
        </View>
        <View style={{ gap: SPACE.sm, alignItems: "center" }}>
          <AppText variant="title" brandFont style={styles.center} accessibilityRole="header">
            Thank you for your order!
          </AppText>
          <AppText variant="body" color="muted" style={styles.center}>
            {`${me.store.name} has your order. You'll see every update in My orders.`}
          </AppText>
        </View>
        <Card style={{ alignSelf: "stretch", gap: SPACE.md }}>
          <Detail label="Order number" value={orderLabel(number)} selectable />
          {order && status ? (
            <>
              <View style={styles.row}>
                <AppText variant="body" color="muted">Status</AppText>
                <Pill tone={status.tone} icon={status.icon as IconName} label={status.label} size="sm" />
              </View>
              <Detail label="Items" value={itemsLabel(orderItemCount(order))} />
              <Detail label="Total" value={money(order.total, me.store.currency)} strong />
              <AppText variant="caption" color="muted">{status.help}</AppText>
            </>
          ) : q.isPending ? (
            <SkeletonList rows={1} />
          ) : null}
        </Card>
      </ScrollView>
      <View style={[styles.bar, { paddingBottom: insets.bottom + SPACE.md }]}>
        <Button label="View my orders" icon="receipt-outline" onPress={toOrders} />
        <Button label="Keep shopping" variant="ghost" onPress={toShop} />
      </View>
    </View>
  );
}

function Detail({ label, value, strong, selectable }: { label: string; value: string; strong?: boolean; selectable?: boolean }) {
  return (
    <View style={styles.row}>
      <AppText variant="body" color="muted">{label}</AppText>
      <AppText variant={strong ? "stat" : "bodyStrong"} selectable={selectable}>{value}</AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, gap: SPACE.xl, alignItems: "center" },
  check: { width: 80, height: 80, borderRadius: 40, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.md },
  bar: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, gap: SPACE.xs, borderRadius: RADIUS.lg },
});
