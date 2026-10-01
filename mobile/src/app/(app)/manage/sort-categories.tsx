import { useMemo, useState } from "react";
import { Alert, StyleSheet, Switch, TextInput, View } from "react-native";
import { router, Stack } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { IconButton, successTap, useDiscardGuard } from "@/features/admin/catalog/components";
import { useAdminBrand, useCatalogProducts, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import {
  brandSortCategories,
  BUILT_IN_KINDS,
  newRowId,
  sortKindLabel,
  type SortCategory,
  type SortCategoryKind,
} from "@/features/admin/catalog/model";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText, Button, Card, SectionLabel } from "@/ui/primitives";

/**
 * Product Sort Categories — the shop's "Sort: …" menu, top to bottom
 * (AdminSortCategories). Built-ins sort the whole catalog; groups are the
 * owner's own buckets that products are filed under. Like Categories, edits
 * collect in a draft and go up in one saveSortCategoriesAction call; the
 * server re-normalizes the list exactly as it does for the website.
 */

const NEW_LABEL = "New Category";
const TITLE = "Sort categories";

export default function SortCategoriesScreen() {
  const brandQ = useAdminBrand();
  if (brandQ.isPending) return <><Stack.Screen options={{ title: TITLE }} /><SkeletonList rows={4} /></>;
  if (brandQ.isError) {
    return (
      <>
        <Stack.Screen options={{ title: TITLE }} />
        <ErrorState message={brandQ.error.message} onRetry={() => void brandQ.refetch()} />
      </>
    );
  }
  return <SortEditor brand={brandQ.data} />;
}

function SortEditor({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const online = useOnline();
  const refresh = useCatalogRefresh();
  const products = useCatalogProducts(brand).data;
  const [seed] = useState(() => brandSortCategories(brand));
  const [cats, setCats] = useState<SortCategory[]>(seed);
  const dirty = JSON.stringify(cats) !== JSON.stringify(seed);
  const allowLeave = useDiscardGuard(dirty, "Your sort menu changes haven't been saved.");

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products ?? []) if (p.sortCategory) m.set(p.sortCategory, (m.get(p.sortCategory) ?? 0) + 1);
    return m;
  }, [products]);
  const count = (id: string) => counts.get(id) ?? 0;

  const save = useMutation({
    mutationFn: async () => {
      const rows = cats.map((c) => (c.label.trim() ? { ...c, label: c.label.trim() } : { ...c, label: NEW_LABEL }));
      return unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveSortCategoriesAction", rows));
    },
    onSuccess: () => {
      refresh();
      successTap();
      allowLeave();
      router.back();
    },
    onError: (e) => Alert.alert("Couldn't save the sort menu", e.message),
  });

  const patch = (id: string, p: Partial<SortCategory>) => setCats((prev) => prev.map((c) => (c.id === id ? { ...c, ...p } : c)));
  const addGroup = () => setCats((prev) => [...prev, { id: newRowId("sc"), label: NEW_LABEL, kind: "group", enabled: true }]);
  const addBuiltIn = (kind: Exclude<SortCategoryKind, "group">) =>
    setCats((prev) => [...prev, { id: newRowId(`${kind}_`), label: sortKindLabel(kind), kind, enabled: true }]);
  const move = (from: number, delta: number) =>
    setCats((prev) => {
      const to = from + delta;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  const remove = (c: SortCategory) => {
    const n = c.kind === "group" ? count(c.id) : 0;
    const note = n > 0 ? `${n} product${n === 1 ? "" : "s"} will stay in your catalog and move to the end of the list.` : undefined;
    Alert.alert(`Remove “${c.label || c.id}” from the sort menu?`, note, [
      { text: "Cancel", style: "cancel" },
      { text: "Remove", style: "destructive", onPress: () => setCats((prev) => prev.filter((x) => x.id !== c.id)) },
    ]);
  };

  const enabledCount = cats.filter((c) => c.enabled).length;
  const missingBuiltIns = BUILT_IN_KINDS.filter((k) => !cats.some((c) => c.kind === k.kind));

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: TITLE }} />
      <OfflineBanner />
      <KeyboardAwareScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled" bottomOffset={SPACE.xl}>
        <AppText variant="body" color="muted">
          The “Sort” menu on your shop, top to bottom. A category is your own group — file products under it from the product form,
          and choosing it brings them to the front. A built-in sorts the whole catalog. Turning one off hides it from the menu; it never
          hides products.
        </AppText>
        <AppText variant="label" color="faint">{`${enabledCount} of ${cats.length} showing in the menu`}</AppText>

        {cats.length === 0 ? (
          <AppText variant="body" color="muted">
            Your sort menu is empty — shoppers will see the default Name and Price options until you add your own.
          </AppText>
        ) : (
          <Card padded={false}>
            {cats.map((c, i) => (
              <View
                key={c.id}
                style={[
                  styles.row,
                  i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border } : null,
                  c.enabled ? null : { opacity: 0.6 },
                ]}
              >
                <View style={styles.rowTop}>
                  <Switch
                    value={c.enabled}
                    onValueChange={(enabled) => patch(c.id, { enabled })}
                    trackColor={{ true: t.brand.primary, false: t.colors.border }}
                    accessibilityLabel={`Show ${c.label || c.id} in the sort menu`}
                  />
                  <TextInput
                    value={c.label}
                    onChangeText={(label) => patch(c.id, { label })}
                    placeholder="Menu label"
                    placeholderTextColor={t.colors.textFaint}
                    accessibilityLabel={`Label for ${sortKindLabel(c.kind)}`}
                    selectTextOnFocus={c.label === NEW_LABEL}
                    style={[t.type.bodyStrong, styles.input, { color: t.colors.text, borderColor: t.colors.border }]}
                  />
                </View>
                <View style={styles.rowBottom}>
                  <AppText variant="caption" color="faint" style={{ flex: 1 }}>
                    {`${sortKindLabel(c.kind)} · ${c.kind !== "group" ? "whole catalog" : products ? `${count(c.id)} products` : "your group"}`}
                  </AppText>
                  <IconButton icon="chevron-up" label={`Move ${c.label || c.id} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                  <IconButton icon="chevron-down" label={`Move ${c.label || c.id} down`} disabled={i === cats.length - 1} onPress={() => move(i, 1)} />
                  <IconButton icon="trash-outline" label={`Remove ${c.label || c.id}`} tone="danger" onPress={() => remove(c)} />
                </View>
              </View>
            ))}
          </Card>
        )}

        <Button label="Add category" icon="add" variant="secondary" onPress={addGroup} />
        {missingBuiltIns.length ? (
          <View style={{ gap: SPACE.sm }}>
            <SectionLabel>Add a built-in</SectionLabel>
            <View style={styles.wrap}>
              {missingBuiltIns.map((k) => (
                <Button key={k.kind} label={k.label} icon="add" variant="secondary" onPress={() => addBuiltIn(k.kind)} />
              ))}
            </View>
          </View>
        ) : null}
        <Button label="Save sort menu" loading={save.isPending} disabled={!online || !dirty || save.isPending} onPress={() => save.mutate()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  row: { gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md },
  rowTop: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
  rowBottom: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingLeft: 2 },
  input: { flex: 1, minHeight: TOUCH - 4, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm },
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
});
