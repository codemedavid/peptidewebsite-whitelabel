import { useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { JoinMode, MemberApplication, MemberStatus } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useMembers, useReviewMember, useSetJoinMode } from "../hooks/useCommunityData";
import { hueFromString } from "../lib/color";
import { formatRelative } from "../lib/format";
import { CHAT, GUTTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton, ChatEmpty, Chip, type IconName } from "./ChatKit";
import { Field, FormError } from "./Form";
import { LargeHeader, NavBar } from "./Headers";
import { SegmentedTabs, Sheet } from "./Surfaces";

const REASON_PRESETS = ["Contact number is unreachable", "Name doesn't match our buyer records", "Please use the email you order with", "Duplicate account"];
const REASON_MAX = 200;
const LABEL: Record<MemberStatus, string> = { pending: "Pending", approved: "Approved", rejected: "Not approved", revoked: "Revoked" };

function Contact({ icon, value, onPress }: { icon: IconName; value: string; onPress?: () => void }) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? "link" : "text"} style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 8, minHeight: 32, opacity: pressed ? 0.6 : 1 })}>
      <Ionicons name={icon} size={16} color={CHAT.inkMuted} />
      <ChatText variant="subhead" selectable numberOfLines={1} style={{ flex: 1, color: onPress ? CHAT.info : CHAT.inkMuted }}>
        {value}
      </ChatText>
    </Pressable>
  );
}

function ApplicationCard({ row, busy, onApprove, onReject }: { row: MemberApplication; busy: boolean; onApprove: () => void; onReject: () => void }) {
  const name = row.displayName || row.email.split("@")[0];
  const dial = row.phone.replace(/[^\d+]/g, "");
  return (
    <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 14, gap: 12 }, SHADOWS.hairline]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={name} hue={hueFromString(row.customerId)} size={44} />
        <View style={{ flex: 1, gap: 1 }}>
          <ChatText variant="headline" numberOfLines={1}>
            {name}
          </ChatText>
          <ChatText variant="footnote" numberOfLines={1}>
            {`Applied ${formatRelative(row.submittedAt)}${row.reviewedAt ? ` · reviewed ${formatRelative(row.reviewedAt)}` : ""}`}
          </ChatText>
        </View>
      </View>
      <View style={{ gap: 4, backgroundColor: CHAT.surfaceAlt, borderRadius: RADII.md, padding: 10 }}>
        <Contact icon="mail-outline" value={row.email} onPress={() => void Linking.openURL(`mailto:${row.email}`)} />
        <Contact icon="call-outline" value={row.phone || "No number given"} onPress={dial ? () => void Linking.openURL(`tel:${dial}`) : undefined} />
      </View>
      {row.reason && (row.status === "rejected" || row.status === "revoked") ? (
        <View style={{ borderLeftWidth: 3, borderLeftColor: CHAT.danger, paddingLeft: 10 }}>
          <ChatText variant="footnote" color={CHAT.danger}>
            Reason given
          </ChatText>
          <ChatText variant="subhead" color={CHAT.ink}>
            {row.reason}
          </ChatText>
        </View>
      ) : null}
      <View style={{ flexDirection: "row", gap: 8 }}>
        {row.status === "pending" || row.status === "approved" ? (
          <ChatButton label={row.status === "approved" ? "Revoke" : "Reject"} tone="danger" disabled={busy} onPress={onReject} style={{ flex: 1 }} />
        ) : null}
        {row.status !== "approved" ? <ChatButton label="Approve" icon="checkmark" loading={busy} onPress={onApprove} style={{ flex: 1.4 }} /> : null}
      </View>
    </View>
  );
}

function RejectSheet({ row, onClose, onSubmit, busy }: { row: MemberApplication | null; onClose: () => void; onSubmit: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const revoking = row?.status === "approved";
  const submit = () => {
    if (reason.trim().length < 3) {
      setError("Tell them what to fix in a few words.");
      return;
    }
    onSubmit(reason.trim());
  };
  return (
    <Sheet
      visible={!!row}
      onClose={onClose}
      title={revoking ? "Revoke membership" : "Reject request"}
      subtitle={`${row?.displayName || row?.email || "They"} will see this reason.`}
    >
      <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 14 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {REASON_PRESETS.map((p) => (
            <Chip key={p} label={p} active={reason === p} onPress={() => setReason(p)} />
          ))}
        </View>
        <Field label="Reason" value={reason} onChangeText={(v) => (setReason(v), setError(null))} multiline maxLength={REASON_MAX} counter placeholder="What should they fix?" />
        <FormError message={error} />
        <ChatButton label={revoking ? "Revoke with this reason" : "Reject with this reason"} tone="danger" size="lg" loading={busy} onPress={submit} />
      </ScrollView>
    </Sheet>
  );
}

const JOIN_OPTIONS: { mode: JoinMode; title: string; body: string; icon: IconName }[] = [
  { mode: "open", title: "Everyone", body: "Anyone who signs in to the app can read and message right away.", icon: "people" },
  { mode: "approval", title: "You approve each one", body: "New sign-ins wait here until you let them in.", icon: "shield-checkmark" },
];

/** Who gets into the community: a two-option radio card. */
function JoinModeCard({ mode }: { mode: JoinMode }) {
  const b = useChatBrand();
  const setMode = useSetJoinMode();
  const [error, setError] = useState<string | null>(null);
  const pick = (next: JoinMode) => {
    if (next === mode || setMode.isPending) return;
    setError(null);
    setMode.mutate(next, {
      onSuccess: () => void Haptics.selectionAsync().catch(() => undefined),
      onError: (e) => setError(e.message),
    });
  };
  return (
    <View style={[{ marginHorizontal: GUTTER, marginTop: 12, backgroundColor: CHAT.surface, borderRadius: RADII.lg, overflow: "hidden" }, SHADOWS.hairline]}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 14, paddingTop: 12, paddingBottom: 4 }}>
        <ChatText variant="overline" accessibilityRole="header">
          Who can join
        </ChatText>
        {setMode.isPending ? <ActivityIndicator size="small" color={b.brandText} accessibilityLabel="Saving" /> : null}
      </View>
      {JOIN_OPTIONS.map((o, i) => {
        const on = o.mode === mode;
        return (
          <Pressable
            key={o.mode}
            onPress={() => pick(o.mode)}
            accessibilityRole="radio"
            accessibilityState={{ checked: on, disabled: setMode.isPending }}
            accessibilityLabel={`${o.title}. ${o.body}`}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              paddingHorizontal: 14,
              paddingVertical: 12,
              backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
              borderTopWidth: i === 0 ? 0 : 1,
              borderTopColor: CHAT.hairline,
            })}
          >
            <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: on ? b.brandTint : CHAT.surfaceAlt }}>
              <Ionicons name={o.icon} size={18} color={on ? b.brandText : CHAT.inkMuted} />
            </View>
            <View style={{ flex: 1, gap: 1 }}>
              <ChatText variant="bodyStrong">{o.title}</ChatText>
              <ChatText variant="footnote">{o.body}</ChatText>
            </View>
            <Ionicons name={on ? "radio-button-on" : "radio-button-off"} size={22} color={on ? b.brandText : CHAT.inkFaint} />
          </Pressable>
        );
      })}
      {error ? (
        <ChatText variant="footnote" color={CHAT.danger} accessibilityLiveRegion="polite" style={{ paddingHorizontal: 14, paddingBottom: 10 }}>
          {error}
        </ChatText>
      ) : null}
    </View>
  );
}

/**
 * Moderators: who can join, the member list, and — when the owner reviews
 * members — approving, rejecting or revoking with a reason.
 */
export function MembersScreen({ asTab = false, headerRight }: { asTab?: boolean; headerRight?: ReactNode } = {}) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const { me } = useSignedIn();
  const joinMode = me.community.joinMode;
  const open = joinMode === "open";
  // An open community has no queue: start on the people already in.
  const [tab, setTab] = useState<MemberStatus>(open ? "approved" : "pending");
  const q = useMembers(tab);
  const review = useReviewMember();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState<MemberApplication | null>(null);
  const counts = q.data?.counts;
  const subtitle = counts?.pending
    ? `${counts.pending} waiting for review`
    : open
      ? `${counts?.approved ?? 0} in the community`
      : "All caught up";

  const decide = (row: MemberApplication, approve: boolean, reason?: string) => {
    setBusyId(row.customerId);
    setActionError(null);
    review.mutate(
      { customerId: row.customerId, body: approve ? { approve } : { approve, reason } },
      {
        onSuccess: () => {
          void Haptics.notificationAsync(approve ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
          setRejecting(null);
        },
        onError: (e) => setActionError(e.message),
        onSettled: () => setBusyId(null),
      },
    );
  };

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      {asTab ? (
        <LargeHeader title="Members" subtitle={subtitle} flush right={headerRight} />
      ) : (
        <NavBar title="Members" subtitle={subtitle} />
      )}
      <JoinModeCard mode={joinMode} />
      <SegmentedTabs
        items={(["pending", "approved", "rejected", "revoked"] as const).map((k) => ({ key: k, label: LABEL[k], count: k === "pending" ? counts?.pending : undefined }))}
        value={tab}
        onChange={setTab}
      />
      {actionError || q.error ? (
        <View style={{ margin: GUTTER, marginBottom: 0, padding: 12, borderRadius: RADII.md, backgroundColor: CHAT.dangerSoft }}>
          <ChatText variant="subhead" color={CHAT.danger} accessibilityLiveRegion="polite">
            {actionError ?? q.error?.message}
          </ChatText>
        </View>
      ) : null}
      {q.isPending ? (
        <ActivityIndicator color={b.brandText} style={{ marginTop: 60 }} accessibilityLabel="Loading members" />
      ) : (
        <FlatList
          data={q.data?.members ?? []}
          keyExtractor={(r) => r.customerId}
          contentContainerStyle={{ padding: GUTTER, gap: 10, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={b.brandText} />}
          ListEmptyComponent={
            <ChatEmpty
              icon={tab === "pending" ? "checkmark-done-circle-outline" : "people-outline"}
              title={tab === "pending" ? "No one is waiting" : `No ${LABEL[tab].toLowerCase()} members`}
              body={tab === "pending" ? (open ? "Everyone who signs in joins straight away." : "Customers who sign in to the app show up here.") : undefined}
            />
          }
          renderItem={({ item }) => (
            <ApplicationCard row={item} busy={busyId === item.customerId} onApprove={() => decide(item, true)} onReject={() => setRejecting(item)} />
          )}
        />
      )}
      <RejectSheet
        key={rejecting?.customerId ?? "none"}
        row={rejecting}
        busy={!!rejecting && busyId === rejecting.customerId}
        onClose={() => setRejecting(null)}
        onSubmit={(reason) => rejecting && decide(rejecting, false, reason)}
      />
    </View>
  );
}
