import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OrderStatus } from "@contract";
import { useOrder } from "@/features/orders/hooks";
import { STATUS_META, STATUS_ORDER } from "@/features/orders/status";
import { useStatusChange } from "@/features/orders/useStatusChange";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * Every status the website supports (it allows any move), with the current one
 * marked and any stock effect spelled out BEFORE the tap.
 */
export default function StatusSheet() {
  const t = useTheme();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: order } = useOrder(id ?? "");
  const { request, isPending, mutation } = useStatusChange(order);

  if (!order) return <ActivityIndicator style={{ margin: SPACE.xxl }} color={t.brand.link} />;

  async function choose(to: OrderStatus) {
    if (!order || to === order.status) return;
    if (to === "shipped") {
      router.replace({ pathname: "/order/[id]/tracking", params: { id: order.id, ship: "1" } });
      return;
    }
    if (await request(to)) router.back();
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <AppText variant="title" accessibilityRole="header">Change status</AppText>
      <AppText variant="body" color="muted">{`Order ${order.orderNumber}`}</AppText>
      <View style={{ gap: SPACE.sm, marginTop: SPACE.md }}>
        {STATUS_ORDER.map((s) => {
          const meta = STATUS_META[s];
          const c = t.tone(meta.tone);
          const current = s === order.status;
          const pending = isPending && mutation.variables?.status === s;
          const effect = order.stockEffects[s];
          const effectLine = effect === "deduct" ? "Takes items out of stock" : effect === "restock" ? "Puts items back in stock" : meta.help;
          return (
            <Pressable
              key={s}
              accessibilityRole="button"
              accessibilityState={{ selected: current, disabled: current || isPending }}
              accessibilityLabel={`${meta.label}${current ? ", current status" : ""}. ${effectLine}`}
              disabled={current || isPending}
              onPress={() => void choose(s)}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: current ? t.brand.link : t.colors.border,
                  backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
                },
              ]}
            >
              <View style={[styles.icon, { backgroundColor: c.bg }]}>
                <Ionicons name={meta.icon} size={18} color={c.fg} />
              </View>
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{meta.label}</AppText>
                <AppText variant="caption" color={effect ? t.tone("warning").fg : "muted"}>{effectLine}</AppText>
              </View>
              {pending ? (
                <ActivityIndicator color={t.brand.link} />
              ) : current ? (
                <AppText variant="caption" color="link" style={{ fontWeight: "700" }}>CURRENT</AppText>
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.xl, paddingBottom: SPACE.xxxl, gap: 2 },
  option: {
    minHeight: TOUCH + 12,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1.5,
  },
  icon: { width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center" },
});
