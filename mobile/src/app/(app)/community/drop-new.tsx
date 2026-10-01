import { useLocalSearchParams } from "expo-router";
import { DropForm } from "@/features/community/components/DropForm";

export default function NewDropRoute() {
  const { channel } = useLocalSearchParams<{ channel?: string }>();
  return <DropForm initialChannel={channel} />;
}
