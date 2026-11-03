import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { CustomerRow } from "@contract";
import { customersApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { formatWhen } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { Panel, SectionHeader } from "@/ui/kit";
import { AppText } from "@/ui/primitives";
import { Avatar } from "./CustomerRowItem";

const TOP = 3;

type RowProps = {
  c: CustomerRow;
  rank: number;
  isLast: boolean;
};

function TopRow({ c, rank, isLast }: RowProps) {
  const t = useTheme();
  const orders = `${c.orders} ${c.orders === 1 ? "order" : "orders"}`;
  const figure = c.spentLabel;
  const sub = `${orders} · last ${formatWhen(c.lastAt).toLowerCase()}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Number ${rank}, ${c.name}, ${figure}`}
      accessibilityHint="Opens their order history"
      onPress={() => router.push({ pathname: "/customer/[key]", params: { key: c.key } })}
      style={({ pressed }) => [
        styles.row,
        !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.colors.border },
        pressed && { backgroundColor: t.colors.surfaceAlt },
      ]}
    >
      <AppText variant="label" color={rank === 1 ? t.brand.link : t.colors.textFaint} style={styles.rank}>
        {String(rank)}
      </AppText>
      <Avatar name={c.name} size={36} />
      <View style={{ flex: 1, gap: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={1}>
          {c.name}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {sub}
        </AppText>
      </View>
      <AppText variant="bodyStrong" style={styles.tabular}>
        {figure}
      </AppText>
      <Ionicons name="chevron-forward" size={16} color={t.colors.textFaint} />
    </Pressable>
  );
}

/**
 * Home's "Top customers": the store's best buyers, from the same list the
 * Customers screen shows, ranked by total spent — the website dashboard's
 * Top spenders panel. Needs the Orders grant (the list's own gate). Renders
 * nothing until there is someone to show (no spinner on the home screen).
 */
export function TopCustomers() {
  const { me, scope } = useSignedIn();
  // Per-customer spend is order money (the Orders grant), not an Analytics figure.
  const sort = "spent";
  const list = useQuery({
    queryKey: qk.customers(scope, "", sort, "all"),
    queryFn: () => customersApi.list("", sort, "all"),
    enabled: me.can.orders,
  });
  const rows = list.data?.customers.slice(0, TOP) ?? [];
  if (!me.can.orders || rows.length === 0) return null;

  return (
    <View>
      <SectionHeader
        eyebrow="Loyalty"
        title="Top spenders"
        action={{ label: "All customers", onPress: () => router.push("/customers") }}
      />
      <Panel style={styles.panel}>
        {rows.map((c, i) => (
          <TopRow key={c.key} c={c} rank={i + 1} isLast={i === rows.length - 1} />
        ))}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: { paddingVertical: SPACE.xs, paddingHorizontal: 0 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingVertical: SPACE.md, paddingHorizontal: SPACE.md },
  rank: { width: 16, textAlign: "center", fontVariant: ["tabular-nums"] },
  tabular: { fontVariant: ["tabular-nums"] },
});
