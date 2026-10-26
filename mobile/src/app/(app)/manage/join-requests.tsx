import { useState } from "react";
import { Alert, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Stack } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { success } from "@/features/admin/setup/data";
import {
  JOIN_STATUS_LABEL,
  receiptUrl,
  useJoinRequests,
  usePaidJoinRounds,
  useReviewJoinRequest,
  useSavePaidJoin,
  type JoinRequest,
  type JoinStatus,
  type PaidJoinRound,
  type ReviewAction,
} from "@/features/admin/group-buys/join-requests";
import { useTheme } from "@/theme/ThemeProvider";
import { RADIUS, SPACE, TOUCH } from "@/theme/tokens";
import { EmptyState, ErrorState, OfflineBanner, SkeletonList, useOnline } from "@/ui/feedback";
import { Field } from "@/ui/inputs";
import { AppText, Button } from "@/ui/primitives";

/**
 * Paid group-buy join requests (actions/gb-review.ts): each round's paid-join
 * switch and fee, then the queue — open the receipt, approve, reject with a
 * reason, mark refunded with the refund reference, or remove access. Reached
 * from Group buys and from the "paid to join" push.
 */

type Filter = JoinStatus | "all";
type Decision = Exclude<ReviewAction, "approve">;

const FILTERS: { key: Filter; label: string }[] = [
  { key: "paid_pending_approval", label: "Waiting" },
  { key: "pending_payment", label: "Not paid" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Refund owed" },
  { key: "refunded", label: "Refunded" },
  { key: "revoked", label: "Removed" },
  { key: "all", label: "All" },
];
const TONE: Record<string, "neutral" | "warning" | "success" | "danger"> = {
  paid_pending_approval: "warning",
  approved: "success",
  rejected: "danger",
  revoked: "danger",
};
const OPEN_ROUND = new Set(["draft", "scheduled", "active", "closed"]);

const PROMPT_COPY: Record<Decision, { title: string; label: string; placeholder: string; confirm: string }> = {
  reject: { title: "Reject this payment", label: "Reason (the customer sees this)", placeholder: "e.g. The amount on the receipt is short", confirm: "Reject · refund owed" },
  refund: { title: "Mark refunded", label: "Refund reference number", placeholder: "e.g. the GCash reference of your refund", confirm: "Mark refunded" },
  revoke: { title: "Remove access", label: "Reason (the customer sees this)", placeholder: "e.g. Shared the group-buy prices", confirm: "Remove access" },
};

const pesos = (cents: number) => `₱${(cents / 100).toLocaleString(undefined, { minimumFractionDigits: cents % 100 ? 2 : 0 })}`;
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : "—");

export default function JoinRequestsScreen() {
  const t = useTheme();
  const online = useOnline();
  const [filter, setFilter] = useState<Filter>("paid_pending_approval");
  const [prompt, setPrompt] = useState<{ row: JoinRequest; action: Decision } | null>(null);
  const list = useJoinRequests(filter);
  const review = useReviewJoinRequest();

  const decide = (row: JoinRequest, action: ReviewAction, text = "") =>
    review.mutate(
      { id: row.id, action, ...(action === "refund" ? { refundReference: text } : { reason: text }) },
      {
        onSuccess: () => {
          success();
          setPrompt(null);
        },
        onError: (e) => Alert.alert("Couldn't save", e.message),
      },
    );

  const approve = (row: JoinRequest) =>
    Alert.alert(`Approve ${row.customerName}?`, `They'll be let into ${row.roundName} and told right away.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Approve", onPress: () => decide(row, "approve") },
    ]);

  const counts = list.data?.counts;
  const rows = list.data?.requests ?? [];
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
      <Stack.Screen options={{ title: "Join requests" }} />
      <OfflineBanner />
      <FlatList
        data={list.isPending || list.isError ? [] : rows}
        keyExtractor={(r) => r.id}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: SPACE.md }} />}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} tintColor={t.brand.link} />}
        ListHeaderComponent={
          <View style={{ gap: SPACE.lg, marginBottom: SPACE.md }}>
            <PaidJoinSettings />
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} accessibilityRole="tablist">
              {FILTERS.map((f) => {
                const on = filter === f.key;
                const n = f.key === "all" ? total : (counts?.[f.key] ?? null);
                return (
                  <Pressable
                    key={f.key}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: on }}
                    onPress={() => setFilter(f.key)}
                    style={({ pressed }) => [
                      styles.chip,
                      { borderColor: on ? t.brand.primary : t.colors.border, backgroundColor: on ? t.brand.primary : t.colors.surface, opacity: pressed ? 0.85 : 1 },
                    ]}
                  >
                    <AppText variant="label" color={on ? "onPrimary" : "text"}>
                      {n === null ? f.label : `${f.label} · ${n}`}
                    </AppText>
                  </Pressable>
                );
              })}
            </ScrollView>
            {list.isPending ? <SkeletonList rows={3} /> : null}
            {list.isError ? <ErrorState message={list.error.message} onRetry={() => void list.refetch()} /> : null}
          </View>
        }
        ListEmptyComponent={
          list.isPending || list.isError ? null : (
            <EmptyState
              icon="checkmark-done-outline"
              title={filter === "paid_pending_approval" ? "You're all caught up" : "Nothing here"}
              body={filter === "paid_pending_approval" ? "New paid join requests show up here, and you get a push when one arrives." : "No join requests with this status."}
            />
          )
        }
        renderItem={({ item }) => (
          <RequestCard row={item} busy={review.isPending || !online} onApprove={() => approve(item)} onPrompt={(action) => setPrompt({ row: item, action })} />
        )}
      />
      <PromptSheet prompt={prompt} busy={review.isPending} onCancel={() => setPrompt(null)} onConfirm={(text) => prompt && decide(prompt.row, prompt.action, text)} />
    </View>
  );
}

function RequestCard({ row, busy, onApprove, onPrompt }: { row: JoinRequest; busy: boolean; onApprove: () => void; onPrompt: (a: Decision) => void }) {
  const t = useTheme();
  const tone = t.tone(TONE[row.status] ?? "neutral");
  const warn = t.tone("warning");
  const [opening, setOpening] = useState(false);
  const openReceipt = async () => {
    setOpening(true);
    try {
      await Linking.openURL((await receiptUrl(row.id)).url);
    } catch (e) {
      Alert.alert("Couldn't open the receipt", e instanceof Error ? e.message : "Please try again.");
    } finally {
      setOpening(false);
    }
  };
  const facts: [string, string][] = [["Round", row.roundName], ["Fee", pesos(row.amountCents)]];
  if (row.method) facts.push(["Paid with", row.method]);
  if (row.reference) facts.push(["Reference", row.reference]);
  if (row.submittedAt) facts.push(["Sent", when(row.submittedAt)]);
  if (row.reviewReason) facts.push(["Reason", row.reviewReason]);
  if (row.refundReference) facts.push(["Refund ref", row.refundReference]);
  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <View style={styles.cardHead}>
        <View style={{ flex: 1, gap: 2 }}>
          <AppText variant="bodyStrong">{row.customerName}</AppText>
          <AppText variant="caption" color="muted">
            {row.customerEmail}
          </AppText>
        </View>
        <View style={[styles.pill, { backgroundColor: tone.bg }]}>
          <AppText variant="caption" color={tone.fg}>
            {JOIN_STATUS_LABEL[row.status] ?? row.status}
          </AppText>
        </View>
      </View>
      <View style={styles.facts}>
        {facts.map(([k, v]) => (
          <View key={k} style={styles.fact}>
            <AppText variant="caption" color="muted">
              {k}
            </AppText>
            <AppText variant="body" style={{ flexShrink: 1, textAlign: "right" }} selectable>
              {v}
            </AppText>
          </View>
        ))}
      </View>
      {row.duplicateReference ? (
        <View style={[styles.warn, { backgroundColor: warn.bg }]}>
          <Ionicons name="alert-circle-outline" size={16} color={warn.fg} />
          <AppText variant="caption" color={warn.fg} style={{ flex: 1 }}>
            This reference number is on another request too — check the receipt carefully.
          </AppText>
        </View>
      ) : null}
      <View style={styles.actions}>
        {row.hasReceipt ? <Button label="Receipt" icon="image-outline" variant="secondary" loading={opening} onPress={() => void openReceipt()} style={styles.action} /> : null}
        {row.status === "paid_pending_approval" ? (
          <>
            <Button label="Reject" variant="secondary" disabled={busy} onPress={() => onPrompt("reject")} style={styles.action} />
            <Button label="Approve" icon="checkmark" disabled={busy} onPress={onApprove} style={styles.action} />
          </>
        ) : null}
        {row.status === "rejected" ? <Button label="Mark refunded" icon="cash-outline" disabled={busy} onPress={() => onPrompt("refund")} style={styles.action} /> : null}
        {row.status === "approved" ? <Button label="Remove access" variant="danger" disabled={busy} onPress={() => onPrompt("revoke")} style={styles.action} /> : null}
      </View>
    </View>
  );
}

function PromptSheet({
  prompt,
  busy,
  onCancel,
  onConfirm,
}: {
  prompt: { row: JoinRequest; action: Decision } | null;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (text: string) => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState("");
  const copy = prompt ? PROMPT_COPY[prompt.action] : null;
  const close = () => {
    setText("");
    onCancel();
  };
  return (
    <Modal visible={!!prompt} transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.sheetWrap}>
        <Pressable style={styles.scrim} onPress={close} accessibilityLabel="Close" />
        <View style={[styles.sheet, { backgroundColor: t.colors.surface, paddingBottom: insets.bottom + SPACE.lg }]}>
          {copy && prompt ? (
            <>
              <AppText variant="heading">{copy.title}</AppText>
              <AppText variant="caption" color="muted">{`${prompt.row.customerName} · ${prompt.row.roundName}`}</AppText>
              <Field label={copy.label} value={text} onChangeText={setText} placeholder={copy.placeholder} multiline autoFocus maxLength={prompt.action === "refund" ? 64 : 500} />
              <View style={styles.actions}>
                <Button label="Cancel" variant="secondary" onPress={close} style={styles.action} />
                <Button
                  label={copy.confirm}
                  variant={prompt.action === "refund" ? "primary" : "danger"}
                  loading={busy}
                  disabled={!text.trim()}
                  onPress={() => {
                    onConfirm(text.trim());
                    setText("");
                  }}
                  style={styles.action}
                />
              </View>
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PaidJoinSettings() {
  const t = useTheme();
  const rounds = usePaidJoinRounds();
  const list = (rounds.data ?? []).filter((r) => OPEN_ROUND.has(r.status));
  if (rounds.isPending || list.length === 0) return null;
  return (
    <View style={[styles.card, { backgroundColor: t.colors.surface, borderColor: t.colors.border }]}>
      <AppText variant="heading">Paid join, per round</AppText>
      <AppText variant="caption" color="muted">
        Customers pay this fee and wait for your approval before they can see the round&apos;s products or order. Each round is separate.
      </AppText>
      {list.map((r) => (
        <PaidJoinRow key={r.id} round={r} />
      ))}
    </View>
  );
}

function PaidJoinRow({ round }: { round: PaidJoinRound }) {
  const t = useTheme();
  const save = useSavePaidJoin();
  const saved = round.joinFeeCents ? String(round.joinFeeCents / 100) : "";
  const [on, setOn] = useState(round.paidJoin === true);
  const [fee, setFee] = useState(saved);
  const dirty = on !== (round.paidJoin === true) || (on && fee !== saved);
  return (
    <View style={[styles.round, { borderTopColor: t.colors.border }]}>
      <View style={styles.roundHead}>
        <View style={{ flex: 1 }}>
          <AppText variant="bodyStrong">{round.name}</AppText>
          <AppText variant="caption" color="muted">
            {round.paidJoin && round.joinFeeCents ? `Paid join · ${pesos(round.joinFeeCents)}` : "Open to everyone"}
          </AppText>
        </View>
        <Switch value={on} onValueChange={setOn} accessibilityLabel={`Require paid join for ${round.name}`} trackColor={{ true: t.brand.primary, false: t.colors.border }} />
      </View>
      {on && round.productIds.length === 0 ? (
        <AppText variant="caption" color={t.tone("warning").fg}>
          No products are assigned, so this round covers your whole catalog — unapproved customers see an empty shop while it&apos;s live.
        </AppText>
      ) : null}
      {on ? <Field label="Join fee (₱)" value={fee} onChangeText={setFee} keyboardType="decimal-pad" placeholder="500" /> : null}
      {dirty ? (
        <Button
          label="Save"
          loading={save.isPending}
          onPress={() => save.mutate({ id: round.id, paidJoin: on, joinFee: fee }, { onSuccess: () => success(), onError: (e) => Alert.alert("Couldn't save", e.message) })}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { padding: SPACE.lg, paddingBottom: SPACE.xxxl, flexGrow: 1 },
  chips: { gap: SPACE.sm, paddingRight: SPACE.lg },
  chip: { minHeight: 40, paddingHorizontal: SPACE.lg, borderRadius: RADIUS.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  card: { padding: SPACE.lg, borderRadius: RADIUS.lg, borderWidth: 1, gap: SPACE.md },
  cardHead: { flexDirection: "row", alignItems: "flex-start", gap: SPACE.md },
  pill: { borderRadius: RADIUS.pill, paddingHorizontal: SPACE.sm, paddingVertical: 3 },
  facts: { gap: SPACE.xs },
  fact: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  warn: { flexDirection: "row", gap: SPACE.sm, alignItems: "flex-start", padding: SPACE.sm, borderRadius: RADIUS.md },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: SPACE.sm },
  action: { flexGrow: 1, minHeight: TOUCH },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(0,0,0,0.35)" },
  sheet: { padding: SPACE.lg, gap: SPACE.md, borderTopLeftRadius: 20, borderTopRightRadius: 20 },
  round: { gap: SPACE.sm, paddingTop: SPACE.md, borderTopWidth: StyleSheet.hairlineWidth },
  roundHead: { flexDirection: "row", alignItems: "center", gap: SPACE.md },
});
