import { useMemo, useState } from "react";
import { Alert, FlatList, Linking, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { OrderStatus } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";
import { formatMoney } from "@/features/admin/catalog/currency";
import { brandSymbol } from "@/features/admin/catalog/model";
import { setupKeys, success, useAdminBrand } from "@/features/admin/setup/data";
import { Avatar } from "@/features/customers/CustomerRowItem";
import { STATUS_META, formatWhen } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Chips, SectionHeader, StatTile } from "@/ui/kit";
import { AppText, Button, Pill } from "@/ui/primitives";

/** StoreCustomerProfile from src/actions/customer-accounts.ts — the fields this screen reads. */
type ProfileOrder = {
  id: string;
  orderNumber?: string;
  status: OrderStatus;
  paymentStatus: "pending" | "paid";
  date: string;
  total: number;
  groupBuyName?: string | null;
  items?: Array<{ name: string; qty?: number }>;
};
type Profile = {
  account: { id: string; status: "active" | "disabled"; joinedAt: string; lastLoginAt: string | null; emailOnly: boolean } | null;
  name: string;
  email: string;
  phone: string;
  orders: ProfileOrder[];
  stats: { orders: number; cancelled: number; spent: number; avg: number; firstAt: string | null; lastAt: string | null };
  unlinkedCount: number;
  truncated: boolean;
};

type Filter = "all" | "open" | "done" | "cancelled";
const OPEN: ReadonlySet<OrderStatus> = new Set(["new", "confirmed", "processing", "ready"]);
const DONE: ReadonlySet<OrderStatus> = new Set(["shipped", "delivered"]);
const MATCH: Record<Filter, (o: ProfileOrder) => boolean> = {
  all: () => true,
  open: (o) => OPEN.has(o.status),
  done: (o) => DONE.has(o.status),
  cancelled: (o) => o.status === "cancelled",
};
const FILTER_LABELS: Record<Filter, string> = { all: "All", open: "Open", done: "Shipped", cancelled: "Cancelled" };
const ITEMS_PREVIEW_MAX = 3;
const ID_RE = /^[a-z0-9]{10,40}$/i;

function itemsPreview(o: ProfileOrder): string {
  const items = o.items ?? [];
  const head = items.slice(0, ITEMS_PREVIEW_MAX).map((i) => `${i.name} ×${i.qty || 1}`);
  const more = items.length - ITEMS_PREVIEW_MAX;
  return more > 0 ? `${head.join(", ")} +${more} more` : head.join(", ") || "No items";
}

function OrderRow({ o, money }: { o: ProfileOrder; money: (n: number) => string }) {
  const t = useTheme();
  const meta = STATUS_META[o.status];
  const code = o.orderNumber || `#${o.id.slice(0, 8)}`;
  const unpaid = o.paymentStatus !== "paid" && o.status !== "cancelled";
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Order ${code}, ${meta.label}${unpaid ? ", unpaid" : ""}, ${money(o.total)}`}
      accessibilityHint="Opens the order"
      onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })}
      style={({ pressed }) => [
        styles.order,
        { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: t.colors.border },
      ]}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <View style={styles.orderTop}>
          <AppText variant="bodyStrong">{code}</AppText>
          <Pill tone={meta.tone} icon={meta.icon} label={meta.label} size="sm" />
          {unpaid ? <Pill tone="warning" label="Unpaid" size="sm" /> : null}
        </View>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {itemsPreview(o)}
        </AppText>
        <AppText variant="caption" color="faint" numberOfLines={1}>
          {`${formatWhen(o.date)}${o.groupBuyName ? ` · ${o.groupBuyName}` : ""}`}
        </AppText>
      </View>
      <AppText variant="heading" style={styles.tabular}>
        {money(o.total)}
      </AppText>
      <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
    </Pressable>
  );
}

function LinkCard({ count, busy, disabled, onLink }: { count: number; busy: boolean; disabled: boolean; onLink: () => void }) {
  const t = useTheme();
  const noun = count === 1 ? "order" : "orders";
  return (
    <View style={[styles.link, { borderColor: t.tone("info").fg, backgroundColor: t.tone("info").bg }]}>
      <View style={styles.linkHead}>
        <Ionicons name="link-outline" size={20} color={t.tone("info").fg} />
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          {`${count} earlier ${noun} use this email`}
        </AppText>
      </View>
      <AppText variant="caption" color="muted">
        Placed as a guest, before they signed up or while signed out. Link them to see the full history here. They'll also
        show in the customer's own account.
      </AppText>
      <Button label={`Link ${count} ${noun}`} icon="link-outline" loading={busy} disabled={disabled} onPress={onLink} />
    </View>
  );
}

/**
 * One customer account's order history — opened from Customer accounts and
 * Community → Members. Runs the website's getStoreCustomerProfileAction (Orders
 * permission); "Link N orders" attaches earlier guest orders under the same
 * email, after the owner confirms it's really theirs.
 */
export default function CustomerAccountOrders() {
  const t = useTheme();
  const online = useOnline();
  const qc = useQueryClient();
  const { scope } = useSignedIn();
  const { id } = useLocalSearchParams<{ id: string }>();
  const valid = typeof id === "string" && ID_RE.test(id);
  const brand = useAdminBrand();
  const symbol = brand.data ? brandSymbol(brand.data) : "₱";
  const money = (n: number) => formatMoney(n, symbol);
  const [filter, setFilter] = useState<Filter>("all");
  const [linking, setLinking] = useState(false);

  const key = [...setupKeys.all(scope), "customer-profile", id ?? ""];
  const q = useQuery({
    queryKey: key,
    queryFn: async () =>
      (await callAction<{ ok: true; profile: Profile }>("getStoreCustomerProfileAction", { kind: "account", id })).profile,
    enabled: valid,
  });

  const filters = useMemo(() => {
    const orders = q.data?.orders ?? [];
    return (Object.keys(MATCH) as Filter[])
      .filter((k) => k === "all" || orders.some(MATCH[k]))
      .map((k) => ({ key: k, label: `${FILTER_LABELS[k]} · ${orders.filter(MATCH[k]).length}` }));
  }, [q.data]);

  if (!valid) return <ErrorState message="This customer link isn't valid." />;
  if (q.isPending) return <SkeletonList rows={4} />;
  if (q.isError || !q.data) {
    return <ErrorState message={q.error?.message ?? "Couldn't load this customer."} onRetry={() => void q.refetch()} />;
  }

  const p = q.data;
  const dial = p.phone.replace(/[^\d+]/g, "");
  const visible = p.orders.filter(MATCH[filter]);

  async function link() {
    setLinking(true);
    try {
      const { linked } = await callAction<{ ok: true; linked: number }>("linkStoreCustomerOrdersAction", p.account?.id);
      success();
      Alert.alert(linked === 1 ? "1 order linked" : `${linked} orders linked`);
      await qc.invalidateQueries({ queryKey: [...setupKeys.all(scope), "customer-accounts"] });
      await q.refetch();
    } catch (e) {
      Alert.alert("Couldn't link the orders", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setLinking(false);
    }
  }

  const confirmLink = () =>
    Alert.alert(
      `Link ${p.unlinkedCount} earlier order${p.unlinkedCount === 1 ? "" : "s"}?`,
      `Orders placed with ${p.email} move to ${p.name}'s account. Only do this if you're sure this email is theirs.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Link", onPress: () => void link() },
      ],
    );

  const status = p.account
    ? p.account.emailOnly
      ? { tone: "info" as const, label: "Group-buy email" }
      : p.account.status === "active"
        ? { tone: "success" as const, label: "Active account" }
        : { tone: "danger" as const, label: "Disabled" }
    : { tone: "neutral" as const, label: "Guest buyer" };

  const header = (
    <View style={{ gap: SPACE.xl, paddingBottom: SPACE.md }}>
      <View style={styles.hero}>
        <Avatar name={p.name} size={64} />
        <View style={{ flex: 1, gap: 4 }}>
          <AppText variant="title" numberOfLines={2} accessibilityRole="header">
            {p.name}
          </AppText>
          <View style={styles.pills}>
            <Pill tone={status.tone} label={status.label} size="sm" />
          </View>
          {p.account ? (
            <AppText variant="caption" color="faint">
              {`Joined ${formatWhen(p.account.joinedAt)}`}
            </AppText>
          ) : null}
        </View>
      </View>

      {p.email || dial ? (
        <View style={styles.contacts}>
          {dial ? (
            <Button label="Call" icon="call-outline" variant="secondary" onPress={() => void Linking.openURL(`tel:${dial}`).catch(() => undefined)} style={{ flex: 1 }} />
          ) : null}
          {p.email ? (
            <Button label="Email" icon="mail-outline" variant="secondary" onPress={() => void Linking.openURL(`mailto:${p.email}`).catch(() => undefined)} style={{ flex: 1 }} />
          ) : null}
        </View>
      ) : null}

      <View style={styles.grid}>
        <StatTile icon="wallet-outline" label="Total spent" value={money(p.stats.spent)} />
        <StatTile icon="receipt-outline" label="Orders" value={String(p.stats.orders)} />
        <StatTile icon="pricetag-outline" label="Avg. order" value={p.stats.orders > 0 ? money(p.stats.avg) : "—"} />
        <StatTile icon="calendar-outline" label="Last order" value={p.stats.lastAt ? formatWhen(p.stats.lastAt) : "—"} />
      </View>

      {p.account && p.unlinkedCount > 0 ? (
        <LinkCard count={p.unlinkedCount} busy={linking} disabled={!online || linking} onLink={confirmLink} />
      ) : null}

      <View style={{ gap: SPACE.md }}>
        <SectionHeader eyebrow="History" title="Order history" />
        {p.orders.length > 1 ? <Chips options={filters} value={filter} onChange={setFilter} label="Filter orders" /> : null}
      </View>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: p.name }} />
      <OfflineBanner />
      <FlatList
        data={visible}
        keyExtractor={(o) => o.id}
        ListHeaderComponent={header}
        contentContainerStyle={styles.page}
        ItemSeparatorComponent={() => <View style={{ height: SPACE.sm }} />}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
        renderItem={({ item }) => <OrderRow o={item} money={money} />}
        ListEmptyComponent={
          <EmptyState
            icon="receipt-outline"
            title="No orders on this account yet"
            body={p.unlinkedCount > 0 ? "Link their earlier guest orders above to bring them in." : "Orders they place while signed in show up here."}
          />
        }
        ListFooterComponent={
          p.truncated ? (
            <AppText variant="caption" color="faint" style={{ marginTop: SPACE.md, textAlign: "center" }}>
              {`Showing the latest ${p.orders.length} orders.`}
            </AppText>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  hero: { flexDirection: "row", alignItems: "center", gap: SPACE.lg },
  pills: { flexDirection: "row", gap: 6 },
  contacts: { flexDirection: "row", gap: SPACE.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  link: { gap: SPACE.sm, padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1, borderStyle: "dashed" },
  linkHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  order: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    padding: SPACE.md,
    borderRadius: RADIUS.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  orderTop: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 6 },
  tabular: { fontVariant: ["tabular-nums"] },
});
