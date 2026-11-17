import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, TextInput, View } from "react-native";
import { Image } from "expo-image";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, Stack } from "expo-router";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useMutation } from "@tanstack/react-query";
import { adminBridge, unwrap, type AdminBrand } from "@/features/admin/bridge";
import { IconButton, successTap, ToggleRow, useDiscardGuard } from "@/features/admin/catalog/components";
import { useAdminBrand, useCatalogProducts, useCatalogRefresh } from "@/features/admin/catalog/hooks";
import { categoryArrangeEnabled, categoryResolver, countByCategory, OTHER_SECTION_ID, OTHER_SECTION_LABEL } from "@/features/admin/catalog/category-arrange";
import { pickAndUploadImage } from "@/features/admin/setup/ImageField";
import {
  ALL_CATEGORY,
  ALL_CATEGORY_ID,
  brandCategories,
  newRowId,
  productsFollowCategories,
  type Category,
} from "@/features/admin/catalog/model";
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
  const [followSeed] = useState(() => productsFollowCategories(brand));
  const [follow, setFollow] = useState(followSeed);
  const dirty = follow !== followSeed || JSON.stringify(cats) !== JSON.stringify(seed);
  const allowLeave = useDiscardGuard(dirty, "Your category changes haven't been saved.");

  // Category sections (operator grant): arrange the products inside a SAVED
  // category — a new, unsaved one doesn't exist on the server yet.
  const canArrange = categoryArrangeEnabled(brand);
  // With sections on, count the way the storefront files products (loose
  // matching, unmatched → "Other"); otherwise exact ids, as on the website.
  const counts = useMemo(() => {
    if (canArrange) return countByCategory(products ?? [], cats);
    const m = new Map<string, number>();
    for (const p of products ?? []) m.set(p.category, (m.get(p.category) ?? 0) + 1);
    return m;
  }, [products, cats, canArrange]);
  const count = (id: string) => counts.get(id) ?? 0;
  const otherCount = canArrange ? count(OTHER_SECTION_ID) : 0;
  // Category tile images: only the showcase home shows them.
  const showImages = brand.homeLayout === "showcase";
  const autoImage = (id: string) => {
    const resolve = categoryResolver(cats);
    return (products ?? []).find((p) => p.image && resolve(p.category) === id)?.image ?? undefined;
  };
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const savedIds = useMemo(() => new Set(seed.map((c) => c.id)), [seed]);
  const arrange = (c: Category) => {
    if (dirty) {
      Alert.alert("Save your changes first", "Save your category changes, then arrange the products inside a category.");
      return;
    }
    router.push({ pathname: "/manage/category-arrange", params: { id: c.id } });
  };
  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const allSelected = cats.length > 0 && selected.size === cats.length;
  const deleteSelected = () => {
    const orphans = cats.filter((c) => selected.has(c.id)).reduce((n, c) => n + count(c.id), 0);
    const note = orphans > 0 ? ` ${orphans} product${orphans === 1 ? "" : "s"} will keep their category and show only under “All Products” until reassigned.` : "";
    Alert.alert(`Delete ${selected.size} categor${selected.size === 1 ? "y" : "ies"}?`, note.trim() || undefined, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: () => {
          setCats((prev) => prev.filter((c) => !selected.has(c.id)));
          setSelected(new Set());
        },
      },
    ]);
  };
  const setImage = (id: string, image: string | undefined) =>
    setCats((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const { image: _drop, ...rest } = c;
        return image ? { ...rest, image } : rest;
      }),
    );
  async function chooseImage(c: Category) {
    if (c.image) {
      const choice = await new Promise<"change" | "auto" | null>((resolve) =>
        Alert.alert(`Image for ${c.label || "this category"}`, undefined, [
          { text: "Change image", onPress: () => resolve("change") },
          { text: "Use the first product's photo", onPress: () => resolve("auto") },
          { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
        ]),
      );
      if (choice === "auto") setImage(c.id, undefined);
      if (choice !== "change") return;
    }
    try {
      const res = await pickAndUploadImage(() => setUploadingId(c.id), "category");
      if (res) setImage(c.id, res.url);
    } finally {
      setUploadingId(null);
    }
  }

  const save = useMutation({
    mutationFn: async () => {
      const rows = cats.map((c) => (c.label.trim() ? { ...c, label: c.label.trim() } : { ...c, label: NEW_LABEL }));
      const saved = unwrap(await adminBridge.call<{ ok: true } | { error: string }>("saveCategoriesAction", [ALL_CATEGORY, ...rows]));
      if (follow !== followSeed) {
        unwrap(await adminBridge.call<{ ok: true; enabled: boolean } | { error: string }>("saveProductsFollowCategoriesAction", follow));
      }
      return saved;
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
        <Card>
          <ToggleRow
            label="Products follow this order"
            hint={
              follow
                ? "On: “All Products” lists the first category’s products first, then the next, in the order below. Inside a category, products keep your Products arrangement."
                : "Off: the order below only sets the category tabs. Turn on to also list products category by category."
            }
            value={follow}
            onChange={setFollow}
          />
        </Card>
        {cats.length === 0 ? (
          <EmptyState icon="folder-open-outline" title="No categories yet" body="Products will still show under “All Products”." />
        ) : (
          <Card padded={false}>
            <View style={[styles.bulk, { borderBottomColor: t.colors.border }]}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: allSelected }}
                onPress={() => setSelected(allSelected ? new Set() : new Set(cats.map((c) => c.id)))}
                style={styles.check}
                hitSlop={6}
              >
                <Ionicons name={allSelected ? "checkbox" : "square-outline"} size={22} color={allSelected ? t.brand.link : t.colors.textMuted} />
                <AppText variant="label">{`Select all (${cats.length})`}</AppText>
              </Pressable>
              <Button
                label={`Delete${selected.size ? ` (${selected.size})` : ""}`}
                icon="trash-outline"
                variant="danger"
                disabled={!selected.size}
                onPress={deleteSelected}
              />
            </View>
            {cats.map((c, i) => (
              <View key={c.id} style={[styles.row, i > 0 ? { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: t.colors.border } : null]}>
                <Pressable accessibilityRole="checkbox" accessibilityLabel={`Select ${c.label || "category"}`} accessibilityState={{ checked: selected.has(c.id) }} onPress={() => toggleSelected(c.id)} hitSlop={6}>
                  <Ionicons name={selected.has(c.id) ? "checkbox" : "square-outline"} size={22} color={selected.has(c.id) ? t.brand.link : t.colors.textMuted} />
                </Pressable>
                {showImages ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={c.image ? `Change the image for ${c.label}` : `Add an image for ${c.label}`}
                    onPress={() => void chooseImage(c)}
                    disabled={uploadingId !== null}
                    style={[styles.tile, { backgroundColor: t.colors.surfaceAlt, borderColor: t.colors.border }]}
                  >
                    {c.image ?? autoImage(c.id) ? (
                      <Image source={{ uri: (c.image ?? autoImage(c.id))! }} style={StyleSheet.absoluteFill} contentFit="cover" />
                    ) : (
                      <Ionicons name="image-outline" size={18} color={t.colors.textFaint} />
                    )}
                    {!c.image && autoImage(c.id) ? (
                      <View style={[styles.autoTag, { backgroundColor: t.colors.surface }]}>
                        <AppText variant="caption">Auto</AppText>
                      </View>
                    ) : null}
                    {uploadingId === c.id ? <View style={[StyleSheet.absoluteFill, styles.uploading]} /> : null}
                  </Pressable>
                ) : null}
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
                {canArrange && savedIds.has(c.id) ? (
                  <IconButton icon="swap-vertical" label={`Arrange the products in ${c.label || "this category"}`} onPress={() => arrange(c)} />
                ) : null}
                <IconButton icon="chevron-up" label={`Move ${c.label || "category"} up`} disabled={i === 0} onPress={() => move(i, -1)} />
                <IconButton icon="chevron-down" label={`Move ${c.label || "category"} down`} disabled={i === cats.length - 1} onPress={() => move(i, 1)} />
                <IconButton icon="trash-outline" label={`Delete ${c.label || "category"}`} tone="danger" onPress={() => remove(c)} />
              </View>
            ))}
          </Card>
        )}
        {otherCount > 0 ? (
          <Card style={{ gap: SPACE.sm }}>
            <AppText variant="body" color="muted">
              {`${otherCount} product${otherCount === 1 ? "" : "s"} match no category above and show under “${OTHER_SECTION_LABEL}” at the end of your shop. Edit a product to file it.`}
            </AppText>
            <Button label={`Arrange “${OTHER_SECTION_LABEL}”`} icon="swap-vertical" variant="secondary" onPress={() => arrange({ id: OTHER_SECTION_ID, label: OTHER_SECTION_LABEL })} />
          </Card>
        ) : null}
        {showImages ? (
          <AppText variant="caption" color="faint">
            {"Tap a tile to upload its image. Without one, the category uses its first product's photo (marked Auto)."}
          </AppText>
        ) : null}
        <Button label="Add category" icon="add" variant="secondary" onPress={add} />
        <Button label="Save categories" loading={save.isPending} disabled={!online || !dirty || save.isPending} onPress={() => save.mutate()} />
      </KeyboardAwareScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.lg, paddingBottom: SPACE.xxxl },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, paddingHorizontal: SPACE.md, paddingVertical: SPACE.md },
  bulk: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.md, padding: SPACE.md, borderBottomWidth: StyleSheet.hairlineWidth },
  check: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  tile: { width: 48, height: 48, borderRadius: RADIUS.md, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  autoTag: { position: "absolute", bottom: 2, paddingHorizontal: 4, borderRadius: 4 },
  uploading: { backgroundColor: "rgba(0,0,0,0.35)" },
  input: { minHeight: TOUCH - 4, borderWidth: 1, borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm },
});
