import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, FlatList, Platform, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OrderFilterKey } from "@contract";
import { OrderCard } from "@/features/orders/OrderCard";
import { useOrderList } from "@/features/orders/hooks";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Segmented } from "@/ui/inputs";

const FILTER_KEYS: OrderFilterKey[] = ["new", "to-fulfil", "shipped", "all"];
const SEARCH_DEBOUNCE_MS = 350;

const EMPTY: Record<OrderFilterKey, { title: string; body: string }> = {
  new: {
    title: "No new orders",
    body: "You're all caught up. New orders will appear here — and on your lock screen if notifications are on.",
  },
  "to-fulfil": {
    title: "Nothing to fulfil",
    body: "Confirmed orders waiting to be packed or shipped show up here.",
  },
  shipped: {
    title: "Nothing shipped yet",
    body: "Orders you mark as shipped or delivered show up here.",
  },
  all: {
    title: "No orders yet",
    body: "When customers order from your website, you'll see them here.",
  },
};

function useDebounced(value: string, ms: number): string {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default function Orders() {
  const t = useTheme();
  const params = useLocalSearchParams<{ filter?: string; at?: string }>();
  const [filter, setFilter] = useState<OrderFilterKey>("new");
  const [search, setSearch] = useState("");
  const q = useDebounced(search, SEARCH_DEBOUNCE_MS);

  // The bell and the Home tiles deep-link a filter in.
  useEffect(() => {
    if (params.filter && FILTER_KEYS.includes(params.filter as OrderFilterKey)) setFilter(params.filter as OrderFilterKey);
  }, [params.filter, params.at]); // `at` changes on every deep link, so a repeat tap re-applies

  const list = useOrderList(filter, q);
  const orders = useMemo(() => list.data?.pages.flatMap((p) => p.orders) ?? [], [list.data]);
  const counts = list.data?.pages[0]?.counts;

  const segments = [
    { key: "new" as const, label: "New", count: counts?.new },
    { key: "to-fulfil" as const, label: "To fulfil", count: counts?.toFulfil },
    { key: "shipped" as const, label: "Shipped" },
    { key: "all" as const, label: "All" },
  ];

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={styles.controls}>
        <View style={styles.searchRow}>
          <View
            style={[
              styles.search,
              {
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
              },
            ]}
          >
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
            accessibilityLabel="Trash — restore or permanently delete orders"
            hitSlop={8}
            onPress={() => router.push("/manage/order-trash")}
            style={[
              styles.trash,
              {
                backgroundColor: t.colors.surface,
                borderColor: t.colors.border,
              },
            ]}
          >
            <Ionicons name="trash-outline" size={20} color={t.colors.textMuted} />
          </Pressable>
        </View>
        <Segmented segments={segments} value={filter} onChange={setFilter} />
      </View>

      {list.isPending ? (
        <SkeletonList />
      ) : list.isError ? (
        <ErrorState message={list.error.message} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(o) => o.id}
          renderItem={({ item }) => (
            <OrderCard
              order={item}
              onPress={() =>
                router.push({
                  pathname: "/order/[id]",
                  params: { id: item.id },
                })
              }
            />
          )}
          contentContainerStyle={styles.list}
          ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => {
            if (list.hasNextPage && !list.isFetchingNextPage) void list.fetchNextPage();
          }}
          refreshControl={
            <RefreshControl refreshing={list.isRefetching && !list.isFetchingNextPage} onRefresh={() => void list.refetch()} tintColor={t.brand.link} />
          }
          ListFooterComponent={list.isFetchingNextPage ? <ActivityIndicator style={{ margin: SPACE.lg }} color={t.brand.link} /> : null}
          ListEmptyComponent={
            q ? (
              <EmptyState icon="search" title="No matching orders" body={`Nothing found for “${q}” in ${segments.find((s) => s.key === filter)?.label}.`} />
            ) : (
              <EmptyState icon={filter === "new" ? "checkmark-done-circle-outline" : "receipt-outline"} {...EMPTY[filter]} />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: {
    paddingHorizontal: SPACE.lg,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.md,
    gap: SPACE.md,
  },
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
  trash: {
    width: TOUCH,
    height: TOUCH,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  searchInput: { flex: 1, paddingVertical: SPACE.sm },
  list: {
    padding: SPACE.lg,
    paddingTop: 0,
    paddingBottom: SPACE.xxxl,
    flexGrow: 1,
  },
});
