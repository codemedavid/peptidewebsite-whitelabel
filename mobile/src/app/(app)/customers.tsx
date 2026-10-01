import { useEffect, useState } from "react";
import { FlatList, Platform, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import type { CustomerSort } from "@contract";
import { customersApi, qk, type CustomerFilterKey } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { useAdminBrand } from "@/features/admin/setup/data";
import { CustomerRowItem } from "@/features/customers/CustomerRowItem";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Chips, StatTile } from "@/ui/kit";

const SEARCH_DEBOUNCE_MS = 300;

const SEGMENTS: ReadonlyArray<{ key: CustomerFilterKey; label: string }> = [
  { key: "all", label: "All" },
  { key: "loyal", label: "Loyal" },
  { key: "returning", label: "Returning" },
  { key: "new", label: "New" },
  { key: "lapsed", label: "Inactive" },
];
const SORTS: ReadonlyArray<{ key: CustomerSort; label: string }> = [
  { key: "spent", label: "Top spenders" },
  { key: "recent", label: "Most recent" },
  { key: "orders", label: "Most orders" },
];

export default function Customers() {
  const t = useTheme();
  const { scope } = useSignedIn();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState<CustomerFilterKey>("all");
  const [sort, setSort] = useState<CustomerSort>("spent");

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [search]);

  const list = useQuery({
    queryKey: qk.customers(scope, q, sort, segment),
    queryFn: () => customersApi.list(q, sort, segment),
    placeholderData: (prev) => prev,
  });
  const s = list.data?.summary;
  // Shoppers with an account (disable / re-enable) — only when the store has the feature.
  const hasAccounts = useAdminBrand().data?.customerAccountsEnabled === true;

  const header = (
    <View style={{ gap: SPACE.md, paddingBottom: SPACE.md }}>
      {s ? (
        <View style={styles.grid}>
          <StatTile icon="people-outline" label="Customers" value={String(s.total)} />
          <StatTile icon="repeat-outline" label="Come back" value={`${Math.round(s.returningRate * 100)}%`} />
          <StatTile icon="sparkles-outline" label="New this month" value={String(s.newThisMonth)} />
          <StatTile icon="moon-outline" label="Inactive 60d+" value={String(s.lapsed)} onPress={() => setSegment("lapsed")} />
        </View>
      ) : null}
      <View style={[styles.search, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Ionicons name="search" size={18} color={t.colors.textFaint} />
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Name, email or phone"
          placeholderTextColor={t.colors.textFaint}
          accessibilityLabel="Search customers"
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[t.type.body, styles.searchInput, { color: t.colors.text }]}
        />
        {search && Platform.OS === "android" ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} hitSlop={8}>
            <Ionicons name="close-circle" size={18} color={t.colors.textFaint} />
          </Pressable>
        ) : null}
      </View>
      <Chips options={SEGMENTS} value={segment} onChange={setSegment} label="Customer group" />
      <Chips options={SORTS} value={sort} onChange={setSort} label="Sort customers" />
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: hasAccounts
            ? () => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Customer accounts — disable or re-enable sign-ins"
                  hitSlop={10}
                  onPress={() => router.push("/manage/customer-accounts")}
                >
                  <Ionicons name="person-circle-outline" size={24} color={t.brand.headerText} />
                </Pressable>
              )
            : undefined,
        }}
      />
      <OfflineBanner />
      {list.isPending ? (
        <SkeletonList rows={6} />
      ) : list.isError || !list.data ? (
        <ErrorState message={list.error?.message ?? "Couldn't load customers."} onRetry={() => void list.refetch()} />
      ) : (
        <FlatList
          data={list.data.customers}
          keyExtractor={(c) => c.key}
          ListHeaderComponent={header}
          contentContainerStyle={styles.page}
          ItemSeparatorComponent={() => <View style={{ height: SPACE.sm }} />}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand.link} />}
          renderItem={({ item }) => (
            <CustomerRowItem c={item} onPress={() => router.push({ pathname: "/customer/[key]", params: { key: item.key } })} />
          )}
          ListEmptyComponent={
            <EmptyState
              icon="people-outline"
              title={q || segment !== "all" ? "No matching customers" : "No customers yet"}
              body={q || segment !== "all" ? "Try another search or group." : "Everyone who orders from your store shows up here."}
            />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, paddingBottom: SPACE.xxxl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  search: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    minHeight: 48,
    paddingHorizontal: SPACE.md,
    borderRadius: RADIUS.md,
    borderWidth: 1,
  },
  searchInput: { flex: 1, paddingVertical: SPACE.sm },
});
