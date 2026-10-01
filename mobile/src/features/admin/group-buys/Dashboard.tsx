import { useState } from "react";
import { Alert, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { ChoicePills } from "@/features/admin/setup/ui";
import { EmptyState, OfflineBanner, useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import { shareSupplierWorkbook } from "./export";
import { useRoundAction } from "./hooks";
import { KV, OrderLineCard, Panel, ProductsToOrder, TileGrid, useProofViewer } from "./parts";
import { UnlinkedNote } from "./ReportSheet";
import {
  ORDER_STATUSES,
  filterOrderRows,
  fmtDate,
  moneyOf,
  statusLabel,
  type AssignmentDrift,
  type DashboardResult,
  type OrderRowFilters,
  type PaymentDisplayStatus,
} from "./model";

/**
 * One round's dashboard (AdminGroupBuyDetail ← getGroupBuyDashboardAction):
 * summary cards, assignment drift + the one-tap fix, the Overview / Financial /
 * Vials panels, products to order, and this round's own filterable orders.
 * Every number is the server's, computed from THIS round's orders only.
 */
export function RoundDashboard({
  data,
  currency,
  refreshing,
  onRefresh,
}: {
  data: DashboardResult;
  currency: string;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  const t = useTheme();
  const online = useOnline();
  const money = moneyOf(currency);
  const proof = useProofViewer();
  const [filters, setFilters] = useState<OrderRowFilters>({});
  const [exporting, setExporting] = useState(false);
  const { overview, financial, product } = data.analytics;
  const { caps } = data;

  const rows = filterOrderRows(data.orderRows, filters);
  const filtersActive = Object.values(filters).some((v) => v);
  const setFilter = (patch: Partial<OrderRowFilters>) => setFilters((f) => ({ ...f, ...patch }));

  const exportExcel = async () => {
    setExporting(true);
    try {
      await shareSupplierWorkbook(data.prep);
    } catch (e) {
      Alert.alert("Couldn't export the report", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand.link} />}
      >
        <View style={{ gap: 2 }}>
          <AppText variant="title" accessibilityRole="header">
            {overview.name}
          </AppText>
          <AppText variant="body" color="muted">
            {`${overview.productName} · Batch ${overview.batchNumber} · ${overview.status}`}
          </AppText>
        </View>
        {caps.reports.excel ? (
          <Button label="Export Excel" variant="secondary" icon="share-outline" loading={exporting} disabled={exporting} onPress={() => void exportExcel()} />
        ) : null}

        <TileGrid
          tiles={[
            { label: "Total Orders", value: overview.totalOrders },
            { label: "Participants", value: overview.participants },
            { label: "Gross Income", value: money(financial.grossIncome), hint: "cancelled excluded" },
            { label: "Vials Ordered", value: product.totalVials, hint: "cancelled excluded" },
            {
              label: "Completion",
              value: product.completionPct === null ? "—" : `${product.completionPct}%`,
              hint: overview.maxVials === null ? "no maximum set" : `of ${overview.maxVials} vials`,
            },
            { label: "Confirmed Payments", value: money(financial.confirmedPayments) },
            { label: "Pending Payments", value: money(financial.pendingPayments) },
            { label: "Cancelled Orders", value: financial.cancelledOrders },
          ]}
        />
        {data.unlinked > 0 ? <UnlinkedNote count={data.unlinked} /> : null}
        {data.drift.hasDrift ? (
          <DriftAlert drift={data.drift} roundId={data.groupBuy.id} canFix={caps.canEdit && caps.productAssignment && online} onFixed={onRefresh} />
        ) : null}

        <Panel title="Overview">
          <KV label="Product" value={overview.productName} />
          <KV label="Batch number" value={overview.batchNumber} />
          <KV label="Status" value={overview.status} />
          <KV label="Created" value={fmtDate(overview.createdAt)} />
          <KV label="Closed" value={fmtDate(overview.closedAt)} />
          <KV
            label="Progress"
            value={overview.maxVials === null ? `${overview.currentVials} vials` : `${overview.currentVials} / ${overview.maxVials} vials`}
          />
          <KV
            label="Minimum requirement"
            value={overview.minVials === null ? "Not set" : `${overview.minVials} vials — ${overview.minimumMet ? "met" : "not met"}`}
          />
          <KV label="Participants" value={overview.participants} />
          <KV label="Total orders" value={overview.totalOrders} />
        </Panel>
        <Panel
          title="Financial"
          note="Cancelled orders are excluded from gross income and revenue. Outstanding balance is the value of orders not yet marked paid."
        >
          <KV label="Gross income" value={money(financial.grossIncome)} />
          <KV label="Confirmed payments" value={money(financial.confirmedPayments)} />
          <KV label="Pending payments" value={money(financial.pendingPayments)} />
          <KV label="Revenue collected" value={money(financial.revenueCollected)} />
          <KV label="Outstanding balance" value={money(financial.outstandingBalance)} />
          <KV label="Cancelled orders" value={financial.cancelledOrders} />
        </Panel>
        <Panel title="Vials">
          <KV label="Total ordered" value={product.totalVials} />
          <KV label="Confirmed" value={product.confirmedVials} />
          <KV label="Pending" value={product.pendingVials} />
          <KV label="Cancelled" value={`${product.cancelledVials} (not ordered)`} />
          <KV label="Remaining" value={product.remainingVials === null ? "—" : product.remainingVials} />
          <KV label="Completion" value={product.completionPct === null ? "—" : `${product.completionPct}%`} />
        </Panel>

        {product.productsToOrder.length > 0 ? (
          <>
            <AppText variant="overline" color="link" accessibilityRole="header">
              PRODUCTS TO ORDER
            </AppText>
            <ProductsToOrder lines={product.productsToOrder} totalVials={product.totalVials} />
          </>
        ) : null}

        <AppText variant="overline" color="link" accessibilityRole="header">
          {`ORDERS (${rows.length}${filtersActive ? ` of ${data.orderRows.length}` : ""})`}
        </AppText>
        <OrderFilters filters={filters} onChange={setFilter} onClear={filtersActive ? () => setFilters({}) : undefined} />
        {rows.length === 0 ? (
          <EmptyState
            icon="receipt-outline"
            title={data.orderRows.length === 0 ? "No orders have been placed under this group buy yet." : "No orders match these filters."}
          />
        ) : (
          rows.map((l, i) => <OrderLineCard key={`${l.orderNumber}-${l.productId ?? l.product}-${i}`} line={l} money={money} onProof={proof.open} />)
        )}
      </ScrollView>
      {proof.viewer}
    </View>
  );
}

function OrderFilters({
  filters,
  onChange,
  onClear,
}: {
  filters: OrderRowFilters;
  onChange: (patch: Partial<OrderRowFilters>) => void;
  onClear?: () => void;
}) {
  return (
    <View style={{ gap: SPACE.md }}>
      <ChoicePills<PaymentDisplayStatus | "all">
        label="Payment"
        options={[
          { key: "all", label: "All payments" },
          { key: "Confirmed", label: "Confirmed" },
          { key: "Pending", label: "Pending" },
          { key: "Cancelled", label: "Cancelled" },
        ]}
        value={filters.paymentStatus || "all"}
        onChange={(k) => onChange({ paymentStatus: k === "all" ? "" : k })}
      />
      <ChoicePills
        label="Order status"
        options={[{ key: "all", label: "All order statuses" }, ...ORDER_STATUSES.map((s) => ({ key: s, label: statusLabel(s) }))]}
        value={filters.orderStatus || "all"}
        onChange={(k) => onChange({ orderStatus: k === "all" ? "" : k })}
      />
      <View style={styles.pair}>
        <View style={{ flex: 1 }}>
          <Field
            label="From"
            value={filters.from ?? ""}
            onChangeText={(v) => onChange({ from: v })}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="To"
            value={filters.to ?? ""}
            onChangeText={(v) => onChange({ to: v })}
            placeholder="YYYY-MM-DD"
            keyboardType="numbers-and-punctuation"
            autoCorrect={false}
          />
        </View>
      </View>
      <Field
        label="Customer"
        value={filters.customer ?? ""}
        onChangeText={(v) => onChange({ customer: v })}
        placeholder="Customer name…"
        autoCorrect={false}
      />
      {onClear ? <Button label="Clear filters" variant="ghost" icon="close" onPress={onClear} /> : null}
    </View>
  );
}

/**
 * The silent failure the dashboard exists to surface: customers ordering products
 * the round doesn't list, so those orders lose attribution and group-buy pricing.
 * The fix re-runs the drift check server-side — the app never names the products.
 */
function DriftAlert({ drift, roundId, canFix, onFixed }: { drift: AssignmentDrift; roundId: string; canFix: boolean; onFixed: () => void }) {
  const t = useTheme();
  const warn = t.tone("warning");
  const fix = useRoundAction("addOrderedProductsToRoundAction");
  const n = drift.orderedUnassigned.length;
  const d = drift.danglingAssignments.length;
  const u = drift.assignedUnsold.length;
  return (
    <View accessibilityRole="alert" style={[styles.drift, { backgroundColor: warn.bg, borderColor: warn.fg }]}>
      <AppText variant="bodyStrong" color={warn.fg}>
        Check this round&apos;s product assignment.
      </AppText>
      {n > 0 ? (
        <AppText variant="body" color={warn.fg}>
          {`${n} product${n === 1 ? " is" : "s are"} being ordered but ${n === 1 ? "isn't" : "aren't"} assigned to this group buy, so those orders aren't linked to it and the buyers didn't get group-buy pricing: ${drift.orderedUnassigned
            .map((p) => `${p.name} (${p.vials})`)
            .join(" · ")}`}
        </AppText>
      ) : null}
      {d > 0 ? (
        <AppText variant="body" color={warn.fg}>
          {`${d} assigned product${d === 1 ? "" : "s"} no longer exist${d === 1 ? "s" : ""} in your catalog — most likely deleted or replaced by a duplicate with the same name.`}
        </AppText>
      ) : null}
      {u > 0 ? (
        <AppText variant="caption" color={warn.fg}>
          {`${u} assigned product${u === 1 ? " has" : "s have"} no orders: ${drift.assignedUnsold.map((p) => p.name).join(" · ")}`}
        </AppText>
      ) : null}
      {canFix ? (
        <Button
          label={fix.isPending ? "Updating…" : "Add the ordered products to this round"}
          loading={fix.isPending}
          onPress={() =>
            fix.mutate([roundId], {
              onSuccess: onFixed,
              onError: (e) => Alert.alert("Couldn't update the round", e.message),
            })
          }
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  pair: { flexDirection: "row", gap: SPACE.md },
  drift: { borderWidth: 1, borderRadius: RADIUS.md, padding: SPACE.lg, gap: SPACE.sm },
});
