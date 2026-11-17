import { useLocalSearchParams } from "expo-router";
import { MemberDetailScreen } from "@/features/community/components/MemberDetailScreen";

export default function MemberDetailRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <MemberDetailScreen customerId={typeof id === "string" ? id : ""} />;
}
