/**
 * The tracker's building blocks — every tracker screen speaks this one visual
 * language (tokens in ./theme). All controls: ≥ 44 pt touch targets, an
 * accessibilityRole + label, dynamic-type safe text, and motion on transform /
 * opacity only (none at all under the OS "Reduce motion" setting).
 *
 *   TText            text in the tracker type scale (`tabular` for numbers)
 *   Card             surface / alt / brand panel, optionally pressable
 *   SectionHeader    "TODAY" label with an optional action link or right slot
 *   PressButton      the main button: tones, sizes, haptics, pressed scale
 *   IconButton       a round 44 pt icon button
 *   Chip / ChipRow   single / multi choice chips
 *   SegmentedControl a sliding-thumb segmented choice (views, front/back)
 *   Stepper          − value + for small integers (every N days, cycle days)
 *   Pill             a small status label (icon + word, never colour alone)
 *   Dot              a colour dot (protocol colour, legend swatch)
 *   EmptyState       icon + title + body + optional action
 *   DisclaimerFooter "Tracking only — not medical advice ›"
 */
import type { ComponentProps, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type LayoutChangeEvent, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from "react-native-reanimated";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { trackerHref } from "./routes";
import { TMOTION, TOUCH_MIN, TRADIUS, TSPACE, useTrackerTheme, type StatusKey, type TrackerTypeVariant } from "./theme";

export type IconName = ComponentProps<typeof Ionicons>["name"];

// ── Haptics ───────────────────────────────────────────────────────────────

export type HapticKind = "tap" | "select" | "success" | "warning" | "none";

/** Fire-and-forget haptic; never throws (web / simulators have none). */
export function haptic(kind: HapticKind = "tap"): void {
  if (kind === "none") return;
  const run =
    kind === "success"
      ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      : kind === "warning"
        ? Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
        : kind === "select"
          ? Haptics.selectionAsync()
          : Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  run.catch(() => undefined);
}

// ── Text ──────────────────────────────────────────────────────────────────

export type TextColor = "ink" | "soft" | "faint" | "brand" | "onBrand" | "onBrandSoft";

type TTextProps = {
  variant?: TrackerTypeVariant;
  /** A role name or any colour string. */
  color?: TextColor | (string & {});
  /** Fixed-width digits (counts, times, doses) so numbers don't jiggle. */
  tabular?: boolean;
  numberOfLines?: number;
  style?: StyleProp<TextStyle>;
  children: ReactNode;
  accessibilityRole?: "header" | "text";
  accessibilityLabel?: string;
  /** Announce changes (validation messages). */
  accessibilityLiveRegion?: "none" | "polite" | "assertive";
};

/** Caps font scaling per size: huge numbers grow less than body text. */
const MAX_SCALE: Record<TrackerTypeVariant, number> = {
  hero: 1.25,
  display: 1.35,
  title: 1.5,
  headline: 1.6,
  body: 1.8,
  bodyStrong: 1.8,
  meta: 1.8,
  micro: 1.6,
  number: 1.6,
};

export function TText({ variant = "body", color = "ink", tabular, style, children, ...rest }: TTextProps) {
  const th = useTrackerTheme();
  const roles: Record<TextColor, string> = {
    ink: th.ink,
    soft: th.inkSoft,
    faint: th.inkFaint,
    brand: th.brandText,
    onBrand: th.onBrand,
    onBrandSoft: th.onBrandSoft,
  };
  const resolved = (roles as Record<string, string>)[color] ?? color;
  return (
    <Text
      allowFontScaling
      maxFontSizeMultiplier={MAX_SCALE[variant]}
      style={[th.type[variant], { color: resolved }, tabular ? styles.tabular : null, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ── Card ──────────────────────────────────────────────────────────────────

type CardProps = {
  children: ReactNode;
  tone?: "surface" | "alt" | "brand";
  style?: StyleProp<ViewStyle>;
  /** Makes the whole card a button. */
  onPress?: () => void;
  accessibilityLabel?: string;
  accessibilityHint?: string;
};

export function Card({ children, tone = "surface", style, onPress, accessibilityLabel, accessibilityHint }: CardProps) {
  const th = useTrackerTheme();
  const bg = tone === "brand" ? th.brandTint : tone === "alt" ? th.surfaceAlt : th.surface;
  const base: StyleProp<ViewStyle> = [styles.card, { backgroundColor: bg, borderColor: th.line }, tone === "surface" ? th.shadow.card : null, style];
  if (!onPress) return <View style={base}>{children}</View>;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [base, pressed ? styles.pressedDim : null]}
    >
      {children}
    </Pressable>
  );
}

// ── Section header ────────────────────────────────────────────────────────

export function SectionHeader({ title, action, right }: { title: string; action?: { label: string; onPress: () => void }; right?: ReactNode }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.sectionHeader}>
      <TText variant="micro" color="faint" accessibilityRole="header" style={{ flex: 1 }}>
        {title}
      </TText>
      {right}
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={10}
          onPress={() => {
            haptic("select");
            action.onPress();
          }}
          style={({ pressed }) => [styles.sectionAction, pressed ? styles.pressedDim : null]}
        >
          <TText variant="meta" color="brand">
            {action.label}
          </TText>
          <Ionicons name="chevron-forward" size={14} color={th.brandText} />
        </Pressable>
      ) : null}
    </View>
  );
}

// ── PressButton ───────────────────────────────────────────────────────────

export type ButtonTone = "primary" | "secondary" | "soft" | "onBrand" | "onBrandGhost" | "ghost" | "danger";
export type ButtonSize = "lg" | "md" | "sm";

type PressButtonProps = {
  label: string;
  onPress: () => void;
  tone?: ButtonTone;
  size?: ButtonSize;
  icon?: IconName;
  /** Icon after the label (e.g. chevron). */
  trailingIcon?: IconName;
  isDisabled?: boolean;
  isLoading?: boolean;
  /** Haptic on press. Default "tap"; use "success" for a completed log. */
  hapticKind?: HapticKind;
  accessibilityHint?: string;
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

const BUTTON_HEIGHT: Record<ButtonSize, number> = { lg: 56, md: 48, sm: TOUCH_MIN };
const BUTTON_TEXT: Record<ButtonSize, TrackerTypeVariant> = { lg: "headline", md: "bodyStrong", sm: "meta" };
const PRESSED_SCALE = 0.97;

/** The main button. Pressed = a gentle scale (transform only), skipped under Reduce motion. */
export function PressButton({
  label,
  onPress,
  tone = "primary",
  size = "lg",
  icon,
  trailingIcon,
  isDisabled,
  isLoading,
  hapticKind = "tap",
  accessibilityHint,
  accessibilityLabel,
  style,
}: PressButtonProps) {
  const th = useTrackerTheme();
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.get() }] }));
  const palette: Record<ButtonTone, { bg: string; fg: string; border: string }> = {
    primary: { bg: th.brand, fg: th.onBrand, border: th.brand },
    secondary: { bg: th.surface, fg: th.ink, border: th.line },
    soft: { bg: th.brandSoft, fg: th.brandText, border: th.brandSoft },
    onBrand: { bg: th.onBrand, fg: th.brand, border: th.onBrand },
    onBrandGhost: { bg: "transparent", fg: th.onBrand, border: th.onBrandLine },
    ghost: { bg: "transparent", fg: th.brandText, border: "transparent" },
    danger: { bg: th.status.missed.soft, fg: th.status.missed.text, border: th.status.missed.soft },
  };
  const c = palette[tone];
  const inactive = !!isDisabled || !!isLoading;
  const iconSize = size === "lg" ? 22 : 18;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: !!isLoading }}
      disabled={inactive}
      onPressIn={() => {
        if (!reduced) scale.set(withTiming(PRESSED_SCALE, { duration: TMOTION.press }));
      }}
      onPressOut={() => {
        if (!reduced) scale.set(withTiming(1, { duration: TMOTION.release }));
      }}
      onPress={() => {
        haptic(hapticKind);
        onPress();
      }}
      style={style}
    >
      <Animated.View
        style={[
          styles.button,
          { minHeight: BUTTON_HEIGHT[size], backgroundColor: c.bg, borderColor: c.border, opacity: inactive ? 0.5 : 1 },
          size === "sm" ? styles.buttonSm : null,
          animated,
        ]}
      >
        {isLoading ? (
          <ActivityIndicator color={c.fg} />
        ) : (
          <>
            {icon ? <Ionicons name={icon} size={iconSize} color={c.fg} /> : null}
            <TText variant={BUTTON_TEXT[size]} color={c.fg} style={styles.buttonLabel}>
              {label}
            </TText>
            {trailingIcon ? <Ionicons name={trailingIcon} size={iconSize - 2} color={c.fg} /> : null}
          </>
        )}
      </Animated.View>
    </Pressable>
  );
}

// ── IconButton ────────────────────────────────────────────────────────────

export function IconButton({
  icon,
  label,
  onPress,
  tone = "surface",
  size = TOUCH_MIN,
  isDisabled,
}: {
  icon: IconName;
  /** Spoken name (required: icon-only). */
  label: string;
  onPress: () => void;
  tone?: "surface" | "alt" | "onBrand" | "plain";
  size?: number;
  isDisabled?: boolean;
}) {
  const th = useTrackerTheme();
  const bg = { surface: th.surface, alt: th.surfaceAlt, onBrand: th.onBrandLine, plain: "transparent" }[tone];
  const fg = tone === "onBrand" ? th.onBrand : th.ink;
  const box = Math.max(size, TOUCH_MIN);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!isDisabled }}
      disabled={isDisabled}
      hitSlop={4}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [
        styles.iconButton,
        { width: box, height: box, borderRadius: box / 2, backgroundColor: bg, opacity: isDisabled ? 0.4 : 1 },
        tone === "surface" ? { borderWidth: StyleSheet.hairlineWidth, borderColor: th.line } : null,
        pressed ? styles.pressedDim : null,
      ]}
    >
      <Ionicons name={icon} size={20} color={fg} />
    </Pressable>
  );
}

// ── Chips ─────────────────────────────────────────────────────────────────

type ChipProps = {
  label: string;
  isSelected: boolean;
  onPress: () => void;
  icon?: IconName;
  /** "checkbox" for multi-select rows (weekdays, effects); default "radio". */
  role?: "radio" | "checkbox" | "button";
  accessibilityLabel?: string;
  isDisabled?: boolean;
};

export function Chip({ label, isSelected, onPress, icon, role = "radio", accessibilityLabel, isDisabled }: ChipProps) {
  const th = useTrackerTheme();
  const fg = isSelected ? th.onBrand : th.ink;
  return (
    <Pressable
      accessibilityRole={role}
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={role === "button" ? { disabled: !!isDisabled } : { checked: isSelected, disabled: !!isDisabled }}
      disabled={isDisabled}
      onPress={() => {
        haptic("select");
        onPress();
      }}
      style={({ pressed }) => [
        styles.chip,
        { backgroundColor: isSelected ? th.brand : th.surface, borderColor: isSelected ? th.brand : th.line, opacity: isDisabled ? 0.45 : 1 },
        pressed && !isSelected ? { backgroundColor: th.surfaceAlt } : null,
      ]}
    >
      {icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <TText variant="meta" color={fg} numberOfLines={1}>
        {label}
      </TText>
    </Pressable>
  );
}

export function ChipRow({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <View style={styles.chipRow} accessibilityLabel={label}>
      {children}
    </View>
  );
}

// ── SegmentedControl ──────────────────────────────────────────────────────

export type SegmentOption<K extends string> = { key: K; label: string; icon?: IconName };

/** Equal-width segments with a sliding thumb (translateX). `label` names the group for screen readers. */
export function SegmentedControl<K extends string>({
  options,
  value,
  onChange,
  label,
  style,
}: {
  options: readonly SegmentOption<K>[];
  value: K;
  onChange: (key: K) => void;
  label: string;
  style?: StyleProp<ViewStyle>;
}) {
  const th = useTrackerTheme();
  const reduced = useReducedMotion();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, options.findIndex((o) => o.key === value));
  const segment = options.length > 0 ? (width - SEG_PAD * 2) / options.length : 0;
  const x = useSharedValue(0);
  const target = index * segment;
  const placed = useRef(false);
  useEffect(() => {
    if (width <= 0) return;
    // First layout: jump into place; later changes slide (instantly under Reduce motion).
    x.set(reduced || !placed.current ? target : withTiming(target, { duration: TMOTION.sheet }));
    placed.current = true;
  }, [target, width, reduced, x]);
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.get() }] }));

  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}
      style={[styles.segmented, { backgroundColor: th.surfaceAlt, borderColor: th.line }, style]}
    >
      {width > 0 ? <Animated.View style={[styles.thumb, { width: segment, backgroundColor: th.surface }, th.shadow.card, thumb]} /> : null}
      {options.map((o) => {
        const isActive = o.key === value;
        return (
          <Pressable
            key={o.key}
            accessibilityRole="tab"
            accessibilityLabel={o.label}
            accessibilityState={{ selected: isActive }}
            onPress={() => {
              if (isActive) return;
              haptic("select");
              onChange(o.key);
            }}
            style={styles.segment}
          >
            {o.icon ? <Ionicons name={o.icon} size={16} color={isActive ? th.ink : th.inkSoft} /> : null}
            <TText variant="meta" color={isActive ? "ink" : "soft"} numberOfLines={1}>
              {o.label}
            </TText>
          </Pressable>
        );
      })}
    </View>
  );
}

const SEG_PAD = 3;

// ── Stepper ───────────────────────────────────────────────────────────────

/** − value + for a small integer. `format` renders the value ("Every 3 days"). */
export function Stepper({
  value,
  onChange,
  min,
  max,
  step = 1,
  label,
  format = String,
}: {
  value: number;
  onChange: (next: number) => void;
  min: number;
  max: number;
  step?: number;
  /** What the number is ("Days between doses") — spoken with the value. */
  label: string;
  format?: (value: number) => string;
}) {
  const shown = format(value);
  return (
    <View style={styles.stepper} accessible accessibilityRole="adjustable" accessibilityLabel={label} accessibilityValue={{ text: shown }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "increment" && value < max) onChange(Math.min(max, value + step));
        if (e.nativeEvent.actionName === "decrement" && value > min) onChange(Math.max(min, value - step));
      }}
    >
      <IconButton icon="remove" label={`Less, ${label}`} isDisabled={value <= min} onPress={() => onChange(Math.max(min, value - step))} />
      <TText variant="headline" tabular style={styles.stepperValue}>
        {shown}
      </TText>
      <IconButton icon="add" label={`More, ${label}`} isDisabled={value >= max} onPress={() => onChange(Math.min(max, value + step))} />
    </View>
  );
}

// ── Pill / Dot ────────────────────────────────────────────────────────────

export function Pill({ label, status, icon, tone }: { label: string; status?: StatusKey; icon?: IconName; tone?: "brand" | "neutral" | "onBrand" }) {
  const th = useTrackerTheme();
  const c =
    tone === "onBrand"
      ? { soft: th.onBrandLine, text: th.onBrand }
      : tone === "brand"
        ? { soft: th.brandSoft, text: th.brandText }
        : status
          ? th.status[status]
          : th.status.upcoming;
  return (
    <View style={[styles.pill, { backgroundColor: c.soft }]}>
      {icon ? <Ionicons name={icon} size={13} color={c.text} /> : null}
      <TText variant="meta" color={c.text} numberOfLines={1} style={styles.pillText}>
        {label}
      </TText>
    </View>
  );
}

export function Dot({ color, size = 10, ring }: { color: string; size?: number; ring?: string }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: ring ? 2 : 0, borderColor: ring }} />;
}

// ── EmptyState ────────────────────────────────────────────────────────────

export function EmptyState({ icon, title, body, action }: { icon: IconName; title: string; body?: string; action?: { label: string; onPress: () => void; icon?: IconName } }) {
  const th = useTrackerTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: th.brandSoft }]}>
        <Ionicons name={icon} size={28} color={th.brandText} />
      </View>
      <TText variant="title" accessibilityRole="header" style={styles.center}>
        {title}
      </TText>
      {body ? (
        <TText variant="body" color="soft" style={styles.center}>
          {body}
        </TText>
      ) : null}
      {action ? <PressButton label={action.label} icon={action.icon} onPress={action.onPress} size="md" style={styles.emptyAction} /> : null}
    </View>
  );
}

// ── DisclaimerFooter ──────────────────────────────────────────────────────

/** The quiet footer on every tracker home view; opens the full disclaimer. */
export function DisclaimerFooter() {
  const th = useTrackerTheme();
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel="Tracking only, not medical advice. Read more"
      onPress={() => router.push(trackerHref.disclaimer())}
      style={({ pressed }) => [styles.footer, { borderTopColor: th.line }, pressed ? styles.pressedDim : null]}
    >
      <Ionicons name="information-circle-outline" size={16} color={th.inkFaint} />
      <TText variant="meta" color="faint" style={{ flex: 1 }}>
        Tracking only. Not medical advice
      </TText>
      <Ionicons name="chevron-forward" size={14} color={th.inkFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tabular: { fontVariant: ["tabular-nums"] },
  pressedDim: { opacity: 0.72 },
  card: { borderRadius: TRADIUS.lg, padding: TSPACE.lg, gap: TSPACE.md, borderWidth: StyleSheet.hairlineWidth },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, minHeight: 24 },
  sectionAction: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: TOUCH_MIN, paddingLeft: TSPACE.sm },
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: TSPACE.sm,
    paddingHorizontal: TSPACE.xl,
    borderRadius: TRADIUS.md,
    borderWidth: 1,
  },
  buttonSm: { paddingHorizontal: TSPACE.md, borderRadius: TRADIUS.pill },
  buttonLabel: { textAlign: "center", flexShrink: 1 },
  iconButton: { alignItems: "center", justifyContent: "center" },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    minHeight: TOUCH_MIN,
    paddingHorizontal: 14,
    borderRadius: TRADIUS.pill,
    borderWidth: 1,
    maxWidth: "100%",
  },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: TSPACE.sm },
  segmented: { flexDirection: "row", borderRadius: TRADIUS.md, padding: SEG_PAD, borderWidth: StyleSheet.hairlineWidth },
  thumb: { position: "absolute", top: SEG_PAD, bottom: SEG_PAD, left: SEG_PAD, borderRadius: TRADIUS.sm },
  segment: { flex: 1, minHeight: TOUCH_MIN - 4, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingHorizontal: 6 },
  stepper: { flexDirection: "row", alignItems: "center", gap: TSPACE.md },
  stepperValue: { minWidth: 56, textAlign: "center", flexShrink: 1 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: TRADIUS.pill, alignSelf: "flex-start" },
  pillText: { fontSize: 12, lineHeight: 16 },
  empty: { alignItems: "center", gap: TSPACE.md, paddingVertical: TSPACE.xxl, paddingHorizontal: TSPACE.lg },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center" },
  emptyAction: { alignSelf: "stretch", marginTop: TSPACE.sm },
  center: { textAlign: "center" },
  footer: { flexDirection: "row", alignItems: "center", gap: TSPACE.sm, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: TSPACE.lg, minHeight: TOUCH_MIN },
});
