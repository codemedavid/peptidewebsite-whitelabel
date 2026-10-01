import { useSignedIn } from "@/auth/SessionProvider";
import { BusinessSwitch } from "@/features/community/components/ViewSwitch";
import { ShopHome } from "@/features/shop/components/ShopHome";
import { ShopPreviewProvider } from "@/features/shop/ShopProvider";

/**
 * Community view: the store's products, as members see them in their Shop
 * tab — the read-only preview (same as "View your store"), one tap from chats.
 */
export default function CommunityViewStore() {
  const { me, scope } = useSignedIn();
  return (
    <ShopPreviewProvider slug={me.store.slug} scope={scope}>
      <ShopHome asTab headerRight={<BusinessSwitch />} />
    </ShopPreviewProvider>
  );
}
