import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { gbKeys } from "@/features/admin/group-buys/hooks";
import { ReportSheet } from "@/features/admin/group-buys/ReportSheet";
import type { GroupBuy, ListResult } from "@/features/admin/group-buys/model";
import { SPACE } from "@/theme/tokens";
import { AppText, Button, Card } from "@/ui/primitives";
import { FolderStats } from "./FolderList";
import { FOLDER_STATUS_LABEL, roundMeta, type OrderFolder } from "./folders";

/**
 * A round's header above its orders — the web hub's RoundHeader: status,
 * the round's numbers (with Outstanding), its reports and the full dashboard.
 * The reports open the app's Round Report (ReportSheet), which shares the
 * same supplier / customer workbooks the website downloads.
 */
export function RoundHeader({
  f,
  groupBuy,
  canReport,
  currency,
  money,
}: {
  f: OrderFolder;
  groupBuy: GroupBuy | undefined;
  canReport: boolean;
  currency: string;
  money: (n: number) => string;
}) {
  const [showReport, setShowReport] = useState(false);
  // The report's export buttons follow the plan's capabilities; only read them
  // when this account may report at all (listGroupBuysAction re-checks it).
  // Same key + action as useGroupBuyList, so the Group buys screen's cache is shared.
  const { scope } = useSignedIn();
  const list = useQuery({
    queryKey: gbKeys.list(scope),
    enabled: canReport,
    queryFn: async () => unwrap(await adminBridge.call<ListResult | { error: string }>("listGroupBuysAction")),
  });
  const caps = list.data?.caps;

  return (
    <Card style={styles.card}>
      <AppText variant="caption" color="muted">
        {[FOLDER_STATUS_LABEL[f.status], roundMeta(f)].filter(Boolean).join(" · ")}
      </AppText>
      <FolderStats f={f} money={money} outstanding />
      <View style={styles.actions}>
        {canReport ? (
          <Button
            label="Round report"
            icon="document-text-outline"
            variant="secondary"
            loading={showReport && !caps}
            disabled={!groupBuy || list.isError}
            accessibilityHint="Supplier order sheet and customer & payments list, ready to share"
            onPress={() => setShowReport(true)}
            style={styles.action}
          />
        ) : (
          <AppText variant="caption" color="muted" style={styles.action}>
            Excel reports aren&apos;t enabled for your account.
          </AppText>
        )}
        {groupBuy ? (
          <Button
            label="Full dashboard"
            icon="stats-chart-outline"
            variant="ghost"
            accessibilityHint="Analytics, per-customer totals and vials"
            onPress={() => router.push({ pathname: "/manage/group-buys-detail", params: { id: groupBuy.id, name: groupBuy.name } })}
            style={styles.action}
          />
        ) : null}
      </View>
      {showReport && groupBuy && caps ? (
        <ReportSheet groupBuy={groupBuy} caps={caps} currency={currency} onClose={() => setShowReport(false)} />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: SPACE.sm },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, alignItems: "center", marginTop: SPACE.xs },
  action: { flexGrow: 1 },
});
