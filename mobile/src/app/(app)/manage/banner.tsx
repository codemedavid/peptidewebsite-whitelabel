import { useRef, useState } from "react";
import { Alert, Pressable, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import type { AdminBrand } from "@/features/admin/bridge";
import { useAdminBrand, useSetupSave } from "@/features/admin/setup/data";
import {
  BANNER_AUTOPLAY_MAX,
  BANNER_AUTOPLAY_MIN,
  BANNER_MODES,
  BANNER_TEXT_MAX,
  MAX_BANNER_SLIDES,
  URL_MAX,
  normalizeBanner,
  pageOptions,
  type Banner,
  type BannerLinkType,
  type BannerMode,
  type BannerSlide,
  type BannerSpeed,
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
import { AppText, Button, Card } from "@/ui/primitives";

const MODE_LABEL: Record<BannerMode, { label: string; hint: string }> = {
  single: { label: "Single", hint: "One fixed message" },
  carousel: { label: "Carousel", hint: "Messages auto-rotate" },
  marquee: { label: "Live scroll", hint: "Slides sideways" },
};
const LINK_TYPES: { key: BannerLinkType; label: string }[] = [
  { key: "none", label: "Nothing (just text)" },
  { key: "page", label: "A page on your site" },
  { key: "custom", label: "Custom URL" },
];
const SPEEDS: { key: BannerSpeed; label: string }[] = [
  { key: "slow", label: "Slow" },
  { key: "normal", label: "Normal" },
  { key: "fast", label: "Fast" },
];
const SECOND_MS = 1000;
// Colours React Native can paint for the preview (the site also takes oklch()/var()).
const NATIVE_COLOR = /^(#[0-9a-f]{3,8}|rgba?\([^)]*\)|hsla?\([^)]*\)|[a-z]+)$/i;

/**
 * The website's Announcement Banner (AdminBannerSettings → saveBannerAction):
 * the slim bar under the site header. Layout, messages (each optionally
 * linking to a page or URL) and per-layout options. The server sanitizes every
 * link and colour on save; blank messages are dropped.
 */
export default function BannerScreen() {
  const brand = useAdminBrand();
  return (
    <>
      <Stack.Screen options={{ title: "Announcement banner" }} />
      <Loadable query={brand}>{(b) => <Editor brand={b} />}</Loadable>
    </>
  );
}

function Editor({ brand }: { brand: AdminBrand }) {
  const [saved, setSaved] = useState<Banner>(() => normalizeBanner(brand.banner));
  const [banner, setBanner] = useState<Banner>(saved);
  const [flash, showSaved, hideSaved] = useSavedFlash();
  const save = useSetupSave("saveBannerAction");
  // Stable keys for newly-added messages (ids are re-derived server-side).
  const nextId = useRef(0);

  const dirty = JSON.stringify(banner) !== JSON.stringify(saved);
  useDiscardGuard(dirty);
  const pages = pageOptions(brand);

  const update = (patch: Partial<Banner>) => {
    hideSaved();
    setBanner((b) => ({ ...b, ...patch }));
  };
  const updateSlide = (id: string, patch: Partial<BannerSlide>) =>
    update({ slides: banner.slides.map((s) => (s.id === id ? { ...s, ...patch } : s)) });
  const addSlide = () => {
    if (banner.slides.length >= MAX_BANNER_SLIDES) return;
    update({
      slides: [...banner.slides, { id: `new-${nextId.current++}`, text: "", linkType: "none", linkPage: "catalog", linkUrl: "" }],
    });
  };
  const removeSlide = (id: string) => update({ slides: banner.slides.filter((s) => s.id !== id) });
  const moveSlide = (index: number, dir: -1 | 1) => {
    const to = index + dir;
    if (to < 0 || to >= banner.slides.length) return;
    const slides = [...banner.slides];
    [slides[index], slides[to]] = [slides[to], slides[index]];
    update({ slides });
  };

  function onSave() {
    save.mutate(banner, {
      onSuccess: () => {
        // Re-normalize so the baseline matches what the server kept (blank
        // messages dropped, links sanitized, colours filtered).
        const clean = normalizeBanner(banner);
        setSaved(clean);
        setBanner(clean);
        showSaved();
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });
  }

  return (
    <FormPage footer={<SaveBar dirty={dirty} saving={save.isPending} saved={flash} onSave={onSave} />}>
      <AppText variant="body" color="muted">
        A slim bar that appears directly under your site header — great for promos, shipping notices or launches. Turn it on,
        pick a style, and add your messages.
      </AppText>

      <Preview banner={banner} />

      <Section title="Display">
        <ToggleRow label="Show the announcement banner" value={banner.enabled} onChange={(enabled) => update({ enabled })} />
        <ChoicePills
          label="Style"
          options={BANNER_MODES.map((m) => ({ key: m, ...MODE_LABEL[m] }))}
          value={banner.mode}
          onChange={(mode) => update({ mode })}
        />
      </Section>

      <Section title="Messages">
        {banner.slides.length === 0 ? <Hint>No messages yet — add your first one below.</Hint> : null}
        {banner.slides.map((slide, i) => (
          <SlideEditor
            key={slide.id}
            index={i}
            slide={slide}
            count={banner.slides.length}
            pages={pages}
            onChange={(patch) => updateSlide(slide.id, patch)}
            onMove={(dir) => moveSlide(i, dir)}
            onRemove={() => removeSlide(slide.id)}
          />
        ))}
        <Button
          label="Add message"
          icon="add"
          variant="secondary"
          disabled={banner.slides.length >= MAX_BANNER_SLIDES}
          onPress={addSlide}
        />
        {banner.slides.length >= MAX_BANNER_SLIDES ? <Hint>Up to {MAX_BANNER_SLIDES} messages.</Hint> : null}
        {banner.mode === "single" && banner.slides.length > 1 ? (
          <Hint>“Single” shows only the first message. Switch to Carousel or Live scroll to show them all.</Hint>
        ) : null}
      </Section>

      <Section title="Options">
        <Field
          label="Background color (optional)"
          value={banner.bgColor}
          onChangeText={(bgColor) => update({ bgColor })}
          placeholder="e.g. #101820 (blank = brand accent)"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Field
          label="Text color (optional)"
          value={banner.textColor}
          onChangeText={(textColor) => update({ textColor })}
          placeholder="e.g. #ffffff"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {banner.mode === "carousel" ? (
          <Stepper
            label="Rotate every"
            value={banner.autoplayMs}
            display={`${(banner.autoplayMs / SECOND_MS).toFixed(0)}s`}
            min={BANNER_AUTOPLAY_MIN}
            max={BANNER_AUTOPLAY_MAX}
            step={SECOND_MS}
            onChange={(autoplayMs) => update({ autoplayMs })}
          />
        ) : null}
        {banner.mode === "marquee" ? (
          <ChoicePills label="Scroll speed" options={SPEEDS} value={banner.speed} onChange={(speed) => update({ speed })} />
        ) : null}
        {banner.mode === "carousel" || banner.mode === "marquee" ? (
          <ToggleRow
            label="Pause when a visitor hovers"
            value={banner.pauseOnHover}
            onChange={(pauseOnHover) => update({ pauseOnHover })}
          />
        ) : null}
      </Section>
    </FormPage>
  );
}

function SlideEditor({
  index,
  slide,
  count,
  pages,
  onChange,
  onMove,
  onRemove,
}: {
  index: number;
  slide: BannerSlide;
  count: number;
  pages: { key: string; label: string }[];
  onChange: (patch: Partial<BannerSlide>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
}) {
  const t = useTheme();
  const icon = (name: "arrow-up" | "arrow-down" | "close", label: string, onPress: () => void, disabled = false) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={[styles.iconBtn, { borderColor: t.colors.border, opacity: disabled ? 0.35 : 1 }]}
    >
      <Ionicons name={name} size={18} color={name === "close" ? t.tone("danger").fg : t.colors.text} />
    </Pressable>
  );
  return (
    <Card style={{ gap: SPACE.md, backgroundColor: t.colors.bg }}>
      <View style={styles.slideHead}>
        <AppText variant="bodyStrong" style={{ flex: 1 }}>
          Message {index + 1}
        </AppText>
        {icon("arrow-up", `Move message ${index + 1} up`, () => onMove(-1), index === 0)}
        {icon("arrow-down", `Move message ${index + 1} down`, () => onMove(1), index === count - 1)}
        {icon("close", `Remove message ${index + 1}`, onRemove)}
      </View>
      <Field
        label="Text"
        value={slide.text}
        onChangeText={(text) => onChange({ text })}
        maxLength={BANNER_TEXT_MAX}
        placeholder="e.g. Free shipping on orders over $150"
      />
      <ChoicePills label="Links to" options={LINK_TYPES} value={slide.linkType} onChange={(linkType) => onChange({ linkType })} />
      {slide.linkType === "page" ? (
        <ChoicePills label="Destination page" options={pages} value={slide.linkPage} onChange={(linkPage) => onChange({ linkPage })} />
      ) : null}
      {slide.linkType === "custom" ? (
        <Field
          label="Custom URL"
          value={slide.linkUrl}
          onChangeText={(linkUrl) => onChange({ linkUrl })}
          maxLength={URL_MAX}
          placeholder="https://"
          keyboardType="url"
          autoCapitalize="none"
          autoCorrect={false}
        />
      ) : null}
    </Card>
  );
}

/** A customer-eye sketch of the bar (the site renders the real one in its theme). */
function Preview({ banner }: { banner: Banner }) {
  const t = useTheme();
  const bg = NATIVE_COLOR.test(banner.bgColor.trim()) ? banner.bgColor.trim() : t.brand.primary;
  const fg = NATIVE_COLOR.test(banner.textColor.trim()) ? banner.textColor.trim() : t.brand.onPrimary;
  const texts = banner.slides.map((s) => s.text.trim()).filter(Boolean);
  const shown = banner.mode === "single" ? texts.slice(0, 1) : texts;
  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="overline" color="link">
        LIVE PREVIEW
      </AppText>
      {shown.length ? (
        <View style={[styles.bar, { backgroundColor: bg }]} accessible accessibilityLabel={`Banner preview: ${shown.join(". ")}`}>
          <AppText variant="label" color={fg} numberOfLines={2} style={{ textAlign: "center" }}>
            {shown.join("   •   ")}
          </AppText>
        </View>
      ) : (
        <Hint>Add a message to see the banner.</Hint>
      )}
      <Hint>
        {banner.enabled
          ? "The live bar uses your storefront theme and fonts."
          : "The banner is currently turned off — the preview shows how it would look once enabled."}
      </Hint>
    </View>
  );
}

const styles = StyleSheet.create({
  slideHead: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  iconBtn: { width: 36, height: 36, borderRadius: RADIUS.md, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  bar: { paddingVertical: SPACE.md, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.md },
});
