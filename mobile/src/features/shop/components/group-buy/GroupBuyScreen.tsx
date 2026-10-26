import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { router, Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { ShopCatalog, ShopGroupBuy, ShopProduct } from "@shop-contract";
import { useSession } from "@/auth/SessionProvider";
import { communityAccess } from "@/features/community/lib/access";
import { useNow } from "@/features/community/hooks/useMotion";
import { ShareGroupBuySheet } from "@/features/community/components/ShareGroupBuySheet";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, SkeletonList } from "@/ui/feedback";
import { AppText, Button, type IconName } from "@/ui/primitives";
import { useCatalog } from "../../hooks";
import { cartCount } from "../../lib/cart";
import { roundProducts, roundUrgency, slotMeter } from "../../lib/group-buy";
import { money } from "../../lib/money";
import { useShop } from "../../ShopProvider";
import { ProductCard } from "../ProductCard";
import { CartButton, Notice } from "../ShopUI";
import { CatalogError } from "../ShopStates";
import { groupBuyBand, LiveDot, RoundClock, SlotBar, URGENCY_COLOR } from "./GroupBuyParts";
import { GroupBuyJoinScreen } from "./GroupBuyJoin";

const GAP = SPACE.md;
const GUTTER = SPACE.lg;
const MINUTE = 60_000;

/**
 * The live group-buy round: hero (countdown, slots, delivery), the round's
 * products, and the owner's "How group buys work". Members can drop the round
 * into a chat; the store team can send it to everyone. Shared by the guest
 * shop, the customer app and the team's store preview.
 */
export function GroupBuyScreen() {
  const t = useTheme();
  const q = useCatalog();
  const shop = useShop();
  const headerRight =
    shop.mode === "preview" ? undefined : () => <CartButton count={cartCount(shop.lines)} onPress={() => router.push(shop.paths.cart)} onBand />;
  const screen = <Stack.Screen options={{ title: "Group buy", headerRight }} />;

  if (q.isPending) return <View style={{ flex: 1, backgroundColor: t.colors.bg }}>{screen}<SkeletonList rows={4} /></View>;
  if (q.isError || !q.data) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {screen}
        <CatalogError error={q.error ?? new Error("Couldn't load the group buy.")} storeName={t.brand.name} onRetry={() => void q.refetch()} />
      </View>
    );
  }
  const round = q.data.groupBuy;
  // Paid group buy the shopper isn't approved for yet: the join flow instead.
  if (!round && q.data.groupBuyTeaser) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {screen}
        <GroupBuyJoinScreen teaser={q.data.groupBuyTeaser} currency={q.data.store.currency} onRefreshCatalog={() => void q.refetch()} />
      </View>
    );
  }
  if (!round) {
    return (
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {screen}
        <EmptyState
          icon="people-outline"
          title="No group buy right now"
          body="This round has closed. New rounds show up here and in the shop the moment they open."
          action={{ label: "Back to the shop", onPress: () => router.navigate(shop.paths.home) }}
        />
      </View>
    );
  }
  return (
    <>
      {screen}
      <RoundBody round={round} catalog={q.data} refreshing={q.isRefetching} onRefresh={() => void q.refetch()} />
    </>
  );
}

type ShareMode = "share" | "broadcast" | null;

/** Customers in the community may share; the team's preview may send to everyone. */
function useShareMode(): ShareMode {
  const { state } = useSession();
  const shop = useShop();
  if (state.status !== "signedIn") return null;
  const access = communityAccess(state.me);
  if (shop.mode === "preview") return access.moderator ? "broadcast" : null;
  return access.inCommunity ? "share" : null;
}

function RoundBody({ round, catalog, refreshing, onRefresh }: { round: ShopGroupBuy; catalog: ShopCatalog; refreshing: boolean; onRefresh: () => void }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const shop = useShop();
  const mode = useShareMode();
  const [sharing, setSharing] = useState(false);
  const tile = Math.floor((width - GUTTER * 2 - GAP) / 2);
  const products = useMemo(() => roundProducts(catalog), [catalog]);
  const open = useCallback((id: string) => router.push(shop.paths.product(id)), [shop.paths]);
  const canShare = mode !== null && round.ordering === "open";
  const barHeight = canShare ? 76 + insets.bottom : 0;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <FlatList
        data={products}
        keyExtractor={(p) => p.id}
        numColumns={2}
        columnWrapperStyle={{ gap: GAP, paddingHorizontal: GUTTER }}
        ItemSeparatorComponent={Separator}
        contentContainerStyle={{ paddingBottom: SPACE.xxxl + insets.bottom + barHeight }}
        renderItem={({ item }: { item: ShopProduct }) => <ProductCard product={item} currency={catalog.store.currency} width={tile} onPress={open} />}
        ListHeaderComponent={
          <View style={{ gap: SPACE.xl, paddingBottom: SPACE.lg }}>
            <Hero round={round} currency={catalog.store.currency} />
            <View style={{ paddingHorizontal: GUTTER, gap: SPACE.md }}>
              {round.ordering === "closed" ? (
                <Notice tone="warning" icon="pause-circle">
                  Ordering is paused for this round. Prices are shown so you can plan — check back soon.
                </Notice>
              ) : !catalog.open ? (
                <Notice tone="warning" icon="moon">
                  {catalog.closedMessage || "The shop is closed right now."}
                </Notice>
              ) : null}
              <View style={styles.sectionHead}>
                <AppText variant="heading" brandFont accessibilityRole="header">
                  In this round
                </AppText>
                <AppText variant="caption" color="muted">
                  {products.length} {products.length === 1 ? "item" : "items"}
                </AppText>
              </View>
            </View>
          </View>
        }
        ListFooterComponent={<HowItWorks round={round} />}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand.link} />}
      />
      {canShare ? (
        <View style={[styles.bar, { paddingBottom: insets.bottom + SPACE.md, backgroundColor: t.colors.surface, borderTopColor: t.colors.border }]}>
          {mode === "share" ? (
            <Button label="Share in a chat" icon="chatbubble-ellipses-outline" onPress={() => setSharing(true)} />
          ) : (
            <Button label="Send to everyone in the community" icon="megaphone-outline" onPress={() => router.push("/community/group-buy-broadcast")} />
          )}
        </View>
      ) : null}
      {mode === "share" ? <ShareGroupBuySheet visible={sharing} roundId={round.id} roundName={round.name} onClose={() => setSharing(false)} /> : null}
    </View>
  );
}

function Separator() {
  return <View style={{ height: GAP }} />;
}

function Hero({ round, currency }: { round: ShopGroupBuy; currency: string }) {
  const t = useTheme();
  const band = groupBuyBand(t.brand.primary);
  const now = useNow(MINUTE);
  const urgency = roundUrgency(round.endsAt, now);
  const meter = slotMeter(round.slotGoal, round.filled);
  const paused = round.ordering === "closed";
  const facts: { icon: IconName; text: string }[] = [
    ...(round.deliveryEta ? [{ icon: "cube-outline" as IconName, text: `Ships ${round.deliveryEta}` }] : []),
    ...(round.fromPrice !== null ? [{ icon: "pricetag-outline" as IconName, text: `From ${money(round.fromPrice, currency)}` }] : []),
  ];

  return (
    <LinearGradient colors={[band.top, band.bottom]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.hero}>
      <View style={[styles.glow, { backgroundColor: band.glow }]} pointerEvents="none" />
      <View style={styles.eyebrow}>
        <LiveDot live={!paused && !urgency.ended} />
        <AppText variant="overline" color={band.text}>
          {paused ? "Group buy · ordering paused" : "Live group buy"}
        </AppText>
      </View>
      <View style={{ gap: SPACE.xs }}>
        <AppText variant="display" brandFont color={band.text} accessibilityRole="header">
          {round.name}
        </AppText>
        {round.description ? (
          <AppText variant="body" color={band.muted}>
            {round.description}
          </AppText>
        ) : null}
      </View>

      {round.endsAt && !urgency.ended ? (
        <View style={{ gap: SPACE.sm }}>
          <View style={styles.row}>
            <Ionicons name="time-outline" size={14} color={URGENCY_COLOR[urgency.tone]} />
            <AppText variant="caption" color={URGENCY_COLOR[urgency.tone]}>
              {urgency.tone === "last" ? "Last day to join" : "Round closes in"}
            </AppText>
          </View>
          <RoundClock endsAt={round.endsAt} color={band.text} boxColor={band.chip} />
        </View>
      ) : (
        <View style={[styles.chip, { backgroundColor: band.chip }]}>
          <Ionicons name="time-outline" size={13} color={URGENCY_COLOR[urgency.tone]} />
          <AppText variant="caption" color={URGENCY_COLOR[urgency.tone]}>
            {urgency.label}
          </AppText>
        </View>
      )}

      {meter.enabled ? (
        <View style={{ gap: 8 }}>
          <View style={styles.meterRow}>
            <AppText variant="bodyStrong" color={band.text}>
              {meter.label}
            </AppText>
            <AppText variant="caption" color={band.muted}>
              {meter.hint}
            </AppText>
          </View>
          <SlotBar meter={meter} fill={band.fill} track={band.track} height={10} />
        </View>
      ) : meter.filled > 0 ? (
        <View style={styles.row}>
          <Ionicons name="people" size={15} color={band.text} />
          <AppText variant="bodyStrong" color={band.text}>
            {meter.filled} already joined
          </AppText>
        </View>
      ) : null}

      {facts.length ? (
        <View style={[styles.facts, { borderTopColor: band.line }]}>
          {facts.map((f) => (
            <View key={f.text} style={styles.row}>
              <Ionicons name={f.icon} size={15} color={band.muted} />
              <AppText variant="caption" color={band.text}>
                {f.text}
              </AppText>
            </View>
          ))}
        </View>
      ) : null}
    </LinearGradient>
  );
}

function HowItWorks({ round }: { round: ShopGroupBuy }) {
  const t = useTheme();
  if (!round.steps.length) return null;
  return (
    <View style={{ paddingHorizontal: GUTTER, paddingTop: SPACE.xxl, gap: SPACE.md }}>
      <AppText variant="heading" brandFont accessibilityRole="header">
        {round.howTitle}
      </AppText>
      <View style={[styles.steps, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        {round.steps.map((step, i) => (
          <View key={`${i}-${step}`} style={styles.step}>
            <View style={[styles.stepNum, { backgroundColor: t.brand.primary }]}>
              <AppText variant="label" color={t.brand.onPrimary}>
                {i + 1}
              </AppText>
            </View>
            <AppText variant="body" style={{ flex: 1 }}>
              {step}
            </AppText>
          </View>
        ))}
      </View>
      {round.terms ? (
        <View style={styles.row}>
          <Ionicons name="shield-checkmark-outline" size={15} color={t.colors.textMuted} />
          <AppText variant="caption" color="muted" style={{ flex: 1 }}>
            {round.terms}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  hero: { marginHorizontal: GUTTER, marginTop: SPACE.md, borderRadius: RADIUS.lg + 8, padding: SPACE.xl, gap: SPACE.lg, overflow: "hidden" },
  glow: { position: "absolute", width: 280, height: 280, borderRadius: 140, top: -140, right: -90 },
  eyebrow: { flexDirection: "row", alignItems: "center", gap: 2, marginLeft: -6 },
  row: { flexDirection: "row", alignItems: "center", gap: 6 },
  chip: { flexDirection: "row", alignItems: "center", gap: 5, alignSelf: "flex-start", paddingHorizontal: 10, height: 28, borderRadius: RADIUS.pill },
  meterRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: SPACE.sm },
  facts: { flexDirection: "row", flexWrap: "wrap", columnGap: SPACE.lg, rowGap: SPACE.sm, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  sectionHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" },
  steps: { borderRadius: RADIUS.lg, borderWidth: StyleSheet.hairlineWidth, padding: SPACE.lg, gap: SPACE.lg },
  step: { flexDirection: "row", gap: SPACE.md, alignItems: "flex-start" },
  stepNum: { width: 26, height: 26, borderRadius: 13, alignItems: "center", justifyContent: "center" },
  bar: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: GUTTER, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
});
