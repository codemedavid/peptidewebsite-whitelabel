import { Pressable, StyleSheet, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopGroupBuy } from "@shop-contract";
import { useNow } from "@/features/community/hooks/useMotion";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { roundUrgency, slotMeter } from "../../lib/group-buy";
import { money } from "../../lib/money";
import { groupBuyBand, ImageStack, LiveDot, SlotBar, URGENCY_COLOR } from "./GroupBuyParts";

const MINUTE = 60_000;

/** The shop front's invitation into the live round — tap for the group-buy screen. */
export function GroupBuyBanner({ round, currency, onPress }: { round: ShopGroupBuy; currency: string; onPress: () => void }) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  const now = useNow(MINUTE);
  const urgency = roundUrgency(round.endsAt, now);
  const meter = slotMeter(round.slotGoal, round.filled);
  const paused = round.ordering === "closed";
  const items = round.productIds.length;
  const price = round.fromPrice !== null ? `From ${money(round.fromPrice, currency)}` : null;
  const status = paused ? "Ordering paused" : urgency.label;
  const a11y = [`Group buy ${round.name}`, status, meter.enabled ? meter.label : null, price].filter(Boolean).join(", ");

  return (
    <Pressable
      onPress={() => {
        void Haptics.selectionAsync().catch(() => undefined);
        onPress();
      }}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityHint="Opens the group buy"
      style={({ pressed }) => [styles.shadow, { transform: [{ scale: pressed ? 0.985 : 1 }] }]}
    >
      <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
        <View style={[styles.glow, { backgroundColor: band.glow }]} pointerEvents="none" />
        <View style={styles.topRow}>
          <View style={styles.eyebrow}>
            <LiveDot live={!paused && !urgency.ended} />
            <AppText variant="overline" color={band.text}>
              {paused ? "Group buy" : "Live group buy"}
            </AppText>
          </View>
          <View style={[styles.pill, { backgroundColor: band.chip }]}>
            <Ionicons name={paused ? "pause" : "time-outline"} size={12} color={paused ? band.muted : URGENCY_COLOR[urgency.tone]} />
            <AppText variant="caption" color={paused ? band.muted : URGENCY_COLOR[urgency.tone]}>
              {status}
            </AppText>
          </View>
        </View>

        <View style={{ gap: 2 }}>
          <AppText variant="title" brandFont color={band.text} numberOfLines={2}>
            {round.name}
          </AppText>
          {round.description ? (
            <AppText variant="body" color={band.muted} numberOfLines={2}>
              {round.description}
            </AppText>
          ) : null}
        </View>

        {meter.enabled ? (
          <View style={{ gap: 6 }}>
            <SlotBar meter={meter} fill={band.fill} track={band.track} />
            <View style={styles.meterRow}>
              <AppText variant="caption" color={band.text}>
                {meter.label}
              </AppText>
              <AppText variant="caption" color={band.muted}>
                {meter.hint}
              </AppText>
            </View>
          </View>
        ) : null}

        <View style={[styles.footer, { borderTopColor: band.line }]}>
          <ImageStack images={round.images} ring={band.top} />
          <View style={{ flex: 1 }}>
            {price ? (
              <AppText variant="bodyStrong" color={band.text} numberOfLines={1}>
                {price}
              </AppText>
            ) : null}
            <AppText variant="caption" color={band.muted} numberOfLines={1}>
              {items} {items === 1 ? "item" : "items"} in this round
            </AppText>
          </View>
          <View style={[styles.cta, { backgroundColor: band.text }]}>
            <AppText variant="label" color={band.bottom}>
              {paused ? "View" : "Join"}
            </AppText>
            <Ionicons name="arrow-forward" size={15} color={band.bottom} />
          </View>
        </View>
      </LinearGradient>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  shadow: { borderRadius: RADIUS.lg + 4, shadowColor: "#000", shadowOpacity: 0.18, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 6 },
  card: { borderRadius: RADIUS.lg + 4, padding: SPACE.lg, gap: SPACE.md, overflow: "hidden" },
  glow: { position: "absolute", width: 220, height: 220, borderRadius: 110, top: -110, right: -70 },
  topRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: SPACE.sm },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -6 },
  pill: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, height: 26, borderRadius: RADIUS.pill },
  meterRow: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.sm },
  footer: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  cta: { flexDirection: "row", alignItems: "center", gap: 6, height: 40, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill },
});
