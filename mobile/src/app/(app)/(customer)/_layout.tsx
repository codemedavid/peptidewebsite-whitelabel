import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCommunityAccess, useUnreadChats } from "@/features/community/hooks/useInbox";
import { CHAT, INTER, useChatBrand } from "@/features/community/theme";
import { cartCount } from "@/features/shop/lib/cart";
import { useShop } from "@/features/shop/ShopProvider";
import type { IconName } from "@/ui/primitives";

function tabIcon(name: IconName, active: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : name} size={24} color={color} />;
  };
}

/**
 * The customer app: Chats (approved members only) · Shop · Orders · Me.
 * Anyone not approved yet lands on Me, which shows their membership status.
 */
export default function CustomerTabsLayout() {
  const b = useChatBrand();
  const access = useCommunityAccess();
  const unread = useUnreadChats();
  const inCart = cartCount(useShop().lines);

  return (
    <Tabs
      initialRouteName={access.customerChatsTab ? "community" : "me"}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: b.brandText,
        tabBarInactiveTintColor: CHAT.inkMuted,
        tabBarStyle: { backgroundColor: CHAT.surface, borderTopColor: CHAT.hairline },
        tabBarLabelStyle: { fontSize: 11, fontFamily: INTER.semibold },
        sceneStyle: { backgroundColor: CHAT.surface },
        tabBarBadgeStyle: { backgroundColor: b.brand, color: b.onBrand, fontFamily: INTER.bold, fontSize: 11 },
      }}
    >
      <Tabs.Protected guard={access.customerChatsTab}>
        <Tabs.Screen
          name="community"
          options={{ title: "Chats", tabBarIcon: tabIcon("chatbubbles-outline", "chatbubbles"), tabBarBadge: unread > 0 ? (unread > 99 ? "99+" : unread) : undefined }}
        />
      </Tabs.Protected>
      <Tabs.Screen
        name="shop"
        options={{
          title: "Shop",
          tabBarIcon: tabIcon("storefront-outline", "storefront"),
          tabBarBadge: inCart > 0 ? (inCart > 99 ? "99+" : inCart) : undefined,
          tabBarAccessibilityLabel: inCart > 0 ? `Shop, ${inCart} in cart` : "Shop",
        }}
      />
      <Tabs.Screen name="my-orders" options={{ title: "Orders", tabBarIcon: tabIcon("receipt-outline", "receipt") }} />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: tabIcon("person-circle-outline", "person-circle") }} />
    </Tabs>
  );
}
