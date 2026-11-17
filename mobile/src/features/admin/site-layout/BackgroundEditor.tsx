// The Background Settings panel — one per card, box, banner and section. The
// native twin of src/storefront/admin/site-builder/BackgroundEditor.tsx: edits a
// SectionBackground and shows a small swatch (colour, image at its opacity,
// overlay) with sample text that stays fully opaque, like the live element.

import { StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { BACKGROUND_POSITIONS, CUSTOM_SIZE_MAX, CUSTOM_SIZE_MIN, DEFAULT_IMAGE_OPACITY, type BackgroundType, type SectionBackground } from "./config";
import { ColorField, Group, ImageInput, Range, Select } from "./fields";
import { safeCssColor } from "./normalize";

const TYPE_OPTIONS: { value: BackgroundType; label: string }[] = [
  { value: "color", label: "Colour" },
  { value: "image", label: "Image" },
  { value: "image-color", label: "Image + colour" },
];

const POSITION_LABELS: Record<string, string> = { center: "Center", top: "Top", bottom: "Bottom", left: "Left", right: "Right" };

/**
 * The element's colour, up front. Picking a colour on an image-only background
 * turns it into image + colour, so the photo keeps showing and now blends.
 */
export function CardColorInput({ label = "Card colour", value, onChange }: { label?: string; value: SectionBackground; onChange: (bg: SectionBackground) => void }) {
  return (
    <ColorField
      label={label}
      value={value.color}
      emptyLabel="None"
      onChange={(color) => onChange({ ...value, color, type: value.type === "image" && color ? "image-color" : value.type })}
    />
  );
}

function Swatch({ bg, textColor }: { bg: SectionBackground; textColor: string }) {
  const t = useTheme();
  const showImage = bg.type !== "color" && !!bg.imageUrl;
  const color = bg.type === "image" ? "transparent" : safeCssColor(bg.color) || "transparent";
  const overlay = safeCssColor(bg.overlayColor);
  const ink = safeCssColor(textColor) || t.colors.text;
  const fit = bg.size === "contain" ? "contain" : "cover";
  return (
    <View accessibilityRole="image" accessibilityLabel="Background preview" style={[styles.swatch, { backgroundColor: color, borderColor: t.colors.border }]}>
      {showImage ? (
        <Image source={{ uri: bg.imageUrl }} style={[StyleSheet.absoluteFill, { opacity: bg.imageOpacity / 100 }]} contentFit={fit} contentPosition={bg.position} />
      ) : null}
      {overlay ? <View style={[StyleSheet.absoluteFill, { backgroundColor: overlay, opacity: bg.overlayOpacity / 100 }]} /> : null}
      <AppText variant="bodyStrong" color={ink}>
        Sample heading
      </AppText>
      <AppText variant="caption" color={ink}>
        Text stays fully readable.
      </AppText>
    </View>
  );
}

export function BackgroundEditor({
  value,
  onChange,
  textColor = "",
  title = "Background",
}: {
  value: SectionBackground;
  onChange: (bg: SectionBackground) => void;
  textColor?: string;
  title?: string;
}) {
  const set = (patch: Partial<SectionBackground>) => onChange({ ...value, ...patch });
  const usesImage = value.type !== "color";
  const usesColor = value.type !== "image";
  const badge = value.type === "color" ? "Colour" : value.imageUrl ? `Image ${value.imageOpacity}%` : "Image (none yet)";

  return (
    <Group title={title} badge={badge}>
      <Swatch bg={value} textColor={textColor} />
      <Select label="Background type" value={value.type} options={TYPE_OPTIONS} onChange={(type) => set({ type })} />
      {usesColor ? <ColorField label="Background colour" value={value.color} onChange={(color) => set({ color })} emptyLabel="None" /> : null}
      {usesImage ? (
        <>
          <ImageInput
            label="Background image"
            value={value.imageUrl}
            hint="Large photos are resized automatically for fast loading."
            onChange={(imageUrl) => set({ imageUrl, imageOpacity: value.imageUrl ? value.imageOpacity : DEFAULT_IMAGE_OPACITY })}
          />
          <Range label="Image opacity" value={value.imageOpacity} onChange={(imageOpacity) => set({ imageOpacity })} />
          <AppText variant="caption" color="faint">
            Only the image fades. Text and buttons stay solid. 10–20% is a subtle texture.
          </AppText>
          <Select
            label="Image position"
            value={value.position}
            options={BACKGROUND_POSITIONS.map((p) => ({ value: p, label: POSITION_LABELS[p] }))}
            onChange={(position) => set({ position })}
          />
          <Select
            label="Image size"
            value={value.size}
            options={[
              { value: "cover", label: "Cover (fill)" },
              { value: "contain", label: "Contain (whole image)" },
              { value: "custom", label: "Custom" },
            ]}
            onChange={(size) => set({ size })}
          />
          {value.size === "custom" ? (
            <Range label="Image width" value={value.customSize} min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} step={10} onChange={(customSize) => set({ customSize })} />
          ) : null}
          <ColorField label="Overlay colour" value={value.overlayColor} onChange={(overlayColor) => set({ overlayColor })} emptyLabel="None" />
          {value.overlayColor ? (
            <>
              <Range label="Overlay opacity" value={value.overlayOpacity} onChange={(overlayOpacity) => set({ overlayOpacity })} />
              <AppText variant="caption" color="faint">
                A soft overlay keeps text readable over a busy photo.
              </AppText>
            </>
          ) : null}
        </>
      ) : null}
    </Group>
  );
}

const styles = StyleSheet.create({
  swatch: { minHeight: 88, borderRadius: RADIUS.md, borderWidth: 1, overflow: "hidden", padding: SPACE.md, gap: 4, justifyContent: "center" },
});
