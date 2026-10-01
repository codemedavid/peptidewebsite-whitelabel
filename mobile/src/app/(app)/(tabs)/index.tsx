import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { DashboardResponse, InsightsRange } from "@contract";
import { dashboardApi, insightsApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { OrderCard } from "@/features/orders/OrderCard";
import { SalesHero } from "@/features/insights/SalesHero";
import { CommunitySwitchCard } from "@/features/community/CommunitySwitchCard";
import { useCommunityAccess } from "@/features/community/hooks/useInbox";
import { StoreSwitchCard } from "@/features/store/StoreSwitchCard";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { BarList } from "@/ui/charts/Bars";
import { ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Panel, QuickAction, SectionHeader } from "@/ui/kit";
import { AppText, Pill, type IconName } from "@/ui/primitives";

const LATEST = 3;
const TRENDING = 3;

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

const openOrders = (filter: "new" | "to-fulfil") =>
  router.navigate({ pathname: "/orders", params: { filter, at: String(Date.now()) } });

/** One "to do" count — hot (green) when something is waiting. */
function TodoTile({ label, count, icon, onPress }: { label: string; count: number; icon: IconName; onPress: () => void }) {
  const t = useTheme();
  const hot = count > 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} ${label}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.todo,
        {
          backgroundColor: hot ? t.tone("success").bg : t.colors.surface,
          borderColor: hot ? t.brand.link : t.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <View style={styles.todoTop}>
        <Ionicons name={icon} size={16} color={hot ? t.brand.link : t.colors.textFaint} />
        {hot ? <View style={[styles.dot, { backgroundColor: t.brand.link }]} /> : null}
      </View>
      <AppText variant="stat" color={hot ? t.tone("success").fg : t.colors.text} style={styles.tabular}>
        {String(count)}
      </AppText>
      <AppText variant="caption" color="muted" numberOfLines={1}>
        {label}
      </AppText>
    </Pressable>
  );
}

function TodoList({ data, canOrders, canCatalog }: { data: DashboardResponse; canOrders: boolean; canCatalog: boolean }) {
  const { newOrders, toFulfil } = data.queue;
  const allClear = newOrders === 0 && toFulfil === 0 && data.lowStockCount === 0;
  return (
    <View>
      <SectionHeader eyebrow="To do" />
      <View style={styles.row}>
        {canOrders ? <TodoTile label="New orders" count={newOrders} icon="flash-outline" onPress={() => openOrders("new")} /> : null}
        {canOrders ? <TodoTile label="To ship" count={toFulfil} icon="cube-outline" onPress={() => openOrders("to-fulfil")} /> : null}
        {canCatalog ? (
          <TodoTile label="Low stock" count={data.lowStockCount} icon="alert-circle-outline" onPress={() => router.navigate("/products")} />
        ) : null}
      </View>
      {allClear ? (
        <View style={{ marginTop: SPACE.md }}>
          <Pill tone="success" icon="checkmark-circle" label="All caught up — nothing waiting on you" />
        </View>
      ) : null}
    </View>
  );
}

export default function Home() {
  const t = useTheme();
  const { me, scope } = useSignedIn();
  const [range, setRange] = useState<InsightsRange>("today");
  const catalog = me.can.products || me.can.inventory;
  const community = useCommunityAccess();

  const dash = useQuery({ queryKey: qk.dashboard(scope), queryFn: dashboardApi.get });
  const sales = useQuery({
    queryKey: qk.insights(scope, range),
    queryFn: () => insightsApi.get(range),
    enabled: me.can.analytics,
    placeholderData: (prev) => prev,
  });
  const week = useQuery({
    queryKey: qk.insights(scope, "7d"),
    queryFn: () => insightsApi.get("7d"),
    enabled: me.can.analytics,
  });

  const refreshing = dash.isRefetching || sales.isRefetching;
  const refresh = () => {
    void dash.refetch();
    if (me.can.analytics) {
      void sales.refetch();
      void week.refetch();
    }
  };
  const data = dash.data;
  const firstName = me.actor.displayName.split(/\s+/)[0] || "there";

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.brand.link} />}
      >
        <View>
          <AppText variant="caption" color="muted">
            {greeting()}, {firstName}
          </AppText>
          <AppText variant="title" accessibilityRole="header">
            Your store,{" "}
            <AppText variant="title" italic color="link">
              today
            </AppText>
          </AppText>
        </View>

        {me.can.analytics ? (
          sales.isError && !sales.data ? (
            <ErrorState message={sales.error?.message ?? "Couldn't load sales."} onRetry={() => void sales.refetch()} />
          ) : (
            <SalesHero data={sales.data} range={range} onRange={setRange} loading={sales.isFetching && !sales.isRefetching} />
          )
        ) : null}

        {dash.isPending ? (
          <SkeletonList rows={3} />
        ) : dash.isError || !data ? (
          <ErrorState message={dash.error?.message ?? "Couldn't load your store."} onRetry={() => void dash.refetch()} />
        ) : (
          <>
            {me.can.orders || catalog ? <TodoList data={data} canOrders={me.can.orders} canCatalog={catalog} /> : null}

            <View style={styles.row}>
              {me.can.orders ? (
                <QuickAction icon="receipt-outline" label="Orders" badge={data.queue.newOrders} onPress={() => router.navigate("/orders")} />
              ) : null}
              {catalog ? <QuickAction icon="pricetags-outline" label="Products" onPress={() => router.navigate("/products")} /> : null}
              {me.can.orders ? <QuickAction icon="people-outline" label="Customers" onPress={() => router.push("/customers")} /> : null}
              {me.can.analytics ? (
                <QuickAction icon="stats-chart-outline" label="Insights" onPress={() => router.navigate("/insights")} />
              ) : (
                <QuickAction icon="storefront-outline" label="Your store" onPress={() => router.push("/storefront")} />
              )}
            </View>

            {me.can.storeStatus ? <StoreSwitchCard open={data.store.open} /> : null}

            {community.adminChatsTab ? <CommunitySwitchCard /> : null}

            {me.can.analytics && week.data && week.data.topProducts.length > 0 ? (
              <View>
                <SectionHeader
                  eyebrow="Trending"
                  title="Best sellers this week"
                  action={{ label: "Insights", onPress: () => router.navigate("/insights") }}
                />
                <Panel>
                  <BarList rows={week.data.topProducts.slice(0, TRENDING)} />
                </Panel>
              </View>
            ) : null}

            {data.recent.length > 0 ? (
              <View>
                <SectionHeader eyebrow="Latest" title="Recent orders" action={{ label: "All orders", onPress: () => router.navigate("/orders") }} />
                <View style={{ gap: SPACE.md }}>
                  {data.recent.slice(0, LATEST).map((o) => (
                    <OrderCard key={o.id} order={o} onPress={() => router.push({ pathname: "/order/[id]", params: { id: o.id } })} />
                  ))}
                </View>
              </View>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.xl, paddingBottom: SPACE.xxxl },
  row: { flexDirection: "row", gap: SPACE.md },
  todo: { flex: 1, borderRadius: RADIUS.lg, borderWidth: 1, padding: SPACE.md, gap: 2, minHeight: 96 },
  todoTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  dot: { width: 8, height: 8, borderRadius: 4 },
  tabular: { fontVariant: ["tabular-nums"] },
});
