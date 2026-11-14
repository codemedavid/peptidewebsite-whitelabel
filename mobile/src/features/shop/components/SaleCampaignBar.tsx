import { useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQueryClient } from "@tanstack/react-query";
import type { ShopSaleCampaign } from "@shop-contract";
import { useNow } from "@/features/community/hooks/useMotion";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText } from "@/ui/primitives";
import { shopKeys } from "../api";
import { campaignBar, campaignPhase, type CampaignPhase } from "../lib/campaign";
import { useShop } from "../ShopProvider";

const TICK_MS = 1000;

/**
 * The website's Sale Campaign strip ("11.11 Mega Sale starts in 2d 04:11:09",
 * then "… LIVE · ends in 03:12:44"). Renders nothing without a campaign.
 */
export function SaleCampaignBar({ campaign }: { campaign: ShopSaleCampaign | null | undefined }) {
  if (!campaign) return null;
  return <CampaignClock campaign={campaign} />;
}

function CampaignClock({ campaign }: { campaign: ShopSaleCampaign }) {
  const t = useTheme();
  const now = useNow(TICK_MS);
  const phase = campaignPhase(campaign, now);
  usePhaseRefresh(phase);
  const bar = campaignBar(campaign, now);
  if (!bar) return null;

  const live = bar.phase === "live";
  const when = new Date(bar.target).toLocaleString();
  return (
    <View
      accessible
      accessibilityLabel={`${campaign.name}${live ? ", live now" : ""}. ${live ? "Ends" : "Starts"} ${when}.`}
      style={[styles.bar, { backgroundColor: t.brand.primary }]}
    >
      <Ionicons name={live ? "flash" : "time-outline"} size={16} color={t.brand.onPrimary} />
      <AppText variant="label" color={t.brand.onPrimary} numberOfLines={1} style={styles.name}>
        {campaign.name}
      </AppText>
      {live ? (
        <View style={[styles.live, { borderColor: t.brand.onPrimary }]}>
          <AppText variant="overline" color={t.brand.onPrimary}>LIVE</AppText>
        </View>
      ) : null}
      <AppText variant="caption" color={t.brand.onPrimary} style={{ opacity: 0.85 }}>
        {bar.label}
      </AppText>
      <AppText variant="bodyStrong" color={t.brand.onPrimary} style={styles.clock}>
        {bar.clock}
      </AppText>
    </View>
  );
}

/**
 * When the phase flips (teaser → live → ended) refetch the catalog and quotes
 * once, so campaign-only sale prices appear and disappear on screen at the
 * moment the clock says — the same refresh the website's bar triggers.
 */
function usePhaseRefresh(phase: CampaignPhase) {
  const { scope } = useShop();
  const qc = useQueryClient();
  const last = useRef<CampaignPhase | null>(null);
  useEffect(() => {
    if (last.current !== null && last.current !== phase) {
      void qc.invalidateQueries({ queryKey: shopKeys.all(scope) });
    }
    last.current = phase;
  }, [phase, qc, scope]);
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingHorizontal: SPACE.lg,
    paddingVertical: SPACE.sm,
  },
  name: { flexShrink: 1 },
  live: { borderWidth: 1, borderRadius: RADIUS.sm, paddingHorizontal: SPACE.xs, paddingVertical: 1 },
  clock: { marginLeft: "auto", fontVariant: ["tabular-nums"] },
});
