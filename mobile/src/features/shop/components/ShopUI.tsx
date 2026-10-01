import { memo, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { Tone } from "@contract";
import { useReducedMotion } from "@/features/community/hooks/useMotion";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { AppText, type IconName } from "@/ui/primitives";
import { isMarkedDown, sizedImage } from "../lib/catalog";
import { money } from "../lib/money";

/** Small shop building blocks, all on the store's website theme (useTheme). */

const tap = () => void Haptics.selectionAsync().catch(() => undefined);

// ── price ────────────────────────────────────────────────────────────────────

export function PriceTag({
  price,
  compareAtPrice,
  currency,
  from,
  size = "md",
}: {
  price: number;
  compareAtPrice: number | null;
  currency: string;
  from?: boolean;
  size?: "md" | "lg";
}) {
  const t = useTheme();
  const down = isMarkedDown(price, compareAtPrice);
  const label = `${from ? "From " : ""}${money(price, currency)}${down ? `, was ${money(compareAtPrice, currency)}` : ""}`;
  return (
    <View accessible accessibilityLabel={label} style={styles.priceRow}>
      <AppText
        variant={size === "lg" ? "stat" : "bodyStrong"}
        color={down ? t.tone("danger").fg : "text"}
        numberOfLines={1}
      >
        {from ? <AppText variant="caption" color="muted">{"From "}</AppText> : null}
        {money(price, currency)}
      </AppText>
      {down ? (
        <AppText variant={size === "lg" ? "body" : "caption"} color="faint" style={styles.strike} numberOfLines={1}>
          {money(compareAtPrice, currency)}
        </AppText>
      ) : null}
    </View>
  );
}

// ── image ────────────────────────────────────────────────────────────────────

/** A product photo sized for its box, with a quiet placeholder while it loads / when missing. */
export const ProductImage = memo(function ProductImage({
  uri,
  width,
  style,
  label,
  contentFit = "cover",
}: {
  uri: string | null;
  width: number;
  style?: StyleProp<ViewStyle>;
  label?: string;
  contentFit?: "cover" | "contain";
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState(false);
  const src = sizedImage(uri, width * 2);
  return (
    <View style={[{ backgroundColor: t.colors.surfaceAlt, overflow: "hidden" }, style]} accessible={!!label} accessibilityRole={label ? "image" : undefined} accessibilityLabel={label}>
      {src && !failed ? (
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit={contentFit}
          transition={reduced ? 0 : 180}
          recyclingKey={src}
          onError={() => setFailed(true)}
        />
      ) : (
        <View style={styles.imageFallback}>
          <Ionicons name="image-outline" size={28} color={t.colors.textFaint} />
        </View>
      )}
    </View>
  );
});

// ── badge ────────────────────────────────────────────────────────────────────

export function Badge({ tone, label, icon }: { tone: Tone | "brand"; label: string; icon?: IconName }) {
  const t = useTheme();
  const c = tone === "brand" ? { bg: t.brand.primary, fg: t.brand.onPrimary } : t.tone(tone);
  return (
    <View style={[styles.badge, { backgroundColor: c.bg }]}>
      {icon ? <Ionicons name={icon} size={12} color={c.fg} /> : null}
      <AppText variant="caption" color={c.fg} style={styles.badgeText} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

// ── quantity stepper ─────────────────────────────────────────────────────────

export function QtyStepper({
  value,
  min = 1,
  max,
  onChange,
  label,
  compact,
}: {
  value: number;
  min?: number;
  max: number;
  onChange: (n: number) => void;
  /** What is being counted, for screen readers ("BPC-157 quantity"). */
  label: string;
  compact?: boolean;
}) {
  const t = useTheme();
  const size = compact ? 40 : TOUCH;
  const btn = (icon: "remove" | "add", delta: number, disabled: boolean, a11y: string) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ disabled }}
      disabled={disabled}
      hitSlop={compact ? 4 : 0}
      onPress={() => {
        tap();
        onChange(value + delta);
      }}
      style={({ pressed }) => [
        styles.stepBtn,
        { width: size, height: size, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 },
      ]}
    >
      <Ionicons name={icon} size={compact ? 18 : 20} color={t.colors.text} />
    </Pressable>
  );
  return (
    <View
      accessible={false}
      style={[styles.stepper, { borderColor: t.colors.border, backgroundColor: t.colors.surface }]}
    >
      {btn("remove", -1, value <= min, `Decrease ${label}`)}
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={label}
        accessibilityValue={{ min, max, now: value }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "increment" && value < max) onChange(value + 1);
          if (e.nativeEvent.actionName === "decrement" && value > min) onChange(value - 1);
        }}
        style={[styles.stepValue, { minWidth: compact ? 28 : 36 }]}
      >
        <AppText variant="bodyStrong">{String(value)}</AppText>
      </View>
      {btn("add", 1, value >= max, `Increase ${label}`)}
    </View>
  );
}

// ── cart button with count ───────────────────────────────────────────────────

export function CartButton({ count, onPress, onBand }: { count: number; onPress: () => void; onBand?: boolean }) {
  const t = useTheme();
  const fg = onBand ? t.brand.headerText : t.colors.text;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count > 0 ? `Cart, ${count} item${count === 1 ? "" : "s"}` : "Cart, empty"}
      onPress={() => {
        tap();
        onPress();
      }}
      hitSlop={6}
      style={({ pressed }) => [styles.iconBtn, pressed ? { opacity: 0.6 } : null]}
    >
      <Ionicons name={count > 0 ? "bag" : "bag-outline"} size={24} color={fg} />
      {count > 0 ? (
        <View style={[styles.count, { backgroundColor: t.brand.primary, borderColor: onBand ? t.brand.headerBackground : t.colors.bg }]}>
          <AppText variant="caption" color={t.brand.onPrimary} style={styles.countText}>
            {count > 99 ? "99+" : String(count)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

// ── inline notice ────────────────────────────────────────────────────────────

export function Notice({ tone, icon, children, action }: { tone: Tone; icon: IconName; children: ReactNode; action?: ReactNode }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <View accessibilityLiveRegion="polite" style={[styles.notice, { backgroundColor: c.bg }]}>
      <Ionicons name={icon} size={18} color={c.fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: SPACE.xs }}>
        {typeof children === "string" ? (
          <AppText variant="label" color={c.fg}>
            {children}
          </AppText>
        ) : (
          children
        )}
        {action}
      </View>
    </View>
  );
}

/** A titled group on a form screen. */
export function FormSection({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[styles.section, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={{ gap: 2 }}>
        <AppText variant="heading" accessibilityRole="header">
          {title}
        </AppText>
        {hint ? (
          <AppText variant="caption" color="muted">
            {hint}
          </AppText>
        ) : null}
      </View>
      {children}
    </View>
  );
}

/** A selectable card row (courier, location, payment method). */
export function ChoiceRow({
  selected,
  onPress,
  title,
  detail,
  trailing,
  icon,
}: {
  selected: boolean;
  onPress: () => void;
  title: string;
  detail?: string;
  trailing?: ReactNode;
  icon?: IconName;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={detail ? `${title}, ${detail}` : title}
      onPress={() => {
        if (!selected) tap();
        onPress();
      }}
      style={({ pressed }) => [
        styles.choice,
        {
          borderColor: selected ? t.brand.link : t.colors.border,
          borderWidth: selected ? 2 : 1,
          backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
        },
      ]}
    >
      <Ionicons name={selected ? "radio-button-on" : "radio-button-off"} size={22} color={selected ? t.brand.link : t.colors.textFaint} />
      {icon ? <Ionicons name={icon} size={20} color={t.colors.textMuted} /> : null}
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" numberOfLines={2}>
          {title}
        </AppText>
        {detail ? (
          <AppText variant="caption" color="muted" numberOfLines={2}>
            {detail}
          </AppText>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  priceRow: { flexDirection: "row", alignItems: "baseline", flexWrap: "wrap", columnGap: SPACE.sm },
  strike: { textDecorationLine: "line-through" },
  imageFallback: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    alignSelf: "flex-start",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
  },
  badgeText: { fontWeight: "600", fontSize: 12, lineHeight: 16 },
  stepper: { flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: RADIUS.pill, alignSelf: "flex-start" },
  stepBtn: { alignItems: "center", justifyContent: "center", borderRadius: RADIUS.pill },
  stepValue: { alignItems: "center", justifyContent: "center" },
  iconBtn: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  count: {
    position: "absolute",
    top: 4,
    right: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  countText: { fontSize: 11, lineHeight: 13, fontWeight: "700" },
  notice: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm, padding: SPACE.md, borderRadius: RADIUS.md },
  section: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACE.lg, gap: SPACE.md },
  choice: { flexDirection: "row", alignItems: "center", gap: SPACE.md, minHeight: TOUCH + 8, paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS.md },
});
