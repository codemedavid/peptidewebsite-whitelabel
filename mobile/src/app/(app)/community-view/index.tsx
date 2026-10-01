import { useSignedIn } from "@/auth/SessionProvider";
import { ChatsScreen } from "@/features/community/components/ChatsScreen";
import { BusinessSwitch } from "@/features/community/components/ViewSwitch";
import { ShopPreviewProvider } from "@/features/shop/ShopProvider";

/**
 * Community view: every channel, topic and DM — the admin joins in as the store.
 * The read-only shop preview feeds the "From the shop" row; See all opens the Store tab.
 */
export default function CommunityViewChats() {
  const { me, scope } = useSignedIn();
  return (
    <ShopPreviewProvider slug={me.store.slug} scope={scope}>
      <ChatsScreen headerRight={<BusinessSwitch />} shopHref="/community-view/store" />
    </ShopPreviewProvider>
  );
}
