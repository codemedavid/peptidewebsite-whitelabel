import { useEffect, useRef, useState } from "react";
import { Animated, StyleSheet, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Button, type IconName } from "./primitives";

// ── connectivity ─────────────────────────────────────────────────────────────

/** True while the device reports a usable connection (unknown counts as online). */
export function useOnline(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(
    () =>
      NetInfo.addEventListener((s) => {
        setOnline(s.isConnected !== false && s.isInternetReachable !== false);
      }),
    [],
  );
  return online;
}

export function OfflineBanner() {
  const t = useTheme();
  const online = useOnline();
  if (online) return null;
  const c = t.tone("warning");
  return (
    <View accessibilityLiveRegion="polite" style={[styles.banner, { backgroundColor: c.bg }]}>
      <Ionicons name="cloud-offline-outline" size={18} color={c.fg} />
      <AppText variant="label" color={c.fg} style={{ flex: 1 }}>
        You're offline. You can look around, but changes are paused until you reconnect.
      </AppText>
    </View>
  );
}

// ── loading skeleton ─────────────────────────────────────────────────────────

function useShimmer() {
  const v = useRef(new Animated.Value(0.45)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(v, { toValue: 0.45, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v]);
  return v;
}

export function SkeletonList({ rows = 5 }: { rows?: number }) {
  const t = useTheme();
  const opacity = useShimmer();
  return (
    <View accessible accessibilityLabel="Loading" style={{ gap: SPACE.md, padding: SPACE.lg }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View
          key={i}
          style={[styles.skeleton, { backgroundColor: t.colors.surfaceAlt, opacity }]}
        />
      ))}
    </View>
  );
}

// ── empty / error ────────────────────────────────────────────────────────────

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={styles.center}>
      <View style={[styles.emptyIcon, { backgroundColor: t.colors.surfaceAlt }]}>
        <Ionicons name={icon} size={28} color={t.colors.textMuted} />
      </View>
      <AppText variant="heading" style={styles.centerText}>
        {title}
      </AppText>
      {body ? (
        <AppText variant="body" color="muted" style={styles.centerText}>
          {body}
        </AppText>
      ) : null}
      {action ? <Button label={action.label} variant="secondary" onPress={action.onPress} style={{ marginTop: SPACE.md }} /> : null}
    </View>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <EmptyState
      icon="alert-circle-outline"
      title="Couldn't load this"
      body={message}
      action={onRetry ? { label: "Try again", onPress: onRetry } : undefined}
    />
  );
}

const styles = StyleSheet.create({
  banner: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, paddingHorizontal: SPACE.lg, paddingVertical: SPACE.md },
  skeleton: { height: 92, borderRadius: RADIUS.lg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: SPACE.xxl, gap: SPACE.sm, minHeight: 320 },
  centerText: { textAlign: "center", maxWidth: 320 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", marginBottom: SPACE.sm },
});
