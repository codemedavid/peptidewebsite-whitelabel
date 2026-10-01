import { memo, useState } from "react";
import { Alert, Pressable, StyleSheet, Switch, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import type { ProductRow } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, Button, Pill } from "@/ui/primitives";
import { useUpdateProduct } from "./hooks";

const STOCK_PILL = {
  out: { tone: "danger", icon: "alert-circle-outline", label: "Out of stock" },
  low: { tone: "warning", icon: "trending-down-outline", label: "Low" },
  ok: { tone: "success", icon: "checkmark-circle-outline", label: "In stock" },
  untracked: { tone: "neutral", icon: "hammer-outline", label: "Made to order" },
} as const;

function Stepper({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const t = useTheme();
  const btn = (label: string, icon: "remove" | "add", delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => onChange(Math.max(0, value + delta))}
      onLongPress={() => onChange(Math.max(0, value + delta * 10))}
      style={[styles.stepBtn, { backgroundColor: t.colors.surfaceAlt }]}
    >
      <Ionicons name={icon} size={22} color={t.colors.text} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn("Decrease stock", "remove", -1)}
      <View accessible accessibilityLabel={`Stock ${value}`} accessibilityLiveRegion="polite">
        <AppText variant="title" style={styles.stepValue}>{String(value)}</AppText>
      </View>
      {btn("Increase stock", "add", 1)}
    </View>
  );
}

/** The full product form (name, price, description, photos, variations…). */
export const productEditRoute = (id?: string): Href =>
  (id ? `/manage/product-edit?id=${encodeURIComponent(id)}` : "/manage/product-edit") as Href;

/** The row's place in the shop order, with ↑/↓ (see useProductArrangement). */
export type RowOrder = { isFirst: boolean; isLast: boolean; onMove: (delta: number) => void };

export function OrderArrows({ name, order, disabled }: { name: string; order: RowOrder; disabled: boolean }) {
  const t = useTheme();
  const arrow = (dir: "up" | "down") => {
    const off = disabled || (dir === "up" ? order.isFirst : order.isLast);
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Move ${name} ${dir}`}
        accessibilityState={{ disabled: off }}
        disabled={off}
        hitSlop={4}
        onPress={() => order.onMove(dir === "up" ? -1 : 1)}
        style={({ pressed }) => [styles.arrow, { backgroundColor: pressed ? t.colors.surfaceAlt : "transparent", opacity: off ? 0.25 : 1 }]}
      >
        <Ionicons name={dir === "up" ? "chevron-up" : "chevron-down"} size={20} color={t.colors.textMuted} />
      </Pressable>
    );
  };
  return (
    <View style={styles.arrows}>
      {arrow("up")}
      {arrow("down")}
    </View>
  );
}

/** One catalog row: glanceable stock, a live availability switch, tap to adjust stock or open the full editor. */
export const ProductItem = memo(function ProductItem({
  product,
  disabled,
  order,
  onLongPress,
}: {
  product: ProductRow;
  disabled: boolean;
  /** Shop-order arrows; omitted while the list is filtered. */
  order?: RowOrder;
  /** Long-press on the row (the Products tab offers Delete). */
  onLongPress?: () => void;
}) {
  const t = useTheme();
  const update = useUpdateProduct();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(product.stock ?? 0);
  const pill = STOCK_PILL[product.stockTone];
  const stockEditable = product.stock !== null && !product.hasVariations;

  function toggleAvailable(next: boolean) {
    update.mutate(
      { row: product, patch: { available: next } },
      { onError: (e) => Alert.alert("Couldn't update the product", e.message) },
    );
  }

  function saveStock() {
    update.mutate(
      { row: product, patch: { stock: draft } },
      {
        onSuccess: () => setOpen(false),
        onError: (e) => Alert.alert("Couldn't save stock", e.message),
      },
    );
  }

  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={styles.row}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${product.name}, ${product.priceLabel}, ${product.stock === null ? pill.label : `${product.stock} in stock`}, ${product.available ? "available" : "hidden"}`}
          accessibilityHint={`${stockEditable ? "Adjust stock or edit details" : "Edit details"}${onLongPress ? ". Long-press to delete" : ""}`}
          accessibilityActions={onLongPress ? [{ name: "longpress", label: "Delete" }] : undefined}
          onAccessibilityAction={(e) => (e.nativeEvent.actionName === "longpress" ? onLongPress?.() : undefined)}
          onLongPress={disabled ? undefined : onLongPress}
          delayLongPress={450}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            setDraft(product.stock ?? 0);
            setOpen((o) => !o);
          }}
          style={styles.rowMain}
        >
          {product.imageUrl ? (
            <Image source={{ uri: product.imageUrl }} style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt }]} contentFit="cover" />
          ) : (
            <View style={[styles.thumb, { backgroundColor: t.colors.surfaceAlt, alignItems: "center", justifyContent: "center" }]}>
              <Ionicons name="image-outline" size={20} color={t.colors.textFaint} />
            </View>
          )}
          <View style={{ flex: 1, gap: 4 }}>
            <AppText variant="bodyStrong" numberOfLines={2} color={product.available ? "text" : "muted"}>
              {product.name}
            </AppText>
            <View style={styles.meta}>
              <AppText variant="label" color="muted">{product.priceLabel}</AppText>
              <Pill tone={pill.tone} icon={pill.icon} label={product.stock === null ? pill.label : `${product.stock} · ${pill.label}`} size="sm" />
              {!product.available ? <Pill tone="neutral" icon="eye-off-outline" label="Hidden" size="sm" /> : null}
            </View>
          </View>
        </Pressable>
        {order ? <OrderArrows name={product.name} order={order} disabled={disabled} /> : null}
        {/* A sibling, not a child, so screen readers can reach it. */}
        <Switch
          accessibilityLabel={`${product.name} available for sale`}
          value={product.available}
          disabled={disabled || update.isPending}
          onValueChange={toggleAvailable}
          trackColor={{ true: t.brand.primary, false: t.colors.border }}
          thumbColor="#FFFFFF"
        />
      </View>

      {open ? (
        <View style={[styles.editor, { borderTopColor: t.colors.border }]}>
          {stockEditable ? (
            <>
              <Stepper value={draft} onChange={setDraft} />
              <Button label="Save stock" loading={update.isPending} disabled={disabled || update.isPending || draft === product.stock} onPress={saveStock} />
            </>
          ) : (
            <AppText variant="caption" color="muted">
              {product.stock === null
                ? "Made-to-order products don't track stock."
                : "This product tracks stock per option. Adjust it under Edit product details → Variations."}
            </AppText>
          )}
          <Button
            label="Edit product details"
            icon="create-outline"
            variant="secondary"
            accessibilityHint="Name, price, description, photos, variations and more"
            onPress={() => router.push(productEditRoute(product.id))}
          />
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, overflow: "hidden" },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingRight: SPACE.md },
  rowMain: { flex: 1, flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, minHeight: TOUCH + 24 },
  thumb: { width: 52, height: 52, borderRadius: RADIUS.sm },
  meta: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 6 },
  editor: { padding: SPACE.lg, gap: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  stepper: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: SPACE.xl },
  stepBtn: { width: TOUCH + 8, height: TOUCH + 8, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  arrows: { gap: 2 },
  arrow: { width: 36, height: 34, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center" },
  stepValue: { minWidth: 64, textAlign: "center", fontVariant: ["tabular-nums"] },
});
