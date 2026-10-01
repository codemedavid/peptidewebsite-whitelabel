import { useState } from "react";
import { Alert, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { Image } from "expo-image";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import { ImageField } from "@/features/admin/setup/ImageField";
import {
  HERO_ALT_MAX,
  HERO_FOCUSES,
  HERO_RATIOS,
  HERO_SCRIM_MAX,
  HERO_SCRIM_STEP,
  HERO_SHORT_MAX,
  HERO_SUB_MAX,
  URL_MAX,
  altFromName,
  brandName,
  heroAspect,
  heroMediaSrcIssue,
  normalizeHeroMedia,
  pageOptions,
  str,
  type HeroMedia,
} from "@/features/admin/setup/rules";
import {
  ChoicePills,
  FormPage,
  Hint,
  Loadable,
  SaveBar,
  Section,
  Stepper,
  ToggleRow,
  useDiscardGuard,
  useSavedFlash,
} from "@/features/admin/setup/ui";
import { Field } from "@/ui/inputs";
import { AppText } from "@/ui/primitives";

type LinkType = "page" | "custom";

type HeroFields = {
  chip: string;
  line1: string;
  line2: string;
  sub: string;
  cta1: string;
  cta2: string;
  cta1LinkType: LinkType;
  cta1LinkPage: string;
  cta1LinkUrl: string;
  cta2LinkType: LinkType;
  cta2LinkPage: string;
  cta2LinkUrl: string;
  media: HeroMedia;
};

const LINK_TYPES: { key: LinkType; label: string }[] = [
  { key: "page", label: "A page on your site" },
  { key: "custom", label: "Custom URL" },
];
const MEDIA_LINK_TYPES: { key: HeroMedia["linkType"]; label: string }[] = [
  { key: "page", label: "A page on your site" },
  { key: "custom", label: "Custom URL" },
  { key: "none", label: "Nothing — not clickable" },
];
const MODES: { key: HeroMedia["mode"]; label: string; hint: string }[] = [
  { key: "text", label: "Written hero", hint: "Headline, tagline and buttons styled by your theme." },
  { key: "image", label: "Uploaded image", hint: "Use one full-width image as the whole banner." },
];

function fieldsFromBrand(brand: AdminBrand): HeroFields {
  return {
    chip: str(brand.heroChipLabel),
    line1: str(brand.heroLine1),
    line2: str(brand.heroLine2),
    sub: str(brand.heroSub),
    cta1: str(brand.heroCta1),
    cta2: str(brand.heroCta2),
    cta1LinkType: brand.heroCta1LinkType === "custom" ? "custom" : "page",
    cta1LinkPage: str(brand.heroCta1LinkPage, "catalog"),
    cta1LinkUrl: str(brand.heroCta1LinkUrl),
    cta2LinkType: brand.heroCta2LinkType === "custom" ? "custom" : "page",
    cta2LinkPage: str(brand.heroCta2LinkPage, "reviews"),
    cta2LinkUrl: str(brand.heroCta2LinkUrl),
    media: normalizeHeroMedia(brand),
  };
}

/** The exact payload the web editor sends (AdminHeroSettings toPayload). */
function toPayload(f: HeroFields) {
  return {
    heroChipLabel: f.chip.trim(),
    heroLine1: f.line1.trim(),
    heroLine2: f.line2.trim(),
    heroSub: f.sub.trim(),
    heroCta1: f.cta1.trim(),
    heroCta2: f.cta2.trim(),
    heroCta1LinkType: f.cta1LinkType,
    heroCta1LinkPage: f.cta1LinkPage,
    heroCta1LinkUrl: f.cta1LinkType === "custom" ? f.cta1LinkUrl.trim() : "",
    heroCta2LinkType: f.cta2LinkType,
    heroCta2LinkPage: f.cta2LinkPage,
    heroCta2LinkUrl: f.cta2LinkType === "custom" ? f.cta2LinkUrl.trim() : "",
    heroMedia: f.media,
  };
}

/**
 * The website's Hero Section (AdminHeroSettings + AdminHeroMedia →
 * saveHeroContentAction): the written hero's copy and button links, or one
 * uploaded banner image used instead. The save writes copy, links AND the image
 * config together, so this editor always sends all three.
 */
export default function HeroScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Hero section" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState<HeroFields>(() => fieldsFromBrand(brand));
  const [fields, setFields] = useState<HeroFields>(saved);
  const [fileName, setFileName] = useState<string | null>(null);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveHeroContentAction");

  const dirty = JSON.stringify(fields) !== JSON.stringify(saved);
  useDiscardGuard(dirty);
  const pages = pageOptions(brand);
  const name = brandName(brand);
  const isText = fields.media.mode === "text";
  const showCopy = isText || fields.media.overlay;

  const set = <K extends keyof HeroFields>(key: K, value: HeroFields[K]) => {
    hideSaved();
    setFields((prev) => ({ ...prev, [key]: value }));
  };
  const setMedia = (patch: Partial<HeroMedia>) => {
    hideSaved();
    setFields((prev) => ({ ...prev, media: { ...prev.media, ...patch } }));
  };

  function onSave() {
    const payload = toPayload(fields);
    save.mutate(payload, {
      onSuccess: () => {
        // Fold the server-normalized links + media back in so a page-type
        // button's stale custom URL doesn't leave the form looking dirty.
        const next: HeroFields = {
          ...fields,
          cta1LinkUrl: payload.heroCta1LinkUrl,
          cta2LinkUrl: payload.heroCta2LinkUrl,
          media: normalizeHeroMedia(payload),
        };
        setSaved(next);
        setFields(next);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
      <AppText variant="body" color="muted">
        The big banner at the top of your storefront homepage. Choose how it looks — write your own copy, or upload a single
        image and use that instead. Colors, fonts and layout are set by your provider.
      </AppText>

      <ChoicePills label="Hero style" options={MODES} value={fields.media.mode} onChange={(mode) => setMedia({ mode })} />

      <Preview fields={fields} storeName={name} />

      {!isText ? (
        <>
          <Section title="Banner image">
            <ImageField
              label="Banner image"
              hint="JPG, PNG or WebP · at least 2000×1000px · up to 10 MB"
              value={fields.media.url}
              previewAspect={heroAspect(fields.media.ratio)}
              validate={(url) => {
                const issue = heroMediaSrcIssue(url);
                if (issue === "too-large") {
                  return "That image is too large to store for this store. Please upload a smaller file (under ~375 KB) or ask your provider to enable image hosting.";
                }
                return issue === "unsupported" ? "That image couldn't be used. Please try a JPG, PNG or WebP." : null;
              }}
              onChange={(url, file) => {
                setFileName(url ? (file ?? null) : null);
                // Only seed alt text when the owner hasn't written their own.
                setMedia({ url, ...(url && file && !fields.media.alt.trim() ? { alt: altFromName(file) } : {}) });
              }}
            />
            {fields.media.url ? (
              <>
                <Hint>{fileName ?? "Current banner — uploaded to your store's media library"}</Hint>
                <ChoicePills label="Banner height" options={HERO_RATIOS} value={fields.media.ratio} onChange={(ratio) => setMedia({ ratio })} />
                <ChoicePills label="Focus point" options={HERO_FOCUSES} value={fields.media.focus} onChange={(focus) => setMedia({ focus })} />
                <Hint>Focus point keeps the important part of the photo visible on phones.</Hint>
                <Field
                  label="Image description (alt text)"
                  value={fields.media.alt}
                  onChangeText={(alt) => setMedia({ alt })}
                  maxLength={HERO_ALT_MAX}
                  placeholder="Describe the image for screen readers"
                  hint="Read aloud to shoppers using a screen reader, and shown if the image fails to load."
                />
                <ChoicePills
                  label="Where does the banner link? The whole image becomes clickable."
                  options={MEDIA_LINK_TYPES}
                  value={fields.media.linkType}
                  onChange={(linkType) => setMedia({ linkType })}
                />
                {fields.media.linkType === "page" ? (
                  <ChoicePills label="Destination page" options={pages} value={fields.media.linkPage} onChange={(linkPage) => setMedia({ linkPage })} />
                ) : null}
                {fields.media.linkType === "custom" ? (
                  <UrlField value={fields.media.linkUrl} onChange={(linkUrl) => setMedia({ linkUrl })} />
                ) : null}
              </>
            ) : (
              <Hint>While no image is uploaded, your storefront keeps showing the written hero.</Hint>
            )}
          </Section>

          <Section title="Text over the image">
            <ToggleRow
              label="Show text over the image"
              hint="Off means the image speaks for itself. On reuses the headline and buttons from your written hero."
              value={fields.media.overlay}
              onChange={(overlay) => setMedia({ overlay })}
            />
            {fields.media.overlay ? (
              <>
                <Stepper
                  label="Dark scrim over image"
                  value={fields.media.scrim}
                  display={`${fields.media.scrim}%`}
                  min={0}
                  max={HERO_SCRIM_MAX}
                  step={HERO_SCRIM_STEP}
                  onChange={(scrim) => setMedia({ scrim })}
                />
                <Hint>Add a scrim so text stays readable on busy photos.</Hint>
              </>
            ) : null}
          </Section>
        </>
      ) : null}

      {showCopy ? (
        <Section title="Content">
          <Field
            label="Badge / chip label"
            value={fields.chip}
            onChangeText={(v) => set("chip", v)}
            maxLength={HERO_SHORT_MAX}
            placeholder={name || "e.g. NEW ARRIVAL"}
            hint="The small pill above the headline. Leave blank to show your store name."
          />
          <Field label="Headline — line 1" value={fields.line1} onChangeText={(v) => set("line1", v)} maxLength={HERO_SHORT_MAX} placeholder="Premium products," />
          <Field
            label="Headline — line 2 (accent)"
            value={fields.line2}
            onChangeText={(v) => set("line2", v)}
            maxLength={HERO_SHORT_MAX}
            placeholder="for everyone"
            hint="Leave line 2 blank for a single-line headline."
          />
          <Field
            label="Tagline"
            value={fields.sub}
            onChangeText={(v) => set("sub", v)}
            maxLength={HERO_SUB_MAX}
            multiline
            placeholder="A short sentence describing what your store offers."
            hint={`The supporting text under the headline. ${fields.sub.length} / ${HERO_SUB_MAX}`}
          />
        </Section>
      ) : null}

      {showCopy ? (
        <Section title="Call to action">
          <Field label="Primary button label" value={fields.cta1} onChangeText={(v) => set("cta1", v)} maxLength={HERO_SHORT_MAX} placeholder="Shop Now" />
          <CtaLink
            n={1}
            type={fields.cta1LinkType}
            page={fields.cta1LinkPage}
            url={fields.cta1LinkUrl}
            pages={pages}
            onType={(v) => set("cta1LinkType", v)}
            onPage={(v) => set("cta1LinkPage", v)}
            onUrl={(v) => set("cta1LinkUrl", v)}
          />
          <Field
            label="Secondary button label"
            value={fields.cta2}
            onChangeText={(v) => set("cta2", v)}
            maxLength={HERO_SHORT_MAX}
            placeholder="Learn More"
            hint="Leave the label blank to hide the second button."
          />
          <CtaLink
            n={2}
            type={fields.cta2LinkType}
            page={fields.cta2LinkPage}
            url={fields.cta2LinkUrl}
            pages={pages}
            onType={(v) => set("cta2LinkType", v)}
            onPage={(v) => set("cta2LinkPage", v)}
            onUrl={(v) => set("cta2LinkUrl", v)}
          />
        </Section>
      ) : null}
    </FormPage>
  );
}

function UrlField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field
      label="Custom URL"
      value={value}
      onChangeText={onChange}
      maxLength={URL_MAX}
      placeholder="https://"
      keyboardType="url"
      autoCapitalize="none"
      autoCorrect={false}
    />
  );
}

function CtaLink({
  n,
  type,
  page,
  url,
  pages,
  onType,
  onPage,
  onUrl,
}: {
  n: 1 | 2;
  type: LinkType;
  page: string;
  url: string;
  pages: { key: string; label: string }[];
  onType: (v: LinkType) => void;
  onPage: (v: string) => void;
  onUrl: (v: string) => void;
}) {
  return (
    <View style={{ gap: SPACE.md }}>
      <ChoicePills label={`Button ${n} links to`} options={LINK_TYPES} value={type} onChange={onType} />
      {type === "page" ? (
        <ChoicePills label={`Button ${n} destination page`} options={pages} value={page} onChange={onPage} />
      ) : (
        <UrlField value={url} onChange={onUrl} />
      )}
    </View>
  );
}

/** A phone-width sketch of what customers see (the site renders it in its theme). */
function Preview({ fields, storeName }: { fields: HeroFields; storeName: string }) {
  const t = useTheme();
  const m = fields.media;
  const headline = fields.line1 || "Premium products,";
  const cta1 = fields.cta1 || "Shop Now";
  // Image mode only wins once an image exists — the storefront's own rule.
  if (m.mode === "image" && m.url) {
    const scrim = m.overlay ? m.scrim / 100 : 0;
    return (
      <View style={[styles.media, { aspectRatio: 4 / 3 }]} accessible accessibilityLabel={`Hero preview: ${m.alt || "banner image"}`}>
        <Image source={{ uri: m.url }} style={StyleSheet.absoluteFill} contentFit="cover" contentPosition={m.focus} />
        {scrim > 0 ? <View style={[StyleSheet.absoluteFill, { backgroundColor: `rgba(0,0,0,${scrim})` }]} /> : null}
        {m.overlay ? (
          <View style={styles.overlay}>
            <AppText variant="title" brandFont color="#FFFFFF">
              {headline} {fields.line2 ? <AppText variant="title" italic color="#FFFFFF">{fields.line2}</AppText> : null}
            </AppText>
            <View style={[styles.cta, { backgroundColor: t.brand.primary }]}>
              <AppText variant="label" color="onPrimary">
                {cta1}
              </AppText>
            </View>
          </View>
        ) : null}
      </View>
    );
  }
  if (m.mode === "image") {
    return (
      <View style={[styles.hero, { backgroundColor: t.colors.surfaceAlt }]}>
        <AppText variant="bodyStrong">No image uploaded yet</AppText>
        <Hint>Upload one below and it appears here instantly. Until then your storefront keeps showing the written hero.</Hint>
      </View>
    );
  }
  const badge = (fields.chip || storeName).toUpperCase();
  return (
    <View style={[styles.hero, { backgroundColor: t.colors.surfaceAlt }]} accessible accessibilityLabel={`Hero preview: ${headline} ${fields.line2}`}>
      {badge ? (
        <View style={[styles.chip, { borderColor: t.colors.border }]}>
          <AppText variant="overline" color="muted">
            {badge}
          </AppText>
        </View>
      ) : null}
      <AppText variant="title" brandFont>
        {headline}
      </AppText>
      {fields.line2 ? (
        <AppText variant="title" italic color="link">
          {fields.line2}
        </AppText>
      ) : null}
      {fields.sub ? (
        <AppText variant="body" color="muted">
          {fields.sub}
        </AppText>
      ) : null}
      <View style={styles.ctas}>
        <View style={[styles.cta, { backgroundColor: t.brand.primary }]}>
          <AppText variant="label" color="onPrimary">
            {cta1}
          </AppText>
        </View>
        {fields.cta2 ? (
          <View style={[styles.cta, { borderWidth: 1, borderColor: t.colors.border }]}>
            <AppText variant="label">{fields.cta2}</AppText>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { padding: SPACE.xl, borderRadius: RADIUS.lg, gap: SPACE.sm },
  media: { width: "100%", borderRadius: RADIUS.lg, overflow: "hidden", justifyContent: "flex-end" },
  overlay: { padding: SPACE.lg, gap: SPACE.md },
  chip: { alignSelf: "flex-start", borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4 },
  ctas: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, marginTop: SPACE.sm },
  cta: { alignSelf: "flex-start", paddingHorizontal: SPACE.lg, paddingVertical: SPACE.sm, borderRadius: RADIUS.md },
});
