import { useLocalSearchParams } from "expo-router";
import { useSignedIn } from "@/auth/SessionProvider";
import { ProductDetail } from "@/features/shop/components/ProductDetail";
import { ShopPreviewProvider } from "@/features/shop/ShopProvider";

/** One product in the store team's read-only store preview. */
export default function StorefrontProduct() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { me, scope } = useSignedIn();
  return (
    <ShopPreviewProvider slug={me.store.slug} scope={scope}>
      <ProductDetail id={String(id ?? "")} />
    </ShopPreviewProvider>
  );
}
