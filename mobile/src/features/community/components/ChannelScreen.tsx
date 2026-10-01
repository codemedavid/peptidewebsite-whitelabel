import { useCallback } from "react";
import { ActivityIndicator, Alert, FlatList, View } from "react-native";
import { router } from "expo-router";
import type { CommunityTopic } from "@contract";
import { useTopicMutations } from "../hooks/useCommunityData";
import { useChannelDetail } from "../hooks/useInbox";
import { hueFromString } from "../lib/color";
import { pluralize } from "../lib/format";
import { CHAT, GUTTER, useChatBrand } from "../theme";
import { EmojiAvatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { ChatButton, ChatEmpty, Fab, IconButton } from "./ChatKit";
import { TopicRowItem } from "./ChatRows";
import { NavBar } from "./Headers";

/** Long-press on a topic (anyone the server lets manage it): edit or delete. */
function useTopicMenu() {
  const { mutate: removeTopic } = useTopicMutations().remove;
  return useCallback(
    (topic: CommunityTopic) =>
    Alert.alert(topic.name, undefined, [
      { text: "Edit topic", onPress: () => router.push({ pathname: "/community/topic-edit", params: { id: topic.id, channel: topic.channelId } }) },
      ...(topic.canDelete
        ? [
            {
              text: "Delete topic",
              style: "destructive" as const,
              onPress: () =>
                Alert.alert(`Delete ${topic.name}?`, "Its messages are removed for everyone.", [
                  { text: "Cancel", style: "cancel" },
                  { text: "Delete", style: "destructive", onPress: () => removeTopic(topic.id, { onError: (e) => Alert.alert("Couldn't delete", e.message) }) },
                ]),
            },
          ]
        : []),
      { text: "Cancel", style: "cancel" as const },
    ]),
    [removeTopic],
  );
}

/** A Telegram forum: the channel's topics as chat rows. */
export function ChannelScreen({ id }: { id: string }) {
  const b = useChatBrand();
  const q = useChannelDetail(id);
  const menu = useTopicMenu();
  const channel = q.data?.channel;
  const topics = q.data?.topics ?? [];
  const total = topics.reduce((sum, t) => sum + t.messageCount, 0);
  const broadcast = channel?.postRole === "admins";

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.surface }}>
      <NavBar
        title={channel?.name ?? "Channel"}
        subtitle={channel ? `${pluralize(topics.length, "topic")} · ${pluralize(total, "message")}` : undefined}
        leading={channel ? <EmojiAvatar emoji={channel.emoji} imageUrl={channel.imageUrl} hue={hueFromString(channel.id)} size={38} broadcast={broadcast} /> : null}
        right={
          channel?.canManage ? (
            <IconButton name="create-outline" label="Edit channel" onPress={() => router.push({ pathname: "/community/channel-edit", params: { id } })} />
          ) : null
        }
      />
      {q.isPending ? (
        <ActivityIndicator color={b.brandText} style={{ marginTop: 40 }} accessibilityLabel="Loading topics" />
      ) : q.error && !q.data ? (
        <ChatEmpty icon="alert-circle-outline" title="Couldn't open this channel" body={q.error.message} action={<ChatButton label="Try again" tone="outline" onPress={() => void q.refetch()} />} />
      ) : (
        <FlatList
          data={topics}
          keyExtractor={(t) => t.id}
          contentContainerStyle={{ paddingBottom: 110, flexGrow: 1 }}
          ListHeaderComponent={
            channel?.description || broadcast ? (
              <View style={{ padding: GUTTER, gap: 4, backgroundColor: CHAT.surfaceAlt, borderBottomWidth: 1, borderBottomColor: CHAT.hairline }}>
                {broadcast ? (
                  <ChatText variant="overline" color={b.brandText}>
                    Announcements · the store posts
                  </ChatText>
                ) : null}
                {channel?.description ? <ChatText variant="callout">{channel.description}</ChatText> : null}
              </View>
            ) : null
          }
          ListEmptyComponent={<ChatEmpty icon="albums-outline" title="No topics yet" body="Start the first thread in this channel." />}
          renderItem={({ item }) => <TopicRowItem topic={item} onMenu={menu} />}
        />
      )}
      {channel?.canPost ? <Fab icon="add" label="New topic" onPress={() => router.push({ pathname: "/community/topic-new", params: { channel: id } })} /> : null}
    </View>
  );
}
