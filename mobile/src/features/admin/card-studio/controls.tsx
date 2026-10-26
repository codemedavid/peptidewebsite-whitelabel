import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import * as Haptics from "expo-haptics";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { Field } from "@/ui/inputs";
import { ChoicePills, Section, Stepper, ToggleRow, type Choice } from "@/features/admin/setup/ui";
import {
  BORDER_COLOR_PRESETS,
  BORDER_WIDTH_MAX,
  BORDER_WIDTH_MIN,
  BUTTON_COLOR_PRESETS,
  RADIUS_MAX,
  RADIUS_MIN,
  isDarkColor,
  isHex,
  isTextOnlyCard,
  type CardDesign,
  type CardTitleWeight,
} from "./model";

/**
 * The website Card Studio's customization panel (Border, Card, Layout & image,
 * Typography, Button, Badge) as native form sections. Every control patches the
 * same live design object the preview renders.
 */

const tap = () => void Haptics.selectionAsync().catch(() => undefined);
const RADIUS_STEP = 2;

type Patch = (edits: Partial<CardDesign>) => void;

const BORDER_STYLES: Choice<CardDesign["borderStyle"]>[] = [
  { key: "solid", label: "Solid" },
  { key: "dashed", label: "Dashed" },
  { key: "dotted", label: "Dotted" },
];
const SURFACES: Choice<CardDesign["surface"]>[] = [
  { key: "flat", label: "Flat" },
  { key: "glass", label: "Glass" },
  { key: "neumorphic", label: "Neu" },
  { key: "gradient", label: "Gradient" },
];
const SHADOWS: Choice<CardDesign["shadow"]>[] = [
  { key: "none", label: "None" },
  { key: "sm", label: "Soft" },
  { key: "md", label: "Medium" },
  { key: "lg", label: "Deep" },
  { key: "glow", label: "Glow" },
];
const HOVERS: Choice<CardDesign["hover"]>[] = [
  { key: "none", label: "None" },
  { key: "lift", label: "Lift" },
  { key: "grow", label: "Grow" },
  { key: "glow", label: "Glow" },
  { key: "frame", label: "Frame" },
  { key: "tilt", label: "Tilt" },
];
const SPACINGS: Choice<CardDesign["spacing"]>[] = [
  { key: "compact", label: "Compact" },
  { key: "cozy", label: "Cozy" },
  { key: "roomy", label: "Roomy" },
];
const LAYOUTS: Choice<CardDesign["layout"]>[] = [
  { key: "vertical", label: "Standard" },
  { key: "horizontal", label: "Side image" },
  { key: "overlay", label: "BG image" },
  { key: "text", label: "Text only" },
];
const RATIOS: Choice<CardDesign["imageRatio"]>[] = [
  { key: "square", label: "1:1" },
  { key: "landscape", label: "4:3" },
  { key: "portrait", label: "3:4" },
  { key: "wide", label: "16:9" },
];
const TITLE_FONTS: Choice<CardDesign["titleFont"]>[] = [
  { key: "display", label: "Display" },
  { key: "body", label: "Body" },
];
const WEIGHTS: Choice<`${CardTitleWeight}`>[] = (["400", "500", "600", "700", "800"] as const).map((w) => ({ key: w, label: w }));
const TITLE_SIZES: Choice<CardDesign["titleSize"]>[] = [
  { key: "sm", label: "S" },
  { key: "md", label: "M" },
  { key: "lg", label: "L" },
];
const BUTTON_STYLES: Choice<CardDesign["buttonStyle"]>[] = [
  { key: "gradient", label: "Gradient" },
  { key: "solid", label: "Solid" },
  { key: "outline", label: "Outline" },
  { key: "soft", label: "Soft" },
  { key: "contrast", label: "Contrast" },
];
const BUTTON_SHAPES: Choice<CardDesign["buttonShape"]>[] = [
  { key: "pill", label: "Pill" },
  { key: "rounded", label: "Rounded" },
  { key: "square", label: "Square" },
];
const BADGES: Choice<CardDesign["badgeStyle"]>[] = [
  { key: "solid", label: "Solid" },
  { key: "soft", label: "Soft" },
  { key: "outline", label: "Outline" },
  { key: "mono", label: "Mono" },
  { key: "hidden", label: "Hidden" },
];

export function CustomizePanel({ design, patch }: { design: CardDesign; patch: Patch }) {
  return (
    <>
      <Section title="Border">
        <ToggleRow label="Show border" value={design.borderEnabled} onChange={(borderEnabled) => patch({ borderEnabled })} />
        {design.borderEnabled ? (
          <>
            <ColorRow
              label="Border color"
              value={design.borderColor}
              onChange={(borderColor) => patch({ borderColor })}
              presets={BORDER_COLOR_PRESETS}
            />
            <Stepper
              label="Border width"
              value={design.borderWidth}
              display={`${design.borderWidth}px`}
              min={BORDER_WIDTH_MIN}
              max={BORDER_WIDTH_MAX}
              step={1}
              onChange={(borderWidth) => patch({ borderWidth })}
            />
            <ChoicePills label="Border style" options={BORDER_STYLES} value={design.borderStyle} onChange={(borderStyle) => patch({ borderStyle })} />
          </>
        ) : null}
        <Stepper
          label="Corner radius"
          value={design.radius}
          display={`${design.radius}px`}
          min={RADIUS_MIN}
          max={RADIUS_MAX}
          step={RADIUS_STEP}
          onChange={(radius) => patch({ radius })}
        />
      </Section>

      <Section title="Card">
        <ChoicePills label="Surface" options={SURFACES} value={design.surface} onChange={(surface) => patch({ surface })} />
        <ColorRow label="Background" value={design.background} onChange={(background) => patch({ background })} />
        {design.surface === "gradient" ? (
          <ColorRow label="Gradient stop" value={design.background2} onChange={(background2) => patch({ background2 })} themeLabel="Auto" />
        ) : null}
        <ColorRow label="Text color" value={design.textColor} onChange={(textColor) => patch({ textColor })} />
        <ChoicePills label="Shadow" options={SHADOWS} value={design.shadow} onChange={(shadow) => patch({ shadow })} />
        <ChoicePills label="Hover effect" options={HOVERS} value={design.hover} onChange={(hover) => patch({ hover })} />
        <ChoicePills label="Card spacing" options={SPACINGS} value={design.spacing} onChange={(spacing) => patch({ spacing })} />
      </Section>

      <Section title="Layout & image">
        <ChoicePills label="Layout" options={LAYOUTS} value={design.layout} onChange={(layout) => patch({ layout })} />
        {/* No image on a text-only card, so its image controls would do nothing. */}
        {isTextOnlyCard(design) ? null : (
          <>
            <ChoicePills label="Image ratio" options={RATIOS} value={design.imageRatio} onChange={(imageRatio) => patch({ imageRatio })} />
            <ToggleRow label="Inset image (bento)" value={design.mediaInset} onChange={(mediaInset) => patch({ mediaInset })} />
          </>
        )}
      </Section>

      <Section title="Typography">
        <ChoicePills label="Title font" options={TITLE_FONTS} value={design.titleFont} onChange={(titleFont) => patch({ titleFont })} />
        <ChoicePills
          label="Title weight"
          options={WEIGHTS}
          value={`${design.titleWeight}`}
          onChange={(w) => patch({ titleWeight: Number(w) as CardTitleWeight })}
        />
        <ChoicePills label="Title size" options={TITLE_SIZES} value={design.titleSize} onChange={(titleSize) => patch({ titleSize })} />
        <ToggleRow
          label="Uppercase title"
          value={design.titleCase === "uppercase"}
          onChange={(v) => patch({ titleCase: v ? "uppercase" : "none" })}
        />
        <ToggleRow label="Show description" value={design.showDesc} onChange={(showDesc) => patch({ showDesc })} />
      </Section>

      <Section title="Button">
        <ChoicePills label="Button style" options={BUTTON_STYLES} value={design.buttonStyle} onChange={(buttonStyle) => patch({ buttonStyle })} />
        <ColorRow
          label="Button color"
          value={design.buttonColor}
          onChange={(buttonColor) => patch({ buttonColor })}
          presets={BUTTON_COLOR_PRESETS}
        />
        <ChoicePills label="Button shape" options={BUTTON_SHAPES} value={design.buttonShape} onChange={(buttonShape) => patch({ buttonShape })} />
      </Section>

      <Section title="Badge">
        <ChoicePills label="Badge style" options={BADGES} value={design.badgeStyle} onChange={(badgeStyle) => patch({ badgeStyle })} />
      </Section>
    </>
  );
}

/**
 * Colour control: an inherit chip ("Theme"/"Auto"), the website's recommended
 * swatches, and a hex field in place of the browser's colour picker. Only a
 * valid hex (or blank = inherit) reaches the design, as on the server.
 */
function ColorRow({
  label,
  value,
  onChange,
  presets = [],
  themeLabel = "Theme",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  presets?: { name: string; value: string }[];
  themeLabel?: string;
}) {
  const t = useTheme();
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // Presets / swatches change the value from outside the field: re-sync the
  // text during render (React's "adjust state on prop change" pattern).
  if (seen !== value) {
    setSeen(value);
    setText(value);
  }
  const invalid = text.trim() !== "" && !isHex(text);

  const onText = (next: string) => {
    setText(next);
    const clean = next.trim();
    if (clean === "") onChange("");
    else if (isHex(clean)) onChange(clean.toUpperCase());
  };

  return (
    <View style={{ gap: SPACE.sm }}>
      <AppText variant="label" color="muted">
        {label}
      </AppText>
      <View style={styles.swatches} accessibilityRole="radiogroup" accessibilityLabel={label}>
        <Pressable
          accessibilityRole="radio"
          accessibilityState={{ checked: value === "" }}
          accessibilityLabel={`${label}: use your theme color`}
          onPress={() => {
            tap();
            onChange("");
          }}
          style={[
            styles.themeChip,
            { borderColor: value === "" ? t.colors.text : t.colors.border, backgroundColor: value === "" ? t.colors.text : t.colors.surface },
          ]}
        >
          <AppText variant="caption" color={value === "" ? t.colors.bg : "text"}>
            {themeLabel}
          </AppText>
        </Pressable>
        {presets.map((p) => {
          const active = value.toUpperCase() === p.value.toUpperCase();
          return (
            <Pressable
              key={p.value}
              accessibilityRole="radio"
              accessibilityState={{ checked: active }}
              accessibilityLabel={`${label}: ${p.name}`}
              hitSlop={4}
              onPress={() => {
                tap();
                onChange(p.value);
              }}
              style={[
                styles.swatch,
                { backgroundColor: p.value, borderColor: active ? t.colors.text : t.colors.border, borderWidth: active ? 3 : 1 },
              ]}
            >
              {active ? <Ionicons name="checkmark" size={16} color={isDarkColor(p.value) ? "#FFFFFF" : "#111827"} /> : null}
            </Pressable>
          );
        })}
      </View>
      <Field
        label={`${label} — custom hex`}
        value={text}
        onChangeText={onText}
        placeholder="Blank = theme, e.g. #6366F1"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={9}
        error={invalid ? "Use a hex color like #6366F1." : null}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm, alignItems: "center" },
  themeChip: { minHeight: 36, paddingHorizontal: SPACE.md, borderRadius: RADIUS.pill, borderWidth: 1, justifyContent: "center" },
  swatch: { width: 36, height: 36, borderRadius: RADIUS.pill, alignItems: "center", justifyContent: "center" },
});
