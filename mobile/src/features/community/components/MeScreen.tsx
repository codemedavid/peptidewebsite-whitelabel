import { useState } from "react";
import { Alert, Pressable, ScrollView, View } from "react-native";
import { router } from "expo-router";
import Constants from "expo-constants";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSession, useSignedIn } from "@/auth/SessionProvider";
import { enablePush } from "@/notifications/push";
import { PromoOptInRow } from "@/features/promo/PromoOptIn";
import { useSwitchView } from "../useAppView";
import { useCommunityAccess, useInbox } from "../hooks/useInbox";
import { CHAT, GUTTER, INTER, RADII, SHADOWS, useChatBrand } from "../theme";
import { Avatar } from "./Avatar";
import { ChatText } from "./ChatText";
import { IconButton } from "./ChatKit";
import { MembershipScreen } from "./MembershipScreen";
import { EditProfileSheet, ListRow, Section } from "./ProfileParts";
import { RoleBadge } from "./RoleBadge";
import { BusinessSwitch } from "./ViewSwitch";
import { GuestMeScreen } from "@/features/session/guest/GuestScreens";

function Stat({ value, label, onPress }: { value: string; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${label}: ${value}`} style={({ pressed }) => ({ flex: 1, alignItems: "center", gap: 2, minHeight: 44, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}>
      <ChatText style={{ fontFamily: INTER.bold, fontSize: 17, lineHeight: 22 }}>{value}</ChatText>
      <ChatText variant="caption">{label}</ChatText>
    </Pressable>
  );
}

/** Where the profile's Chats links go: the customer tab, or the admin's community view. */
const CHATS_HREF = { member: "/community", moderator: "/community-view" } as const;

function MemberProfile({ variant = "member" }: { variant?: "member" | "moderator" }) {
  const insets = useSafeAreaInsets();
  const b = useChatBrand();
  const { me } = useSignedIn();
  const { signOut } = useSession();
  const inbox = useInbox();
  const [editing, setEditing] = useState(false);
  const switchView = useSwitchView();
  const profile = me.community.profile;
  const name = me.account.displayName;
  const liveDrops = inbox.data?.drops.filter((d) => d.isActive).length ?? 0;
  const moderator = variant === "moderator";
  const communityAdmin = !moderator && me.community.isAdmin === true;
  const verifiedReseller = !moderator && me.community.isVerifiedReseller === true;
  const chatsHref = CHATS_HREF[variant];
  const pending = me.community.pendingApplications;

  const turnOnAlerts = async () => {
    const res = await enablePush({ newOrders: moderator && me.can.orders, storeName: me.store.name });
    Alert.alert(res.ok ? "Notifications on" : "Notifications are off", res.ok ? "You'll hear about new DMs and product drops." : res.message);
  };
  const confirmSignOut = () =>
    Alert.alert("Sign out?", `Notifications from ${me.store.name} stop on this phone.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Sign out", style: "destructive", onPress: () => void signOut() },
    ]);

  return (
    <View style={{ flex: 1, backgroundColor: CHAT.canvas }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
        <LinearGradient colors={[b.brand, b.brandDeep]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ paddingTop: insets.top + 8, paddingHorizontal: GUTTER, paddingBottom: 56 }}>
          <View style={{ flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 }}>
            {moderator ? <BusinessSwitch /> : null}
            <IconButton name="create-outline" label="Edit profile" color={b.onBrand} onPress={() => setEditing(true)} />
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
            <View style={{ borderWidth: 3, borderColor: "rgba(255,255,255,0.85)", borderRadius: 44 }}>
              <Avatar name={name} hue={profile?.avatarHue ?? 0} imageUrl={me.account.avatarUrl} size={76} />
            </View>
            <View style={{ flex: 1, gap: 3 }}>
              <ChatText variant="title" color={b.onBrand} numberOfLines={1} accessibilityRole="header" style={{ fontSize: 22, lineHeight: 27 }}>
                {name}
              </ChatText>
              <ChatText variant="footnote" color={b.onBrand} numberOfLines={1}>
                {me.actor.email}
              </ChatText>
              {communityAdmin || verifiedReseller ? (
                <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
                  {communityAdmin ? <RoleBadge role="admin" surface="brand" /> : null}
                  {verifiedReseller ? <RoleBadge role="reseller" surface="brand" /> : null}
                </View>
              ) : null}
            </View>
          </View>
          {profile?.bio ? (
            <ChatText variant="callout" color={b.onBrand} style={{ marginTop: 12 }}>
              {profile.bio}
            </ChatText>
          ) : null}
        </LinearGradient>

        <View style={{ marginTop: -36, paddingHorizontal: GUTTER }}>
          <View style={[{ flexDirection: "row", backgroundColor: CHAT.surface, borderRadius: RADII.lg, paddingVertical: 10 }, SHADOWS.hairline]}>
            <Stat value={String(inbox.data?.unreadChats ?? 0)} label="Unread chats" onPress={() => router.navigate(chatsHref)} />
            <View style={{ width: 1, backgroundColor: CHAT.hairline, marginVertical: 4 }} />
            <Stat value={String(liveDrops)} label={liveDrops === 1 ? "Live drop" : "Live drops"} onPress={() => router.navigate(chatsHref)} />
          </View>
        </View>

        <View style={{ gap: 18, marginTop: 20 }}>
          <Section title="Community">
            <ListRow icon="chatbubbles" tint="#6A4BC4" label="Chats" onPress={() => router.navigate(chatsHref)} />
            <ListRow icon="notifications" tint={CHAT.heat} label="Message notifications" detail="DMs and product drops" onPress={() => void turnOnAlerts()} last={moderator || me.promoPush?.enabled !== true} />
            {moderator ? null : <PromoOptInRow last />}
          </Section>
          {moderator ? (
            <Section title="Run your community">
              <ListRow
                icon="person-add"
                tint={CHAT.success}
                label="Members"
                detail={pending ? `${pending} waiting for review` : me.community.joinMode === "open" ? "Open to everyone" : "Review who joins"}
                onPress={() => router.navigate("/community-view/members")}
              />
              <ListRow icon="add-circle" tint={b.brand} label="New channel" onPress={() => router.push("/community/channel-new")} />
              <ListRow icon="pricetags" tint="#B4458C" label="Member tags" detail="Style the Admin and Verified reseller tags" onPress={() => router.push("/community/tags")} />
              <ListRow icon="flash" tint={CHAT.warning} label="Broadcast a drop" detail="Pushes to every member" onPress={() => router.push("/community/drop-new")} last />
            </Section>
          ) : communityAdmin ? (
            <Section title="Help run the community">
              <ListRow
                icon="person-add"
                tint={CHAT.success}
                label="Members"
                detail={pending ? `${pending} waiting for review` : "Approve or remove members"}
                onPress={() => router.push("/community/members")}
              />
              <ListRow icon="add-circle" tint={b.brand} label="New channel" onPress={() => router.push("/community/channel-new")} />
              <ListRow icon="pricetags" tint="#B4458C" label="Member tags" detail="Style the Admin and Verified reseller tags" onPress={() => router.push("/community/tags")} last />
            </Section>
          ) : null}
          <Section title="Account">
            <ListRow icon="person" tint={CHAT.inkMuted} label="Edit profile" onPress={() => setEditing(true)} />
            {moderator ? (
              <ListRow icon="briefcase" tint={CHAT.inkSoft} label="Switch to business view" detail="Orders, products and store tools" onPress={() => switchView("business")} last />
            ) : (
              <>
                <ListRow icon="key" tint={CHAT.info} label="Change password" detail="Use a new password to sign in" onPress={() => router.push("/change-password")} />
                <ListRow icon="log-out-outline" tint={CHAT.danger} label="Sign out" destructive onPress={confirmSignOut} />
                <ListRow icon="trash-outline" tint={CHAT.danger} label="Delete account" detail="Removes your account and personal data" destructive onPress={() => router.push("/delete-account")} last />
              </>
            )}
          </Section>
          <ChatText variant="caption" style={{ textAlign: "center" }}>
            {`${me.store.name} · v${Constants.expoConfig?.version ?? "1.0.0"}`}
          </ChatText>
        </View>
      </ScrollView>
      <EditProfileSheet key={editing ? "open" : "closed"} visible={editing} onClose={() => setEditing(false)} showBio={!moderator} />
    </View>
  );
}

/** Customer Me tab: approved members get their profile; everyone else the membership card. */
export function MeScreen() {
  const access = useCommunityAccess();
  if (access.guest) return <GuestMeScreen />;
  return access.membershipCard ? <MembershipScreen card={access.membershipCard} /> : <MemberProfile />;
}

/** Admin community view: the moderator's own profile, community tools, and the way back to business. */
export function ModeratorProfileScreen() {
  return <MemberProfile variant="moderator" />;
}
