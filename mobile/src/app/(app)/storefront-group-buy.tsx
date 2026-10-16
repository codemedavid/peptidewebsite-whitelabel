import { useSignedIn } from "@/auth/SessionProvider";
import { GroupBuyScreen } from "@/features/shop/components/group-buy/GroupBuyScreen";
import { ShopPreviewProvider } from "@/features/shop/ShopProvider";

/** The live group-buy round in the store team's read-only store preview. */
export default function StorefrontGroupBuy() {
  const { me, scope } = useSignedIn();
  return (
    <ShopPreviewProvider slug={me.store.slug} scope={scope}>
      <GroupBuyScreen />
    </ShopPreviewProvider>
  );
}
