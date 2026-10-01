import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Card, AppText, Button } from "@/ui/primitives";
import { EmptyState, ErrorState, SkeletonList } from "@/ui/feedback";
import { SPACE } from "@/theme/tokens";
import { useSupplierReport } from "./hooks";
import { reportCsv, shareCsv, shareCustomerWorkbook, shareSupplierWorkbook } from "./export";
import { OrderLineCard, ProductsToOrder, TileGrid, ViewSheet, useProofViewer } from "./parts";
import { moneyOf, type GroupBuy, type GroupBuyCapabilities } from "./model";

/**
 * The website's Round Report modal (getGroupBuySupplierReportAction): headline
 * counts, products to order, every order line, the per-customer rollup and the
 * exports the plan allows (CSV, supplier .xlsx, customers .xlsx) — shared from
 * the phone instead of downloaded.
 */
export function ReportSheet({
  groupBuy,
  caps,
  currency,
  onClose,
}: {
  groupBuy: GroupBuy;
  caps: GroupBuyCapabilities;
  currency: string;
  onClose: () => void;
}) {
  const report = useSupplierReport(groupBuy.id);
  const proof = useProofViewer();
  const [exporting, setExporting] = useState<string | null>(null);
  const money = moneyOf(currency);
  const data = report.data;
  const hasLines = !!data && data.productsToOrder.length > 0;

  const run = async (key: string, job: () => Promise<void>) => {
    setExporting(key);
    try {
      await job();
    } catch (e) {
      Alert.alert("Couldn't export the report", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setExporting(null);
    }
  };

  const footer =
    data && hasLines && (caps.reports.csv || caps.reports.excel) ? (
      <View style={styles.exports}>
        {caps.reports.excel ? (
          <Button
            label="Supplier .xlsx"
            icon="share-outline"
            accessibilityHint="Product quantities only — safe to send to the supplier"
            loading={exporting === "supplier"}
            disabled={!!exporting}
            onPress={() => void run("supplier", () => shareSupplierWorkbook(data.prep))}
          />
        ) : null}
        {caps.reports.excel && caps.reports.customerBreakdown ? (
          <Button
            label="Customers .xlsx"
            variant="secondary"
            icon="share-outline"
            accessibilityHint="Customers, orders and totals — your copy, do not send to the supplier"
            loading={exporting === "customers"}
            disabled={!!exporting}
            onPress={() => void run("customers", () => shareCustomerWorkbook(data.prep))}
          />
        ) : null}
        {caps.reports.csv ? (
          <Button
            label="CSV"
            variant="secondary"
            icon="document-text-outline"
            loading={exporting === "csv"}
            disabled={!!exporting}
            onPress={() =>
              void run("csv", () =>
                shareCsv(
                  groupBuy.name,
                  reportCsv({ productsToOrder: data.productsToOrder, counts: data.counts, orderRows: data.orderRows, customers: data.customers }),
                ),
              )
            }
          />
        ) : null}
      </View>
    ) : undefined;

  return (
    <ViewSheet title={`Round Report — ${groupBuy.name}`} onClose={onClose} footer={footer}>
      {report.isError ? (
        <ErrorState message={report.error?.message ?? "Please try again."} onRetry={() => void report.refetch()} />
      ) : !data ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <TileGrid
            tiles={[
              { label: "Total Orders", value: data.counts.totalOrders },
              { label: "Active", value: data.counts.activeOrders },
              { label: "Confirmed", value: data.counts.confirmedOrders },
              { label: "Pending", value: data.counts.pendingOrders },
              { label: "Cancelled", value: data.counts.cancelledOrders },
              { label: "Vials Ordered", value: data.counts.totalVials },
              { label: "Total Sales", value: money(data.counts.totalSales) },
            ]}
          />
          {data.unlinked > 0 ? <UnlinkedNote count={data.unlinked} /> : null}
          {hasLines ? (
            <>
              <AppText variant="overline" color="link" accessibilityRole="header">
                PRODUCTS TO ORDER
              </AppText>
              <ProductsToOrder lines={data.productsToOrder} totalVials={data.counts.totalVials} />
            </>
          ) : (
            <EmptyState icon="cube-outline" title="No orders were placed under this group buy yet." />
          )}
          {data.orderRows.length > 0 ? (
            <>
              <AppText variant="overline" color="link" accessibilityRole="header">
                {`ORDERS (${data.counts.totalOrders})`}
              </AppText>
              {data.orderRows.map((l, i) => (
                <OrderLineCard key={`${l.orderNumber}-${l.productId ?? l.product}-${i}`} line={l} showBatch money={money} onProof={proof.open} />
              ))}
            </>
          ) : null}
          {data.customers && data.customers.length > 0 ? (
            <>
              <AppText variant="overline" color="link" accessibilityRole="header">
                PER CUSTOMER
              </AppText>
              <Card style={{ gap: SPACE.sm }}>
                {data.customers.map((c) => (
                  <View key={c.email || c.name} style={styles.customer} accessible>
                    <View style={{ flex: 1 }}>
                      <AppText variant="bodyStrong">{c.name}</AppText>
                      <AppText variant="caption" color="muted">
                        {`${c.orders} order${c.orders === 1 ? "" : "s"} · ${c.qty} qty`}
                      </AppText>
                    </View>
                    <AppText variant="bodyStrong">{money(c.total)}</AppText>
                  </View>
                ))}
              </Card>
            </>
          ) : null}
        </>
      )}
      {proof.viewer}
    </ViewSheet>
  );
}

export function UnlinkedNote({ count }: { count: number }) {
  return (
    <AppText variant="caption" color="muted">
      {`${count} other order${count === 1 ? " was" : "s were"} placed outside every group buy's date range, so ${
        count === 1 ? "it isn't" : "they aren't"
      } counted here. Adjust this round's open/close dates to include ${count === 1 ? "it" : "them"}.`}
    </AppText>
  );
}

const styles = StyleSheet.create({
  exports: { gap: SPACE.sm },
  customer: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
