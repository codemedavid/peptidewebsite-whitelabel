import { useMemo, useRef, useState } from "react";
import { Alert, FlatList, StyleSheet, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { Image } from "expo-image";
import { useQueryClient } from "@tanstack/react-query";
import { useSignedIn } from "@/auth/SessionProvider";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { IconButton } from "@/features/admin/catalog/components";
import { catalogKeys, useAdminBrand, useCatalogProducts } from "@/features/admin/catalog/hooks";
import { brandCategories, type CatalogProduct } from "@/features/admin/catalog/model";
import { categoryOrderOf, categoryProducts, moveId, OTHER_SECTION_ID, OTHER_SECTION_LABEL } from "@/features/admin/catalog/category-arrange";
import { shopKeys } from "@/features/shop/api";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText } from "@/ui/primitives";

/**
 * The website's Categories → "Arrange products" (category sections): the order
 * of products INSIDE one category on the shop's sectioned catalog. Every ↑/↓
 * saves (saveCategoryProductOrderAction), one after another, so fast taps
 * land in order; a failed save falls back to the server's re-read order.
 */
export default function CategoryArrangeScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const brandQ = useAdminBrand();
  const productsQ = useCatalogProducts(brandQ.data);
  const label =
    id === OTHER_SECTION_ID ? OTHER_SECTION_LABEL : brandQ.data ? brandCategories(brandQ.data).find((c) => c.id === id)?.label : undefined;
  const title = <Stack.Screen options={{ title: label ? `Arrange “${label}”` : "Arrange products" }} />;

  if (brandQ.isPending || productsQ.isPending) return <>{title}<SkeletonList rows={5} /></>;
  if (brandQ.isError || productsQ.isError || !brandQ.data || !productsQ.data) {
    const err = brandQ.error ?? productsQ.error;
    return (
      <>
        {title}
        <ErrorState message={err?.message ?? "Something went wrong."} onRetry={() => void (brandQ.isError ? brandQ.refetch() : productsQ.refetch())} />
      </>
    );
  }
  return (
    <>
      {title}
      <Arranger key={id} categoryId={id ?? ""} brand={brandQ.data} products={productsQ.data} />
    </>
  );
}

function Arranger({ categoryId, brand, products }: { categoryId: string; brand: AdminBrand; products: CatalogProduct[] }) {
  const t = useTheme();
  const online = useOnline();
  const qc = useQueryClient();
  const { scope } = useSignedIn();
  const chain = useRef<Promise<void>>(Promise.resolve());
  // The server's order (recomputed whenever the brand re-reads)…
  const serverIds = useMemo(
    () => categoryProducts(products, brandCategories(brand), categoryOrderOf(brand), categoryId).map((p) => p.id),
    [products, brand, categoryId],
  );
  // …and this phone's optimistic one while moves are saving.
  const [local, setLocal] = useState<string[] | null>(null);
  const ids = local ?? serverIds;
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = ids.map((x) => byId.get(x)).filter((p): p is CatalogProduct => !!p);

  function move(id: string, delta: number) {
    if (!online) {
      Alert.alert("You're offline", "Reconnect to arrange. Nothing was changed.");
      return;
    }
    const next = moveId(ids, id, delta);
    setLocal(next);
    chain.current = chain.current
      .then(async () => {
        unwrap(await adminBridge.call<{ ok: true; order: string[] } | { error: string }>("saveCategoryProductOrderAction", categoryId, next));
        void qc.invalidateQueries({ queryKey: catalogKeys.brand(scope) });
        void qc.invalidateQueries({ queryKey: shopKeys.all(scope) });
      })
      .catch((e: unknown) => {
        setLocal(null);
        void qc.invalidateQueries({ queryKey: catalogKeys.admin(scope) });
        Alert.alert("Couldn't save the order", e instanceof Error ? e.message : "Please try again.");
      });
  }

  if (rows.length === 0) {
    return <EmptyState icon="folder-open-outline" title="No products here yet" body="Products filed under this category show up here to arrange." />;
  }

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <FlatList
        data={rows}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.page}
        ListHeaderComponent={
          <AppText variant="body" color="muted" style={{ marginBottom: SPACE.md }}>
            The order these products show in this category&apos;s section of your shop. Changes save as you go.
          </AppText>
        }
        renderItem={({ item, index }) => (
          <View
            style={[
              styles.row,
              { backgroundColor: t.colors.surface, borderColor: t.colors.border },
              index === 0 ? styles.first : null,
              index === rows.length - 1 ? styles.last : null,
            ]}
          >
            <AppText variant="label" color="faint" style={styles.num}>{index + 1}</AppText>
            {item.image ? (
              <Image source={{ uri: item.image }} style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt }]} contentFit="cover" />
            ) : (
              <View style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt }]} />
            )}
            <View style={{ flex: 1, gap: 2 }}>
              <AppText variant="bodyStrong" numberOfLines={2}>{item.name}</AppText>
              {item.available === false ? <AppText variant="caption" color="muted">Hidden</AppText> : null}
            </View>
            <IconButton icon="arrow-up-circle-outline" label={`Move ${item.name} to the top`} disabled={index === 0} onPress={() => move(item.id, -index)} />
            <IconButton icon="chevron-up" label={`Move ${item.name} up`} disabled={index === 0} onPress={() => move(item.id, -1)} />
            <IconButton icon="chevron-down" label={`Move ${item.name} down`} disabled={index === rows.length - 1} onPress={() => move(item.id, 1)} />
            <IconButton
              icon="arrow-down-circle-outline"
              label={`Move ${item.name} to the bottom`}
              disabled={index === rows.length - 1}
              onPress={() => move(item.id, rows.length - 1 - index)}
            />
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, paddingBottom: SPACE.xxxl },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderWidth: StyleSheet.hairlineWidth, marginTop: -StyleSheet.hairlineWidth },
  first: { borderTopLeftRadius: RADIUS.lg, borderTopRightRadius: RADIUS.lg },
  last: { borderBottomLeftRadius: RADIUS.lg, borderBottomRightRadius: RADIUS.lg },
  thumb: { width: 40, height: 40, borderRadius: RADIUS.sm },
  num: { width: 24, textAlign: "right", fontVariant: ["tabular-nums"] },
});
