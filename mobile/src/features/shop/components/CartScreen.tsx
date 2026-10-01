import { memo, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopOrderItem } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { AppText, Button } from "@/ui/primitives";
import { useCartRows, useCatalog, useQuote } from "../hooks";
import { buyableLines, cartCount, issueCopy, type CartRow } from "../lib/cart";
import { quoteRequest } from "../lib/checkout";
import { money } from "../lib/money";
import { useShop } from "../ShopProvider";
import { OrderSummary } from "./OrderSummary";
import { Notice, ProductImage, QtyStepper } from "./ShopUI";
import { CatalogError, ClosedBanner, goToSignIn } from "./ShopStates";

const THUMB = 76;

/** The cart: lines with steppers, the server's live subtotal, and Checkout. */
export function CartScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const shop = useShop();
  const q = useCatalog();
  const rows = useCartRows(q.data);
  const lines = useMemo(() => buyableLines(rows), [rows]);
  const quote = useQuote(lines.length > 0 ? quoteRequest(lines, null) : null);
  const currency = q.data?.store.currency ?? "PHP";
  const count = cartCount(shop.lines);
  const title = <Stack.Screen options={{ title: count > 0 ? `Cart (${count})` : "Cart" }} />;

  if (!shop.hydrated || q.isPending) return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{title}<SkeletonList rows={3} /></View>;
  if (q.isError) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {title}
        <CatalogError error={q.error} storeName={t.brand.name} onRetry={() => void q.refetch()} />
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {title}
        <EmptyState icon="bag-outline" title="Your cart is empty" body="Add something you like and it'll wait here for you." action={{ label: "Browse the shop", onPress: () => router.back() }} />
      </View>
    );
  }

  const catalog = q.data;
  const hasIssues = rows.some((r) => r.issue && r.issue !== "reduced");
  const quoteError = quote.isError ? quote.error.message : null;
  const blocker = !catalog.open
    ? "The shop is closed right now."
    : hasIssues
      ? "Remove the items that can't be ordered to continue."
      : quoteError;
  const ready = !blocker && lines.length > 0 && !!quote.data && !quote.isStale;

  function checkout() {
    if (shop.mode === "guest") {
      shop.markResume();
      goToSignIn();
      return;
    }
    router.push("/checkout");
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      {title}
      <OfflineBanner />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
        ListHeaderComponent={!catalog.open ? <View style={{ marginBottom: SPACE.md }}><ClosedBanner message={catalog.closedMessage} /></View> : null}
        renderItem={({ item }) => (
          <CartLineRow
            row={item}
            currency={currency}
            quoted={quotedLine(quote.isStale ? undefined : quote.data?.items, item)}
            onQty={(n) => shop.setQty(item.key, n, item.max)}
            onRemove={() => shop.remove(item.key)}
            onOpen={item.product ? () => router.push(shop.paths.product(item.line.productId)) : undefined}
          />
        )}
        ListFooterComponent={
          <View style={[styles.summary, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
            {quote.data ? (
              <OrderSummary totals={quote.data} currency={currency} showItems={false} updating={quote.isStale} shippingPending />
            ) : quote.isError ? null : (
              <AppText variant="body" color="muted">Working out your total…</AppText>
            )}
            {quoteError ? <Notice tone="danger" icon="alert-circle">{quoteError}</Notice> : null}
            <AppText variant="caption" color="faint">Shipping, fees and promo codes are added at checkout.</AppText>
          </View>
        }
      />
      <View style={[styles.bar, { paddingBottom: insets.bottom + SPACE.md, backgroundColor: t.colors.surface, borderTopColor: t.colors.border }]}>
        {blocker && blocker !== quoteError ? <AppText variant="caption" color={t.tone("warning").fg}>{blocker}</AppText> : null}
        <Button
          label={shop.mode === "guest" ? "Sign in to check out" : quote.data ? `Checkout · ${money(quote.data.total, currency)}` : "Checkout"}
          icon={shop.mode === "guest" ? "log-in-outline" : "lock-closed-outline"}
          loading={!quote.data && quote.isFetching}
          disabled={!ready}
          onPress={checkout}
        />
      </View>
    </View>
  );
}

/** The quote's total for one cart line (matched by product + option). */
function quotedLine(items: ShopOrderItem[] | undefined, row: CartRow): number | null {
  const hit = items?.find((i) => i.productId === row.line.productId && (i.variation ?? undefined) === row.line.variation);
  return hit ? hit.price * hit.qty : null;
}

const CartLineRow = memo(function CartLineRow({
  row,
  currency,
  quoted,
  onQty,
  onRemove,
  onOpen,
}: {
  row: CartRow;
  currency: string;
  /** The server's line total, when the latest quote has this line. */
  quoted: number | null;
  onQty: (n: number) => void;
  onRemove: () => void;
  onOpen?: () => void;
}) {
  const t = useTheme();
  const name = row.product?.name ?? "Unavailable item";
  const optionLabel = row.line.variation ?? null;
  const issue = issueCopy(row.issue, row.max);
  const blocking = row.issue && row.issue !== "reduced";
  return (
    <View style={[styles.row, { backgroundColor: t.colors.surface, borderColor: blocking ? t.tone("danger").fg : t.colors.border }]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${name}`} disabled={!onOpen} onPress={onOpen}>
        <ProductImage uri={row.option?.image ?? row.product?.image ?? null} width={THUMB} style={[styles.thumb, blocking ? { opacity: 0.5 } : null]} />
      </Pressable>
      <View style={{ flex: 1, gap: SPACE.xs }}>
        <View style={styles.rowTop}>
          <View style={{ flex: 1 }}>
            <AppText variant="bodyStrong" numberOfLines={2}>{name}</AppText>
            {optionLabel ? <AppText variant="caption" color="muted">{optionLabel}</AppText> : null}
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${name}${optionLabel ? ` ${optionLabel}` : ""}`}
            onPress={onRemove}
            hitSlop={4}
            style={({ pressed }) => [styles.remove, pressed ? { opacity: 0.5 } : null]}
          >
            <Ionicons name="trash-outline" size={20} color={t.colors.textMuted} />
          </Pressable>
        </View>
        {issue ? (
          <AppText variant="caption" color={blocking ? t.tone("danger").fg : t.tone("warning").fg}>{issue}</AppText>
        ) : null}
        <View style={styles.rowBottom}>
          {!blocking ? (
            <QtyStepper compact value={row.line.qty} max={row.max} onChange={onQty} label={`${name} quantity`} />
          ) : (
            <View />
          )}
          {quoted !== null ? (
            <AppText variant="bodyStrong">{money(quoted, currency)}</AppText>
          ) : row.option ? (
            <AppText variant="caption" color="muted">{`${money(row.option.price, currency)} each`}</AppText>
          ) : null}
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  row: { flexDirection: "row", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  thumb: { width: THUMB, height: THUMB, borderRadius: RADIUS.md },
  rowTop: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm },
  rowBottom: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm, marginTop: SPACE.xs },
  remove: { width: TOUCH - 4, height: TOUCH - 4, alignItems: "center", justifyContent: "center", marginTop: -SPACE.sm, marginRight: -SPACE.sm },
  summary: { marginTop: SPACE.xl, padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, gap: SPACE.md },
  bar: { paddingHorizontal: SPACE.lg, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth, gap: SPACE.sm },
});
