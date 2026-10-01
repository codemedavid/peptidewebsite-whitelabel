import { Pressable, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { AdminBrand } from "@/features/admin/bridge";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import { brandCategories, brandSymbol } from "@/features/admin/catalog/model";
import { Hint, Section } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { ErrorState, SkeletonList } from "@/ui/feedback";
import { AppText, Pill } from "@/ui/primitives";
import { resolveWholesale } from "./model";

const editRoute = (id: string): Href => `/manage/product-edit?id=${encodeURIComponent(id)}` as Href;

/**
 * "Wholesale Prices by Product": every product's retail vs reseller price, MOQ
 * and stock. Tapping one opens the native product editor, which is where the
 * MOQ and wholesale price are actually set (the website does the same).
 */
export function WholesaleList({ brand, wholesaleWarning }: { brand: AdminBrand; wholesaleWarning: boolean }) {
  const t = useTheme();
  const products = useCatalogProducts(brand);
  const currency = brandSymbol(brand);
  const categories = brandCategories(brand);
  const money = (n?: number | null) => (n && n > 0 ? `${currency}${n.toLocaleString()}` : "—");
  const catLabel = (id: string) => categories.find((c) => c.id === id)?.label || id;
  const list = products.data ?? [];
  const priced = list.filter((p) => resolveWholesale(p) !== null).length;

  return (
    <Section
      title="Wholesale prices by product"
      hint="Reseller pricing is set per product. Tap a product to set its minimum order quantity and wholesale price in the product editor. Products with no wholesale price never appear on the reseller page."
    >
      {wholesaleWarning ? (
        <Hint tone="danger">
          Heads up: Wholesale pricing isn&apos;t enabled for your store yet, so the product editor won&apos;t show the reseller
          price and MOQ fields. Ask your provider to turn it on, then set your prices here.
        </Hint>
      ) : null}
      {products.isError ? (
        <ErrorState message={products.error?.message ?? "Couldn't load products."} onRetry={() => void products.refetch()} />
      ) : !products.data ? (
        <SkeletonList rows={3} />
      ) : list.length === 0 ? (
        <Hint>No products yet. Add products first, then set their reseller pricing.</Hint>
      ) : (
        <View>
          {list.map((p, i) => {
            const w = resolveWholesale(p);
            return (
              <Pressable
                key={p.id}
                accessibilityRole="button"
                accessibilityLabel={`${p.name}. Retail ${money(p.price)}. Reseller ${w ? `${money(w.price)}, minimum ${w.moq}` : "not set"}.`}
                accessibilityHint={w ? "Edit reseller pricing" : "Set reseller pricing"}
                onPress={() => router.push(editRoute(p.id))}
                style={({ pressed }) => [
                  styles.row,
                  { borderColor: t.colors.border, borderTopWidth: i === 0 ? 0 : StyleSheet.hairlineWidth },
                  pressed ? { backgroundColor: t.colors.surfaceAlt } : null,
                ]}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <AppText variant="bodyStrong">{p.name}</AppText>
                  <AppText variant="caption" color="muted">
                    {`${catLabel(p.category)} · Retail ${money(p.price)} · Stock ${typeof p.stock === "number" ? p.stock.toLocaleString() : "—"}`}
                  </AppText>
                  <View style={styles.badges}>
                    {w ? (
                      <>
                        <Pill tone="success" size="sm" icon="pricetag-outline" label={`Reseller ${money(w.price)}`} />
                        <Pill tone="info" size="sm" label={`MOQ ${w.moq}+`} />
                      </>
                    ) : (
                      <Pill tone="neutral" size="sm" label="No reseller price" />
                    )}
                  </View>
                </View>
                <Ionicons name="create-outline" size={20} color={t.colors.textMuted} />
              </Pressable>
            );
          })}
        </View>
      )}
      {list.length > 0 && priced === 0 ? (
        <Hint>No products have reseller pricing yet — the reseller page will be empty until you set some.</Hint>
      ) : null}
    </Section>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingVertical: SPACE.md },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 },
});
