import { Pressable, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { DashboardGbKit, DashboardGroupBuyResponse, Tone } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { Panel, SectionHeader } from "@/ui/kit";
import { AppText, Button, Pill } from "@/ui/primitives";
import { MeterList } from "./MeterList";
import { roundHref } from "./targets";

/**
 * Home's Group Buy card — the website dashboard's DashboardGroupBuy. On a
 * group-buy store it replaces "Stock levels" (every pre-order item reads "Out
 * of stock" there): how the round is filling, who still owes money, who is
 * waiting to be let in, and which kits are short. Display-ready from
 * GET /dashboard/group-buy.
 */

type Ready = Extract<DashboardGroupBuyResponse, { status: "ready" }>;
type Empty = Extract<DashboardGroupBuyResponse, { status: "empty" }>;

const TIMING_TONE: Record<Ready["timing"]["tone"], Tone> = { neutral: "neutral", good: "success", warn: "warning", bad: "danger" };
const KIT_TONE: Record<DashboardGbKit["tone"], Tone> = { full: "success", close: "info", filling: "neutral", risk: "warning" };

const manage = () => router.push("/manage/group-buys");
const joins = () => router.push("/manage/join-requests");

function Stat({ label, value, sub, tone, onPress }: { label: string; value: number; sub: string; tone?: Tone; onPress?: () => void }) {
  const t = useTheme();
  const c = tone ? t.tone(tone) : null;
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      accessibilityLabel={`${label}: ${value}, ${sub}`}
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stat,
        { borderColor: c ? c.fg : t.colors.border, backgroundColor: c ? c.bg : t.colors.surface },
        pressed ? { opacity: 0.8 } : null,
      ]}
    >
      <AppText variant="caption" color={c ? c.fg : "muted"} numberOfLines={1}>
        {label}
      </AppText>
      <AppText variant="stat" color={c ? c.fg : "text"} style={styles.tabular}>
        {value.toLocaleString()}
      </AppText>
      <AppText variant="caption" color={c ? c.fg : "muted"} numberOfLines={1}>
        {sub}
      </AppText>
    </Pressable>
  );
}

function EmptyCard({ next }: { next: Empty["next"] }) {
  return (
    <View>
      <SectionHeader eyebrow="Group buy" title={next ? next.name : "No round open yet"} />
      <Panel style={{ gap: SPACE.md }}>
        <Pill tone="neutral" icon="calendar-outline" label={next ? next.opensLabel : "Start a round to begin taking group-buy orders"} />
        <AppText variant="caption" color="muted">
          Once a round is open, this card tracks orders and buyers, who still needs to pay, join requests waiting for your
          approval, and how close each kit is to full.
        </AppText>
        <Button label={next ? "Open Group Buys" : "Start a round"} icon="people-outline" onPress={manage} />
      </Panel>
    </View>
  );
}

function JoinsStrip({ count }: { count: number }) {
  const t = useTheme();
  const c = t.tone("danger");
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${count} join ${count === 1 ? "request is" : "requests are"} waiting for approval. Review`}
      onPress={joins}
      style={({ pressed }) => [styles.joins, { backgroundColor: c.bg, borderColor: c.fg }, pressed ? { opacity: 0.8 } : null]}
    >
      <View style={[styles.joinsCount, { backgroundColor: c.fg }]}>
        <AppText variant="label" color={c.bg} style={{ fontWeight: "700" }}>
          {String(count)}
        </AppText>
      </View>
      <View style={{ flex: 1 }}>
        <AppText variant="bodyStrong" color={c.fg}>
          {`${count === 1 ? "Join request is" : "Join requests are"} waiting`}
        </AppText>
        <AppText variant="caption" color={c.fg}>
          Check the receipts and approve them
        </AppText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={c.fg} />
    </Pressable>
  );
}

function ReadyCard({ card }: { card: Ready }) {
  const live = card.mode === "live";
  const openRound = () => router.push(roundHref(card.round));
  const j = card.joinsWaiting;
  return (
    <View>
      <SectionHeader
        eyebrow={live ? "Live group buy" : "Last round"}
        title={card.round.name}
        action={{ label: live ? "Manage round" : "View report", onPress: openRound }}
      />
      <Panel style={{ gap: SPACE.lg }}>
        <Pill tone={TIMING_TONE[card.timing.tone]} icon="time-outline" label={card.timing.label} />
        {live && j !== null && j > 0 ? <JoinsStrip count={j} /> : null}
        <View style={styles.grid}>
          <Stat label="Orders" value={card.orders} sub={`${card.buyers} ${card.buyers === 1 ? "buyer" : "buyers"}`} />
          <Stat label="Vials ordered" value={card.vials} sub="cancelled excluded" />
          <Stat
            label="Awaiting payment"
            value={card.unpaidOrders}
            sub={card.unpaidOrders === 0 ? "all paid ✓" : (card.unpaidLabel ?? "tap to chase")}
            tone={card.unpaidOrders > 0 ? "warning" : "success"}
            onPress={openRound}
          />
          {j !== null ? (
            <Stat
              label="Join requests"
              value={j}
              sub={j > 0 ? "waiting for you" : "none waiting"}
              tone={j > 0 ? "danger" : "success"}
              onPress={joins}
            />
          ) : null}
        </View>
        {card.kits.length > 0 ? (
          <View style={{ gap: SPACE.md }}>
            <AppText variant="overline" color="muted">
              {(live ? "Kits to fill before close" : "Kit fill at close").toUpperCase()}
            </AppText>
            <MeterList rows={card.kits.map((k) => ({ id: k.id, name: k.name, note: k.note, pct: k.pct, tone: KIT_TONE[k.tone] }))} />
          </View>
        ) : null}
        {card.untrackedProducts > 0 ? (
          <AppText variant="caption" color="muted">
            {`${card.untrackedProducts} ${card.untrackedProducts === 1 ? "product has" : "products have"} no kit size. Set “Vials per kit” on the product to track it here.`}
          </AppText>
        ) : null}
        {card.supplierLabel ? <AppText variant="label">{card.supplierLabel}</AppText> : null}
        {!live ? (
          <View style={{ gap: SPACE.sm }}>
            <AppText variant="caption" color="muted">
              {card.next ? `Next: ${card.next.name} · ${card.next.opensLabel}` : "No round open right now."}
            </AppText>
            <Button label={card.next ? "Open Group Buys" : "Start next round"} icon="people-outline" onPress={manage} />
          </View>
        ) : null}
      </Panel>
    </View>
  );
}

export function GroupBuyCard({ card, error, onRetry }: { card: DashboardGroupBuyResponse | undefined; error: string | null; onRetry: () => void }) {
  if (error) {
    return (
      <View>
        <SectionHeader eyebrow="Group buy" action={{ label: "Group Buys", onPress: manage }} />
        <Panel style={{ gap: SPACE.md }}>
          <AppText variant="caption" color="muted">
            {error}
          </AppText>
          <Button label="Try again" variant="secondary" icon="refresh" onPress={onRetry} />
        </Panel>
      </View>
    );
  }
  if (!card || card.status === "off") return null;
  return card.status === "empty" ? <EmptyCard next={card.next} /> : <ReadyCard card={card} />;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.md },
  stat: { flexGrow: 1, flexBasis: "46%", padding: SPACE.md, gap: 2, borderRadius: RADIUS.lg, borderWidth: 1 },
  tabular: { fontVariant: ["tabular-nums"] },
  joins: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.lg, borderWidth: 1 },
  joinsCount: { minWidth: 32, height: 32, borderRadius: 16, alignItems: "center", justifyContent: "center", paddingHorizontal: 6 },
});
