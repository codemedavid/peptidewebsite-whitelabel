import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  DashboardAlert,
  DashboardCatalog,
  DashboardCategoryShare,
  DashboardGbRoundRef,
  DashboardStockRow,
  Tone,
} from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { BarList } from "@/ui/charts/Bars";
import { Panel, SectionHeader, StatTile } from "@/ui/kit";
import { AppText } from "@/ui/primitives";
import { MeterList } from "./MeterList";
import { openAlertTarget } from "./targets";

/**
 * The website dashboard's catalog + attention panels (AdminDashboard.tsx) on
 * Home: the operations tiles, Stock levels, Top categories and Needs
 * attention. Every number arrives display-ready from GET /dashboard (built by
 * the website's own lib/storefront/admin-dashboard) — these only lay it out.
 */

const ALERT_TONE: Record<DashboardAlert["tone"], Tone> = { neutral: "neutral", good: "success", warn: "warning", bad: "danger" };
const STOCK_TONE: Record<DashboardStockRow["tone"], Tone> = { out: "danger", low: "warning", ok: "neutral" };

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

/** Products / Units in stock / Out of stock — the website's no-analytics tile row. */
export function CatalogTiles({ catalog }: { catalog: DashboardCatalog }) {
  return (
    <View>
      <SectionHeader eyebrow="Catalog" action={{ label: "Products", onPress: () => router.navigate("/products") }} />
      <View style={styles.grid}>
        <StatTile icon="pricetags-outline" label="Products" value={catalog.products.toLocaleString()} onPress={() => router.navigate("/products")} />
        <StatTile icon="layers-outline" label="Units in stock" value={catalog.units.toLocaleString()} />
        <StatTile icon="close-circle-outline" label="Out of stock" value={catalog.outOfStock.toLocaleString()} />
      </View>
      <AppText variant="caption" color="muted" style={{ marginTop: SPACE.sm }}>
        {`${plural(catalog.featured, "item")} featured · ${
          catalog.outOfStock > 0 ? `${plural(catalog.outOfStock, "product")} not sellable right now` : "everything is sellable"
        }`}
      </AppText>
    </View>
  );
}

export function StockLevelsPanel({ rows, canManage }: { rows: readonly DashboardStockRow[]; canManage: boolean }) {
  if (rows.length === 0) return null;
  return (
    <View>
      <SectionHeader
        eyebrow="Inventory"
        title="Stock levels"
        action={canManage ? { label: "Manage", onPress: () => router.navigate("/products") } : undefined}
      />
      <Panel>
        <MeterList
          rows={rows.map((r) => ({
            id: r.id,
            name: r.name,
            note: r.units === 0 ? "Out of stock" : `${r.units.toLocaleString()} left`,
            pct: r.pct,
            tone: STOCK_TONE[r.tone],
          }))}
        />
      </Panel>
    </View>
  );
}

export function TopCategoriesPanel({ rows, canManage }: { rows: readonly DashboardCategoryShare[]; canManage: boolean }) {
  if (rows.length === 0) return null;
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <View>
      <SectionHeader
        eyebrow="Catalog"
        title="Top categories"
        action={canManage ? { label: "Manage", onPress: () => router.push("/manage/categories") } : undefined}
      />
      <Panel>
        <BarList
          rows={rows.map((c) => ({
            key: c.id,
            name: c.label,
            value: c.count,
            valueLabel: c.count.toLocaleString(),
            detail: c.count === 1 ? "product" : "products",
            share: total > 0 ? c.count / total : 0,
          }))}
        />
      </Panel>
    </View>
  );
}

/** "Needs attention": group-buy items first (a join waiting is a customer locked out). */
export function AttentionPanel({ alerts, round }: { alerts: readonly DashboardAlert[]; round: DashboardGbRoundRef | null }) {
  const t = useTheme();
  if (alerts.length === 0) return null;
  return (
    <View>
      <SectionHeader eyebrow="Needs attention" title={`${alerts.length} ${alerts.length === 1 ? "thing needs" : "things need"} you`} />
      <Panel style={{ padding: 0, overflow: "hidden" }}>
        {alerts.map((a, i) => {
          const c = t.tone(ALERT_TONE[a.tone]);
          return (
            <Pressable
              key={a.id}
              accessibilityRole="button"
              accessibilityLabel={a.sub ? `${a.title}. ${a.sub}` : a.title}
              onPress={() => openAlertTarget(a.target, round)}
              style={({ pressed }) => [
                styles.alert,
                i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border } : null,
                pressed ? { backgroundColor: t.colors.surfaceAlt } : null,
              ]}
            >
              <View style={[styles.dot, { backgroundColor: a.tone === "neutral" ? t.colors.textFaint : c.fg }]} />
              <View style={{ flex: 1, gap: 2 }}>
                <AppText variant="bodyStrong">{a.title}</AppText>
                {a.sub ? (
                  <AppText variant="caption" color="muted" numberOfLines={2}>
                    {a.sub}
                  </AppText>
                ) : null}
              </View>
              <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
            </Pressable>
          );
        })}
      </Panel>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  alert: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.lg, minHeight: 64 },
  dot: { width: 10, height: 10, borderRadius: RADIUS.pill },
});
