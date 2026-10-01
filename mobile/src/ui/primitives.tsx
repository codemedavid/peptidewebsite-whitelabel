import type { ComponentProps, ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type TextStyle,
  type ViewStyle,
} from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Tone } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH, type FontSet, type TypeVariant } from "@/theme/tokens";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// ── Text ─────────────────────────────────────────────────────────────────────

type TextProps = {
  variant?: TypeVariant;
  color?: "text" | "muted" | "faint" | "link" | "onPrimary" | string;
  /** Set the line in the website's headline face. */
  brandFont?: boolean;
  /** Serif italic, the site's green-emphasis `em`. */
  italic?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  accessibilityRole?: "header" | "text";
  selectable?: boolean;
};

const SANS_ROLE_BY_WEIGHT: Record<string, keyof FontSet> = {
  "400": "sans",
  normal: "sans",
  "500": "sansMedium",
  "600": "sansSemi",
  "700": "sansBold",
  "800": "sansBold",
  "900": "sansBold",
  bold: "sansBold",
};

/**
 * Custom fonts carry their weight in the family name — a raw fontWeight would
 * make Android fall back to the system font. So a `fontWeight` in `style` is
 * translated to the matching body-face family here.
 */
function resolveFamily(font: FontSet, base: string, style: TextStyle, serif: boolean, italic: boolean): string {
  if (italic) return font.serifItalic;
  if (serif) return font.serif;
  const role = style.fontWeight ? SANS_ROLE_BY_WEIGHT[String(style.fontWeight)] : undefined;
  if (role && base !== font.serif) return font[role];
  return base;
}

export function AppText({ variant = "body", color = "text", brandFont, italic, style, children, ...rest }: TextProps) {
  const t = useTheme();
  const resolved =
    color === "text"
      ? t.colors.text
      : color === "muted"
        ? t.colors.textMuted
        : color === "faint"
          ? t.colors.textFaint
          : color === "link"
            ? t.brand.link
            : color === "onPrimary"
              ? t.brand.onPrimary
              : color;
  const type: TextStyle = t.type[variant];
  const flat = StyleSheet.flatten(style) ?? {};
  const fontFamily = resolveFamily(t.font, type.fontFamily as string, flat, !!brandFont, !!italic);
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={1.6}
      style={[type, { color: resolved }, flat, { fontFamily, fontWeight: undefined }]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ── Button ───────────────────────────────────────────────────────────────────

type ButtonProps = {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  /** Shown to screen readers when the label alone isn't enough. */
  accessibilityHint?: string;
  style?: StyleProp<ViewStyle>;
};

export function Button({ label, onPress, variant = "primary", icon, loading, disabled, accessibilityHint, style }: ButtonProps) {
  const t = useTheme();
  const inactive = disabled || loading;
  const palette = {
    primary: { bg: t.brand.primary, fg: t.brand.onPrimary, border: t.brand.primary },
    secondary: { bg: t.colors.surface, fg: t.colors.text, border: t.colors.border },
    ghost: { bg: "transparent", fg: t.brand.link, border: "transparent" },
    danger: { bg: t.tone("danger").bg, fg: t.tone("danger").fg, border: t.tone("danger").bg },
  }[variant];

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: palette.bg, borderColor: palette.border, opacity: inactive ? 0.55 : 1 },
        pressed && !inactive ? { transform: [{ scale: 0.98 }], opacity: 0.88 } : null,
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={palette.fg} />
      ) : (
        <View style={styles.buttonInner}>
          {icon ? <Ionicons name={icon} size={20} color={palette.fg} /> : null}
          <AppText variant="bodyStrong" color={palette.fg}>
            {label}
          </AppText>
        </View>
      )}
    </Pressable>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export function Card({ children, style, padded = true }: { children: ReactNode; style?: StyleProp<ViewStyle>; padded?: boolean }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: t.colors.surface, borderColor: t.colors.border },
        padded ? { padding: SPACE.lg } : null,
        style,
      ]}
    >
      {children}
    </View>
  );
}

// ── Pill (status / tone) — always icon + words, never colour alone ───────────

export function Pill({ tone, label, icon, size = "md" }: { tone: Tone; label: string; icon?: IconName; size?: "sm" | "md" }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <View
      accessible
      accessibilityLabel={label}
      style={[styles.pill, { backgroundColor: c.bg }, size === "sm" ? styles.pillSm : null]}
    >
      {icon ? <Ionicons name={icon} size={size === "sm" ? 13 : 15} color={c.fg} /> : null}
      <AppText variant={size === "sm" ? "caption" : "label"} color={c.fg} style={{ fontWeight: "600" }}>
        {label}
      </AppText>
    </View>
  );
}

// ── Row: a tappable list row with a chevron ──────────────────────────────────

export function Row({
  icon,
  label,
  detail,
  onPress,
  trailing,
  accessibilityHint,
}: {
  icon?: IconName;
  label: string;
  detail?: string;
  onPress?: () => void;
  trailing?: ReactNode;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
      accessibilityHint={accessibilityHint}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
    >
      {icon ? (
        <View style={[styles.rowIcon, { backgroundColor: t.colors.surfaceAlt }]}>
          <Ionicons name={icon} size={18} color={t.colors.textMuted} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong">{label}</AppText>
        {detail ? (
          <AppText variant="caption" color="muted" numberOfLines={2}>
            {detail}
          </AppText>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} /> : null)}
    </Pressable>
  );
}

export function Divider({ inset = 0 }: { inset?: number }) {
  const t = useTheme();
  return <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: t.colors.border, marginLeft: inset }} />;
}

export function SectionLabel({ children }: { children: string }) {
  return (
    <AppText variant="overline" color="link" style={styles.sectionLabel} accessibilityRole="header">
      {children.toUpperCase()}
    </AppText>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: TOUCH + 4,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    paddingHorizontal: SPACE.xl,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonInner: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  card: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: RADIUS.pill,
  },
  pillSm: { paddingHorizontal: 8, paddingVertical: 3 },
  row: {
    minHeight: TOUCH + 8,
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
  },
  rowIcon: { width: 34, height: 34, borderRadius: RADIUS.sm, alignItems: "center", justifyContent: "center" },
  sectionLabel: { marginTop: SPACE.xl, marginBottom: SPACE.sm, marginHorizontal: SPACE.xs },
});
