import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { Stack } from "expo-router";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { useAdminBrand } from "@/features/admin/setup/data";
import { ChoicePills } from "@/features/admin/setup/ui";
import { shareTrackerCsv } from "@/features/admin/group-buys/export";
import { useGroupBuyParticipation } from "@/features/admin/group-buys/hooks";
import { moneyOf } from "@/features/admin/group-buys/model";
import { TileGrid } from "@/features/admin/group-buys/parts";
import {
  buildParticipation,
  monthOptions,
  participationCsv,
  participationCsvName,
  participationSummary,
  participationWindow,
  trackerDate,
  type ParticipantRow,
  type ParticipationPeriod,
} from "@/features/admin/group-buys/participation";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * Member tracker (website GbMemberTracker, Orders → Group buys → Member
 * tracker): how many group buys each member joined in a period. One fetch
 * (getGroupBuyParticipationAction); the period, search and "joined at least"
 * filters are local, counting rules are participation.ts.
 */

type PresetKey = "this" | "last" | "3m" | "6m" | "all" | "month";

const PRESETS: readonly { key: Exclude<PresetKey, "month">; label: string }[] = [
  { key: "this", label: "This month" },
  { key: "last", label: "Last month" },
  { key: "3m", label: "Last 3 months" },
  { key: "6m", label: "Last 6 months" },
  { key: "all", label: "All time" },
];

const MIN_JOINED = [1, 2, 3, 5] as const;

function periodFor(key: PresetKey, month: string, months: readonly { value: string }[]): ParticipationPeriod {
  if (key === "this") return { kind: "month", month: months[0]?.value ?? month };
  if (key === "last") return { kind: "month", month: months[1]?.value ?? months[0]?.value ?? month };
  if (key === "3m") return { kind: "last", months: 3 };
  if (key === "6m") return { kind: "last", months: 6 };
  if (key === "month") return { kind: "month", month };
  return { kind: "all" };
}

export default function MemberTrackerScreen() {
  const t = useTheme();
  const brand = useAdminBrand();
  const query = useGroupBuyParticipation();
  const currency = typeof brand.data?.currency === "string" && brand.data.currency ? brand.data.currency : "₱";
  const money = moneyOf(currency);

  const [preset, setPreset] = useState<PresetKey>("3m");
  const [month, setMonth] = useState("");
  const [minJoined, setMinJoined] = useState<number>(1);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState(false);

  const data = query.data;
  const orders = useMemo(() => (data ? (data.enabled ? data.orders : []) : null), [data]);
  const now = useMemo(() => new Date(), []);
  const months = useMemo(() => monthOptions(orders ?? [], now), [orders, now]);
  const period = periodFor(preset, month || months[0]?.value || "", months);
  const periodLabel =
    preset === "month"
      ? (months.find((m) => m.value === month)?.label ?? "Month")
      : preset === "this"
        ? (months[0]?.label ?? "This month")
        : preset === "last"
          ? (months[1]?.label ?? "Last month")
          : (PRESETS.find((p) => p.key === preset)?.label ?? "");

  const rows = useMemo(
    () => (orders ? buildParticipation(orders, participationWindow(period, now)) : []),
    // `period` is rebuilt every render; preset + month + months are what it depends on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orders, preset, month, months, now],
  );
  const summary = participationSummary(rows);
  const q = search.trim().toLowerCase();
  const shown = rows.filter(
    (r) =>
      r.groupBuys >= minJoined &&
      (!q || [r.name, r.email, r.contact, r.whatsapp, r.whatsappName].some((v) => v.toLowerCase().includes(q))),
  );

  const exportCsv = async () => {
    setExporting(true);
    try {
      await shareTrackerCsv(participationCsvName(periodLabel), participationCsv(shown));
    } catch (e) {
      Alert.alert("Couldn't export the members", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <View style={{ gap: SPACE.lg, marginBottom: SPACE.md }}>
      <AppText variant="body" color="muted">
        How many group buys each member joined. A member is matched by account, email or phone, so top-ups and repeat orders count once
        per group buy.
      </AppText>
      <ChoicePills<Exclude<PresetKey, "month">>
        label="Period"
        options={PRESETS}
        value={preset === "month" ? "" : preset}
        onChange={setPreset}
      />
      {months.length > 0 ? (
        <View style={{ gap: 6 }}>
          <AppText variant="label" color="muted">
            Or pick a month
          </AppText>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {months.map((m) => {
              const on = preset === "month" && month === m.value;
              return (
                <Pressable
                  key={m.value}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={m.label}
                  onPress={() => {
                    setMonth(m.value);
                    setPreset("month");
                  }}
                  style={({ pressed }) => [
                    styles.chip,
                    { borderColor: on ? t.colors.text : t.colors.border, backgroundColor: on ? t.colors.text : t.colors.surface, opacity: pressed ? 0.8 : 1 },
                  ]}
                >
                  <AppText variant="label" color={on ? t.colors.bg : "text"}>
                    {m.label}
                  </AppText>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      ) : null}

      {query.isError ? (
        <ErrorState message={query.error?.message ?? "Couldn't load the member tracker."} onRetry={() => void query.refetch()} />
      ) : !orders ? (
        <SkeletonList rows={4} />
      ) : (
        <>
          <TileGrid
            tiles={[
              { label: "Members who joined", value: summary.members, hint: periodLabel },
              { label: "Joined 2+ group buys", value: summary.repeat },
              { label: "Total joins", value: summary.joins },
            ]}
          />
          <Field
            label="Search members"
            value={search}
            onChangeText={setSearch}
            placeholder="Name, email, phone or WhatsApp"
            autoCorrect={false}
            autoCapitalize="none"
          />
          <ChoicePills
            label="Joined at least"
            options={MIN_JOINED.map((n) => ({ key: String(n), label: `${n} GB${n > 1 ? "s" : ""}` }))}
            value={String(minJoined)}
            onChange={(k) => setMinJoined(Number(k))}
          />
          <Button
            label={`Export CSV (${shown.length})`}
            variant="secondary"
            icon="share-outline"
            loading={exporting}
            disabled={exporting || shown.length === 0}
            onPress={() => void exportCsv()}
          />
        </>
      )}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Stack.Screen options={{ title: "Member tracker" }} />
      <OfflineBanner />
      <FlatList
        data={orders ? shown : []}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: SPACE.sm }} />}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={t.brand.link} />}
        ListHeaderComponent={header}
        ListEmptyComponent={
          orders ? (
            <EmptyState
              icon="people-outline"
              title={
                query.data && !query.data.enabled
                  ? "Group buys aren't on for this store."
                  : rows.length === 0
                    ? `No one joined a group buy in ${periodLabel.toLowerCase()}.`
                    : "No member matches these filters."
              }
            />
          ) : null
        }
        renderItem={({ item }) => <MemberRow row={item} money={money} />}
      />
    </View>
  );
}

function MemberRow({ row: r, money }: { row: ParticipantRow; money: (n: number) => string }) {
  const t = useTheme();
  const wa = r.whatsappName ? `WA: ${r.whatsappName}${r.whatsapp ? ` · ${r.whatsapp}` : ""}` : "";
  const meta = [r.contact, wa].filter(Boolean).join(" · ");
  return (
    <View
      accessible
      accessibilityLabel={`${r.name}, ${r.groupBuys} group buys joined, ${money(r.spent)} spent`}
      style={[styles.row, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}
    >
      <View style={[styles.count, { backgroundColor: t.colors.surfaceAlt }]}>
        <AppText variant="heading" style={{ fontVariant: ["tabular-nums"] }}>
          {String(r.groupBuys)}
        </AppText>
        <AppText variant="caption" color="muted">
          {r.groupBuys === 1 ? "GB" : "GBs"}
        </AppText>
      </View>
      <View style={{ flex: 1, gap: 2, minWidth: 0 }}>
        <View style={styles.top}>
          <AppText variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
            {r.name}
          </AppText>
          <AppText variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
            {money(r.spent)}
          </AppText>
        </View>
        {meta ? (
          <AppText variant="caption" color="muted" numberOfLines={1} selectable>
            {meta}
          </AppText>
        ) : null}
        <AppText variant="caption" color="muted">
          {`${r.checkouts} checkout${r.checkouts === 1 ? "" : "s"} · last ${trackerDate(r.lastJoinedAt)}`}
        </AppText>
        <View style={styles.rounds}>
          {r.rounds.map((name, i) => (
            <View key={`${name}-${i}`} style={[styles.round, { borderColor: t.colors.border }]}>
              <AppText variant="caption">{name}</AppText>
            </View>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  chips: { gap: SPACE.sm, paddingRight: SPACE.lg },
  chip: { minHeight: 40, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  row: { flexDirection: "row", gap: SPACE.md, padding: SPACE.md, borderRadius: RADIUS.md, borderWidth: StyleSheet.hairlineWidth },
  count: { width: 52, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", paddingVertical: SPACE.sm },
  top: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  rounds: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 4 },
  round: { borderWidth: 1, borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 2 },
});
