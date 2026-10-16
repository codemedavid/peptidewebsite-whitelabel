import { useState, type ReactNode } from "react";
import { ActivityIndicator, FlatList, Linking, Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import type { JoinMode, MemberApplication, MemberStatus } from "@contract";
import { useSignedIn } from "@/auth/SessionProvider";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useMembers, useModeration, useReviewMember, useSetJoinMode, useSetMemberAdmin, useSetVerifiedReseller } from "../hooks/useCommunityData";
import { hueFromString } from "../lib/color";
import { formatRelative } from "../lib/format";
import { CHAT, GUTTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { RoleBadge } from "./RoleBadge";
import { ChatButton, ChatEmpty, Chip, type IconName } from "./ChatKit";
import { Field, FormError } from "./Form";
import { LargeHeader, NavBar } from "./Headers";
import { SegmentedTabs, Sheet } from "./Surfaces";
import { WelcomeCard } from "./WelcomeEditor";

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

/** Safety bot record on a member card: offenses, mute, ban. */
function SafetyBadges({ row }: { row: MemberApplication }) {
  const offenses = row.offenses ?? 0;
  if (!offenses && !row.muted && !row.banned) return null;
  const pill = (label: string, icon: IconName, fg: string, bg: string) => (
    <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 999, backgroundColor: bg }}>
      <Ionicons name={icon} size={11} color={fg} />
      <ChatText variant="caption" color={fg}>
        {label}
      </ChatText>
    </View>
  );
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
      {offenses === 1 ? pill("1st offense", "alert-circle", CHAT.warning, CHAT.warningSoft) : null}
      {offenses > 1 ? pill(`Repeat offender · ${offenses}`, "flame", CHAT.danger, CHAT.dangerSoft) : null}
      {row.banned ? pill("Banned", "ban", "#fff", CHAT.danger) : row.muted ? pill("Muted", "volume-mute", CHAT.inkSoft, CHAT.surfaceAlt) : null}
    </View>
  );
}

/** Opens the safety bot's review queue, with how many hidden messages wait there. */
function SafetyEntry() {
  const b = useChatBrand();
  const q = useModeration("pending");
  const pending = q.data?.counts.pending ?? 0;
  const on = q.data?.settings.enabled ?? false;
  const body = !q.data ? "Checks chats and DMs for invites to other groups." : !on ? "Off — turn it on to check chats and DMs." : pending ? `${pending} hidden message${pending === 1 ? "" : "s"} to review` : "On — nothing to review";
  return (
    <Pressable
      onPress={() => router.push("/community/safety")}
      accessibilityRole="button"
      accessibilityLabel={`Safety bot. ${body}`}
      style={({ pressed }) => [
        { marginHorizontal: GUTTER, marginTop: 12, flexDirection: "row", alignItems: "center", gap: 12, padding: 14, borderRadius: RADII.lg, backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface },
        SHADOWS.hairline,
      ]}
    >
      <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center", backgroundColor: pending ? CHAT.dangerSoft : b.brandTint }}>
        <Ionicons name="shield-checkmark" size={18} color={pending ? CHAT.danger : b.brandText} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <ChatText variant="bodyStrong">Safety bot</ChatText>
        <ChatText variant="footnote" color={pending ? CHAT.danger : undefined}>
          {body}
        </ChatText>
      </View>
      <Ionicons name="chevron-forward" size={18} color={CHAT.inkFaint} />
    </Pressable>
  );
}

/** Store team, approved members: a labelled switch (verified reseller, community admin). */
function MemberSwitch({
  icon,
  title,
  body,
  value,
  busy,
  onChange,
}: {
  icon: IconName;
  title: string;
  body: string;
  value: boolean;
  busy: boolean;
  onChange: (next: boolean) => void;
}) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={busy}
      accessibilityRole="switch"
      accessibilityState={{ checked: value, disabled: busy }}
      accessibilityLabel={`${title}. ${body}`}
      style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: 10, minHeight: 44, opacity: pressed ? 0.7 : 1 })}
    >
      <Ionicons name={icon} size={18} color={value ? b.brandText : CHAT.inkMuted} />
      <View style={{ flex: 1, gap: 1 }}>
        <ChatText variant="bodyStrong">{title}</ChatText>
        <ChatText variant="footnote">{body}</ChatText>
      </View>
      <Switch
        value={value}
        onValueChange={onChange}
        disabled={busy}
        trackColor={{ true: b.brand, false: CHAT.hairlineStrong }}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}

function ApplicationCard({
  row,
  isTeam,
  busy,
  resellerBusy,
  adminBusy,
  onApprove,
  onReject,
  onReseller,
  onAdmin,
}: {
  row: MemberApplication;
  /** The store team sees contact details and the reseller / admin switches. */
  isTeam: boolean;
  busy: boolean;
  resellerBusy: boolean;
  adminBusy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onReseller: (next: boolean) => void;
  onAdmin: (next: boolean) => void;
}) {
  const name = row.displayName || row.email.split("@")[0] || "Member";
  // Community admins can't act on another admin, or take back someone removed — only the store team can.
  const canReview = isTeam || !row.isAdmin;
  const dial = row.phone.replace(/[^\d+]/g, "");
  return (
    <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 14, gap: 12 }, SHADOWS.hairline]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={name} hue={hueFromString(row.customerId)} size={44} />
        <View style={{ flex: 1, gap: 1 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <ChatText variant="headline" numberOfLines={1} style={{ flexShrink: 1 }}>
              {name}
            </ChatText>
            {row.isAdmin ? <RoleBadge role="admin" /> : null}
            {row.verifiedReseller ? <RoleBadge role="reseller" /> : null}
          </View>
          <SafetyBadges row={row} />
          <ChatText variant="footnote" numberOfLines={1}>
            {`Applied ${formatRelative(row.submittedAt)}${row.reviewedAt ? ` · reviewed ${formatRelative(row.reviewedAt)}` : ""}`}
          </ChatText>
        </View>
      </View>
      {row.email ? (
        <View style={{ gap: 4, backgroundColor: CHAT.surfaceAlt, borderRadius: RADII.md, padding: 10 }}>
          <Contact icon="mail-outline" value={row.email} onPress={() => void Linking.openURL(`mailto:${row.email}`)} />
          <Contact icon="call-outline" value={row.phone || "No number given"} onPress={dial ? () => void Linking.openURL(`tel:${dial}`) : undefined} />
        </View>
      ) : null}
      {isTeam && row.status === "approved" ? (
        <>
          <MemberSwitch
            icon="star-outline"
            title="Community admin"
            body="Manages channels and approves or removes members. Can't use store tools."
            value={row.isAdmin === true}
            busy={adminBusy}
            onChange={onAdmin}
          />
          <MemberSwitch
            icon="shield-checkmark-outline"
            title="Verified reseller"
            body="Posts their on-hand products in the Verified Resellers Hub, with a verified tag in chat."
            value={row.verifiedReseller}
            busy={resellerBusy}
            onChange={onReseller}
          />
        </>
      ) : null}
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
        {canReview && (row.status === "pending" || row.status === "approved") ? (
          <ChatButton label={row.status === "approved" ? "Revoke" : "Reject"} tone="danger" disabled={busy} onPress={onReject} style={{ flex: 1 }} />
        ) : null}
        {canReview && row.status !== "approved" && (isTeam || row.status === "pending") ? <ChatButton label="Approve" icon="checkmark" loading={busy} onPress={onApprove} style={{ flex: 1.4 }} /> : null}
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
 * members — approving, rejecting or revoking with a reason. Community admins
 * get the list, the review buttons and the welcome messages; the join mode,
 * safety bot, contact details and the reseller / admin switches are the team's.
 */
export function MembersScreen({ asTab = false, headerRight }: { asTab?: boolean; headerRight?: ReactNode } = {}) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const { me } = useSignedIn();
  const isTeam = me.community.isModerator;
  const joinMode = me.community.joinMode;
  const open = joinMode === "open";
  // An open community has no queue: start on the people already in.
  const [tab, setTab] = useState<MemberStatus>(open ? "approved" : "pending");
  const q = useMembers(tab);
  const review = useReviewMember();
  const reseller = useSetVerifiedReseller();
  const admin = useSetMemberAdmin();
  const [resellerBusyId, setResellerBusyId] = useState<string | null>(null);
  const [adminBusyId, setAdminBusyId] = useState<string | null>(null);
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

  const setReseller = (row: MemberApplication, value: boolean) => {
    setResellerBusyId(row.customerId);
    setActionError(null);
    reseller.mutate(
      { customerId: row.customerId, value },
      {
        onSuccess: () => void Haptics.selectionAsync().catch(() => undefined),
        onError: (e) => setActionError(e.message),
        onSettled: () => setResellerBusyId(null),
      },
    );
  };

  const setAdmin = (row: MemberApplication, value: boolean) => {
    setAdminBusyId(row.customerId);
    setActionError(null);
    admin.mutate(
      { customerId: row.customerId, value },
      {
        onSuccess: () => void Haptics.selectionAsync().catch(() => undefined),
        onError: (e) => setActionError(e.message),
        onSettled: () => setAdminBusyId(null),
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
      {isTeam ? (
        <>
          <JoinModeCard mode={joinMode} />
          <SafetyEntry />
        </>
      ) : null}
      {q.data?.welcome ? <WelcomeCard welcome={q.data.welcome} /> : null}
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
            <ApplicationCard
              row={item}
              isTeam={isTeam}
              busy={busyId === item.customerId}
              resellerBusy={resellerBusyId === item.customerId}
              adminBusy={adminBusyId === item.customerId}
              onApprove={() => decide(item, true)}
              onReject={() => setRejecting(item)}
              onReseller={(next) => setReseller(item, next)}
              onAdmin={(next) => setAdmin(item, next)}
            />
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
