// Create / edit a channel or a topic (modals).
import { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { KeyboardAvoidingView } from "react-native-keyboard-controller";
import { router } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { CommunityChannel, CommunityTopic } from "@contract";
import { useChannelMutations, useTopicMutations } from "../hooks/useCommunityData";
import { pickImage, PickError, uploadDraft } from "../hooks/usePickers";
import type { ImageDraft } from "../lib/attachments";
import { hueFromString } from "../lib/color";
import { CHAT } from "../theme";
import { EmojiAvatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton } from "./ChatKit";
import { EmojiGrid, Field, FormCard, RadioOption } from "./Form";
import { ModalHeader } from "./Headers";

const CHANNEL_EMOJIS = ["💬", "🧬", "🛒", "✨", "⚖️", "💪", "🧠", "🩹", "📣", "☕", "🔬", "🌸"];
const TOPIC_EMOJIS = ["#", "🧵", "❓", "📦", "🔁", "🧪", "🌱", "⚖️", "💧", "📸", "🚚", "🎉"];
const NAME_MAX = 60;
const DESCRIPTION_MAX = 200;
const withCurrent = (list: string[], current: string) => (list.includes(current) ? list : [current, ...list]);

/** The picture: saved url, a new local pick, or removed. */
function usePicture(initial: string | null) {
  const [draft, setDraft] = useState<ImageDraft | null>(null);
  const [url, setUrl] = useState<string | null>(initial);
  return {
    preview: draft?.uri ?? url,
    pick: async () => {
      try {
        const d = await pickImage("library");
        if (d) setDraft(d);
      } catch (e) {
        Alert.alert("Couldn't use that photo", e instanceof PickError ? e.message : "Try a different photo.");
      }
    },
    remove: () => {
      setDraft(null);
      setUrl(null);
    },
    /** Upload a new pick, else keep the saved url. */
    resolve: async () => (draft ? (await uploadDraft(draft)).url : url),
  };
}

function PictureField({ picture, busy }: { picture: ReturnType<typeof usePicture>; busy: boolean }) {
  return (
    <FormCard title="Picture">
      <ChatText variant="footnote">{picture.preview ? "Shown instead of the emoji everywhere." : "Optional. Without a picture, the emoji is used."}</ChatText>
      <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
        <ChatButton label={picture.preview ? "Replace photo" : "Choose photo"} tone="tinted" size="sm" disabled={busy} onPress={() => void picture.pick()} />
        {picture.preview ? <ChatButton label="Remove" tone="ghost" size="sm" disabled={busy} onPress={picture.remove} /> : null}
      </View>
    </FormCard>
  );
}

function FormShell({ title, eyebrow, action, children }: { title: string; eyebrow?: string; action: React.ReactNode; children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView behavior="padding" style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <ModalHeader title={title} eyebrow={eyebrow} action={action} />
      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: insets.bottom + 40 }} keyboardShouldPersistTaps="handled">
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** New channel (channel undefined) or edit one. */
export function ChannelForm({ channel }: { channel?: CommunityChannel }) {
  const m = useChannelMutations();
  const [name, setName] = useState(channel?.name ?? "");
  const [description, setDescription] = useState(channel?.description ?? "");
  const [emoji, setEmoji] = useState(channel?.emoji ?? "💬");
  const [postRole, setPostRole] = useState<"everyone" | "admins">(channel?.postRole ?? "everyone");
  const picture = usePicture(channel?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length >= 2;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), description: description.trim(), emoji, imageUrl: await picture.resolve(), postRole };
      if (channel) {
        await m.update.mutateAsync({ id: channel.id, body });
        router.back();
      } else {
        const created = await m.create.mutateAsync(body);
        router.replace({ pathname: "/community/topic/[id]", params: { id: created.generalTopicId } });
      }
    } catch (e) {
      Alert.alert("Couldn't save the channel", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell title={channel ? "Edit channel" : "New channel"} action={<ChatButton label={channel ? "Save" : "Create"} size="sm" loading={busy} disabled={!valid} onPress={() => void save()} />}>
      <View style={{ alignItems: "center", gap: 8, paddingTop: 4 }}>
        <EmojiAvatar emoji={emoji} imageUrl={picture.preview} hue={hueFromString(channel?.id ?? (name || "channel"))} size={84} broadcast={postRole === "admins"} />
        <ChatText variant="title" numberOfLines={1} color={name ? CHAT.ink : CHAT.inkFaint}>
          {name.trim() || "Channel name"}
        </ChatText>
        <ChatText variant="footnote">{postRole === "admins" ? "Announcements · the store posts" : "Group · everyone can post"}</ChatText>
      </View>
      <FormCard title="Details">
        <Field label="Name" value={name} onChangeText={setName} maxLength={NAME_MAX} counter placeholder="e.g. Recovery & healing" autoFocus={!channel} />
        <Field label="Description" value={description} onChangeText={setDescription} maxLength={DESCRIPTION_MAX} multiline placeholder="What belongs here? (optional)" />
      </FormCard>
      <FormCard title="Icon">
        <EmojiGrid options={withCurrent(CHANNEL_EMOJIS, emoji)} value={emoji} onChange={setEmoji} />
      </FormCard>
      <PictureField picture={picture} busy={busy} />
      <FormCard title="Who can post">
        <RadioOption icon="people" title="Everyone" body="A group chat. Members can start topics and reply." active={postRole === "everyone"} onPress={() => setPostRole("everyone")} />
        <RadioOption icon="megaphone" title="Store team only" body="An announcements channel. Members read." active={postRole === "admins"} onPress={() => setPostRole("admins")} />
      </FormCard>
      {channel ? (
        <ChatButton
          label="Delete channel"
          tone="danger"
          disabled={busy}
          onPress={() =>
            Alert.alert(`Delete ${channel.name}?`, "Every topic and message in it is removed for everyone. This can't be undone.", [
              { text: "Cancel", style: "cancel" },
              {
                text: "Delete",
                style: "destructive",
                onPress: () => m.remove.mutate(channel.id, { onSuccess: () => router.dismissAll(), onError: (e) => Alert.alert("Couldn't delete", e.message) }),
              },
            ])
          }
        />
      ) : null}
    </FormShell>
  );
}

/** New topic in a channel, or edit one. */
export function TopicForm({ channelId, channelName, topic }: { channelId: string; channelName?: string; topic?: CommunityTopic }) {
  const m = useTopicMutations();
  const [name, setName] = useState(topic?.name ?? "");
  const [emoji, setEmoji] = useState(topic?.emoji ?? "🧵");
  const picture = usePicture(topic?.imageUrl ?? null);
  const [busy, setBusy] = useState(false);
  const valid = name.trim().length >= 2;

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    try {
      const body = { name: name.trim(), emoji, imageUrl: await picture.resolve() };
      if (topic) {
        await m.update.mutateAsync({ id: topic.id, body });
        router.back();
      } else {
        const created = await m.create.mutateAsync({ channelId, body });
        router.replace({ pathname: "/community/topic/[id]", params: { id: created.id } });
      }
    } catch (e) {
      Alert.alert("Couldn't save the topic", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <FormShell
      title={topic ? "Edit topic" : "New topic"}
      eyebrow={channelName}
      action={<ChatButton label={topic ? "Save" : "Create"} size="sm" loading={busy} disabled={!valid} onPress={() => void save()} />}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: CHAT.surface, borderRadius: 16, padding: 12 }}>
        <EmojiAvatar emoji={emoji} imageUrl={picture.preview} hue={hueFromString(topic?.id ?? (name || "topic"))} size={52} square />
        <View style={{ flex: 1 }}>
          <ChatText variant="headline" numberOfLines={1} color={name ? CHAT.ink : CHAT.inkFaint}>
            {name.trim() || "Topic name"}
          </ChatText>
          <ChatText variant="footnote">{`A focused thread inside ${channelName ?? "this channel"}`}</ChatText>
        </View>
      </View>
      <FormCard title="Topic name">
        <Field value={name} onChangeText={setName} maxLength={NAME_MAX} counter autoFocus={!topic} placeholder="e.g. Dosing questions" accessibilityLabel="Topic name" />
      </FormCard>
      <FormCard title="Icon">
        <EmojiGrid options={withCurrent(TOPIC_EMOJIS, emoji)} value={emoji} onChange={setEmoji} />
      </FormCard>
      <PictureField picture={picture} busy={busy} />
    </FormShell>
  );
}
