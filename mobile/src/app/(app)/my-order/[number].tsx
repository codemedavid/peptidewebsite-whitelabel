import { useLocalSearchParams } from "expo-router";
import { MyOrderDetail } from "@/features/shop/components/MyOrderDetail";

export default function MyOrderScreen() {
  const { number } = useLocalSearchParams<{ number: string }>();
  return <MyOrderDetail number={String(number ?? "")} />;
}
