import { useMemo, useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { success } from "@/features/admin/setup/data";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, SkeletonList } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";
import type { GroupBuy } from "../model";
import { useExpireHolds, usePaidAccessHistory, usePaidAccessSettings, useRoundMembers } from "./hooks";
import {
  BUCKETS,
  bucketCounts,
  expiredHolds,
  flowSummary,
  formatAmount,
  inBucket,
  matchesSearch,
  slotMeter,
  sortForReview,
  type MemberBucket,
} from "./member-view";
import { REFUND_LABEL, STATUS_LABEL, type PaidAccessDecision, type PromptAction, type QueueRow } from "./model";
import { QueueCard } from "./QueueCard";

/**
 * Group buys → Members (website PaidAccessMembers + MemberCard): the people in
 * ONE round — the live one by default — sorted into buckets with "Needs you"
 * first, a slots meter, "Release to the waitlist" for lapsed unpaid holds, and
 * each member's history. How people get in is Join settings; this only manages
 * who is in. Every decision is still decidePaidAccessAction on the server.
 */

const LISTED = new Set(["draft", "scheduled", "active", "closed"]);
const ROUND_STATUS: Record<string, string> = { active: "Live", scheduled: "Scheduled", closed: "Closed", draft: "Draft" };

const settingsRoute = (gb: GroupBuy): Href =>
  `/manage/join-settings?id=${encodeURIComponent(gb.id)}&name=${encodeURIComponent(gb.name)}` as Href;

type Props = {
  rounds: GroupBuy[];
  currency: string;
  busy: boolean;
  onDecide: (decision: PaidAccessDecision, confirm?: { title: string; body: string; label: string }) => void;
  onPrompt: (row: QueueRow, action: PromptAction) => void;
};

export function PaidAccessMembers({ rounds: all, currency, busy, onDecide, onPrompt }: Props) {
  const rounds = all.filter((g) => LISTED.has(g.status));
  const preferred = rounds.find((g) => g.status === "active") ?? rounds.find((g) => g.status === "scheduled") ?? rounds[0];
  const [selectedId, setSelectedId] = useState("");
  const round = rounds.find((g) => g.id === selectedId) ?? preferred;

  if (!round) {
    return (
      <View style={styles.list}>
        <EmptyState icon="people-outline" title="No rounds yet" body="Create a round on the Group buys screen. Its members will show up here." />
      </View>
    );
  }
  return (
    <RoundMembers
      key={round.id}
      round={round}
      rounds={rounds}
      onPickRound={setSelectedId}
      currency={currency}
      busy={busy}
      onDecide={onDecide}
      onPrompt={onPrompt}
    />
  );
}

type RoundProps = Omit<Props, "rounds"> & { round: GroupBuy; rounds: GroupBuy[]; onPickRound: (id: string) => void };

function RoundMembers({ round, rounds, onPickRound, currency, busy, onDecide, onPrompt }: RoundProps) {
  const t = useTheme();
  const members = useRoundMembers(round.id);
  const flow = usePaidAccessSettings(round.id);
  const release = useExpireHolds();
  const [bucket, setBucket] = useState<MemberBucket | null>(null);
  const [query, setQuery] = useState("");

  const rows = members.data?.rows ?? null;
  const counts = useMemo(() => bucketCounts(rows ?? []), [rows]);
  // Land on "Needs you" when something waits, else on everyone.
  const active: MemberBucket = bucket ?? (counts.needs > 0 ? "needs" : "all");
  const visible = useMemo(
    () => sortForReview((rows ?? []).filter((r) => inBucket(r, active) && matchesSearch(r, query))),
    [rows, active, query],
  );
  // "Now" = when the roster was fetched (re-polled every 30s), so render stays pure.
  const expired = expiredHolds(rows ?? [], members.dataUpdatedAt);
  const current = BUCKETS.find((b) => b.key === active) ?? BUCKETS[BUCKETS.length - 1];

  const view = flow.data;
  const settings = view?.exists ? view.settings : null;
  const meter = settings ? slotMeter(view?.slotsTaken ?? 0, settings.capacity.maxSlots) : null;
  const closesAt = settings?.schedule.closesAt ?? round.endsAt;
  const summary = settings ? flowSummary(settings.steps, formatAmount(currency, settings.payment.amountCents)) : "";

  const runRelease = () =>
    release.mutate(round.id, {
      onSuccess: (res) => {
        success();
        Alert.alert(
          res.expired ? "Slots released" : "Nothing to release",
          res.expired
            ? `Released ${res.expired} unpaid slot${res.expired === 1 ? "" : "s"}${res.promoted ? `, moved ${res.promoted} in from the waitlist` : ""}.`
            : "No unpaid slots past their deadline.",
        );
      },
      onError: (e) => Alert.alert("Couldn't release slots", e.message),
    });

  const header = (
    <View style={{ gap: SPACE.lg, marginBottom: SPACE.md }}>
      {rounds.length > 1 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="radiogroup">
          {rounds.map((g) => {
            const on = g.id === round.id;
            return (
              <Pressable
                key={g.id}
                accessibilityRole="radio"
                accessibilityState={{ checked: on }}
                accessibilityLabel={`${g.name}, ${ROUND_STATUS[g.status] ?? g.status}`}
                onPress={() => onPickRound(g.id)}
                style={({ pressed }) => [
                  styles.chip,
                  { borderColor: on ? t.colors.text : t.colors.border, backgroundColor: on ? t.colors.text : t.colors.surface, opacity: pressed ? 0.8 : 1 },
                ]}
              >
                <AppText variant="label" color={on ? t.colors.bg : "text"} numberOfLines={1}>
                  {`${g.name} · ${ROUND_STATUS[g.status] ?? g.status}`}
                </AppText>
              </Pressable>
            );
          })}
        </ScrollView>
      ) : null}

      <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
        <AppText variant="caption" color="muted">
          {`${ROUND_STATUS[round.status] ?? round.status}${
            closesAt ? ` · joining closes ${new Date(closesAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""
          }`}
        </AppText>
        <AppText variant="heading" accessibilityRole="header">
          {round.name}
        </AppText>
        {summary ? (
          <View style={styles.flowRow}>
            <AppText variant="body" color="muted" style={{ flex: 1 }}>
              {summary}
            </AppText>
            <Button label="Change" variant="ghost" onPress={() => router.push(settingsRoute(round))} />
          </View>
        ) : null}
        {meter ? (
          <View style={{ gap: 6 }} accessible accessibilityLabel={`Slots: ${meter.label}`}>
            <View style={styles.flowRow}>
              <AppText variant="label" color="muted" style={{ flex: 1 }}>
                Slots
              </AppText>
              <AppText variant="bodyStrong">{meter.label}</AppText>
            </View>
            {meter.fill !== null ? (
              <View style={[styles.track, { backgroundColor: t.colors.surfaceAlt }]}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round(meter.fill * 100)}%`, backgroundColor: meter.fill >= 1 ? t.tone("warning").fg : t.brand.primary },
                  ]}
                />
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      {view && !view.exists ? (
        <View style={[styles.card, { backgroundColor: t.tone("info").bg, borderColor: t.tone("info").bg }]} accessibilityRole="alert">
          <AppText variant="bodyStrong">Nobody can join this round yet.</AppText>
          <AppText variant="body" color="muted">
            Choose how people get in first: open, pay to join, or approve each one.
          </AppText>
          <Button label="Set up join flow" onPress={() => router.push(settingsRoute(round))} />
        </View>
      ) : null}

      {expired > 0 ? (
        <View style={[styles.card, { backgroundColor: t.tone("warning").bg, borderColor: t.tone("warning").bg }]}>
          <AppText variant="body" color={t.tone("warning").fg}>
            {`${expired} unpaid slot${expired === 1 ? "" : "s"} passed the payment deadline.`}
          </AppText>
          <Button
            label={release.isPending ? "Releasing…" : "Release to the waitlist"}
            variant="secondary"
            loading={release.isPending}
            disabled={release.isPending || busy}
            onPress={runRelease}
          />
        </View>
      ) : null}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
        {BUCKETS.map((b) => {
          const on = active === b.key;
          const n = counts[b.key];
          const urgent = b.key === "needs" && n > 0;
          return (
            <Pressable
              key={b.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              accessibilityLabel={rows === null ? b.label : `${b.label}, ${n}`}
              onPress={() => setBucket(b.key)}
              style={({ pressed }) => [
                styles.chip,
                {
                  borderColor: on ? t.brand.primary : urgent ? t.tone("warning").fg : t.colors.border,
                  backgroundColor: on ? t.brand.primary : t.colors.surface,
                  opacity: pressed ? 0.85 : 1,
                },
              ]}
            >
              <AppText variant="label" color={on ? "onPrimary" : "text"}>
                {rows === null ? b.label : `${b.label} · ${n}`}
              </AppText>
            </Pressable>
          );
        })}
      </ScrollView>
      <Field label="Search members" value={query} onChangeText={setQuery} placeholder="Name or email" autoCorrect={false} autoCapitalize="none" />
      {members.dataUpdatedAt ? (
        <AppText variant="caption" color="faint">
          {`Updated ${new Date(members.dataUpdatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} · refreshes every 30 seconds`}
        </AppText>
      ) : null}
      {members.isPending ? <SkeletonList rows={3} /> : null}
      {members.isError ? <ErrorState message={members.error.message} onRetry={() => void members.refetch()} /> : null}
    </View>
  );

  const footer =
    rows !== null && members.data && members.data.counts.total > rows.length ? (
      <AppText variant="caption" color="muted" style={{ marginTop: SPACE.md }}>
        {`Showing the latest ${rows.length} of ${members.data.counts.total} members.`}
      </AppText>
    ) : null;

  return (
    <FlatList
      data={members.isError ? [] : visible}
      keyExtractor={(r) => r.id}
      contentContainerStyle={styles.list}
      keyboardShouldPersistTaps="handled"
      ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
      refreshControl={
        <RefreshControl
          refreshing={members.isRefetching && !members.isPending}
          onRefresh={() => {
            void members.refetch();
            void flow.refetch();
          }}
          tintColor={t.brand.link}
        />
      }
      ListHeaderComponent={header}
      ListFooterComponent={footer}
      ListEmptyComponent={
        rows === null || members.isError ? null : (
          <View style={{ gap: SPACE.sm }}>
            <EmptyState
              icon={active === "needs" && !query ? "checkmark-done-outline" : "people-outline"}
              title={query ? `No one matches “${query.trim()}”` : current.empty}
            />
            {active === "needs" && !query && counts.all > 0 ? (
              <Button label={`See everyone (${counts.all})`} variant="ghost" onPress={() => setBucket("all")} />
            ) : null}
          </View>
        )
      }
      renderItem={({ item }) => (
        <View style={{ gap: SPACE.xs }}>
          <QueueCard row={item} roundName="" busy={busy} onDecide={onDecide} onPrompt={(action) => onPrompt(item, action)} />
          <MemberHistory membershipId={item.id} />
        </View>
      )}
    />
  );
}

const when = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

/** The member's audit log (getPaidAccessHistoryAction), loaded on first open. */
function MemberHistory({ membershipId }: { membershipId: string }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const history = usePaidAccessHistory(membershipId, open);
  const events = history.data?.events;

  return (
    <View style={{ paddingHorizontal: SPACE.sm }}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="History"
        onPress={() => setOpen((v) => !v)}
        hitSlop={6}
        style={styles.historyToggle}
      >
        <Ionicons name={open ? "chevron-down" : "chevron-forward"} size={14} color={t.colors.textMuted} />
        <AppText variant="label" color="muted">
          History
        </AppText>
      </Pressable>
      {open ? (
        history.isError ? (
          <AppText variant="caption" color="muted">
            {`Couldn't load the history. ${history.error.message}`}
          </AppText>
        ) : !events ? (
          <AppText variant="caption" color="muted">
            Loading…
          </AppText>
        ) : events.length === 0 ? (
          <AppText variant="caption" color="muted">
            Nothing recorded yet.
          </AppText>
        ) : (
          <View style={{ gap: 4 }}>
            {events.map((e, i) => {
              const what = e.toStatus ? (STATUS_LABEL[e.toStatus] ?? REFUND_LABEL[e.toStatus] ?? e.toStatus) : e.kind;
              const who = e.actorKind === "customer" ? "member" : e.actorKind;
              const actor = e.actorId && e.actorKind !== "customer" ? ` (${e.actorId})` : "";
              return (
                <AppText key={`${e.createdAt}-${i}`} variant="caption" color="muted" selectable>
                  <AppText variant="caption" style={{ fontWeight: "700" }}>
                    {what}
                  </AppText>
                  {` · ${who}${actor} · ${when(e.createdAt)}${e.reason ? ` · ${e.reason}` : ""}`}
                </AppText>
              );
            })}
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  chips: { gap: SPACE.sm, paddingRight: SPACE.lg },
  chip: { minHeight: 40, maxWidth: 280, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1, gap: SPACE.sm },
  flowRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  track: { height: 8, borderRadius: RADIUS.pill, overflow: "hidden" },
  fill: { height: "100%", borderRadius: RADIUS.pill },
  historyToggle: { flexDirection: "row", alignItems: "center", gap: 4, minHeight: 32 },
});
