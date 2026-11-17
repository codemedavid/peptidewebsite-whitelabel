import { useState, type ReactNode } from "react";
import { ActivityIndicator, Linking, Pressable, RefreshControl, ScrollView, View } from "react-native";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MemberDetail, MemberStatus } from "@contract";
import { communityApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { useOpenDm, useReviewMember, useSetMemberAdmin, useSetVerifiedReseller } from "../hooks/useCommunityData";
import { hueFromString } from "../lib/color";
import { formatRelative } from "../lib/format";
import { CHAT, GUTTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatButton, ChatEmpty, type IconName } from "./ChatKit";
import { ChatText } from "./ChatText";
import { NavBar } from "./Headers";
import { MemberSwitch, RejectSheet, SafetyBadges } from "./MembersScreen";
import { ResetPasswordSheet } from "./ResetPasswordSheet";
import { RoleBadge } from "./RoleBadge";

const STATUS: Record<MemberStatus, { label: string; fg: string; bg: string }> = {
  pending: { label: "Waiting for review", fg: CHAT.warning, bg: CHAT.warningSoft },
  approved: { label: "Member", fg: CHAT.success, bg: CHAT.successSoft },
  rejected: { label: "Not approved", fg: CHAT.danger, bg: CHAT.dangerSoft },
  revoked: { label: "Removed", fg: CHAT.danger, bg: CHAT.dangerSoft },
};

const memberKey = (scope: string, id: string) => [scope, "community-member", id] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <View style={{ gap: 8 }}>
      <ChatText variant="overline" accessibilityRole="header" style={{ paddingHorizontal: 4 }}>
        {title}
      </ChatText>
      <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, overflow: "hidden" }, SHADOWS.hairline]}>{children}</View>
    </View>
  );
}

type RowProps = {
  icon: IconName;
  title: string;
  body?: string;
  onPress?: () => void;
  onLongPress?: () => void;
  tone?: "brand" | "muted";
  trailing?: ReactNode;
  first?: boolean;
};

/** One row inside a Section. */
function Row({ icon, title, body, onPress, onLongPress, tone, trailing, first }: RowProps) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={!onPress && !onLongPress}
      accessibilityRole={onPress ? "button" : "text"}
      accessibilityLabel={body ? `${title}. ${body}` : title}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 56,
        backgroundColor: pressed ? CHAT.surfacePressed : CHAT.surface,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: CHAT.hairline,
      })}
    >
      <View style={{ width: 34, height: 34, borderRadius: 17, alignItems: "center", justifyContent: "center", backgroundColor: tone === "brand" ? b.brandTint : CHAT.surfaceAlt }}>
        <Ionicons name={icon} size={17} color={tone === "brand" ? b.brandText : CHAT.inkMuted} />
      </View>
      <View style={{ flex: 1, gap: 1 }}>
        <ChatText variant="bodyStrong" numberOfLines={1}>
          {title}
        </ChatText>
        {body ? (
          <ChatText variant="footnote" numberOfLines={2}>
            {body}
          </ChatText>
        ) : null}
      </View>
      {trailing ?? (onPress ? <Ionicons name="chevron-forward" size={18} color={CHAT.inkFaint} /> : null)}
    </Pressable>
  );
}

/** A quick action under the profile (Message, Call, WhatsApp, Email). */
function QuickAction({ icon, label, onPress, loading }: { icon: IconName; label: string; onPress: () => void; loading?: boolean }) {
  const b = useChatBrand();
  return (
    <Pressable
      onPress={onPress}
      disabled={loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 6, paddingVertical: 10, borderRadius: RADII.md, backgroundColor: pressed ? b.brandSoft : b.brandTint })}
    >
      {loading ? <ActivityIndicator size="small" color={b.brandText} /> : <Ionicons name={icon} size={20} color={b.brandText} />}
      <ChatText variant="caption" color={b.brandText} style={{ fontWeight: "600" }}>
        {label}
      </ChatText>
    </Pressable>
  );
}

function copy(value: string) {
  void Clipboard.setStringAsync(value);
  void Haptics.selectionAsync().catch(() => undefined);
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <NavBar title="Member" />
      {children}
    </View>
  );
}

/**
 * Store team: everything about one community member on one screen — who they
 * are, how to reach them, their roles, orders, and the account tools
 * (reset a forgotten password; approve / reject / remove).
 */
export function MemberDetailScreen({ customerId }: { customerId: string }) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const qc = useQueryClient();
  const { me, scope } = useSignedIn();
  const key = memberKey(scope, customerId);
  const q = useQuery({ queryKey: key, queryFn: () => communityApi.memberDetail(customerId), enabled: !!customerId });
  const openDm = useOpenDm();
  const review = useReviewMember();
  const reseller = useSetVerifiedReseller();
  const admin = useSetMemberAdmin();
  const [resetting, setResetting] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (q.isPending) {
    return (
      <Shell>
        <ActivityIndicator color={b.brandText} style={{ marginTop: 80 }} accessibilityLabel="Loading member" />
      </Shell>
    );
  }
  if (q.isError || !q.data) {
    return (
      <Shell>
        <ChatEmpty icon="person-remove-outline" title="Couldn't open this member" body={q.error?.message ?? "They may have deleted their account."} />
        <View style={{ paddingHorizontal: GUTTER }}>
          <ChatButton label="Try again" tone="outline" onPress={() => void q.refetch()} />
        </View>
      </Shell>
    );
  }

  const m = q.data;
  const name = m.displayName || m.email.split("@")[0] || "Member";
  const dial = m.phone.replace(/[^\d+]/g, "");
  const waDigits = m.phone.replace(/[^\d]/g, "");
  const status = STATUS[m.status];
  const isTeam = me.community.isModerator;
  const canReview = isTeam || !m.isAdmin;

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: qk.communityMembersAll(scope) });
  };
  // Optimistic local flip, so the switch moves under the finger.
  const patch = (next: Partial<MemberDetail>) => qc.setQueryData<MemberDetail>(key, (old) => (old ? { ...old, ...next } : old));

  const decide = (approve: boolean, reason?: string) => {
    setActionError(null);
    review.mutate(
      { customerId, body: approve ? { approve } : { approve, reason } },
      {
        onSuccess: () => {
          void Haptics.notificationAsync(approve ? Haptics.NotificationFeedbackType.Success : Haptics.NotificationFeedbackType.Warning).catch(() => undefined);
          setRejecting(false);
          refresh();
        },
        onError: (e) => setActionError(e.message),
      },
    );
  };
  const flip = (field: "isAdmin" | "verifiedReseller", value: boolean) => {
    setActionError(null);
    const prev = m[field];
    patch({ [field]: value });
    (field === "isAdmin" ? admin : reseller).mutate(
      { customerId, value },
      {
        onSuccess: () => void Haptics.selectionAsync().catch(() => undefined),
        onError: (e) => {
          patch({ [field]: prev });
          setActionError(e.message);
        },
        onSettled: refresh,
      },
    );
  };

  const passwordBody = m.canResetPassword
    ? "Hidden for privacy. Forgot it? Set a new one and send it to them."
    : m.email
      ? "Only the owner or staff with Customers access can reset it."
      : "This member signs in without a password here.";
  const lastSeen = m.lastLoginAt ? `last signed in ${formatRelative(m.lastLoginAt)}` : "hasn't signed in yet";

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <NavBar title={name} subtitle={status.label} />
      <ScrollView
        contentContainerStyle={{ padding: GUTTER, gap: 20, paddingBottom: insets.bottom + 32 }}
        refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={b.brandText} />}
      >
        <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.xl, padding: 18, gap: 14, alignItems: "center" }, SHADOWS.hairline]}>
          <Avatar name={name} hue={hueFromString(customerId)} size={88} imageUrl={m.avatarUrl} />
          <View style={{ alignItems: "center", gap: 6 }}>
            <ChatText variant="title" accessibilityRole="header" numberOfLines={2} style={{ textAlign: "center" }}>
              {name}
            </ChatText>
            <View style={{ flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 6 }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, backgroundColor: status.bg }}>
                <ChatText variant="caption" color={status.fg} style={{ fontWeight: "600" }}>
                  {status.label}
                </ChatText>
              </View>
              {m.isAdmin ? <RoleBadge role="admin" /> : null}
              {m.verifiedReseller ? <RoleBadge role="reseller" /> : null}
            </View>
            <SafetyBadges row={m} />
            {m.bio ? (
              <ChatText variant="subhead" color={CHAT.inkSoft} style={{ textAlign: "center" }}>
                {m.bio}
              </ChatText>
            ) : null}
            <ChatText variant="footnote" style={{ textAlign: "center" }}>
              {`Joined ${formatRelative(m.joinedAt)} · ${lastSeen}`}
            </ChatText>
          </View>
          <View style={{ flexDirection: "row", gap: 8, alignSelf: "stretch" }}>
            {m.status === "approved" ? (
              <QuickAction icon="chatbubble-ellipses-outline" label="Message" loading={openDm.isPending} onPress={() => openDm.mutate(`c:${customerId}`)} />
            ) : null}
            {dial ? <QuickAction icon="call-outline" label="Call" onPress={() => void Linking.openURL(`tel:${dial}`).catch(() => undefined)} /> : null}
            {waDigits.length >= 7 ? (
              <QuickAction icon="logo-whatsapp" label="WhatsApp" onPress={() => void Linking.openURL(`https://wa.me/${waDigits}`).catch(() => undefined)} />
            ) : null}
            {m.email ? <QuickAction icon="mail-outline" label="Email" onPress={() => void Linking.openURL(`mailto:${m.email}`).catch(() => undefined)} /> : null}
          </View>
        </View>

        {actionError ? (
          <View style={{ padding: 12, borderRadius: RADII.md, backgroundColor: CHAT.dangerSoft }}>
            <ChatText variant="subhead" color={CHAT.danger} accessibilityLiveRegion="polite">
              {actionError}
            </ChatText>
          </View>
        ) : null}

        {m.email || m.phone ? (
          <Section title="Contact">
            <Row first icon="mail-outline" title={m.email || "No email"} body={m.email ? "Long-press to copy" : undefined} onLongPress={m.email ? () => copy(m.email) : undefined} />
            <Row icon="call-outline" title={m.phone || "No number given"} body={m.phone ? "Long-press to copy" : undefined} onLongPress={m.phone ? () => copy(m.phone) : undefined} />
          </Section>
        ) : null}

        {isTeam ? (
          <Section title="Account & security">
            <Row
              first
              icon="key-outline"
              tone="brand"
              title="Password"
              body={passwordBody}
              trailing={m.canResetPassword ? <ChatButton label="Reset" size="sm" tone="tinted" onPress={() => setResetting(true)} /> : null}
              onPress={m.canResetPassword ? () => setResetting(true) : undefined}
            />
            {me.can.orders ? (
              <Row icon="receipt-outline" title="Order history" body="Every order on this account" onPress={() => router.push({ pathname: "/customer-account/[id]", params: { id: customerId } })} />
            ) : null}
          </Section>
        ) : null}

        {isTeam && m.status === "approved" ? (
          <Section title="Roles">
            <View style={{ paddingHorizontal: 14, paddingVertical: 6 }}>
              <MemberSwitch
                icon="star-outline"
                title="Community admin"
                body="Manages channels and approves or removes members. Can't use store tools."
                value={m.isAdmin === true}
                busy={admin.isPending}
                onChange={(v) => flip("isAdmin", v)}
              />
              <View style={{ height: 1, backgroundColor: CHAT.hairline, marginVertical: 4 }} />
              <MemberSwitch
                icon="shield-checkmark-outline"
                title="Verified reseller"
                body="Posts their on-hand products in the Verified Resellers Hub, with a verified tag in chat."
                value={m.verifiedReseller}
                busy={reseller.isPending}
                onChange={(v) => flip("verifiedReseller", v)}
              />
            </View>
          </Section>
        ) : null}

        {m.reason && (m.status === "rejected" || m.status === "revoked") ? (
          <View style={{ borderLeftWidth: 3, borderLeftColor: CHAT.danger, paddingLeft: 10 }}>
            <ChatText variant="footnote" color={CHAT.danger}>
              Reason given
            </ChatText>
            <ChatText variant="subhead" color={CHAT.ink}>
              {m.reason}
            </ChatText>
          </View>
        ) : null}

        {canReview ? (
          <View style={{ flexDirection: "row", gap: 8 }}>
            {m.status === "pending" || m.status === "approved" ? (
              <ChatButton
                label={m.status === "approved" ? "Remove from community" : "Reject"}
                tone="danger"
                disabled={review.isPending}
                onPress={() => setRejecting(true)}
                style={{ flex: 1 }}
              />
            ) : null}
            {m.status !== "approved" && (isTeam || m.status === "pending") ? (
              <ChatButton label="Approve" icon="checkmark" loading={review.isPending} onPress={() => decide(true)} style={{ flex: 1.3 }} />
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <ResetPasswordSheet member={resetting ? { customerId, name, email: m.email } : null} onClose={() => setResetting(false)} />
      <RejectSheet row={rejecting ? m : null} busy={review.isPending} onClose={() => setRejecting(false)} onSubmit={(reason) => decide(false, reason)} />
    </View>
  );
}
