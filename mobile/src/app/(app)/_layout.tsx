import { useEffect } from "react";
import { View } from "react-native";
import { router, Stack } from "expo-router";
import { useSignedIn } from "@/auth/SessionProvider";
import { communityAccess } from "@/features/community/lib/access";
import { useRestoreView } from "@/features/community/useAppView";
import { usePrefetchAdmin } from "@/features/admin/usePrefetchAdmin";
import { useShop } from "@/features/shop/ShopProvider";
import { hasBeenAsked, rebindIfGranted } from "@/notifications/push";
import { LiveOrders } from "@/notifications/LiveOrders";
import { useNotificationRouting } from "@/notifications/useNotificationRouting";
import { useTheme } from "@/theme/ThemeProvider";

/** Everything behind sign-in. Screens here only ever render the signed-in store. */
export default function AppLayout() {
  const t = useTheme();
  const { me, scope } = useSignedIn();
  useNotificationRouting(true);
  usePrefetchAdmin();
  useRestoreView();

  const admin = me.mode === "admin";
  const community = communityAccess(me);
  // Anyone who gets pushes: admins who handle orders, and community members
  // (DMs + drops). Only order handlers get new-order alerts.
  const wantsPush = me.can.orders || community.inCommunity;

  // After each sign-in: re-bind push on a phone that already allowed it, or
  // offer it once to anyone who handles orders (the explainer is about
  // orders; members turn message alerts on from Me).
  useEffect(() => {
    if (!wantsPush) return;
    void (async () => {
      if (await hasBeenAsked()) await rebindIfGranted({ newOrders: me.can.orders });
      else if (me.can.orders) router.push("/notifications");
    })();
  }, [scope, wantsPush, me.can.orders]);

  // A guest who tapped Checkout and then signed in continues at their cart.
  const shop = useShop();
  useEffect(() => {
    if (!admin && shop.takeResume()) router.push("/cart");
    // Once per sign-in.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  const header = {
    headerStyle: { backgroundColor: t.brand.headerBackground },
    headerTintColor: t.brand.headerText,
    headerTitleStyle: { color: t.brand.headerText, fontFamily: t.font.sansSemi },
    headerShadowVisible: false,
    headerBackButtonDisplayMode: "minimal" as const,
    contentStyle: { backgroundColor: t.colors.bg },
  };
  const sheet = {
    presentation: "formSheet" as const,
    sheetGrabberVisible: true,
    sheetCornerRadius: 24,
    headerShown: false,
    contentStyle: { backgroundColor: t.colors.surface },
  };

  return (
    <View style={{ flex: 1 }}>
    <Stack screenOptions={header}>
      {/* The store admin (owner / staff). */}
      <Stack.Protected guard={admin}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false, animation: "fade" }} />
        <Stack.Screen name="order/[id]/index" options={{ title: "" }} />
        <Stack.Screen name="order/[id]/status" options={{ ...sheet, sheetAllowedDetents: [0.7, 1] }} />
        <Stack.Screen name="order/[id]/tracking" options={{ ...sheet, sheetAllowedDetents: [0.75, 1] }} />
        <Stack.Screen
          name="order/[id]/proof"
          options={{ presentation: "fullScreenModal", headerShown: false, contentStyle: { backgroundColor: "#000" } }}
        />
        <Stack.Screen name="notifications" options={{ presentation: "modal", headerShown: false }} />
        <Stack.Screen name="password" options={{ title: "Change password" }} />
        <Stack.Screen name="profile" options={{ title: "Your profile" }} />
        <Stack.Screen name="customers" options={{ title: "Customers" }} />
        <Stack.Screen name="customer/[key]" options={{ title: "" }} />
        {/* Native store-management screens (titles set in each screen). */}
        <Stack.Screen name="manage/products" />
        <Stack.Screen name="manage/product-edit" />
        <Stack.Screen name="manage/categories" />
        <Stack.Screen name="manage/sort-categories" />
        <Stack.Screen name="manage/currency" />
        <Stack.Screen name="manage/store-status" />
        <Stack.Screen name="manage/payments" />
        <Stack.Screen name="manage/shipping" />
        <Stack.Screen name="manage/couriers" />
        <Stack.Screen name="manage/fee" />
        <Stack.Screen name="manage/promo" />
        <Stack.Screen name="manage/order-trash" />
        <Stack.Screen name="manage/customer-accounts" />
        <Stack.Screen name="manage/banner" />
        <Stack.Screen name="manage/hero" />
        <Stack.Screen name="manage/faq" />
        <Stack.Screen name="manage/lab" />
        <Stack.Screen name="manage/protocols" />
        <Stack.Screen name="manage/reviews" />
        <Stack.Screen name="manage/card-studio" />
        <Stack.Screen name="manage/notice" />
        <Stack.Screen name="manage/track-note" />
        <Stack.Screen name="manage/notify" />
        <Stack.Screen name="manage/checkout-rules" />
        <Stack.Screen name="manage/access-code" />
        <Stack.Screen name="manage/order-ratio" />
        <Stack.Screen name="manage/group-buys" />
        <Stack.Screen name="manage/group-buys-detail" />
        <Stack.Screen name="manage/reseller" />
        <Stack.Screen name="manage/staff" />
        <Stack.Screen name="manage/billing" />
        <Stack.Screen name="manage/export" />
        <Stack.Screen name="manage/upgrade" />
        {/* The store as shoppers see it — the native shop, read-only. */}
        <Stack.Screen name="storefront" options={{ title: "Your store" }} />
        <Stack.Screen name="storefront-product/[id]" options={{ title: "" }} />
      </Stack.Protected>

      {/* The customer app (docs/mobile-admin/COMMUNITY.md). */}
      <Stack.Protected guard={!admin}>
        <Stack.Screen name="(customer)" options={{ headerShown: false }} />
        {/* The in-app shop (docs/mobile-admin/SHOP.md). */}
        <Stack.Screen name="product/[id]" options={{ title: "" }} />
        <Stack.Screen name="cart" options={{ title: "Cart" }} />
        <Stack.Screen name="checkout" options={{ title: "Checkout" }} />
        <Stack.Screen name="order-placed" options={{ headerShown: false, gestureEnabled: false }} />
        <Stack.Screen name="my-order/[number]" options={{ title: "" }} />
      </Stack.Protected>

      {/* Community — approved members and moderators. Chat screens draw their own bars. */}
      <Stack.Protected guard={community.inCommunity}>
        <Stack.Screen name="community/channel/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="community/topic/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="community/dm/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="community/media/[type]/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="community/topic-new" options={{ presentation: "modal", headerShown: false }} />
        <Stack.Screen name="community/topic-edit" options={{ presentation: "modal", headerShown: false }} />
      </Stack.Protected>
      {/* The admin's community view (Business ⇄ Community switch). */}
      <Stack.Protected guard={community.adminChatsTab}>
        <Stack.Screen name="community-view" options={{ headerShown: false, animation: "fade" }} />
      </Stack.Protected>
      <Stack.Protected guard={community.moderator}>
        <Stack.Screen name="community/channel-new" options={{ presentation: "modal", headerShown: false }} />
        <Stack.Screen name="community/channel-edit" options={{ presentation: "modal", headerShown: false }} />
        <Stack.Screen name="community/drop-new" options={{ presentation: "modal", headerShown: false }} />
        <Stack.Screen name="community/members" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
    {me.can.orders ? <LiveOrders /> : null}
    </View>
  );
}
