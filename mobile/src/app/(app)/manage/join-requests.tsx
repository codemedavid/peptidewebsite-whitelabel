import { useState } from "react";
import { Alert, FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { router, Stack, type Href } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { success } from "@/features/admin/setup/data";
import { useGroupBuyList } from "@/features/admin/group-buys/hooks";
import type { GroupBuy } from "@/features/admin/group-buys/model";
import { usePaidAccessDecide, usePaidAccessQueue } from "@/features/admin/group-buys/paid-access/hooks";
import type { PaidAccessDecision, QueueCounts, QueueTab } from "@/features/admin/group-buys/paid-access/model";
import { QueueCard } from "@/features/admin/group-buys/paid-access/QueueCard";
import { ReasonSheet, type Prompt } from "@/features/admin/group-buys/paid-access/ReasonSheet";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { AppText } from "@/ui/primitives";

/**
 * Paid Access join queue (src/modules/paid-access): proofs of payment to check,
 * approvals, refunds owed and the waitlist — across every round — plus each
 * round's "Join settings". Reached from Group buys and from the
 * `gb_join_request` push. Every decision is decidePaidAccessAction on the server.
 */

const TABS: { key: QueueTab; label: string; count: keyof QueueCounts }[] = [
  { key: "payments", label: "Payments to check", count: "payments" },
  { key: "approvals", label: "Approvals", count: "approvals" },
  { key: "refunds", label: "Refunds", count: "refunds" },
  { key: "waitlist", label: "Waitlist", count: "waitlist" },
  { key: "all", label: "Everyone", count: "total" },
];

const EMPTY: Record<QueueTab, { title: string; body: string }> = {
  payments: { title: "No payments to check", body: "Proofs of payment show up here, and you get a push when one arrives." },
  approvals: { title: "No one waiting for approval", body: "Members who reach the approval step show up here." },
  refunds: { title: "No refunds owed", body: "Rejected members who paid show up here until you mark them refunded." },
  waitlist: { title: "The waitlist is empty", body: "When a round is full, new joiners wait here for a slot." },
  all: { title: "No one has joined yet", body: "Members of every join-gated round show up here." },
};

/** Rounds whose join settings still matter. */
const EDITABLE_ROUND = new Set(["draft", "scheduled", "active"]);

const settingsRoute = (gb: GroupBuy): Href =>
  `/manage/join-settings?id=${encodeURIComponent(gb.id)}&name=${encodeURIComponent(gb.name)}` as Href;

export default function JoinQueueScreen() {
  const t = useTheme();
  const online = useOnline();
  const [tab, setTab] = useState<QueueTab>("payments");
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const queue = usePaidAccessQueue(tab);
  const rounds = useGroupBuyList();
  const decide = usePaidAccessDecide();
  const roundName = (id: string) => rounds.data?.groupBuys.find((g) => g.id === id)?.name ?? "";

  const run = (decision: PaidAccessDecision) =>
    decide.mutate(decision, {
      onSuccess: () => {
        success();
        setPrompt(null);
      },
      onError: (e) => Alert.alert("Couldn't save", e.message),
    });

  const confirmThen = (decision: PaidAccessDecision, confirm?: { title: string; body: string; label: string }) => {
    if (!confirm) return run(decision);
    Alert.alert(confirm.title, confirm.body, [
      { text: "Cancel", style: "cancel" },
      { text: confirm.label, onPress: () => run(decision) },
    ]);
  };

  const fromPrompt = (p: Prompt, text: string) => {
    if (p.action === "refund") return run({ action: "refund", membershipId: p.row.id, reference: text });
    if (p.action === "reject_payment") {
      if (!p.row.payment) return;
      return run({ action: "reject_payment", paymentId: p.row.payment.id, reason: text });
    }
    return run({ action: p.action, membershipId: p.row.id, reason: text });
  };

  const counts = queue.data?.counts;
  const editable = (rounds.data?.groupBuys ?? []).filter((g) => EDITABLE_ROUND.has(g.status));

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Stack.Screen options={{ title: "Join requests" }} />
      <OfflineBanner />
      <FlatList
        data={queue.data && !queue.isError ? queue.data.rows : []}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
        refreshControl={
          <RefreshControl
            refreshing={queue.isRefetching}
            onRefresh={() => {
              void queue.refetch();
              void rounds.refetch();
            }}
            tintColor={t.brand.link}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: SPACE.lg, marginBottom: SPACE.md }}>
            <JoinSettingsList rounds={editable} />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
              {TABS.map((f) => {
                const on = tab === f.key;
                const n = counts ? counts[f.count] : null;
                return (
                  <Pressable
                    key={f.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    accessibilityLabel={n === null ? f.label : `${f.label}, ${n}`}
                    onPress={() => setTab(f.key)}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: on ? t.brand.primary : t.colors.border, backgroundColor: on ? t.brand.primary : t.colors.surface, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <AppText variant="label" color={on ? "onPrimary" : "text"}>
                      {n === null || n === 0 ? f.label : `${f.label} · ${n}`}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            {queue.isPending ? <SkeletonList rows={3} /> : null}
            {queue.isError ? <ErrorState message={queue.error.message} onRetry={() => void queue.refetch()} /> : null}
          </View>
        }
        ListEmptyComponent={
          queue.isPending || queue.isError ? null : <EmptyState icon="checkmark-done-outline" title={EMPTY[tab].title} body={EMPTY[tab].body} />
        }
        renderItem={({ item }) => (
          <QueueCard
            row={item}
            roundName={roundName(item.groupBuyId)}
            busy={decide.isPending || !online}
            onDecide={confirmThen}
            onPrompt={(action) => setPrompt({ row: item, action })}
          />
        )}
      />
      <ReasonSheet
        prompt={prompt}
        roundName={prompt ? roundName(prompt.row.groupBuyId) : ""}
        busy={decide.isPending}
        onCancel={() => setPrompt(null)}
        onConfirm={(text) => prompt && fromPrompt(prompt, text)}
      />
    </View>
  );
}

/** One row per live/upcoming round → its Join settings editor. */
function JoinSettingsList({ rounds }: { rounds: GroupBuy[] }) {
  const t = useTheme();
  if (rounds.length === 0) return null;
  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={{ gap: 2 }}>
        <AppText variant="heading">Join settings</AppText>
        <AppText variant="caption" color="muted">
          How customers get into each round: pay, apply, get approved — or open to everyone.
        </AppText>
      </View>
      {rounds.map((r) => (
        <Pressable
          key={r.id}
          accessibilityRole="button"
          accessibilityLabel={`Join settings for ${r.name}`}
          onPress={() => router.push(settingsRoute(r))}
          style={({ pressed }) => [styles.roundRow, { borderTopColor: t.colors.border, opacity: pressed ? 0.7 : 1 }]}
        >
          <View style={{ flex: 1, gap: 2 }}>
            <AppText variant="bodyStrong" numberOfLines={1}>
              {r.name}
            </AppText>
            <AppText variant="caption" color="muted">
              {r.status === "active" ? "Live" : r.status === "scheduled" ? "Scheduled" : "Draft"}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.colors.textMuted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  chips: { gap: SPACE.sm, paddingRight: SPACE.lg },
  chip: { minHeight: 40, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1, gap: SPACE.md },
  roundRow: { flexDirection: "row", alignItems: "center", gap: SPACE.md, paddingTop: SPACE.md, minHeight: 48, borderTopWidth: StyleSheet.hairlineWidth },
});
