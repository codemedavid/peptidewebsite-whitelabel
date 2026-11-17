import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Tone } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Chips, Panel, SectionHeader } from "@/ui/kit";
import { AppText, Button } from "@/ui/primitives";
import {
  LAPSED_DAYS,
  buildAttention,
  buildCustomerKpis,
  buildLeaders,
  buildRevenueTrend,
  buildSegments,
  topSpenderShare,
  type AccountInput,
  type AccountStats,
  type CustomerFilter,
  type CustomerKpi,
  type CustomerPeriod,
  type CustomerSegmentKey,
  type LeaderMetric,
  type LedgerEntry,
} from "./analytics";

/**
 * The analytics half of Customer accounts — the website's CustomersInsights:
 * KPI row per period, revenue from customer accounts, segments (tap to
 * filter), Top spenders (by spend / by orders), concentration and
 * needs-attention. Every number comes from ./analytics (the website's
 * customer-analytics, copied); this file only decides layout. Rendered only
 * with the Orders grant (the ledger is null without it).
 */

export type AccountsInsightsProps = {
  accounts: AccountInput[];
  ledger: LedgerEntry[];
  stats: Map<string, AccountStats>;
  period: CustomerPeriod;
  now: Date;
  money: (n: number) => string;
  moneyShort: (n: number) => string;
  vipRule: string;
  onOpenProfile: (id: string) => void;
  onFilter: (filter: CustomerFilter) => void;
  /** Promo Codes, when this account can open it. */
  onOpenPromo?: () => void;
};

export const SEGMENT_TONE: Record<CustomerSegmentKey, Tone> = { vip: "success", repeat: "info", one: "neutral", none: "warning" };
const MEDALS = 3;
const plural = (n: number, one: string) => `${n.toLocaleString()} ${one}${n === 1 ? "" : "s"}`;

export function shortDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function kpiValue(k: CustomerKpi, money: (n: number) => string): string {
  if (k.kind === "money") return money(k.value);
  if (k.kind === "percent") return `${Math.round(k.value * 100)}%`;
  return k.value.toLocaleString();
}

function Kpis(p: AccountsInsightsProps) {
  const t = useTheme();
  const kpis = useMemo(
    () => buildCustomerKpis({ accounts: p.accounts, ledger: p.ledger, stats: p.stats, period: p.period, now: p.now }),
    [p.accounts, p.ledger, p.stats, p.period, p.now],
  );
  return (
    <View style={styles.grid} accessibilityLabel="Customer metrics">
      {kpis.map((k, i) => (
        <View
          key={k.id}
          accessible
          accessibilityLabel={`${k.label}: ${kpiValue(k, p.money)}, ${k.sub}`}
          style={[
            styles.kpi,
            // The lead figure spans the row: hierarchy, not five equal boxes.
            i === 0 ? styles.kpiLead : null,
            { backgroundColor: t.colors.surface, borderColor: t.colors.border },
          ]}
        >
          <AppText variant="caption" color="muted" numberOfLines={1}>{k.label}</AppText>
          <AppText variant={i === 0 ? "number" : "stat"} numberOfLines={1} style={styles.tabular}>
            {kpiValue(k, p.money)}
          </AppText>
          <AppText variant="caption" color="faint" numberOfLines={1}>{k.sub}</AppText>
        </View>
      ))}
    </View>
  );
}

const BAR_AREA = 120;

function TrendCard({ ledger, period, now, money, moneyShort }: AccountsInsightsProps) {
  const t = useTheme();
  const trend = useMemo(() => buildRevenueTrend(ledger, period, now), [ledger, period, now]);
  const max = Math.max(...trend.bars.map((b) => b.total), 1);
  const summary = trend.bars.map((b) => `${b.label}: ${money(b.total)}`).join(", ");
  return (
    <View>
      <SectionHeader eyebrow="Revenue" title="From customer accounts" />
      <Panel style={{ gap: SPACE.sm }}>
        <AppText variant="caption" color="muted">{trend.caption}</AppText>
        <View style={styles.bars} accessible accessibilityRole="image" accessibilityLabel={summary}>
          {trend.bars.map((b, i) => {
            const current = i === trend.bars.length - 1;
            return (
              <View key={b.key} style={styles.barCol}>
                <AppText variant="caption" color={current ? "text" : "muted"} numberOfLines={1} style={styles.barValue}>
                  {b.total > 0 ? moneyShort(b.total) : "—"}
                </AppText>
                <View
                  style={{
                    width: "70%",
                    height: Math.max(2, Math.round((b.total / max) * BAR_AREA)),
                    borderRadius: RADIUS.sm,
                    backgroundColor: current ? t.colors.chart : t.colors.chartTrack,
                  }}
                />
                <AppText variant="caption" color="faint" numberOfLines={1} style={styles.barValue}>{b.label}</AppText>
              </View>
            );
          })}
        </View>
      </Panel>
    </View>
  );
}

const SEGMENT_FILTER: Record<CustomerSegmentKey, CustomerFilter> = { vip: "top", repeat: "orders", one: "orders", none: "none" };

function SegmentsCard({ accounts, stats, money, vipRule, onFilter }: AccountsInsightsProps) {
  const t = useTheme();
  const segments = useMemo(() => buildSegments(accounts, stats, vipRule), [accounts, stats, vipRule]);
  return (
    <View>
      <SectionHeader eyebrow="Segments" title="Who your customers are" />
      <Panel style={{ gap: SPACE.md }}>
        <AppText variant="caption" color="muted">{`All time · ${plural(accounts.length, "account")}`}</AppText>
        <View style={[styles.segbar, { backgroundColor: t.colors.chartTrack }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
          {segments
            .filter((s) => s.count > 0)
            .map((s) => (
              <View key={s.key} style={{ width: `${s.pct}%`, backgroundColor: t.tone(SEGMENT_TONE[s.key]).fg }} />
            ))}
        </View>
        {segments.map((s) => {
          const c = t.tone(SEGMENT_TONE[s.key]);
          return (
            <Pressable
              key={s.key}
              accessibilityRole="button"
              accessibilityLabel={`${s.label}: ${plural(s.count, "customer")}, ${money(s.revenue)}. ${s.rule}. Show them`}
              disabled={s.count === 0}
              onPress={() => onFilter(SEGMENT_FILTER[s.key])}
              style={({ pressed }) => [styles.seg, pressed ? { backgroundColor: t.colors.surfaceAlt } : null, s.count === 0 ? { opacity: 0.5 } : null]}
            >
              <View style={[styles.swatch, { backgroundColor: c.fg }]} />
              <View style={{ flex: 1 }}>
                <AppText variant="bodyStrong">{s.label}</AppText>
                <AppText variant="caption" color="muted">{s.rule}</AppText>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                <AppText variant="label" style={styles.tabular}>{plural(s.count, "customer")}</AppText>
                <AppText variant="caption" color="muted" style={styles.tabular}>{money(s.revenue)}</AppText>
              </View>
              {s.count > 0 ? <Ionicons name="chevron-forward" size={16} color={t.colors.textFaint} /> : null}
            </Pressable>
          );
        })}
      </Panel>
    </View>
  );
}

function LeadersCard({ accounts, stats, money, onOpenProfile }: AccountsInsightsProps) {
  const t = useTheme();
  const [metric, setMetric] = useState<LeaderMetric>("spend");
  const leaders = useMemo(() => buildLeaders(accounts, stats, metric), [accounts, stats, metric]);
  return (
    <View>
      <SectionHeader eyebrow="Leaderboard" title="Top spenders" />
      <Panel style={{ gap: SPACE.md }}>
        <Chips<LeaderMetric>
          options={[
            { key: "spend", label: "By spend" },
            { key: "orders", label: "By orders" },
          ]}
          value={metric}
          onChange={setMetric}
          label="Rank by"
        />
        {leaders.length === 0 ? (
          <AppText variant="caption" color="muted">Your best buyers show up here after their first order.</AppText>
        ) : (
          leaders.map((c, i) => {
            const value = metric === "spend" ? money(c.spent) : plural(c.orders, "order");
            const secondary =
              metric === "spend"
                ? `${plural(c.orders, "order")} · avg ${money(c.avg)}`
                : `${money(c.spent)} spent · last order ${shortDate(c.lastAt)}`;
            const medal = i < MEDALS;
            return (
              <Pressable
                key={c.id}
                accessibilityRole="button"
                accessibilityLabel={`${i + 1}. ${c.name}, ${value}, ${secondary}. Open order history`}
                onPress={() => onOpenProfile(c.id)}
                style={({ pressed }) => [{ gap: 6 }, pressed ? { opacity: 0.6 } : null]}
              >
                <View style={styles.leaderTop}>
                  <View style={[styles.rank, { backgroundColor: medal ? t.tone("success").bg : t.colors.surfaceAlt }]}>
                    <AppText variant="caption" color={medal ? t.tone("success").fg : "muted"} style={{ fontWeight: "700" }}>
                      {String(i + 1)}
                    </AppText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <AppText variant="bodyStrong" numberOfLines={1}>{c.name}</AppText>
                    <AppText variant="caption" color="muted" numberOfLines={1}>{secondary}</AppText>
                  </View>
                  <AppText variant="bodyStrong" style={styles.tabular}>{value}</AppText>
                </View>
                <View style={[styles.meter, { backgroundColor: t.colors.chartTrack }]}>
                  <View style={[styles.meterFill, { width: `${c.pct}%`, backgroundColor: t.colors.chart }]} />
                </View>
              </Pressable>
            );
          })
        )}
      </Panel>
    </View>
  );
}

function AttentionItem({ title, text, cta, onPress }: { title: string; text: string; cta: string; onPress: () => void }) {
  return (
    <View style={{ gap: 4 }}>
      <AppText variant="bodyStrong">{title}</AppText>
      <AppText variant="caption" color="muted">{text}</AppText>
      <Button label={cta} variant="ghost" icon="arrow-forward" onPress={onPress} style={{ alignSelf: "flex-start", paddingHorizontal: 0 }} />
    </View>
  );
}

function SideCards({ accounts, stats, now, onFilter, onOpenPromo }: AccountsInsightsProps) {
  const t = useTheme();
  const share = useMemo(() => topSpenderShare(stats), [stats]);
  const { noOrders, lapsed, toLink } = useMemo(() => buildAttention(accounts, stats, now), [accounts, stats, now]);
  const lapsedMonth = lapsed.lastAt ? new Date(lapsed.lastAt).toLocaleDateString(undefined, { month: "long" }) : "";
  const more = lapsed.count - lapsed.names.length;
  const nothing = toLink.accounts === 0 && noOrders.count === 0 && lapsed.count === 0;
  return (
    <>
      {share !== null ? (
        <View style={[styles.concentration, { backgroundColor: t.colors.band }]}>
          <AppText variant="overline" color={t.colors.bandMuted}>CONCENTRATION</AppText>
          <AppText variant="display" color={t.colors.bandText} style={styles.tabular}>{`${Math.round(share * 100)}%`}</AppText>
          <AppText variant="body" color={t.colors.bandText}>
            {`of account revenue comes from your top ${Math.min(MEDALS, accounts.length)} customers. Keep them close.`}
          </AppText>
          <Pressable
            accessibilityRole="button"
            onPress={() => onFilter("top")}
            style={({ pressed }) => [styles.bandCta, { borderColor: t.colors.bandText, opacity: pressed ? 0.7 : 1 }]}
          >
            <AppText variant="label" color={t.colors.bandText}>See top spenders</AppText>
          </Pressable>
        </View>
      ) : null}
      <View>
        <SectionHeader eyebrow="Needs attention" />
        <Panel style={{ gap: SPACE.lg }}>
          {nothing ? (
            <AppText variant="caption" color="muted">Nothing waiting on you. Every account has bought recently.</AppText>
          ) : null}
          {toLink.accounts > 0 ? (
            <AttentionItem
              title={`${plural(toLink.orders, "earlier order")} to link to ${plural(toLink.accounts, "account")}`}
              text="Placed as a guest with the same email before they signed up. Link them so the history and totals are complete."
              cta="Review"
              onPress={() => onFilter("unlinked")}
            />
          ) : null}
          {noOrders.count > 0 ? (
            <AttentionItem
              title={`${plural(noOrders.count, "account")}, no orders yet`}
              text={`${noOrders.joinedThisWeek > 0 ? `${noOrders.joinedThisWeek} joined this week. ` : ""}A first-order promo code often converts sign-ups.`}
              cta={onOpenPromo ? "Create promo code" : "View them"}
              onPress={onOpenPromo ?? (() => onFilter("none"))}
            />
          ) : null}
          {lapsed.count > 0 ? (
            <AttentionItem
              title={`${plural(lapsed.count, "buyer")} quiet for ${LAPSED_DAYS}+ days`}
              text={`${lapsed.names.join(" and ")}${more > 0 ? ` and ${more} more` : ""} ${lapsed.count === 1 ? "hasn't" : "haven't"} ordered since ${lapsedMonth}.`}
              cta="View quiet buyers"
              onPress={() => onFilter("lapsed")}
            />
          ) : null}
        </Panel>
      </View>
    </>
  );
}

export function AccountsInsights(props: AccountsInsightsProps) {
  return (
    <View style={{ gap: SPACE.xl }}>
      <Kpis {...props} />
      <TrendCard {...props} />
      <SegmentsCard {...props} />
      <LeadersCard {...props} />
      <SideCards {...props} />
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  kpi: { flexGrow: 1, flexBasis: "46%", padding: SPACE.lg, gap: 4, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  kpiLead: { flexBasis: "100%" },
  tabular: { fontVariant: ["tabular-nums"] },
  bars: { flexDirection: "row", alignItems: "flex-end", gap: SPACE.sm, minHeight: BAR_AREA + 44 },
  barCol: { flex: 1, alignItems: "center", justifyContent: "flex-end", gap: 4 },
  barValue: { fontSize: 11, lineHeight: 14, textAlign: "center", fontVariant: ["tabular-nums"] },
  segbar: { flexDirection: "row", height: 10, borderRadius: 5, overflow: "hidden", gap: 2 },
  seg: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingVertical: SPACE.sm, minHeight: 52, borderRadius: RADIUS.md },
  swatch: { width: 10, height: 10, borderRadius: 3 },
  leaderTop: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  rank: { width: 28, height: 28, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  meter: { height: 4, borderRadius: 2, overflow: "hidden", marginLeft: 28 + SPACE.md },
  meterFill: { height: 4, borderRadius: 2 },
  concentration: { borderRadius: RADIUS.lg, padding: SPACE.xl, gap: SPACE.sm },
  bandCta: { alignSelf: "flex-start", minHeight: 40, paddingHorizontal: 16, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center", marginTop: SPACE.sm },
});
