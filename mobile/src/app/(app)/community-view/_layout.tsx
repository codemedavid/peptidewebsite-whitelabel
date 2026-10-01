import type { ColorValue } from "react-native";
import { Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useSignedIn } from "@/auth/SessionProvider";
import { useUnreadChats } from "@/features/community/hooks/useInbox";
import { CHAT, INTER, useChatBrand } from "@/features/community/theme";
import type { IconName } from "@/ui/primitives";

function tabIcon(name: IconName, active: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : name} size={24} color={color} />;
  };
}

const badge = (n: number) => (n > 0 ? (n > 99 ? "99+" : n) : undefined);

/**
 * The store admin's community view: the community as members live in it
 * (Chats · Store · Members · Profile), in the community's own design. "Business"
 * (top-right on every tab) switches back — see features/community/useAppView.
 */
export default function CommunityViewLayout() {
  const b = useChatBrand();
  const { me } = useSignedIn();
  const unread = useUnreadChats();

  return (
    <Tabs
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
      <Tabs.Screen name="index" options={{ title: "Chats", tabBarIcon: tabIcon("chatbubbles-outline", "chatbubbles"), tabBarBadge: badge(unread) }} />
      <Tabs.Screen name="store" options={{ title: "Store", tabBarIcon: tabIcon("storefront-outline", "storefront") }} />
      <Tabs.Screen
        name="members"
        options={{ title: "Members", tabBarIcon: tabIcon("people-outline", "people"), tabBarBadge: badge(me.community.pendingApplications) }}
      />
      <Tabs.Screen name="profile" options={{ title: "Profile", tabBarIcon: tabIcon("person-circle-outline", "person-circle") }} />
    </Tabs>
  );
}
