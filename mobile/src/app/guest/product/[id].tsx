import { useLocalSearchParams } from "expo-router";
import { ProductDetail } from "@/features/shop/components/ProductDetail";

export default function GuestProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductDetail id={String(id ?? "")} />;
}
