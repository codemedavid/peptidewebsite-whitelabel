import { useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, View } from "react-native";
import { router, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { callAction } from "@/features/admin/account/data";
import { success } from "@/features/admin/setup/data";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";

/** The fields of the website's storefront Order this screen reads. */
type TrashedOrder = {
  id: string;
  orderNumber?: string;
  date: string;
  deletedAt?: string;
  customer: { name: string };
  items: { quantity: number }[];
};

type TrashAction = "restoreStorefrontOrdersAction" | "purgeStorefrontOrdersAction";

/**
 * The website's order Trash (AdminOrders "trash" view): every trashed order,
 * restore or delete forever, one at a time or in bulk. Runs the website's own
 * actions, so "delete forever" stays owner-only on the server.
 */
export default function OrderTrashScreen() {
  const t = useTheme();
  const online = useOnline();
  const { scope } = useSignedIn();
  const qc = useQueryClient();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const list = useQuery({
    queryKey: [...qk.ordersAll(scope), "trash"],
    queryFn: async () => (await callAction<{ ok: true; orders: TrashedOrder[] }>("listStorefrontOrdersAction", "trash")).orders,
  });

  const act = useMutation({
    mutationFn: ({ fn, ids }: { fn: TrashAction; ids: string[] }) => callAction(fn, ids),
    onSuccess: (_r, { fn, ids }) => {
      success();
      setSelected(new Set());
      Alert.alert(fn === "restoreStorefrontOrdersAction" ? `Restored ${plural(ids.length)}` : `Deleted ${plural(ids.length)} forever`);
    },
    onError: (e) => Alert.alert("Couldn't update the trash", e.message),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: qk.ordersAll(scope) });
      void qc.invalidateQueries({ queryKey: qk.dashboard(scope) });
    },
  });

  const orders = list.data ?? [];
  const picked = [...selected];
  const targets = picked.length ? picked : orders.map((o) => o.id);
  const allSelected = orders.length > 0 && orders.every((o) => selected.has(o.id));
  const busy = act.isPending || !online;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const restore = (ids: string[]) => act.mutate({ fn: "restoreStorefrontOrdersAction", ids });
  const purge = (ids: string[]) =>
    Alert.alert(`Delete ${plural(ids.length)} forever?`, "This can't be undone. The order is removed from your history and reports.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete forever", style: "destructive", onPress: () => act.mutate({ fn: "purgeStorefrontOrdersAction", ids }) },
    ]);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Trash" }} />
      <OfflineBanner />
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACE.sm }} />}
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand.link} />}
          ListHeaderComponent={
            orders.length ? (
              <View style={styles.header}>
                <AppText variant="caption" color="muted">
                  Trashed orders are hidden from your lists and reports. Restore one to bring it back, or delete it forever.
                </AppText>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: allSelected }}
                  accessibilityLabel={`Select all (${orders.length})`}
                  hitSlop={8}
                  onPress={() => setSelected(allSelected ? new Set() : new Set(orders.map((o) => o.id)))}
                  style={styles.check}
                >
                  <Ionicons name={allSelected ? "checkbox" : "square-outline"} size={24} color={allSelected ? t.brand.link : t.colors.textMuted} />
                  <AppText variant="label">{`Select all (${orders.length})`}</AppText>
                </Pressable>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <EmptyState
              icon="trash-outline"
              title="Trash is empty"
              body="Orders you move to the trash show up here until you restore or delete them."
              action={{ label: "Back to orders", onPress: () => router.back() }}
            />
          }
          renderItem={({ item }) => {
            const checked = selected.has(item.id);
            const units = item.items.reduce((n, it) => n + (it.quantity || 0), 0);
            const name = item.orderNumber ?? "Order";
            return (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked }}
                accessibilityLabel={`${name}, ${item.customer.name}`}
                onPress={() => toggle(item.id)}
                style={[styles.row, { backgroundColor: t.colors.surface, borderColor: checked ? t.brand.link : t.colors.border }]}
              >
                <Ionicons name={checked ? "checkbox" : "square-outline"} size={22} color={checked ? t.brand.link : t.colors.textMuted} />
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyStrong">{name}</AppText>
                  <AppText variant="caption" color="muted">
                    {`${item.customer.name || "No name"} · ${units} item${units === 1 ? "" : "s"}`}
                  </AppText>
                  <AppText variant="caption" color="faint">
                    {item.deletedAt ? `Trashed ${new Date(item.deletedAt).toLocaleDateString()}` : `Placed ${new Date(item.date).toLocaleDateString()}`}
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Restore ${name}`}
                  hitSlop={8}
                  disabled={busy}
                  onPress={() => restore([item.id])}
                  style={{ opacity: busy ? 0.4 : 1 }}
                >
                  <Ionicons name="arrow-undo-outline" size={22} color={t.brand.link} />
                </Pressable>
              </Pressable>
            );
          }}
        />
      )}
      {orders.length ? (
        <View style={[styles.bar, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <Button
            label={picked.length ? `Restore (${picked.length})` : "Restore all"}
            icon="arrow-undo-outline"
            variant="secondary"
            disabled={busy}
            loading={act.isPending && act.variables?.fn === "restoreStorefrontOrdersAction"}
            onPress={() => restore(targets)}
            style={{ flex: 1 }}
          />
          <Button
            label={picked.length ? `Delete (${picked.length})` : "Empty trash"}
            icon="trash-outline"
            variant="danger"
            disabled={busy}
            loading={act.isPending && act.variables?.fn === "purgeStorefrontOrdersAction"}
            onPress={() => purge(targets)}
            style={{ flex: 1 }}
          />
        </View>
      ) : null}
    </View>
  );
}

const plural = (n: number) => `${n} order${n === 1 ? "" : "s"}`;

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  header: { gap: SPACE.md, marginBottom: SPACE.md },
  check: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 40 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: 1 },
  bar: { flexDirection: "row", gap: SPACE.md, padding: SPACE.lg, borderTopWidth: StyleSheet.hairlineWidth },
});
