import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { router, Stack, useLocalSearchParams } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { FormSection, Notice, SelectField, ToggleRow, successTap, useDiscardGuard } from "@/features/admin/catalog/components";
import { formatMoney } from "@/features/admin/catalog/currency";
import { useAdminBrand, useCatalogProducts, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import {
  assignableSortCategories,
  brandCategories,
  brandSortCategories,
  brandSymbol,
  groupBuyVisible,
  madeToOrderVisible,
  RESELLER_MIN_QTY,
  resellerVisible,
  selectableCategories,
  wholesaleVisible,
  type CatalogProduct,
} from "@/features/admin/catalog/model";
import {
  draftFromProduct,
  makeMainPhoto,
  PRODUCT_CLASSES,
  saveBlockers,
  toNum,
  toSavePayload,
  withMainPhoto,
  wholesaleError,
  wholesaleWarning,
  type ProductDraft,
} from "@/features/admin/catalog/product-form";
import { InclusionsEditor, numeric, PhotoStrip, ProductImageField, VariationsEditor } from "@/features/admin/catalog/ProductEditorParts";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * Add / edit one product — the website's product form (AdminAddProduct), field
 * for field, saved through the website's own saveProductAction. `id` absent =
 * a new product. Cards that are entitlement-gated on the website (Group Buy,
 * Wholesale, Reseller, Made to order) are gated here on the same brand flags;
 * their saved values round-trip untouched while hidden.
 */
export default function ProductEditScreen() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const brandQ = useAdminBrand();
  // Only an edit needs the list: listProductsAction is gated on the "products"
  // permission, and a staff member granted just "add-product" must still add.
  const productsQ = useCatalogProducts(id ? brandQ.data : undefined);
  const title = id ? "Edit product" : "Add product";

  if (brandQ.isPending || (id && brandQ.data && productsQ.isPending)) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <SkeletonList rows={4} />
      </>
    );
  }
  if (brandQ.isError || productsQ.isError || !brandQ.data || (id && !productsQ.data)) {
    const err = brandQ.error ?? productsQ.error;
    return (
      <>
        <Stack.Screen options={{ title }} />
        <ErrorState message={err?.message ?? "Something went wrong."} onRetry={() => void (brandQ.isError ? brandQ.refetch() : productsQ.refetch())} />
      </>
    );
  }
  const initial = id ? productsQ.data?.find((p) => p.id === id) ?? null : null;
  if (id && !initial) {
    return (
      <>
        <Stack.Screen options={{ title }} />
        <EmptyState icon="search" title="Product not found" body="It may have been deleted on the website." action={{ label: "Go back", onPress: () => router.back() }} />
      </>
    );
  }
  // Keyed so switching products re-seeds the form instead of reusing stale state.
  return <ProductEditor key={id ?? "new"} brand={brandQ.data} initial={initial} title={title} />;
}

function ProductEditor({ brand, initial, title }: { brand: AdminBrand; initial: CatalogProduct | null; title: string }) {
  const t = useTheme();
  const online = useOnline();
  const refresh = useCatalogRefresh();
  const currency = brandSymbol(brand);
  const money = (n: number) => formatMoney(n, currency, { decimals: false });

  const categories = useMemo(() => selectableCategories(brandCategories(brand)), [brand]);
  const sortGroups = useMemo(() => assignableSortCategories(brandSortCategories(brand)), [brand]);
  const [seed] = useState(() => draftFromProduct(initial, categories[0]?.id ?? ""));
  const [d, setD] = useState<ProductDraft>(seed);
  const [uploads, setUploads] = useState(0);
  const set = (patch: Partial<ProductDraft>) => setD((prev) => ({ ...prev, ...patch }));
  const onBusy = (busy: boolean) => setUploads((n) => Math.max(0, n + (busy ? 1 : -1)));

  const dirty = JSON.stringify(d) !== JSON.stringify(seed);
  const allowLeave = useDiscardGuard(dirty, "Your product changes haven't been saved.");

  const blockers = saveBlockers(d);
  const wErr = wholesaleError(d);
  const wWarn = wholesaleWarning(d, money);
  const uploading = uploads > 0;

  const save = useMutation({
    mutationFn: async () =>
      unwrap(await adminBridge.call<{ ok: true; product: CatalogProduct } | { error: string }>("saveProductAction", toSavePayload(d, initial, currency))),
    onSuccess: () => {
      refresh();
      successTap();
      allowLeave();
      router.back();
    },
    onError: (e) => Alert.alert("Couldn't save the product", e.message),
  });
  const canSave = online && blockers.length === 0 && !uploading && !save.isPending;

  function submit() {
    if (!online) return void Alert.alert("You're offline", "Reconnect to save. Nothing was changed.");
    if (uploading) return void Alert.alert("Still uploading", "Wait for the photo to finish uploading, then save.");
    if (blockers.length) return void Alert.alert("Almost there", blockers.join("\n"));
    save.mutate();
  }

  // A product filed under a since-deleted category keeps it visible, so opening
  // the form can't silently re-file it (the website's orphan rule).
  const categoryOptions = [
    ...(d.category && !categories.some((c) => c.id === d.category) ? [{ value: d.category, label: `(removed) ${d.category}` }] : []),
    ...categories.map((c) => ({ value: c.id, label: c.label })),
  ];
  const sortOptions = [
    { value: "", label: "— None —" },
    ...(d.sortCategory && !sortGroups.some((c) => c.id === d.sortCategory) ? [{ value: d.sortCategory, label: `(removed) ${d.sortCategory}` }] : []),
    ...sortGroups.map((c) => ({ value: c.id, label: c.label })),
  ];

  const showGb = groupBuyVisible(brand);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          title,
          headerRight: () => (
            <Pressable accessibilityRole="button" accessibilityLabel="Save product" accessibilityState={{ disabled: !canSave }} hitSlop={10} onPress={submit}>
              <AppText variant="bodyStrong" color={t.brand.headerText} style={{ opacity: canSave ? 1 : 0.5 }}>
                {save.isPending ? "Saving…" : "Save"}
              </AppText>
            </Pressable>
          ),
        }}
      />
      <OfflineBanner />
      <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" bottomOffset={SPACE.xl}>
        <FormSection title="Basic information">
          <Field label="Product name *" value={d.name} onChangeText={(name) => set({ name })} placeholder="e.g. BPC-157 5mg" />
          <Field label="Description *" value={d.description} onChangeText={(description) => set({ description })} placeholder="Detailed product description…" multiline />
          <SelectField label="Category *" value={d.category} options={categoryOptions} onChange={(category) => set({ category })} />
          <SelectField
            label="Sort category"
            value={d.sortCategory}
            options={sortOptions}
            onChange={(sortCategory) => set({ sortCategory })}
            hint="Groups this product in your shop's Sort menu. Optional — unassigned products still show, just after the grouped ones."
          />
          <SelectField
            label="Order ratio class"
            value={d.productClass}
            options={PRODUCT_CLASSES}
            onChange={(v) => set({ productClass: v as ProductDraft["productClass"] })}
            hint="Used by Order Ratio Control to pair peptides with bac water."
          />
          <Field label={`Base price (${currency}) *`} value={d.price} onChangeText={(v) => set({ price: numeric(v) })} keyboardType="decimal-pad" />
        </FormSection>

        <FormSection
          title="Variations"
          hint={`Offer the same product in several options — e.g. 5mg / 10mg, or vials only versus the complete set — each with its own price (${currency}). Leave empty to sell it as one option at the base price.`}
        >
          <VariationsEditor
            items={d.variations}
            update={(fn) => setD((prev) => ({ ...prev, variations: fn(prev.variations) }))}
            currency={currency}
            showGbPrice={showGb && d.isGroupBuy}
            onBusy={onBusy}
          />
        </FormSection>

        <FormSection title="Complete set inclusions">
          <ToggleRow label="This is a SET product" value={d.isSet} onChange={(isSet) => set({ isSet })} />
          {d.isSet ? (
            <InclusionsEditor items={d.inclusions} update={(fn) => setD((prev) => ({ ...prev, inclusions: fn(prev.inclusions) }))} />
          ) : (
            <AppText variant="caption" color="muted">
              Turn this on to list what comes in the set.
            </AppText>
          )}
        </FormSection>

        <FormSection title="Inventory & availability">
          <Field label="Stock quantity" value={d.stock} onChangeText={(v) => set({ stock: numeric(v, false) })} keyboardType="number-pad" />
          <ToggleRow label="Featured — pin to top" hint="Pins this product to the very top of your catalog." value={d.featured} onChange={(featured) => set({ featured })} />
          <ToggleRow label="Available" value={d.available} onChange={(available) => set({ available })} />
          <ToggleRow label="Free shipping" value={d.freeShipping} onChange={(freeShipping) => set({ freeShipping })} />
          {madeToOrderVisible(brand) ? (
            <ToggleRow
              label="Made to order — no stock needed"
              hint="Made after the order is placed: never sold out, no quantity cap, and confirming an order doesn't deduct inventory."
              value={d.madeToOrder}
              onChange={(madeToOrder) => set({ madeToOrder })}
            />
          ) : null}
        </FormSection>

        <FormSection title="Discount pricing">
          <ToggleRow label="Enable discount" value={d.discountOn} onChange={(discountOn) => set({ discountOn })} />
          <Field
            label={`Discount price (${currency})`}
            value={d.discount}
            onChangeText={(v) => set({ discount: numeric(v) })}
            keyboardType="decimal-pad"
            editable={d.discountOn}
          />
        </FormSection>

        {showGb ? (
          <FormSection title="Group buy">
            <ToggleRow label="Group Buy product" value={d.isGroupBuy} onChange={(isGroupBuy) => set({ isGroupBuy })} />
            <Field
              label={`Group buy price (${currency})`}
              value={d.gbPrice}
              onChangeText={(v) => set({ gbPrice: numeric(v) })}
              keyboardType="decimal-pad"
              editable={d.isGroupBuy}
              hint={
                d.isGroupBuy
                  ? "Shown in the storefront's Group Buy section with the on-hand price and the saving."
                  : "Off — this product lists as on-hand (ships now)."
              }
            />
          </FormSection>
        ) : null}

        {wholesaleVisible(brand) ? (
          <FormSection
            title="Wholesale pricing"
            hint="Sell this product at a lower unit price once the customer orders enough of it. The normal price (and each option's own price) applies until the minimum is reached."
          >
            <ToggleRow label="Enable wholesale pricing for this product" value={d.wholesaleOn} onChange={(wholesaleOn) => set({ wholesaleOn })} />
            <Field
              label="Minimum order quantity (units)"
              value={d.wholesaleMoq}
              onChangeText={(v) => set({ wholesaleMoq: numeric(v, false) })}
              keyboardType="number-pad"
              hint="Minimum combined quantity of this product required to unlock wholesale pricing."
            />
            <Field
              label={`Wholesale unit price (${currency})`}
              value={d.wholesalePrice}
              onChangeText={(v) => set({ wholesalePrice: numeric(v) })}
              keyboardType="decimal-pad"
              hint="This price applies to the entire quantity once the minimum is reached."
            />
            {d.variations.length ? (
              <AppText variant="caption" color="muted">
                {`All ${d.variations.length} options count toward the same minimum — ${d.variations
                  .slice(0, 4)
                  .map((v) => v.name.trim() || "?")
                  .join(" + ")}${d.variations.length > 4 ? " …" : ""} add up together.`}
              </AppText>
            ) : null}
            {wErr ? <Notice tone="danger">{wErr}</Notice> : null}
            {wWarn ? <Notice tone="warning">{wWarn}</Notice> : null}
            {d.wholesaleOn && !wErr ? (
              <Notice tone="info">
                {`Under ${toNum(d.wholesaleMoq).toLocaleString()} units → ${money(toNum(d.price))} each\n${toNum(d.wholesaleMoq).toLocaleString()} units or more → ${money(toNum(d.wholesalePrice))} each`}
              </Notice>
            ) : null}
          </FormSection>
        ) : null}

        {resellerVisible(brand) ? (
          <FormSection
            title="Reseller / wholesale pricing"
            hint={`Shown on the storefront card next to the retail price, and applied in the cart once one product reaches the minimum below. Leave a price at 0 to hide that tier; leave the minimum blank to use the default of ${RESELLER_MIN_QTY}.`}
          >
            <Field label={`Vials only (${currency})`} value={d.resellerVials} onChangeText={(v) => set({ resellerVials: numeric(v) })} keyboardType="decimal-pad" />
            <Field label={`Complete set (${currency})`} value={d.resellerSet} onChangeText={(v) => set({ resellerSet: numeric(v) })} keyboardType="decimal-pad" />
            <Field label="Minimum order for wholesale (units)" value={d.resellerMin} onChangeText={(v) => set({ resellerMin: numeric(v, false) })} keyboardType="number-pad" />
          </FormSection>
        ) : null}

        <FormSection title="Product image" hint="Optional. This is the photo customers see on your shop.">
          <ProductImageField image={d.image} onChange={(image) => set({ image })} onBusy={onBusy} />
        </FormSection>

        <FormSection
          title="More photos"
          hint="Front, back, label or angle shots — customers swipe through them on the product. Tap a photo to move it, make it the main photo, or remove it."
        >
          <PhotoStrip
            photos={d.extraImages}
            label="the product"
            onBusy={onBusy}
            onChange={(extraImages) => set(withMainPhoto(d.image, extraImages))}
            onMakeMain={(url) => set(makeMainPhoto(d.image, d.extraImages, url))}
          />
        </FormSection>

        {blockers.length ? <Notice tone="warning">{blockers.join("\n")}</Notice> : null}
        <Button label={initial ? "Save changes" : "Add product"} loading={save.isPending} disabled={!canSave} onPress={submit} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
});
