import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import { FlatList, Pressable, ScrollView, StyleSheet, View, type RefreshControlProps, type ViewToken } from "react-native";
import type { ShopCatalog, ShopProduct } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { headerIndex, sectionNav, sectionRows, type SectionNavItem, type SectionRow } from "../lib/sections";
import { ProductCard } from "./ProductCard";

type Item = { key: string; kind: "nav" } | SectionRow;

type Props = {
  catalog: ShopCatalog;
  search: string;
  tile: number;
  gap: number;
  gutter: number;
  bottomInset: number;
  onOpen: (id: string) => void;
  header: ReactElement;
  empty: ReactElement;
  refreshControl: ReactElement<RefreshControlProps>;
};

// The nav is data[0]; with a ListHeaderComponent, FlatList counts the header
// as sticky index 0, so the nav is sticky index 1.
const NAV_STICKY_INDEX = 1;
const VIEWABILITY = { itemVisiblePercentThreshold: 10 };

/**
 * The website's category-sections catalog: every category its own section,
 * in the owner's order, under a sticky tab bar that follows the scroll (tap a
 * tab to jump). Sections come from the server; search narrows them.
 */
export function SectionedCatalog({ catalog, search, tile, gap, gutter, bottomInset, onOpen, header, empty, refreshControl }: Props) {
  const t = useTheme();
  const list = useRef<FlatList<Item>>(null);
  const navHeight = useRef(0);
  const rows = useMemo(() => sectionRows(catalog, search), [catalog, search]);
  const nav = useMemo(() => sectionNav(rows), [rows]);
  const data = useMemo<Item[]>(() => (rows.length > 0 ? [{ key: "nav", kind: "nav" }, ...rows] : []), [rows]);
  const [active, setActive] = useState<string | null>(null);
  const current = active && nav.some((n) => n.id === active) ? active : (nav[0]?.id ?? null);

  // Stable for the list's lifetime (FlatList refuses a changing callback).
  const onViewable = useCallback(({ viewableItems }: { viewableItems: ViewToken<Item>[] }) => {
    const first = viewableItems.find((v) => v.item && v.item.kind !== "nav");
    if (first?.item && first.item.kind !== "nav") setActive(first.item.sectionId);
  }, []);

  const jump = useCallback(
    (id: string) => {
      const index = headerIndex(rows, id);
      if (index < 0) return;
      setActive(id);
      list.current?.scrollToIndex({ index: index + 1, viewOffset: navHeight.current, animated: true });
    },
    [rows],
  );

  const renderItem = ({ item }: { item: Item }) => {
    if (item.kind === "nav") {
      return (
        <View onLayout={(e) => (navHeight.current = e.nativeEvent.layout.height)} style={{ backgroundColor: t.colors.bg, marginHorizontal: -gutter }}>
          <SectionTabs items={nav} active={current} onPick={jump} gutter={gutter} />
        </View>
      );
    }
    if (item.kind === "header") {
      return (
        <View style={styles.header}>
          <AppText variant="heading" accessibilityRole="header">{item.label}</AppText>
          <AppText variant="caption" color="muted">{`${item.count} ${item.count === 1 ? "item" : "items"}`}</AppText>
        </View>
      );
    }
    return <ProductPair products={item.products} currency={catalog.store.currency} tile={tile} gap={gap} onOpen={onOpen} />;
  };

  return (
    <FlatList
      ref={list}
      data={data}
      keyExtractor={(i) => i.key}
      renderItem={renderItem}
      stickyHeaderIndices={data.length > 0 ? [NAV_STICKY_INDEX] : undefined}
      ListHeaderComponent={header}
      ListEmptyComponent={empty}
      onViewableItemsChanged={onViewable}
      viewabilityConfig={VIEWABILITY}
      onScrollToIndexFailed={(info) => {
        // Rows above haven't been measured yet: get close, then land exactly.
        list.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
        setTimeout(() => list.current?.scrollToIndex({ index: info.index, viewOffset: navHeight.current, animated: true }), 60);
      }}
      contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: SPACE.xxxl + bottomInset, flexGrow: 1 }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      refreshControl={refreshControl}
    />
  );
}

function ProductPair({ products, currency, tile, gap, onOpen }: { products: ShopProduct[]; currency: string; tile: number; gap: number; onOpen: (id: string) => void }) {
  return (
    <View style={[styles.pair, { gap, marginBottom: gap }]}>
      {products.map((p) => (
        <ProductCard key={p.id} product={p} currency={currency} width={tile} onPress={onOpen} />
      ))}
    </View>
  );
}

function SectionTabs({ items, active, onPick, gutter }: { items: SectionNavItem[]; active: string | null; onPick: (id: string) => void; gutter: number }) {
  const t = useTheme();
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      accessibilityRole="tablist"
      accessibilityLabel="Categories"
      contentContainerStyle={[styles.tabs, { paddingHorizontal: gutter }]}
    >
      {items.map((c) => {
        const on = c.id === active;
        return (
          <Pressable
            key={c.id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityHint="Jumps to this category"
            onPress={() => onPick(c.id)}
            style={({ pressed }) => [
              styles.tab,
              {
                backgroundColor: on ? t.brand.primary : t.colors.surface,
                borderColor: on ? t.brand.primary : t.colors.border,
                opacity: pressed && !on ? 0.7 : 1,
              },
            ]}
          >
            <AppText variant="label" color={on ? t.brand.onPrimary : "text"}>{c.label}</AppText>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: SPACE.sm, paddingVertical: SPACE.sm },
  tab: { minHeight: 36, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", paddingTop: SPACE.lg, paddingBottom: SPACE.md },
  pair: { flexDirection: "row" },
});
