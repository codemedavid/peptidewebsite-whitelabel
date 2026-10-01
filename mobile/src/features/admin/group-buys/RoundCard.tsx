import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText, Button, Card, Pill } from "@/ui/primitives";
import {
  STATUS_TONE,
  fmtDateTime,
  fmtDate,
  statusLabel,
  type GroupBuy,
  type GroupBuyCapabilities,
  type GroupBuyStatus,
  type RoundListRow,
} from "./model";

/**
 * One row of the website's rounds list: tap the summary to open the round's
 * dashboard; the action buttons appear only for the capabilities the plan grants
 * (the server re-checks every one).
 */
export function RoundCard({
  gb,
  row,
  effective,
  caps,
  awaitingReport,
  busy,
  money,
  onOpen,
  onReport,
  onDuplicate,
  onEdit,
  onArchive,
}: {
  gb: GroupBuy;
  row: RoundListRow | undefined;
  effective: GroupBuyStatus;
  caps: GroupBuyCapabilities;
  awaitingReport: boolean;
  busy: boolean;
  money: (n: number) => string;
  onOpen: () => void;
  onReport: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  onArchive: () => void;
}) {
  const t = useTheme();
  const archived = gb.status === "archived";
  const summary = row ? `${row.productName} · Batch ${row.batchNumber}` : fmtDateTime(gb.startsAt);
  const stats = row
    ? `${row.maxVials === null ? `${row.currentVials} vials` : `${row.currentVials}/${row.maxVials} vials`} · ${row.totalOrders} order${
        row.totalOrders === 1 ? "" : "s"
      } · ${row.participants} participant${row.participants === 1 ? "" : "s"} · ${money(row.grossIncome)} · created ${fmtDate(row.createdAt)}`
    : null;

  return (
    <Card padded={false}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open the dashboard for ${gb.name}`}
        onPress={onOpen}
        style={({ pressed }) => [styles.info, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
      >
        <View style={{ flex: 1, gap: 4 }}>
          <View style={styles.titleRow}>
            <AppText variant="bodyStrong" style={{ flexShrink: 1 }}>
              {gb.name}
            </AppText>
            <Pill tone={STATUS_TONE[effective]} size="sm" label={statusLabel(effective)} />
          </View>
          <AppText variant="caption" color="muted">
            {`${summary}${gb.deliveryEta ? ` · ETA: ${gb.deliveryEta}` : ""}`}
          </AppText>
          {stats ? (
            <AppText variant="caption" color="muted">
              {stats}
            </AppText>
          ) : null}
        </View>
        <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
      </Pressable>
      <View style={[styles.actions, { borderColor: t.colors.border }]}>
        {caps.supplierReports ? (
          // A finished round promotes its own Report button until it's archived.
          <Button
            label={awaitingReport ? "Reports ready" : "Report"}
            variant={awaitingReport ? "primary" : "secondary"}
            icon="document-text-outline"
            accessibilityHint={
              awaitingReport
                ? "This round has finished — download the supplier and customer reports"
                : "Supplier and customer reports for this round"
            }
            onPress={onReport}
          />
        ) : null}
        {caps.canDuplicate ? <Button label="Duplicate" variant="ghost" icon="copy-outline" disabled={busy} onPress={onDuplicate} /> : null}
        {caps.canEdit && !archived ? <Button label="Edit" variant="ghost" icon="create-outline" disabled={busy} onPress={onEdit} /> : null}
        {caps.canArchive ? (
          <Button
            label={archived ? "Restore" : "Archive"}
            variant="ghost"
            icon={archived ? "arrow-undo-outline" : "archive-outline"}
            disabled={busy}
            onPress={onArchive}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  info: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.lg },
  titleRow: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: SPACE.sm },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: SPACE.xs,
    paddingHorizontal: SPACE.md,
    paddingVertical: SPACE.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});

