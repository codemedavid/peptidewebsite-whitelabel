import { StyleSheet, View, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import type { FontSet } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import type { AdminBrand } from "@/features/admin/bridge";
import {
  alpha,
  isDarkColor,
  isHex,
  labelOn,
  mix,
  type CardButtonShape,
  type CardDesign,
  type CardImageRatio,
  type CardSpacing,
  type CardTitleSize,
} from "./model";

/**
 * A native sketch of the storefront's <ProductCard> wearing a CardDesign —
 * the same --cd-* rules as src/storefront/cardDesign.ts + storefront.css
 * (`.product-card[data-cd]`), painted with React Native views. Theme-inherited
 * values ("") fall back to the store's own colours from the brand projection.
 */

export type SampleProduct = {
  name: string;
  description: string;
  priceLabel: string;
  purity: string;
  image: string | null;
};

/** The store's theme colours the card inherits ("" in a design → these). */
export type CardTheme = {
  surface: string;
  surface2: string;
  border: string;
  button: string;
  button2: string;
  buttonText: string;
  heading: string;
  body: string;
};

const SAMPLE_RATING = { value: 4.8, count: 126 };
const TITLE_PX: Record<CardTitleSize, number> = { sm: 17, md: 20, lg: 23 };
const PAD_PX: Record<CardSpacing, number> = { compact: 14, cozy: 20, roomy: 26 };
const RATIO: Record<CardImageRatio, number> = { square: 1, landscape: 4 / 3, portrait: 3 / 4, wide: 16 / 9 };
const BTN_RADIUS: Record<CardButtonShape, number> = { pill: 999, rounded: 12, square: 6 };
const SHADOW = {
  sm: "0px 1px 3px rgba(15, 23, 42, 0.10)",
  md: "0px 6px 16px -4px rgba(15, 23, 42, 0.16)",
  lg: "0px 16px 36px -10px rgba(15, 23, 42, 0.26)",
};
const NEUMORPHIC = "9px 9px 20px rgba(70, 80, 100, 0.16), -9px -9px 20px rgba(255, 255, 255, 0.95)";
const HOVER_LIFT = "0px 18px 40px -12px rgba(15, 23, 42, 0.2)";
const MIN_INSET_RADIUS = 8;
const HORIZONTAL_MEDIA = "42%";

/** Colours from the brand projection that React Native can paint (hex only). */
export function cardThemeFrom(brand: AdminBrand, fallback: { primary: string; onPrimary: string }): CardTheme {
  const hex = (v: unknown, d: string) => (isHex(v) ? v.trim() : d);
  const surface = hex(brand.surface, "#FFFFFF");
  const text = hex(brand.text, "#1F2937");
  const button = hex(brand.button, fallback.primary);
  return {
    surface,
    surface2: mix(surface, hex(brand.background, "#F1F5F9"), 55),
    border: hex(brand.borderColor, mix(text, surface, 14)),
    button,
    button2: hex(brand.button2, mix(button, "#FFFFFF", 55)),
    buttonText: hex(brand.buttonText, fallback.onPrimary),
    heading: hex(brand.main, text),
    body: alpha(text, 0.75),
  };
}

type Resolved = {
  bg: string;
  bg2: string;
  heading: string;
  body: string;
  dark: boolean;
  btn: string;
  btn2: string;
  btnText: string;
  pad: number;
};

function resolve(d: CardDesign, theme: CardTheme): Resolved {
  const bg = isHex(d.background) ? d.background : "";
  const text = isHex(d.textColor) ? d.textColor : "";
  const btn = isHex(d.buttonColor) ? d.buttonColor : "";
  const bgDark = !!bg && isDarkColor(bg);
  const overlayOrDark = d.layout === "overlay" || bgDark;
  return {
    bg: bg || theme.surface,
    bg2: isHex(d.background2) ? d.background2 : mix(bg || theme.surface, theme.surface2, 55),
    heading: text || (overlayOrDark ? "#FFFFFF" : theme.heading),
    body: text ? alpha(text, 0.76) : overlayOrDark ? "rgba(255, 255, 255, 0.82)" : theme.body,
    dark: overlayOrDark || (!!text && isDarkColor(bg || "#FFFFFF")),
    btn: btn || theme.button,
    btn2: btn ? mix(btn, "#FFFFFF", 55) : theme.button2,
    btnText: btn ? labelOn(btn) : theme.buttonText,
    pad: PAD_PX[d.spacing] ?? 20,
  };
}

function cardShadow(d: CardDesign, r: Resolved, hovered: boolean): string | undefined {
  const ring = hovered && (d.hover === "glow" || d.hover === "frame");
  if (hovered && d.hover === "glow") return `0px 0px 0px 2px ${alpha(r.btn, 0.55)}, 0px 14px 44px -10px ${alpha(r.btn, 0.5)}`;
  if (ring) return `0px 0px 0px 2px ${isHex(d.borderColor) ? d.borderColor : r.btn}`;
  if (hovered && d.hover === "lift") return HOVER_LIFT;
  if (d.surface === "neumorphic") return NEUMORPHIC;
  if (d.shadow === "none") return undefined;
  if (d.shadow === "glow") return `0px 10px 40px -8px ${alpha(r.btn, 0.45)}`;
  return SHADOW[d.shadow];
}

function hoverTransform(d: CardDesign, hovered: boolean): ViewStyle["transform"] {
  if (!hovered) return undefined;
  if (d.hover === "lift") return [{ translateY: -4 }];
  if (d.hover === "grow") return [{ scale: 1.025 }];
  if (d.hover === "tilt") return [{ rotate: "-1deg" }, { scale: 1.015 }];
  return undefined;
}

function titleFamily(font: FontSet, d: CardDesign): string {
  if (d.titleFont === "display") return font.serif;
  if (d.titleWeight >= 700) return font.sansBold;
  if (d.titleWeight === 600) return font.sansSemi;
  if (d.titleWeight === 500) return font.sansMedium;
  return font.sans;
}

export function PreviewCard({
  design,
  theme,
  sample,
  width,
  collapse = false,
  hovered = false,
}: {
  design: CardDesign;
  theme: CardTheme;
  sample: SampleProduct;
  /** Frame width in pt; capped to the parent's width. */
  width?: number;
  /** Phone behaviour: a side-image card stacks vertically, as on the storefront. */
  collapse?: boolean;
  /** Play the design's hover effect (touch-and-hold on the preview). */
  hovered?: boolean;
}) {
  const r = resolve(design, theme);
  const layout = design.layout === "horizontal" && collapse ? "vertical" : design.layout;
  const borderColor = isHex(design.borderColor) ? design.borderColor : theme.border;
  const cardStyle: ViewStyle = {
    width,
    maxWidth: "100%",
    borderRadius: design.radius,
    backgroundColor: design.surface === "glass" ? alpha(r.bg, 0.55) : r.bg,
    borderWidth: design.borderEnabled ? design.borderWidth : 0,
    borderColor,
    borderStyle: design.borderStyle,
    boxShadow: cardShadow(design, r, hovered),
    transform: hoverTransform(design, hovered),
    flexDirection: layout === "horizontal" ? "row" : "column",
  };

  const media = <Media design={design} r={r} sample={sample} layout={layout} />;
  const body = <Body design={design} r={r} sample={sample} layout={layout} />;

  return (
    <View style={cardStyle} accessible accessibilityLabel={`Product card preview: ${sample.name}`}>
      <View style={[StyleSheet.absoluteFill, { borderRadius: design.radius, overflow: "hidden" }]} pointerEvents="none">
        {design.surface === "gradient" && layout !== "overlay" ? (
          <LinearGradient colors={[r.bg, r.bg2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}
      </View>
      {layout === "overlay" ? (
        <View style={{ aspectRatio: 1 / (RATIO[design.imageRatio] ?? 1), borderRadius: design.radius, overflow: "hidden" }}>
          {media}
          <LinearGradient
            colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.78)"]}
            locations={[0.3, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <View style={styles.overlayBody}>{body}</View>
        </View>
      ) : (
        <>
          {media}
          <View style={{ flex: layout === "horizontal" ? 1 : undefined }}>{body}</View>
        </>
      )}
    </View>
  );
}

function Media({
  design,
  r,
  sample,
  layout,
}: {
  design: CardDesign;
  r: Resolved;
  sample: SampleProduct;
  layout: CardDesign["layout"];
}) {
  const overlay = layout === "overlay";
  const horizontal = layout === "horizontal";
  const inset = design.mediaInset && !overlay;
  const radius = inset ? Math.max(MIN_INSET_RADIUS, design.radius - 10) : 0;
  const outer = design.radius - (design.borderEnabled ? design.borderWidth : 0);
  const style: ViewStyle = overlay
    ? { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 }
    : {
        aspectRatio: horizontal ? undefined : RATIO[design.imageRatio] ?? 1,
        width: horizontal ? HORIZONTAL_MEDIA : undefined,
        margin: inset ? r.pad : 0,
        marginBottom: 0,
        overflow: "hidden",
        borderRadius: radius,
        borderTopLeftRadius: inset ? radius : Math.max(0, outer),
        borderTopRightRadius: inset ? radius : horizontal ? 0 : Math.max(0, outer),
        borderBottomLeftRadius: inset ? radius : horizontal ? Math.max(0, outer) : 0,
      };
  return (
    <View style={style}>
      {sample.image ? (
        <Image source={{ uri: sample.image }} style={StyleSheet.absoluteFill} contentFit="cover" accessibilityIgnoresInvertColors />
      ) : (
        <SampleArt />
      )}
      <Badge design={design} r={r} />
    </View>
  );
}

/** The website's abstract sample image, for stores with no product photo yet. */
function SampleArt() {
  return (
    <LinearGradient colors={["#C7D2FE", "#E9D5FF", "#FBCFE8"]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={StyleSheet.absoluteFill}>
      <View style={styles.artVial}>
        <View style={styles.artCap} />
        <View style={styles.artBody} />
      </View>
    </LinearGradient>
  );
}

function Badge({ design, r }: { design: CardDesign; r: Resolved }) {
  if (design.badgeStyle === "hidden") return null;
  const look: Record<Exclude<CardDesign["badgeStyle"], "hidden">, { bg: string; fg: string; border?: string }> = {
    solid: { bg: r.btn, fg: r.btnText },
    soft: { bg: mix(r.btn, "#FFFFFF", 18), fg: mix(r.btn, "#000000", 80) },
    outline: { bg: "rgba(0, 0, 0, 0.25)", fg: "#FFFFFF", border: "rgba(255, 255, 255, 0.85)" },
    mono: r.dark ? { bg: "#FFFFFF", fg: "#111827" } : { bg: "#111827", fg: "#FFFFFF" },
  };
  const c = look[design.badgeStyle];
  return (
    <View style={[styles.badge, { backgroundColor: c.bg, borderColor: c.border ?? "transparent", borderWidth: c.border ? 1 : 0 }]}>
      <AppText variant="caption" color={c.fg} style={styles.badgeText}>
        Featured
      </AppText>
    </View>
  );
}

function Body({
  design,
  r,
  sample,
  layout,
}: {
  design: CardDesign;
  r: Resolved;
  sample: SampleProduct;
  layout: CardDesign["layout"];
}) {
  const t = useTheme();
  const size = TITLE_PX[design.titleSize] ?? 20;
  const name = design.titleCase === "uppercase" ? sample.name.toUpperCase() : sample.name;
  return (
    <View style={{ flex: layout === "horizontal" ? 1 : undefined, justifyContent: "space-between" }}>
      <View style={{ padding: r.pad, paddingBottom: r.pad * 0.75, gap: 6 }}>
        {sample.purity ? (
          <AppText variant="overline" color={r.body}>
            {sample.purity} PURITY
          </AppText>
        ) : null}
        <AppText
          numberOfLines={2}
          style={{ fontFamily: titleFamily(t.font, design), fontSize: size, lineHeight: Math.round(size * 1.2), color: r.heading }}
          color={r.heading}
        >
          {name}
        </AppText>
        {design.showDesc && layout !== "overlay" ? (
          <AppText variant="caption" color={r.body} numberOfLines={2}>
            {sample.description}
          </AppText>
        ) : null}
        <View style={styles.rating}>
          <Ionicons name="star" size={12} color="#F59E0B" />
          <AppText variant="caption" color={r.body}>
            {SAMPLE_RATING.value} ({SAMPLE_RATING.count})
          </AppText>
        </View>
      </View>
      <View style={[styles.foot, { paddingHorizontal: r.pad, paddingTop: r.pad * 0.7, paddingBottom: r.pad, gap: r.pad * 0.6 }]}>
        <AppText variant="heading" color={r.heading} style={{ flexShrink: 1 }} numberOfLines={1}>
          {sample.priceLabel}
        </AppText>
        <CtaButton design={design} r={r} />
      </View>
    </View>
  );
}

function CtaButton({ design, r }: { design: CardDesign; r: Resolved }) {
  const radius = BTN_RADIUS[design.buttonShape] ?? 999;
  const base: ViewStyle = { borderRadius: radius, paddingHorizontal: 14, paddingVertical: 9, overflow: "hidden", alignItems: "center" };
  const label = (color: string) => (
    <AppText variant="label" color={color} numberOfLines={1}>
      Add to cart
    </AppText>
  );
  switch (design.buttonStyle) {
    case "gradient":
      return (
        <LinearGradient colors={[r.btn, r.btn2]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={base}>
          {label(r.btnText)}
        </LinearGradient>
      );
    case "solid":
      return <View style={[base, { backgroundColor: r.btn }]}>{label(r.btnText)}</View>;
    case "outline":
      return <View style={[base, { borderWidth: 2, borderColor: r.btn }]}>{label(r.btn)}</View>;
    case "soft":
      return <View style={[base, { backgroundColor: alpha(r.btn, 0.14) }]}>{label(r.btn)}</View>;
    case "contrast":
      return <View style={[base, { backgroundColor: "#FFFFFF", boxShadow: "0px 8px 24px -10px rgba(0,0,0,0.45)" }]}>{label("#111827")}</View>;
  }
}

const styles = StyleSheet.create({
  overlayBody: { position: "absolute", left: 0, right: 0, bottom: 0 },
  badge: { position: "absolute", top: 10, left: 10, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 11, lineHeight: 15 },
  rating: { flexDirection: "row", alignItems: "center", gap: 4 },
  foot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  artVial: { position: "absolute", left: "41.6%", top: "30%", width: "16.7%", height: "42%", alignItems: "center" },
  artCap: { width: "56%", height: "20%", borderRadius: 6, backgroundColor: "rgba(49, 46, 129, 0.75)" },
  artBody: { flex: 1, width: "100%", borderRadius: 999, backgroundColor: "rgba(255, 255, 255, 0.85)", marginTop: -4 },
});
