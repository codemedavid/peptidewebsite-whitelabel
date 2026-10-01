import { Pressable, StyleSheet, View, type ColorValue } from "react-native";
import { router, Tabs } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { dashboardApi, qk } from "@/api/endpoints";
import { useSignedIn } from "@/auth/SessionProvider";
import { useCommunityAccess, useUnreadChats } from "@/features/community/hooks/useInbox";
import { useSwitchView } from "@/features/community/useAppView";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE, TOUCH } from "@/theme/tokens";
import { BrandMark } from "@/ui/BrandMark";
import { AppText, type IconName } from "@/ui/primitives";

function tabIcon(name: IconName, active: IconName) {
  return function TabIcon({ color, focused }: { color: ColorValue; focused: boolean }) {
    return <Ionicons name={focused ? active : name} size={24} color={color} />;
  };
}

/** The store's mark + name, in its own heading typeface, on its own header bar. */
function StoreTitle() {
  const t = useTheme();
  return (
    <View style={styles.title} accessibilityRole="header">
      <BrandMark size={30} />
      <AppText variant="heading" brandFont color={t.brand.headerText} numberOfLines={1} style={{ maxWidth: 180 }}>
        {t.brand.name}
      </AppText>
    </View>
  );
}

/** Bell → the New orders queue, with the live count. */
function NewOrdersBell() {
  const t = useTheme();
  const { scope, me } = useSignedIn();
  const { data } = useQuery({
    queryKey: qk.dashboard(scope),
    queryFn: dashboardApi.get,
    enabled: me.can.orders,
  });
  if (!me.can.orders) return null;
  const count = data?.queue.newOrders ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? `${count} new orders` : "No new orders"}
      accessibilityHint="Shows new orders"
      hitSlop={6}
      onPress={() => router.navigate({ pathname: "/orders", params: { filter: "new", at: String(Date.now()) } })}
      style={styles.bell}
    >
      <Ionicons name={count ? "notifications" : "notifications-outline"} size={24} color={t.brand.headerText} />
      {count ? (
        <View style={[styles.dot, { backgroundColor: t.brand.primary, borderColor: t.brand.headerBackground }]}>
          <AppText variant="caption" color={t.brand.onPrimary} style={{ fontSize: 11, lineHeight: 14, fontWeight: "700" }}>
            {count > 9 ? "9+" : String(count)}
          </AppText>
        </View>
      ) : null}
    </Pressable>
  );
}

/** Storefront → the store's website as shoppers see it, inside the app. */
function ViewStoreButton() {
  const t = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="View your store"
      accessibilityHint="Opens your storefront as shoppers see it"
      hitSlop={6}
      onPress={() => router.push("/storefront")}
      style={styles.headerButton}
    >
      <Ionicons name="storefront-outline" size={23} color={t.brand.headerText} />
    </Pressable>
  );
}

/** Community → the community view (Chats · Members · Profile). The dot = something waiting. */
function CommunityViewButton() {
  const t = useTheme();
  const { me } = useSignedIn();
  const switchView = useSwitchView();
  const waiting = useUnreadChats() + me.community.pendingApplications;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={waiting ? "Community view, new activity" : "Community view"}
      accessibilityHint="Switches the app to your community"
      hitSlop={6}
      onPress={() => switchView("community")}
      style={styles.headerButton}
    >
      <Ionicons name="people-circle-outline" size={26} color={t.brand.headerText} />
      {waiting ? <View style={[styles.activity, { backgroundColor: t.brand.primary, borderColor: t.brand.headerBackground }]} /> : null}
    </Pressable>
  );
}

/** Header actions on every admin tab. */
function HeaderActions() {
  const community = useCommunityAccess();
  return (
    <View style={styles.headerActions}>
      {community.adminChatsTab ? <CommunityViewButton /> : null}
      <ViewStoreButton />
      <NewOrdersBell />
    </View>
  );
}

export default function TabsLayout() {
  const t = useTheme();
  const { me } = useSignedIn();
  const catalog = me.can.products || me.can.inventory;
  const community = useCommunityAccess();
  const unreadChats = useUnreadChats();

  return (
    <Tabs
      screenOptions={{
        // The website's header bar (its own colours, or its surface when unset).
        headerStyle: { backgroundColor: t.brand.headerBackground },
        headerShadowVisible: false,
        headerTitleAlign: "left",
        headerTitle: () => <StoreTitle />,
        headerRight: () => <HeaderActions />,
        tabBarActiveTintColor: t.brand.link,
        tabBarInactiveTintColor: t.colors.textFaint,
        tabBarStyle: { backgroundColor: t.colors.surface, borderTopColor: t.colors.border },
        tabBarLabelStyle: { fontSize: 11, fontFamily: t.font.sansSemi },
        sceneStyle: { backgroundColor: t.colors.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: tabIcon("home-outline", "home") }} />
      <Tabs.Protected guard={me.can.orders}>
        <Tabs.Screen name="orders" options={{ title: "Orders", tabBarIcon: tabIcon("receipt-outline", "receipt") }} />
      </Tabs.Protected>
      <Tabs.Protected guard={me.can.analytics}>
        <Tabs.Screen name="insights" options={{ title: "Insights", tabBarIcon: tabIcon("stats-chart-outline", "stats-chart") }} />
      </Tabs.Protected>
      <Tabs.Protected guard={catalog}>
        <Tabs.Screen name="products" options={{ title: "Products", tabBarIcon: tabIcon("pricetags-outline", "pricetags") }} />
      </Tabs.Protected>
      {/* Community chats — moderators of a store with the community on. The chat list draws its own header. */}
      <Tabs.Protected guard={community.adminChatsTab}>
        <Tabs.Screen
          name="chats"
          options={{
            title: "Chats",
            headerShown: false,
            tabBarIcon: tabIcon("chatbubbles-outline", "chatbubbles"),
            tabBarBadge: unreadChats > 0 ? (unreadChats > 99 ? "99+" : unreadChats) : undefined,
            tabBarBadgeStyle: { backgroundColor: t.brand.primary, color: t.brand.onPrimary, fontSize: 11 },
          }}
        />
      </Tabs.Protected>
      <Tabs.Screen name="more" options={{ title: "More", tabBarIcon: tabIcon("ellipsis-horizontal-circle-outline", "ellipsis-horizontal-circle") }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  title: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  bell: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center", marginRight: SPACE.xs },
  headerActions: { flexDirection: "row", alignItems: "center" },
  headerButton: { width: TOUCH, height: TOUCH, alignItems: "center", justifyContent: "center" },
  activity: { position: "absolute", top: 10, right: 9, width: 11, height: 11, borderRadius: 6, borderWidth: 2 },
  dot: {
    position: "absolute",
    top: 6,
    right: 4,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 4,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
});
