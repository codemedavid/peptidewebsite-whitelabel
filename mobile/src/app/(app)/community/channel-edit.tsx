import { ActivityIndicator, View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { ChatButton, ChatEmpty } from "@/features/community/components/ChatKit";
import { ChannelForm } from "@/features/community/components/ManageForms";
import { useChannelDetail } from "@/features/community/hooks/useInbox";
import { CHAT } from "@/features/community/theme";

export default function EditChannelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const q = useChannelDetail(id);
  if (q.isPending) return <View style={{ flex: 1, backgroundColor: CHAT.canvas }}><ActivityIndicator style={{ marginTop: 60 }} accessibilityLabel="Loading" /></View>;
  if (!q.data) {
    return <ChatEmpty icon="alert-circle-outline" title="Channel not found" body={q.error?.message ?? "It may have been deleted."} action={<ChatButton label="Go back" tone="outline" onPress={() => router.back()} />} />;
  }
  // Keyed so the form starts from this channel's saved values.
  return <ChannelForm key={q.data.channel.id} channel={q.data.channel} />;
}
