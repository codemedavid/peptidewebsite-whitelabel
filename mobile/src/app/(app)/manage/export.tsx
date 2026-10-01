import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { buildExport } from "@/features/admin/account/data";
import { SharingUnavailableError, shareExportFiles } from "@/features/admin/account/export-files";
import { EXPORT_FILES, type ExportBundle } from "@/features/admin/account/rules";
import { success } from "@/features/admin/setup/data";
import { FormPage, Hint, Section } from "@/features/admin/setup/ui";
import { useOnline } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";
import { SPACE } from "@/theme/tokens";

/**
 * The website's Export My Data (AdminDataExport), owner only. The server
 * action (exportStoreDataAction) returns finished files — four spreadsheets and
 * one JSON dump — and the app only saves them: written to the phone, then the
 * share sheet (Files, Drive, AirDrop, mail…). Every tap rebuilds the export, so
 * a file grabbed after editing an order never carries yesterday's numbers.
 */
export default function ExportScreen() {
  const online = useOnline();
  const [bundle, setBundle] = useState<ExportBundle | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function exportFiles(match: string | null) {
    if (busy) return;
    setBusy(match ?? "all");
    try {
      const ready = await buildExport();
      setBundle(ready);
      const files = match ? ready.files.filter((f) => f.filename.includes(match)) : ready.files;
      if (files.length === 0) {
        Alert.alert("Nothing to save", "That file wasn't part of this export.");
        return;
      }
      const shared = await shareExportFiles(files);
      if (shared > 0) success();
    } catch (e) {
      if (e instanceof SharingUnavailableError) Alert.alert("Can't save files here", e.message);
      else Alert.alert("Couldn't build the export", e instanceof Error ? e.message : "Please sign in again and retry.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Stack.Screen options={{ title: "Export my data" }} />
      <FormPage>
        <Section title="Your data is yours">
          <AppText variant="body" color="muted">
            Download your products, customers and complete order history at any time — no request, no waiting. The spreadsheets open in Excel,
            Numbers or Google Sheets, and the JSON file is what a developer would use to import your store somewhere else. Orders you have
            deleted are included too, flagged “Deleted”, so nothing is left behind.
          </AppText>
          <Button
            label={busy === "all" ? "Preparing…" : "Download everything"}
            icon="download-outline"
            loading={busy === "all"}
            disabled={!!busy || !online}
            onPress={() => void exportFiles(null)}
          />
          <Hint>Saves all five files — your phone opens the share sheet for each one, so you can save them to Files or Drive, or send them.</Hint>
          {bundle ? (
            <Hint>
              {`Last export: ${bundle.counts.products} products · ${bundle.counts.orders} orders · ${bundle.counts.orderItems} order lines · ${bundle.counts.customers} customers.`}
            </Hint>
          ) : null}
        </Section>

        <Section title="Or pick one file">
          {EXPORT_FILES.map((b) => (
            <View key={b.match} style={styles.file}>
              <Button
                label={busy === b.match ? "Preparing…" : b.label}
                variant="secondary"
                icon="document-text-outline"
                loading={busy === b.match}
                disabled={!!busy || !online}
                onPress={() => void exportFiles(b.match)}
              />
              <Hint>{b.hint}</Hint>
            </View>
          ))}
        </Section>

        <Section title="What’s inside">
          <Inside label="Products" text="id, name, each size/option with its own price and stock, category, description and image link." />
          <Inside
            label="Orders"
            text="order number, date, status, payment, the customer and full shipping address, subtotal, discount, shipping fee, service fee and total."
          />
          <Inside label="Order items" text="one row per product line, so you can rebuild sales by product anywhere." />
          <Inside label="Customers" text="one row per person (repeat orders merged), with contact details, latest address, order count and lifetime spend." />
          <Inside label="Everything (JSON)" text="all of the above in one structured file." />
        </Section>
      </FormPage>
    </>
  );
}

function Inside({ label, text }: { label: string; text: string }) {
  return (
    <AppText variant="caption" color="muted">
      <AppText variant="caption" style={{ fontWeight: "700" }}>
        {label}
      </AppText>
      {` — ${text}`}
    </AppText>
  );
}

const styles = StyleSheet.create({
  file: { gap: SPACE.xs },
});
