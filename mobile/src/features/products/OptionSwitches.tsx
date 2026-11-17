import { Alert, StyleSheet, Switch, View } from "react-native";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap } from "@/features/admin/bridge";
import { useAdminBrand, useCatalogProducts, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import type { CatalogProduct } from "@/features/admin/catalog/model";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";

/**
 * The website Inventory's "Options on sale" (AdminInventory.tsx toggleOption /
 * withDraft): switch one option off or back on. Turning the LAST option off
 * takes the whole product off sale; turning one back on lists it again, so the
 * product switch never contradicts its options. Saved through saveProductAction
 * with the WHOLE product, exactly like the website — every other field rides along.
 */
export function OptionSwitches({ productId, disabled }: { productId: string; disabled?: boolean }) {
  const t = useTheme();
  const brand = useAdminBrand();
  const products = useCatalogProducts(brand.data);
  const refresh = useCatalogRefresh();
  const product = products.data?.find((p) => p.id === productId);

  const save = useMutation({
    mutationFn: async (next: CatalogProduct) => unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveProductAction", next)),
    onSuccess: () => refresh(),
    onError: (e: Error) => Alert.alert("Couldn't update the option", e.message),
  });

  const variations = product?.variations ?? [];
  if (!product || variations.length === 0) return null;

  function toggle(name: string, on: boolean) {
    if (!product) return;
    const off = new Set(variations.filter((v) => v.available === false).map((v) => v.name));
    if (on) off.delete(name);
    else off.add(name);
    const available = off.size >= variations.length ? false : on ? true : product.available !== false;
    const nextVariations = variations.map((v) => {
      const { available: _drop, ...rest } = v;
      return off.has(v.name) ? { ...rest, available: false } : rest;
    });
    save.mutate({ ...product, available, variations: nextVariations });
  }

  return (
    <View style={{ gap: SPACE.xs }}>
      <AppText variant="label" color="muted">
        Options on sale
      </AppText>
      {variations.map((v) => (
        <View key={v.name} style={styles.row}>
          <AppText variant="body" style={{ flex: 1 }} color={v.available === false ? "muted" : "text"}>
            {typeof v.stock === "number" ? `${v.name} · ${v.stock} in stock` : v.name}
          </AppText>
          <Switch
            accessibilityLabel={`${v.name} on sale`}
            value={v.available !== false}
            disabled={disabled || save.isPending}
            onValueChange={(on) => toggle(v.name, on)}
            trackColor={{ true: t.brand.primary, false: t.colors.border }}
            thumbColor="#FFFFFF"
          />
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md, minHeight: 40 },
});
