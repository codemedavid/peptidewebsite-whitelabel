import { useLocalSearchParams } from "expo-router";
import { ProductDetail } from "@/features/shop/components/ProductDetail";

export default function ProductScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProductDetail id={String(id ?? "")} />;
}
