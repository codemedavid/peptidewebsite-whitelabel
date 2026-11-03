"use client";

// The Background Settings panel — one per card, box, banner and section.
// Edits a SectionBackground (lib/storefront/section-background.ts) and shows a
// live swatch rendered with the SAME bgProps() the storefront uses, so what
// the owner sees here (sample text staying crisp over a faint image) is
// exactly what the live element will do.

import {
  BACKGROUND_POSITIONS,
  CUSTOM_SIZE_MAX,
  CUSTOM_SIZE_MIN,
  DEFAULT_IMAGE_OPACITY,
  type BackgroundType,
  type SectionBackground,
} from "@/lib/storefront/section-background";
import { bgProps } from "../../components/intl-local/il-style";
import { ColorInput, Group, ImageInput, SelectInput, Slider } from "./fields";

const TYPE_OPTIONS: { value: BackgroundType; label: string }[] = [
  { value: "color", label: "Colour" },
  { value: "image", label: "Image" },
  { value: "image-color", label: "Image + colour" },
];

const POSITION_LABELS: Record<string, string> = { center: "Center", top: "Top", bottom: "Bottom", left: "Left", right: "Right" };

/**
 * The element's colour, up front where the owner looks for it (the full
 * Background panel below holds the rest). Picking a colour on an image-only
 * background turns it into image + colour, so the photo keeps showing and
 * now blends with the new colour instead of the pick doing nothing.
 */
export function CardColorInput({
  label = "Card colour",
  value,
  onChange,
}: {
  label?: string;
  value: SectionBackground;
  onChange: (bg: SectionBackground) => void;
}) {
  return (
    <ColorInput
      label={label}
      value={value.color}
      emptyLabel="None"
      onChange={(color) => onChange({ ...value, color, type: value.type === "image" && color ? "image-color" : value.type })}
    />
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
  /** The element's text colour, so the swatch previews readability. */
  textColor?: string;
  title?: string;
}) {
  const set = (patch: Partial<SectionBackground>) => onChange({ ...value, ...patch });
  const usesImage = value.type !== "color";
  const usesColor = value.type !== "image";
  const swatch = bgProps(value, "sb-bgswatch", textColor);
  const badge = value.type === "color" ? "Colour" : value.imageUrl ? `Image ${value.imageOpacity}%` : "Image (none yet)";

  return (
    <Group title={title} badge={badge}>
      <div className="sb-bg">
        <div className={swatch.className} style={swatch.style} aria-label="Background preview" role="img">
          <strong>Sample heading</strong>
          <span>Text stays fully readable.</span>
          <span className="sb-bgswatch__btn">Button</span>
        </div>

        <SelectInput label="Background type" value={value.type} options={TYPE_OPTIONS} onChange={(type) => set({ type })} />

        {usesColor && <ColorInput label="Background colour" value={value.color} onChange={(color) => set({ color })} emptyLabel="None" />}

        {usesImage && (
          <>
            <ImageInput
              label="Background image"
              value={value.imageUrl}
              onChange={(imageUrl) => set({ imageUrl, imageOpacity: value.imageUrl ? value.imageOpacity : DEFAULT_IMAGE_OPACITY })}
              hint="Large photos are resized automatically for fast loading."
            />
            <Slider
              label="Image opacity"
              value={value.imageOpacity}
              onChange={(imageOpacity) => set({ imageOpacity })}
              hint="Only the image fades — text and buttons stay solid. 10–20% is a subtle texture."
            />
            <div className="admin-form__row">
              <SelectInput
                label="Image position"
                value={value.position}
                options={BACKGROUND_POSITIONS.map((p) => ({ value: p, label: POSITION_LABELS[p] }))}
                onChange={(position) => set({ position })}
              />
              <SelectInput
                label="Image size"
                value={value.size}
                options={[
                  { value: "cover", label: "Cover (fill)" },
                  { value: "contain", label: "Contain (whole image)" },
                  { value: "custom", label: "Custom" },
                ]}
                onChange={(size) => set({ size })}
              />
            </div>
            {value.size === "custom" && (
              <Slider label="Image width" value={value.customSize} min={CUSTOM_SIZE_MIN} max={CUSTOM_SIZE_MAX} onChange={(customSize) => set({ customSize })} />
            )}
            <ColorInput label="Overlay colour" value={value.overlayColor} onChange={(overlayColor) => set({ overlayColor })} emptyLabel="None" />
            {value.overlayColor && (
              <Slider
                label="Overlay opacity"
                value={value.overlayOpacity}
                onChange={(overlayOpacity) => set({ overlayOpacity })}
                hint="A soft overlay keeps text readable over a busy photo."
              />
            )}
          </>
        )}
      </div>
    </Group>
  );
}
