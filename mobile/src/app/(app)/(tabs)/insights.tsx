import { useState } from "react";
import { RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { InsightsRange, InsightsResponse } from "@contract";
import { insightsApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { revenuePoints } from "@/features/insights/SalesHero";
import { STATUS_META } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AreaChart } from "@/ui/charts/AreaChart";
import { BarList, SplitBar } from "@/ui/charts/Bars";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Chips, Delta, Panel, SectionHeader, StatTile } from "@/ui/kit";
import { AppText, Pill } from "@/ui/primitives";

const RANGES: ReadonlyArray<{ key: InsightsRange; label: string }> = [
  { key: "today", label: "Today" },
  { key: "7d", label: "7 days" },
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
];

const pct = (n: number) => `${Math.round(n * 100)}%`;
const PEAK_UNIT: Record<InsightsRange, string> = { today: "hour", "7d": "day", "30d": "day", "90d": "week" };

function RevenuePanel({ data }: { data: InsightsResponse }) {
  const [scrub, setScrub] = useState<number | null>(null);
  const point = scrub !== null ? data.series[scrub] : null;
  return (
    <Panel style={{ gap: SPACE.md }}>
      <View style={{ gap: 4 }}>
        <AppText variant="overline" color="link">
          {(point ? point.longLabel : `Revenue · ${data.rangeLabel}`).toUpperCase()}
        </AppText>
        <AppText variant="number" numberOfLines={1} style={styles.tabular} accessibilityRole="header">
          {point ? point.revenueLabel : data.kpis.revenue.label}
        </AppText>
        {point ? (
          <AppText variant="caption" color="muted">{`${point.orders} ${point.orders === 1 ? "order" : "orders"}`}</AppText>
        ) : (
          <View style={styles.inline}>
            <Delta value={data.kpis.revenue.delta} />
            <AppText variant="caption" color="muted">
              {data.compareLabel}
            </AppText>
          </View>
        )}
      </View>
      <AreaChart
        points={revenuePoints(data)}
        height={170}
        onScrub={setScrub}
        accessibilityLabel={`Revenue chart, ${data.rangeLabel}. Total ${data.kpis.revenue.label}. Press and drag to read each point.`}
      />
      {data.peak ? (
        <AppText variant="caption" color="muted">
          {`Best ${PEAK_UNIT[data.range]}: ${data.peak.label} · ${data.peak.revenueLabel}`}
        </AppText>
      ) : null}
    </Panel>
  );
}

function Report({ data }: { data: InsightsResponse }) {
  const k = data.kpis;
  const mix = data.customerMix;
  return (
    <>
      <RevenuePanel data={data} />

      <View style={styles.grid}>
        <StatTile icon="receipt-outline" label="Orders" value={k.orders.label} delta={k.orders.delta} onPress={() => router.navigate("/orders")} />
        <StatTile icon="pricetag-outline" label="Avg. order value" value={k.aov.label} delta={k.aov.delta} />
        <StatTile icon="people-outline" label="Customers" value={k.customers.label} delta={k.customers.delta} onPress={() => router.push("/customers")} />
        <StatTile icon="cube-outline" label="Items sold" value={k.itemsSold.label} delta={k.itemsSold.delta} />
      </View>

      <View>
        <SectionHeader eyebrow="Money" title="Collected vs waiting" />
        <Panel>
          <SplitBar
            a={{ label: "Paid / proof in", value: data.collection.collectedShare, valueLabel: data.collection.collectedLabel }}
            b={{ label: "Awaiting payment", value: 1 - data.collection.collectedShare, valueLabel: data.collection.pendingLabel }}
          />
          <AppText variant="caption" color="muted" style={{ marginTop: SPACE.sm }}>
            {`${pct(data.collection.collectedShare)} of this period's sales are paid or have proof submitted.`}
          </AppText>
        </Panel>
      </View>

      <View>
        <SectionHeader eyebrow="Products" title="Top sellers" action={{ label: "Products", onPress: () => router.navigate("/products") }} />
        <Panel>
          <BarList rows={data.topProducts} empty="No sales in this period yet." />
        </Panel>
      </View>

      <View>
        <SectionHeader eyebrow="Customers" title="Who's buying" action={{ label: "All customers", onPress: () => router.push("/customers") }} />
        <Panel style={{ gap: SPACE.lg }}>
          <SplitBar
            a={{ label: "Returning", value: mix.returning, valueLabel: String(mix.returning) }}
            b={{ label: "New", value: mix.new, valueLabel: String(mix.new) }}
          />
          <BarList
            rows={data.topCustomers}
            empty="No customers in this period yet."
            onPressRow={(r) => {
              if (r.key) router.push({ pathname: "/customer/[key]", params: { key: r.key } });
            }}
          />
        </Panel>
      </View>

      <View>
        <SectionHeader eyebrow="Checkout" title="How they pay" />
        <Panel>
          <BarList rows={data.payments} empty="No payments in this period yet." />
        </Panel>
      </View>

      <View>
        <SectionHeader eyebrow="Shipping" title="Where orders go" />
        <Panel>
          <BarList rows={data.places} empty="No deliveries in this period yet." />
        </Panel>
      </View>

      {data.statusMix.length > 0 ? (
        <View>
          <SectionHeader eyebrow="Pipeline" title="Order status" />
          <View style={styles.pills}>
            {data.statusMix.map((s) => {
              const meta = STATUS_META[s.status];
              return <Pill key={s.status} tone={meta.tone} icon={meta.icon} label={`${meta.label} · ${s.count}`} />;
            })}
          </View>
        </View>
      ) : null}
    </>
  );
}

export default function Insights() {
  const t = useTheme();
  const { me, scope } = useSignedIn();
  const [range, setRange] = useState<InsightsRange>("7d");
  const q = useQuery({
    queryKey: qk.insights(scope, range),
    queryFn: () => insightsApi.get(range),
    enabled: me.can.analytics,
    placeholderData: (prev) => prev,
  });

  if (!me.can.analytics) {
    return (
      <EmptyState
        icon="stats-chart-outline"
        title="Insights aren't on for this account"
        body="Sales insights come with the store's plan and the owner's permission."
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
      >
        <View style={{ gap: SPACE.md }}>
          <AppText variant="title" accessibilityRole="header">
            Sales{" "}
            <AppText variant="title" italic color="link">
              insights
            </AppText>
          </AppText>
          <Chips options={RANGES} value={range} onChange={setRange} label="Report period" />
        </View>

        {q.isPending ? (
          <SkeletonList rows={4} />
        ) : q.isError || !q.data ? (
          <ErrorState message={q.error?.message ?? "Couldn't load insights."} onRetry={() => void q.refetch()} />
        ) : (
          <View style={[styles.stack, q.isPlaceholderData ? { opacity: 0.6 } : null]}>
            <Report data={q.data} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.xl, paddingBottom: SPACE.xxxl },
  stack: { gap: SPACE.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  inline: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  pills: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  tabular: { fontVariant: ["tabular-nums"] },
});
