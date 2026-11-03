import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { LivePulse } from "./LivePulse";
import { useLive } from "./useLive";

const HOME_POLL_MS = 20_000;

/**
 * Home's "Live now" line. Quiet when the store is empty (it still teaches the
 * owner the Live screen exists); green and pulsing when someone is on, with
 * checkouts called out — those are the visitors worth watching.
 */
export function LiveStrip() {
  const t = useTheme();
  const q = useLive(HOME_POLL_MS);
  const data = q.data;
  if (!data) return null; // first load / error: Home has enough else to show

  const live = data.total > 0;
  const checkout = data.stages.checkout;
  const ok = t.tone("success");
  const title = live ? `${data.total} live now` : "No one on your store right now";
  const sub = live
    ? [data.web > 0 ? `Website ${data.web}` : null, data.app > 0 ? `App ${data.app}` : null].filter(Boolean).join(" · ")
    : data.last24h > 0
      ? `${data.last24h} ${data.last24h === 1 ? "visitor" : "visitors"} in the last 24 hours`
      : "Visitors show up here the moment they arrive";

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}${checkout > 0 ? `, ${checkout} checking out` : ""}. Open live visitors.`}
      onPress={() => router.push("/live")}
      style={({ pressed }) => [
        styles.strip,
        {
          backgroundColor: live ? ok.bg : t.colors.surface,
          borderColor: live ? t.brand.link : t.colors.border,
          opacity: pressed ? 0.85 : 1,
        },
      ]}
    >
      <LivePulse color={live ? t.brand.link : t.colors.textFaint} active={live} />
      <View style={{ flex: 1 }}>
        <View style={styles.titleRow}>
          <AppText variant="bodyStrong" color={live ? ok.fg : t.colors.text} numberOfLines={1}>
            {title}
          </AppText>
          {checkout > 0 ? (
            <View style={[styles.badge, { backgroundColor: t.brand.link }]}>
              <AppText variant="caption" color="onPrimary" style={{ fontWeight: "600" }}>
                {`${checkout} checking out`}
              </AppText>
            </View>
          ) : null}
        </View>
        <AppText variant="caption" color="muted" numberOfLines={1}>
          {sub}
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={16} color={live ? t.brand.link : t.colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  strip: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.md,
    borderWidth: 1,
    borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.md,
    minHeight: 60,
  },
  titleRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap" },
  badge: { borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 1 },
});
