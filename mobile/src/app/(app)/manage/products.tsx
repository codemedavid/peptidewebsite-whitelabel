import { memo, useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, TextInput, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { IconButton, successTap } from "@/features/admin/catalog/components";
import { formatMoney } from "@/features/admin/catalog/currency";
import { useProductArrangement } from "@/features/admin/catalog/arrange";
import { useAdminBrand, useCatalogProducts, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import { ALL_CATEGORY_ID, brandCategories, brandSymbol, type CatalogProduct } from "@/features/admin/catalog/model";
import { OrderArrows, type RowOrder } from "@/features/products/ProductItem";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { Chips } from "@/ui/kit";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText, Button, Pill } from "@/ui/primitives";

/**
 * Manage Products — the website admin's Products table (AdminProductsList):
 * every product, tap to edit, add, delete one or many. Deletes go to the
 * server first and the list only drops what the server actually deleted (a
 * product linked to an order is refused, with the website's own message).
 *
 * Each row's ↑/↓ is the website's arrangement (useProductArrangement →
 * saveProductOrderAction), so the shop's default view follows the same order
 * on the website and in the app.
 */

const editRoute = (id?: string): Href =>
  (id ? `/manage/product-edit?id=${encodeURIComponent(id)}` : "/manage/product-edit") as Href;

export default function ManageProducts() {
  const t = useTheme();
  const online = useOnline();
  const brandQ = useAdminBrand();
  const brand = brandQ.data;
  const q = useCatalogProducts(brand);
  const refresh = useCatalogRefresh();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL_CATEGORY_ID);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const arrange = useProductArrangement();

  const symbol = brand ? brandSymbol(brand) : "₱";
  const categories = useMemo(() => (brand ? brandCategories(brand) : []), [brand]);
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label || id;

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (q.data ?? []).filter(
      (p) =>
        (category === ALL_CATEGORY_ID || p.category === category) &&
        (!needle || p.name.toLowerCase().includes(needle) || p.description.toLowerCase().includes(needle)),
    );
  }, [q.data, search, category]);

  // Arrows only over the full list — moving past hidden rows would look like nothing happened.
  const arrows = !selecting && !search.trim() && category === ALL_CATEGORY_ID && rows.length > 1;

  const del = useMutation({
    mutationFn: async (ids: string[]) => unwrap(await adminBridge.call<{ ok: true } | { error: string }>("deleteProductsAction", ids, symbol)),
    onSuccess: (_r, ids) => {
      successTap();
      setSelected((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
      if (ids.length > 1) setSelecting(false);
      refresh();
    },
    onError: (e) => Alert.alert("Couldn't delete", e.message),
  });

  function confirmDelete(ids: string[]) {
    if (!ids.length || del.isPending) return;
    if (!online) {
      Alert.alert("You're offline", "Reconnect to delete. Nothing was changed.");
      return;
    }
    const one = ids.length === 1 ? q.data?.find((p) => p.id === ids[0]) : undefined;
    Alert.alert(one ? `Delete “${one.name}”?` : `Delete ${ids.length} products?`, "This removes it from your shop. It can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => del.mutate(ids) },
    ]);
  }

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allShownSelected = rows.length > 0 && rows.every((p) => selected.has(p.id));
  const toggleAll = () => setSelected(allShownSelected ? new Set() : new Set(rows.map((p) => p.id)));

  const chipOptions = [{ key: ALL_CATEGORY_ID, label: "All" }, ...categories.filter((c) => c.id !== ALL_CATEGORY_ID).map((c) => ({ key: c.id, label: c.label }))];

  const header = (
    <Stack.Screen
      options={{
        title: "Manage Products",
        headerRight: () =>
          q.data?.length ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={selecting ? "Done selecting" : "Select products"}
              hitSlop={10}
              onPress={() => {
                setSelecting((s) => !s);
                setSelected(new Set());
              }}
            >
              <AppText variant="bodyStrong" color={t.brand.headerText}>
                {selecting ? "Done" : "Select"}
              </AppText>
            </Pressable>
          ) : null,
      }}
    />
  );

  if (brandQ.isPending || (brand && q.isPending)) return <>{header}<SkeletonList /></>;
  if (brandQ.isError || q.isError) {
    const err = brandQ.error ?? q.error;
    return (
      <>
        {header}
        <ErrorState message={err?.message ?? "Something went wrong."} onRetry={() => void (brandQ.isError ? brandQ.refetch() : q.refetch())} />
      </>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      {header}
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
        {chipOptions.length > 2 ? <Chips label="Filter by category" options={chipOptions} value={category} onChange={setCategory} /> : null}
        {selecting ? (
          <View style={styles.bulk}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: allShownSelected }} onPress={toggleAll} style={styles.selectAll} hitSlop={6}>
              <Ionicons name={allShownSelected ? "checkbox" : "square-outline"} size={22} color={allShownSelected ? t.brand.link : t.colors.textMuted} />
              <AppText variant="label">{`Select all (${rows.length})`}</AppText>
            </Pressable>
            <Button
              label={selected.size ? `Delete (${selected.size})` : "Delete"}
              variant="danger"
              icon="trash-outline"
              disabled={!selected.size || !online}
              loading={del.isPending}
              onPress={() => confirmDelete([...selected])}
              style={styles.bulkDelete}
            />
          </View>
        ) : (
          <View style={styles.bulk}>
            <Button label="Add product" icon="add" disabled={!online} onPress={() => router.push(editRoute())} style={{ flex: 1 }} />
            {arrange.count > 1 ? (
              <Button
                label="Reset to A–Z"
                variant="secondary"
                icon="text-outline"
                disabled={!online}
                accessibilityHint="Put the shop back in alphabetical order"
                onPress={arrange.confirmReset}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        )}
        {arrows ? (
          <AppText variant="caption" color="muted">
            {"Use ↑ and ↓ beside a product to set the order customers see on your shop."}
          </AppText>
        ) : null}
      </View>
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        renderItem={({ item, index }) => (
          <ProductRowItem
            product={item}
            categoryLabel={catLabel(item.category)}
            price={formatMoney(item.price || 0, symbol, { decimals: false })}
            selecting={selecting}
            selected={selected.has(item.id)}
            busy={del.isPending}
            onPress={() => (selecting ? toggle(item.id) : router.push(editRoute(item.id)))}
            onDelete={() => confirmDelete([item.id])}
            onLongPress={selecting ? undefined : () => confirmDelete([item.id])}
            order={arrows ? { isFirst: index === 0, isLast: index === rows.length - 1, onMove: (d) => arrange.move(item.id, d) } : undefined}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
        ListEmptyComponent={
          search || category !== ALL_CATEGORY_ID ? (
            <EmptyState icon="search" title="No matching products" body="Try another search or category." />
          ) : (
            <EmptyState
              icon="pricetags-outline"
              title="No products yet"
              body="Add your first product and it goes live on your shop."
              action={online ? { label: "Add product", onPress: () => router.push(editRoute()) } : undefined}
            />
          )
        }
      />
    </View>
  );
}

const ProductRowItem = memo(function ProductRowItem({
  product: p,
  categoryLabel,
  price,
  selecting,
  selected,
  busy,
  onPress,
  onDelete,
  onLongPress,
  order,
}: {
  product: CatalogProduct;
  categoryLabel: string;
  price: string;
  selecting: boolean;
  selected: boolean;
  busy: boolean;
  onPress: () => void;
  onDelete: () => void;
  onLongPress?: () => void;
  order?: RowOrder;
}) {
  const t = useTheme();
  const available = p.available !== false;
  const sizes = p.variations?.length ? p.variations.map((v) => v.name).join(", ") : p.sizes || "No sizes";
  const facts = [categoryLabel, `Stock ${p.stock ?? 0}`].filter(Boolean).join(" · ");
  return (
    <Pressable
      accessibilityRole={selecting ? "checkbox" : "button"}
      accessibilityState={selecting ? { checked: selected } : undefined}
      accessibilityLabel={`${p.name}, ${price}, ${available ? "available" : "hidden"}`}
      accessibilityHint={selecting ? undefined : "Edit this product"}
      onPress={onPress}
      onLongPress={busy ? undefined : onLongPress}
      delayLongPress={450}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: selected ? t.brand.link : t.colors.border },
      ]}
    >
      {selecting ? (
        <Ionicons name={selected ? "checkbox" : "square-outline"} size={24} color={selected ? t.brand.link : t.colors.textMuted} />
      ) : null}
      {p.image ? (
        <Image source={{ uri: p.image }} style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt }]} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <View style={[styles.thumb, styles.thumbEmpty, { backgroundColor: t.colors.surfaceAlt }]}>
          <Ionicons name="image-outline" size={22} color={t.colors.textFaint} />
        </View>
      )}
      <View style={{ flex: 1, gap: 3 }}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {p.name}
        </AppText>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {facts}
        </AppText>
        <AppText variant="caption" color="faint" numberOfLines={1}>
          {sizes}
        </AppText>
        <View style={styles.pills}>
          <AppText variant="label" style={{ fontVariant: ["tabular-nums"] }}>
            {price}
          </AppText>
          {p.featured ? <Pill size="sm" tone="info" icon="star" label="Featured" /> : null}
          <Pill size="sm" tone={available ? "success" : "neutral"} icon={available ? "checkmark-circle-outline" : "eye-off-outline"} label={available ? "Available" : "Hidden"} />
        </View>
      </View>
      {order ? <OrderArrows name={p.name} order={order} disabled={busy} /> : null}
      {selecting ? null : <IconButton icon="trash-outline" label={`Delete ${p.name}`} tone="danger" disabled={busy} onPress={onDelete} />}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  controls: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.sm, paddingBottom: SPACE.md, gap: SPACE.md },
  search: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: TOUCH, borderRadius: RADIUS.md, borderWidth: 1, paddingHorizontal: SPACE.md },
  bulk: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  selectAll: { flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: TOUCH },
  bulkDelete: { paddingHorizontal: SPACE.lg },
  list: { padding: SPACE.lg, paddingTop: 0, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: 1 },
  thumb: { width: 64, height: 64, borderRadius: RADIUS.md },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  pills: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: SPACE.sm, marginTop: 2 },
});
