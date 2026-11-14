import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { InsightsGranularity, InsightsQuery, InsightsRange, InsightsResponse } from "@contract";
import { insightsApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { revenuePoints } from "@/features/insights/SalesHero";
import { breakdownTitle, PeriodBreakdown } from "@/features/insights/PeriodBreakdown";
import { PeriodSheet, PRESET_LABELS } from "@/features/insights/PeriodSheet";
import { LiveStrip } from "@/features/live/LiveStrip";
import { STATUS_META } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Segmented } from "@/ui/inputs";
import { AreaChart } from "@/ui/charts/AreaChart";
import { BarList, SplitBar } from "@/ui/charts/Bars";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Chips, Delta, Panel, SectionHeader, StatTile } from "@/ui/kit";
import { AppText, Pill } from "@/ui/primitives";

type QuickKey = InsightsRange | "more";
const QUICK: ReadonlyArray<InsightsRange> = ["today", "7d", "30d", "this_month", "90d"];
const QUICK_LABEL: Partial<Record<InsightsRange, string>> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  this_month: "This month",
  "90d": "90 days",
};
const VIEW_LABEL: Record<InsightsGranularity, string> = { hour: "Hour", day: "Day", week: "Week", month: "Month" };

const pct = (n: number) => `${Math.round(n * 100)}%`;

function RevenuePanel({ data, onGranularity }: { data: InsightsResponse; onGranularity: (g: InsightsGranularity) => void }) {
  const t = useTheme();
  const [scrub, setScrub] = useState<number | null>(null);
  const point = scrub !== null ? data.series[scrub] : null;
  const period = data.period;
  const unit = period ? VIEW_LABEL[period.granularity].toLowerCase() : "day";
  const comparing = Boolean(period?.compareRangeLabel);
  return (
    <Panel style={{ gap: SPACE.md }}>
      {period && period.granularities.length > 1 ? (
        <Segmented
          segments={period.granularities.map((g) => ({ key: g, label: VIEW_LABEL[g] }))}
          value={period.granularity}
          onChange={onGranularity}
        />
      ) : null}
      <View style={{ gap: 4 }}>
        <AppText variant="overline" color="link">
          {(point ? point.longLabel : `Revenue · ${data.rangeLabel}`).toUpperCase()}
        </AppText>
        <AppText variant="number" numberOfLines={1} style={styles.tabular} accessibilityRole="header">
          {point ? point.revenueLabel : data.kpis.revenue.label}
        </AppText>
        {point ? (
          <View style={styles.inline}>
            {point.compareChange !== undefined && comparing ? <Delta value={point.compareChange ?? null} /> : null}
            <AppText variant="caption" color="muted">
              {`${point.orders} ${point.orders === 1 ? "order" : "orders"}${point.prevRevenueLabel ? ` · was ${point.prevRevenueLabel}` : ""}`}
            </AppText>
          </View>
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
      {comparing ? (
        <View style={styles.inline}>
          <View style={[styles.swatch, { backgroundColor: t.colors.chart }]} />
          <AppText variant="caption" color="muted">This period</AppText>
          <View style={[styles.swatchDash, { borderColor: t.colors.textFaint }]} />
          <AppText variant="caption" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
            {period?.compareRangeLabel ?? "Compared"}
          </AppText>
        </View>
      ) : null}
      {data.peak ? (
        <AppText variant="caption" color="muted">
          {`Best ${unit}: ${data.peak.label} · ${data.peak.revenueLabel}`}
        </AppText>
      ) : null}
    </Panel>
  );
}

function Report({ data, onGranularity }: { data: InsightsResponse; onGranularity: (g: InsightsGranularity) => void }) {
  const k = data.kpis;
  const mix = data.customerMix;
  const period = data.period;
  return (
    <>
      <RevenuePanel data={data} onGranularity={onGranularity} />

      <View style={styles.grid}>
        <StatTile icon="receipt-outline" label="Orders" value={k.orders.label} delta={k.orders.delta} onPress={() => router.navigate("/orders")} />
        <StatTile icon="pricetag-outline" label="Avg. order value" value={k.aov.label} delta={k.aov.delta} />
        <StatTile icon="people-outline" label="Customers" value={k.customers.label} delta={k.customers.delta} onPress={() => router.push("/customers")} />
        <StatTile icon="cube-outline" label="Items sold" value={k.itemsSold.label} delta={k.itemsSold.delta} />
      </View>

      {period && data.series.length > 1 ? (
        <View>
          <SectionHeader eyebrow="Compare" title={breakdownTitle(period.granularity)} />
          <Panel>
            <PeriodBreakdown series={data.series} granularity={period.granularity} comparing={Boolean(period.compareRangeLabel)} />
          </Panel>
        </View>
      ) : null}

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
  const [query, setQuery] = useState<InsightsQuery>({ range: "7d", compare: "previous" });
  const [sheet, setSheet] = useState(false);
  const q = useQuery({
    queryKey: qk.insights(scope, query),
    queryFn: () => insightsApi.get(query),
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
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Report period: ${PRESET_LABELS[query.range]}${q.data?.period ? `, ${q.data.period.label}` : ""}. Change`}
            onPress={() => setSheet(true)}
            style={({ pressed }) => [
              styles.dateBtn,
              { borderColor: t.colors.border, backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface },
            ]}
          >
            <Ionicons name="calendar-outline" size={18} color={t.colors.text} />
            <View style={{ flex: 1 }}>
              <AppText variant="caption" color="muted">{PRESET_LABELS[query.range]}</AppText>
              <AppText variant="bodyStrong" numberOfLines={1} style={styles.tabular}>
                {q.data?.period?.label ?? "…"}
              </AppText>
            </View>
            <AppText variant="caption" color="link">
              {(query.compare ?? "previous") === "none" ? "No compare" : query.compare === "year" ? "vs last year" : "vs previous"}
            </AppText>
            <Ionicons name="chevron-down" size={16} color={t.colors.textMuted} />
          </Pressable>
          <Chips<QuickKey>
            options={[
              ...QUICK.map((key) => ({ key, label: QUICK_LABEL[key] ?? PRESET_LABELS[key] })),
              { key: "more", label: QUICK.includes(query.range) ? "More…" : PRESET_LABELS[query.range] },
            ]}
            value={QUICK.includes(query.range) ? query.range : "more"}
            onChange={(key) =>
              key === "more" ? setSheet(true) : setQuery((cur) => ({ range: key, compare: cur.compare }))
            }
            label="Report period"
          />
        </View>
        <PeriodSheet
          visible={sheet}
          value={query}
          onClose={() => setSheet(false)}
          onApply={(next) => {
            setSheet(false);
            setQuery(next);
          }}
        />

        <LiveStrip />

        {q.isPending ? (
          <SkeletonList rows={4} />
        ) : q.isError || !q.data ? (
          <ErrorState message={q.error?.message ?? "Couldn't load insights."} onRetry={() => void q.refetch()} />
        ) : (
          <View style={[styles.stack, q.isPlaceholderData ? { opacity: 0.6 } : null]}>
            <Report data={q.data} onGranularity={(granularity) => setQuery((cur) => ({ ...cur, granularity }))} />
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
  dateBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    minHeight: 52,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
  },
  swatch: { width: 12, height: 3, borderRadius: 2 },
  swatchDash: { width: 12, borderTopWidth: 2, borderStyle: "dashed", marginLeft: SPACE.sm },
});
