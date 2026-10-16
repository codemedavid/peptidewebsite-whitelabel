import { View, type ColorValue } from "react-native";
import { Tabs } from "expo-router";
import { BottomTabBar, type BottomTabBarProps } from "expo-router/js-tabs";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useCommunityAccess, useUnreadChats } from "@/features/community/hooks/useInbox";
import { CHAT, INTER, useChatBrand } from "@/features/community/theme";
import { cartCount } from "@/features/shop/lib/cart";
import { LiveGroupBuyStrip } from "@/features/shop/components/group-buy/LiveGroupBuyStrip";
import { useShop } from "@/features/shop/ShopProvider";
import type { IconName } from "@/ui/primitives";

function tabIcon(name: IconName, active: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : name} size={24} color={color} />;
  };
}

/** The stock tab bar with the live group-buy strip docked on top (every tab). */
function TabBarWithLiveStrip(props: BottomTabBarProps) {
  return (
    <View>
      <LiveGroupBuyStrip />
      <BottomTabBar {...props} />
    </View>
  );
}

/**
 * The customer app: Chats (approved members only) · Shop · Orders · Me.
 * Anyone not approved yet lands on Me, which shows their membership status.
 * While a group buy is open, a LIVE strip sits above the tab bar on every tab.
 */
export default function CustomerTabsLayout() {
  const b = useChatBrand();
  const access = useCommunityAccess();
  const unread = useUnreadChats();
  const inCart = cartCount(useShop().lines);

  return (
    <Tabs
      initialRouteName={access.customerChatsTab ? "community" : "me"}
      tabBar={TabBarWithLiveStrip}
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
