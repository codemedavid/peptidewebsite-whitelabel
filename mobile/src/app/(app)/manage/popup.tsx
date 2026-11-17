import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import type { AdminBrand } from "@/features/admin/bridge";
import { SelectField } from "@/features/admin/catalog/components";
import { useCatalogProducts } from "@/features/admin/catalog/hooks";
import {
  KIND_META,
  LAYOUT_META,
  normalizeAnnouncementPopup,
  POPUP_DELAYS,
  POPUP_KINDS,
  POPUP_LAYOUTS,
  POPUP_LIMITS,
  validatePopup,
  type AnnouncementPopup,
  type PopupAction,
  type PopupField,
} from "@/features/admin/content/announcement-popup";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { pickAndUploadImage } from "@/features/admin/setup/ImageField";
import { pageOptions } from "@/features/admin/setup/rules";
import { ChoicePills, FormPage, Hint, Loadable, SaveBar, Section, ToggleRow, useDiscardGuard, useSavedFlash } from "@/features/admin/setup/ui";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * The website's Announcement Pop-up (AdminAnnouncementPopup.tsx →
 * saveAnnouncementPopupAction): a card that greets shoppers when they open the
 * store — news, a new drop or a promo code. The server re-validates, trims and
 * versions it (a new version re-shows "once" pop-ups to shoppers who closed it).
 */
export default function PopupScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Announcement pop-up" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

const ACTION_LABELS: Record<PopupAction, string> = {
  close: "Just close the pop-up",
  page: "Open a page on my store",
  product: "Open a product",
  link: "Open a web link",
};

/** Only the fields an owner edits — version/updatedAt are the server's. */
const editable = (p: AnnouncementPopup): AnnouncementPopup => ({
  enabled: p.enabled,
  kind: p.kind,
  layout: p.layout,
  title: p.title,
  message: p.message,
  image: p.image,
  code: p.code,
  buttonLabel: p.buttonLabel,
  action: p.action,
  linkPage: p.linkPage,
  productId: p.productId,
  linkUrl: p.linkUrl,
  frequency: p.frequency,
  delaySeconds: p.delaySeconds,
  startDate: p.startDate,
  endDate: p.endDate,
});

function Editor({ brand }: { brand: AdminBrand }) {
  const t = useTheme();
  const products = useCatalogProducts(brand);
  const [saved, setSaved] = useState<AnnouncementPopup>(() => editable(normalizeAnnouncementPopup(brand.announcementPopup)));
  const [draft, setDraft] = useState<AnnouncementPopup>(saved);
  const [uploading, setUploading] = useState(false);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveAnnouncementPopupAction");

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useDiscardGuard(dirty);
  const errors = new Map<PopupField, string>(validatePopup(draft).map((e) => [e.field, e.message]));

  const set = <K extends keyof AnnouncementPopup>(key: K, value: AnnouncementPopup[K]) => {
    hideSaved();
    setDraft((d) => ({ ...d, [key]: value }));
  };

  async function chooseImage() {
    try {
      const res = await pickAndUploadImage(() => setUploading(true), "storefront");
      if (!res) return;
      // width / height, so the storefront card reserves the right space before it loads.
      const aspect = res.width && res.height ? res.width / res.height : 1;
      set("image", { url: res.url, aspect });
    } finally {
      setUploading(false);
    }
  }

  function onSave() {
    const first = errors.values().next();
    if (!first.done) {
      Alert.alert("Check the pop-up", first.value);
      return;
    }
    save.mutate(draft, {
      onSuccess: () => {
        setSaved(draft);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  const productOptions = (products.data ?? []).map((p) => ({ value: p.id, label: p.name }));
  const buttonPlaceholder = KIND_META[draft.kind].defaultButton;

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} disabled={uploading} onSave={onSave} />}>
      <Section
        title="Pop-up"
        hint="Greets shoppers when they open your store: news, a new drop or a promo code. It uses your store's colours and fonts automatically."
      >
        <ToggleRow label="Show the pop-up on my store" value={draft.enabled} onChange={(v) => set("enabled", v)} />
        <ChoicePills
          label="Type"
          options={POPUP_KINDS.map((k) => ({ key: k, label: KIND_META[k].label, hint: KIND_META[k].hint }))}
          value={draft.kind}
          onChange={(k) => set("kind", k)}
        />
        <Field label="Title" value={draft.title} onChangeText={(v) => set("title", v)} maxLength={POPUP_LIMITS.title} error={errors.get("title") ?? null} />
        <Field
          label="Message"
          value={draft.message}
          onChangeText={(v) => set("message", v)}
          maxLength={POPUP_LIMITS.message}
          multiline
          hint={`${draft.message.length}/${POPUP_LIMITS.message}`}
          error={errors.get("message") ?? null}
        />
        <Field
          label="Promo code (optional)"
          value={draft.code}
          onChangeText={(v) => set("code", v)}
          maxLength={POPUP_LIMITS.code}
          autoCapitalize="characters"
          hint="Shown as a chip shoppers can tap to copy."
          error={errors.get("code") ?? null}
        />
      </Section>

      <Section title="Image" hint="Optional. A photo of the drop or the offer.">
        {draft.image ? (
          <View style={[styles.image, { borderColor: t.colors.border, aspectRatio: draft.image.aspect }]}>
            <Image source={{ uri: draft.image.url }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityLabel="Pop-up image" />
          </View>
        ) : null}
        <View style={styles.row}>
          <Button
            label={uploading ? "Uploading…" : draft.image ? "Change image" : "Add image"}
            icon="image-outline"
            variant="secondary"
            loading={uploading}
            onPress={() => void chooseImage()}
          />
          {draft.image ? <Button label="Remove" icon="trash-outline" variant="ghost" onPress={() => set("image", null)} /> : null}
        </View>
        {draft.image ? (
          <ChoicePills
            label="Layout"
            options={POPUP_LAYOUTS.map((l) => ({ key: l, label: LAYOUT_META[l].label, hint: LAYOUT_META[l].hint }))}
            value={draft.layout}
            onChange={(l) => set("layout", l)}
          />
        ) : null}
      </Section>

      <Section title="Button">
        <Field
          label="Button text"
          value={draft.buttonLabel}
          onChangeText={(v) => set("buttonLabel", v)}
          maxLength={POPUP_LIMITS.buttonLabel}
          placeholder={buttonPlaceholder}
          hint={`Blank uses "${buttonPlaceholder}".`}
          error={errors.get("buttonLabel") ?? null}
        />
        <SelectField
          label="When tapped"
          value={draft.action}
          options={(Object.keys(ACTION_LABELS) as PopupAction[]).map((a) => ({ value: a, label: ACTION_LABELS[a] }))}
          onChange={(v) => set("action", v as PopupAction)}
        />
        {draft.action === "page" ? (
          <SelectField
            label="Page"
            value={draft.linkPage}
            options={pageOptions(brand).map((o) => ({ value: o.key, label: o.label }))}
            onChange={(v) => set("linkPage", v)}
          />
        ) : null}
        {draft.action === "product" ? (
          <>
            <SelectField label="Product" value={draft.productId} options={productOptions} onChange={(v) => set("productId", v)} placeholder="Choose a product…" />
            {errors.get("productId") ? <Hint tone="danger">{errors.get("productId")}</Hint> : null}
          </>
        ) : null}
        {draft.action === "link" ? (
          <Field
            label="Web link"
            value={draft.linkUrl}
            onChangeText={(v) => set("linkUrl", v)}
            maxLength={POPUP_LIMITS.linkUrl}
            placeholder="https://"
            autoCapitalize="none"
            keyboardType="url"
            error={errors.get("linkUrl") ?? null}
          />
        ) : null}
      </Section>

      <Section title="When it shows" hint="Leave the dates blank to show it until you switch it off.">
        <ChoicePills
          label="How often"
          options={[
            { key: "once", label: "Once", hint: "Until you change the pop-up" },
            { key: "every_visit", label: "Every visit", hint: "Each time they come back" },
          ]}
          value={draft.frequency}
          onChange={(f) => set("frequency", f)}
        />
        <ChoicePills
          label="Appears"
          options={POPUP_DELAYS.map((s) => ({ key: String(s), label: s === 0 ? "Right away" : `After ${s} seconds` }))}
          value={String(draft.delaySeconds)}
          onChange={(s) => set("delaySeconds", Number(s))}
        />
        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Field label="Start date" value={draft.startDate} onChangeText={(v) => set("startDate", v.trim())} placeholder="YYYY-MM-DD" maxLength={10} />
          </View>
          <View style={{ flex: 1 }}>
            <Field
              label="End date"
              value={draft.endDate}
              onChangeText={(v) => set("endDate", v.trim())}
              placeholder="YYYY-MM-DD"
              maxLength={10}
              error={errors.get("endDate") ?? null}
            />
          </View>
        </View>
      </Section>

      <Section title="Preview" hint={draft.enabled ? "Roughly what shoppers see." : "Currently hidden from shoppers."}>
        <View style={[styles.preview, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          {draft.image ? (
            <View style={[styles.previewImage, { aspectRatio: draft.image.aspect }]}>
              <Image source={{ uri: draft.image.url }} style={StyleSheet.absoluteFill} contentFit="cover" />
            </View>
          ) : null}
          <AppText variant="overline" color="link">
            {KIND_META[draft.kind].badge.toUpperCase()}
          </AppText>
          {draft.title ? <AppText variant="heading">{draft.title}</AppText> : null}
          {draft.message ? (
            <AppText variant="body" color="muted">
              {draft.message}
            </AppText>
          ) : null}
          {draft.code ? (
            <View style={[styles.code, { borderColor: t.colors.border }]}>
              <AppText variant="bodyStrong">{draft.code}</AppText>
            </View>
          ) : null}
          <View style={[styles.cta, { backgroundColor: t.brand.primary }]}>
            <AppText variant="bodyStrong" color={t.brand.onPrimary}>
              {draft.buttonLabel.trim() || buttonPlaceholder}
            </AppText>
          </View>
        </View>
        <Hint>{"The live pop-up uses your storefront's colours and fonts."}</Hint>
      </Section>
    </FormPage>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, alignItems: "flex-start" },
  image: { width: "100%", borderRadius: RADIUS.md, borderWidth: 1, overflow: "hidden" },
  preview: { gap: SPACE.sm, padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1, overflow: "hidden" },
  previewImage: { width: "100%", borderRadius: RADIUS.md, overflow: "hidden" },
  code: { alignSelf: "flex-start", borderWidth: 1, borderStyle: "dashed", borderRadius: RADIUS.md, paddingHorizontal: SPACE.md, paddingVertical: 6 },
  cta: { alignItems: "center", paddingVertical: SPACE.md, borderRadius: RADIUS.md, marginTop: SPACE.xs },
});
