import { useSignedIn } from "@/auth/SessionProvider";
import { ShopHome } from "@/features/shop/components/ShopHome";
import { ShopPreviewProvider } from "@/features/shop/ShopProvider";

/**
 * "View your store" for the store team — the native shop shoppers use,
 * read-only (features/shop, catalog from /admin/storefront). No web page.
 */
export default function Storefront() {
  const { me, scope } = useSignedIn();
  return (
    <ShopPreviewProvider slug={me.store.slug} scope={scope}>
      <ShopHome />
    </ShopPreviewProvider>
  );
}
