import { useLocalSearchParams } from "expo-router";
import { ChannelScreen } from "@/features/community/components/ChannelScreen";

export default function ChannelRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ChannelScreen id={id} />;
}
