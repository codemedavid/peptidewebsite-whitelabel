import { RefreshControl, ScrollView, Share, StyleSheet, View } from "react-native";
import Animated, { FadeIn, FadeOut, LinearTransition } from "react-native-reanimated";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { LiveResponse, LiveStage } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useNow, useReducedMotion } from "@/features/community/hooks/useMotion";
import { LivePulse } from "@/features/live/LivePulse";
import { shortAgo, STAGE_META } from "@/features/live/stage";
import { useLive } from "@/features/live/useLive";
import { VisitorRow } from "@/features/live/VisitorRow";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { BarList } from "@/ui/charts/Bars";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Panel, SectionHeader } from "@/ui/kit";
import { AppText } from "@/ui/primitives";

const LIVE_POLL_MS = 10_000;
const FUNNEL: readonly LiveStage[] = ["browsing", "product", "cart", "checkout"];

/** The dark band: how many people, where they came in from, and how fresh it is. */
function LiveHero({ data, updatedSecs }: { data: LiveResponse; updatedSecs: number }) {
  const t = useTheme();
  const live = data.total > 0;
  const webShare = live ? data.web / data.total : 0;
  return (
    <View style={[styles.band, { backgroundColor: t.colors.band }]}>
      <View style={styles.bandTop}>
        <View style={styles.inline}>
          <LivePulse color={live ? t.colors.chartOnBand : t.colors.bandMuted} active={live} />
          <AppText variant="overline" color={t.colors.bandMuted}>
            LIVE NOW
          </AppText>
        </View>
        <AppText variant="caption" color={t.colors.bandMuted} style={styles.tabular}>
          {updatedSecs < 5 ? "Updated just now" : `Updated ${shortAgo(updatedSecs)} ago`}
        </AppText>
      </View>
      <View style={styles.inlineBase}>
        <AppText variant="number" color={t.colors.bandText} style={styles.tabular} accessibilityRole="header">
          {String(data.total)}
        </AppText>
        <AppText variant="body" color={t.colors.bandMuted}>
          {data.total === 1 ? "person on your store" : "people on your store"}
        </AppText>
      </View>
      <View
        style={[styles.split, { backgroundColor: t.colors.bandLine }]}
        accessible
        accessibilityLabel={`Website ${data.web}, app ${data.app}`}
      >
        {live ? <View style={{ flex: webShare, backgroundColor: t.colors.chartOnBand }} /> : null}
        {live && data.app > 0 ? <View style={{ flex: 1 - webShare, backgroundColor: t.colors.bandText, opacity: 0.55 }} /> : null}
      </View>
      <View style={styles.bandFoot}>
        <View style={styles.inline}>
          <Ionicons name="globe-outline" size={13} color={t.colors.bandMuted} />
          <AppText variant="caption" color={t.colors.bandText}>{`Website ${data.web}`}</AppText>
        </View>
        <View style={styles.inline}>
          <Ionicons name="phone-portrait-outline" size={13} color={t.colors.bandMuted} />
          <AppText variant="caption" color={t.colors.bandText}>{`App ${data.app}`}</AppText>
        </View>
      </View>
    </View>
  );
}

/** Browsing → Product → Cart → Checkout, the last one lit when anyone is in it. */
function Funnel({ stages }: { stages: LiveResponse["stages"] }) {
  const t = useTheme();
  return (
    <View style={styles.funnel}>
      {FUNNEL.map((stage, i) => {
        const meta = STAGE_META[stage];
        const count = stages[stage];
        const hot = stage === "checkout" && count > 0;
        const tone = t.tone(meta.tone);
        return (
          <View key={stage} style={styles.funnelCell}>
            <View
              accessible
              accessibilityLabel={`${meta.label}: ${count}`}
              style={[
                styles.stage,
                {
                  backgroundColor: hot ? tone.bg : t.colors.surface,
                  borderColor: hot ? t.brand.link : t.colors.border,
                },
              ]}
            >
              <Ionicons name={meta.icon} size={15} color={count > 0 ? tone.fg : t.colors.textFaint} />
              <AppText variant="stat" color={hot ? tone.fg : count > 0 ? t.colors.text : t.colors.textFaint} style={styles.tabular}>
                {String(count)}
              </AppText>
              <AppText variant="caption" color="muted" numberOfLines={1} style={styles.stageLabel}>
                {meta.short}
              </AppText>
            </View>
            {i < FUNNEL.length - 1 ? (
              <Ionicons name="chevron-forward" size={12} color={t.colors.textFaint} style={styles.arrow} />
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function Feed({ data, elapsed }: { data: LiveResponse; elapsed: number }) {
  const reduced = useReducedMotion();
  // Rows ease in and out as people come and go, instead of jumping.
  const motion = reduced ? {} : { entering: FadeIn.duration(250), exiting: FadeOut.duration(200), layout: LinearTransition.duration(250) };
  return (
    <View>
      <SectionHeader eyebrow="Right now" title="Who's on your store" />
      <Panel style={{ padding: SPACE.xs, gap: 2 }}>
        {data.visitors.map((v) => (
          <Animated.View key={v.id} {...motion}>
            <VisitorRow visitor={v} elapsed={elapsed} />
          </Animated.View>
        ))}
        {data.more > 0 ? (
          <AppText variant="caption" color="muted" style={styles.more}>
            {`+ ${data.more} more browsing`}
          </AppText>
        ) : null}
      </Panel>
    </View>
  );
}

export default function LiveScreen() {
  const t = useTheme();
  const { me } = useSignedIn();
  const q = useLive(LIVE_POLL_MS);
  const now = useNow(1_000);

  if (!me.can.analytics) {
    return (
      <EmptyState
        icon="radio-outline"
        title="Live visitors aren't on for this account"
        body="They come with the store's Sales Insights plan and the owner's permission."
      />
    );
  }

  const data = q.data;
  const elapsed = q.dataUpdatedAt ? Math.max(0, Math.floor((now - q.dataUpdatedAt) / 1000)) : 0;
  const shareStore = () => void Share.share({ message: me.store.websiteUrl, url: me.store.websiteUrl });

  return (
    <View style={{ flex: 1 }}>
      <OfflineBanner />
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={t.brand.link} />}
      >
        {q.isPending ? (
          <SkeletonList rows={4} />
        ) : q.isError && !data ? (
          <ErrorState message={q.error?.message ?? "Couldn't load live visitors."} onRetry={() => void q.refetch()} />
        ) : data ? (
          <>
            <LiveHero data={data} updatedSecs={elapsed} />
            <Funnel stages={data.stages} />
            {data.total > 0 ? (
              <Feed data={data} elapsed={elapsed} />
            ) : (
              <EmptyState
                icon="radio-outline"
                title="Nobody's on your store right now"
                body="When someone opens your website or the app, they show up here within seconds."
                action={{ label: "Share your store link", onPress: shareStore }}
              />
            )}
            {data.places.length > 0 ? (
              <View>
                <SectionHeader eyebrow="Places" title="Where they are" />
                <Panel>
                  <BarList rows={data.places} />
                </Panel>
              </View>
            ) : null}
            <View style={[styles.footnote, { borderColor: t.colors.border }]}>
              <Ionicons name="time-outline" size={14} color={t.colors.textMuted} />
              <AppText variant="caption" color="muted" style={{ flex: 1 }}>
                {`${data.last24h} ${data.last24h === 1 ? "visitor" : "visitors"} in the last 24 hours. Website visitors are anonymous; app customers show by name. Places are approximate.`}
              </AppText>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, gap: SPACE.xl, paddingBottom: SPACE.xxxl },
  band: { borderRadius: RADIUS.lg, padding: SPACE.lg, gap: SPACE.md },
  bandTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  bandFoot: { flexDirection: "row", justifyContent: "space-between" },
  inline: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  inlineBase: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm, flexWrap: "wrap" },
  split: { flexDirection: "row", height: 6, borderRadius: 3, overflow: "hidden" },
  funnel: { flexDirection: "row", alignItems: "center" },
  funnelCell: { flex: 1, flexDirection: "row", alignItems: "center" },
  stage: { flex: 1, borderWidth: 1, borderRadius: RADIUS.md, paddingVertical: SPACE.md, paddingHorizontal: 6, alignItems: "center", gap: 2 },
  stageLabel: { fontSize: 12 },
  arrow: { marginHorizontal: 1 },
  more: { textAlign: "center", paddingVertical: SPACE.md },
  footnote: { flexDirection: "row", gap: SPACE.sm, borderTopWidth: 1, paddingTop: SPACE.md },
  tabular: { fontVariant: ["tabular-nums"] },
});
