import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { ImageField } from "../setup/ImageField";
import { str, type Row } from "../setup/rules";
import { ChoicePills, EditorSheet, Hint, Section, ToggleRow } from "../setup/ui";
import { Checkbox } from "./parts";
import {
  FONT_OPTIONS,
  FONT_WEIGHTS,
  MAX_REVIEW_FONT_SIZE,
  MAX_REVIEW_PRODUCTS,
  MAX_REVIEW_TEXT,
  MIN_REVIEW_FONT_SIZE,
  isHexColor,
  reviewDescStyle,
  reviewProductIds,
  type FontWeight,
  type ReviewDescStyle,
} from "./rules";
import { Field } from "@/ui/inputs";
import { AppText } from "@/ui/primitives";

export type ProductOption = { id: string; name: string };

const PRODUCT_SEARCH_MIN = 8; // show a filter box once the list gets long

/**
 * One testimonial's form (the web's ReviewModal in AdminReviewsManager): image,
 * connected products, headline, title, badge, subtitle, and the subtitle's
 * typography. Controls left on "Default" stay unset so they inherit the store.
 */
export function ReviewEditor({
  initial,
  isNew,
  products,
  productsError,
  saving,
  onCancel,
  onSave,
}: {
  initial: Row;
  isNew: boolean;
  products: ProductOption[];
  productsError: string | null;
  saving: boolean;
  onCancel: () => void;
  onSave: (row: Row) => void;
}) {
  const startStyle = reviewDescStyle(initial.descStyle);
  const [image, setImage] = useState(str(initial.image));
  const [productIds, setPids] = useState<string[]>(() => reviewProductIds(initial));
  const [headline, setHeadline] = useState(str(initial.headline));
  const [title, setTitle] = useState(str(initial.title));
  const [badge, setBadge] = useState(str(initial.badge, "Testimonial"));
  const [subtitle, setSubtitle] = useState(str(initial.subtitle));
  const [style, setStyle] = useState<ReviewDescStyle>(startStyle);
  const [sizeText, setSizeText] = useState(style.size ? String(style.size) : "");
  const [colorText, setColorText] = useState(str(style.color));

  // Merge one attribute, pruning it when cleared so "Default" really means unset.
  const patchStyle = (patch: Partial<ReviewDescStyle>) =>
    setStyle((prev) => {
      const next: ReviewDescStyle = { ...prev, ...patch };
      (Object.keys(patch) as (keyof ReviewDescStyle)[]).forEach((k) => {
        if (next[k] === undefined || next[k] === "") delete next[k];
      });
      return next;
    });

  const sizeNum = Number(sizeText);
  const sizeError =
    sizeText.trim() && (!Number.isFinite(sizeNum) || sizeNum < MIN_REVIEW_FONT_SIZE || sizeNum > MAX_REVIEW_FONT_SIZE)
      ? `Use a size from ${MIN_REVIEW_FONT_SIZE} to ${MAX_REVIEW_FONT_SIZE}.`
      : null;
  const colorError = colorText.trim() && !isHexColor(colorText) ? "Use a hex color like #333333." : null;
  const canSave = !!(title.trim() || subtitle.trim() || image) && !sizeError && !colorError;

  const finalStyle: ReviewDescStyle = { ...style };
  if (sizeText.trim() && !sizeError) finalStyle.size = Math.round(sizeNum);
  else delete finalStyle.size;
  if (colorText.trim() && !colorError) finalStyle.color = colorText.trim();
  else delete finalStyle.color;

  const dirty =
    image !== str(initial.image) ||
    JSON.stringify(productIds) !== JSON.stringify(reviewProductIds(initial)) ||
    headline !== str(initial.headline) ||
    title !== str(initial.title) ||
    badge !== str(initial.badge, "Testimonial") ||
    subtitle !== str(initial.subtitle) ||
    JSON.stringify(finalStyle) !== JSON.stringify(startStyle);

  const toggleProduct = (pid: string) =>
    setPids((prev) => (prev.includes(pid) ? prev.filter((x) => x !== pid) : prev.length >= MAX_REVIEW_PRODUCTS ? prev : [...prev, pid]));

  return (
    <EditorSheet
      visible
      title={isNew ? "Add Review" : "Edit Review"}
      canSave={canSave}
      dirty={dirty}
      saving={saving}
      onCancel={onCancel}
      onSave={() =>
        onSave({
          ...initial,
          headline,
          title,
          subtitle,
          badge,
          image,
          // The legacy single link points at the first connected product.
          productId: productIds[0] ?? "",
          productIds,
          descStyle: Object.keys(finalStyle).length > 0 ? finalStyle : undefined,
        })
      }
    >
      <ImageField label="Image" hint="A screenshot or photo — PNG, JPG" value={image} onChange={(url) => setImage(url)} />
      <ProductPicker products={products} error={productsError} selected={productIds} onToggle={toggleProduct} />
      <Field label="Headline (image overlay)" value={headline} onChangeText={setHeadline} placeholder="e.g. Plateau breaker 🔥" maxLength={MAX_REVIEW_TEXT} />
      <Field label="Title" value={title} onChangeText={setTitle} placeholder="Card title" maxLength={MAX_REVIEW_TEXT} />
      <Field label="Badge" value={badge} onChangeText={setBadge} placeholder="e.g. Testimonial" maxLength={MAX_REVIEW_TEXT} />
      <Field
        label="Subtitle"
        value={subtitle}
        onChangeText={setSubtitle}
        placeholder="A short quote or description…"
        multiline
        maxLength={MAX_REVIEW_TEXT}
      />
      {!canSave && !sizeError && !colorError ? <Hint>Add a title, subtitle or image to save.</Hint> : null}

      <Section
        title="Description style"
        hint={`Applies to the subtitle everywhere it appears — the reviews page and every connected product. Leave a control on "Default" to inherit the store's style.`}
      >
        <ChoicePills
          label="Description font"
          options={[{ key: "", label: "Default (store font)" }, ...FONT_OPTIONS.map((f) => ({ key: f, label: f }))]}
          value={str(style.font)}
          onChange={(font) => patchStyle({ font: font || undefined })}
        />
        <ChoicePills
          label="Weight"
          options={[{ key: "", label: "Default" }, ...FONT_WEIGHTS.map((w) => ({ key: String(w), label: String(w) }))]}
          value={style.weight ? String(style.weight) : ""}
          onChange={(w) => patchStyle({ weight: w ? (Number(w) as FontWeight) : undefined })}
        />
        <Field
          label="Size (px)"
          value={sizeText}
          onChangeText={setSizeText}
          placeholder="Default"
          keyboardType="number-pad"
          error={sizeError}
          hint={`${MIN_REVIEW_FONT_SIZE}–${MAX_REVIEW_FONT_SIZE}, blank = default`}
        />
        <ColorField value={colorText} error={colorError} onChange={setColorText} />
        <ToggleRow label="Italic" value={style.italic === true} onChange={(on) => patchStyle({ italic: on || undefined })} />
      </Section>
    </EditorSheet>
  );
}

function ColorField({ value, error, onChange }: { value: string; error: string | null; onChange: (v: string) => void }) {
  const t = useTheme();
  const swatch = value.trim() && !error ? value.trim() : "transparent";
  return (
    <View style={styles.colorRow}>
      <View style={{ flex: 1 }}>
        <Field
          label="Color"
          value={value}
          onChangeText={onChange}
          placeholder="Default (e.g. #333333)"
          autoCapitalize="none"
          autoCorrect={false}
          error={error}
        />
      </View>
      <View
        accessible
        accessibilityLabel={value.trim() && !error ? `Color preview ${value.trim()}` : "No color set"}
        style={[styles.swatch, { backgroundColor: swatch, borderColor: t.colors.border }]}
      />
    </View>
  );
}

function ProductPicker({
  products,
  error,
  selected,
  onToggle,
}: {
  products: ProductOption[];
  error: string | null;
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const t = useTheme();
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const shown = products.filter((p) => !q || p.name.toLowerCase().includes(q));
  // Connected ids with no matching product (deleted since) still count and can be cleared.
  const orphans = selected.filter((id) => !products.some((p) => p.id === id));
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">
        {`Connect to products${selected.length ? ` (${selected.length})` : ""}`}
      </AppText>
      {products.length >= PRODUCT_SEARCH_MIN ? (
        <Field label="Find a product" value={query} onChangeText={setQuery} placeholder="Search products…" autoCorrect={false} />
      ) : null}
      <View style={[styles.productBox, { borderColor: t.colors.border }]}>
        {error ? (
          <Hint tone="warning">{`Couldn't load products: ${error}`}</Hint>
        ) : products.length === 0 ? (
          <Hint>No products yet — add one first.</Hint>
        ) : (
          shown.map((p) => {
            const on = selected.includes(p.id);
            return (
              <Pressable
                key={p.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: on }}
                accessibilityLabel={p.name}
                onPress={() => onToggle(p.id)}
                style={[styles.productRow, on ? { backgroundColor: t.colors.surfaceAlt } : null]}
              >
                <Checkbox checked={on} a11yLabel={p.name} onPress={() => onToggle(p.id)} />
                <AppText variant="body" numberOfLines={2} style={{ flex: 1 }}>
                  {p.name}
                </AppText>
              </Pressable>
            );
          })
        )}
        {orphans.map((id) => (
          <View key={id} style={styles.productRow}>
            <Checkbox checked a11yLabel={`Remove missing product ${id}`} onPress={() => onToggle(id)} />
            <AppText variant="caption" color="muted" style={{ flex: 1 }}>
              {`Product no longer in your catalog (${id})`}
            </AppText>
          </View>
        ))}
      </View>
      <Hint>
        {`Pick any number of products (up to ${MAX_REVIEW_PRODUCTS}). This review shows under the description of every product you tick, and the reviews page links back to each of them.`}
      </Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  colorRow: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md },
  swatch: { width: 44, height: 44, marginTop: 24, borderRadius: RADIUS.md, borderWidth: 1 },
  productBox: { borderWidth: StyleSheet.hairlineWidth, borderRadius: RADIUS.lg, padding: SPACE.xs, gap: 2 },
  productRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.sm, borderRadius: RADIUS.sm },
});
