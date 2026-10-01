import { useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import type { ProductRow } from "@contract";
import { useProductArrangement } from "@/features/admin/catalog/arrange";
import { useDeleteProduct } from "@/features/admin/catalog/delete";
import { ProductItem, productEditRoute } from "@/features/products/ProductItem";
import { useProducts } from "@/features/products/hooks";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Button } from "@/ui/primitives";

export default function Products() {
  const t = useTheme();
  const online = useOnline();
  const q = useProducts();
  const arrange = useProductArrangement();
  const del = useDeleteProduct();
  const [search, setSearch] = useState("");
  const searching = search.trim().length > 0;

  // The shop's own order (the one ↑/↓ edits); products it doesn't know yet go last, A–Z.
  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const at = (p: ProductRow) => arrange.rank.get(p.id) ?? Number.POSITIVE_INFINITY;
    return (q.data?.products ?? [])
      .filter((p) => !needle || p.name.toLowerCase().includes(needle))
      .sort((a, b) => at(a) - at(b) || a.name.localeCompare(b.name));
  }, [q.data, search, arrange.rank]);
  // Arrows only over the full list — moving past hidden rows would look like nothing happened.
  const arrows = arrange.ready && !searching && rows.length > 1;

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <View style={styles.controls}>
        <View style={[styles.search, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <Ionicons name="search" size={18} color={t.colors.textFaint} />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search products"
            placeholderTextColor={t.colors.textFaint}
            accessibilityLabel="Search products"
            autoCorrect={false}
            clearButtonMode="while-editing"
            style={[t.type.body, { flex: 1, color: t.colors.text, paddingVertical: SPACE.sm }]}
          />
        </View>
        <Button label="Add product" icon="add" disabled={!online} onPress={() => router.push(productEditRoute())} />
      </View>
      {q.isPending ? (
        <SkeletonList />
      ) : q.isError ? (
        <ErrorState message={q.error.message} onRetry={() => void q.refetch()} />
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(p) => p.id}
          renderItem={({ item, index }) => (
            <ProductItem
              product={item}
              disabled={!online || del.isDeleting}
              onLongPress={() => del.confirmDelete(item.id, item.name)}
              order={arrows ? { isFirst: index === 0, isLast: index === rows.length - 1, onMove: (d) => arrange.move(item.id, d) } : undefined}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
          ListEmptyComponent={
            search ? (
              <EmptyState icon="search" title="No matching products" body={`Nothing called “${search}”.`} />
            ) : (
              <EmptyState
                icon="pricetags-outline"
                title="No products yet"
                body="Add your first product and it shows in your shop."
                action={online ? { label: "Add product", onPress: () => router.push(productEditRoute()) } : undefined}
              />
            )
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  controls: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.md, gap: SPACE.sm },
  search: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: TOUCH, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SPACE.md },
  list: { padding: SPACE.lg, paddingTop: 0, paddingBottom: SPACE.xxxl, flexGrow: 1 },
});
