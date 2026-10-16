import { useEffect, useState, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import { withAlpha } from "@/features/community/lib/color";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, type IconName } from "@/ui/primitives";
import type { AuthAccent } from "../sign-in/parts";

/**
 * The little "what's inside" cards that float around the welcome mascot —
 * a shop drop, a chat, a shipped order. Pure illustration: no
 * data, no taps (the stage hides them from screen readers).
 */

const ICON_BUBBLE = 30;
/** The chat card "types" for this long before its message lands. */
const TYPING_MS = 1700;

export function ChipCard({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: t.colors.surface,
          borderColor: t.colors.border,
          boxShadow: `0 14px 30px -16px ${withAlpha(t.colors.text, 0.45)}`,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}

function IconBubble({ icon, bg, fg }: { icon: IconName; bg: string; fg: string }) {
  return (
    <View style={[styles.bubble, { backgroundColor: bg }]}>
      <Ionicons name={icon} size={16} color={fg} />
    </View>
  );
}

function Lines({ title, sub }: { title: string; sub: string }) {
  return (
    <View style={styles.lines}>
      <AppText variant="caption" numberOfLines={1} style={styles.title}>
        {title}
      </AppText>
      <AppText variant="caption" color="muted" numberOfLines={1} style={styles.sub}>
        {sub}
      </AppText>
    </View>
  );
}

export function DropChip({ accent }: { accent: AuthAccent }) {
  return (
    <ChipCard style={styles.row}>
      <IconBubble icon="bag-handle" bg={withAlpha(accent.tint, 0.16)} fg={accent.link} />
      <Lines title="New drop" sub="Just landed in the shop" />
      <View style={[styles.badge, { backgroundColor: accent.fill }]}>
        <AppText variant="overline" color={accent.onFill} style={styles.badgeText}>
          NEW
        </AppText>
      </View>
    </ChipCard>
  );
}

const AVATARS = [
  { initial: "M", bg: "#FFD9C2", fg: "#7A3410" },
  { initial: "J", bg: "#D6E4FF", fg: "#1F3F8A" },
  { initial: "A", bg: "#F3D6F0", fg: "#6E2167" },
] as const;

export function ChatChip({ accent }: { accent: AuthAccent }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    if (reduced) return;
    const id = setTimeout(() => setLanded(true), TYPING_MS);
    return () => clearTimeout(id);
  }, [reduced]);
  // Less motion: the message is simply there, no typing beat.
  const typing = !reduced && !landed;

  return (
    <View style={styles.chat}>
      <View style={styles.avatars}>
        {AVATARS.map((a, i) => (
          <View
            key={a.initial}
            style={[
              styles.avatar,
              {
                backgroundColor: a.bg,
                borderColor: t.colors.surface,
                marginLeft: i === 0 ? 0 : -8,
                zIndex: AVATARS.length - i,
              },
            ]}
          >
            <AppText variant="caption" color={a.fg} style={styles.avatarText}>
              {a.initial}
            </AppText>
          </View>
        ))}
        <View style={[styles.online, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
          <View style={[styles.onlineDot, { backgroundColor: accent.tint }]} />
          <AppText variant="caption" color="muted" style={styles.sub}>
            128 online
          </AppText>
        </View>
      </View>
      <ChipCard style={styles.speech}>
        {typing ? (
          <TypingDots color={t.colors.textFaint} />
        ) : (
          <Animated.View entering={FadeIn.duration(260)}>
            <AppText variant="caption" numberOfLines={1} style={styles.title}>
              Restock is live! 🎉
            </AppText>
          </Animated.View>
        )}
      </ChipCard>
    </View>
  );
}

function TypingDots({ color }: { color: string }) {
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => (
        <TypingDot key={i} index={i} color={color} />
      ))}
    </View>
  );
}

const DOT_STEP_MS = 140;
const DOT_BOUNCE_MS = 280;

function TypingDot({ index, color }: { index: number; color: string }) {
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = withDelay(
      index * DOT_STEP_MS,
      withRepeat(
        withSequence(
          withTiming(1, { duration: DOT_BOUNCE_MS, easing: Easing.out(Easing.quad) }),
          withTiming(0, { duration: DOT_BOUNCE_MS, easing: Easing.in(Easing.quad) }),
          withTiming(0, { duration: DOT_STEP_MS * 2 }),
        ),
        -1,
      ),
    );
    return () => cancelAnimation(lift);
  }, [index, lift]);
  const style = useAnimatedStyle(() => ({
    opacity: 0.45 + lift.value * 0.55,
    transform: [{ translateY: -lift.value * 3 }],
  }));
  return <Animated.View style={[styles.dot, { backgroundColor: color }, style]} />;
}

export function ShippedChip() {
  const t = useTheme();
  const ok = t.tone("success");
  return (
    <ChipCard style={styles.row}>
      <IconBubble icon="checkmark-done" bg={ok.bg} fg={ok.fg} />
      <Lines title="Order shipped" sub="Arriving Thursday" />
    </ChipCard>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: RADIUS.lg + 6,
    borderWidth: StyleSheet.hairlineWidth,
    paddingVertical: SPACE.sm + 2,
    paddingHorizontal: SPACE.md,
  },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.sm + 2 },
  bubble: {
    width: ICON_BUBBLE,
    height: ICON_BUBBLE,
    borderRadius: ICON_BUBBLE / 2,
    alignItems: "center",
    justifyContent: "center",
  },
  lines: { flexShrink: 1, gap: 1 },
  title: { fontWeight: "600", fontSize: 13, lineHeight: 17 },
  sub: { fontSize: 12, lineHeight: 15 },
  badge: { borderRadius: RADIUS.pill, paddingHorizontal: 7, paddingVertical: 3, marginLeft: 2 },
  badgeText: { fontSize: 9, lineHeight: 11, letterSpacing: 1 },
  chat: { gap: 6, alignItems: "flex-end" },
  avatars: { flexDirection: "row", alignItems: "center" },
  avatar: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { fontWeight: "700", fontSize: 11, lineHeight: 13 },
  online: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    marginLeft: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.pill,
    borderWidth: StyleSheet.hairlineWidth,
  },
  onlineDot: { width: 7, height: 7, borderRadius: 4 },
  speech: { minHeight: 38, minWidth: 64, justifyContent: "center", borderBottomRightRadius: 6 },
  dots: { flexDirection: "row", gap: 4, paddingVertical: 4 },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
