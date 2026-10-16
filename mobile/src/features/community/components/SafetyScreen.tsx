import { useState } from "react";
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Switch, View } from "react-native";
import * as Haptics from "expo-haptics";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { FlagStatus, ModerationFlag, ModerationSettingsView } from "@contract";
import { useModeration, useReviewFlag, useSanctionMember, useSetModeration } from "../hooks/useCommunityData";
import { formatRelative } from "../lib/format";
import { CHAT, GUTTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton, ChatEmpty, Chip, type IconName } from "./ChatKit";
import { NavBar } from "./Headers";
import { SegmentedTabs, Sheet } from "./Surfaces";

/**
 * Moderators: the safety bot. Jev checks every member's channel post and DM;
 * anything that invites people to another group is hidden and lands here.
 * Restore a false alarm, keep it hidden, mute, or ban — a ban also locks the
 * member's login (server: lib/community/moderation.server.ts).
 */

const TABS: { key: FlagStatus; label: string }[] = [
  { key: "pending", label: "To review" },
  { key: "confirmed", label: "Kept hidden" },
  { key: "dismissed", label: "False alarms" },
];
const MUTE_AFTER_OPTIONS = [1, 2, 3, 5];

function Pill({ label, icon, fg, bg }: { label: string; icon?: IconName; fg: string; bg: string }) {
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: bg }}>
      {icon ? <Ionicons name={icon} size={11} color={fg} /> : null}
      <ChatText variant="caption" color={fg}>
        {label}
      </ChatText>
    </View>
  );
}

/** "1st offense" reads as a warning; repeat offenders read as danger. */
function OffensePill({ flag }: { flag: ModerationFlag }) {
  const { tag, label } = flag.sender;
  if (!tag || !label) return null;
  return tag === "first" ? (
    <Pill label={label} icon="alert-circle" fg={CHAT.warning} bg={CHAT.warningSoft} />
  ) : (
    <Pill label={label} icon="flame" fg={CHAT.danger} bg={CHAT.dangerSoft} />
  );
}

function SettingsCard({ settings }: { settings: ModerationSettingsView }) {
  const b = useChatBrand();
  const save = useSetModeration();
  const [error, setError] = useState<string | null>(null);
  const update = (body: { enabled?: boolean; muteAfter?: number }) => {
    setError(null);
    save.mutate(body, {
      onSuccess: () => void Haptics.selectionAsync().catch(() => undefined),
      onError: (e) => setError(e.message),
    });
  };
  return (
    <View style={[{ marginHorizontal: GUTTER, marginTop: 12, backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 14, gap: 12 }, SHADOWS.hairline]}>
      <Pressable
        onPress={() => update({ enabled: !settings.enabled })}
        disabled={save.isPending}
        accessibilityRole="switch"
        accessibilityState={{ checked: settings.enabled, disabled: save.isPending }}
        accessibilityLabel="Safety bot. Checks every member message and hides invites to other groups."
        style={{ flexDirection: "row", alignItems: "center", gap: 12 }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: settings.enabled ? b.brandTint : CHAT.surfaceAlt }}>
          <Ionicons name="shield-checkmark" size={20} color={settings.enabled ? b.brandText : CHAT.inkMuted} />
        </View>
        <View style={{ flex: 1, gap: 1 }}>
          <ChatText variant="bodyStrong">Safety bot</ChatText>
          <ChatText variant="footnote">Checks chats and DMs, and hides invites to other groups or group buys.</ChatText>
        </View>
        <Switch
          value={settings.enabled}
          onValueChange={(enabled) => update({ enabled })}
          disabled={save.isPending}
          trackColor={{ true: b.brand, false: CHAT.hairlineStrong }}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
      {settings.enabled && !settings.available ? (
        <View style={{ flexDirection: "row", gap: 8, padding: 10, borderRadius: RADII.md, backgroundColor: CHAT.warningSoft }}>
          <Ionicons name="warning" size={16} color={CHAT.warning} />
          <ChatText variant="footnote" color={CHAT.ink} style={{ flex: 1 }}>
            The AI key isn&apos;t set up on the server yet, so messages aren&apos;t being checked.
          </ChatText>
        </View>
      ) : null}
      <View style={{ gap: 8 }}>
        <ChatText variant="overline">Auto-mute after</ChatText>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {MUTE_AFTER_OPTIONS.map((n) => (
            <Chip key={n} label={n === 1 ? "1st offense" : `${n} offenses`} active={settings.muteAfter === n} onPress={() => update({ muteAfter: n })} />
          ))}
        </View>
        <ChatText variant="footnote">Muted members can still read, but can&apos;t post or send DMs until you unmute them.</ChatText>
      </View>
      {error ? (
        <ChatText variant="footnote" color={CHAT.danger} accessibilityLiveRegion="polite">
          {error}
        </ChatText>
      ) : null}
    </View>
  );
}

function ContextLines({ flag }: { flag: ModerationFlag }) {
  return (
    <View style={{ gap: 6, backgroundColor: CHAT.surfaceAlt, borderRadius: RADII.md, padding: 10 }}>
      {flag.context.map((line, i) =>
        line.flagged ? (
          <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: CHAT.danger, paddingLeft: 8, gap: 2 }}>
            <ChatText variant="caption" color={CHAT.danger}>
              {`${line.senderName} · flagged`}
            </ChatText>
            <ChatText variant="callout" color={CHAT.ink} selectable>
              {flag.message.text || line.text}
            </ChatText>
          </View>
        ) : (
          <View key={i} style={{ gap: 1, opacity: 0.75 }}>
            <ChatText variant="caption" color={CHAT.inkMuted}>
              {line.senderName}
            </ChatText>
            <ChatText variant="footnote" color={CHAT.inkSoft} numberOfLines={2}>
              {line.text}
            </ChatText>
          </View>
        ),
      )}
    </View>
  );
}

function FlagCard({
  flag,
  busy,
  onReview,
  onMute,
  onBan,
}: {
  flag: ModerationFlag;
  busy: boolean;
  onReview: (action: "restore" | "confirm") => void;
  onMute: (mute: boolean) => void;
  onBan: () => void;
}) {
  const s = flag.sender;
  const dm = flag.place.type === "dm";
  return (
    <View style={[{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 14, gap: 12 }, SHADOWS.hairline]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Avatar name={s.name} hue={s.avatarHue} imageUrl={s.imageUrl} size={44} />
        <View style={{ flex: 1, gap: 4 }}>
          <ChatText variant="headline" numberOfLines={1}>
            {s.name}
          </ChatText>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            <OffensePill flag={flag} />
            {s.banned ? <Pill label="Banned" icon="ban" fg="#fff" bg={CHAT.danger} /> : null}
            {!s.banned && s.muted ? <Pill label={s.mutedByBot ? "Auto-muted" : "Muted"} icon="volume-mute" fg={CHAT.inkSoft} bg={CHAT.surfaceAlt} /> : null}
          </View>
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        <Ionicons name={dm ? "lock-closed" : "chatbubbles"} size={14} color={CHAT.inkMuted} />
        <ChatText variant="footnote" numberOfLines={1} style={{ flex: 1 }}>
          {`${flag.place.name} · ${formatRelative(flag.createdAt)}`}
        </ChatText>
        <ChatText variant="caption" color={CHAT.inkMuted}>{`${Math.round(flag.score * 100)}% likely`}</ChatText>
      </View>
      <ContextLines flag={flag} />
      {dm ? (
        <ChatText variant="caption" color={CHAT.inkMuted}>
          Private chat — you only see the flagged message and the two lines before it.
        </ChatText>
      ) : null}
      {flag.status === "pending" ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          <ChatButton label="False alarm" icon="arrow-undo" tone="outline" disabled={busy} onPress={() => onReview("restore")} style={{ flex: 1 }} />
          <ChatButton label="Keep hidden" icon="eye-off" tone="tinted" loading={busy} onPress={() => onReview("confirm")} style={{ flex: 1 }} />
        </View>
      ) : null}
      {s.customerId ? (
        <View style={{ flexDirection: "row", gap: 8 }}>
          {!s.banned ? (
            <ChatButton label={s.muted ? "Unmute" : "Mute"} icon={s.muted ? "volume-high" : "volume-mute"} tone="ghost" disabled={busy} onPress={() => onMute(!s.muted)} style={{ flex: 1 }} />
          ) : null}
          <ChatButton label={s.banned ? "Unban" : "Ban"} icon={s.banned ? "refresh" : "ban"} tone={s.banned ? "outline" : "danger"} disabled={busy} onPress={onBan} style={{ flex: 1 }} />
        </View>
      ) : null}
    </View>
  );
}

function BanSheet({ flag, busy, onClose, onConfirm }: { flag: ModerationFlag | null; busy: boolean; onClose: () => void; onConfirm: () => void }) {
  const name = flag?.sender.name ?? "this member";
  const banned = !!flag?.sender.banned;
  return (
    <Sheet visible={!!flag} onClose={onClose} title={banned ? `Unban ${name}?` : `Ban ${name}?`} fit>
      <ScrollView contentContainerStyle={{ padding: GUTTER, gap: 14 }}>
        <ChatText variant="body" color={CHAT.inkSoft}>
          {banned
            ? "They'll be back in the community and can sign in with their account again."
            : "They're removed from the community and can't sign in with this account again — not to chats, the shop or their orders. You can unban them later."}
        </ChatText>
        <ChatButton label={banned ? "Unban" : `Ban ${name}`} icon={banned ? "refresh" : "ban"} tone={banned ? "primary" : "danger"} size="lg" loading={busy} onPress={onConfirm} />
        <ChatButton label="Cancel" tone="ghost" onPress={onClose} />
      </ScrollView>
    </Sheet>
  );
}

export function SafetyScreen() {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const [tab, setTab] = useState<FlagStatus>("pending");
  const q = useModeration(tab);
  const review = useReviewFlag();
  const sanction = useSanctionMember();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [banning, setBanning] = useState<ModerationFlag | null>(null);
  const counts = q.data?.counts;
  const subtitle = counts?.pending ? `${counts.pending} to review` : "All caught up";

  const run = (id: string, task: () => Promise<unknown>, feedback: Haptics.NotificationFeedbackType) => {
    setBusyId(id);
    setActionError(null);
    task()
      .then(() => void Haptics.notificationAsync(feedback).catch(() => undefined))
      .catch((e: Error) => setActionError(e.message))
      .finally(() => setBusyId(null));
  };
  const onReview = (flag: ModerationFlag, action: "restore" | "confirm") =>
    run(flag.id, () => review.mutateAsync({ flagId: flag.id, body: { action } }), Haptics.NotificationFeedbackType.Success);
  const onSanction = (flag: ModerationFlag, action: "mute" | "unmute" | "ban" | "unban") =>
    run(
      flag.id,
      () => sanction.mutateAsync({ customerId: flag.sender.customerId, body: { action } }).then(() => setBanning(null)),
      action === "ban" ? Haptics.NotificationFeedbackType.Warning : Haptics.NotificationFeedbackType.Success,
    );

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <NavBar title="Safety" subtitle={subtitle} />
      {q.data ? <SettingsCard settings={q.data.settings} /> : null}
      <SegmentedTabs
        items={TABS.map((t) => ({ ...t, count: t.key === "pending" ? counts?.pending : undefined }))}
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
        <ActivityIndicator color={b.brandText} style={{ marginTop: 60 }} accessibilityLabel="Loading flagged messages" />
      ) : (
        <FlatList
          data={q.data?.flags ?? []}
          keyExtractor={(f) => f.id}
          contentContainerStyle={{ padding: GUTTER, gap: 10, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={q.isRefetching} onRefresh={() => void q.refetch()} tintColor={b.brandText} />}
          ListEmptyComponent={
            <ChatEmpty
              icon={tab === "pending" ? "shield-checkmark-outline" : "file-tray-outline"}
              title={tab === "pending" ? "Nothing to review" : tab === "confirmed" ? "Nothing kept hidden" : "No false alarms"}
              body={tab === "pending" ? "Messages the bot hides for inviting members elsewhere show up here." : undefined}
            />
          }
          renderItem={({ item }) => (
            <FlagCard
              flag={item}
              busy={busyId === item.id}
              onReview={(action) => onReview(item, action)}
              onMute={(mute) => onSanction(item, mute ? "mute" : "unmute")}
              onBan={() => setBanning(item)}
            />
          )}
        />
      )}
      <BanSheet
        flag={banning}
        busy={!!banning && busyId === banning.id}
        onClose={() => setBanning(null)}
        onConfirm={() => banning && onSanction(banning, banning.sender.banned ? "unban" : "ban")}
      />
    </View>
  );
}
