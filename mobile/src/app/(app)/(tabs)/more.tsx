import { Alert, Pressable, ScrollView, Share, StyleSheet, View } from "react-native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { router, type Href } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { APP_NAME } from "@/config";
import { communityAccess } from "@/features/community/lib/access";
import { useSwitchView } from "@/features/community/useAppView";
import { adminBridge, type AdminMenuItem } from "@/features/admin/bridge";
import { NATIVE_VIEW_ROUTES } from "@/features/admin/native-views";
import { Avatar } from "@/features/community/components/Avatar";
import { useTheme } from "@/theme/ThemeProvider";
import { SPACE } from "@/theme/tokens";
import { BrandMark } from "@/ui/BrandMark";
import { AppText, Card, Divider, Pill, Row, SectionLabel, type IconName } from "@/ui/primitives";

/** Account, settings, and every store-admin section (native or embedded website). */
export default function More() {
  const t = useTheme();
  const { me } = useSignedIn();
  const { signOut } = useSession();
  const switchView = useSwitchView();
  // The store's "get the app" page — opening it links a shopper's app to this store.
  const appLink = `${me.store.websiteUrl}/app`;

  function shareAppLink() {
    void Share.share({
      message: `Shop ${me.store.name} in the app — download it and open our store here: ${appLink}`,
      url: appLink,
    }).catch(() => undefined);
  }

  function confirmSignOut(switching: boolean) {
    Alert.alert(
      switching ? "Switch store?" : "Sign out?",
      switching
        ? `You'll be signed out of ${me.store.name} on this phone and can sign in to another store. Notifications for ${me.store.name} stop here.`
        : `Notifications for ${me.store.name} will stop on this phone.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: switching ? "Switch store" : "Sign out", style: "destructive", onPress: () => void signOut() },
      ],
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Pressable
        onPress={() => router.push("/profile")}
        accessibilityRole="button"
        accessibilityLabel={`${me.account.displayName}, edit your profile`}
        style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
      >
        <Card style={styles.account}>
          <View>
            <Avatar name={me.account.displayName} hue={0} imageUrl={me.account.avatarUrl} size={52} />
            <View style={styles.storeMark}>
              <BrandMark size={22} />
            </View>
          </View>
          <View style={{ flex: 1 }}>
            <AppText variant="heading" brandFont numberOfLines={1}>{me.account.displayName}</AppText>
            <AppText variant="caption" color="muted" numberOfLines={1}>
              {`${me.actor.kind === "owner" ? "Owner" : "Staff"} · ${me.store.name}`}
            </AppText>
          </View>
          <Ionicons name="chevron-forward" size={18} color={t.colors.textFaint} />
        </Card>
      </Pressable>

      {me.can.orders || me.can.analytics ? (
        <>
          <SectionLabel>Business</SectionLabel>
          <Card padded={false}>
            {me.can.orders ? (
              <Row icon="people-outline" label="Customers" detail="Top spenders, regulars and who's gone quiet" onPress={() => router.push("/customers")} />
            ) : null}
            {me.can.orders && me.can.analytics ? <Divider inset={62} /> : null}
            {me.can.analytics ? (
              <Row icon="stats-chart-outline" label="Sales insights" detail="Revenue, trends and best sellers" onPress={() => router.navigate("/insights")} />
            ) : null}
          </Card>
        </>
      ) : null}

      {communityAccess(me).adminChatsTab ? (
        <>
          <SectionLabel>Community</SectionLabel>
          <Card padded={false}>
            <Row
              icon="swap-horizontal-outline"
              label="Switch to community view"
              detail="See and join the community as your members do"
              onPress={() => switchView("community")}
            />
            <Divider inset={62} />
            <Row
              icon="person-add-outline"
              label="Members"
              detail={
                me.community.pendingApplications
                  ? `${me.community.pendingApplications} waiting for review`
                  : me.community.joinMode === "open"
                    ? "Open to everyone · choose who can join"
                    : "Review who joins your community"
              }
              onPress={() => router.push("/community/members")}
              trailing={me.community.pendingApplications ? <Pill tone="warning" size="sm" label={String(me.community.pendingApplications)} /> : undefined}
            />
            <Divider inset={62} />
            <Row icon="add-circle-outline" label="New channel" onPress={() => router.push("/community/channel-new")} />
            <Divider inset={62} />
            <Row icon="flash-outline" label="Broadcast a drop" detail="Pushes to every member" onPress={() => router.push("/community/drop-new")} />
          </Card>
        </>
      ) : null}

      <SectionLabel>Settings</SectionLabel>
      <Card padded={false}>
        {me.can.orders ? (
          <>
            <Row icon="notifications-outline" label="Order notifications" detail="Get told the moment an order comes in" onPress={() => router.push("/notifications")} />
            <Divider inset={62} />
          </>
        ) : null}
        <Row icon="person-circle-outline" label="Edit profile" detail="Photo, name and nickname" onPress={() => router.push("/profile")} />
        <Divider inset={62} />
        <Row icon="key-outline" label="Change password" detail="Also signs out your other phones" onPress={() => router.push("/password")} />
      </Card>

      <ManageStore />

      <SectionLabel>Store</SectionLabel>
      <Card padded={false}>
        <Row icon="globe-outline" label="View your store" detail={me.store.websiteUrl.replace(/^https?:\/\//, "")} onPress={() => router.push("/storefront")} />
        <Divider inset={62} />
        <Row
          icon="share-social-outline"
          label="Share your app link"
          detail="Shoppers who open it land in your store in the app"
          onPress={shareAppLink}
        />
        <Divider inset={62} />
        <Row icon="swap-horizontal-outline" label="Switch store" onPress={() => confirmSignOut(true)} />
        <Divider inset={62} />
        <Row icon="log-out-outline" label="Sign out" onPress={() => confirmSignOut(false)} />
      </Card>

      <Card padded={false} style={styles.danger}>
        <Row
          icon="trash-outline"
          label="Delete account"
          detail={me.actor.kind === "owner" ? "Ask Pepweb to delete your login and store data" : "Ask for your staff login to be deleted"}
          destructive
          onPress={() => router.push("/delete-account")}
        />
      </Card>

      <AppText variant="caption" color="faint" style={styles.version}>
        {`${APP_NAME} ${Constants.expoConfig?.version ?? ""}`}
      </AppText>
    </ScrollView>
  );
}

/** Ionicons per website admin view; anything unlisted gets a generic tool icon. */
const VIEW_ICONS: Record<string, IconName> = {
  orders: "receipt-outline",
  "store-status": "power-outline",
  currency: "cash-outline",
  "add-product": "add-circle-outline",
  products: "cube-outline",
  inv: "file-tray-stacked-outline",
  analytics: "stats-chart-outline",
  categories: "folder-outline",
  "sort-categories": "swap-vertical-outline",
  promo: "pricetag-outline",
  lab: "flask-outline",
  couriers: "bicycle-outline",
  shipping: "location-outline",
  reviews: "star-outline",
  groupbuys: "people-outline",
  groupbuy: "git-compare-outline",
  staff: "person-add-outline",
  hero: "sparkles-outline",
  banner: "megaphone-outline",
  design: "color-palette-outline",
  fee: "calculator-outline",
  checkout: "cart-outline",
  pay: "card-outline",
  faq: "help-circle-outline",
  proto: "document-text-outline",
  reseller: "briefcase-outline",
  "access-code": "lock-closed-outline",
  notice: "alert-circle-outline",
  tracknote: "car-outline",
  notify: "notifications-outline",
  billing: "wallet-outline",
  export: "download-outline",
  account: "key-outline",
};

/** The native screen for a website admin view. Locked → the upgrade screen. */
function openAdminView(item: AdminMenuItem) {
  if (item.locked) {
    router.push(`/manage/upgrade?view=${encodeURIComponent(item.view)}` as Href);
    return;
  }
  const native = NATIVE_VIEW_ROUTES[item.view];
  if (native) router.push(native as Href);
  // A module the website added after this app build: say so, never embed a web page.
  else Alert.alert(item.label, "This section isn't in the app yet. Update the app to get it.");
}

/**
 * The full store admin, grouped Daily / Weekly / Occasional exactly like the
 * website sidebar — and filtered by the SERVER for this user (visibility,
 * staff grants, Business locks), so nothing here decides who sees what.
 */
function ManageStore() {
  const { scope } = useSignedIn();
  const menu = useQuery({ queryKey: [scope, "admin", "menu"], queryFn: adminBridge.menu });

  if (menu.isPending) {
    return (
      <>
        <SectionLabel>Manage store</SectionLabel>
        <Card padded={false}>
          <Row icon="construct-outline" label="Loading your store tools…" />
        </Card>
      </>
    );
  }
  if (menu.isError) {
    return (
      <>
        <SectionLabel>Manage store</SectionLabel>
        <Card padded={false}>
          <Row
            icon="alert-circle-outline"
            label="Couldn't load your store tools"
            detail="Tap to try again"
            onPress={() => void menu.refetch()}
          />
        </Card>
      </>
    );
  }

  return (
    <>
      {menu.data.groups.map((group) => {
        const items = group.items.filter((i) => i.view !== "dashboard");
        if (items.length === 0) return null;
        return (
          <View key={group.id}>
            <SectionLabel>{group.label}</SectionLabel>
            <Card padded={false}>
              {items.map((item, i) => (
                <View key={item.view}>
                  {i > 0 ? <Divider inset={62} /> : null}
                  <Row
                    icon={VIEW_ICONS[item.view] ?? "construct-outline"}
                    label={item.label}
                    detail={item.hint}
                    onPress={() => openAdminView(item)}
                    trailing={
                      item.locked ? (
                        <Pill tone="warning" size="sm" icon="lock-closed" label="Upgrade" />
                      ) : item.isNew ? (
                        <Pill tone="success" size="sm" label="New" />
                      ) : undefined
                    }
                  />
                </View>
              ))}
            </Card>
          </View>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  page: { padding: SPACE.lg, paddingBottom: SPACE.xxxl },
  account: { flexDirection: "row", alignItems: "center", gap: SPACE.lg },
  // The store's mark, tucked on the person's avatar: who you are, in which store.
  storeMark: { position: "absolute", right: -4, bottom: -4, borderRadius: 11, overflow: "hidden" },
  version: { textAlign: "center", marginTop: SPACE.xxl },
  // Set apart from everyday rows so it's never hit by accident.
  danger: { marginTop: SPACE.xl },
});
