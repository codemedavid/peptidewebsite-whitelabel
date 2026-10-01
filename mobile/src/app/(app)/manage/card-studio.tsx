import { useMemo, useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import { formatMoney } from "@/features/admin/catalog/currency";
import { removeRows, upsertRow, useAdminBrand, useCollection, useSetupSave } from "@/features/admin/setup/data";
import { FormPage, Hint, Loadable, SaveBar, Section, confirmDelete, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { CustomizePanel } from "@/features/admin/card-studio/controls";
import {
  COMPARE_MAX,
  CARD_PRESETS,
  TEMPLATES_MAX,
  TEMPLATE_NAME_MAX,
  appliedIdentity,
  brandCardDesign,
  getCardPreset,
  newTemplateId,
  normalizeCardDesign,
  normalizeCardTemplates,
  presetKey,
  stampTemplate,
  templateKey,
  type CardDesign,
  type CardTemplate,
} from "@/features/admin/card-studio/model";
import {
  CompareSheet,
  DEVICES,
  GalleryGrid,
  HoldToHover,
  PreviewSheet,
  Tile,
  frameWidth,
  type Device,
  type Entry,
} from "@/features/admin/card-studio/Gallery";
import { PreviewCard, cardThemeFrom, type SampleProduct } from "@/features/admin/card-studio/PreviewCard";
import { Field, Segmented } from "@/ui/inputs";
import { AppText, Button, Pill } from "@/ui/primitives";

const SAMPLE_PRICE = 1850;
const SAMPLE_DESC = "A short example description so you can judge type, spacing and color in context.";

/**
 * The website's Card Studio (AdminCardStudio → saveCardDesignAction /
 * saveCardTemplatesAction): pick one of the product-card designs, customize
 * it, and keep your own templates. The live preview is a native sketch of the
 * storefront card on one of your real products. Designs save with the Save
 * bar; templates save as soon as they're added or deleted, as on the website.
 */
export default function CardStudioScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Card Studio" }} />
      <Loadable query={brand}>{(b) => <Studio brand={b} />}</Loadable>
    </>
  );
}

function useSample(brand: AdminBrand): SampleProduct {
  const products = useCatalogProducts(brand).data;
  return useMemo(() => {
    const list = products ?? [];
    const real = list.find((p) => p.image && p.available !== false) ?? list[0];
    return {
      name: real?.name ?? "Sample Product 10mg",
      description: real?.description || SAMPLE_DESC,
      priceLabel: formatMoney(real?.price ?? SAMPLE_PRICE, brand.currency),
      purity: real ? (real.purity ?? "") : "99.9%",
      image: real?.image ?? null,
    };
  }, [products, brand.currency]);
}

function Studio({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const theme = useMemo(() => cardThemeFrom(brand, { primary: t.brand.primary, onPrimary: t.brand.onPrimary }), [brand, t.brand]);
  const sample = useSample(brand);

  const [saved, setSaved] = useState<CardDesign | null>(() => brandCardDesign(brand));
  const [design, setDesign] = useState<CardDesign | null>(saved);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveCardDesignAction");
  const dirty = JSON.stringify(design) !== JSON.stringify(saved);
  useDiscardGuard(dirty);

  const collection = useCollection("cardTemplates", "saveCardTemplatesAction", [], "templates");
  const templates = useMemo(() => normalizeCardTemplates(collection.items), [collection.items]);

  const [device, setDevice] = useState<Device>("mobile");
  const [preview, setPreview] = useState<{ key: string | null; name: string; design: CardDesign } | null>(null);
  const [compareKeys, setCompareKeys] = useState<string[]>([]);
  const [compareOpen, setCompareOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  const [templateName, setTemplateName] = useState("");

  const applied = appliedIdentity(design, templates);

  const change = (next: CardDesign | null) => {
    hideSaved();
    setDesign(next);
  };
  const patch = (edits: Partial<CardDesign>) => design && change({ ...design, ...edits });
  const applyEntry = (key: string, d: CardDesign) => {
    // Re-applying the live tile keeps its customizations; a template stamps its identity.
    if (key === applied.key && design) return;
    const template = key.startsWith("t:") ? templates.find((x) => templateKey(x.id) === key) : undefined;
    change(template ? stampTemplate(template) : { ...d });
  };

  const resetToClassic = () =>
    Alert.alert("Return to the classic card?", "Removes the applied design once you save.", [
      { text: "Cancel", style: "cancel" },
      { text: "Reset", style: "destructive", onPress: () => change(null) },
    ]);

  function onSave() {
    save.mutate(design, {
      onSuccess: () => {
        const clean = design ? normalizeCardDesign(design) : null;
        setSaved(clean);
        setDesign(clean);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const saveTemplate = async () => {
    const name = templateName.trim();
    if (!design || !name) return;
    const row: CardTemplate = { id: newTemplateId(), name: name.slice(0, TEMPLATE_NAME_MAX), design: { ...design } };
    if (await collection.apply(upsertRow(row))) {
      setNaming(false);
      setTemplateName("");
    }
  };
  const deleteTemplate = (tpl: CardTemplate) =>
    confirmDelete(`Delete the template "${tpl.name}"?`, () => {
      setCompareKeys((keys) => keys.filter((k) => k !== templateKey(tpl.id)));
      void collection.apply(removeRows(new Set([tpl.id])));
    });

  const toggleCompare = (key: string) =>
    setCompareKeys((keys) => {
      if (keys.includes(key)) return keys.filter((k) => k !== key);
      if (keys.length >= COMPARE_MAX) {
        Alert.alert(`Compare up to ${COMPARE_MAX} designs at a time`);
        return keys;
      }
      return [...keys, key];
    });

  const entryFor = (key: string): Entry | null => {
    // The applied entry compares as it CURRENTLY looks, customizations included.
    if (design && key === applied.key) return { key, name: `${applied.name} (current)`, tagline: "", design };
    if (key.startsWith("p:")) {
      const p = getCardPreset(key.slice(2));
      return p ? { key, name: p.name, tagline: p.tagline, design: p.design } : null;
    }
    const tpl = templates.find((x) => templateKey(x.id) === key);
    return tpl ? { key, name: tpl.name, tagline: "Saved template", design: tpl.design } : null;
  };
  const compareEntries = compareKeys.map(entryFor).filter((e): e is Entry => e !== null);

  const renderTile = (entry: Entry, onDelete?: () => void) => {
    const active = entry.key === applied.key;
    const shown = active && design ? { ...entry, design } : entry;
    return (
      <Tile
        key={entry.key}
        entry={shown}
        theme={theme}
        sample={sample}
        active={active}
        customized={applied.customized}
        inCompare={compareKeys.includes(entry.key)}
        onApply={() => applyEntry(entry.key, entry.design)}
        onPreview={() => setPreview({ key: entry.key, name: entry.name, design: shown.design })}
        onCompare={() => toggleCompare(entry.key)}
        onDelete={onDelete}
      />
    );
  };

  return (
    <>
      <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
        <AppText variant="body" color="muted">
          Choose how product cards look across your catalog. Tap a design to apply it, then fine-tune borders, colors,
          typography and buttons. Save to publish it to your store.
        </AppText>

        <LivePreview
          design={design}
          appliedName={applied.name}
          customized={applied.customized}
          theme={theme}
          sample={sample}
          device={device}
          onDevice={setDevice}
          onFull={() => design && setPreview({ key: applied.key, name: applied.name, design })}
        />

        {design ? (
          <View style={styles.actions}>
            <Button
              label="Save as template"
              icon="bookmark-outline"
              variant="secondary"
              disabled={templates.length >= TEMPLATES_MAX}
              onPress={() => setNaming(true)}
              style={{ flex: 1 }}
            />
            <Button label="Reset to classic" variant="ghost" onPress={resetToClassic} style={{ flex: 1 }} />
          </View>
        ) : null}

        {naming && design ? (
          <Section title="New template">
            <Field
              label="Template name"
              value={templateName}
              onChangeText={setTemplateName}
              maxLength={TEMPLATE_NAME_MAX}
              placeholder="e.g. Holiday promo cards"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => void saveTemplate()}
            />
            <View style={styles.actions}>
              <Button
                label="Save template"
                loading={collection.saving}
                disabled={!templateName.trim()}
                onPress={() => void saveTemplate()}
                style={{ flex: 1 }}
              />
              <Button label="Cancel" variant="ghost" onPress={() => setNaming(false)} style={{ flex: 1 }} />
            </View>
          </Section>
        ) : null}

        {design ? <CustomizePanel design={design} patch={patch} /> : null}

        {compareEntries.length > 0 ? (
          <View style={[styles.compareTray, { backgroundColor: t.colors.surfaceAlt }]}>
            <AppText variant="label" style={{ flex: 1 }}>
              {compareEntries.length} design{compareEntries.length > 1 ? "s" : ""} selected
            </AppText>
            <Button label="Compare" disabled={compareEntries.length < 2} onPress={() => setCompareOpen(true)} />
            <Button label="Clear" variant="ghost" onPress={() => setCompareKeys([])} />
          </View>
        ) : null}

        {templates.length > 0 ? (
          <View style={{ gap: SPACE.md }}>
            <AppText variant="overline" color="link" accessibilityRole="header">
              YOUR TEMPLATES
            </AppText>
            <GalleryGrid>
              {templates.map((tpl) =>
                renderTile(
                  { key: templateKey(tpl.id), name: tpl.name, tagline: "Saved template", design: tpl.design },
                  () => deleteTemplate(tpl),
                ),
              )}
            </GalleryGrid>
          </View>
        ) : null}

        <View style={{ gap: SPACE.md }}>
          <View style={{ gap: 2 }}>
            <AppText variant="overline" color="link" accessibilityRole="header">
              DESIGN GALLERY
            </AppText>
            <Hint>{CARD_PRESETS.length} professional styles — tap to apply, touch and hold a preview to play its hover effect.</Hint>
          </View>
          <GalleryGrid>
            {CARD_PRESETS.map((p) => renderTile({ key: presetKey(p.id), name: p.name, tagline: p.tagline, design: p.design }))}
          </GalleryGrid>
        </View>
      </FormPage>

      <PreviewSheet
        entry={preview}
        theme={theme}
        sample={sample}
        device={device}
        onDevice={setDevice}
        onClose={() => setPreview(null)}
        onApply={() => {
          if (preview?.key) applyEntry(preview.key, preview.design);
          setPreview(null);
        }}
      />
      <CompareSheet
        visible={compareOpen}
        entries={compareEntries}
        theme={theme}
        sample={sample}
        device={device}
        onDevice={setDevice}
        onClose={() => setCompareOpen(false)}
        onApply={(entry) => {
          applyEntry(entry.key, entry.design);
          setCompareOpen(false);
        }}
      />
    </>
  );
}

function LivePreview({
  design,
  appliedName,
  customized,
  theme,
  sample,
  device,
  onDevice,
  onFull,
}: {
  design: CardDesign | null;
  appliedName: string;
  customized: boolean;
  theme: ReturnType<typeof cardThemeFrom>;
  sample: SampleProduct;
  device: Device;
  onDevice: (d: Device) => void;
  onFull: () => void;
}) {
  const t = useTheme();
  if (!design) {
    return (
      <Section title="Pick a card design below">
        <AppText variant="body" color="muted">
          Tap any design to apply it to your product cards and unlock the customization panel — borders, colors, shadows,
          typography, buttons and more. Your cards currently use the classic theme style.
        </AppText>
      </Section>
    );
  }
  return (
    <Section title="Live preview">
      <View style={styles.previewHead}>
        <AppText variant="bodyStrong" style={{ flex: 1 }} numberOfLines={1}>
          {appliedName}
        </AppText>
        {customized ? <Pill tone="info" size="sm" label="Customized" /> : null}
      </View>
      <Segmented segments={DEVICES} value={device} onChange={onDevice} />
      <View style={[styles.previewFrame, { backgroundColor: t.colors.surfaceAlt }]}>
        <HoldToHover>
          {(hovered) => (
            <PreviewCard
              design={design}
              theme={theme}
              sample={sample}
              width={frameWidth(device, design.layout)}
              collapse={device === "mobile"}
              hovered={hovered}
            />
          )}
        </HoldToHover>
      </View>
      <Hint>Touch and hold the card to play its hover effect. The storefront renders the real card in your theme and fonts.</Hint>
      <Button label="Full preview" icon="expand-outline" variant="secondary" onPress={onFull} />
    </Section>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: SPACE.md },
  previewHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  previewFrame: { borderRadius: 12, paddingHorizontal: SPACE.md },
  compareTray: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, padding: SPACE.md, borderRadius: 12 },
});
