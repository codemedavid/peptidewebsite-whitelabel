import { useState } from "react";
import { ActivityIndicator, Alert, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useBroadcastGroupBuy, useLiveGroupBuy } from "../hooks/useCommunityData";
import { useInbox } from "../hooks/useInbox";
import { pluralize } from "../lib/format";
import { newClientId } from "../lib/messages";
import { CHAT, RADII, useChatBrand } from "../theme";
import { ChatText } from "./ChatText";
import { ChatButton, ChatEmpty, Chip } from "./ChatKit";
import { Field, FormCard } from "./Form";
import { GroupBuyChatCard } from "./GroupBuyChatCard";
import { ModalHeader } from "./Headers";

const NOTE_MAX = 500;
const SUGGESTIONS = ["New group buy is open! 🎉", "Slots are filling fast", "Last call — closing soon"];

/**
 * "Send to everyone": the live round's card lands in each chosen channel's
 * General topic and every member gets one push. One clientId per form, so a
 * retry after a dropped connection never posts twice.
 */
export function GroupBuyBroadcastForm() {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const inbox = useInbox();
  const live = useLiveGroupBuy();
  const send = useBroadcastGroupBuy();
  const [clientId] = useState(newClientId);
  const channels = inbox.data?.channels ?? [];
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = every channel
  const [note, setNote] = useState("");
  const chosen = picked ?? new Set(channels.map((c) => c.id));
  const round = live.data?.groupBuy ?? null;
  const open = round?.status === "open";

  const toggle = (id: string) => {
    const next = new Set(chosen);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const submit = () => {
    const channelIds = channels.filter((c) => chosen.has(c.id)).map((c) => c.id);
    if (!round || channelIds.length === 0) return;
    Alert.alert(`Send ${round.name} to everyone?`, `It posts in ${pluralize(channelIds.length, "channel")} and notifies every member.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send",
        onPress: () =>
          send.mutate(
            { clientId, channelIds, note: note.trim() },
            {
              onSuccess: (res) => {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
                const first = res.topicIds[0];
                if (first) router.replace({ pathname: "/community/topic/[id]", params: { id: first } });
                else router.back();
              },
              onError: (e) => Alert.alert("Couldn't send it", e.message),
            },
          ),
      },
    ]);
  };

  if (live.isPending || inbox.isPending) {
    return (
      <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
        <ModalHeader title="Send the group buy" eyebrow="To everyone" />
        <ActivityIndicator color={b.brandText} style={{ marginTop: 40 }} accessibilityLabel="Loading" />
      </View>
    );
  }

  if (!round || !open) {
    return (
      <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
        <ModalHeader title="Send the group buy" eyebrow="To everyone" />
        <ChatEmpty
          icon="people-outline"
          title={round ? "Ordering is paused" : "No group buy is open"}
          body={round ? "Turn ordering back on for this round, then send it to the community." : "Start a round in Group Buys, then come back to announce it."}
          action={<ChatButton label="Open Group Buys" tone="outline" onPress={() => router.replace("/manage/group-buys")} />}
        />
      </View>
    );
  }

  const count = channels.filter((c) => chosen.has(c.id)).length;
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <ModalHeader title="Send the group buy" eyebrow="To everyone in the community" />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 120 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: "center", gap: 10 }}>
          <ChatText variant="overline" style={{ alignSelf: "flex-start", marginLeft: 4 }}>
            Preview · how members see it
          </ChatText>
          <View pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ backgroundColor: CHAT.surface, borderRadius: RADII.lg, padding: 4 }}>
            <GroupBuyChatCard round={round} />
            {note.trim() ? (
              <ChatText style={{ fontSize: 15, lineHeight: 21, color: CHAT.ink, paddingHorizontal: 8, paddingVertical: 6, maxWidth: 268 }}>{note.trim()}</ChatText>
            ) : null}
          </View>
        </View>

        <FormCard title="Message">
          <Field label="Caption" value={note} onChangeText={setNote} maxLength={NOTE_MAX} counter multiline placeholder="Say why now (optional)" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {SUGGESTIONS.map((s) => (
              <Chip key={s} icon="sparkles" label={s} onPress={() => setNote(s)} />
            ))}
          </View>
        </FormCard>

        <FormCard title="Send to">
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {channels.map((c) => (
              <Chip key={c.id} label={`${c.emoji} ${c.name}`} icon={chosen.has(c.id) ? "checkmark-circle" : undefined} active={chosen.has(c.id)} onPress={() => toggle(c.id)} />
            ))}
          </View>
          {channels.length ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Chip label="All channels" onPress={() => setPicked(null)} />
              <Chip label="None" onPress={() => setPicked(new Set())} />
            </View>
          ) : (
            <ChatText variant="footnote">Create a channel first — the group buy is posted in one.</ChatText>
          )}
        </FormCard>

        <View style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", padding: 12, borderRadius: RADII.md, backgroundColor: b.brandTint }}>
          <Ionicons name="notifications" size={18} color={b.brandText} style={{ marginTop: 1 }} />
          <ChatText variant="footnote" style={{ flex: 1, color: CHAT.inkSoft }}>
            Every member gets one push notification. The card stays live — slots and the countdown update on their own, and it reads “ended” when the round closes.
          </ChatText>
        </View>
      </ScrollView>

      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, padding: 16, paddingBottom: insets.bottom + 12, backgroundColor: CHAT.surface, borderTopWidth: 1, borderTopColor: CHAT.hairline }}>
        <ChatButton
          label={count ? `Send to ${pluralize(count, "channel")}` : "Pick a channel"}
          size="lg"
          tone="dark"
          icon="megaphone"
          loading={send.isPending}
          disabled={count === 0}
          onPress={submit}
        />
      </View>
    </KeyboardAvoidingView>
  );
}
