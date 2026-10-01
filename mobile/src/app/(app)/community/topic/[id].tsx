import { useLocalSearchParams } from "expo-router";
import { ThreadScreen } from "@/features/community/components/ThreadScreen";

/** A channel topic. `q` + `focus` arrive from a message result in Chats search. */
export default function TopicRoute() {
  const { id, q, focus } = useLocalSearchParams<{ id: string; q?: string; focus?: string }>();
  return <ThreadScreen key={id} type="topic" id={id} q={q} focus={focus} />;
}
