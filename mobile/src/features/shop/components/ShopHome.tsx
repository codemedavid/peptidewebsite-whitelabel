import { useCallback, useMemo, useState, type ReactNode } from "react";
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, TextInput, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopCatalog, ShopProduct } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, OfflineBanner } from "@/ui/feedback";
import { AppText } from "@/ui/primitives";
import { useCatalog } from "../hooks";
import { categoryChips, filterProducts } from "../lib/catalog";
import { cartCount } from "../lib/cart";
import { useShop } from "../ShopProvider";
import { ProductCard } from "./ProductCard";
import { GridSkeleton } from "./GridSkeleton";
import { CartButton, ProductImage } from "./ShopUI";
import { CatalogError, ClosedBanner, goToSignIn } from "./ShopStates";
import { GroupBuyBanner } from "./group-buy/GroupBuyBanner";
import { GroupBuyJoinBanner } from "./group-buy/JoinBanner";

const GAP = SPACE.md;
const GUTTER = SPACE.lg;

/**
 * The shop's front page: store header, search, category chips and a
 * two-column product grid. Shared by the signed-in Shop tab and the guest shop.
 * `asTab` + `headerRight`: the store team's preview shown as a tab (no
 * navigation header above it), e.g. the community view's Store tab.
 */
export function ShopHome({ asTab = false, headerRight }: { asTab?: boolean; headerRight?: ReactNode } = {}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const shop = useShop();
  const q = useCatalog();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const catalog = q.data;
  const tile = Math.floor((width - GUTTER * 2 - GAP) / 2);

  const products = useMemo(
    () => (catalog ? filterProducts(catalog.products, search, category) : []),
    [catalog, search, category],
  );
  const open = useCallback((id: string) => router.push(shop.paths.product(id)), [shop.paths]);
  const count = cartCount(shop.lines);
  // The store team's preview sits under a navigation header and has no cart.
  const preview = shop.mode === "preview";

  const header = (
    <StoreBar
      name={catalog?.store.name ?? t.brand.name}
      logoUrl={catalog?.store.logoUrl ?? t.brand.logoUrl}
      topInset={preview && !asTab ? SPACE.sm : insets.top}
      count={count}
      guest={shop.mode === "guest"}
      onCart={preview ? null : () => router.push(shop.paths.cart)}
      right={headerRight}
    />
  );

  if (q.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {header}
        <GridSkeleton tile={tile} />
      </View>
    );
  }
  if (q.isError || !catalog) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {header}
        <CatalogError error={q.error ?? new Error("Couldn't load the shop.")} storeName={t.brand.name} onRetry={() => void q.refetch()} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {header}
      <OfflineBanner />
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP }}
        contentContainerStyle={[styles.list, { paddingBottom: SPACE.xxxl + insets.bottom }]}
        ItemSeparatorComponent={Separator}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        renderItem={({ item }: { item: ShopProduct }) => (
          <ProductCard product={item} currency={catalog.store.currency} width={tile} onPress={open} />
        )}
        ListHeaderComponent={
          <Controls
            catalog={catalog}
            search={search}
            onSearch={setSearch}
            category={category}
            onCategory={setCategory}
          />
        }
        ListEmptyComponent={
          search || category !== "all" ? (
            <EmptyState
              icon="search"
              title="Nothing matches"
              body={search ? `No products match “${search}”.` : "No products in this category yet."}
              action={{ label: "Clear filters", onPress: () => { setSearch(""); setCategory("all"); } }}
            />
          ) : (
            <EmptyState icon="pricetags-outline" title="No products yet" body="This store hasn't listed anything in the app yet. Check back soon." />
          )
        }
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
      />
    </View>
  );
}

function Separator() {
  return <View style={{ height: GAP }} />;
}

function StoreBar({
  name,
  logoUrl,
  topInset,
  count,
  guest,
  onCart,
  right,
}: {
  name: string;
  logoUrl: string | null;
  topInset: number;
  count: number;
  guest: boolean;
  onCart: (() => void) | null;
  right?: ReactNode;
}) {
  const t = useTheme();
  return (
    <View style={[styles.bar, { paddingTop: topInset + SPACE.xs, backgroundColor: t.brand.headerBackground }]}>
      {logoUrl ? <ProductImage uri={logoUrl} width={40} contentFit="contain" style={styles.logo} /> : null}
      <AppText variant="heading" brandFont color={t.brand.headerText} numberOfLines={1} style={{ flex: 1 }} accessibilityRole="header">
        {name}
      </AppText>
      {guest ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          onPress={goToSignIn}
          style={({ pressed }) => [styles.signIn, { borderColor: t.brand.headerText, opacity: pressed ? 0.6 : 1 }]}
        >
          <AppText variant="label" color={t.brand.headerText}>
            Sign in
          </AppText>
        </Pressable>
      ) : null}
      {onCart ? <CartButton count={count} onPress={onCart} onBand /> : null}
      {right}
    </View>
  );
}

function Controls({
  catalog,
  search,
  onSearch,
  category,
  onCategory,
}: {
  catalog: ShopCatalog;
  search: string;
  onSearch: (s: string) => void;
  category: string;
  onCategory: (c: string) => void;
}) {
  const t = useTheme();
  const { paths } = useShop();
  const chips = categoryChips(catalog);
  return (
    <View style={styles.controls}>
      {!catalog.open ? <ClosedBanner message={catalog.closedMessage} /> : null}
      {catalog.groupBuy ? (
        <GroupBuyBanner round={catalog.groupBuy} currency={catalog.store.currency} onPress={() => router.push(paths.groupBuy)} />
      ) : catalog.groupBuyTeaser ? (
        <GroupBuyJoinBanner teaser={catalog.groupBuyTeaser} onPress={() => router.push(paths.groupBuy)} />
      ) : null}
      <View style={[styles.search, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <Ionicons name="search" size={18} color={t.colors.textFaint} />
        <TextInput
          value={search}
          onChangeText={onSearch}
          placeholder={`Search ${catalog.store.name}`}
          placeholderTextColor={t.colors.textFaint}
          accessibilityLabel="Search products"
          autoCorrect={false}
          returnKeyType="search"
          clearButtonMode="while-editing"
          style={[t.type.body, styles.searchInput, { color: t.colors.text }]}
        />
      </View>
      {chips.length > 2 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          accessibilityRole="tablist"
          accessibilityLabel="Categories"
          contentContainerStyle={styles.chips}
          style={styles.chipScroll}
        >
          {chips.map((c) => {
            const active = c.key === category;
            return (
              <Pressable
                key={c.key}
                accessibilityRole="tab"
                accessibilityState={{ selected: active }}
                onPress={() => onCategory(c.key)}
                style={({ pressed }) => [
                  styles.chip,
                  {
                    backgroundColor: active ? t.brand.primary : t.colors.surface,
                    borderColor: active ? t.brand.primary : t.colors.border,
                    opacity: pressed && !active ? 0.7 : 1,
                  },
                ]}
              >
                <AppText variant="label" color={active ? t.brand.onPrimary : "text"}>
                  {c.label}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingBottom: SPACE.xs },
  logo: { width: 36, height: 36, borderRadius: RADIUS.md },
  signIn: { minHeight: 36, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center" },
  list: { paddingHorizontal: GUTTER, flexGrow: 1 },
  controls: { gap: SPACE.md, paddingTop: SPACE.md, paddingBottom: SPACE.lg },
  search: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: TOUCH, borderRadius: RADIUS.pill, borderWidth: 1, paddingHorizontal: SPACE.lg },
  searchInput: { flex: 1, paddingVertical: SPACE.sm },
  chipScroll: { marginHorizontal: -GUTTER },
  chips: { gap: SPACE.sm, paddingHorizontal: GUTTER },
  chip: { minHeight: 40, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center" },
});
