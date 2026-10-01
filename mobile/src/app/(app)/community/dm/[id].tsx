import { useLocalSearchParams } from "expo-router";
import { ThreadScreen } from "@/features/community/components/ThreadScreen";

/** A private one-to-one conversation. */
export default function DmRoute() {
  const { id, q, focus } = useLocalSearchParams<{ id: string; q?: string; focus?: string }>();
  return <ThreadScreen key={id} type="dm" id={id} q={q} focus={focus} />;
}
