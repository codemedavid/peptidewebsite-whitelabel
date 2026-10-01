import { useLocalSearchParams } from "expo-router";
import { TopicForm } from "@/features/community/components/ManageForms";
import { useChannelDetail } from "@/features/community/hooks/useInbox";

export default function NewTopicRoute() {
  const { channel } = useLocalSearchParams<{ channel: string }>();
  const q = useChannelDetail(channel);
  return <TopicForm channelId={channel} channelName={q.data ? `${q.data.channel.emoji} ${q.data.channel.name}` : undefined} />;
}
