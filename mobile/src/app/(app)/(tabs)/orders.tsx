import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OrderFilterKey, OrderPaymentFilter, OrderStatus } from "@contract";
import type { OrderListView } from "@/api/endpoints";
import { useAdminBrand } from "@/features/admin/setup/data";
import { moneyOf } from "@/features/admin/group-buys/model";
import { collectOrderIds, useBulkStatus, useBulkTrash } from "@/features/orders/bulk";
import { FolderList, type FolderPreset } from "@/features/orders/FolderList";
import { allFolders, folderParam, OUTSIDE_FOLDER, useOrderFolders, type FolderKey } from "@/features/orders/folders";
import { OrderCard } from "@/features/orders/OrderCard";
import { RoundHeader } from "@/features/orders/RoundHeader";
import { SelectBar } from "@/features/orders/SelectBar";
import { useOrderList } from "@/features/orders/hooks";
import { STATUS_META, stockEffectCopy } from "@/features/orders/status";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Chips } from "@/ui/kit";
import { AppText } from "@/ui/primitives";

/**
 * The web Orders screen. A group-buy store opens on its folders (the web
 * Orders hub: live round + shortcuts, upcoming, recent, outside, all); a
 * folder — or a store without rounds — shows the list with status tabs and
 * payment chips (each counted under the other's choice, like the website),
 * search, and select mode for bulk status changes and the trash.
 */

// One tab per real order status, plus All. "to-fulfil" stays a valid deep link
// (Home "To ship" tile) though it has no tab of its own.
const FILTER_KEYS: OrderFilterKey[] = [
  "new", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled", "all", "to-fulfil",
];
const PAYMENT_LABEL: Record<OrderPaymentFilter, string> = { all: "All payments", unpaid: "Not confirmed", paid: "Paid" };
const SEARCH_DEBOUNCE_MS = 350;

const EMPTY: Record<OrderFilterKey, { title: string; body: string }> = {
  new: {
    title: "No new orders",
    body: "You're all caught up. New orders will appear here, and on your lock screen if notifications are on.",
  },
  "to-fulfil": { title: "Nothing to fulfil", body: "Confirmed orders waiting to be packed or shipped show up here." },
  confirmed: { title: "No confirmed orders", body: "Orders you've accepted but not started yet show up here." },
  processing: { title: "Nothing processing", body: "Orders being prepared show up here." },
  ready: { title: "Nothing ready to ship", body: "Packed orders waiting for the courier show up here." },
  shipped: { title: "Nothing in transit", body: "Orders you mark as shipped show up here until they're delivered." },
  delivered: { title: "No delivered orders", body: "Orders received by the customer show up here." },
  cancelled: { title: "No cancelled orders", body: "Orders you cancel show up here." },
  all: { title: "No orders yet", body: "When customers order from your website, you'll see them here." },
};

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Please try again.");

export default function Orders() {
  const t = useTheme();
  const params = useLocalSearchParams<{ filter?: string; at?: string }>();
  const folders = useOrderFolders(true);
  const brand = useAdminBrand();
  const currency = typeof brand.data?.currency === "string" && brand.data.currency ? brand.data.currency : "₱";
  const money = useMemo(() => moneyOf(currency), [currency]);
  // A store with no rounds (or a folder load that failed) keeps the plain list —
  // orders must always be reachable; folders only organise them.
  const hasFolders = !!folders.data?.enabled;

  const [folder, setFolder] = useState<FolderKey>(null);
  const [filter, setFilter] = useState<OrderFilterKey>("new");
  const [payment, setPayment] = useState<OrderPaymentFilter>("all");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, SEARCH_DEBOUNCE_MS);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [isSelectingAll, setIsSelectingAll] = useState(false);
  // How many "Select all" picked — the selection is "all" while it still matches.
  const [allCount, setAllCount] = useState<number | null>(null);
  const bulkStatus = useBulkStatus();
  const bulkTrash = useBulkTrash();

  const endSelect = () => {
    setSelecting(false);
    setSelected(new Set());
    setAllCount(null);
  };

  // The bell and the Home tiles deep-link a filter in — over every order.
  // `at` changes on every deep link, so a repeat tap re-applies.
  const linkKey = params.filter && FILTER_KEYS.includes(params.filter as OrderFilterKey) ? `${params.filter}|${params.at ?? ""}` : null;
  const [seenLink, setSeenLink] = useState<string | null>(null);
  if (linkKey && linkKey !== seenLink) {
    setSeenLink(linkKey);
    setFolder("all");
    setFilter(params.filter as OrderFilterKey);
    setPayment("all");
    setSelecting(false);
    setSelected(new Set());
    setAllCount(null);
  }

  const openFolder = (key: FolderKey, preset?: FolderPreset) => {
    endSelect();
    setSearch("");
    setFolder(key);
    setFilter(preset?.status ?? "all");
    setPayment(preset?.payment ?? "all");
  };

  const showFolders = hasFolders && folder === null;
  const view: OrderListView = { payment, folder: hasFolders ? folderParam(folder) : null };
  const list = useOrderList(filter, q, view);
  const orders = useMemo(() => list.data?.pages.flatMap((p) => p.orders) ?? [], [list.data]);
  const first = list.data?.pages[0];
  const byStatus = first?.statusCounts;
  const payCounts = first?.paymentCounts;

  if (showFolders && folders.data) {
    return (
      <View style={{ flex: 1 }}>
        <OfflineBanner />
        <FolderList
          data={folders.data}
          money={money}
          refreshing={folders.isRefetching}
          onRefresh={() => void folders.refetch()}
          onOpen={openFolder}
        />
      </View>
    );
  }
  if (folders.isPending && folder === null) return <SkeletonList />;

  const roundId = folder?.startsWith("round:") ? folder.slice("round:".length) : null;
  const round = roundId && folders.data ? allFolders(folders.data.folders).find((f) => f.id === roundId) : undefined;
  const title = folder === OUTSIDE_FOLDER ? "Outside a group buy" : folder === "all" ? "All orders" : round?.name ?? "Orders";

  const total = byStatus ? Object.values(byStatus).reduce((a, n) => a + (n ?? 0), 0) : undefined;
  const segments: { key: OrderFilterKey; label: string; count?: number }[] = [
    { key: "all", label: "All", count: total },
    ...(["new", "confirmed", "processing", "ready", "shipped", "delivered", "cancelled"] as const).map((s) => ({
      key: s,
      label: STATUS_META[s].label,
      count: byStatus?.[s] ?? (s === "new" ? first?.counts.new : undefined),
    })),
    // Only shown while a "To ship" deep link has it selected.
    ...(filter === "to-fulfil" ? [{ key: "to-fulfil" as const, label: "To fulfil", count: first?.counts.toFulfil }] : []),
  ];
  const payOptions = (["all", "unpaid", "paid"] as const).map((k) => ({ key: k, label: PAYMENT_LABEL[k], count: payCounts?.[k] }));
  const isFiltered = filter !== "all" || payment !== "all";
  const isWorking = bulkStatus.isPending || bulkTrash.isPending;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const allSelected = allCount !== null && selected.size > 0 && selected.size === allCount;

  async function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
      setAllCount(null);
      return;
    }
    setIsSelectingAll(true);
    try {
      // Every order in this view — including pages not scrolled to yet.
      const ids = await collectOrderIds(filter, q, view);
      setSelected(new Set(ids));
      setAllCount(ids.length);
    } catch (e) {
      Alert.alert("Couldn't select every order", errText(e));
    } finally {
      setIsSelectingAll(false);
    }
  }

  function changeStatus(status: OrderStatus) {
    const ids = [...selected];
    if (!ids.length) return;
    const effect =
      status === "confirmed"
        ? `Confirming a new order: ${stockEffectCopy("deduct")}`
        : status === "cancelled"
          ? `Cancelling a confirmed order: ${stockEffectCopy("restock")}`
          : null;
    Alert.alert(
      `Change ${ids.length.toLocaleString()} order${ids.length === 1 ? "" : "s"} to "${STATUS_META[status].label}"?`,
      [effect, "Orders already at this status are skipped."].filter(Boolean).join("\n\n"),
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Change",
          onPress: () =>
            bulkStatus.mutate(
              { ids, status },
              {
                onSuccess: (changed) => {
                  endSelect();
                  Alert.alert("Status changed", `${changed.toLocaleString()} order${changed === 1 ? "" : "s"} moved to ${STATUS_META[status].label}.`);
                },
                onError: (e) => Alert.alert("Couldn't change the status", errText(e)),
              },
            ),
        },
      ],
    );
  }

  function trash(ids: string[], question: string) {
    if (!ids.length) return;
    Alert.alert(question, "They leave every list, count and report. Stock isn't changed, and you can restore them from Trash.", [
      { text: "Keep orders", style: "cancel" },
      {
        text: "Move to trash",
        style: "destructive",
        onPress: () =>
          bulkTrash.mutate(ids, {
            onSuccess: endSelect,
            onError: (e) => Alert.alert("Couldn't move them to the trash", errText(e)),
          }),
      },
    ]);
  }

  async function trashAll() {
    setIsSelectingAll(true);
    try {
      // Like the website: every order in this folder, whatever tab or chip is on.
      const ids = await collectOrderIds("all", "", { folder: view.folder });
      if (!ids.length) {
        Alert.alert("Nothing to move", "There are no orders in this list.");
        return;
      }
      trash(ids, `Move ALL ${ids.length.toLocaleString()} orders${folder && folder !== "all" ? ` in ${title}` : ""} to the trash?`);
    } catch (e) {
      Alert.alert("Couldn't load the orders", errText(e));
    } finally {
      setIsSelectingAll(false);
    }
  }

  const header = (
    <View style={styles.controls}>
      {hasFolders ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to group buys"
          hitSlop={8}
          onPress={() => openFolder(null)}
          style={styles.back}
        >
          <Ionicons name="chevron-back" size={18} color={t.brand.link} />
          <AppText variant="label" color="link">Group buys</AppText>
          <AppText variant="bodyStrong" numberOfLines={1} style={styles.title}>{title}</AppText>
        </Pressable>
      ) : null}
      <View style={styles.searchRow}>
        <View style={[styles.search, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <Ionicons name="search" size={18} color={t.colors.textFaint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Order #, customer, email or phone"
            placeholderTextColor={t.colors.textFaint}
            accessibilityLabel="Search orders"
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            // iOS draws its own clear button; Android gets ours below.
            clearButtonMode="while-editing"
            style={[t.type.body, styles.searchInput, { color: t.colors.text }]}
          />
          {search && Platform.OS === "android" ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} hitSlop={8}>
              <Ionicons name="close-circle" size={18} color={t.colors.textFaint} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={selecting ? "Done selecting" : "Select orders"}
          accessibilityState={{ selected: selecting }}
          hitSlop={8}
          onPress={() => (selecting ? endSelect() : setSelecting(true))}
          style={[styles.iconBtn, { backgroundColor: selecting ? t.colors.text : t.colors.surface, borderColor: t.colors.border }]}
        >
          <Ionicons name={selecting ? "close" : "checkbox-outline"} size={20} color={selecting ? t.colors.bg : t.colors.textMuted} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Trash: restore or permanently delete orders"
          hitSlop={8}
          onPress={() => router.push("/manage/order-trash")}
          style={[styles.iconBtn, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
        >
          <Ionicons name="trash-outline" size={20} color={t.colors.textMuted} />
        </Pressable>
      </View>
      <Chips options={segments} value={filter} onChange={(k) => { setFilter(k); setSelected(new Set()); }} label="Order status" />
      <View style={styles.payRow}>
        <View style={{ flex: 1 }}>
          <Chips options={payOptions} value={payment} onChange={(k) => { setPayment(k); setSelected(new Set()); }} label="Payment" />
        </View>
        {isFiltered ? (
          <Pressable
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => {
              setFilter("all");
              setPayment("all");
              setSelected(new Set());
            }}
          >
            <AppText variant="label" color="link">Clear filters</AppText>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  const roundHeader = round ? (
    <View style={{ marginBottom: SPACE.md }}>
      <RoundHeader
        key={round.id}
        f={round}
        groupBuy={folders.data?.groupBuys.find((g) => g.id === round.id)}
        canReport={!!folders.data?.canReport}
        currency={currency}
        money={money}
      />
    </View>
  ) : null;

  const statusLabel = segments.find((s) => s.key === filter)?.label ?? "All";
  const empty = q ? (
    <EmptyState icon="search" title="No matching orders" body={`Nothing found for “${q}” in ${statusLabel}.`} />
  ) : payment !== "all" ? (
    <EmptyState
      icon={payment === "unpaid" ? "checkmark-done-circle-outline" : "wallet-outline"}
      title={payment === "unpaid" ? "All caught up" : "No paid orders here"}
      body={payment === "unpaid" ? "No payments waiting to be confirmed here." : "Orders marked paid show up here."}
      action={{ label: "Clear filters", onPress: () => { setFilter("all"); setPayment("all"); } }}
    />
  ) : (
    <EmptyState icon={filter === "new" ? "checkmark-done-circle-outline" : "receipt-outline"} {...EMPTY[filter]} />
  );

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      {header}
      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          extraData={selecting ? selected : null}
          ListHeaderComponent={roundHeader}
          renderItem={({ item }) =>
            selecting ? (
              <View style={styles.selectRow}>
                <Ionicons
                  name={selected.has(item.id) ? "checkbox" : "square-outline"}
                  size={24}
                  color={selected.has(item.id) ? t.brand.link : t.colors.textFaint}
                  accessibilityElementsHidden
                  importantForAccessibility="no"
                />
                <View style={{ flex: 1 }}>
                  <OrderCard order={item} onPress={() => toggle(item.id)} />
                </View>
              </View>
            ) : (
              <OrderCard order={item} onPress={() => router.push({ pathname: "/order/[id]", params: { id: item.id } })} />
            )
          }
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl
              refreshing={list.isRefetching && !list.isFetchingNextPage}
              onRefresh={() => {
                void list.refetch();
                if (hasFolders) void folders.refetch();
              }}
              tintColor={t.brand.link}
            />
          }
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ margin: SPACE.lg }} color={t.brand.link} /> : null}
          ListEmptyComponent={empty}
        />
      )}
      {selecting ? (
        <SelectBar
          selected={selected.size}
          allSelected={allSelected}
          isSelectingAll={isSelectingAll}
          isWorking={isWorking}
          onToggleAll={() => void toggleAll()}
          onChangeStatus={changeStatus}
          onTrashSelected={() => trash([...selected], `Move ${selected.size.toLocaleString()} order${selected.size === 1 ? "" : "s"} to the trash?`)}
          onTrashAll={() => void trashAll()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.md, gap: SPACE.md },
  back: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
  title: { flex: 1, marginLeft: SPACE.sm, textAlign: "right" },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    minHeight: TOUCH,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.md,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  iconBtn: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: { flex: 1, paddingVertical: SPACE.sm },
  payRow: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  selectRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  list: { padding: SPACE.lg, paddingTop: 0, paddingBottom: SPACE.xxxl, flexGrow: 1 },
});
