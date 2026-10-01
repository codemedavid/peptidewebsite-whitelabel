import { useMemo, useState } from "react";
import { Alert, StyleSheet, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { IconButton, successTap, useDiscardGuard } from "@/features/admin/catalog/components";
import { useAdminBrand, useCatalogProducts, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import { ALL_CATEGORY, ALL_CATEGORY_ID, brandCategories, newRowId, type Category } from "@/features/admin/catalog/model";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText, Button, Card } from "@/ui/primitives";

/**
 * Categories — the filter chips on the shop, in chip order, and the product
 * form's Category list (AdminCategoriesManager). The website saves on every
 * add/delete/blur; here edits collect in a draft and go up in ONE
 * saveCategoriesAction call, so a flaky phone connection can't leave half a
 * reorder saved. The payload is the website's: "All Products" first, then the
 * owner's rows, blank names defaulted to "New Category".
 */

const NEW_LABEL = "New Category";

export default function CategoriesScreen() {
  const brandQ = useAdminBrand();
  if (brandQ.isPending) return <><Stack.Screen options={{ title: "Categories" }} /><SkeletonList rows={4} /></>;
  if (brandQ.isError) {
    return (
      <>
        <Stack.Screen options={{ title: "Categories" }} />
        <ErrorState message={brandQ.error.message} onRetry={() => void brandQ.refetch()} />
      </>
    );
  }
  return <CategoriesEditor brand={brandQ.data} />;
}

function CategoriesEditor({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const online = useOnline();
  const refresh = useCatalogRefresh();
  const products = useCatalogProducts(brand).data;
  const [seed] = useState(() => brandCategories(brand).filter((c) => c.id !== ALL_CATEGORY_ID));
  const [cats, setCats] = useState<Category[]>(seed);
  const dirty = JSON.stringify(cats) !== JSON.stringify(seed);
  const allowLeave = useDiscardGuard(dirty, "Your category changes haven't been saved.");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products ?? []) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return m;
  }, [products]);
  const count = (id: string) => counts.get(id) ?? 0;

  const save = useMutation({
    mutationFn: async () => {
      const rows = cats.map((c) => (c.label.trim() ? { ...c, label: c.label.trim() } : { ...c, label: NEW_LABEL }));
      return unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveCategoriesAction", [ALL_CATEGORY, ...rows]));
    },
    onSuccess: () => {
      refresh();
      successTap();
      allowLeave();
      router.back();
    },
    onError: (e) => Alert.alert("Couldn't save categories", e.message),
  });

  const add = () => setCats((prev) => [...prev, { id: newRowId("cat"), label: NEW_LABEL }]);
  const edit = (id: string, label: string) => setCats((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)));
  const move = (from: number, delta: number) =>
    setCats((prev) => {
      const to = from + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  const remove = (c: Category) => {
    const n = count(c.id);
    const note = n > 0 ? ` ${n} product${n === 1 ? "" : "s"} will keep their category and show only under “All Products” until reassigned.` : "";
    Alert.alert(`Delete “${c.label || c.id}”?`, note.trim() || undefined, [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: () => setCats((prev) => prev.filter((x) => x.id !== c.id)) },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: "Categories" }} />
      <OfflineBanner />
      <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" bottomOffset={SPACE.xl}>
        <AppText variant="body" color="muted">
          The category tabs on your shop, in this order. Products are filed under them from the product form.
        </AppText>
        {cats.length === 0 ? (
          <EmptyState icon="folder-open-outline" title="No categories yet" body="Products will still show under “All Products”." />
        ) : (
          <Card padded={false}>
            {cats.map((c, i) => (
              <View key={c.id} style={[styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border } : null]}>
                <View style={{ flex: 1, gap: 2 }}>
                  <TextInput
                    value={c.label}
                    onChangeText={(v) => edit(c.id, v)}
                    placeholder="Category name"
                    placeholderTextColor={t.colors.textFaint}
                    accessibilityLabel={`Name of category ${i + 1}`}
                    selectTextOnFocus={c.label === NEW_LABEL}
                    maxLength={120}
                    style={[t.type.bodyStrong, styles.input, { color: t.colors.text, borderColor: t.colors.border }]}
                  />
                  {products ? (
                    <AppText variant="caption" color="faint">
                      {`${count(c.id)} product${count(c.id) === 1 ? "" : "s"}`}
                    </AppText>
                  ) : null}
                </View>
                <IconButton icon="chevron-up" label={`Move ${c.label || "category"} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                <IconButton icon="chevron-down" label={`Move ${c.label || "category"} down`} disabled={i === cats.length - 1} onPress={() => move(i, 1)} />
                <IconButton icon="trash-outline" label={`Delete ${c.label || "category"}`} tone="danger" onPress={() => remove(c)} />
              </View>
            ))}
          </Card>
        )}
        <Button label="Add category" icon="add" variant="secondary" onPress={add} />
        <Button label="Save categories" loading={save.isPending} disabled={!online || !dirty || save.isPending} onPress={() => save.mutate()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md },
  input: { minHeight: TOUCH - 4, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm },
});
