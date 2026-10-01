import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChatButton, ChatEmpty } from "@/features/community/components/ChatKit";
import { TopicForm } from "@/features/community/components/ManageForms";
import { useChannelDetail } from "@/features/community/hooks/useInbox";
import { CHAT } from "@/features/community/theme";

export default function EditTopicRoute() {
  const { id, channel } = useLocalSearchParams<{ id: string; channel: string }>();
  const q = useChannelDetail(channel);
  const topic = q.data?.topics.find((t) => t.id === id);
  if (q.isPending) return <View style={{ flex: 1, backgroundColor: CHAT.canvas }}><ActivityIndicator style={{ marginTop: 60 }} accessibilityLabel="Loading" /></View>;
  if (!topic) {
    return <ChatEmpty icon="alert-circle-outline" title="Topic not found" body="It may have been deleted." action={<ChatButton label="Go back" tone="outline" onPress={() => router.back()} />} />;
  }
  return <TopicForm key={topic.id} channelId={channel} channelName={q.data ? `${q.data.channel.emoji} ${q.data.channel.name}` : undefined} topic={topic} />;
}
