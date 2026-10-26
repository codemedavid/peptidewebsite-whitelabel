import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopGroupBuyTeaser } from "@shop-contract";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { groupBuyBand, LiveDot } from "./GroupBuyParts";

/** Memberships that ended — the shopper is starting over, not checking on one. */
const ENDED = new Set(["cancelled", "expired"]);
export const JOIN_HERO_RADIUS = 20;

/** "Join for ₱500" / "Join this group buy" — the teaser's own price label. */
export function joinCta(teaser: ShopGroupBuyTeaser): string {
  const own = teaser.copy?.button.trim();
  if (own) return own;
  return teaser.joinFeeCents > 0 ? `Join for ${teaser.amountLabel}` : "Join this group buy";
}

/** The shop front's invitation into a gated round the shopper isn't in yet. */
export function GroupBuyJoinBanner({ teaser, onPress }: { teaser: ShopGroupBuyTeaser; onPress: () => void }) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  if (teaser.state === "closed") return null;
  const m = teaser.membership && !ENDED.has(teaser.membership.status) ? teaser.membership : null;
  const cta = m ? "See your status" : joinCta(teaser);
  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={`Members-only group buy ${teaser.name}. ${m ? m.headline : cta}`}
      style={({ pressed }) => [styles.shadow, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.banner}>
        <View style={styles.eyebrow}>
          <LiveDot live={teaser.state === "live"} />
          <AppText variant="overline" color={band.text}>
            {teaser.state === "live" ? "Live · members only" : "Coming soon · members only"}
          </AppText>
        </View>
        <AppText variant="heading" brandFont color={band.text} numberOfLines={2}>
          {teaser.name}
        </AppText>
        {m?.headline ? (
          <AppText variant="caption" color={band.muted} numberOfLines={2}>
            {m.headline}
          </AppText>
        ) : teaser.steps.length > 1 ? (
          <AppText variant="caption" color={band.muted} numberOfLines={2}>
            {teaser.steps.join("  →  ")}
          </AppText>
        ) : null}
        <View style={styles.cta}>
          <AppText variant="label" color={band.text}>
            {cta}
          </AppText>
          <Ionicons name="arrow-forward" size={16} color={band.text} />
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: JOIN_HERO_RADIUS, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  banner: { borderRadius: JOIN_HERO_RADIUS, padding: SPACE.lg, gap: SPACE.xs, overflow: "hidden" },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  cta: { flexDirection: "row", alignItems: "center", gap: SPACE.xs, marginTop: SPACE.xs },
});
