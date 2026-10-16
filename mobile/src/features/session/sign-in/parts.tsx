import { useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { StoreChoice } from "@contract";
import { withAlpha } from "@/features/community/lib/color";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, type IconName } from "@/ui/primitives";

/**
 * PepWorld's own green, taken from the mascot. `deep` carries white text at
 * ≥ 4.5:1, so it's the one used for buttons and links; `bright` is for tints.
 */
export const PEPWORLD = { bright: "#27B04F", deep: "#17803A", onDeep: "#FFFFFF" } as const;

/**
 * The colours the sign-in screen wears: the linked store's, else PepWorld's.
 * `fill`/`onFill` = the button, `link` = text and focus rings on the surface,
 * `tint` = the hero wash.
 */
export type AuthAccent = { fill: string; onFill: string; link: string; tint: string };

export function useAuthAccent(isLinked: boolean): AuthAccent {
  const t = useTheme();
  if (isLinked) return { fill: t.brand.primary, onFill: t.brand.onPrimary, link: t.brand.link, tint: t.brand.primary };
  return { fill: PEPWORLD.deep, onFill: PEPWORLD.onDeep, link: PEPWORLD.deep, tint: PEPWORLD.bright };
}

const CTA_HEIGHT = 56;

/** The one filled, full-width, pill call to action. */
export function PrimaryCta({
  label,
  onPress,
  accent,
  loading,
  disabled,
  icon = "arrow-forward",
}: {
  label: string;
  onPress: () => void;
  accent: AuthAccent;
  loading?: boolean;
  disabled?: boolean;
  icon?: IconName;
}) {
  const inactive = !!disabled || !!loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: inactive, busy: !!loading }}
      disabled={inactive}
      onPress={() => {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.cta,
        {
          backgroundColor: accent.fill,
          opacity: disabled && !loading ? 0.45 : 1,
          boxShadow: inactive ? undefined : `0 10px 24px -10px ${withAlpha(accent.fill, 0.7)}`,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      {loading ? (
        <ActivityIndicator color={accent.onFill} />
      ) : (
        <View style={styles.ctaInner}>
          <AppText variant="bodyStrong" color={accent.onFill} style={styles.ctaLabel}>
            {label}
          </AppText>
          <Ionicons name={icon} size={19} color={accent.onFill} />
        </View>
      )}
    </Pressable>
  );
}

/** Outlined pill for the second-tier choices (add a store, browse first…). */
export function SecondaryCta({
  label,
  onPress,
  icon,
  accessibilityHint,
}: {
  label: string;
  onPress: () => void;
  icon: IconName;
  accessibilityHint?: string;
}) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.secondary,
        {
          borderColor: t.colors.border,
          backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
          transform: [{ scale: pressed ? 0.98 : 1 }],
        },
      ]}
    >
      <Ionicons name={icon} size={19} color={t.colors.text} />
      <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>
        {label}
      </AppText>
    </Pressable>
  );
}

const BACK_SIZE = 44;

/** Round back button for the auth screens, which draw no header. */
export function BackButton({ onPress }: { onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      hitSlop={6}
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      style={({ pressed }) => [
        styles.back,
        {
          borderColor: t.colors.border,
          backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface,
          transform: [{ scale: pressed ? 0.94 : 1 }],
        },
      ]}
    >
      <Ionicons name="chevron-back" size={20} color={t.colors.text} />
    </Pressable>
  );
}

/** A plain text link, sized to a full touch target. */
export function TextLink({
  label,
  onPress,
  color,
  disabled,
  style,
}: {
  label: string;
  onPress: () => void;
  color: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={6}
      onPress={onPress}
      style={({ pressed }) => [styles.link, { opacity: disabled ? 0.45 : pressed ? 0.55 : 1 }, style]}
    >
      <AppText variant="label" color={color} style={{ fontWeight: "600" }}>
        {label}
      </AppText>
    </Pressable>
  );
}

export function Banner({ tone, icon, text }: { tone: "info" | "danger"; icon: IconName; text: string }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <View accessibilityLiveRegion="polite" accessibilityRole="alert" style={[styles.banner, { backgroundColor: c.bg }]}>
      <Ionicons name={icon} size={18} color={c.fg} style={{ marginTop: 1 }} />
      <AppText variant="label" color={c.fg} style={{ flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

/** A store's logo in a soft squircle, or its initial when it has none. */
export function StoreLogo({ choice, size = 44 }: { choice: Pick<StoreChoice, "name" | "logoUrl">; size?: number }) {
  const t = useTheme();
  const [failed, setFailed] = useState(false);
  const shape = { width: size, height: size, borderRadius: size * 0.28 };
  if (choice.logoUrl && !failed) {
    return (
      <Image
        source={{ uri: choice.logoUrl }}
        contentFit="contain"
        accessibilityLabel={`${choice.name} logo`}
        onError={() => setFailed(true)}
        style={[shape, { backgroundColor: t.colors.surface }]}
      />
    );
  }
  return (
    <View style={[shape, styles.center, { backgroundColor: t.tone("success").bg }]}>
      <AppText brandFont color={t.tone("success").fg} style={{ fontSize: size * 0.5, lineHeight: size * 0.6 }}>
        {choice.name.trim()[0]?.toUpperCase() ?? "·"}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  cta: {
    height: CTA_HEIGHT,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: SPACE.xl,
  },
  ctaInner: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  ctaLabel: { fontSize: 17, letterSpacing: 0.1 },
  secondary: {
    minHeight: CTA_HEIGHT - 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACE.sm,
    paddingHorizontal: SPACE.lg,
  },
  link: { minHeight: 44, justifyContent: "center", paddingHorizontal: SPACE.xs },
  back: {
    width: BACK_SIZE,
    height: BACK_SIZE,
    borderRadius: BACK_SIZE / 2,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACE.sm,
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.md + 2,
    borderRadius: RADIUS.lg + 4,
  },
  center: { alignItems: "center", justifyContent: "center" },
});
