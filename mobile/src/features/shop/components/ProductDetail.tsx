import { useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopCatalog, ShopProduct } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, SkeletonList } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";
import { useCatalog } from "../hooks";
import { defaultOption, galleryFor, maxQtyFor, optionsFor, stockState, type ShopOption } from "../lib/catalog";
import { cartCount, qtyInCart } from "../lib/cart";
import { useShop } from "../ShopProvider";
import { Gallery } from "./Gallery";
import { CartButton, Notice, PriceTag, QtyStepper } from "./ShopUI";
import { CatalogError } from "./ShopStates";

const STOCK_TONE = { out: "danger", low: "warning", in: "success", untracked: "neutral" } as const;
const STOCK_ICON = { out: "close-circle", low: "alert-circle", in: "checkmark-circle", untracked: "hammer-outline" } as const;

/** One product: photos, option picker, price for the chosen option, stock, quantity, sticky Add to cart. */
export function ProductDetail({ id }: { id: string }) {
  const t = useTheme();
  const q = useCatalog();
  const shop = useShop();
  const product = q.data?.products.find((p) => p.id === id);

  const headerRight =
    shop.mode === "preview" ? undefined : () => <CartButton count={cartCount(shop.lines)} onPress={() => router.push(shop.paths.cart)} onBand />;
  const screen = <Stack.Screen options={{ title: "", headerRight }} />;

  if (q.isPending) return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{screen}<SkeletonList rows={3} /></View>;
  if (q.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {screen}
        <CatalogError error={q.error} storeName={t.brand.name} onRetry={() => void q.refetch()} />
      </View>
    );
  }
  if (!product) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {screen}
        <EmptyState icon="pricetag-outline" title="This product isn't available" body="It may have been removed from the shop." action={{ label: "Back to the shop", onPress: () => router.back() }} />
      </View>
    );
  }
  return (
    <>
      {screen}
      <ProductBody product={product} catalog={q.data} />
    </>
  );
}

function ProductBody({ product, catalog }: { product: ShopProduct; catalog: ShopCatalog }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const shop = useShop();
  const options = useMemo(() => optionsFor(product), [product]);
  const [optionKey, setOptionKey] = useState(() => defaultOption(product)?.key ?? "");
  const option: ShopOption | undefined = options.find((o) => o.key === optionKey) ?? options[0];
  const [qty, setQty] = useState(1);
  const [added, setAdded] = useState<string | null>(null);

  const images = useMemo(() => galleryFor(product, option), [product, option]);
  const inCart = option ? qtyInCart(shop.lines, product.id, option.variation) : 0;
  const max = option ? Math.max(0, maxQtyFor(option) - inCart) : 0;
  const stock = stockState(option?.stock ?? null);
  const preview = shop.mode === "preview";
  const canBuy = !preview && !!option && catalog.open && product.purchasable && !option.soldOut && max > 0;
  const blocked = !catalog.open
    ? "The shop is closed right now."
    : !product.purchasable && !option?.soldOut
      ? "This product can't be ordered right now."
      : option && !option.soldOut && max === 0
        ? "You already have all that's left in your cart."
        : null;

  function choose(o: ShopOption) {
    setOptionKey(o.key);
    setQty(1);
    setAdded(null);
  }

  function addToCart() {
    if (!option || !canBuy) return;
    const r = shop.add({ productId: product.id, variation: option.variation, qty: Math.min(qty, max) }, maxQtyFor(option));
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
    setAdded(r.capped ? `Added ${r.added} — that's all that's left.` : `Added ${r.added} to your cart.`);
    setQty(1);
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <ScrollView contentContainerStyle={{ paddingBottom: SPACE.xxxl }}>
        <Gallery key={images[0] ?? "none"} images={images} width={width} name={product.name} />
        <View style={styles.body}>
          <View style={{ gap: SPACE.sm }}>
            {product.isGroupBuy ? (
              <AppText variant="overline" color="link">GROUP BUY · PRE-ORDER</AppText>
            ) : product.badge ? (
              <AppText variant="overline" color="link">{product.badge.toUpperCase()}</AppText>
            ) : null}
            <AppText variant="title" brandFont accessibilityRole="header">
              {product.name}
            </AppText>
            {option ? <PriceTag price={option.price} compareAtPrice={option.compareAtPrice} currency={catalog.store.currency} size="lg" /> : null}
            <View style={styles.stockRow}>
              <Ionicons name={STOCK_ICON[stock.kind]} size={16} color={t.tone(STOCK_TONE[stock.kind]).fg} />
              <AppText variant="label" color={t.tone(STOCK_TONE[stock.kind]).fg}>
                {stock.label}
              </AppText>
              {inCart > 0 ? (
                <AppText variant="caption" color="muted">{`· ${inCart} in your cart`}</AppText>
              ) : null}
            </View>
          </View>

          {options.length > 1 ? <OptionPicker options={options} value={option?.key ?? ""} onChange={choose} /> : null}

          {canBuy ? (
            <View style={{ gap: SPACE.sm }}>
              <AppText variant="label" color="muted">Quantity</AppText>
              <QtyStepper value={Math.min(qty, max)} max={max} onChange={(n) => setQty(Math.max(1, Math.min(n, max)))} label={`${product.name} quantity`} />
            </View>
          ) : null}

          {blocked ? <Notice tone="warning" icon="information-circle">{blocked}</Notice> : null}
          {product.isGroupBuy ? (
            <Notice tone="info" icon="people-outline">
              {"Sold at the group-buy price as a pre-order. Group-buy items can't be mixed with on-hand items in one order."}
            </Notice>
          ) : null}

          {product.description ? (
            <View style={{ gap: SPACE.sm }}>
              <AppText variant="heading" accessibilityRole="header">About this product</AppText>
              <AppText variant="body" color="muted" selectable>
                {product.description}
              </AppText>
            </View>
          ) : null}
        </View>
      </ScrollView>

      <View style={[styles.bar, { paddingBottom: insets.bottom + SPACE.md, backgroundColor: t.colors.surface, borderTopColor: t.colors.border }]}>
        {added ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${added} View cart`}
            accessibilityLiveRegion="polite"
            onPress={() => router.push(shop.paths.cart)}
            style={styles.added}
          >
            <Ionicons name="checkmark-circle" size={18} color={t.tone("success").fg} />
            <AppText variant="label" color={t.tone("success").fg} style={{ flex: 1 }}>{added}</AppText>
            <AppText variant="label" color="link">View cart</AppText>
          </Pressable>
        ) : null}
        {preview ? (
          <AppText variant="caption" color="muted" style={{ textAlign: "center" }}>
            {"Preview — this is what shoppers see. They add to cart from here."}
          </AppText>
        ) : (
          <Button
            label={option?.soldOut ? "Sold out" : !catalog.open ? "Shop closed" : "Add to cart"}
            icon={canBuy ? "bag-add-outline" : undefined}
            disabled={!canBuy}
            onPress={addToCart}
          />
        )}
      </View>
    </View>
  );
}

function OptionPicker({ options, value, onChange }: { options: ShopOption[]; value: string; onChange: (o: ShopOption) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">Choose an option</AppText>
      <View accessibilityRole="radiogroup" style={styles.options}>
        {options.map((o) => {
          const active = o.key === value;
          return (
            <Pressable
              key={o.key}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${o.label}${o.soldOut ? ", sold out" : ""}`}
              onPress={() => {
                if (active) return;
                void Haptics.selectionAsync().catch(() => undefined);
                onChange(o);
              }}
              style={({ pressed }) => [
                styles.option,
                {
                  borderColor: active ? t.brand.link : t.colors.border,
                  borderWidth: active ? 2 : 1,
                  backgroundColor: active ? t.colors.surface : pressed ? t.colors.surfaceAlt : t.colors.surface,
                  opacity: o.soldOut ? 0.5 : 1,
                },
              ]}
            >
              <AppText variant="label" style={o.soldOut ? styles.struck : null}>
                {o.label}
              </AppText>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: SPACE.lg, gap: SPACE.xl },
  stockRow: { flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" },
  options: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  option: { minHeight: TOUCH - 4, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.md, justifyContent: "center" },
  struck: { textDecorationLine: "line-through" },
  bar: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth, gap: SPACE.sm },
  added: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, minHeight: 32 },
});
