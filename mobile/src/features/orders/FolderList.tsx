import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { OrderPaymentFilter, OrderStatus } from "@contract";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { AppText, Card, Divider, Row, SectionLabel } from "@/ui/primitives";
import {
  FOLDER_STATUS_LABEL,
  OUTSIDE_FOLDER,
  closesIn,
  dateRange,
  plural,
  roundFolder,
  roundMeta,
  type FolderKey,
  type OrderFolder,
  type OrderFoldersResult,
} from "./folders";

/**
 * The web Orders hub's folder list for a group-buy store: the live round on a
 * card with its to-do shortcuts, then upcoming, recent and (folded) archived
 * rounds, then "Outside a group buy", "All orders" and the member tracker.
 */

export type FolderPreset = { status: OrderStatus | "all"; payment: OrderPaymentFilter };

type Money = (n: number) => string;

type Props = {
  data: OrderFoldersResult;
  money: Money;
  refreshing: boolean;
  onRefresh: () => void;
  onOpen: (key: FolderKey, preset?: FolderPreset) => void;
};

function Stat({ label, value, tone }: { label: string; value: string; tone?: "good" | "warn" }) {
  const t = useTheme();
  const color = tone === "good" ? t.tone("success").fg : tone === "warn" ? t.tone("warning").fg : "text";
  return (
    <View style={styles.stat}>
      <AppText variant="caption" color="muted">{label}</AppText>
      <AppText variant="bodyStrong" color={color} style={styles.tabular}>{value}</AppText>
    </View>
  );
}

export function FolderStats({ f, money, outstanding }: { f: OrderFolder; money: Money; outstanding?: boolean }) {
  return (
    <View style={styles.stats}>
      <Stat label="Orders" value={f.totalOrders.toLocaleString()} />
      <Stat label="Members" value={f.participants.toLocaleString()} />
      <Stat label="Gross" value={money(f.grossIncome)} />
      <Stat label="Collected" value={money(f.collected)} tone="good" />
      {outstanding ? <Stat label="Outstanding" value={money(f.outstanding)} tone={f.outstanding > 0 ? "warn" : undefined} /> : null}
    </View>
  );
}

function TodoBadges({ f }: { f: OrderFolder }) {
  const t = useTheme();
  if (!f.newOrders && !f.unpaidOrders) {
    return <AppText variant="caption" color={t.tone("success").fg}>All caught up</AppText>;
  }
  return (
    <View style={styles.badges}>
      {f.newOrders > 0 ? <AppText variant="caption" color={t.tone("info").fg}>{`${f.newOrders} new`}</AppText> : null}
      {f.unpaidOrders > 0 ? <AppText variant="caption" color={t.tone("warning").fg}>{`${f.unpaidOrders} unpaid`}</AppText> : null}
    </View>
  );
}

function LiveCard({ f, money, now, onOpen }: { f: OrderFolder; money: Money; now: number; onOpen: (preset?: FolderPreset) => void }) {
  const t = useTheme();
  const left = closesIn(f.endsAt, now);
  const pct = f.maxVials ? Math.min(100, Math.round((f.vials / f.maxVials) * 100)) : null;
  const live = t.tone("success");
  return (
    <View style={{ gap: SPACE.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${f.name}, live now. ${plural(f.totalOrders, "order")}. Opens its orders`}
        onPress={() => onOpen()}
        style={({ pressed }) => [
          styles.live,
          { backgroundColor: pressed ? t.colors.surfaceAlt : t.colors.surface, borderColor: live.fg },
        ]}
      >
        <View style={styles.liveTop}>
          <View style={[styles.liveBadge, { backgroundColor: live.bg }]}>
            <View style={[styles.dot, { backgroundColor: live.fg }]} />
            <AppText variant="caption" color={live.fg} style={{ fontWeight: "600" }}>Live now</AppText>
          </View>
          {left ? <AppText variant="caption" color="muted">{left}</AppText> : null}
        </View>
        <AppText variant="title" brandFont>{f.name}</AppText>
        {roundMeta(f) ? <AppText variant="caption" color="muted">{roundMeta(f)}</AppText> : null}
        {pct !== null ? (
          <View accessible accessibilityLabel={`${f.vials} of ${f.maxVials} vials`} style={{ gap: 4 }}>
            <View style={[styles.track, { backgroundColor: t.colors.surfaceAlt }]}>
              <View style={[styles.fill, { backgroundColor: live.fg, width: `${pct}%` }]} />
            </View>
            <AppText variant="caption" color="muted">{`${f.vials}/${f.maxVials} vials`}</AppText>
          </View>
        ) : null}
        <FolderStats f={f} money={money} />
        <View style={styles.liveFoot}>
          <TodoBadges f={f} />
          <AppText variant="label" color="link">Open orders →</AppText>
        </View>
      </Pressable>
      {/* One tap to what needs doing — beside the card, never inside it (the card is itself a button). */}
      {f.newOrders > 0 || f.unpaidOrders > 0 ? (
        <View style={styles.todo} accessibilityRole="toolbar" accessibilityLabel={`Shortcuts for ${f.name}`}>
          {f.newOrders > 0 ? (
            <Shortcut label={`Review ${plural(f.newOrders, "new order")} →`} tone="info" onPress={() => onOpen({ status: "new", payment: "all" })} />
          ) : null}
          {f.unpaidOrders > 0 ? (
            <Shortcut label={`Confirm ${plural(f.unpaidOrders, "payment")} →`} tone="warning" onPress={() => onOpen({ status: "all", payment: "unpaid" })} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

function Shortcut({ label, tone, onPress }: { label: string; tone: "info" | "warning"; onPress: () => void }) {
  const t = useTheme();
  const c = t.tone(tone);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label.replace(" →", "")}
      onPress={onPress}
      style={({ pressed }) => [styles.shortcut, { backgroundColor: c.bg, opacity: pressed ? 0.75 : 1 }]}
    >
      <AppText variant="label" color={c.fg} style={{ fontWeight: "600" }}>{label}</AppText>
    </Pressable>
  );
}

function FolderRow({ f, money, onOpen }: { f: OrderFolder; money: Money; onOpen: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${f.name}, ${FOLDER_STATUS_LABEL[f.status]}, ${plural(f.totalOrders, "order")}, ${money(f.grossIncome)}`}
      onPress={onOpen}
      style={({ pressed }) => [styles.row, pressed ? { backgroundColor: t.colors.surfaceAlt } : null]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <View style={styles.rowName}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{f.name}</AppText>
          <AppText variant="caption" color="muted">{FOLDER_STATUS_LABEL[f.status]}</AppText>
        </View>
        <AppText variant="caption" color="muted" numberOfLines={2}>
          {`${dateRange(f)} · ${plural(f.totalOrders, "order")} · ${plural(f.participants, "member")}`}
        </AppText>
      </View>
      <View style={{ alignItems: "flex-end", gap: 2 }}>
        <AppText variant="bodyStrong" style={styles.tabular}>{money(f.grossIncome)}</AppText>
        <TodoBadges f={f} />
      </View>
      <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
    </Pressable>
  );
}

function Section({ title, folders, money, onOpen }: { title: string; folders: OrderFolder[]; money: Money; onOpen: (f: OrderFolder) => void }) {
  if (folders.length === 0) return null;
  return (
    <View>
      <SectionLabel>{title}</SectionLabel>
      <Card padded={false}>
        {folders.map((f, i) => (
          <View key={f.id}>
            {i > 0 ? <Divider inset={SPACE.lg} /> : null}
            <FolderRow f={f} money={money} onOpen={() => onOpen(f)} />
          </View>
        ))}
      </Card>
    </View>
  );
}

export function FolderList({ data, money, refreshing, onRefresh, onOpen }: Props) {
  const t = useTheme();
  const [showArchived, setShowArchived] = useState(false);
  // Read once per visit — the countdown is a hint, not a ticking clock.
  const [now] = useState(() => Date.now());
  const { live, upcoming, recent, archived } = data.folders;
  const open = (f: OrderFolder) => onOpen(roundFolder(f.id));

  return (
    <ScrollView
      contentContainerStyle={styles.page}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={t.brand.link} />}
    >
      <AppText variant="body" color="muted">Orders are filed by group buy. Pick one to see its orders and its reports.</AppText>
      {live.length > 0 ? (
        live.map((f) => <LiveCard key={f.id} f={f} money={money} now={now} onOpen={(preset) => onOpen(roundFolder(f.id), preset)} />)
      ) : (
        <Card>
          <AppText variant="body" color="muted">No group buy is open right now. Past rounds are below.</AppText>
        </Card>
      )}
      <Section title="Upcoming" folders={upcoming} money={money} onOpen={open} />
      <Section title="Recent group buys" folders={recent} money={money} onOpen={open} />
      {archived.length > 0 ? (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: showArchived }}
            onPress={() => setShowArchived((v) => !v)}
            hitSlop={8}
            style={styles.archivedToggle}
          >
            <AppText variant="label" color="link">{`${showArchived ? "Hide" : "Show"} archived (${archived.length})`}</AppText>
          </Pressable>
          {showArchived ? <Section title="Archived" folders={archived} money={money} onOpen={open} /> : null}
        </>
      ) : null}
      <View>
        <SectionLabel>Other orders</SectionLabel>
        <Card padded={false}>
          <Row icon="cube-outline" label="Outside a group buy" detail="On-hand orders and anything placed between rounds" onPress={() => onOpen(OUTSIDE_FOLDER)} />
          <Divider inset={62} />
          <Row icon="receipt-outline" label="All orders" detail="Every order in one list" onPress={() => onOpen("all")} />
          <Divider inset={62} />
          <Row
            icon="people-outline"
            label="Member tracker"
            detail="How many group buys each member joined"
            onPress={() => router.push("/manage/member-tracker")}
          />
        </Card>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, gap: SPACE.lg },
  tabular: { fontVariant: ["tabular-nums"] },
  live: { borderRadius: RADIUS.lg, borderWidth: 1.5, padding: SPACE.lg, gap: SPACE.sm },
  liveTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  liveBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: SPACE.sm, paddingVertical: 3, borderRadius: RADIUS.pill },
  dot: { width: 7, height: 7, borderRadius: 4 },
  track: { height: 6, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
  stats: { flexDirection: "row", flexWrap: "wrap", rowGap: SPACE.sm, marginTop: SPACE.xs },
  stat: { minWidth: "25%", paddingRight: SPACE.md },
  liveFoot: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: SPACE.xs },
  badges: { flexDirection: "row", gap: SPACE.sm },
  todo: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  shortcut: { paddingHorizontal: SPACE.md, paddingVertical: SPACE.sm, borderRadius: RADIUS.pill, minHeight: 36, justifyContent: "center" },
  row: { flexDirection: "row", alignItems: "center", gap: SPACE.md, padding: SPACE.lg },
  rowName: { flexDirection: "row", alignItems: "baseline", gap: SPACE.sm },
  archivedToggle: { alignSelf: "flex-start", paddingVertical: SPACE.xs },
});
