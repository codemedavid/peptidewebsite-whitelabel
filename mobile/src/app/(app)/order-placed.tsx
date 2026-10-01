import { useLocalSearchParams } from "expo-router";
import { OrderPlaced } from "@/features/shop/components/OrderPlaced";

export default function OrderPlacedScreen() {
  const { number } = useLocalSearchParams<{ number: string }>();
  return <OrderPlaced number={String(number ?? "")} />;
}
